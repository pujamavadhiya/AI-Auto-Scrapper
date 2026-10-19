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


TITLE_WORDS = re.compile(
    r"\b(CEO|CTO|COO|CFO|CMO|CIO|CRO|CCO|Founder|Co-Founder|Co-founder|Owner|Co-Owner|President|VP|Vice President|Director|Head|Lead|Partner|Managing Director|Officer|Executive)\b",
    re.I,
)

ROLE_WORDS = re.compile(
    r"\b(architect|consultant|analyst|developer|engineer|specialist|manager|director|officer|executive|president|founder|owner|partner|head|lead|leader|leadership|strategist|advisor|entrepreneur|technologist|operator|member|innovator|evangelist|enthusiast|mentor|decision maker|decision-maker)\b",
    re.I,
)

GENERIC_COMPANY_TERMS = re.compile(
    r"^(helping|services|it services|software|technology|consulting|incubator|building|experienced|seasoned|passionate|professional|specialist|business|commercialization|co|self-employed|freelance|stealth|ex-|award-winning|growth-driven|results-driven|visionary|champion|expert)$",
    re.I,
)

ING_WORDS = re.compile(
    r"^(helping|scaling|building|driving|growing|empowering|leading|managing|innovating|transforming|accelerating|creating|enabling|providing|delivering|advising|consulting|investing|ex-)\b",
    re.I,
)

DISCIPLINE_TERMS = re.compile(
    r"\b(decision maker|business decision|decision-maker|project management|construction management|product management|business development|operations management|marketing strategy|digital marketing|full stack|software development|it services|sales management|account management|management|execution)\b",
    re.I,
)


def clean_title(title: str) -> str:
    title = re.sub(r"^[↳\s*•·]+", "", title).strip()
    title = re.sub(r"\s*\((?:he/him|she/her|they/them)\)", "", title, flags=re.I).strip()
    if "•" in title or "·" in title or "|" in title:
        subparts = [p.strip() for p in re.split(r"[•·|]+", title) if p.strip()]
        for sp in subparts:
            if TITLE_WORDS.search(sp):
                title = sp
                break
    m_broken = re.search(r"^(.*?)\s*&\s*[A-Za-z]{1,4}$", title)
    if m_broken:
        title = m_broken.group(1).strip()
    return title

NON_LOCATION_WORDS = re.compile(
    r"\b(is|are|was|were|has|have|had|been|alone|doesn|incubator|technologist|entrepreneur|helping|scale|growth|platform|solution|solutions|team|services|companies|firm|global|author|consultant|mentor|speaker|enthusiast|leader|engineer|developer|developers|group|organiser|organizer|driving|delivering|commercialization|innovations|products|engineering|community|builder|member|volunteer)\b",
    re.I,
)

LOCATION_INDICATORS = re.compile(
    r"\b(Area|City|State|Region|District|Province|India|United States|USA|UK|United Kingdom|Canada|Australia|Germany|France|Netherlands|Singapore|UAE|Dubai|Gujarat|Maharashtra|Karnataka|Delhi|Texas|California|New York|Florida|Illinois|London|San Francisco|Austin|Ahmedabad|Mumbai|Bangalore|Bengaluru|Pune|Hyderabad|Chennai|Kolkata|Europe|Asia|Americas|Middle East|Worldwide|Global|APAC|EMEA|North America|South America|Africa)\b",
    re.I,
)

FOREIGN_LOCATIONS = re.compile(
    r"\b(United States|USA|U\.S\.A\.|United Kingdom|UK|U\.K\.|London|UAE|Dubai|Abu Dhabi|United Arab Emirates|Canada|Toronto|Vancouver|Australia|Sydney|Melbourne|Germany|Berlin|Munich|France|Paris|Singapore|Netherlands|Amsterdam|Switzerland|Sweden|Ireland|Dublin|Philippines|Pakistan|Karachi|Lahore|Bangladesh|Dhaka|Nigeria|Lagos|South Africa|Europe|Asia|Americas|Middle East|North America|South America|Africa|EMEA|APAC)\b",
    re.I,
)

