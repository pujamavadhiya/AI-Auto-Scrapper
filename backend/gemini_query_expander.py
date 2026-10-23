#!/usr/bin/env python3
"""
Gemini Query Expander & Semantic Criteria Intelligence for LinkedIn Collector.

Uses Google Gemini to:
1. Parse and standardize ambiguous, colloquial, or typo-ridden locations:
   e.g. "banglore city which is situated in karnataka india" ->
   City: "Bengaluru", Aliases: ["Bangalore", "Bengaluru", "Bangalore Urban", "Bangalore City", "banglore"],
   State: "Karnataka", Country: "India" (IN).
2. Semantically expand industry keywords and niche verticals:
   e.g. "tobacco manufacturers" ->
   Industry Terms: ["Tobacco", "Tobacco Manufacturing", "Cigarettes", "Cigars", "Bidi", "FMCG", "Consumer Goods", "Tobacco Products"]
3. Generate high-yield Google / Bing / LinkedIn boolean search queries for company pages and decision makers.
4. Provide semantic industry & location verification so authentic companies are not falsely dropped.
5. Provide Google Search integration via Serper.dev and SerpApi with automatic fallback to Bing/Yahoo.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple
import requests

logger = logging.getLogger("gemini_query_expander")
logger.setLevel(logging.INFO)

# Gemini models ordered by response speed and quota availability
GEMINI_MODELS = [
    "gemini-flash-lite-latest",
    "gemini-2.5-flash-lite",
    "gemini-flash-latest",
    "gemini-pro-latest",
]

# Standard geographical alias fallbacks for major tech/manufacturing hubs
COMMON_CITY_ALIASES = {
    "bangalore": ("Bengaluru", ["bangalore", "bengaluru", "bangalore urban", "bangalore city", "banglore", "blr"], "Karnataka", "KA", "India", "IN"),
    "banglore": ("Bengaluru", ["bangalore", "bengaluru", "bangalore urban", "bangalore city", "banglore", "blr"], "Karnataka", "KA", "India", "IN"),
    "bengaluru": ("Bengaluru", ["bangalore", "bengaluru", "bangalore urban", "bangalore city", "banglore", "blr"], "Karnataka", "KA", "India", "IN"),
    "mumbai": ("Mumbai", ["mumbai", "bombay", "navi mumbai", "bombay city"], "Maharashtra", "MH", "India", "IN"),
    "bombay": ("Mumbai", ["mumbai", "bombay", "navi mumbai", "bombay city"], "Maharashtra", "MH", "India", "IN"),
    "pune": ("Pune", ["pune", "poona"], "Maharashtra", "MH", "India", "IN"),
    "delhi": ("New Delhi", ["delhi", "new delhi", "ncr", "national capital region"], "Delhi", "DL", "India", "IN"),
    "new delhi": ("New Delhi", ["delhi", "new delhi", "ncr", "national capital region"], "Delhi", "DL", "India", "IN"),
    "noida": ("Noida", ["noida", "greater noida"], "Uttar Pradesh", "UP", "India", "IN"),
    "gurgaon": ("Gurugram", ["gurgaon", "gurugram"], "Haryana", "HR", "India", "IN"),
    "gurugram": ("Gurugram", ["gurgaon", "gurugram"], "Haryana", "HR", "India", "IN"),
    "hyderabad": ("Hyderabad", ["hyderabad", "secunderabad", "cyberabad"], "Telangana", "TS", "India", "IN"),
    "chennai": ("Chennai", ["chennai", "madras"], "Tamil Nadu", "TN", "India", "IN"),
    "madras": ("Chennai", ["chennai", "madras"], "Tamil Nadu", "TN", "India", "IN"),
    "kolkata": ("Kolkata", ["kolkata", "calcutta"], "West Bengal", "WB", "India", "IN"),
    "calcutta": ("Kolkata", ["kolkata", "calcutta"], "West Bengal", "WB", "India", "IN"),
    "ahmedabad": ("Ahmedabad", ["ahmedabad", "amdavad"], "Gujarat", "GJ", "India", "IN"),
}


def _clean_json_text(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\n?", "", t)
        t = re.sub(r"\n?```$", "", t)
    return t.strip()


def call_gemini_json(prompt: str, api_key: str) -> Optional[Dict[str, Any]]:
    if not api_key:
        return None

    headers = {"Content-Type": "application/json"}
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json",
        },
    }

    for model in GEMINI_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        try:
            r = requests.post(url, headers=headers, json=payload, timeout=22)
            if r.status_code == 200:
                data = r.json()
                cands = data.get("candidates", [])
                if cands:
                    parts = cands[0].get("content", {}).get("parts", [])
                    if parts:
                        raw_text = parts[0].get("text", "")
                        clean = _clean_json_text(raw_text)
                        parsed = json.loads(clean)
                        if isinstance(parsed, dict):
                            return parsed
            elif r.status_code in (404, 400):
                continue
            else:
                logger.warning(f"Gemini error {r.status_code} for {model}: {r.text[:100]}")
        except Exception as e:
            logger.warning(f"Gemini request exception for {model}: {e}")

    return None


def get_rule_based_fallback(
    keywords: List[str],
    city: str = "",
    state: str = "",
    country: str = "",
    titles: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Fast, accurate rule-based expansion when Gemini key is not configured."""
    clean_kws = [k.strip() for k in keywords if k.strip()]
    city_raw = (city or "").strip()
    state_raw = (state or "").strip()
    country_raw = (country or "").strip()
    titles = titles or ["CEO", "Founder", "Director", "Owner", "MD"]

    # Check if city input has embedded location text like "banglore city which is situated in karnataka india"
    full_loc_text = f"{city_raw} {state_raw} {country_raw}".lower()

    canonical_city = city_raw
    city_aliases = [city_raw.lower()] if city_raw else []
    canonical_state = state_raw
    state_aliases = [state_raw.lower()] if state_raw else []
    canonical_country = country_raw or "United States"
    country_aliases = [canonical_country.lower()]
    country_code = "US"

    # Match common Indian cities
    for k, (c_name, c_alts, s_name, s_code, ctry_name, ctry_code) in COMMON_CITY_ALIASES.items():
        if k in full_loc_text:
            canonical_city = c_name
            city_aliases = list(set(city_aliases + c_alts))
            canonical_state = s_name
            state_aliases = list(set(state_aliases + [s_name.lower(), s_code.lower()]))
            canonical_country = ctry_name
            country_aliases = [ctry_name.lower(), ctry_code.lower()]
            country_code = ctry_code
            break

    # Build industry synonyms
    industry_terms = list(clean_kws)
    for kw in clean_kws:
        kw_l = kw.lower()
        if "tobacco" in kw_l or "cigarette" in kw_l:
            for term in ["Tobacco", "Tobacco Manufacturing", "Cigarettes", "Cigars", "Bidi", "FMCG", "Consumer Goods"]:
                if term not in industry_terms:
                    industry_terms.append(term)
        elif "software" in kw_l or "saas" in kw_l or "it" in kw_l:
            for term in ["Software Development", "Information Technology", "Internet", "Computer Software", "Technology"]:
                if term not in industry_terms:
                    industry_terms.append(term)
        elif "pharma" in kw_l or "medicine" in kw_l:
            for term in ["Pharmaceuticals", "Biotechnology", "Healthcare", "Life Sciences"]:
                if term not in industry_terms:
                    industry_terms.append(term)
        elif "textile" in kw_l or "garment" in kw_l or "apparel" in kw_l:
            for term in ["Textiles", "Apparel & Fashion", "Garment Manufacturing", "Clothing"]:
                if term not in industry_terms:
                    industry_terms.append(term)

    # Queries
    loc_primary = canonical_city or canonical_state or canonical_country
    loc_or_group = f'("{canonical_city}" OR "{city_aliases[0]}")' if len(city_aliases) > 1 else f'"{loc_primary}"'
    kw_primary = clean_kws[0] if clean_kws else "Business"
    kw_base = re.sub(r"\bmanufacturers\b", "manufacturing", kw_primary, flags=re.I).strip()

    company_queries = [
        f'site:linkedin.com/company "{kw_base}" {loc_or_group}',
        f'site:linkedin.com/company "{kw_primary}" {loc_or_group}',
        f'site:linkedin.com/company {kw_base} "{canonical_state or loc_primary}"',
        f'site:linkedin.com/company "{kw_base}" "{canonical_country}"',
    ]

    title_group = '("CEO" OR "Founder" OR "Director" OR "Owner" OR "MD")'
    people_queries = [
        f'site:linkedin.com/in {title_group} "{kw_base}" {loc_or_group}',
        f'site:linkedin.com/in {title_group} "{kw_primary}" {loc_or_group}',
        f'site:linkedin.com/in {title_group} "{kw_base}" "{canonical_state or loc_primary}"',
        f'site:linkedin.com/in {title_group} "{kw_base}" "{canonical_country}"',
    ]

    return {
        "canonical_city": canonical_city,
        "city_aliases": city_aliases,
        "canonical_state": canonical_state,
        "state_aliases": state_aliases,
        "canonical_country": canonical_country,
        "country_aliases": country_aliases,
        "country_code": country_code,
        "industry_terms": industry_terms,
        "company_search_queries": company_queries,
        "people_search_queries": people_queries,
    }


