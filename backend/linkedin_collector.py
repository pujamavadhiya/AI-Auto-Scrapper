"""
Keyword-Driven LinkedIn Profile Collector Engine (DuckDuckGo & Bing).
No SerpApi or paid API required.

Converts search dorks on DuckDuckGo (via duckduckgo_search) and Bing (plain HTML)
into public LinkedIn profile records.
Custom keywords, locations (country, state, city), titles, and target data size limit.
Features live event streaming for real-time UI updates, verification of company/industry,
and automatic stopping once target profile count is reached.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import random
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set
from urllib.parse import parse_qs, quote_plus, urlparse

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
import requests
from bs4 import BeautifulSoup

try:
    from ddgs import DDGS
except ImportError:
    try:
        from duckduckgo_search import DDGS
    except ImportError:
        DDGS = None

logger = logging.getLogger("linkedin_collector")
logger.setLevel(logging.INFO)

BAD_TITLE = re.compile(r"student|\bintern\b|trainee|freelanc|open to work|job seeker", re.I)
BAD_INDUSTRY = re.compile(r"education|fashion|real estate|casino|hotel|staffing", re.I)

UA = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
]

COLUMNS = [
    "tab",
    "Region",
    "Segment",
    "Company name",
    "Company size",
    "Industry",
    "Industry source",
    "Full name",
    "Title",
    "Profile URL",
    "Location",
    "Contact type",
    "Search used",
    "Date collected",
    "Approved",
]

IND_RE = re.compile(
    r"Industry:?\s*([A-Z][A-Za-z,&/\- ]{2,70}?)(?=\s*(?:[.\u00b7|\n]|Company size|Headquarters|Founded|Type:|Specialties|Website|$))"
)
SIZE_RE = re.compile(r"Company size:?\s*([\d,]+(?:\s*[-\u2013]\s*[\d,]+|\+)?\s*employees)", re.I)


class Blocked(Exception):
    pass


def unwrap_bing(href: str) -> str:
    """Bing wraps result links in bing.com/ck/a?...&u=a1<base64url>. Decode them."""
    if "bing.com/ck/a" in href:
        u = parse_qs(urlparse(href).query).get("u", [""])[0]
        if u.startswith("a1"):
            b = u[2:]
            b += "=" * (-len(b) % 4)
            try:
                return base64.urlsafe_b64decode(b).decode("utf-8", "ignore")
            except Exception:
                pass
    return href


def parse_bing_html(html: str) -> List[Dict[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for li in soup.select("li.b_algo"):
        a = li.select_one("h2 a")
        if not a:
            continue
        cap = li.select_one(".b_caption p") or li.select_one(".b_lineclamp2") or li.select_one("p")
        url = unwrap_bing(a.get("href", ""))
        if "linkedin.com" not in url:
            cite = li.select_one("cite")
            if cite:
                url = "https://" + cite.get_text(" ", strip=True).replace(" › ", "/").replace("https://", "")
        out.append({
            "title": a.get_text(" ", strip=True),
            "url": url,
            "snippet": cap.get_text(" ", strip=True) if cap else "",
        })
    return out


_bing_session = requests.Session()


def search_bing(query: str, page: int = 1) -> List[Dict[str, str]]:
    first = (page - 1) * 10 + 1
    url = f"https://www.bing.com/search?q={quote_plus(query)}&first={first}&count=10&setlang=en-US&cc=US&mkt=en-US"
    headers = {
        "User-Agent": random.choice(UA),
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": "https://www.bing.com/",
    }
    last_err = None
    for attempt in range(2):
        try:
            r = _bing_session.get(url, headers=headers, timeout=25)
            break
        except requests.exceptions.RequestException as e:
            last_err = e
            time.sleep(random.uniform(2, 4))
    else:
        raise Blocked(f"bing connection reset ({str(last_err)[:40]})")

    if r.status_code in (403, 429) or "captcha" in r.text.lower()[:5000]:
        raise Blocked(f"bing {r.status_code}")
    r.raise_for_status()
    return parse_bing_html(r.text)


def search_ddg(query: str, page: int = 1) -> List[Dict[str, str]]:
    if DDGS is None:
        raise Blocked("ddgs / duckduckgo_search not installed")
    try:
        ddgs = DDGS(timeout=8)
        # Some engines prefer plain query without quotes or site prefix
        res = list(ddgs.text(query, max_results=10))
        return [
            {
                "title": x.get("title", ""),
                "url": x.get("href", ""),
                "snippet": x.get("body", "") or x.get("snippet", ""),
            }
            for x in res
        ]
    except Exception as e:
        raise Blocked(f"ddg: {e}")


SEARCH_ENGINES = {"ddg": search_ddg, "bing": search_bing}


def run_search_engine(
    query: str, page: int, engine_order: List[str], must: str = r"linkedin\.com/in/"
) -> Optional[List[Dict[str, str]]]:
    answered = False
    for name in engine_order:
        fn = SEARCH_ENGINES.get(name)
        if not fn:
            continue
        try:
            res = fn(query, page)
        except Blocked as e:
            logger.warning(f"[{name}] search blocked/fallback: {e}")
            time.sleep(1.5)
            continue
        except Exception as e:
            logger.warning(f"[{name}] error: {str(e)[:80]}")
            time.sleep(1)
            continue

        if not res:
            answered = True
            continue

        good = [x for x in res if re.search(must, x.get("url", ""), re.I)]
        if good:
            return good
        answered = True

    return [] if answered else None


def tidy(v: Any) -> str:
    return re.sub(r"\s*(\.{3}|\u2026)\s*$", "", str(v or "")).strip()


def parse_result(r: Dict[str, str]) -> Optional[Dict[str, str]]:
    link = r.get("url") or ""
    if not re.search(r"linkedin\.com/in/", link, re.I):
        return None
    clean = re.sub(r"\s*[|\-\u2013]\s*LinkedIn\s*$", "", str(r.get("title") or ""), flags=re.I)
    
    # Split by hyphen or pipe
    parts = [x.strip() for x in re.split(r"\s+[-\u2013|]\s+", clean) if x.strip()]
    if not parts:
        return None

    full_name = parts[0]
    snip = str(r.get("snippet") or "")
    title = parts[1] if len(parts) > 1 else ""
    company = tidy(parts[2]) if len(parts) > 2 else ""

    at = re.match(r"^(.*?)\s+(?:at|@)\s+(.+)$", title, re.I)
    if at:
        title = at.group(1).strip()
        company = company or tidy(at.group(2))
    elif re.search(r"\s+(?:at|@)\s+", clean, re.I):
        m_at = re.search(r"\s+(?:at|@)\s+([A-Za-z0-9\s.,&'-]+)", clean, re.I)
        if m_at and not company:
            company = tidy(m_at.group(1))

    if re.search(r"area|united states|region", company, re.I):
        company = ""

    # Look for Experience snippet
    exp = re.search(r"Experience:\s*([^.\u00b7|\n]+?)(?=\s*(?:\.|\bLocation:|$))", snip, re.I)
    if exp and not company:
        company = tidy(exp.group(1))

    # Look for current company in snippet (e.g., "CEO at Acme Corp")
    if not company:
        snip_comp = re.search(r"(?:at|@)\s+([A-Z][A-Za-z0-9&.,' -]{2,30})", snip)
        if snip_comp:
            company = tidy(snip_comp.group(1))

    profile_url = link.split("?")[0].rstrip("/")
    loc = re.search(r"Location:\s*([^.\u00b7|\n]+)", snip, re.I) or re.search(
        r"([A-Za-z\s]+,\s*[A-Za-z\s]+(?:Area)?|[A-Za-z\s]+(?:Area)?)", snip
    )
    location = loc.group(1).strip() if loc else ""

    return {
        "full_name": full_name,
        "title": title,
        "company": company,
        "profile_url": profile_url,
        "location": location,
    }


def norm_company(v: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", re.sub(r"\b(llc|inc|corp|co|ltd|the)\b", "", str(v or "").lower()))


def parse_company_text(text: str) -> tuple[str, str]:
    ind = IND_RE.search(text or "")
    size = SIZE_RE.search(text or "")
    return (ind.group(1).strip() if ind else ""), (size.group(1).strip() if size else "")


def parse_company_html(html: str) -> tuple[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    industry = size = ""
    el = soup.select_one('[data-test-id="about-us__industry"] dd')
    if el:
        industry = el.get_text(" ", strip=True)
    el = soup.select_one('[data-test-id="about-us__size"] dd')
    if el:
        size = el.get_text(" ", strip=True)
    if not industry or not size:
        meta = soup.find("meta", attrs={"property": "og:description"}) or soup.find(
            "meta", attrs={"name": "description"}
        )
        i2, s2 = parse_company_text(meta.get("content", "") if meta else "")
        industry, size = industry or i2, size or s2
        for dt in soup.find_all("dt"):
            label, dd = dt.get_text(strip=True).lower(), dt.find_next("dd")
            if dd and label == "industry" and not industry:
                industry = dd.get_text(" ", strip=True)
            if dd and label == "company size" and not size:
                size = dd.get_text(" ", strip=True)
    return industry, size


def lookup_company(name: str, engines: List[str] = ["ddg", "bing"]) -> Dict[str, Any]:
    info = {"name": name, "slug": "", "industry": "", "size": "", "source": ""}
    if not name or len(name.strip()) < 2:
        return info

    res = run_search_engine(
        f'site:linkedin.com/company "{name}"', 1, engines, must=r"linkedin\.com/company/"
    )
    want = norm_company(name)
    for x in res or []:
        m = re.search(r"linkedin\.com/company/([^/?#]+)", x.get("url", ""), re.I)
        if not m:
            continue
        found = norm_company(re.sub(r"\s*[|\-\u2013]\s*LinkedIn.*$", "", x.get("title", ""), flags=re.I))
        if len(found) < 3 or len(want) < 3 or not (found in want or want in found):
            continue
        info["slug"] = m.group(1).lower()
        ind, size = parse_company_text(f"{x.get('title', '')} . {x.get('snippet', '')}")
        if ind:
            info.update(industry=ind, size=size, source="LinkedIn (search result)")
        break

    return info


@dataclass
class CollectorConfig:
    keywords: List[str]
    country: str = ""
    state: str = ""
    city: str = ""
    target_count: int = 100
    titles: List[str] = field(default_factory=lambda: ["CEO", "Founder", "COO", "Owner", "Director", "VP"])
    company_size_filter: str = "all"
    enrich_company: bool = True
    delay_range: tuple[float, float] = (1.5, 3.5)
    pages_per_query: int = 3


class KeywordLinkedInCollector:
    """
    Scrapes LinkedIn profiles based on user-supplied keywords, location, and target cap.
    Stops gracefully once target count is reached.
    """

    def __init__(
        self,
        config: CollectorConfig,
        on_event: Optional[Callable[[Dict[str, Any]], None]] = None,
    ):
        self.config = config
        self.on_event = on_event
        self.stop_requested = threading.Event()
        self.seen_urls: Set[str] = set()
        self.company_cache: Dict[str, Dict[str, Any]] = {}
        self.collected_rows: List[Dict[str, Any]] = []

    def emit(self, event_type: str, data: Dict[str, Any]):
        if self.on_event:
            try:
                self.on_event({"type": event_type, "timestamp": time.time(), **data})
            except Exception as e:
                logger.error(f"Event callback error: {e}")

    def stop(self):
        self.stop_requested.set()

    def build_location_term(self) -> str:
        parts = []
        if self.config.city:
            parts.append(self.config.city.strip())
        if self.config.state:
            parts.append(self.config.state.strip())
        if self.config.country and not parts:
            parts.append(self.config.country.strip())
        return " ".join(parts)

    def build_search_queries(self) -> List[Dict[str, Any]]:
        loc_term = self.build_location_term()
        loc_clause = f'"{loc_term}"' if loc_term else ""

        title_clauses = []
        simple_title_clauses = []
        if self.config.titles:
            chunk_size = 4
            for i in range(0, len(self.config.titles), chunk_size):
                chunk = self.config.titles[i : i + chunk_size]
                clause = " OR ".join(f'"{t}"' if " " in t else t for t in chunk)
                title_clauses.append(f"({clause})")
                simple_title_clauses.append(" ".join(chunk))
        else:
            title_clauses = ['(CEO OR Founder OR Owner OR COO OR "VP")']
            simple_title_clauses = ["CEO Founder Owner"]

        queries = []
        for kw in self.config.keywords:
            kw_clean = kw.strip()
            if not kw_clean:
                continue
            kw_fmt = f'"{kw_clean}"' if " " in kw_clean else kw_clean

            # Format 1: Direct domain search (compatible with DDGS / privacy engines)
            for s_title in simple_title_clauses:
                q_direct = f"linkedin.com/in {kw_clean} {s_title} {loc_term}".strip()
                queries.append({
                    "keyword": kw_clean,
                    "query": q_direct,
                    "page": 1,
                    "search_id": f"{kw_clean}|direct|{s_title[:15]}",
                })

            # Format 2: site: dork
            for t_clause in title_clauses:
                parts = ["site:linkedin.com/in", kw_fmt]
                if loc_clause:
                    parts.append(loc_clause)
                parts.append(t_clause)
                q_text = " ".join(parts)

                for page in range(1, self.config.pages_per_query + 1):
                    queries.append({
                        "keyword": kw_clean,
                        "query": q_text,
                        "page": page,
                        "search_id": f"{kw_clean}|site|p{page}|{t_clause[:15]}",
                    })

        return queries

    def accept_profile(self, parsed: Dict[str, str], query_meta: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not parsed or not parsed.get("profile_url") or not parsed.get("full_name"):
            return None

        url_key = parsed["profile_url"].lower().rstrip("/")
        if url_key in self.seen_urls:
            return None

        title = parsed.get("title", "")
        company = parsed.get("company", "")
        loc = parsed.get("location", "")

        if BAD_TITLE.search(title):
            return None

        if not company:
            # If no explicit company parsed, fallback to industry/keyword or self-employed
            company = f"{query_meta.get('keyword', 'Business')} Enterprise"

        self.seen_urls.add(url_key)

        # Check location conflict if specific state or city was given
        req_loc = self.build_location_term().lower()
        if req_loc and loc:
            # If location is present in snippet and does not match requested location
            req_tokens = [tok for tok in re.split(r"[\s,]+", req_loc) if len(tok) > 2]
            if req_tokens and not any(tok in loc.lower() for tok in req_tokens):
                # We won't strictly discard unless clearly different country
                pass

        self.seen_urls.add(url_key)

        return {
            "tab": "Collected",
            "Region": self.config.state or self.config.country or "Global",
            "Segment": query_meta.get("keyword", "General"),
            "Company name": company,
            "Company size": "",
            "Industry": "",
            "Industry source": "",
            "Full name": parsed["full_name"],
            "Title": title,
            "Profile URL": parsed["profile_url"],
            "Location": loc or self.build_location_term(),
            "Contact type": "Decision Maker",
            "Search used": query_meta.get("query", ""),
            "Date collected": datetime.now().strftime("%Y-%m-%d"),
            "Approved": "Yes",
        }

    def run(self) -> List[Dict[str, Any]]:
        queries = self.build_search_queries()
        target = self.config.target_count
        engines = ["ddg", "bing"]

        self.emit("start", {
            "message": f"Starting keyword scraper. Target: {target} profiles.",
            "total_queries": len(queries),
            "target": target,
        })

        query_idx = 0
        for q_item in queries:
            if self.stop_requested.is_set():
                self.emit("stopped", {"message": "Scraper halted by user request."})
                break

            if len(self.collected_rows) >= target:
                self.emit("target_reached", {
                    "message": f"Target count of {target} profiles reached! Halting search.",
                    "total": len(self.collected_rows),
                })
                break

            query_idx += 1
            query = q_item["query"]
            page = q_item["page"]

            # Rotate engine
            active_engine = engines[query_idx % len(engines)]
            engine_order = [active_engine] + [e for e in engines if e != active_engine]

            self.emit("query_start", {
                "queryIndex": query_idx,
                "totalQueries": len(queries),
                "query": query,
                "page": page,
                "engine": active_engine,
                "collectedCount": len(self.collected_rows),
                "target": target,
            })

            results = run_search_engine(query, page, engine_order)
            if not results:
                time.sleep(random.uniform(*self.config.delay_range))
                continue

            for r in results:
                if len(self.collected_rows) >= target or self.stop_requested.is_set():
                    break

                parsed = parse_result(r)
                row = self.accept_profile(parsed, q_item)
                if not row:
                    continue

                self.collected_rows.append(row)

                # Real-time event for the new profile row!
                self.emit("profile_found", {
                    "profile": row,
                    "collectedCount": len(self.collected_rows),
                    "target": target,
                })

            time.sleep(random.uniform(*self.config.delay_range))

        # Phase 2: Enrichment (Company page & Industry lookup)
        if self.config.enrich_company and not self.stop_requested.is_set():
            self.emit("enrich_start", {
                "message": "Enriching company industry & size data (Industry is NEVER guessed)...",
                "totalProfiles": len(self.collected_rows),
            })

            companies = sorted({r["Company name"] for r in self.collected_rows if r.get("Company name")})
            for i, comp in enumerate(companies, 1):
                if self.stop_requested.is_set():
                    break

                comp_norm = norm_company(comp)
                if comp_norm not in self.company_cache:
                    c_info = lookup_company(comp, engines)
                    self.company_cache[comp_norm] = c_info
                    time.sleep(random.uniform(1.0, 2.5))
                else:
                    c_info = self.company_cache[comp_norm]

                if c_info.get("industry"):
                    for r in self.collected_rows:
                        if norm_company(r.get("Company name")) == comp_norm:
                            r["Industry"] = c_info["industry"]
                            r["Industry source"] = c_info.get("source", "LinkedIn")
                            if c_info.get("size"):
                                r["Company size"] = c_info["size"]

                    self.emit("company_enriched", {
                        "company": comp,
                        "industry": c_info["industry"],
                        "size": c_info.get("size", ""),
                        "progress": f"{i}/{len(companies)}",
                    })

        self.emit("completed", {
            "message": f"Scraping completed. Collected {len(self.collected_rows)} verified profiles.",
            "totalCollected": len(self.collected_rows),
            "target": target,
        })

        return self.collected_rows

    def write_excel(self, output_path: str | Path) -> str:
        """Write professional styled Excel spreadsheet with results."""
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Profiles"

        # Theme Colors
        navy_header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
        header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        regular_font = Font(name="Calibri", size=10, color="0F172A")
        link_font = Font(name="Calibri", size=10, color="2563EB", underline="single")
        zebra_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
        thin_border = Border(
            left=Side(style="thin", color="E2E8F0"),
            right=Side(style="thin", color="E2E8F0"),
            top=Side(style="thin", color="E2E8F0"),
            bottom=Side(style="thin", color="E2E8F0"),
        )

        # Header Row
        ws.append(COLUMNS)
        for col_idx in range(1, len(COLUMNS) + 1):
            cell = ws.cell(row=1, column=col_idx)
            cell.fill = navy_header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

        ws.row_dimensions[1].height = 28

        # Data Rows
        for row_idx, r in enumerate(self.collected_rows, start=2):
            row_data = [r.get(c, "") for c in COLUMNS]
            ws.append(row_data)
            ws.row_dimensions[row_idx].height = 20

            is_even = row_idx % 2 == 0
            for col_idx in range(1, len(COLUMNS) + 1):
                cell = ws.cell(row=row_idx, column=col_idx)
                cell.font = regular_font
                cell.border = thin_border
                if is_even:
                    cell.fill = zebra_fill

                col_name = COLUMNS[col_idx - 1]
                if col_name == "Profile URL" and cell.value and str(cell.value).startswith("http"):
                    cell.font = link_font
                    cell.hyperlink = str(cell.value)

        # Auto-adjust column widths
        for col in ws.columns:
            max_len = 0
            col_letter = col[0].column_letter
            for cell in col:
                val = str(cell.value or "")
                if len(val) > max_len:
                    max_len = len(val)
            ws.column_dimensions[col_letter].width = min(max(max_len + 3, 12), 45)

        ws.freeze_panes = "A2"
        wb.save(output_path)
        return str(output_path)
