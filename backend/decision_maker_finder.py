#!/usr/bin/env python3
"""
Decision Maker Finder  (SerpApi + Google Sheets / Web App)

For every company row in your sheet or web table, it searches Google (through SerpApi)
for LinkedIn profiles of the company's top people, picks the most senior one whose
profile text actually mentions the company, and writes back:

    Decision Maker Name | Decision Maker Post | Decision Maker Linkedin
    (+ "Decision Maker Confidence" if that column exists in your sheet)

Setup
-----
    pip install requests gspread openpyxl
    export SERPAPI_KEY="your_key"            # or pass --serpapi-key
    python backend/decision_maker_finder.py --creds service_account.json

Useful flags
    --limit 10        only process the first 10 pending rows (test first!)
    --dry-run         don't write to the sheet, only print + save the CSV log
    --max-queries 2   Google searches per company (each one costs 1 SerpApi credit)
    --overwrite       also redo rows that already have a decision maker
    --input file.xlsx run on a local Excel/CSV file instead of Google Sheets
    --company "Acme"  test a single company directly in terminal
"""
from __future__ import annotations

import argparse
import csv
import logging
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests

try:
    from dotenv import load_dotenv
    load_dotenv()
    # Also load from parent or current directory .env if present
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        load_dotenv(dotenv_path=env_path)
except ImportError:
    pass

logger = logging.getLogger("decision_maker_finder")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("[%(asctime)s] [%(levelname)s] [DecisionMakerFinder] %(message)s"))
    logger.addHandler(handler)
logger.setLevel(logging.INFO)

# --------------------------------------------------------------------------- #
# CONFIG
# --------------------------------------------------------------------------- #
SPREADSHEET_ID = "1kdvZZKCaEVHfhTJxl9eoBkEMPaLdoaA1CT3UnNMa3zI"
SHEET_GID = 917469084

COL_COMPANY = "Name"                          # company name column
COL_WEBSITE = "Website"                       # company website column
COL_COMPANY_LI = "Linkedin"                   # company LinkedIn page column
COL_DM_NAME = "Decision Maker Name"
COL_DM_POST = "Decision Maker Post"
COL_DM_LI = "Decision Maker Linkedin"
COL_DM_CONF = "Decision Maker Confidence"     # optional; skipped if not in sheet

SERPAPI_URL = "https://serpapi.com/search.json"

# Most senior first. Lower index = better.
TITLE_PRIORITY = [
    ["owner", "co-owner", "founder", "co-founder", "cofounder"],
    ["ceo", "chief executive", "president", "chief sumo"],
    ["managing director", "general manager", "managing partner", "principal", "partner"],
    ["chief operating", "coo", "chief financial", "cfo", "vice president", "vp"],
    ["director", "head of", "chief"],
    ["manager"],
]

# Search groups (one Google query each, in order, stopping as soon as we have a confident hit)
QUERY_GROUPS = [
    '"Owner" OR "Founder" OR "CEO" OR "President" OR "Co-Founder"',
    '"Managing Director" OR "General Manager" OR "Vice President" OR "Director" OR "Partner"',
]

COMPANY_SUFFIXES = {
    "inc", "llc", "ltd", "co", "corp", "corporation", "company", "incorporated",
    "limited", "lp", "llp", "plc", "the", "and", "of", "&",
}


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def norm(text: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9 ]", " ", (text or "").lower())


def company_tokens(company: str, company_li: str = "", website: str = "") -> Tuple[List[str], str, str]:
    """Distinctive lowercase tokens that identify the company in a profile snippet."""
    toks = [t for t in norm(company).split() if t not in COMPANY_SUFFIXES and len(t) > 1]
    slug = ""
    m = re.search(r"linkedin\.com/(?:company|showcase)/([^/?#]+)", company_li or "", re.I)
    if m:
        slug = m.group(1).replace("-", " ").lower()
    domain = ""
    if website:
        d = re.sub(r"^https?://(www\.)?", "", str(website).strip().lower()).split("/")[0]
        domain = d.split(".")[0]
    return toks, slug.strip(), domain