def expand_criteria_with_gemini(
    keywords: List[str],
    city: str = "",
    state: str = "",
    country: str = "",
    titles: Optional[List[str]] = None,
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Expands user keywords and location using Gemini AI into standardized
    canonical names, comprehensive aliases, relevant industry terms, and high-yield queries.
    """
    clean_kws = [k.strip() for k in keywords if k.strip()]
    city_raw = (city or "").strip()
    state_raw = (state or "").strip()
    country_raw = (country or "").strip()
    titles = titles or ["CEO", "Founder", "Director", "Owner", "MD"]

    # Start with robust rule-based baseline
    base = get_rule_based_fallback(clean_kws, city_raw, state_raw, country_raw, titles)

    g_key = (api_key or os.environ.get("GEMINI_API_KEY", "")).strip()
    if not g_key:
        return base

    prompt = f"""
You are an expert LinkedIn search query and geographic entity intelligence engine.
A user has specified the following lead collection criteria:
- Industry / Keywords: {json.dumps(clean_kws)}
- City input (may contain colloquial names, typos, or full descriptive text): "{city_raw}"
- State input: "{state_raw}"
- Country input: "{country_raw}"
- Target Decision Maker Titles: {json.dumps(titles)}

Task:
Standardize and expand this criteria to maximize discovery of authentic LinkedIn company pages and people profiles.
Return a STRICT JSON object with these EXACT keys:
1. "canonical_city": standardized official city name (e.g. if input is "banglore" or "banglore city in karnataka india", output "Bengaluru"). If no city was given, empty string "".
2. "city_aliases": list of all alternative spellings, common names, and acronyms (e.g. ["Bangalore", "Bengaluru", "Bangalore Urban", "Bangalore City", "banglore", "blr"]).
3. "canonical_state": standardized state/province (e.g. "Karnataka").
4. "state_aliases": list of state names and codes (e.g. ["Karnataka", "KA"]).
5. "canonical_country": standardized country name (e.g. "India").
6. "country_aliases": list of country names/codes (e.g. ["India", "IN", "Bharat"]).
7. "country_code": 2-letter ISO country code (e.g. "IN", "US", "GB").
8. "industry_terms": list of 6-10 official LinkedIn industry categories, sub-sectors, synonyms, and product types matching the keywords (e.g. for "tobacco manufacturers": ["Tobacco", "Tobacco Manufacturing", "Cigarettes", "Cigars", "Bidi", "FMCG", "Consumer Goods", "Smoking Products"]).
9. "company_search_queries": list of 4 optimized LinkedIn Google search queries for company pages using site:linkedin.com/company.
10. "people_search_queries": list of 4 optimized LinkedIn Google search queries for decision makers using site:linkedin.com/in.

Respond with ONLY the JSON object.
"""

    gemini_result = call_gemini_json(prompt, g_key)
    if not gemini_result:
        return base

    # Merge Gemini intelligence with baseline to ensure no missing keys
    merged = {
        "canonical_city": str(gemini_result.get("canonical_city") or base["canonical_city"]).strip(),
        "city_aliases": list(set([str(x).strip().lower() for x in (gemini_result.get("city_aliases") or base["city_aliases"]) if str(x).strip()])),
        "canonical_state": str(gemini_result.get("canonical_state") or base["canonical_state"]).strip(),
        "state_aliases": list(set([str(x).strip().lower() for x in (gemini_result.get("state_aliases") or base["state_aliases"]) if str(x).strip()])),
        "canonical_country": str(gemini_result.get("canonical_country") or base["canonical_country"]).strip(),
        "country_aliases": list(set([str(x).strip().lower() for x in (gemini_result.get("country_aliases") or base["country_aliases"]) if str(x).strip()])),
        "country_code": str(gemini_result.get("country_code") or base["country_code"]).strip().upper(),
        "industry_terms": [str(x).strip() for x in (gemini_result.get("industry_terms") or base["industry_terms"]) if str(x).strip()],
        "company_search_queries": [str(x).strip() for x in (gemini_result.get("company_search_queries") or base["company_search_queries"]) if str(x).strip()],
        "people_search_queries": [str(x).strip() for x in (gemini_result.get("people_search_queries") or base["people_search_queries"]) if str(x).strip()],
    }

    # Ensure user input city is included in aliases
    if city_raw and city_raw.lower() not in merged["city_aliases"]:
        merged["city_aliases"].append(city_raw.lower())

    return merged


# ---------------------------------------------------------------------------
# Google Search API engines (Serper.dev and SerpApi)
# ---------------------------------------------------------------------------
def search_serper(query: str, page: int = 1, api_key: Optional[str] = None) -> Optional[List[Dict[str, str]]]:
    """Execute search query using Google Serper.dev API."""
    key = (api_key or os.environ.get("SERPER_API_KEY", "")).strip()
    if not key:
        return None

    url = "https://google.serper.dev/search"
    headers = {"X-API-KEY": key, "Content-Type": "application/json"}
    payload = {"q": query, "num": 10, "page": page}

    try:
        r = requests.post(url, headers=headers, json=payload, timeout=25)
        if r.status_code == 200:
            data = r.json()
            organic = data.get("organic", [])
            out = []
            for item in organic:
                link = item.get("link", "")
                if link and re.search(r"linkedin\.com/(company|in)/", link, re.I):
                    out.append({
                        "title": item.get("title", ""),
                        "url": link,
                        "snippet": item.get("snippet", ""),
                    })
            return out
        else:
            logger.warning(f"Serper API HTTP {r.status_code}: {r.text[:80]}")
    except Exception as e:
        logger.warning(f"Serper search error: {e}")

    return None


def search_serpapi(query: str, page: int = 1, api_key: Optional[str] = None) -> Optional[List[Dict[str, str]]]:
    """Execute search query using Google SerpApi."""
    key = (api_key or os.environ.get("SERPAPI_KEY", "")).strip()
    if not key:
        return None

    url = "https://serpapi.com/search.json"
    start = (page - 1) * 10
    params = {
        "engine": "google",
        "q": query,
        "api_key": key,
        "num": 10,
        "start": start,
    }

    try:
        r = requests.get(url, params=params, timeout=30)
        if r.status_code == 200:
            data = r.json()
            organic = data.get("organic_results", [])
            out = []
            for item in organic:
                link = item.get("link", "")
                if link and re.search(r"linkedin\.com/(company|in)/", link, re.I):
                    out.append({
                        "title": item.get("title", ""),
                        "url": link,
                        "snippet": item.get("snippet", ""),
                    })
            return out
        else:
            logger.warning(f"SerpApi HTTP {r.status_code}: {r.text[:80]}")
    except Exception as e:
        logger.warning(f"SerpApi search error: {e}")

    return None


def verify_company_industry_smart(
    company_name: str,
    snippet: str,
    industry_terms: List[str],
    raw_industry: str = "",
) -> Tuple[bool, str]:
    """
    Checks if a company matches the target industry using expanded terms,
    even when LinkedIn's public page didn't reveal the industry field.
    """
    comp_clean = company_name.lower()
    snip_clean = snippet.lower()
    ind_clean = raw_industry.lower()

    # 1. Direct match on reported industry
    if raw_industry:
        for term in industry_terms:
            t_low = term.lower()
            if t_low in ind_clean or ind_clean in t_low:
                return True, raw_industry

    # 2. Match on company name
    for term in industry_terms:
        t_low = term.lower()
        # Stem checks
        words = [w for w in t_low.split() if len(w) > 3 and w not in ("manufacturing", "manufacturers", "company", "products", "services")]
        for w in words:
            if re.search(rf"\b{re.escape(w)}\b", comp_clean):
                return True, term

    # 3. Match on search snippet description
    for term in industry_terms:
        t_low = term.lower()
        words = [w for w in t_low.split() if len(w) > 3 and w not in ("manufacturing", "manufacturers", "company", "products", "services")]
        for w in words:
            if re.search(rf"\b{re.escape(w)}\b", snip_clean):
                return True, term

    return False, raw_industry or "Unverified Industry"
