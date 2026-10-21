#!/usr/bin/env python3
"""
Targeted Lead Finder & LinkedIn Profile Collector Engine.
Strictly implements the user's authentic 4-step LinkedIn verification algorithm:
  1. DISCOVER: Candidate companies via search engines (DuckDuckGo + Bing)
  2. VERIFY: Company's own LinkedIn data (Industry, Size, Headquarters, Website)
             Verified strictly against criteria. Nothing is guessed.
  3. DECISION MAKER: Discovered and verified only for companies that passed Step 2.
  4. STOP: Immediately once target limit is reached, or report exact verified count.
Zero synthetic, dummy, or catalog data.
"""
from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import random
import re
import sys
import tempfile
import threading
import time
import unicodedata
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
import requests
from bs4 import BeautifulSoup

try:
    import backend.linkedin_profile_collector as lpc
except ImportError:
    import linkedin_profile_collector as lpc

logger = logging.getLogger("linkedin_collector")
logger.setLevel(logging.INFO)

# ============================ CONFIG ============================
COMPANY_SEARCH_PAGES = [1, 2, 3]       # result pages per company search
PEOPLE_SEARCH_PAGES = [1, 2]           # result pages per people search
CACHE_FILE = "targeted_cache.json"     # verified company facts + decision makers (criteria independent)
FETCH_COMPANY_PAGE = True              # try the public LinkedIn company page
DEFAULT_TITLES = [
    "Owner", "Co-Owner", "Proprietor", "Founder", "Co-Founder", "CEO",
    "Chief Executive Officer", "President", "Managing Director", "MD", "Director",
    "Executive Director", "General Manager", "COO", "Chief Operating Officer",
    "CTO", "Chief Technology Officer", "Partner", "Managing Partner", "VP", "Vice President"
]
# ================================================================

COLUMNS = [
    "Company name",
    "Company website",
    "Company LinkedIn URL",
    "Industry",
    "Company size",
    "Headquarters",
    "Decision maker name",
    "Decision maker title",
    "Decision maker LinkedIn URL",
    "DM confidence",
    "Other decision makers",
    "Company data source",
    "Date collected",
]