FOREIGN_SUBDOMAINS_FOR_INDIA = {
    "ae", "uk", "ca", "au", "de", "fr", "sg", "nl", "ch", "se", "ie", "nz",
    "ph", "pk", "bd", "ng", "za", "br", "mx", "es", "it", "at", "be", "dk"
}


def tidy(v: Any) -> str:
    return re.sub(r"\s*(\.{3}|\u2026)\s*$", "", str(v or "")).strip()


def extract_location_from_snippet(snip: str, default_location: str = "") -> str:
    # 1. Explicit "Location: X"
    m_loc = re.search(r"Location:\s*([A-Za-z0-9\s,.-]+?)(?=\s*(?:[|·•\n]|\bconnections\b|Experience:|$))", snip, re.I)
    if m_loc:
        cand = m_loc.group(1).strip()
        if (
            len(cand) >= 2
            and not NON_LOCATION_WORDS.search(cand)
            and not ROLE_WORDS.search(cand)
            and not TITLE_WORDS.search(cand)
            and (LOCATION_INDICATORS.search(cand) or "," in cand)
        ):
            return cand

    # 2. Look for middots with geographic keywords: · Greater Ahmedabad Area ·
    m_mid = re.findall(r"[·•]\s*([A-Z][A-Za-z\s,.-]{2,45}?)\s*[·•]", snip)
    for cand in m_mid:
        cand = cand.strip()
        if (
            not NON_LOCATION_WORDS.search(cand)
            and not ROLE_WORDS.search(cand)
            and not TITLE_WORDS.search(cand)
            and LOCATION_INDICATORS.search(cand)
        ):
            return cand

    # 3. Look for City, State / Country in snippet (must match known geographic indicator)
    m_geo = re.search(r"\b([A-Z][a-zA-Z\s]+,\s*[A-Z][a-zA-Z\s]+(?:Area|India|United States|USA|UK|Canada|Australia|Germany)?)\b", snip)
    if m_geo:
        cand = m_geo.group(1).strip()
        if (
            len(cand.split()) <= 5
            and not NON_LOCATION_WORDS.search(cand)
            and not ROLE_WORDS.search(cand)
            and not TITLE_WORDS.search(cand)
            and LOCATION_INDICATORS.search(cand)
        ):
            return cand

    # 4. If search location is mentioned in snippet, use default_location
    if default_location:
        for part in [p.strip() for p in re.split(r"[,/]+", default_location) if len(p.strip()) > 2]:
            if re.search(r"\b" + re.escape(part) + r"\b", snip, re.I):
                return default_location

    return ""


