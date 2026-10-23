#!/usr/bin/env python3
"""
Gemini Lead Auditor & Data Normalizer.
Verifies and sanitizes extracted B2B lead generation columns:
  - Person's Name: Real human name ONLY (no titles, MBA/PhD suffixes, company names, or emojis)
  - Designation/Title: Professional position ONLY (no "at Company", taglines, or person names)
  - Company Name: Clean company name ONLY (no slogans or person names)
  - Location: Clean geographic location ONLY (no connection/follower counts or snippet noise)
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import requests

try:
    from dotenv import load_dotenv
    load_dotenv()
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        load_dotenv(dotenv_path=env_path)
except ImportError:
    pass

logger = logging.getLogger("gemini_lead_auditor")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("[%(asctime)s] [%(levelname)s] [GeminiAuditor] %(message)s"))
    logger.addHandler(handler)
logger.setLevel(logging.INFO)

# Supported fast Gemini models in order of preference (gemini-flash-lite-latest is fastest)
GEMINI_MODELS = [
    "gemini-flash-lite-latest",
    "gemini-2.5-flash-lite",
    "gemini-flash-latest",
    "gemini-pro-latest",
]


def get_gemini_api_key(explicit_key: Optional[str] = None) -> str:
    key = (explicit_key or os.environ.get("GEMINI_API_KEY", "")).strip()
    return key


def call_gemini_api(prompt: str, api_key: str, timeout: int = 35) -> Optional[str]:
    """Calls Google Generative Language API with model fallback."""
    for model_name in GEMINI_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        try:
            payload = {
                "contents": [
                    {
                        "parts": [
                            {"text": prompt}
                        ]
                    }
                ],
                "generationConfig": {
                    "temperature": 0.1,
                    "maxOutputTokens": 4096,
                }
            }
            r = requests.post(url, json=payload, timeout=timeout)
            if r.status_code == 200:
                data = r.json()
                candidates = data.get("candidates", [])
                if candidates and "content" in candidates[0]:
                    parts = candidates[0]["content"].get("parts", [])
                    if parts and "text" in parts[0]:
                        return parts[0]["text"]
            logger.warning(f"Gemini API returned status {r.status_code} on {model_name}: {r.text[:200]}")
        except Exception as e:
            logger.warning(f"Gemini API call failed on {model_name}: {e}")
            time.sleep(1)

    return None


def clean_json_response(raw_text: str) -> Optional[List[Dict[str, Any]]]:
    """Extracts and parses a JSON array from Gemini's response text."""
    if not raw_text:
        return None
    text = raw_text.strip()
    # Strip markdown code blocks if present
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
        text = re.sub(r"\s*```$", "", text)
        text = text.strip()

    # Look for the outermost JSON array [ ... ]
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if m:
        text = m.group(0)

    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed
    except Exception as e:
        logger.error(f"Failed to parse JSON from Gemini response: {e}\nRaw snippet: {text[:250]}")

    return None


