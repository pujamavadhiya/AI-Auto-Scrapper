#!/usr/bin/env python3
"""
Lead Enricher  (email + phone via the LeadOcean API)

Input sheet (CSV or XLSX) with columns like:
    company name | website | decision maker name | decision maker linkedin url
Output: same sheet + "Email", "Phone", "Enrich Status" columns.

LeadOcean API (/v1/people/enrich):
    - Method: POST
    - Header: x-api-key: <key>
    - Payload: {"linkedin_url": "https://www.linkedin.com/in/...", "reveal_email": true}
    - Response: { "data": { "contact_data": { "contact_emails": [...], "contact_phones": [...] } } }
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

CONFIG_PATH = "leadocean_config.json"

DEFAULT_CONFIG: Dict[str, Any] = {
    "_help": "LeadOcean API Configuration. The /v1/people/enrich endpoint requires 'linkedin_url' and 'reveal_email': true.",
    "url": "https://api.leadocean.io/v1/people/enrich",
    "method": "POST",
    "api_key_env": "LEADOCEAN_API_KEY",
    "auth_in": "header",              # "header" or "query"
    "auth_name": "x-api-key",         # header name, or query-param name if auth_in = "query"
    "auth_prefix": "",                # e.g. "Bearer " or "" (for x-api-key style headers)
    "request_map": {
        "linkedin_url": "{linkedin}",
        "reveal_email": True,
    },
    "email_paths": [
        "data.contact_data.contact_emails",
        "data.contact_data.contact_emails.0.email",
        "contact_data.contact_emails.0.email",
        "data.email",
        "email",
    ],
    "phone_paths": [
        "data.contact_data.contact_phones",
        "data.contact_data.contact_phones.0.phone",
        "contact_data.contact_phones.0.phone",
        "data.phone",
        "phone",
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
                val = v[0].get("email") or v[0].get("phone") or v[0].get("number") or v[0].get("value")
                if isinstance(val, str) and val.strip():
                    return val.strip()
        if isinstance(v, dict):
            val = v.get("email") or v.get("phone") or v.get("number") or v.get("value")
            if isinstance(val, str) and val.strip():
                return val.strip()
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def extract_email(data: Any, preferred_domain: str = "") -> str:
    """Extracts the best email from LeadOcean response (matching company domain first)."""
    if not isinstance(data, dict):
        return ""

    contact_emails = (
        data.get("data", {}).get("contact_data", {}).get("contact_emails")
        or data.get("contact_data", {}).get("contact_emails")
        or []
    )

    clean_dom = (preferred_domain or "").lower().replace("www.", "").strip()

    if isinstance(contact_emails, list) and contact_emails:
        # First priority: email matching the company's domain
        if clean_dom:
            for item in contact_emails:
                em = item.get("email") if isinstance(item, dict) else (str(item) if isinstance(item, str) else "")
                if em and f"@{clean_dom}" in em.lower():
                    return em.strip()

        # Second priority: work email
        for item in contact_emails:
            if isinstance(item, dict):
                if item.get("type") in ("work", "work_primary") and item.get("email"):
                    return str(item["email"]).strip()

        # Third priority: first valid email
        for item in contact_emails:
            em = item.get("email") if isinstance(item, dict) else (str(item) if isinstance(item, str) else "")
            if em and "@" in em:
                return em.strip()

    # Fallback to configured paths
    return first_value(data, [
        "data.contact_data.contact_emails.0.email",
        "contact_data.contact_emails.0.email",
        "data.email",
        "email",
    ])


def extract_phone(data: Any) -> str:
    """Extracts the best direct phone number from LeadOcean response."""
    if not isinstance(data, dict):
        return ""

    contact_phones = (
        data.get("data", {}).get("contact_data", {}).get("contact_phones")
        or data.get("contact_data", {}).get("contact_phones")
        or []
    )

    if isinstance(contact_phones, list) and contact_phones:
        for item in contact_phones:
            ph = item.get("phone") if isinstance(item, dict) else (str(item) if isinstance(item, str) else "")
            if ph and isinstance(ph, str) and len(re.sub(r"\D", "", ph)) >= 7:
                return ph.strip()

    # Fallback to configured paths
    return first_value(data, [
        "data.contact_data.contact_phones.0.phone",
        "contact_data.contact_phones.0.phone",
        "data.phone",
        "phone",
    ])


def build_request(cfg: Dict[str, Any], ctx: Dict[str, str], api_key: str) -> Tuple[Dict[str, Any], Dict[str, str], Dict[str, str]]:
    url = cfg.get("url", "https://api.leadocean.io/v1/people/enrich")
    is_leadocean_enrich = "leadocean.io/v1/people/enrich" in url

    payload: Dict[str, Any] = {}

    if is_leadocean_enrich:
        # LeadOcean strictly requires exactly one identifier: linkedin_url, email, phone, or person_id
        # and rejects unrecognized fields like full_name, company, domain.
        payload = {"reveal_email": True}
        if ctx.get("linkedin"):
            payload["linkedin_url"] = ctx["linkedin"]
        elif ctx.get("email"):
            payload["email"] = ctx["email"]
        elif ctx.get("phone"):
            payload["phone"] = ctx["phone"]
    else:
        # Generic provider template
        for k, tmpl in cfg.get("request_map", {}).items():
            if isinstance(tmpl, bool):
                payload[k] = tmpl
                continue
            try:
                val = str(tmpl).format(**ctx).strip()
                if val:
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
                return None, f"http_{r.status_code}: {r.text[:140]}"
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
        comp = str(row[cols["company"]]).strip() if "company" in cols else ""
        domain = clean_domain(row[cols["website"]]) if "website" in cols else ""
        first, last = split_name(name)

        if not linkedin and name and comp:
            try:
                try:
                    from decision_maker_finder import find_decision_maker
                except ImportError:
                    from backend.decision_maker_finder import find_decision_maker
                dm = find_decision_maker(comp, domain, "")
                if dm and dm.get("url"):
                    linkedin = clean_linkedin(dm["url"])
                    progress(f"    Resolved LinkedIn URL: {linkedin}")
            except Exception:
                pass

        ctx = {
            "linkedin": linkedin,
            "name": name,
            "first_name": first,
            "last_name": last,
            "company": comp,
            "domain": domain,
        }

        if not linkedin:
            df.at[i, "Enrich Status"] = "skipped_missing_input"
            progress(f"[{n}/{len(todo)}] {name or comp}: skipped (LinkedIn URL required for LeadOcean)")
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
            email = extract_email(data, domain)
            phone = extract_phone(data)
            df.at[i, "Email"] = email
            df.at[i, "Phone"] = phone
            df.at[i, "Enrich Status"] = "found" if (email or phone) else "no_data"

        progress(
            f"[{n}/{len(todo)}] {name or comp}: {df.at[i, 'Enrich Status']} "
            f"Email: {df.at[i, 'Email'] or '-'} | Phone: {df.at[i, 'Phone'] or '-'}"
        )

        if checkpoint_path and n % 25 == 0:
            write_sheet(df, checkpoint_path)
        time.sleep(cfg.get("delay_seconds", 0.5))

    return df


def load_config(path: str = CONFIG_PATH) -> Dict[str, Any]:
    candidates = [
        Path(path),
        Path(__file__).resolve().parent / path,
        Path(__file__).resolve().parent.parent / path,
    ]
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
    def __init__(self, api_key: Optional[str] = None, config_path: str = CONFIG_PATH):
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

        # If LinkedIn URL is missing, attempt to resolve via SerpApi DecisionMakerFinder
        if not li and comp:
            try:
                try:
                    from decision_maker_finder import find_decision_maker
                except ImportError:
                    from backend.decision_maker_finder import find_decision_maker
                dm = find_decision_maker(comp, web, "")
                if dm and dm.get("url"):
                    li = clean_linkedin(dm["url"])
                    if not nm and dm.get("name"):
                        nm = dm["name"]
            except Exception as e:
                logger.debug(f"Could not auto-resolve LinkedIn: {e}")

        if not li:
            return ContactEnrichmentResult(
                company_name=comp,
                decision_maker_name=nm,
                decision_maker_linkedin=li,
                website=web,
                domain=dom,
                enrich_status="skipped_missing_input",
                raw_error="LeadOcean requires a verified LinkedIn profile URL to retrieve email and phone.",
            )

        ctx = {
            "linkedin": li,
            "name": nm,
            "first_name": first,
            "last_name": last,
            "company": comp,
            "domain": dom,
        }

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

        email = extract_email(data, dom)
        phone = extract_phone(data)
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
    ap.add_argument("--config", default=CONFIG_PATH)
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
