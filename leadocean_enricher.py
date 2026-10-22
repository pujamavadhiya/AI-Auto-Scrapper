#!/usr/bin/env python3
"""
Lead Enricher  (email + phone via the LeadOcean API)

Input sheet (CSV or XLSX) with columns like:
    company name | website | decision maker name | decision maker linkedin url
Output: same sheet + "Email", "Phone", "Enrich Status" columns.

Everything provider-specific lives in leadocean_config.json (created with --init-config).
Fill it in from your LeadOcean dashboard / API docs - no code changes needed.

Usage
-----
    pip install requests pandas openpyxl
    export LEADOCEAN_API_KEY="your_key"
    python backend/leadocean_enricher.py --init-config          # writes leadocean_config.json
    python backend/leadocean_enricher.py --input leads.csv --output leads_enriched.csv --limit 5
    python backend/leadocean_enricher.py --input leads.xlsx     # full run

Flags: --limit N (test on N rows), --dry-run (print requests, no API calls),
       --overwrite (re-enrich rows that already have an email),
       --debug (print the first raw API response so you can fix the paths)
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

import pandas as pd
import requests

try:
    from dotenv import load_dotenv
    load_dotenv()
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if env_file.exists():
        load_dotenv(dotenv_path=env_file, override=True)
except ImportError:
    pass

logger = logging.getLogger("leadocean_enricher")
if not logger.handlers:
    h = logging.StreamHandler()
    h.setFormatter(logging.Formatter("[%(asctime)s] [%(levelname)s] [LeadOcean] %(message)s"))
    logger.addHandler(h)
logger.setLevel(logging.INFO)

# Config path resolution: check backend directory and project root
CONFIG_FILENAMES = ["leadocean_config.json", "backend/leadocean_config.json"]

DEFAULT_CONFIG: Dict[str, Any] = {
    "_help": "Fill these in from your LeadOcean API docs. Values like {linkedin} are filled from each row.",
    "url": "https://api.leadocean.io/v1/people/enrich",
    "method": "POST",
    "api_key_env": "LEADOCEAN_API_KEY",
    "auth_in": "header",              # "header" or "query"
    "auth_name": "x-api-key",         # header name, or query-param name if auth_in = "query"
    "auth_prefix": "",                # e.g. "Bearer " or "" (for x-api-key style headers)
    "request_map": {                  # keys = what the API expects; values = templates
        "linkedin_url": "{linkedin}",
        "full_name": "{name}",
        "first_name": "{first_name}",
        "last_name": "{last_name}",
        "company": "{company}",
        "domain": "{domain}",
        "reveal_email": True,
        "reveal_phone": True,
    },
    "email_paths": [
        "email",
        "data.email",
        "data.emails.0.email",
        "data.work_email",
        "result.email",
        "emails.0",
        "contact_data.emails.0.email",
        "contact_data.personal_emails.0",
    ],
    "phone_paths": [
        "phone",
        "data.phone",
        "data.phones.0.number",
        "data.direct_phone",
        "result.phone",
        "phones.0",
        "contact_data.phones.0.number",
        "contact_data.direct_numbers.0",
    ],
    "timeout_seconds": 40,
    "delay_seconds": 0.5,             # pause between rows
    "max_retries": 3,
}

# Accepted header names for each input column (case-insensitive, matched by "contains")
COLUMN_ALIASES: Dict[str, List[str]] = {
    "company": ["company name", "company", "organization", "organisation", "business", "name"],
    "website": ["website", "domain", "company url", "company website", "url"],
    "name": ["decision maker name", "contact name", "person name", "full name", "name", "executive"],
    "linkedin": [
        "decision maker linkedin",
        "decision maker linkedin url",
        "linkedin url",
        "linkedin profile",
        "linkedin",
        "profile url",
    ],
}


# --------------------------------------------------------------------------- #
# Input handling
# --------------------------------------------------------------------------- #
def read_sheet(path: str) -> pd.DataFrame:
    p_lower = path.lower()
    if p_lower.endswith((".xlsx", ".xls")):
        return pd.read_excel(path, dtype=str).fillna("")
    return pd.read_csv(path, dtype=str, encoding="utf-8-sig").fillna("")


def write_sheet(df: pd.DataFrame, path: str) -> None:
    p_lower = path.lower()
    if p_lower.endswith((".xlsx", ".xls")):
        df.to_excel(path, index=False)
    else:
        df.to_csv(path, index=False, encoding="utf-8-sig")


def detect_columns(df: pd.DataFrame) -> Dict[str, str]:
    """Map logical fields -> actual column names (exact match first, then 'contains')."""
    lowered = {str(c): str(c).strip().lower() for c in df.columns}
    found: Dict[str, str] = {}
    for field, aliases in COLUMN_ALIASES.items():
        hit = None
        for alias in aliases:                                   # priority order
            for col, low in lowered.items():
                if low == alias and col not in found.values():
                    hit = col
                    break
            if hit:
                break
        if not hit:
            for alias in aliases:
                for col, low in lowered.items():
                    if alias in low and col not in found.values():
                        hit = col
                        break
                if hit:
                    break
        if hit:
            found[field] = hit
    return found


def clean_domain(site: Optional[str]) -> str:
    site = (site or "").strip().lower()
    site = re.sub(r"^https?://", "", site)
    site = re.sub(r"^www\.", "", site)
    return site.split("/")[0].split("?")[0]


def clean_linkedin(url: Optional[str]) -> str:
    m = re.search(r"linkedin\.com/in/([^/?#\s]+)", url or "", re.I)
    return f"https://www.linkedin.com/in/{m.group(1)}" if m else ""


def split_name(full: Optional[str]) -> Tuple[str, str]:
    parts = re.sub(r",.*$", "", (full or "").strip()).split()
    if not parts:
        return "", ""
    return parts[0], " ".join(parts[1:])


# --------------------------------------------------------------------------- #
# API call
# --------------------------------------------------------------------------- #
def dig(obj: Any, path: str) -> Any:
    """Read 'a.b.0.c' from nested dict/list; returns None if missing."""
    for key in path.split("."):
        if isinstance(obj, list):
            try:
                obj = obj[int(key)]
            except (ValueError, IndexError):
                return None
        elif isinstance(obj, dict):
            obj = obj.get(key)
        else:
            return None
        if obj is None:
            return None
    return obj


def first_value(data: Any, paths: List[str]) -> str:
    for p in paths:
        v = dig(data, p)
        if isinstance(v, list) and v:
            if isinstance(v[0], str) and v[0].strip():
                return v[0].strip()
            if isinstance(v[0], dict):
                val = v[0].get("email") or v[0].get("number") or v[0].get("value") or v[0].get("phone")
                if isinstance(val, str) and val.strip():
                    return val.strip()
        if isinstance(v, dict):                      # e.g. {"email": "x@y.com"}
            val = v.get("email") or v.get("number") or v.get("value") or v.get("phone")
            if isinstance(val, str) and val.strip():
                return val.strip()
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def build_request(cfg: Dict[str, Any], ctx: Dict[str, str], api_key: str) -> Tuple[Dict[str, Any], Dict[str, str], Dict[str, str]]:
    payload: Dict[str, Any] = {}
    for k, tmpl in cfg.get("request_map", {}).items():
        if isinstance(tmpl, bool):
            payload[k] = tmpl
            continue
        try:
            val = str(tmpl).format(**ctx)
            if val.strip():                              # skip empty fields
                payload[k] = val
        except Exception:
            pass

    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    params: Dict[str, str] = {}
    auth_in = cfg.get("auth_in", "header")
    auth_name = cfg.get("auth_name", "x-api-key")
    auth_prefix = cfg.get("auth_prefix", "")

    if auth_in == "query":
        params[auth_name] = api_key
    else:
        headers[auth_name] = f"{auth_prefix}{api_key}"

    return payload, headers, params


def call_api(cfg: Dict[str, Any], ctx: Dict[str, str], api_key: str) -> Tuple[Optional[Any], str]:
    """Returns (parsed_json | None, error_message)."""
    payload, headers, params = build_request(cfg, ctx, api_key)
    method = cfg.get("method", "POST").upper()
    timeout = cfg.get("timeout_seconds", 40)
    url = cfg.get("url", "https://api.leadocean.io/v1/people/enrich")

    # If endpoint placeholder is still present, substitute with default
    if "REPLACE_WITH" in url:
        url = "https://api.leadocean.io/v1/people/enrich"

    max_retries = cfg.get("max_retries", 3)
    for attempt in range(1, max_retries + 1):
        try:
            if method == "GET":
                r = requests.get(url, params={**params, **payload}, headers=headers, timeout=timeout)
            else:
                r = requests.request(method, url, params=params, json=payload, headers=headers, timeout=timeout)

            if r.status_code in (429, 500, 502, 503, 504):
                wait = int(r.headers.get("Retry-After", 2 * attempt)) if r.headers.get("Retry-After", "").isdigit() else 2 * attempt
                time.sleep(wait)
                continue
            if r.status_code in (401, 403):
                return None, f"auth_failed_http_{r.status_code}"
            if r.status_code == 402:
                return None, "credits_required_http_402"
            if r.status_code == 404:
                return {}, "not_found"
            if r.status_code >= 400:
                return None, f"http_{r.status_code}: {r.text[:120]}"
            try:
                return r.json(), ""
            except ValueError:
                return None, "invalid_json_response"
        except requests.RequestException as e:
            if attempt == max_retries:
                return None, f"network_error: {e}"
            time.sleep(1.5 * attempt)
    return None, "failed_after_retries"


# --------------------------------------------------------------------------- #
# Main enrichment
# --------------------------------------------------------------------------- #
def enrich_dataframe(
    df: pd.DataFrame,
    cfg: Dict[str, Any],
    api_key: str,
    limit: int = 0,
    overwrite: bool = False,
    dry_run: bool = False,
    debug: bool = False,
    checkpoint_path: Optional[str] = None,
    progress: Callable[[str], None] = print,
) -> pd.DataFrame:
    cols = detect_columns(df)
    if "linkedin" not in cols and "name" not in cols:
        raise ValueError(f"Need a LinkedIn URL or decision-maker name column. Found: {list(df.columns)}")
    progress(f"Detected columns: {cols}")

    for c in ("Email", "Phone", "Enrich Status"):
        if c not in df.columns:
            df[c] = ""

    todo = [i for i in df.index if overwrite or not str(df.at[i, "Email"]).strip()]
    if limit:
        todo = todo[:limit]
    progress(f"{len(todo)} rows to enrich")

    shown_debug = False
    for n, i in enumerate(todo, 1):
        row = df.loc[i]
        linkedin = clean_linkedin(row[cols["linkedin"]]) if "linkedin" in cols else ""
        name = str(row[cols["name"]]).strip() if "name" in cols else ""
        first, last = split_name(name)
        ctx = {
            "linkedin": linkedin,
            "name": name,
            "first_name": first,
            "last_name": last,
            "company": str(row[cols["company"]]).strip() if "company" in cols else "",
            "domain": clean_domain(row[cols["website"]]) if "website" in cols else "",
        }
        if not linkedin and not (name and (ctx["company"] or ctx["domain"])):
            df.at[i, "Enrich Status"] = "skipped_missing_input"
            continue

        if dry_run:
            payload, _, _ = build_request(cfg, ctx, "***")
            progress(f"[{n}/{len(todo)}] DRY RUN -> {cfg['method']} {cfg['url']} {json.dumps(payload)}")
            continue

        data, err = call_api(cfg, ctx, api_key)
        if debug and not shown_debug and data is not None:
            progress("RAW RESPONSE (first row):\n" + json.dumps(data, indent=2)[:2000])
            shown_debug = True
        if data is None:
            df.at[i, "Enrich Status"] = f"error: {err}"
        else:
            email = first_value(data, cfg["email_paths"])
            phone = first_value(data, cfg["phone_paths"])
            df.at[i, "Email"] = email
            df.at[i, "Phone"] = phone
            df.at[i, "Enrich Status"] = "found" if (email or phone) else "no_data"

        progress(
            f"[{n}/{len(todo)}] {name or ctx['company']}: {df.at[i, 'Enrich Status']} "
            f"{df.at[i, 'Email']} {df.at[i, 'Phone']}"
        )

        if checkpoint_path and n % 25 == 0:          # save progress so a crash loses little
            write_sheet(df, checkpoint_path)
        time.sleep(cfg.get("delay_seconds", 0.5))
    return df


def load_config(path: str = "leadocean_config.json") -> Dict[str, Any]:
    # Look in provided path, current directory, parent directory
    candidates = [Path(path), Path(__file__).resolve().parent / path, Path(__file__).resolve().parent.parent / path]
    found_file = None
    for c in candidates:
        if c.exists():
            found_file = c
            break

    if not found_file:
        return DEFAULT_CONFIG

    try:
        with open(found_file, encoding="utf-8") as fh:
            user_cfg = json.load(fh)
        merged = {**DEFAULT_CONFIG, **user_cfg}
        return merged
    except Exception as e:
        logger.warning(f"Failed to read {found_file}: {e}, using default config")
        return DEFAULT_CONFIG


# --------------------------------------------------------------------------- #
# Class wrapper for FastAPI & React App
# --------------------------------------------------------------------------- #
@dataclass
class ContactEnrichmentResult:
    company_name: str
    decision_maker_name: str = ""
    decision_maker_linkedin: str = ""
    website: str = ""
    domain: str = ""
    email: str = ""
    phone: str = ""
    enrich_status: str = "no_data"  # "found" | "no_data" | "error" | "skipped_missing_input"
    raw_error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "company_name": self.company_name,
            "decision_maker_name": self.decision_maker_name,
            "decision_maker_linkedin": self.decision_maker_linkedin,
            "website": self.website,
            "domain": self.domain,
            "email": self.email,
            "phone": self.phone,
            "enrich_status": self.enrich_status,
            "raw_error": self.raw_error,
        }


class LeadOceanEnricher:
    def __init__(self, api_key: Optional[str] = None, config_path: str = "leadocean_config.json"):
        self.config = load_config(config_path)
        env_key_name = self.config.get("api_key_env", "LEADOCEAN_API_KEY")
        self.api_key = (api_key or os.environ.get(env_key_name, "") or os.environ.get("LEADOCEAN_API_KEY", "")).strip()

    def enrich_single(
        self,
        company: str = "",
        website: str = "",
        name: str = "",
        linkedin_url: str = "",
        api_key: Optional[str] = None,
    ) -> ContactEnrichmentResult:
        key = (api_key or self.api_key).strip()
        comp = (company or "").strip()
        web = (website or "").strip()
        nm = (name or "").strip()
        li = clean_linkedin(linkedin_url)
        dom = clean_domain(web)
        first, last = split_name(nm)

        ctx = {
            "linkedin": li,
            "name": nm,
            "first_name": first,
            "last_name": last,
            "company": comp,
            "domain": dom,
        }

        if not li and not (nm and (comp or dom)):
            return ContactEnrichmentResult(
                company_name=comp,
                decision_maker_name=nm,
                decision_maker_linkedin=li,
                website=web,
                domain=dom,
                enrich_status="skipped_missing_input",
                raw_error="Please provide either a LinkedIn URL or Decision Maker Name + Company/Domain",
            )

        if not key:
            return ContactEnrichmentResult(
                company_name=comp,
                decision_maker_name=nm,
                decision_maker_linkedin=li,
                website=web,
                domain=dom,
                enrich_status="error",
                raw_error="LEADOCEAN_API_KEY is missing. Please configure LEADOCEAN_API_KEY in .env or Settings.",
            )

        data, err = call_api(self.config, ctx, key)
        if data is None:
            return ContactEnrichmentResult(
                company_name=comp,
                decision_maker_name=nm,
                decision_maker_linkedin=li,
                website=web,
                domain=dom,
                enrich_status=f"error: {err}",
                raw_error=err,
            )

        email = first_value(data, self.config.get("email_paths", DEFAULT_CONFIG["email_paths"]))
        phone = first_value(data, self.config.get("phone_paths", DEFAULT_CONFIG["phone_paths"]))
        status = "found" if (email or phone) else "no_data"

        return ContactEnrichmentResult(
            company_name=comp,
            decision_maker_name=nm,
            decision_maker_linkedin=li,
            website=web,
            domain=dom,
            email=email,
            phone=phone,
            enrich_status=status,
        )


# --------------------------------------------------------------------------- #
# CLI entrypoint
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(description="Add email + phone to a lead sheet using the LeadOcean API.")
    ap.add_argument("--init-config", action="store_true", help="write a template leadocean_config.json and exit")
    ap.add_argument("--config", default="leadocean_config.json")
    ap.add_argument("--input", help="CSV or XLSX file")
    ap.add_argument("--output", help="output path (default: <input>_enriched.<ext>)")
    ap.add_argument("--api-key", default=os.getenv("LEADOCEAN_API_KEY"))
    ap.add_argument("--company", help="Single test company")
    ap.add_argument("--name", help="Decision maker name for test")
    ap.add_argument("--linkedin", help="Decision maker LinkedIn URL for test")
    ap.add_argument("--website", help="Company website for test")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--overwrite", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()

    if args.init_config:
        with open(args.config, "w", encoding="utf-8") as fh:
            json.dump(DEFAULT_CONFIG, fh, indent=2)
        print(f"Wrote {args.config}. Fill in url/auth/request_map/response paths, then run again.")
        return

    # Single lookup mode
    if args.name or args.linkedin or args.company:
        api_key = args.api_key or os.getenv("LEADOCEAN_API_KEY", "")
        if not api_key and not args.dry_run:
            sys.exit("No API key. Set LEADOCEAN_API_KEY or pass --api-key.")
        enricher = LeadOceanEnricher(api_key=api_key, config_path=args.config)
        res = enricher.enrich_single(
            company=args.company or "",
            website=args.website or "",
            name=args.name or "",
            linkedin_url=args.linkedin or "",
        )
        print(f"Status: {res.enrich_status}")
        print(f"Email : {res.email or 'Not found'}")
        print(f"Phone : {res.phone or 'Not found'}")
        if res.raw_error:
            print(f"Error : {res.raw_error}")
        return

    if not args.input:
        ap.error("--input is required (or pass --name / --linkedin / --company for a quick test)")

    cfg = load_config(args.config)
    cfg_key = os.getenv(cfg.get("api_key_env", "LEADOCEAN_API_KEY"))
    api_key = args.api_key or cfg_key
    if not api_key and not args.dry_run:
        sys.exit("No API key. Set LEADOCEAN_API_KEY or pass --api-key.")

    base, ext = os.path.splitext(args.input)
    output = args.output or f"{base}_enriched{ext}"
    df = read_sheet(args.input)
    df = enrich_dataframe(
        df,
        cfg,
        api_key,
        args.limit,
        args.overwrite,
        args.dry_run,
        args.debug,
        checkpoint_path=output,
    )
    if not args.dry_run:
        write_sheet(df, output)
        found = (df["Enrich Status"] == "found").sum()
        print(f"Done. {found} rows enriched. Saved to {output}")


if __name__ == "__main__":
    main()