# --------------------------------------------------------------------------- text helpers
def nt(s: Any) -> str:
    s = "".join(c for c in unicodedata.normalize("NFKD", str(s or "")) if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", s.lower().replace("&", " and "))).strip()


def stem(t: str) -> str:
    return t[:-1] if len(t) > 3 and t.endswith("s") and not t.endswith("ss") else t


def has_phrase(hay_norm: str, phrase_norm: str) -> bool:
    return bool(phrase_norm) and re.search(rf"(?<![a-z0-9]){re.escape(phrase_norm)}(?![a-z0-9])", hay_norm) is not None


def split_list(s: Any) -> List[str]:
    if isinstance(s, list):
        return [str(x).strip() for x in s if str(x).strip()]
    return [x.strip() for x in re.split(r"[,;\n]+", str(s or "")) if x.strip()]


SUFFIX = {
    "inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation",
    "co", "company", "llp", "lp", "plc", "pllc", "pc", "the", "dba"
}

GENERIC_WORDS = {
    "smoke", "shop", "shops", "store", "stores", "vape", "vapes", "tobacco", "cigar", "cigars",
    "hookah", "market", "mini", "mart", "convenience", "wholesale", "supply", "supplies", "discount",
    "liquor", "deli", "grocery", "gas", "station", "food", "foods", "and", "usa", "us", "new", "best",
    "smoking", "mobile", "express", "plus", "city", "town", "super", "one", "first", "general"
}


def company_phrase(name: str) -> str:
    return " ".join(t for t in nt(name).split() if t not in SUFFIX)


def display_company(name: str) -> str:
    cleaned = re.sub(
        r"[,\s]+(private\s+limited|pvt\.?\s*ltd\.?|pvt\.?|inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|corporation|company|incorporated)\.?$",
        "",
        str(name or "").strip(),
        flags=re.I,
    ).strip()
    return cleaned or str(name or "").strip()


def same_company(a: str, b: str) -> bool:
    na, nb = lpc.norm_company(a), lpc.norm_company(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    s, l = sorted((na, nb), key=len)
    return len(s) >= 5 and s in l and len(s) / len(l) >= 0.75


def is_generic_name(name: str) -> bool:
    toks = company_phrase(name).split()
    return bool(toks) and (all(t in GENERIC_WORDS for t in toks) or (len(toks) == 1 and len(toks[0]) < 4))


# --------------------------------------------------------------------------- geography
US_STATES = {
    "AL": "alabama", "AK": "alaska", "AZ": "arizona", "AR": "arkansas", "CA": "california", "CO": "colorado",
    "CT": "connecticut", "DE": "delaware", "FL": "florida", "GA": "georgia", "HI": "hawaii", "ID": "idaho",
    "IL": "illinois", "IN": "indiana", "IA": "iowa", "KS": "kansas", "KY": "kentucky", "LA": "louisiana",
    "ME": "maine", "MD": "maryland", "MA": "massachusetts", "MI": "michigan", "MN": "minnesota",
    "MS": "mississippi", "MO": "missouri", "MT": "montana", "NE": "nebraska", "NV": "nevada",
    "NH": "new hampshire", "NJ": "new jersey", "NM": "new mexico", "NY": "new york", "NC": "north carolina",
    "ND": "north dakota", "OH": "ohio", "OK": "oklahoma", "OR": "oregon", "PA": "pennsylvania",
    "RI": "rhode island", "SC": "south carolina", "SD": "south dakota", "TN": "tennessee", "TX": "texas",
    "UT": "utah", "VT": "vermont", "VA": "virginia", "WA": "washington", "WV": "west virginia",
    "WI": "wisconsin", "WY": "wyoming", "DC": "district of columbia",
}
STATE_BY_NAME = {v: k for k, v in US_STATES.items()}

COUNTRIES = {
    "united states": ({"united states", "united states of america", "usa", "america"}, "US"),
    "united kingdom": ({"united kingdom", "great britain", "england", "scotland", "wales", "uk"}, "GB"),
    "canada": ({"canada"}, "CA"),
    "india": ({"india"}, "IN"),
    "australia": ({"australia"}, "AU"),
    "germany": ({"germany", "deutschland"}, "DE"),
    "france": ({"france"}, "FR"),
    "italy": ({"italy"}, "IT"),
    "spain": ({"spain"}, "ES"),
    "netherlands": ({"netherlands", "holland"}, "NL"),
    "ireland": ({"ireland"}, "IE"),
    "mexico": ({"mexico"}, "MX"),
    "brazil": ({"brazil"}, "BR"),
    "united arab emirates": ({"united arab emirates", "uae"}, "AE"),
    "singapore": ({"singapore"}, "SG"),
    "pakistan": ({"pakistan"}, "PK"),
    "new zealand": ({"new zealand"}, "NZ"),
    "south africa": ({"south africa"}, "ZA"),
}


def resolve_country(raw: str) -> Tuple[str, Set[str], str]:
    n = nt(raw)
    if not n:
        return "", set(), ""
    if n in ("us", "usa", "u s", "u s a"):
        n = "united states"
    if n in ("uk", "gb"):
        n = "united kingdom"
    for canon, (names, code) in COUNTRIES.items():
        if n == canon or n in names:
            return canon, names | {canon}, code
    return n, {n}, ""


@dataclass
class Criteria:
    industries: list                      # LinkedIn industry names / words to verify, e.g. ["Tobacco Manufacturing"]
    keywords: list = field(default_factory=list)   # discovery search terms (default = industries)
    country: str = ""
    state: str = ""
    city: str = ""
    size_min: int = 1
    size_max: Optional[int] = None        # None = no upper bound
    limit: int = 100
    size_mode: str = "contained"          # 'contained' = LinkedIn size band must lie fully inside range
    require_dm: bool = True               # only count companies where a decision maker was verified
    titles: list = field(default_factory=lambda: list(DEFAULT_TITLES))

    def __post_init__(self):
        self.keywords = self.keywords or list(self.industries)
        self.city_n = nt(self.city)
        r = self.state.strip()
        if r.upper() in US_STATES:
            self.st_abbr, self.st_full = r.upper(), US_STATES[r.upper()]
        else:
            self.st_abbr, self.st_full = STATE_BY_NAME.get(nt(r), ""), nt(r)
        self.country_canon, self.country_names, self.country_code = resolve_country(self.country)
        if not (self.city or self.state or self.country):
            # Default to worldwide/US if completely blank
            self.country = "United States"
            self.country_canon, self.country_names, self.country_code = resolve_country(self.country)
        if not self.industries:
            self.industries = list(self.keywords) if self.keywords else ["Technology"]

    def signature(self) -> Dict[str, Any]:
        return {
            "industries": self.industries,
            "keywords": self.keywords,
            "country": self.country,
            "state": self.state,
            "city": self.city,
            "size": [self.size_min, self.size_max],
            "size_mode": self.size_mode,
            "titles": self.titles,
        }


def parse_size_arg(s: Any) -> Tuple[int, Optional[int]]:
    """'11-50' | '50+' | '<=50' | 'up to 50' | '10 to 100' | '11-50, 51-200' -> (min, max|None)."""
    if not s or str(s).lower() == "all":
        return 1, None
    t = re.sub(r"(\d),(\d{3})", r"\1\2", str(s or "").lower())
    ranges = [(int(x), int(y)) for x, y in re.findall(r"(\d+)\s*(?:-|\u2013|to)\s*(\d+)", t)]
    if ranges:
        return min(r[0] for r in ranges), max(r[1] for r in ranges)
    m = re.search(r"(\d+)\s*\+", t) or re.search(r"(?:at least|minimum|min|over|>=|>)\s*(\d+)", t)
    if m:
        return int(m.group(1)), None
    m = re.search(r"(?:up to|maximum|max|under|<=|<)\s*(\d+)", t)
    if m:
        return 1, int(m.group(1))
    return 1, None


def parse_size_text(text: str, need_word: bool = True) -> Optional[Tuple[int, Optional[int]]]:
    """LinkedIn size text -> (lo, hi|None) or None.  '11-50 employees', '10,001+ employees'."""
    t = re.sub(r"(\d),(\d{3})", r"\1\2", str(text or ""))
    w = r"\s*employees" if need_word else ""
    m = re.search(rf"(\d+)\s*(?:-|\u2013|to)\s*(\d+){w}", t, re.I)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(rf"(\d+)\s*\+{w}", t, re.I)
    if m:
        return int(m.group(1)), None
    return None


def size_ok(rng: Optional[Tuple[int, Optional[int]]], crit: Criteria) -> bool:
    if not rng:
        return False
    lo, hi = rng
    cmax = crit.size_max
    if crit.size_mode == "overlap":
        return (hi is None or hi >= crit.size_min) and (cmax is None or lo <= cmax)
    return lo >= crit.size_min and (cmax is None or (hi is not None and hi <= cmax))


def industry_ok(industry: str, crit: Criteria) -> bool:
    if not industry:
        return False
    ind = " ".join(stem(t) for t in nt(industry).split())
    for phrase in crit.industries:
        toks = [stem(t) for t in nt(phrase).split() if t not in ("and", "of", "the", "in")]
        if toks and all(has_phrase(ind, t) for t in toks):
            return True
    return False


def location_ok(info: Dict[str, Any], crit: Criteria) -> Tuple[bool, str]:
    hq = info.get("hq") or ""
    if not hq:
        return False, "headquarters not verified"
    hq_n = nt(hq)
    if crit.city and not has_phrase(hq_n, crit.city_n):
        return False, f"HQ city differs ({hq})"
    state_hit = False
    if crit.state:
        state_hit = bool(
            (crit.st_full and has_phrase(hq_n, crit.st_full))
            or (crit.st_abbr and re.search(rf"\b{crit.st_abbr}\b", hq))
        )
        if not state_hit:
            return False, f"HQ state differs ({hq})"
    if crit.country:
        confirmed = any(has_phrase(hq_n, n) for n in crit.country_names) or (
            crit.country_code and info.get("country_code", "").upper() == crit.country_code
        )
        if not confirmed and crit.country_canon == "united states":
            confirmed = (
                state_hit
                or any(has_phrase(hq_n, v) for v in US_STATES.values())
                or bool(re.search(r"\b(" + "|".join(US_STATES) + r")\b", hq))
            )
        if not confirmed:  # infer from city/state only if no OTHER country is named
            other = any(
                has_phrase(hq_n, n)
                for c, (names, _) in COUNTRIES.items()
                if c != crit.country_canon
                for n in names
            )
            code_other = (
                info.get("country_code")
                and crit.country_code
                and info["country_code"].upper() != crit.country_code
            )
            confirmed = (state_hit or bool(crit.city)) and not other and not code_other
        if not confirmed:
            return False, f"HQ country not confirmed ({hq})"
    return True, ""


def evaluate_company(info: Dict[str, Any], crit: Criteria) -> Tuple[bool, str]:
    if not info or not info.get("industry"):
        return False, "industry not verified"
    if not industry_ok(info["industry"], crit):
        return False, f"industry mismatch ({info['industry']})"
    rng = info.get("size_range")
    if not rng:
        return False, "company size not verified"
    if not size_ok(rng, crit):
        return False, f"size mismatch ({info.get('size_text')})"
    return location_ok(info, crit)


# --------------------------------------------------------------------------- LinkedIn company data
_fail = 0
_lock = threading.Lock()


def new_info() -> Dict[str, Any]:
    return {
        "slug": "",
        "li_name": "",
        "url": "",
        "industry": "",
        "size_text": "",
        "size_range": None,
        "hq": "",
        "country_code": "",
        "website": "",
        "source": "",
        "page_tried": False,
        "apify_tried": False,
        "ambiguous": False,
    }


def clean_website(u: Any) -> str:
    u = str(u or "").strip()
    if not u:
        return ""
    if not re.match(r"https?://", u, re.I):
        u = "http://" + u
    host = re.sub(r"^www\.", "", (re.match(r"https?://([^/?#]+)", u, re.I) or [None, ""])[1].lower())
    if not host or "." not in host or any(x in host for x in ("linkedin.com", "facebook.com", "instagram.com")):
        return ""
    return re.split(r"[?#]", u)[0].rstrip("/")


def parse_company_page(html: str) -> Dict[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    out = {"industry": "", "size_text": "", "hq": "", "website": "", "country_code": ""}
    labels = {"industry": "industry", "company size": "size_text", "headquarters": "hq", "website": "website"}
    for dt in soup.find_all("dt"):
        key = labels.get(dt.get_text(" ", strip=True).lower())
        dd = dt.find_next("dd")
        if key and dd and not out[key]:
            a = dd.find("a", href=True) if key == "website" else None
            out[key] = (a["href"] if a else dd.get_text(" ", strip=True)).strip()
    for sel, key in (
        ('[data-test-id="about-us__industry"] dd', "industry"),
        ('[data-test-id="about-us__size"] dd', "size_text"),
        ('[data-test-id="about-us__headquarters"] dd', "hq"),
    ):
        el = soup.select_one(sel)
        if el and not out[key]:
            out[key] = el.get_text(" ", strip=True)
    for sc in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(sc.string or "")
        except Exception:
            continue
        items = data.get("@graph", [data]) if isinstance(data, dict) else data
        for it in items if isinstance(items, list) else []:
            addr = it.get("address") if isinstance(it, dict) else None
            if isinstance(addr, dict):
                ctry = str(addr.get("addressCountry") or "")
                if len(ctry) == 2 and not out["country_code"]:
                    out["country_code"] = ctry.upper()
                if not out["hq"]:
                    out["hq"] = ", ".join(
                        str(addr.get(k)) for k in ("addressLocality", "addressRegion", "addressCountry") if addr.get(k)
                    )
    out["website"] = clean_website(out["website"])
    return out


def fetch_page(slug: str) -> Optional[Dict[str, str]]:
    global _fail
    with _lock:
        if _fail >= 5:
            return None
    try:
        r = requests.get(
            f"https://www.linkedin.com/company/{slug}/",
            timeout=25,
            headers={"User-Agent": random.choice(lpc.UA), "Accept-Language": "en-US,en;q=0.9"},
        )
        ok = r.status_code == 200 and "authwall" not in r.url
    except Exception:
        ok, r = False, None
    parsed = parse_company_page(r.text) if (ok and r is not None) else None
    with _lock:
        _fail = 0 if parsed and (parsed["industry"] or parsed["hq"]) else _fail + 1
    return parsed


def apply_fields(info: Dict[str, Any], d: Dict[str, Any], source: str):
    """Fill ONLY empty fields; remember where the data came from."""
    changed = False
    for k in ("industry", "hq", "website", "country_code"):
        if d.get(k) and not info[k]:
            info[k] = d[k]
            changed = True
    if d.get("size_text") and not info["size_range"]:
        rng = parse_size_text(d["size_text"], need_word=False)
        if rng:
            info["size_text"], info["size_range"] = d["size_text"], list(rng)
            changed = True
    if changed and source not in info["source"]:
        info["source"] = (info["source"] + " + " if info["source"] else "") + source


def snippet_fields(text: str) -> Dict[str, str]:
    ind, size = lpc.parse_company_text(text)
    hq = re.search(
        r"Headquarters:?\s*([A-Z][^\u00b7|\n]{2,60}?)(?=\s*(?:[.\u00b7|\n]|Founded|Company size|Industry|$))",
        text or "",
    )
    return {"industry": ind, "size_text": size, "hq": hq.group(1).strip() if hq else ""}


def li_title_name(title: str) -> str:
    t = re.sub(r"\s*[|\-\u2013]\s*LinkedIn.*$", "", str(title or ""), flags=re.I)
    return re.split(r"\s+\|\s+|\s+[-\u2013]\s+", t)[0].strip()


def find_company_page(name: str, crit: Criteria, order: List[str]) -> Tuple[str, str, str, bool, bool]:
    """-> (slug, li_name, snippet_text, ambiguous, failed)"""
    loc = crit.city or crit.state or ""
    res = lpc.run_search(
        f'site:linkedin.com/company "{display_company(name)}" {loc}'.strip(),
        1,
        order,
        must=r"linkedin\.com/company/",
    )
    if res is None:
        return "", "", "", False, True
    hits = {}
    for x in res:
        m = re.search(r"linkedin\.com/company/([^/?#]+)", x.get("url", ""), re.I)
        nm = li_title_name(x.get("title", ""))
        if m and same_company(nm, name):
            hits.setdefault(m.group(1).lower(), (nm, f"{x.get('title', '')} . {x.get('snippet', '')}"))
    if not hits:
        return "", "", "", False, False
    if len(hits) > 1:
        pref = [
            s
            for s, (_, t) in hits.items()
            if (crit.city_n and has_phrase(nt(t), crit.city_n))
            or (crit.st_full and has_phrase(nt(t), crit.st_full))
        ]
        if len(pref) == 1:
            hits = {pref[0]: hits[pref[0]]}
        else:
            return "", "", "", True, False
    slug, (nm, text) = next(iter(hits.items()))
    return slug, nm, text, False, False


def get_company_info(cand: Dict[str, Any], cache: Dict[str, Any], crit: Criteria, idx: int) -> Tuple[Dict[str, Any], bool]:
    """Runs in a worker thread. Returns (info, retry_later)."""
    ent = cache.get(lpc.norm_company(cand["name"]), {})
    info = ent.get("info") or new_info()
    done = lambda: info["industry"] and info["size_range"] and info["hq"]
    if done():
        return info, False
    order = lpc.ENGINES[idx % len(lpc.ENGINES):] + lpc.ENGINES[:idx % len(lpc.ENGINES)]
    if not info["slug"] and not info["ambiguous"]:
        if cand.get("slug"):
            info["slug"], info["li_name"] = cand["slug"], cand.get("li_name", "")
            apply_fields(info, snippet_fields(cand.get("snippet", "")), "LinkedIn (search result)")
        else:
            slug, nm, text, amb, failed = find_company_page(cand["name"], crit, order)
            if failed:
                return info, True
            info.update(slug=slug, li_name=nm, ambiguous=amb)
            if slug:
                apply_fields(info, snippet_fields(text), "LinkedIn (search result)")
            time.sleep(random.uniform(*lpc.DELAY_RANGE))
    if info["slug"]:
        info["url"] = f"https://www.linkedin.com/company/{info['slug']}"
        if not done() and FETCH_COMPANY_PAGE and not info["page_tried"]:
            d = fetch_page(info["slug"])
            if d is not None:
                info["page_tried"] = True
                apply_fields(info, d, "LinkedIn (company page)")
            time.sleep(random.uniform(*lpc.DELAY_RANGE))
    return info, False


def _first(o: Dict[str, Any], keys: List[str]) -> Any:
    for k in keys:
        v = o.get(k)
        if v:
            return v
    return ""


def apify_batch(infos: List[Dict[str, Any]]):
    """Optional Apify enrichment if configured."""
    todo = [
        i
        for i in infos
        if i["slug"] and not (i["industry"] and i["size_range"] and i["hq"]) and not i["apify_tried"]
    ]
    if not lpc.APIFY_TOKEN or not todo:
        return
    for k in range(0, len(todo), 25):
        batch = todo[k:k + 25]
        urls = [f"https://www.linkedin.com/company/{i['slug']}" for i in batch]
        try:
            r = requests.post(
                f"https://api.apify.com/v2/acts/{lpc.APIFY_ACTOR}/run-sync-get-dataset-items",
                params={"token": lpc.APIFY_TOKEN},
                json={"companyUrls": urls, "maxCompanies": len(urls)},
                timeout=320,
            )
            items = r.json() if r.ok else []
        except Exception as e:
            print("  apify error:", e)
            items = []
        by = {}
        for o in items if isinstance(items, list) else []:
            m = re.search(
                r"company/([^/?#]+)",
                str(
                    o.get("linkedinUrl")
                    or o.get("canonicalUrl")
                    or o.get("url")
                    or o.get("inputUrl")
                    or ""
                ),
                re.I,
            )
            if m:
                by[m.group(1).lower()] = o
        for i in batch:
            i["apify_tried"] = True
            o = by.get(i["slug"])
            if not o:
                continue
            hq = _first(o, ["headquarters", "headquarter", "hq", "location"])
            if isinstance(hq, dict):
                hq = ", ".join(
                    str(hq.get(k)) for k in ("city", "geographicArea", "state", "country") if hq.get(k)
                )
            elif isinstance(hq, list):
                hq = str(hq[0]) if hq else ""
            apply_fields(
                i,
                {
                    "industry": lpc._apify_industry(o),
                    "size_text": lpc._apify_size(o),
                    "hq": str(hq or ""),
                    "website": clean_website(_first(o, ["website", "websiteUrl", "companyWebsite"])),
                },
                "LinkedIn (Apify)",
            )


# --------------------------------------------------------------------------- decision makers
def title_rank(text: str, titles: List[str]) -> Optional[int]:
    t = f" {nt(text)} "
    t = re.sub(r"\bmd\b", "managing director", t)
    t = re.sub(r"\bceo\b", "chief executive officer", t)
    t = re.sub(r"\bcoo\b", "chief operating officer", t)
    t = re.sub(r"\bcto\b", "chief technology officer", t)
    t = t.replace(" vice president ", " vp ").replace(" assistant to the president ", " ")
    best = None
    for i, ti in enumerate(titles):
        ti_norm = nt(ti)
        if ti_norm in ("md", "ceo", "coo", "cto"):
            continue
        if f" {ti_norm} " in t:
            best = i if best is None else min(best, i)
    return best


def person_location_status(snippet: str, crit: Criteria) -> str:
    m = re.search(r"Location:\s*([^\u00b7|]+)", snippet or "")
    if not m or not (crit.city or crit.state):
        return "unknown"
    loc_n = nt(m.group(1))
    if crit.city_n and has_phrase(loc_n, crit.city_n):
        return "match"
    if crit.st_full and has_phrase(loc_n, crit.st_full):
        return "match"
    if crit.st_abbr and re.search(rf"\b{crit.st_abbr}\b", m.group(1)):
        return "match"
    return "conflict"


def eval_dm(r: Dict[str, str], names: List[str], crit: Criteria, generic: bool) -> Optional[Dict[str, Any]]:
    parsed = lpc.parse_result(r)
    if not parsed:
        return None
    toks = nt(parsed["full_name"]).split()
    if len(toks) < 2 or {"linkedin", "profile", "profiles"} & set(toks):
        return None
    slug = re.search(r"linkedin\.com/in/([^/?#]+)", parsed["profile_url"], re.I)
    if not slug:
        return None
    head = re.sub(r"\s*[|\-\u2013]\s*LinkedIn\s*$", "", str(r.get("title") or ""), flags=re.I)
    after = " - ".join(re.split(r"\s+[-\u2013]\s+", head)[1:])
    if lpc.BAD_TITLE.search(head) or re.search(r"\b(former|ex)\b", after, re.I):
        return None
    snippet = str(r.get("snippet") or "")
    exp = re.search(r"Experience:\s*([^\u00b7|]+)", snippet, re.I)
    hay = nt(after + " " + (exp.group(1) if exp else "") + " " + (parsed["company"] or ""))
    how = ""
    if parsed["company"] and any(same_company(parsed["company"], n) for n in names):
        how = "field"
    # Strict geographic validation to prevent cross-country mismatch
    url_low = (parsed["profile_url"] or "").lower()
    full_text = (head + " " + snippet).lower()
    if crit.country_code == "US":
        if "in.linkedin.com" in url_low or re.search(r"\b(india|mumbai|delhi|bengaluru|bangalore|pune|hyderabad|ahmedabad|noida|gurgaon)\b", full_text):
            return None
    elif crit.country_code == "IN":
        if any(x in url_low for x in ("uk.linkedin.com", "ca.linkedin.com", "au.linkedin.com")) or re.search(r"\b(united states|usa|united kingdom|london|canada|australia)\b", full_text):
            return None

    if not how:
        return None
    rank = title_rank(parsed["title"] or after, crit.titles)
    if rank is None:
        return None
    loc = person_location_status(snippet, crit)
    if generic and loc != "match":
        return None
    if crit.city and loc == "conflict":
        return None
    conf = (
        "High"
        if how == "field" and loc == "match"
        else ("Medium" if loc != "conflict" else "Low (location differs)")
    )
    clean_url = lpc.clean_linkedin_url(parsed["profile_url"], parsed["full_name"], parsed["company"])
    return {
        "name": parsed["full_name"],
        "title": parsed["title"] or after.split(" - ")[0],
        "url": clean_url,
        "rank": rank,
        "conf": conf,
        "loc": loc,
    }


def find_decision_makers(cand_name: str, info: Dict[str, Any], crit: Criteria, idx: int) -> Tuple[List[Dict[str, Any]], bool]:
    """-> (list of DMs best-first, retry_later)"""
    names = [n for n in (cand_name, info.get("li_name")) if n]
    disp = display_company(cand_name)
    if disp not in names:
        names.append(disp)
    generic = is_generic_name(cand_name)
    loc = crit.city or crit.state or crit.country

    queries = [
        f'site:linkedin.com/in "{disp}" "Director"',
        f'site:linkedin.com/in "{disp}" "CEO"',
        f'site:linkedin.com/in "{disp}" "Founder"',
        f'site:linkedin.com/in "{disp}" "MD"',
        f'site:linkedin.com/in "{disp}" "{loc}"' if loc else None,
        f'site:linkedin.com/in "{disp}"',
    ]
    if cand_name != disp:
        queries.append(f'site:linkedin.com/in "{cand_name}"')
    queries = [q for q in queries if q]

    order = lpc.ENGINES[idx % len(lpc.ENGINES):] + lpc.ENGINES[:idx % len(lpc.ENGINES)]
    failed = False
    for q in queries:
        res = lpc.run_search(q, 1, order)
        time.sleep(random.uniform(*lpc.DELAY_RANGE))
        if res is None:
            failed = True
            continue
        found = {}
        for pos, r in enumerate(res):
            d = eval_dm(r, names, crit, generic)
            if d and (d["url"] not in found or d["rank"] < found[d["url"]]["rank"]):
                d["pos"] = pos
                found[d["url"]] = d
        if found:
            conf_order = {"High": 0, "Medium": 1}
            return (
                sorted(found.values(), key=lambda d: (conf_order.get(d["conf"], 2), d["rank"], d["pos"])),
                False,
            )
    return [], failed


# --------------------------------------------------------------------------- discovery
def build_jobs(crit: Criteria) -> List[Dict[str, Any]]:
    # Location variations: "city, state", "city, state_abbr", "city", "state", "country"
    loc_variants: List[str] = []
    if crit.city and crit.state:
        loc_variants.append(f"{crit.city}, {crit.state}")
        if crit.st_abbr:
            loc_variants.append(f"{crit.city}, {crit.st_abbr}")
    if crit.city and crit.city not in loc_variants:
        loc_variants.append(crit.city)
    if crit.state and crit.state not in loc_variants:
        loc_variants.append(crit.state)
    if not loc_variants:
        loc_variants.append(crit.country or "US")

    # Scale query volume based on requested limit
    max_pages = 5 if crit.limit >= 20 else 3
    pages = list(range(1, max_pages + 1))
    jobs: List[Dict[str, Any]] = []
    seen_q: Set[str] = set()

    for page in pages:
        for kw in crit.keywords:
            for loc in loc_variants:
                q1 = f'site:linkedin.com/company "{kw}" "{loc}"'
                if q1 not in seen_q:
                    seen_q.add(q1)
                    jobs.append({"kind": "company", "page": page, "key": f"co|{kw}|{loc}|p{page}", "q": q1})

                q2 = f'site:linkedin.com/company {kw} {loc}'
                if q2 not in seen_q:
                    seen_q.add(q2)
                    jobs.append({"kind": "company", "page": page, "key": f"co_u|{kw}|{loc}|p{page}", "q": q2})

            # Leadership discovery queries to discover candidate companies
            if page <= 3:
                loc_main = loc_variants[0]
                for role in ("Founder", "CEO", "Director", "President"):
                    pq = f'site:linkedin.com/in "{loc_main}" "{kw}" "{role}"'
                    if pq not in seen_q:
                        seen_q.add(pq)
                        jobs.append({"kind": "people", "page": page, "key": f"ppl|{kw}|{loc_main}|{role}|p{page}", "q": pq})

    return jobs


def candidates_from(job: Dict[str, Any], results: List[Dict[str, str]]) -> List[Dict[str, str]]:
    out = []
    for x in results:
        if job["kind"] == "company":
            m = re.search(r"linkedin\.com/company/([^/?#]+)", x.get("url", ""), re.I)
            nm = li_title_name(x.get("title", ""))
            if m and nm:
                out.append({
                    "name": nm,
                    "slug": m.group(1).lower(),
                    "li_name": nm,
                    "snippet": f"{x.get('title', '')} . {x.get('snippet', '')}",
                })
        else:
            p = lpc.parse_result(x)
            if p and p["company"]:
                out.append({"name": p["company"], "slug": "", "snippet": ""})
    return [c for c in out if len(lpc.norm_company(c["name"])) >= 3]


# --------------------------------------------------------------------------- Collector wrapper class for Web App
@dataclass
class CollectorConfig:
    keywords: List[str]
    country: str = ""
    state: str = ""
    city: str = ""
    target_count: int = 50
    titles: List[str] = field(default_factory=lambda: list(DEFAULT_TITLES))
    company_size_filter: str = "all"
    enrich_company: bool = True
    delay_range: Tuple[float, float] = (0.5, 1.2)


class KeywordLinkedInCollector:
    """
    Web API wrapper around targeted lead finder algorithm.
    Provides live real-time event streaming and cleanly formats Excel export.
    """

    def __init__(self, config: CollectorConfig, on_event: Optional[Callable[[Dict[str, Any]], None]] = None):
        self.config = config
        self.on_event = on_event
        self.stop_requested = threading.Event()
        self.collected_rows: List[Dict[str, Any]] = []

        # Parse criteria from config
        lo, hi = parse_size_arg(config.company_size_filter)
        clean_kws = split_list(config.keywords)
        self.criteria = Criteria(
            industries=clean_kws,
            keywords=clean_kws,
            country=config.country or "",
            state=config.state or "",
            city=config.city or "",
            size_min=lo,
            size_max=hi,
            limit=config.target_count,
            size_mode="contained" if config.company_size_filter != "all" else "overlap",
            require_dm=True,
            titles=config.titles if config.titles else list(DEFAULT_TITLES),
        )

    def emit(self, event_type: str, data: Dict[str, Any]):
        if self.on_event:
            self.on_event({"type": event_type, **data})

    def stop(self):
        self.stop_requested.set()

    def run(self) -> List[Dict[str, Any]]:
        crit = self.criteria
        cache = lpc._load_json(CACHE_FILE) if os.path.exists(CACHE_FILE) else {}
        seen = set()
        total = 0
        rejects = Counter()

        jobs = build_jobs(crit)
        self.emit("query_start", {
            "query": f"Building {len(jobs)} discovery jobs for {', '.join(crit.keywords)}",
            "engine": "ddg",
        })

        ex = ThreadPoolExecutor(max_workers=lpc.WORKERS)

        def search_job(args):
            i, job = args
            order = lpc.ENGINES[i % len(lpc.ENGINES):] + lpc.ENGINES[:i % len(lpc.ENGINES)]
            self.emit("query_start", {
                "query": job["q"],
                "engine": order[0],
            })
            res = lpc.run_search(job["q"], job["page"], order, must=r"linkedin\.com/(company|in)/")
            time.sleep(random.uniform(*crit.signature().get("delay", (0.5, 1.2))))
            return res

        try:
            for start in range(0, len(jobs), lpc.WORKERS * 2):
                if total >= crit.limit or self.stop_requested.is_set():
                    break
                batch = jobs[start:start + lpc.WORKERS * 2]
                results = list(ex.map(search_job, list(enumerate(batch))))
                cands = []
                for job, res in zip(batch, results):
                    if not res:
                        continue
                    for c in candidates_from(job, res):
                        k = lpc.norm_company(c["name"])
                        if k not in seen:
                            seen.add(k)
                            cands.append(c)

                for s in range(0, len(cands), lpc.WORKERS * 4):
                    if total >= crit.limit or self.stop_requested.is_set():
                        break
                    chunk = cands[s:s + lpc.WORKERS * 4]

                    # 1. Company verification
                    got = list(ex.map(lambda a: get_company_info(a[1], cache, crit, a[0]), list(enumerate(chunk))))
                    infos = [g[0] for g in got]
                    apify_batch(infos)

                    passed = []
                    for c, (info, retry) in zip(chunk, got):
                        k = lpc.norm_company(c["name"])
                        if retry:
                            seen.discard(k)
                            continue
                        cache.setdefault(k, {})["info"] = info
                        ok, why = evaluate_company(info, crit)
                        if not ok:
                            rejects[why.split(" (")[0]] += 1
                            continue
                        passed.append((c, info))

                    # 2. Decision Maker search for companies that passed
                    def dm_task(a):
                        i, (c, info) = a
                        ent = cache.get(lpc.norm_company(c["name"]), {})
                        if ent.get("dm") is not None:
                            return ent["dm"], False
                        return find_decision_makers(c["name"], info, crit, i)

                    dms = list(ex.map(dm_task, list(enumerate(passed))))
                    for (c, info), (dm, retry) in zip(passed, dms):
                        k = lpc.norm_company(c["name"])
                        if retry and not dm:
                            seen.discard(k)
                            continue
                        cache[k]["dm"] = dm
                        if not dm and crit.require_dm:
                            rejects["no verified decision maker"] += 1
                            continue
                        if total >= crit.limit or self.stop_requested.is_set():
                            break

                        top = dm[0] if dm else {}
                        others = "; ".join(f"{d['name']} ({d['title']}) {d['url']}" for d in dm[1:3])
                        row_data = {
                            "Company name": info.get("li_name") or c["name"],
                            "Company website": info["website"],
                            "Company LinkedIn URL": info["url"],
                            "Industry": info["industry"],
                            "Company size": info["size_text"],
                            "Headquarters": info["hq"],
                            "Decision maker name": top.get("name", ""),
                            "Decision maker title": top.get("title", ""),
                            "Decision maker LinkedIn URL": top.get("url", ""),
                            "DM confidence": top.get("conf", ""),
                            "Other decision makers": others,
                            "Company data source": info["source"],
                            "Date collected": time.strftime("%Y-%m-%d"),
                            # Compatibility keys for frontend table display:
                            "Full name": top.get("name") or info.get("li_name") or c["name"],
                            "Title": top.get("title") or "Executive",
                            "Location": info["hq"],
                            "Profile URL": top.get("url") or info["url"],
                            "Contact type": top.get("conf") or "Verified Lead",
                        }

                        self.collected_rows.append(row_data)
                        total += 1

                        self.emit("profile_found", {
                            "profile": row_data,
                            "collectedCount": total,
                            "target": crit.limit,
                        })

            self.emit("completed", {
                "message": f"Scraping completed. Found {total} strictly verified leads matching all criteria.",
                "totalCollected": total,
                "target": crit.limit,
            })

        finally:
            ex.shutdown(wait=False, cancel_futures=True)

        return self.collected_rows

    def write_excel(self, out_path: Path | str):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Verified Leads"

        ws.append(COLUMNS)
        for c in ws[1]:
            c.font = Font(name="Arial", size=10, bold=True, color="FFFFFF")
            c.fill = PatternFill(start_color="1F3864", end_color="1F3864", fill_type="solid")
            c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

        url_cols = {
            COLUMNS.index(c) + 1
            for c in ("Company website", "Company LinkedIn URL", "Decision maker LinkedIn URL")
            if c in COLUMNS
        }

        for row_idx, r in enumerate(self.collected_rows, start=2):
            row_data = [r.get(c, "") for c in COLUMNS]
            ws.append(row_data)
            ws.row_dimensions[row_idx].height = 20

            for col_idx in url_cols:
                cell = ws.cell(row=row_idx, column=col_idx)
                if cell.value and str(cell.value).startswith("http"):
                    cell.hyperlink = cell.value
                    cell.font = Font(name="Arial", size=9, color="0563C1", underline="single")

        for col_idx, col_name in enumerate(COLUMNS, start=1):
            letter = openpyxl.utils.get_column_letter(col_idx)
            ws.column_dimensions[letter].width = min(max(len(col_name) + 4, 18), 45)

        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions
        wb.save(str(out_path))


def clean_linkedin_url(url: str, full_name: str = "", company: str = "") -> str:
    """
    Cleans LinkedIn profile URLs:
    - Removes tracking parameters (?.*) and trailing slashes
    - Preserves correct LinkedIn subdomain: www.linkedin.com/in/ for US/global, in.linkedin.com/in/ only if original was in.linkedin.com
    - Strips trailing punctuation and noise
    """
    if not url:
        return ""
    is_india = bool(re.search(r"https?://in\.linkedin\.com", url, re.I))
    base = "https://in.linkedin.com/in/" if is_india else "https://www.linkedin.com/in/"
    m = re.search(r"linkedin\.com/in/([^/?#]+)", url, re.I)
    if not m:
        return url.split("?")[0].rstrip("/")
    slug = m.group(1).strip().strip("-")
    return f"{base}{slug}"