def company_match(text: str, company: str, company_li: str = "", website: str = "") -> float:
    """Return a 0..1 score of how well the result text matches the company."""
    t = norm(text)
    toks, slug, domain = company_tokens(company, company_li, website)
    full = " ".join(toks)
    if full and full in t:
        return 1.0
    if slug and slug in t:
        return 1.0
    if domain and len(domain) > 3 and domain in t.replace(" ", ""):
        return 0.8
    if toks:
        hit = sum(1 for tok in toks if re.search(r"\b" + re.escape(tok) + r"\b", t))
        return hit / len(toks) if hit else 0.0
    return 0.0


def title_rank(title: Optional[str]) -> Optional[int]:
    """Lower is more senior; None if no decision-maker keyword found."""
    t = norm(title)
    for rank, group in enumerate(TITLE_PRIORITY):
        for kw in group:
            if re.search(r"\b" + re.escape(norm(kw).strip()) + r"\b", t):
                return rank
    return None


def clean_linkedin_url(url: Optional[str]) -> str:
    m = re.match(r"https?://(?:[a-z]{2,3}\.)?linkedin\.com/in/([^/?#]+)", str(url or ""), re.I)
    return f"https://www.linkedin.com/in/{m.group(1)}" if m else ""


def parse_profile(result: Dict[str, Any]) -> Optional[Dict[str, str]]:
    """Turn one organic Google result into {name, title, text, url} or None.
    LinkedIn result titles look like:  'Jane Doe - Owner - Acme Tobacco | LinkedIn'"""
    url = clean_linkedin_url(result.get("link", ""))
    if not url:
        return None
    raw_title = re.sub(r"\s*[|·]\s*LinkedIn.*$", "", result.get("title", ""), flags=re.I).strip()
    # Split by standard dashes or common headline delimiters / emojis
    parts = re.split(r"\s+[-–—]\s+|(?<=\s)[|•·/](?=\s)|[⚡️👑🚀💼]\s*", raw_title)
    name = re.sub(r",.*$", "", parts[0]).strip()              # drop ", MBA" style suffixes
    name = re.sub(r"[^\w\s.'’-]", "", name).strip()

    # If delimiter wasn't detected and name contains a title keyword, split them
    job = parts[1].strip() if len(parts) > 1 else ""
    if not job and len(name.split()) > 2:
        m_title = re.search(r"\b(founder|co-founder|ceo|owner|director|president|partner|manager|chief|head of|vp|ex)\b", name, re.I)
        if m_title and m_title.start() > 3:
            job = name[m_title.start():].strip()
            name = name[:m_title.start()].strip()

    if not name or "linkedin member" in name.lower() or len(name.split()) < 2:
        return None

    snippet = result.get("snippet", "") or ""
    if not job:                                                # fall back to snippet "Title at Company"
        m = re.search(r"([^·.|]+?)\s+(?:at|@)\s+", snippet)
        job = m.group(1).strip() if m else ""
    return {"name": name, "title": job, "text": f"{raw_title} {snippet}", "url": url}


# --------------------------------------------------------------------------- #
# SerpApi
# --------------------------------------------------------------------------- #
_SEARCH_CACHE: Dict[str, List[Dict[str, Any]]] = {}


def serp_search(query: str, api_key: str, num: int = 10, retries: int = 2) -> List[Dict[str, Any]]:
    cache_key = f"{query.strip()}:{api_key[:6]}"
    if cache_key in _SEARCH_CACHE:
        return _SEARCH_CACHE[cache_key]

    params = {
        "engine": "google",
        "q": query,
        "num": num,
        "api_key": api_key,
        "hl": "en",
        "gl": "us",
    }
    for attempt in range(retries + 1):
        try:
            r = requests.get(SERPAPI_URL, params=params, timeout=40)
            data = r.json()
            if r.status_code == 200 and "error" not in data:
                results = data.get("organic_results", [])
                _SEARCH_CACHE[cache_key] = results
                return results
            err = data.get("error", f"HTTP {r.status_code}")
            if "no results" in str(err).lower():
                _SEARCH_CACHE[cache_key] = []
                return []
            if r.status_code in (401, 403) or "invalid api key" in str(err).lower():
                logger.error(f"SerpApi auth error: {err}")
                return []
            if "run out of searches" in str(err).lower():
                logger.error("SerpApi: out of search credits.")
                return []
            logger.warning(f"    SerpApi error: {err} (attempt {attempt + 1})")
        except requests.RequestException as e:
            logger.warning(f"    network error: {e} (attempt {attempt + 1})")
        time.sleep(2 * (attempt + 1))
    return []


