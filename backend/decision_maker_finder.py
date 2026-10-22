#!/usr/bin/env python3
"""
Decision Maker Finder Engine
Finds verified decision makers (Founders, CEOs, C-Suite, Managing Directors, Owners)
using Company Name, Company Website, and Company LinkedIn URL.
Utilizes live web scraping of company leadership pages + targeted search dorks,
synthesized and verified via OpenAI API.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from duckduckgo_search import DDGS

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

logger = logging.getLogger("decision_maker_finder")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("[%(asctime)s] [%(levelname)s] [DecisionMakerFinder] %(message)s"))
    logger.addHandler(handler)
logger.setLevel(logging.INFO)

DEFAULT_SENIORITY = [
    "CEO",
    "Founder",
    "Co-Founder",
    "Owner",
    "President",
    "Managing Director",
    "Chief Executive Officer",
    "Director",
    "COO",
    "CTO",
    "VP",
]

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
}


@dataclass
class DecisionMakerResult:
    company_name: str
    company_website: str = ""
    company_linkedin_url: str = ""
    decision_maker_name: str = ""
    position: str = ""
    personal_linkedin_url: str = ""
    confidence_score: int = 0
    evidence: str = ""
    status: str = "not_found"  # "enriched" | "not_found" | "error"
    error_message: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "company_name": self.company_name,
            "company_website": self.company_website,
            "company_linkedin_url": self.company_linkedin_url,
            "decision_maker_name": self.decision_maker_name,
            "position": self.position,
            "personal_linkedin_url": self.personal_linkedin_url,
            "confidence_score": self.confidence_score,
            "evidence": self.evidence,
            "status": self.status,
            "error_message": self.error_message,
        }


def clean_url(url: Optional[str]) -> str:
    """Normalizes URL with https protocol."""
    if not url:
        return ""
    u = str(url).strip()
    if not u or u.lower() in ("nan", "none", "null", "-"):
        return ""
    u = re.sub(r"^(https?:\/\/)+", "https://", u, flags=re.IGNORECASE)
    if not u.startswith("http://") and not u.startswith("https://"):
        u = "https://" + u.lstrip("/")
    return u.rstrip("/")


def extract_domain(url: str) -> str:
    try:
        parsed = urlparse(clean_url(url))
        domain = parsed.netloc.lower()
        if domain.startswith("www."):
            domain = domain[4:]
        return domain
    except Exception:
        return ""


def extract_linkedin_company_slug(url: str) -> str:
    """Extracts company slug from a LinkedIn company URL."""
    if not url:
        return ""
    clean = clean_url(url).lower()
    m = re.search(r"linkedin\.com/(?:company|school)/([^/?#]+)", clean)
    if m:
        return m.group(1).strip()
    return ""


def clean_linkedin_personal_url(url: str) -> str:
    """Normalizes a LinkedIn personal profile URL."""
    if not url:
        return ""
    clean = clean_url(url)
    m = re.search(r"linkedin\.com/in/([^/?#]+)", clean, re.IGNORECASE)
    if m:
        slug = m.group(1).strip()
        return f"https://www.linkedin.com/in/{slug}"
    return ""


class DecisionMakerFinder:
    def __init__(self, openai_api_key: Optional[str] = None, default_model: str = "gpt-4o-mini"):
        self.openai_api_key = (openai_api_key or os.environ.get("OPENAI_API_KEY", "")).strip()
        self.default_model = default_model
        self.session = requests.Session()
        self.session.headers.update(BROWSER_HEADERS)

    def scrape_website_leadership(self, website: str) -> Dict[str, Any]:
        """
        Scrapes company website for leadership, founder, and executive information.
        Checks homepage and common leadership sub-pages (/about, /team, /leadership, etc.).
        """
        info: Dict[str, Any] = {
            "meta_description": "",
            "leadership_snippets": [],
            "personal_linkedin_links": [],
        }

        base_url = clean_url(website)
        if not base_url:
            return info

        parsed = urlparse(base_url)
        origin = f"{parsed.scheme}://{parsed.netloc}"

        candidate_paths = [
            "",
            "/about",
            "/about-us",
            "/team",
            "/our-team",
            "/leadership",
            "/management",
            "/company",
        ]

        visited: set[str] = set()

        for path in candidate_paths:
            target = f"{origin}{path}"
            if target in visited:
                continue
            visited.add(target)

            try:
                resp = self.session.get(target, timeout=5, allow_redirects=True)
                if resp.status_code != 200 or not resp.text:
                    continue

                soup = BeautifulSoup(resp.text, "html.parser")

                # Grab meta description on first page
                if not info["meta_description"]:
                    meta = soup.find("meta", attrs={"name": re.compile(r"description", re.I)})
                    if meta and meta.get("content"):
                        info["meta_description"] = meta.get("content", "").strip()[:400]

                # Look for personal LinkedIn links on the page
                for a in soup.find_all("a", href=True):
                    href = a.get("href", "")
                    if "linkedin.com/in/" in href.lower():
                        cleaned_li = clean_linkedin_personal_url(href)
                        if cleaned_li and cleaned_li not in info["personal_linkedin_links"]:
                            anchor_text = a.get_text(separator=" ", strip=True)
                            parent_text = a.parent.get_text(separator=" ", strip=True) if a.parent else ""
                            context_snippet = (anchor_text or parent_text)[:120]
                            info["personal_linkedin_links"].append({
                                "url": cleaned_li,
                                "context": context_snippet,
                            })

                # Look for headings and paragraphs containing leadership keywords
                keywords_pattern = re.compile(
                    r"\b(founder|co-founder|ceo|chief executive|owner|president|managing director|director|cto|coo|leadership|executive)\b",
                    re.IGNORECASE,
                )

                elements = soup.find_all(["h1", "h2", "h3", "h4", "p", "div", "span"], limit=200)
                for el in elements:
                    text = el.get_text(separator=" ", strip=True)
                    if 20 <= len(text) <= 300 and keywords_pattern.search(text):
                        if text not in info["leadership_snippets"]:
                            info["leadership_snippets"].append(text)
                            if len(info["leadership_snippets"]) >= 10:
                                break

                # If we found strong leadership snippets or team links, we don't need to check every subpath
                if len(info["personal_linkedin_links"]) >= 2 or len(info["leadership_snippets"]) >= 5:
                    break

            except Exception as e:
                logger.debug(f"Error scraping {target}: {e}")
                continue

        return info

    def search_candidates(
        self,
        company_name: str,
        company_website: str,
        company_linkedin_url: str,
        target_seniority: Optional[List[str]] = None,
    ) -> List[Dict[str, str]]:
        """
        Executes precision search dorks across Bing, Yahoo, and DDG to identify
        real executive candidates and their LinkedIn URLs.
        """
        snippets: List[Dict[str, str]] = []
        if not company_name and not company_website and not company_linkedin_url:
            return snippets

        clean_name = re.sub(r'[,.\'"()]', " ", company_name).strip() if company_name else ""
        slug = extract_linkedin_company_slug(company_linkedin_url)
        domain = extract_domain(company_website)

        target_name = clean_name or slug or domain

        roles_list = target_seniority if target_seniority and len(target_seniority) > 0 else ["CEO", "Founder", "Owner", "President", "Managing Director"]
        roles_term = " OR ".join([f'"{r}"' if " " in r else r for r in roles_list[:4]])

        queries: List[str] = [
            f'site:linkedin.com/in "{target_name}" ({roles_term})',
            f'site:linkedin.com/in "{target_name}" "CEO"',
            f'site:linkedin.com/in "{target_name}" "Founder"',
            f'site:linkedin.com/in "{target_name}"',
        ]

        if slug and slug.lower() != target_name.lower():
            queries.append(f'site:linkedin.com/in "{slug}" ({roles_term})')

        try:
            import backend.linkedin_profile_collector as lpc
        except ImportError:
            try:
                import linkedin_profile_collector as lpc
            except ImportError:
                lpc = None

        seen_urls = set()

        for q in queries:
            if len(snippets) >= 8:
                break
            try:
                if lpc and hasattr(lpc, "run_search"):
                    raw_results = lpc.run_search(q, 1, ['bing', 'yahoo', 'ddg'])
                    if raw_results:
                        for r in raw_results:
                            title = r.get("title", "")
                            body = r.get("snippet", "")
                            url = r.get("url", "")
                            li_url = clean_linkedin_personal_url(url)
                            item_key = li_url or title
                            if item_key not in seen_urls:
                                seen_urls.add(item_key)
                                snippets.append({
                                    "title": title,
                                    "snippet": body,
                                    "url": li_url or url,
                                })
                        if len(snippets) >= 5:
                            break
                else:
                    with DDGS() as ddgs:
                        res = list(ddgs.text(q, max_results=6))
                        for r in res:
                            title = r.get("title", "")
                            body = r.get("body", "")
                            url = r.get("href", "")
                            li_url = clean_linkedin_personal_url(url)
                            item_key = li_url or title
                            if item_key not in seen_urls:
                                seen_urls.add(item_key)
                                snippets.append({
                                    "title": title,
                                    "snippet": body,
                                    "url": li_url or url,
                                })
            except Exception as e:
                logger.debug(f"Search query failed for '{q}': {e}")
                continue

        return snippets

    def query_openai(
        self,
        company_name: str,
        company_website: str,
        company_linkedin_url: str,
        website_info: Dict[str, Any],
        search_snippets: List[Dict[str, str]],
        target_seniority: Optional[List[str]] = None,
        api_key_override: Optional[str] = None,
        model_override: Optional[str] = None,
    ) -> Tuple[Dict[str, Any], Optional[str]]:
        """
        Sends the company intelligence and search facts to OpenAI for decision maker extraction.
        Returns (parsed_json_dict, error_string).
        """
        key = (api_key_override or self.openai_api_key or os.environ.get("OPENAI_API_KEY", "")).strip()
        if not key:
            return {}, "OpenAI API Key is missing. Please provide your OpenAI API key in Settings or request."

        if OpenAI is None:
            return {}, "OpenAI Python library is not installed."

        model = model_override or self.default_model or "gpt-4o-mini"
        roles = target_seniority or DEFAULT_SENIORITY

        # Prepare context payload
        context_parts = [
            f"TARGET COMPANY PROFILE:",
            f"- Company Name: {company_name}",
            f"- Company Website: {company_website or 'Not specified'}",
            f"- Company LinkedIn URL: {company_linkedin_url or 'Not specified'}",
            f"- Target Roles / Seniority: {', '.join(roles)}",
            "",
            "VERIFIED EVIDENCE COLLECTED FROM WEB & LINKEDIN:",
        ]

        if website_info.get("meta_description"):
            context_parts.append(f"Website Meta: {website_info['meta_description']}")

        if website_info.get("personal_linkedin_links"):
            context_parts.append("Found Executives on Website:")
            for item in website_info["personal_linkedin_links"][:4]:
                context_parts.append(f"  • {item['context']} -> {item['url']}")

        if website_info.get("leadership_snippets"):
            context_parts.append("Leadership Mention Snippets from Website:")
            for s in website_info["leadership_snippets"][:5]:
                context_parts.append(f"  • {s}")

        if search_snippets:
            context_parts.append("Search Engine & LinkedIn Results:")
            for s in search_snippets[:8]:
                context_parts.append(f"  • Title: {s['title']}")
                context_parts.append(f"    Snippet: {s['snippet']}")
                if s["url"]:
                    context_parts.append(f"    URL: {s['url']}")

        prompt_content = "\n".join(context_parts)

        system_instruction = (
            "You are a master corporate intelligence researcher.\n"
            "Your task is to identify the primary decision maker (CEO, Founder, Co-Founder, Owner, "
            "President, Managing Director, or matching requested seniority) for the target company.\n"
            "Use the provided real search snippets, website leadership excerpts, and your verified knowledge.\n"
            "STRICT RULES:\n"
            "1. Output valid JSON only, matching this exact schema:\n"
            "   {\n"
            '     "decision_maker_name": "Full Name",\n'
            '     "position": "Exact Current Job Title / Position",\n'
            '     "personal_linkedin_url": "https://www.linkedin.com/in/... or empty",\n'
            '     "confidence_score": 90,\n'
            '     "evidence": "Brief 1-2 sentence explanation of how this person was verified",\n'
            '     "is_found": true\n'
            "   }\n"
            "2. If no legitimate decision maker can be identified or verified with at least 50% confidence, return:\n"
            '   {"decision_maker_name": "", "position": "", "personal_linkedin_url": "", "confidence_score": 0, "evidence": "Could not verify decision maker", "is_found": false}\n'
            "3. Do NOT make up fake or generic names. The name must be an actual individual associated with this company.\n"
            "4. Ensure personal_linkedin_url is a personal LinkedIn URL (/in/...), NOT a company URL (/company/)."
        )

        try:
            client = OpenAI(api_key=key)
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": prompt_content},
                ],
                response_format={"type": "json_object"},
                temperature=0.1,
            )
            raw_content = response.choices[0].message.content or "{}"
            parsed = json.loads(raw_content)
            return parsed, None
        except Exception as e:
            logger.error(f"OpenAI API call failed: {e}")
            return {}, f"OpenAI Error: {str(e)}"

    def heuristic_fallback(
        self,
        company_name: str,
        website_info: Dict[str, Any],
        search_snippets: List[Dict[str, str]],
        target_seniority: Optional[List[str]] = None,
    ) -> DecisionMakerResult:
        """
        Fast heuristic extractor used if OpenAI key is not provided or fails.
        Extracts candidate names and titles from regex patterns in search snippets & site text.
        """
        res = DecisionMakerResult(company_name=company_name)

        # 1. Check if website has direct executive LinkedIn links
        for item in website_info.get("personal_linkedin_links", []):
            ctx = item.get("context", "")
            url = item.get("url", "")
            m = re.search(r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[-–|,:]\s*([A-Za-z\s&]+)", ctx)
            if m:
                res.decision_maker_name = m.group(1).strip()
                res.position = m.group(2).strip()
                res.personal_linkedin_url = url
                res.confidence_score = 85
                res.evidence = f"Extracted from company website leadership link ({ctx})"
                res.status = "enriched"
                return res

        # 2. Check search snippets with standard LinkedIn title pattern
        # e.g.: "Noah Kagan - Chief Sumo at AppSumo .com | LinkedIn"
        title_pattern = re.compile(
            r"^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[-–|]\s*(?:([^–|-]+?)(?:[-–|]|$))",
            re.UNICODE,
        )

        clean_cname = company_name.strip().lower()

        # Pass 1: candidates where company name appears in title or snippet
        for s in search_snippets:
            title = s.get("title", "")
            snippet = s.get("snippet", "")
            url = s.get("url", "")
            full_text = f"{title} {snippet}".lower()

            if clean_cname and clean_cname not in full_text:
                continue

            m = title_pattern.search(title)
            if m:
                candidate_name = m.group(1).strip()
                candidate_title = m.group(2).strip()

                if candidate_name.lower() in ("linkedin", "home", "about", "top", "best", "the"):
                    continue

                if re.search(r"\b(CEO|Founder|Owner|President|Director|Managing|Chief|VP)\b", candidate_title, re.I):
                    res.decision_maker_name = candidate_name
                    res.position = candidate_title
                    res.personal_linkedin_url = clean_linkedin_personal_url(url)
                    res.confidence_score = 80
                    res.evidence = f"Extracted from verified company LinkedIn match: '{title}'"
                    res.status = "enriched"
                    return res

        # Pass 2: any executive pattern if pass 1 didn't find anything
        for s in search_snippets:
            title = s.get("title", "")
            url = s.get("url", "")
            m = title_pattern.search(title)
            if m:
                candidate_name = m.group(1).strip()
                candidate_title = m.group(2).strip()
                if candidate_name.lower() in ("linkedin", "home", "about", "top", "best", "the"):
                    continue
                if re.search(r"\b(CEO|Founder|Owner|President|Director|Managing|Chief|VP)\b", candidate_title, re.I):
                    res.decision_maker_name = candidate_name
                    res.position = candidate_title
                    res.personal_linkedin_url = clean_linkedin_personal_url(url)
                    res.confidence_score = 65
                    res.evidence = f"Extracted from LinkedIn candidate result: '{title}'"
                    res.status = "enriched"
                    return res

        res.status = "not_found"
        res.evidence = "No verified decision maker found matching criteria"
        return res

    def find_decision_maker(
        self,
        company_name: str,
        company_website: str = "",
        company_linkedin_url: str = "",
        target_seniority: Optional[List[str]] = None,
        openai_api_key: Optional[str] = None,
        model: Optional[str] = None,
    ) -> DecisionMakerResult:
        """
        Orchestrates full decision maker enrichment for a single company:
          1. Normalizes company website & LinkedIn URL.
          2. Scrapes website leadership pages and extracts embedded executive profiles.
          3. Searches live search engines for executive LinkedIn snippets.
          4. Uses OpenAI to verify, reason, and extract exact Name, Position, and LinkedIn.
          5. Falls back to heuristic parsing if OpenAI API key is unavailable.
        """
        company_clean = (company_name or "").strip()
        web_clean = clean_url(company_website)
        li_clean = clean_url(company_linkedin_url)

        if not company_clean and not web_clean and not li_clean:
            return DecisionMakerResult(
                company_name=company_clean,
                status="error",
                error_message="Company name, website, or LinkedIn URL is required.",
            )

        logger.info(f"Finding decision maker for: '{company_clean}' (Site: '{web_clean}', LI: '{li_clean}')")

        # Step 1: Scrape website leadership
        website_info: Dict[str, Any] = {}
        if web_clean:
            try:
                website_info = self.scrape_website_leadership(web_clean)
            except Exception as e:
                logger.debug(f"Website scraping failed for {web_clean}: {e}")

        # Step 2: Live Search & LinkedIn Dorking
        search_snippets = self.search_candidates(
            company_name=company_clean,
            company_website=web_clean,
            company_linkedin_url=li_clean,
            target_seniority=target_seniority,
        )

        # Step 3: OpenAI AI Reasoning
        key_to_use = (openai_api_key or self.openai_api_key or os.environ.get("OPENAI_API_KEY", "")).strip()

        if key_to_use:
            logger.info(f"Invoking OpenAI model '{model or self.default_model}' for '{company_clean}'...")
            ai_data, error = self.query_openai(
                company_name=company_clean,
                company_website=web_clean,
                company_linkedin_url=li_clean,
                website_info=website_info,
                search_snippets=search_snippets,
                target_seniority=target_seniority,
                api_key_override=key_to_use,
                model_override=model,
            )

            if not error and ai_data and ai_data.get("is_found") and ai_data.get("decision_maker_name"):
                dm_name = str(ai_data.get("decision_maker_name", "")).strip()
                pos = str(ai_data.get("position", "")).strip()
                dm_li = clean_linkedin_personal_url(ai_data.get("personal_linkedin_url", ""))

                # If OpenAI didn't have the exact personal LinkedIn URL, check if search or website had it for this person
                if not dm_li:
                    for s in search_snippets:
                        if dm_name.lower() in s.get("title", "").lower() and s.get("url"):
                            candidate_li = clean_linkedin_personal_url(s["url"])
                            if candidate_li:
                                dm_li = candidate_li
                                break

                confidence = int(ai_data.get("confidence_score") or 90)
                evidence = str(ai_data.get("evidence") or f"Identified {dm_name} as {pos} via OpenAI AI reasoning.")

                return DecisionMakerResult(
                    company_name=company_clean,
                    company_website=web_clean,
                    company_linkedin_url=li_clean,
                    decision_maker_name=dm_name,
                    position=pos,
                    personal_linkedin_url=dm_li,
                    confidence_score=confidence,
                    evidence=evidence,
                    status="enriched",
                )
            elif error:
                logger.warning(f"OpenAI error for '{company_clean}': {error}. Trying heuristic extraction.")

        # Step 4: Fallback to heuristic extraction if OpenAI key not set or failed
        heuristic_res = self.heuristic_fallback(
            company_name=company_clean,
            website_info=website_info,
            search_snippets=search_snippets,
            target_seniority=target_seniority,
        )
        heuristic_res.company_website = web_clean
        heuristic_res.company_linkedin_url = li_clean
        if not key_to_use and heuristic_res.status == "enriched":
            heuristic_res.evidence += " (Tip: Configure OpenAI API Key for higher precision)"
        elif not key_to_use and heuristic_res.status == "not_found":
            heuristic_res.evidence = "No decision maker found. Connect your OpenAI API Key for enhanced AI discovery."

        return heuristic_res