def parse_result(r: Dict[str, str], default_location: str = "") -> Optional[Dict[str, str]]:
    link = r.get("url") or ""
    if not re.search(r"linkedin\.com/in/", link, re.I):
        return None
    raw_title = str(r.get("title") or "")
    # If search engines glued multiple profiles with ... or …, take the first profile segment
    if "..." in raw_title or "…" in raw_title:
        raw_title = re.split(r"(?:\.{2,3}|\u2026)", raw_title)[0].strip()
    clean = re.sub(r"\s*[|\-\u2013]\s*LinkedIn.*$", "", raw_title, flags=re.I).strip()
    
    parts = [x.strip() for x in re.split(r"\s+[-\u2013|]\s+", clean) if x.strip()]
    if not parts:
        return None

    full_name = parts[0]
    full_name = re.sub(r"^[↳\s*•·]+", "", full_name).strip()
    full_name = re.sub(r"\s*\((?:he/him|she/her|they/them)\)", "", full_name, flags=re.I).strip()
    snip = str(r.get("snippet") or "")

    title = ""
    company = ""

    rem_parts = parts[1:]
    if len(rem_parts) == 1:
        p = rem_parts[0]
        m_at = re.search(r"^(.*?)\s+(?:at|@)\s+(.+)$", p, re.I)
        if m_at:
            title = m_at.group(1).strip()
            company = m_at.group(2).strip()
        else:
            if TITLE_WORDS.search(p):
                title = p
            else:
                company = p
    elif len(rem_parts) >= 2:
        p1, p2 = rem_parts[0], rem_parts[1]
        p1_has_title = bool(TITLE_WORDS.search(p1))
        p2_has_title = bool(TITLE_WORDS.search(p2))

        if p1_has_title and not p2_has_title:
            title = p1
            company = p2
        elif p2_has_title and not p1_has_title:
            company = p1
            title = p2
        else:
            title = p1
            company = p2

    if company.startswith("↳"):
        company = re.sub(r"^[↳\s*•·]+", "", company).strip()
    if title.startswith("↳"):
        title = re.sub(r"^[↳\s*•·]+", "", title).strip()

    # Check if title is formatted strictly as "Role, Company" (e.g., "CEO, Ajmera Infotech Inc.")
    m_comma_title = re.match(r"^(CEO|CTO|COO|CFO|CMO|CIO|CRO|CCO|Founder|Co-Founder|Co-founder|Owner|President|VP|Vice President|Director|Managing Director),\s+([A-Za-z0-9&.,'’ -]{2,50})$", title, re.I)
    if m_comma_title:
        cand = m_comma_title.group(2).strip()
        if not (cand.startswith("&") or cand.lower().startswith("and ") or ROLE_WORDS.search(cand) or TITLE_WORDS.search(cand)):
            title = m_comma_title.group(1).strip()
            if not company or GENERIC_COMPANY_TERMS.match(company) or len(company) <= 2:
                company = cand

    # If company was accidentally populated by a role keyword
    if company.lower() in ("owner", "founder", "co-founder", "ceo", "cto", "coo", "cfo", "director", "president", "managing director", "partner", "executive"):
        company = ""

    # Look into snippet for company if missing or generic
    if not company or GENERIC_COMPANY_TERMS.match(company) or len(company) <= 2:
        # Check "Experience: Company"
        m_exp = re.search(r"Experience:\s*([A-Za-z0-9&.,'’ -]{2,40}?)(?=\s*(?:[·•|\n]|--|\bLocation:|\bconnections\b|$))", snip, re.I)
        if m_exp:
            c_cand = m_exp.group(1).strip()
            if not GENERIC_COMPANY_TERMS.match(c_cand) and len(c_cand) > 2:
                company = c_cand

        # Check "CEO of Company" or "Founder of Company"
        if not company or GENERIC_COMPANY_TERMS.match(company) or len(company) <= 2:
            m_of = re.search(r"\b(?:CEO|Founder|Owner|President|Director|VP|COO|CTO)\b[^\n|·•]*?\bof\s+([A-Za-z0-9&.,'’ -]{2,40}?)(?=\s*(?:[|·•\n,]|\(|\ba\b|\ban\b|\bthe\b|\bwhich\b|\bwhere\b|$))", snip, re.I)
            if m_of:
                c_cand = m_of.group(1).strip()
                if not GENERIC_COMPANY_TERMS.match(c_cand) and len(c_cand) > 2:
                    company = c_cand

        # Check "CEO at Company"
        if not company or GENERIC_COMPANY_TERMS.match(company) or len(company) <= 2:
            m_at = re.search(r"\b(?:CEO|Founder|Owner|President|Director|VP|COO|CTO|Lead)\b[^\n|·•]*?\bat\s+([A-Za-z0-9&.,'’ -]{2,40}?)(?=\s*(?:[|·•\n,]|\(|\bwith\b|\bhelping\b|\bdelivering\b|\bdriving\b|$))", snip, re.I)
            if m_at:
                c_cand = m_at.group(1).strip()
                if not GENERIC_COMPANY_TERMS.match(c_cand) and len(c_cand) > 2:
                    company = c_cand

        # Check "CEO @ Company"
        if not company or GENERIC_COMPANY_TERMS.match(company) or len(company) <= 2:
            m_snip_at = re.search(r"(?:CEO|Founder|Director|Owner|President|VP|Partner|Lead)[^@\n]*@\s*([A-Za-z0-9&.,'’ -]{2,40}?)(?=\s*(?:[|·•\n]|\(|$))", snip, re.I)
            if m_snip_at:
                c_cand = m_snip_at.group(1).strip()
                if not GENERIC_COMPANY_TERMS.match(c_cand) and len(c_cand) > 2:
                    company = c_cand

    # Clean company name
    company = re.split(r"\s*[|·•]+\s*", company)[0].strip()
    if "..." in company or "…" in company:
        company = re.split(r"(?:\.{2,3}|\u2026)\s*", company)[-1].strip()
    m_at_comp = re.search(r"(?:at|@)\s*([A-Za-z0-9&.,'’ -]{2,40})", company, re.I)
    if m_at_comp:
        company = m_at_comp.group(1).strip()
    company = re.sub(r"[\s.]*(?:\.{2,3}|\u2026).*$", "", company).strip()
    company = re.sub(r"^(at|@)\s*", "", company, flags=re.I).strip()
    company = re.sub(r"\s+(?:LinkedIn.*|Area|Region)$", "", company, flags=re.I).strip()

    # If title has @Company or at Company (e.g. "Founder & CEO @Technource")
    m_at_title = re.search(r"^(.*?)\s*[@|at]\s*([A-Za-z0-9&.,'’ -]+)$", title, re.I)
    if m_at_title:
        title = m_at_title.group(1).strip()
        comp_from_title = m_at_title.group(2).strip()
        if not company or GENERIC_COMPANY_TERMS.match(company) or len(company) <= 2:
            company = comp_from_title

    # Validate that company is not actually a job title (e.g. "Solutions Architect", "COO") or discipline
    company = re.sub(r"^(?:and|&|\band\b|nd)\s+", "", company, flags=re.I).strip()
    has_company_suffix = bool(re.search(r"\b(Technologies|Software|Pvt|Ltd|Inc|LLC|Corp|Group|Labs|Media|Holdings|Ventures|Enterprises|Studio|Agency|Network)\b|\bSolutions\s+(?:Pvt|Ltd|LLC|Inc|Private|Company)", company, re.I))
    if (ROLE_WORDS.search(company) or DISCIPLINE_TERMS.search(company) or TITLE_WORDS.search(company)) and not has_company_suffix:
        company = ""

    # Validate that company is not just a geographic entity
    if LOCATION_INDICATORS.search(company) and not has_company_suffix:
        company = ""

    profile_url = link.split("?")[0].rstrip("/")
    location = extract_location_from_snippet(snip, default_location)
    if DISCIPLINE_TERMS.search(location):
        location = default_location

    title = clean_title(title)

    return {
        "full_name": full_name,
        "title": title,
        "company": company,
        "profile_url": profile_url,
        "location": location,
        "raw_title": raw_title,
        "snippet": snip,
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
        if self.config.country:
            parts.append(self.config.country.strip())
        return " ".join(parts)

    def is_india_target(self) -> bool:
        c = (self.config.country or "").lower().strip()
        s = (self.config.state or "").lower().strip()
        ci = (self.config.city or "").lower().strip()
        if c in ("india", "in"):
            return True
        indian_states = {"gujarat", "maharashtra", "karnataka", "delhi", "tamil nadu", "telangana", "haryana", "uttar pradesh", "rajasthan", "punjab", "kerala", "west bengal", "madhya pradesh"}
        indian_cities = {"ahmedabad", "surat", "vadodara", "rajkot", "gandhinagar", "mumbai", "pune", "bangalore", "bengaluru", "delhi", "new delhi", "noida", "gurgaon", "gurugram", "hyderabad", "chennai", "kolkata", "jaipur", "indore"}
        return s in indian_states or ci in indian_cities

    def matches_location_preference(self, parsed: Dict[str, str]) -> bool:
        user_city = (self.config.city or "").strip().lower()
        user_state = (self.config.state or "").strip().lower()
        user_country = (self.config.country or "").strip().lower()

        if not user_city and not user_state and not user_country:
            return True

        url = (parsed.get("profile_url") or "").lower()
        loc = (parsed.get("location") or "").lower()
        snip = (parsed.get("snippet") or "").lower()
        title = (parsed.get("title") or "").lower()
        raw_title = (parsed.get("raw_title") or "").lower()
        full_text = f"{loc} {snip} {title} {raw_title}"

        is_target_india = self.is_india_target()

        # 1. Foreign country subdomain rejection
        m_sub = re.search(r"https?://([a-z]{2})\.linkedin\.com/in/", url)
        if m_sub:
            sub = m_sub.group(1)
            if is_target_india:
                if sub in FOREIGN_SUBDOMAINS_FOR_INDIA and sub != "in":
                    # Must have explicit evidence of target city in actual snippet or title, otherwise REJECT
                    if not (user_city and re.search(r"\b" + re.escape(user_city) + r"\b", f"{snip} {title} {raw_title}")):
                        return False
            elif user_country in ("united states", "usa", "us"):
                if sub in ("in", "uk", "ae", "ca", "au", "de", "fr", "sg", "nl"):
                    return False
            elif user_country in ("united kingdom", "uk"):
                if sub not in ("uk", "www"):
                    return False
            elif user_country in ("united arab emirates", "uae"):
                if sub not in ("ae", "www"):
                    return False

        # 2. Rejection of conflicting foreign countries in snippet location or extracted location
        if is_target_india:
            m_exp_loc = re.search(r"Location:\s*([A-Za-z0-9\s,.-]+?)(?=\s*(?:[|·•\n]|\bconnections\b|$))", snip, re.I)
            if m_exp_loc:
                cand_loc = m_exp_loc.group(1).strip()
                if FOREIGN_LOCATIONS.search(cand_loc) and not re.search(r"\b(India|Gujarat|" + re.escape(user_city) + r")\b", cand_loc, re.I):
                    return False
            if loc and FOREIGN_LOCATIONS.search(loc) and not re.search(r"\b(india|gujarat|" + re.escape(user_city) + r")\b", loc):
                return False
        elif user_country in ("united states", "usa", "us"):
            if loc and re.search(r"\b(India|UK|United Kingdom|UAE|Dubai|Canada|Australia|Germany)\b", loc, re.I):
                return False

        # 3. Strict City Filter
        if user_city:
            city_in_loc = bool(re.search(r"\b" + re.escape(user_city) + r"\b", loc))
            city_in_text = bool(re.search(r"\b" + re.escape(user_city) + r"\b", full_text))
            if not city_in_text:
                return False

            other_major_cities = re.compile(
                r"\b(Mumbai|Pune|Bangalore|Bengaluru|Delhi|New Delhi|Hyderabad|Chennai|Kolkata|Jaipur|Indore|London|Dubai|New York|San Francisco|Chicago|Austin|Los Angeles|Seattle)\b",
                re.I
            )
            if other_major_cities.search(loc) and not city_in_loc:
                return False

        # 4. Strict State Filter (if city not specified)
        elif user_state:
            state_in_text = bool(re.search(r"\b" + re.escape(user_state) + r"\b", full_text))
            if not state_in_text:
                return False

        # 5. Strict Country Filter
        elif user_country:
            country_in_text = bool(re.search(r"\b" + re.escape(user_country) + r"\b", full_text))
            if not country_in_text and not is_target_india:
                return False

        return True

    def get_formatted_location(self) -> str:
        parts = []
        if self.config.city:
            parts.append(self.config.city.strip())
        if self.config.state:
            parts.append(self.config.state.strip())
        if self.config.country:
            parts.append(self.config.country.strip())
        return ", ".join(parts) if parts else "Global"

    def build_search_queries(self) -> List[Dict[str, Any]]:
        loc_term = self.build_location_term()
        city_term = self.config.city.strip() if self.config.city else loc_term
        loc_clause = f'"{city_term}"' if city_term else ""

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

        is_india = self.is_india_target()
        primary_domain = "in.linkedin.com/in" if is_india else "linkedin.com/in"

        queries = []
        for kw in self.config.keywords:
            kw_clean = kw.strip()
            if not kw_clean:
                continue
            kw_fmt = f'"{kw_clean}"' if " " in kw_clean else kw_clean

            # Format 1: Direct domain search with full location
            for s_title in simple_title_clauses:
                q_direct = f"linkedin.com/in {kw_clean} {s_title} {loc_term}".strip()
                queries.append({
                    "keyword": kw_clean,
                    "query": q_direct,
                    "page": 1,
                    "search_id": f"{kw_clean}|direct|{s_title[:15]}",
                })

            # Format 2: site: dork on primary domain
            for t_clause in title_clauses:
                parts = [f"site:{primary_domain}", kw_fmt]
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

            # Format 3: site:in.linkedin.com/in with plain terms
            if is_india and loc_clause:
                for s_title in simple_title_clauses:
                    q_in = f"site:in.linkedin.com/in {kw_clean} {s_title} {city_term}".strip()
                    queries.append({
                        "keyword": kw_clean,
                        "query": q_in,
                        "page": 1,
                        "search_id": f"{kw_clean}|site_in|{s_title[:15]}",
                    })

        return queries

    def accept_profile(self, parsed: Dict[str, str], query_meta: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not parsed or not parsed.get("profile_url") or not parsed.get("full_name"):
            return None

        full_name = parsed.get("full_name", "").strip()
        # Filter directory / list pages or invalid person names
        if (
            LOCATION_INDICATORS.search(full_name)
            or re.search(r"\b(Top|Best|Profiles|Founders|Companies|Community|Members|Directory|List)\b", full_name, re.I)
            or len(full_name.split()) > 4
            or len(full_name) <= 2
        ):
            return None

        url_key = parsed["profile_url"].lower().rstrip("/")
        if url_key in self.seen_urls:
            return None

        title = parsed.get("title", "").strip()
        company = parsed.get("company", "").strip()
        loc = parsed.get("location", "").strip()

        if BAD_TITLE.search(title):
            return None

        # Ensure title is actually a decision-maker title
        if not TITLE_WORDS.search(title) and not any(k in title.lower() for k in ("chief", "head", "lead", "principal", "manager")):
            return None

        # Do not accept generic terms, slogans, or role keywords as company name
        has_company_suffix = bool(re.search(r"\b(Technologies|Software|Pvt|Ltd|Inc|LLC|Corp|Group|Labs|Media|Holdings|Ventures|Enterprises|Studio|Agency|Network)\b|\bSolutions\s+(?:Pvt|Ltd|LLC|Inc|Private|Company)", company, re.I))
        if (
            not company
            or GENERIC_COMPANY_TERMS.match(company)
            or len(company) <= 2
            or ING_WORDS.match(company)
            or company.lower() in ("owner", "founder", "co-founder", "ceo", "cto", "coo", "cfo", "director", "president", "managing director", "partner", "executive")
            or ((ROLE_WORDS.search(company) or DISCIPLINE_TERMS.search(company)) and not has_company_suffix)
        ):
            return None

        # Strict user-specified location preference check
        if not self.matches_location_preference(parsed):
            return None

        # Canonicalize profile URL to in.linkedin.com if target is India
        profile_url = parsed["profile_url"]
        if self.is_india_target() and re.search(r"https?://[a-z]{2}\.linkedin\.com/in/", profile_url):
            profile_url = re.sub(r"https?://[a-z]{2}\.linkedin\.com/in/", "https://in.linkedin.com/in/", profile_url)

        # Cleanly format verified location
        fmt_loc = self.get_formatted_location()
        user_city = (self.config.city or "").strip()
        if user_city and re.search(r"\b" + re.escape(user_city) + r"\b", loc, re.I):
            loc = fmt_loc
        elif not loc or NON_LOCATION_WORDS.search(loc) or ROLE_WORDS.search(loc) or TITLE_WORDS.search(loc) or len(loc) <= 2:
            loc = fmt_loc

        self.seen_urls.add(url_key)

        return {
            "tab": "Collected",
            "Region": self.config.state or self.config.city or self.config.country or "Global",
            "Segment": query_meta.get("keyword", "General"),
            "Company name": company,
            "Company size": "",
            "Industry": "",
            "Industry source": "",
            "Full name": parsed["full_name"],
            "Title": title or "Executive",
            "Profile URL": profile_url,
            "Location": loc,
            "Contact type": "Decision Maker",
            "Search used": query_meta.get("query", ""),
            "Date collected": datetime.now().strftime("%Y-%m-%d"),
            "Approved": "Yes",
        }

    def run(self) -> List[Dict[str, Any]]:
        queries = self.build_search_queries()
        target = self.config.target_count
        engines = ["ddg", "bing"]
        def_loc = self.build_location_term()

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

                parsed = parse_result(r, default_location="")
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