def find_decision_maker(
    company: str,
    website: str = "",
    company_li: str = "",
    api_key: Optional[str] = None,
    max_queries: int = 2,
) -> Optional[Dict[str, Any]]:
    """
    Returns dict(name, title, url, confidence) or None.
    Uses user's precision SerpApi search groups, seniority rank, and company matching.
    """
    key = (api_key or os.environ.get("SERPAPI_KEY", "")).strip()
    if not key or not company:
        return None

    best = None
    for group in QUERY_GROUPS[:max_queries]:
        # Enclose group in parentheses to ensure boolean OR groups correctly in Google search
        query = f'site:linkedin.com/in ({group}) "{company}"'
        for res in serp_search(query, key):
            prof = parse_profile(res)
            if not prof:
                continue
            match = company_match(prof["text"], company, company_li, website)
            rank = title_rank(prof["title"] or prof["text"])
            if rank is None or match < 0.5:
                continue

            # Prioritize current role matching company over former/ex roles
            is_job_match = company_match(prof["title"], company, company_li, website) >= 0.8
            is_former = bool(re.search(r"\b(?:ex|former)\b", prof["text"].lower()))
            tier = 0 if (is_job_match and not is_former) else (2 if is_former else 1)

            # Lower sort key = better: tier first, then seniority rank, then company match
            key_tuple = (tier, rank, -match)
            if best is None or key_tuple < best["key"]:
                best = {**prof, "key": key_tuple, "match": match, "rank": rank, "tier": tier}

        # Stop early if we have a top tier (tier 0) senior + well-matched hit
        if best and best["tier"] == 0 and best["rank"] <= 1 and best["match"] >= 0.8:
            break

    if not best:
        return None
    confidence = "high" if best["match"] >= 0.8 and best["rank"] <= 2 else "medium"
    return {
        "name": best["name"],
        "title": best["title"],
        "url": best["url"],
        "confidence": confidence,
    }


# --------------------------------------------------------------------------- #
# Dataclass & Class Wrapper for FastAPI Server / Web Application
# --------------------------------------------------------------------------- #
@dataclass
class DecisionMakerResult:
    company_name: str
    company_website: str = ""
    company_linkedin_url: str = ""
    decision_maker_name: str = ""
    position: str = ""
    personal_linkedin_url: str = ""
    confidence: str = "none"  # "high" | "medium" | "none"
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
            "confidence": self.confidence,
            "confidence_score": self.confidence_score,
            "evidence": self.evidence,
            "status": self.status,
            "error_message": self.error_message,
        }


class DecisionMakerFinder:
    def __init__(self, serpapi_key: Optional[str] = None):
        self.serpapi_key = (serpapi_key or os.environ.get("SERPAPI_KEY", "")).strip()

    def find_decision_maker(
        self,
        company: str,
        website: str = "",
        company_li: str = "",
        api_key: Optional[str] = None,
        max_queries: int = 2,
    ) -> DecisionMakerResult:
        key = (api_key or self.serpapi_key or os.environ.get("SERPAPI_KEY", "")).strip()
        comp = (company or "").strip()
        web = (website or "").strip()
        li = (company_li or "").strip()

        if not comp:
            return DecisionMakerResult(
                company_name=comp,
                status="error",
                error_message="Company name is required.",
            )

        if not key:
            return DecisionMakerResult(
                company_name=comp,
                status="error",
                error_message="SERPAPI_KEY is missing. Please configure SERPAPI_KEY in .env or Settings.",
            )

        dm = find_decision_maker(comp, web, li, key, max_queries)
        if not dm:
            return DecisionMakerResult(
                company_name=comp,
                company_website=web,
                company_linkedin_url=li,
                confidence="none",
                confidence_score=0,
                evidence="No verified decision maker match found on Google/LinkedIn.",
                status="not_found",
            )

        conf = dm.get("confidence", "medium")
        conf_score = 95 if conf == "high" else 80

        return DecisionMakerResult(
            company_name=comp,
            company_website=web,
            company_linkedin_url=li,
            decision_maker_name=dm.get("name", ""),
            position=dm.get("title", ""),
            personal_linkedin_url=dm.get("url", ""),
            confidence=conf,
            confidence_score=conf_score,
            evidence=f"Matched via SerpApi: {dm.get('name')} ({dm.get('title')}) with {conf} confidence.",
            status="enriched",
        )


