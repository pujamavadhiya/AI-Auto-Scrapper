#!/usr/bin/env python3
"""
Social Media Links Scraper (Python port of the n8n workflow)

The n8n workflow contained two independent flows. Both are included here:

  --mode company   (n8n "Manual Trigger" flow)
      * Reads rows, uses the "Company URL" / "Company" columns
      * Skips rows that already have Facebook + Instagram + Linkedin
      * One site at a time (or concurrent batch), 1 second pause between sites
      * Strict regex extraction; LinkedIn only accepts /company, /showcase, /school
      * Writes Facebook, Instagram, Linkedin

  --mode website   (n8n "Schedule Trigger" flow)   <-- default
      * Reads rows, uses the "Website" column
      * Skips rows with no website
      * Fetches 5 sites at a time
      * Collects every <a href> pointing to Facebook / Instagram / LinkedIn / X
      * Never overwrites an existing value with an empty one
      * Writes Facebook, Instagram, X, Linkedin and saves a CSV / XLSX backup log

Usable via CLI or directly imported by the FastAPI backend server.
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
import requests
import urllib3

# n8n had "allowUnauthorizedCerts": true, so SSL verification is off here too.
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Try importing gspread for optional Google Sheets CLI sync
try:
    import gspread
except ImportError:
    gspread = None

# Default Google Sheet config from original n8n node
SPREADSHEET_ID = "1kdvZZKCaEVHfhTJxl9eoBkEMPaLdoaA1CT3UnNMa3zI"
SHEET_GID = 917469084

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# --------------------------------------------------------------------------- #
# Bad URL path components (taken directly from the n8n workflow)
# --------------------------------------------------------------------------- #
FB_BAD = {
    "sharer", "sharer.php", "share", "share.php", "plugins", "dialog", "tr", "login",
    "policies", "help", "legal", "privacy", "l.php", "groups", "events", "watch",
    "hashtag", "2008", "v2.0", "v3.0", "v4.0", "v5.0", "business", "ads", "about",
}
IG_BAD = {
    "p", "reel", "reels", "explore", "accounts", "share", "stories", "tv",
    "developer", "about", "legal", "directory",
}

SHARE_RE = re.compile(r"sharer|share\.php|/share\b|intent/|plugins/|dialog/|/login|/hashtag/", re.I)
HREF_RE = re.compile(r"""href=["']([^"']+)["']""", re.I)

COLUMNS = [
    "Company",
    "Website",
    "Facebook",
    "Instagram",
    "Linkedin",
    "X",
    "Fetch Status",
    "Confidence Score",
]


# --------------------------------------------------------------------------- #
# HTTP Fetch
# --------------------------------------------------------------------------- #
def fetch_html(url: str, timeout: int = 15, extra_headers: Optional[Dict[str, str]] = None) -> str:
    """Equivalent of the n8n HTTP Request node with neverError=true:
    any failure just returns an empty string."""
    if not url or not str(url).strip():
        return ""
    u = str(url).strip()
    if not re.match(r"^https?://", u, re.I):
        u = "https://" + u.lstrip("/")
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"}
    if extra_headers:
        headers.update(extra_headers)
    try:
        r = requests.get(u, headers=headers, timeout=timeout, verify=False, allow_redirects=True)
        return r.text or ""
    except Exception:
        return ""


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _clean(u: str) -> str:
    u = re.sub(r"[?#].*$", "", u)
    return re.sub(r"[/.,;]+$", "", u)


def _first_seg(u: str, domain_re: str) -> str:
    parts = re.split(domain_re + r"/", u, maxsplit=1, flags=re.I)
    after = parts[1] if len(parts) > 1 else ""
    return after.split("/")[0].lower()


def _find(html: str, domain_re: str, validate: Callable[[str], bool]) -> str:
    pattern = re.compile(r"https?://(?:[a-z0-9-]+\.)*" + domain_re + r"/[^\s\"'<>\\)]+", re.I)
    for m in pattern.finditer(html):
        u = _clean(m.group(0))
        if validate(u):
            return u
    return ""


def _host(u: str) -> str:
    m = re.match(r"^(?:https?:)?//([^/?#]+)", u, re.I)
    return re.sub(r"^(www\.|m\.|mobile\.)", "", m.group(1).lower()) if m else ""


def _is(h: str, d: str) -> bool:
    return h == d or h.endswith("." + d)


# --------------------------------------------------------------------------- #
# MODE "company"  ->  n8n nodes: Filter & Prepare URLs + Extract Social Links1
# --------------------------------------------------------------------------- #
def extract_company_links(html: str) -> Dict[str, str]:
    """Strict regex extraction (n8n 'Extract Social Links1' node)."""
    if not html:
        return {"Facebook": "", "Instagram": "", "Linkedin": ""}
    # un-escape JSON-embedded links and HTML entities
    html = html.replace(r"\/", "/")
    html = html.replace("&amp;", "&")
    html = re.sub(r"&#x2F;", "/", html, flags=re.I)

    fb_re, ig_re, li_re = r"facebook\.com", r"instagram\.com", r"linkedin\.com"

    def fb_ok(u: str) -> bool:
        s = _first_seg(u, fb_re)
        return bool(s) and s not in FB_BAD

    def ig_ok(u: str) -> bool:
        s = _first_seg(u, ig_re)
        return bool(s) and s not in IG_BAD

    def li_ok(u: str) -> bool:
        s = _first_seg(u, li_re)
        after = re.split(r"linkedin\.com/", u, maxsplit=1, flags=re.I)
        segs = (after[1] if len(after) > 1 else "").split("/")
        rest = segs[1] if len(segs) > 1 else ""
        return s in {"company", "showcase", "school"} and bool(rest) and rest.lower() != "linkedin"

    return {
        "Facebook": _find(html, fb_re, fb_ok),
        "Instagram": _find(html, ig_re, ig_ok),
        "Linkedin": _find(html, li_re, li_ok),
    }


# --------------------------------------------------------------------------- #
# MODE "website"  ->  n8n nodes: Filter - Has Website + Extract Social Links
# --------------------------------------------------------------------------- #
def extract_all_links(html: str, orig: Optional[Dict[str, Any]] = None) -> Dict[str, str]:
    """Href-based multi-platform extraction (n8n 'Extract Social Links' node)."""
    orig = orig or {}
    links = []
    if html:
        for m in HREF_RE.finditer(html):
            l = m.group(1).strip()
            if l.startswith("//"):
                l = "https:" + l
            links.append(l)
    links = list(dict.fromkeys(links))  # unique, keep order

    f = {"facebook": [], "instagram": [], "linkedin": [], "x": []}
    for link in links:
        if not re.match(r"^https?://", link, re.I) or SHARE_RE.search(link):
            continue
        h = _host(link)
        if not h:
            continue
        cleaned_url = _clean(link)
        if _is(h, "facebook.com") or h in ("fb.me", "fb.com"):
            s = _first_seg(cleaned_url, r"facebook\.com|fb\.me|fb\.com")
            if s and s not in FB_BAD:
                f["facebook"].append(cleaned_url)
        elif _is(h, "instagram.com"):
            s = _first_seg(cleaned_url, r"instagram\.com")
            if s and s not in IG_BAD:
                f["instagram"].append(cleaned_url)
        elif _is(h, "linkedin.com"):
            s = _first_seg(cleaned_url, r"linkedin\.com")
            # Prefer company / school / showcase if available, but collect all verified non-share LinkedIn links
            if s and s not in ("share", "share.php", "intent", "login", "signup"):
                f["linkedin"].append(cleaned_url)
        elif _is(h, "twitter.com") or h == "x.com":
            s = _first_seg(cleaned_url, r"twitter\.com|x\.com")
            if s and s not in ("share", "intent", "search", "explore", "home", "login", "signup"):
                f["x"].append(cleaned_url)

    j = lambda arr: " | ".join(dict.fromkeys(arr))
    return {
        "Facebook": j(f["facebook"]) or orig.get("Facebook") or orig.get("facebookUrl") or "",
        "Instagram": j(f["instagram"]) or orig.get("Instagram") or orig.get("instagramUrl") or "",
        "Linkedin": j(f["linkedin"]) or orig.get("Linkedin") or orig.get("companyLinkedinUrl") or orig.get("linkedinUrl") or "",
        "X": j(f["x"]) or orig.get("X") or orig.get("twitterUrl") or "",
        "fetch_status": "ok" if html else "empty_or_failed",
    }


# --------------------------------------------------------------------------- #
# High-level Batch Runner for API and UI
# --------------------------------------------------------------------------- #
class SocialMediaScraper:
    """
    Executes the user's authentic Social Media URL scraping algorithm.
    Supports 'website' mode (multi-link href scanning) and 'company' mode (strict company regex).
    """

    def __init__(self, mode: str = "website", batch_size: int = 5, delay: float = 1.0, timeout: int = 15):
        self.mode = mode.lower()
        self.batch_size = max(1, batch_size)
        self.delay = delay
        self.timeout = timeout
        self.stop_requested = False

    def stop(self):
        self.stop_requested = True

    def scrape_single(self, row: Dict[str, Any]) -> Dict[str, Any]:
        """Scrapes social media URLs for a single company/website row."""
        raw_url = str(row.get("Website") or row.get("Company URL") or row.get("website") or row.get("companyWebsite") or row.get("domain") or "").strip()
        company_name = str(row.get("Company") or row.get("Company Name") or row.get("companyName") or "").strip()

        if not raw_url and not company_name:
            return {
                **row,
                "Facebook": row.get("Facebook", ""),
                "Instagram": row.get("Instagram", ""),
                "Linkedin": row.get("Linkedin", ""),
                "X": row.get("X", ""),
                "Fetch Status": "no_website",
                "Confidence Score": 0,
            }

        # Normalize URL
        url = raw_url
        if url and not re.match(r"^https?://", url, re.I):
            url = "https://" + url.lstrip("/")

        html = fetch_html(url, timeout=self.timeout) if url else ""

        if self.mode == "company":
            links = extract_company_links(html)
            facebook = links.get("Facebook") or row.get("Facebook") or row.get("facebookUrl") or ""
            instagram = links.get("Instagram") or row.get("Instagram") or row.get("instagramUrl") or ""
            linkedin = links.get("Linkedin") or row.get("Linkedin") or row.get("companyLinkedinUrl") or row.get("linkedinUrl") or ""
            x_tw = row.get("X") or row.get("twitterUrl") or ""
            fetch_status = "ok" if html else "empty_or_failed"
        else:
            links = extract_all_links(html, row)
            facebook = links.get("Facebook", "")
            instagram = links.get("Instagram", "")
            linkedin = links.get("Linkedin", "")
            x_tw = links.get("X", "")
            fetch_status = links.get("fetch_status", "empty_or_failed")

        # Compute confidence score based on how many verified socials were extracted
        found_count = sum(bool(x) for x in (facebook, instagram, linkedin, x_tw))
        confidence = 95 if found_count >= 3 else (90 if found_count == 2 else (85 if found_count == 1 else 0))

        return {
            **row,
            "Company": company_name,
            "Website": url,
            "Facebook": facebook,
            "Instagram": instagram,
            "Linkedin": linkedin,
            "X": x_tw,
            "Fetch Status": fetch_status,
            "Confidence Score": confidence,
            # Frontend compatibility keys:
            "companyName": company_name,
            "companyWebsite": url,
            "domain": _host(url),
            "facebookUrl": facebook,
            "instagramUrl": instagram,
            "companyLinkedinUrl": linkedin,
            "linkedinUrl": linkedin,
            "twitterUrl": x_tw,
            "confidenceScore": confidence,
            "enrichmentStatus": "enriched" if found_count > 0 else "failed",
            "lastEnrichedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        }

    def scrape_batch(
        self,
        rows: List[Dict[str, Any]],
        on_progress: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> List[Dict[str, Any]]:
        """Executes batch scraping across rows with concurrent threading and live progress events."""
        results: List[Dict[str, Any]] = []
        total = len(rows)
        start_time = time.time()

        if self.mode == "company":
            # Mode company: serial processing with delay (matching n8n manual trigger flow)
            for idx, r in enumerate(rows, start=1):
                if self.stop_requested:
                    break
                enriched = self.scrape_single(r)
                results.append(enriched)

                if on_progress:
                    on_progress({
                        "currentIndex": idx,
                        "totalCount": total,
                        "percentage": int((idx / total) * 100),
                        "record": enriched,
                        "status": "running",
                        "stageMessage": f"Scraped {enriched.get('Company') or enriched.get('Website')}",
                        "elapsedSeconds": int(time.time() - start_time),
                    })

                time.sleep(self.delay)
        else:
            # Mode website: concurrent batch processing (matching n8n schedule trigger flow)
            with ThreadPoolExecutor(max_workers=self.batch_size) as pool:
                for start_idx in range(0, total, self.batch_size):
                    if self.stop_requested:
                        break
                    chunk = rows[start_idx : start_idx + self.batch_size]
                    batch_res = list(pool.map(self.scrape_single, chunk))
                    results.extend(batch_res)

                    curr = min(start_idx + self.batch_size, total)
                    if on_progress:
                        on_progress({
                            "currentIndex": curr,
                            "totalCount": total,
                            "percentage": int((curr / total) * 100),
                            "records": batch_res,
                            "status": "running",
                            "stageMessage": f"Processed {curr}/{total} websites in parallel",
                            "elapsedSeconds": int(time.time() - start_time),
                        })

        if on_progress:
            on_progress({
                "currentIndex": len(results),
                "totalCount": total,
                "percentage": 100,
                "status": "completed",
                "stageMessage": f"Completed social media extraction for {len(results)} companies.",
                "elapsedSeconds": int(time.time() - start_time),
            })

        return results

    @staticmethod
    def write_excel(rows: List[Dict[str, Any]], out_path: Path | str):
        """Saves clean Excel workbook with blue headers and auto-column widths."""
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Social Footprints"

        ws.append(COLUMNS)
        for cell in ws[1]:
            cell.font = Font(name="Arial", size=10, bold=True, color="FFFFFF")
            cell.fill = PatternFill(start_color="1F3864", end_color="1F3864", fill_type="solid")
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

        url_cols = {
            COLUMNS.index(c) + 1
            for c in ("Website", "Facebook", "Instagram", "Linkedin", "X")
            if c in COLUMNS
        }

        for row_idx, r in enumerate(rows, start=2):
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


# --------------------------------------------------------------------------- #
# CLI Google Sheets & Local File Entrypoint
# --------------------------------------------------------------------------- #
def main():
    parser = argparse.ArgumentParser(description="Scrape social media links from company websites into a Google Sheet or CSV/XLSX.")
    parser.add_argument("--creds", help="Path to Google service-account JSON key (optional)")
    parser.add_argument("--sheet-id", default=SPREADSHEET_ID, help="Google Spreadsheet ID")
    parser.add_argument("--gid", type=int, default=SHEET_GID, help="Worksheet GID")
    parser.add_argument("--mode", choices=["website", "company"], default="website",
                        help="website = 'Website' column, parallel batches; company = 'Company URL', strict company regex")
    parser.add_argument("--batch-size", type=int, default=5, help="Sites fetched in parallel (website mode)")
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between sites in seconds (company mode)")
    parser.add_argument("--input", help="Optional local CSV / XLSX file of companies/websites to process")
    parser.add_argument("--output", default="social_links_result.xlsx", help="Output XLSX file path")
    args = parser.parse_args()

    scraper = SocialMediaScraper(mode=args.mode, batch_size=args.batch_size, delay=args.delay)

    if args.input and os.path.exists(args.input):
        print(f"Reading input from local file: {args.input}")
        if args.input.endswith(".csv"):
            with open(args.input, newline="", encoding="utf-8-sig") as f:
                rows = list(csv.DictReader(f))
        else:
            import pandas as pd
            rows = pd.read_excel(args.input).fillna("").to_dict(orient="records")

        results = scraper.scrape_batch(rows, on_progress=lambda p: print(f"[{p['percentage']}%] {p['stageMessage']}"))
        scraper.write_excel(results, args.output)
        print(f"Saved {len(results)} rows to {args.output}")
        return

    if not args.creds or not os.path.exists(args.creds):
        print("No --creds or --input provided. Run with --help for usage.")
        return

    if not gspread:
        print("Error: gspread is not installed. Please run 'pip install gspread' to use Google Sheets.")
        return

    gc = gspread.service_account(filename=args.creds)
    sh = gc.open_by_key(args.sheet_id)
    ws = sh.get_worksheet_by_id(args.gid)
    values = ws.get_all_values()
    if not values:
        print("Worksheet is empty.")
        return

    header = values[0]
    rows = []
    for idx, vals in enumerate(values[1:], start=2):
        vals = vals + [""] * (len(header) - len(vals))
        row = dict(zip(header, vals))
        row["row_number"] = idx
        rows.append(row)

    print(f"Read {len(rows)} rows from '{ws.title}'. Starting mode '{args.mode}'...")
    results = scraper.scrape_batch(rows, on_progress=lambda p: print(f"[{p['percentage']}%] {p['stageMessage']}"))

    # Update Google Sheet cells
    target_cols = ["Facebook", "Instagram", "X", "Linkedin"] if args.mode == "website" else ["Facebook", "Instagram", "Linkedin"]
    cells = []
    for u in results:
        r_num = u.get("row_number")
        if not r_num:
            continue
        for col in target_cols:
            if col in header:
                cells.append(gspread.Cell(r_num, header.index(col) + 1, u.get(col, "")))
    if cells:
        ws.update_cells(cells, value_input_option="USER_ENTERED")
        print(f"Updated {len(cells)} cells in Google Sheet.")

    scraper.write_excel(results, args.output)
    print(f"Backup saved to {args.output}. Done.")


if __name__ == "__main__":
    main()