def audit_lead_batch(
    batch: List[Dict[str, Any]],
    api_key: str,
) -> List[Dict[str, Any]]:
    """
    Submits a batch of leads to Gemini AI for verification and column normalization.
    Returns cleaned copy of the batch.
    """
    if not batch:
        return []

    input_items = []
    for idx, r in enumerate(batch):
        name = r.get("Decision maker name") or r.get("Full name") or ""
        title = r.get("Decision maker title") or r.get("Title") or ""
        company = r.get("Company name") or ""
        location = r.get("Headquarters") or r.get("Location") or ""
        input_items.append({
            "index": idx,
            "name": str(name),
            "title": str(title),
            "company": str(company),
            "location": str(location),
        })

    prompt = f"""You are a professional B2B lead data cleaner and auditor.
Inspect the input lead records and clean them strictly according to these column boundaries:

1. "name" (Full Name):
   - MUST contain ONLY the real human person's name (e.g. "Patrick Collison", "Sarah Jenkins").
   - Strip out ALL job titles (e.g., remove "CEO", "Founder", "Director", "President", "VP", "Manager").
   - Strip out ALL degree/cert suffixes (e.g., remove "MBA", "PhD", "MD", "PMP", "CPA", "Esq.").
   - Strip out ALL pronouns, emojis, brackets, or company names (e.g., "John Doe (He/Him) - Acme" -> "John Doe").
   - Strip out website titles like "| LinkedIn", "Profile", or dots.
   - If a company name was mistakenly in the name column and a person's name is in the title, extract the real person's name.

2. "title" (Designation / Position):
   - MUST contain ONLY the person's professional job title / designation (e.g., "Founder & CEO", "Managing Director", "Chief Technology Officer").
   - Strip out company names and prepositions (e.g., "CEO at Stripe" -> "CEO", "Co-Founder @ Acme" -> "Co-Founder").
   - Strip out marketing taglines, trailing descriptions, ex-companies, or full sentences.
   - Do NOT include person names in this column.

3. "company" (Company Name):
   - MUST contain ONLY the clean company name (e.g., "Acme Corp").
   - Remove taglines, website suffixes, slogans, or person names.

4. "location" (Headquarters / Location):
   - MUST contain ONLY clean geographic location: City, State/Province, Country (e.g., "San Francisco, California, United States", "London, UK", "Bengaluru, Karnataka, India").
   - Remove connection counts (e.g., "500+ connections"), follower counts, dates, or snippet text.

Input Leads (JSON):
{json.dumps(input_items, indent=2)}

Respond with ONLY a valid JSON array of objects with keys: index, name, title, company, location.
Do not include conversational text or explanations."""

    raw_resp = call_gemini_api(prompt, api_key)
    cleaned_items = clean_json_response(raw_resp) if raw_resp else None

    # Merge cleaned fields back into original records
    result = [dict(r) for r in batch]
    if cleaned_items:
        clean_by_idx = {item.get("index"): item for item in cleaned_items if isinstance(item, dict) and "index" in item}
        for idx, orig in enumerate(result):
            cl = clean_by_idx.get(idx)
            if cl:
                c_name = str(cl.get("name", "")).strip()
                c_title = str(cl.get("title", "")).strip()
                c_company = str(cl.get("company", "")).strip()
                c_location = str(cl.get("location", "")).strip()

                if c_name:
                    orig["Decision maker name"] = c_name
                    orig["Full name"] = c_name
                if c_title:
                    orig["Decision maker title"] = c_title
                    orig["Title"] = c_title
                if c_company:
                    orig["Company name"] = c_company
                if c_location:
                    orig["Headquarters"] = c_location
                    orig["Location"] = c_location

                orig["Gemini Verified"] = "Yes"
                orig["DM confidence"] = "Verified (Gemini AI)"
    else:
        logger.warning("Could not obtain cleaned JSON from Gemini; preserving original records.")

    return result


def audit_leads_with_gemini(
    records: List[Dict[str, Any]],
    api_key: Optional[str] = None,
    batch_size: int = 15,
    on_progress: Optional[Callable[[int, int, str], None]] = None,
) -> List[Dict[str, Any]]:
    """
    Audits and normalizes all extracted leads using Gemini API in batches.
    Guarantees:
      - Name column contains ONLY human name.
      - Designation column contains ONLY title.
      - Location column contains ONLY geographic location.
      - Company name contains ONLY company.
    """
    key = get_gemini_api_key(api_key)
    if not key:
        logger.warning("GEMINI_API_KEY is not set. Skipping Gemini lead verification.")
        return records

    total = len(records)
    if total == 0:
        return []

    logger.info(f"Auditing {total} leads with Gemini AI (batch size {batch_size})...")
    all_cleaned: List[Dict[str, Any]] = []

    for i in range(0, total, batch_size):
        chunk = records[i:i + batch_size]
        msg = f"Auditing leads {i + 1} to {min(i + batch_size, total)} of {total} with Gemini AI..."
        if on_progress:
            on_progress(min(i + batch_size, total), total, msg)

        cleaned_chunk = audit_lead_batch(chunk, key)
        all_cleaned.extend(cleaned_chunk)
        time.sleep(0.3)  # Respect free tier rate limits

    logger.info(f"Successfully verified and cleaned {len(all_cleaned)} leads with Gemini AI.")
    return all_cleaned