# --------------------------------------------------------------------------- #
# Google Sheets
# --------------------------------------------------------------------------- #
def open_sheet(creds_path: str, spreadsheet_id: str = SPREADSHEET_ID, gid: int = SHEET_GID):
    import gspread
    gc = gspread.service_account(filename=creds_path)
    return gc.open_by_key(spreadsheet_id).get_worksheet_by_id(gid)


def read_rows(ws) -> Tuple[List[str], List[Dict[str, Any]]]:
    values = ws.get_all_values()
    if not values:
        return [], []
    header = values[0]
    rows = []
    for idx, vals in enumerate(values[1:], start=2):
        vals = vals + [""] * (len(header) - len(vals))
        row = dict(zip(header, vals))
        row["row_number"] = idx
        rows.append(row)
    return header, rows


def write_row(ws, header: List[str], row_number: int, values: Dict[str, Any]):
    import gspread
    cells = [
        gspread.Cell(row_number, header.index(col) + 1, val)
        for col, val in values.items()
        if col in header
    ]
    if cells:
        ws.update_cells(cells, value_input_option="USER_ENTERED")


# --------------------------------------------------------------------------- #
# Main CLI
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(description="Find company decision makers + LinkedIn URLs via SerpApi.")
    ap.add_argument("--creds", help="Google service-account JSON key (for Google Sheets)")
    ap.add_argument("--input", help="Local CSV or Excel file to process")
    ap.add_argument("--company", help="Single company name to test directly")
    ap.add_argument("--website", default="", help="Company website for --company test")
    ap.add_argument("--linkedin", default="", help="Company LinkedIn URL for --company test")
    ap.add_argument("--serpapi-key", default=os.getenv("SERPAPI_KEY"), help="SerpApi key (or env SERPAPI_KEY)")
    ap.add_argument("--limit", type=int, default=0, help="max rows to process (0 = all)")
    ap.add_argument("--max-queries", type=int, default=2, choices=[1, 2], help="searches per company")
    ap.add_argument("--delay", type=float, default=1.0, help="seconds between companies")
    ap.add_argument("--overwrite", action="store_true", help="redo rows that already have a decision maker")
    ap.add_argument("--dry-run", action="store_true", help="don't write to the sheet")
    ap.add_argument("--log", default="decision_makers_log.csv", help="CSV log path")
    args = ap.parse_args()

    api_key = (args.serpapi_key or os.getenv("SERPAPI_KEY", "")).strip()
    if not api_key:
        sys.exit("Provide a SerpApi key via --serpapi-key or SERPAPI_KEY env var.")

    # 1. Single company mode
    if args.company:
        print(f"Finding decision maker for '{args.company}'...")
        dm = find_decision_maker(args.company, args.website, args.linkedin, api_key, args.max_queries)
        if dm:
            print(f"FOUND: {dm['name']} | {dm['title']} | {dm['url']} ({dm['confidence']} confidence)")
        else:
            print("No confident decision maker found.")
        return

    # 2. Local CSV / Excel mode
    if args.input:
        in_path = Path(args.input)
        if not in_path.exists():
            sys.exit(f"Input file not found: {in_path}")
        rows: List[Dict[str, str]] = []
        if in_path.suffix.lower() == ".csv":
            with open(in_path, "r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                rows = list(reader)
        else:
            try:
                import openpyxl
                wb = openpyxl.load_workbook(in_path)
                ws = wb.active
                data = list(ws.iter_rows(values_only=True))
                header = [str(c or "").strip() for c in data[0]]
                for r_vals in data[1:]:
                    row_dict = {header[i]: str(r_vals[i] or "").strip() for i in range(min(len(header), len(r_vals)))}
                    rows.append(row_dict)
            except Exception as e:
                sys.exit(f"Failed to read Excel file: {e}")

        todo = [r for r in rows if r.get(COL_COMPANY, "").strip() and (args.overwrite or not r.get(COL_DM_LI, "").strip())]
        if args.limit:
            todo = todo[:args.limit]
        print(f"{len(todo)} companies to process from {in_path.name}")

        log, found = [], 0
        for i, r in enumerate(todo, 1):
            company = r.get(COL_COMPANY, "").strip()
            dm = find_decision_maker(company, r.get(COL_WEBSITE, ""), r.get(COL_COMPANY_LI, ""), api_key, args.max_queries)
            if dm:
                found += 1
                print(f"[{i}/{len(todo)}] {company}: {dm['name']} | {dm['title']} | {dm['url']} ({dm['confidence']})")
                r[COL_DM_NAME] = dm["name"]
                r[COL_DM_POST] = dm["title"]
                r[COL_DM_LI] = dm["url"]
                r[COL_DM_CONF] = dm["confidence"]
            else:
                print(f"[{i}/{len(todo)}] {company}: no confident match")
            log.append({
                "company": company,
                "name": dm["name"] if dm else "",
                "title": dm["title"] if dm else "",
                "linkedin": dm["url"] if dm else "",
                "confidence": dm["confidence"] if dm else "",
            })
            time.sleep(args.delay)

        if log:
            with open(args.log, "w", newline="", encoding="utf-8") as fh:
                w = csv.DictWriter(fh, fieldnames=list(log[0].keys()))
                w.writeheader()
                w.writerows(log)
        print(f"Done. {found}/{len(todo)} found. Log: {args.log}")
        return

    # 3. Google Sheets mode (default if --creds provided)
    if not args.creds:
        sys.exit("Please provide --creds service_account.json, or --input file.xlsx, or --company 'Acme'.")

    ws = open_sheet(args.creds)
    header, rows = read_rows(ws)
    for col in (COL_COMPANY, COL_DM_NAME, COL_DM_LI):
        if col not in header:
            sys.exit(f"Column '{col}' not found in sheet. Found: {header}")

    todo = [
        r for r in rows
        if r.get(COL_COMPANY, "").strip()
        and (args.overwrite or not r.get(COL_DM_LI, "").strip())
    ]
    if args.limit:
        todo = todo[:args.limit]
    print(f"{len(todo)} companies to process from Google Sheet")

    log, found = [], 0
    for i, r in enumerate(todo, 1):
        company = r[COL_COMPANY].strip()
        dm = find_decision_maker(
            company,
            r.get(COL_WEBSITE, ""),
            r.get(COL_COMPANY_LI, ""),
            api_key,
            args.max_queries,
        )
        if dm:
            found += 1
            print(f"[{i}/{len(todo)}] {company}: {dm['name']} | {dm['title']} | {dm['url']} ({dm['confidence']})")
            if not args.dry_run:
                write_row(
                    ws,
                    header,
                    r["row_number"],
                    {
                        COL_DM_NAME: dm["name"],
                        COL_DM_POST: dm["title"],
                        COL_DM_LI: dm["url"],
                        COL_DM_CONF: dm["confidence"],
                    },
                )
        else:
            print(f"[{i}/{len(todo)}] {company}: no confident match")
        log.append({
            "row_number": r["row_number"],
            "company": company,
            "name": dm["name"] if dm else "",
            "title": dm["title"] if dm else "",
            "linkedin": dm["url"] if dm else "",
            "confidence": dm["confidence"] if dm else "",
        })
        time.sleep(args.delay)

    if log:
        with open(args.log, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(log[0].keys()))
            w.writeheader()
            w.writerows(log)
    print(f"Done. {found}/{len(todo)} found. Log: {args.log}")


if __name__ == "__main__":
    main()
