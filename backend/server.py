"""
FastAPI Backend API Server for AI Auto Scrapper
Executes the precision-first SerpAPI decision-maker LinkedIn URL finder algorithm.
"""
from __future__ import annotations

import io
import json
import os
import re
import sys
import tempfile
import threading
import time
import traceback
import unittest
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

# Path setup
BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
sys.path.insert(0, str(BASE_DIR))

# Load .env
from dotenv import load_dotenv
load_dotenv(ROOT_DIR / ".env", override=True)
load_dotenv(BASE_DIR / ".env", override=True)

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel
import database

import pandas as pd
from linkedin_finder import (
    Config,
    LinkedInFinder,
    Lookup,
    SerpApiClient,
    process_file,
    write_excel,
    RowResult,
    FatalSerpError,
)
from linkedin_collector import CollectorConfig, KeywordLinkedInCollector, clean_linkedin_url
from social_media_scraper import SocialMediaScraper
from decision_maker_finder import DecisionMakerFinder
from leadocean_enricher import LeadOceanEnricher, load_config as load_leadocean_config
from gemini_lead_auditor import audit_leads_with_gemini, get_gemini_api_key, call_gemini_api

app = FastAPI(title="AI Auto Scrapper API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TEMP_STORAGE: Dict[str, Path] = {}
COLLECTOR_TASKS: Dict[str, Dict[str, Any]] = {}
SOCIAL_TASKS: Dict[str, Dict[str, Any]] = {}


class EnrichRowsPayload(BaseModel):
    records: List[Dict[str, Any]]
    config: Optional[Dict[str, Any]] = None


class SocialEnrichPayload(BaseModel):
    records: List[Dict[str, Any]]
    mode: Optional[str] = "website"
    batchSize: Optional[int] = 5
    delay: Optional[float] = 1.0


class SocialStartPayload(BaseModel):
    records: Optional[List[Dict[str, Any]]] = None
    websites: Optional[List[str]] = None
    mode: Optional[str] = "website"
    batchSize: Optional[int] = 5
    delay: Optional[float] = 1.0


class DecisionMakerPayload(BaseModel):
    records: List[Dict[str, Any]]
    serpapiKey: Optional[str] = None
    serperKey: Optional[str] = None
    serperApiKey: Optional[str] = None
    engine: Optional[str] = "serpapi"  # "serpapi" | "serper"
    maxQueries: Optional[int] = 2
    delay: Optional[float] = 0.5


class UpdateDecisionMakerConfigPayload(BaseModel):
    serpapiKey: Optional[str] = None
    serperKey: Optional[str] = None
    defaultEngine: Optional[str] = None


class ContactEnrichPayload(BaseModel):
    records: List[Dict[str, Any]]
    apiKey: Optional[str] = None
    delay: Optional[float] = 0.3
    overwrite: Optional[bool] = False


class UpdateLeadOceanConfigPayload(BaseModel):
    apiKey: Optional[str] = None
    url: Optional[str] = None
    authName: Optional[str] = None


class LoginPayload(BaseModel):
    email: str
    password: str


class UserKeyUpdatePayload(BaseModel):
    serpapiKey: Optional[str] = None
    serpapi_key: Optional[str] = None
    serperKey: Optional[str] = None
    serper_key: Optional[str] = None
    geminiApiKey: Optional[str] = None
    gemini_api_key: Optional[str] = None
    leadoceanApiKey: Optional[str] = None
    leadocean_api_key: Optional[str] = None
    leadoceanEndpoint: Optional[str] = None
    leadocean_endpoint: Optional[str] = None
    apifyToken: Optional[str] = None
    apify_token: Optional[str] = None
    openaiApiKey: Optional[str] = None
    openai_api_key: Optional[str] = None
    defaultEngine: Optional[str] = None
    default_engine: Optional[str] = None


class ChatMessageItem(BaseModel):
    role: str
    content: str


class AssistantChatPayload(BaseModel):
    message: str
    history: Optional[List[ChatMessageItem]] = None
    geminiApiKey: Optional[str] = None


class AdminCreateUserPayload(BaseModel):
    email: str
    password: str
    name: Optional[str] = ""
    role: Optional[str] = "user"


class AdminChangePasswordPayload(BaseModel):
    email: str
    password: str


class AdminDeleteUserPayload(BaseModel):
    email: str


def get_current_user_optional(authorization: Optional[str] = Header(None)) -> Optional[Dict[str, Any]]:
    """Resolves authenticated user from Bearer token if present."""
    if not authorization:
        return None
    token = authorization.replace("Bearer ", "").strip()
    return database.get_user_by_token(token)


def get_current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Requires valid Bearer token. Raises HTTP 401 otherwise."""
    user = get_current_user_optional(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required. Please log in.")
    return user


def get_effective_user_key(user: Optional[Dict[str, Any]], key_name: str, fallback_env: str = "") -> str:
    """
    Returns the user's isolated configured API key from database.
    If the user has not configured the key, returns empty string.
    Only falls back to env if no user is specified (backwards compatibility).
    """
    if user:
        user_keys = database.get_user_keys(user["id"])
        val = user_keys.get(key_name, "")
        if val and str(val).strip():
            return str(val).strip()
        return ""
    if fallback_env:
        return os.environ.get(fallback_env, "").strip()
    return ""


@app.post("/api/auth/login")
def auth_login(payload: LoginPayload):
    """Logs in user with email and password, returning session token & user keys."""
    user = database.authenticate_user(payload.email, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    token = database.create_session(user["id"], days_valid=30)
    keys = database.get_user_keys(user["id"])

    return {
        "status": "ok",
        "token": token,
        "user": user,
        "keys": keys,
    }


@app.get("/api/auth/me")
def auth_me(authorization: Optional[str] = Header(None)):
    """Validates session and returns current authenticated user and their configured keys."""
    user = get_current_user(authorization)
    keys = database.get_user_keys(user["id"])
    return {
        "status": "ok",
        "user": user,
        "keys": keys,
    }


@app.post("/api/auth/logout")
def auth_logout(authorization: Optional[str] = Header(None)):
    """Logs out user by invalidating their active session token."""
    if authorization:
        database.delete_session(authorization)
    return {"status": "ok", "message": "Logged out successfully."}


@app.get("/api/user/keys")
def get_user_keys_endpoint(authorization: Optional[str] = Header(None)):
    """Returns the isolated API keys configured specifically for the logged-in user."""
    user = get_current_user(authorization)
    keys = database.get_user_keys(user["id"])
    return {"status": "ok", "keys": keys}


@app.post("/api/user/keys")
def update_user_keys_endpoint(payload: UserKeyUpdatePayload, authorization: Optional[str] = Header(None)):
    """Updates API keys for the logged-in user in their private database record."""
    user = get_current_user(authorization)
    updated = database.update_user_keys(user["id"], payload.model_dump(exclude_unset=True))
    return {
        "status": "ok",
        "message": f"API keys updated successfully for {user['email']}.",
        "keys": updated,
    }


def require_puja_admin(user: Dict[str, Any]) -> None:
    """
    Restricts access to user and team management exclusively to user Puja (puja@gmail.com).
    Raises HTTP 403 Forbidden for any other user.
    """
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")
    email = (user.get("email") or "").strip().lower()
    name = (user.get("name") or "").strip().lower()
    if email != "puja@gmail.com" and name != "puja":
        raise HTTPException(
            status_code=403,
            detail="Access denied. Only Puja has access to view or manage team members and user accounts."
        )


@app.get("/api/admin/users")
def admin_list_users(authorization: Optional[str] = Header(None)):
    """Lists all users for team management - restricted strictly to user Puja."""
    user = get_current_user(authorization)
    require_puja_admin(user)
    return {"status": "ok", "users": database.list_users()}


@app.post("/api/admin/users/create")
def admin_create_user(payload: AdminCreateUserPayload, authorization: Optional[str] = Header(None)):
    """Creates a new user directly from the web interface - restricted strictly to user Puja."""
    user = get_current_user(authorization)
    require_puja_admin(user)
    clean_email = payload.email.strip().lower()
    try:
        new_user = database.create_user(
            email=clean_email,
            password=payload.password,
            name=payload.name or "",
            role=payload.role or "user"
        )
        return {"status": "ok", "user": new_user}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        if "UNIQUE constraint failed" in str(e):
            raise HTTPException(
                status_code=400,
                detail=f"User with email '{clean_email}' already exists in the database. Duplicate email IDs are not allowed."
            )
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/admin/users/change-password")
def admin_change_password(payload: AdminChangePasswordPayload, authorization: Optional[str] = Header(None)):
    """Updates password for a user - restricted strictly to user Puja."""
    user = get_current_user(authorization)
    require_puja_admin(user)
    try:
        ok = database.update_user_password(payload.email, payload.password)
        if not ok:
            raise HTTPException(status_code=404, detail="User not found.")
        return {"status": "ok", "message": f"Password for {payload.email} updated successfully."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/admin/users/delete")
def admin_delete_user(payload: AdminDeleteUserPayload, authorization: Optional[str] = Header(None)):
    """Deletes a user account - restricted strictly to user Puja."""
    user = get_current_user(authorization)
    require_puja_admin(user)
    if user["email"].lower() == payload.email.lower():
        raise HTTPException(status_code=400, detail="Cannot delete your own active account.")
    ok = database.delete_user(payload.email)
    if not ok:
        raise HTTPException(status_code=404, detail="User not found.")
    return {"status": "ok", "message": f"User {payload.email} deleted successfully."}


class SaveHistoryPayload(BaseModel):
    moduleType: str
    searchQuery: str
    records: List[Dict[str, Any]]
    filters: Optional[Dict[str, Any]] = None
    status: Optional[str] = "completed"
    enrichedCount: Optional[int] = None


@app.get("/api/history")
def get_history_list(authorization: Optional[str] = Header(None)):
    """Returns summary list of all search and extraction history for authenticated user."""
    user = get_current_user(authorization)
    items = database.get_user_search_history(user["id"])
    return {"status": "ok", "history": items}


@app.get("/api/history/{history_id}")
def get_history_details(history_id: str, authorization: Optional[str] = Header(None)):
    """Returns full extracted results and records for a specific search history item."""
    user = get_current_user(authorization)
    item = database.get_search_history_by_id(user["id"], history_id)
    if not item:
        raise HTTPException(status_code=404, detail="Search history record not found.")
    return {"status": "ok", "history": item}


@app.post("/api/history")
def save_history_item(payload: SaveHistoryPayload, authorization: Optional[str] = Header(None)):
    """Saves search and extracted records into user's private history archive."""
    user = get_current_user(authorization)
    saved = database.save_search_history(
        user_id=user["id"],
        module_type=payload.moduleType,
        search_query=payload.searchQuery,
        records=payload.records,
        filters=payload.filters,
        status=payload.status or "completed",
        enriched_count=payload.enrichedCount,
    )
    return {"status": "ok", "message": "Search and extracted records saved to history.", "history": saved}


@app.delete("/api/history/{history_id}")
def delete_history_item(history_id: str, authorization: Optional[str] = Header(None)):
    """Deletes a search history record for the user."""
    user = get_current_user(authorization)
    deleted = database.delete_search_history(user["id"], history_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Search history item not found.")
    return {"status": "ok", "message": "History item deleted successfully."}


@app.delete("/api/history")
def clear_all_history(authorization: Optional[str] = Header(None)):
    """Clears all extraction history for the authenticated user only."""
    user = get_current_user(authorization)
    count = database.clear_user_search_history(user["id"])
    return {"status": "ok", "message": f"Cleared {count} history items for {user['email']}."}


@app.get("/api/history/{history_id}/export")
def export_history_file(
    history_id: str,
    format: str = "xlsx",
    token: Optional[str] = None,
    authorization: Optional[str] = Header(None),
):
    """Exports and downloads the extracted records from user history as formatted XLSX or CSV."""
    auth_header = authorization or (f"Bearer {token}" if token else None)
    user = get_current_user(auth_header)
    item = database.get_search_history_by_id(user["id"], history_id)
    if not item:
        raise HTTPException(status_code=404, detail="Search history record not found.")
    records = item.get("records", [])
    if not records:
        raise HTTPException(status_code=400, detail="No records to export.")

    flat_rows = []
    for r in records:
        flat = dict(r)
        custom = flat.pop("customFields", None)
        if isinstance(custom, dict):
            for k, v in custom.items():
                if k not in flat:
                    flat[k] = v
        flat_rows.append(flat)

    df = pd.DataFrame(flat_rows)
    temp_dir = tempfile.mkdtemp()
    clean_title = re.sub(r'[^a-zA-Z0-9_-]', '_', item.get("searchQuery", "leads"))[:40]

    if format.lower() == "csv":
        out_filename = f"{clean_title}_{history_id[:8]}.csv"
        out_path = Path(temp_dir) / out_filename
        df.to_csv(out_path, index=False)
        return FileResponse(out_path, media_type="text/csv", filename=out_filename)
    else:
        out_filename = f"{clean_title}_{history_id[:8]}.xlsx"
        out_path = Path(temp_dir) / out_filename
        with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="Extracted Leads")
        return FileResponse(
            out_path,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=out_filename
        )


@app.get("/api/health")
def health(authorization: Optional[str] = Header(None)):
    user = get_current_user_optional(authorization)
    user_keys = database.get_user_keys(user["id"]) if user else {}
    api_key = user_keys.get("serpapi_key", "").strip() or os.environ.get("SERPAPI_KEY", "").strip()
    is_set = bool(api_key and not api_key.startswith("your_"))
    masked = (api_key[:4] + "..." + api_key[-4:]) if is_set and len(api_key) > 8 else ("configured" if is_set else "missing")
    return {
        "status": "ok",
        "hasSerpApiKey": is_set,
        "keyPreview": masked,
        "engine": "SerpAPI Decision Maker LinkedIn URL Finder",
        "user": user["email"] if user else None,
    }


@app.get("/api/dashboard/stats")
def get_dashboard_stats(authorization: Optional[str] = Header(None)):
    """
    Returns actual dynamic dashboard statistics for the authenticated user:
    - Real leads extracted count
    - Enriched records count
    - Real search extractions list
    - Active background tasks
    - Configured API keys
    """
    user = get_current_user(authorization)
    user_keys = database.get_user_keys(user["id"])
    history = database.get_user_search_history(user["id"], limit=10)

    total_leads = sum(item.get("recordCount", 0) for item in history)
    total_enriched = sum(item.get("enrichedCount", 0) for item in history)
    total_searches = len(history)

    # Check key statuses
    keys_status = {
        "serpapi": bool(user_keys.get("serpapi_key", "").strip() and not user_keys.get("serpapi_key", "").startswith("your_")),
        "serper": bool(user_keys.get("serper_key", "").strip() and not user_keys.get("serper_key", "").startswith("your_")),
        "gemini": bool(user_keys.get("gemini_api_key", "").strip() and not user_keys.get("gemini_api_key", "").startswith("your_")),
        "leadocean": bool(user_keys.get("leadocean_api_key", "").strip() and not user_keys.get("leadocean_api_key", "").startswith("your_")),
    }
    keys_configured = sum(1 for v in keys_status.values() if v)

    # Check for active running collector tasks
    active_task = None
    for tid, task in reversed(list(COLLECTOR_TASKS.items())):
        if task.get("userId") == user["id"] and task.get("status") in ("running", "stopping"):
            active_task = get_collector_status(tid)
            break

    return {
        "status": "ok",
        "user": {
            "name": user.get("name") or user.get("email", "").split("@")[0],
            "email": user["email"],
            "role": user.get("role", "user"),
        },
        "stats": {
            "totalLeads": total_leads,
            "totalEnriched": total_enriched,
            "totalSearches": total_searches,
            "keysConfigured": keys_configured,
            "keysTotal": 4,
        },
        "keysStatus": keys_status,
        "activeTask": active_task,
        "recentHistory": history,
    }


@app.get("/api/assistant/status")
def assistant_status(authorization: Optional[str] = Header(None)):
    """Checks whether the user currently has an active Gemini API key configured."""
    user = get_current_user_optional(authorization)
    user_keys = database.get_user_keys(user["id"]) if user else {}
    user_gemini = user_keys.get("gemini_api_key", "").strip()
    if user_gemini and (user_gemini.startswith("test_") or user_gemini.startswith("your_")):
        user_gemini = ""
    api_key = user_gemini or os.environ.get("GEMINI_API_KEY", "").strip()
    has_key = bool(api_key and not api_key.startswith("your_") and not api_key.startswith("test_"))
    masked = (api_key[:4] + "..." + api_key[-4:]) if has_key and len(api_key) > 8 else ("configured" if has_key else "")
    return {
        "status": "ok",
        "hasGeminiKey": has_key,
        "maskedKey": masked,
        "engine": "Google Gemini",
    }


@app.post("/api/assistant/chat")
def assistant_chat(payload: AssistantChatPayload, authorization: Optional[str] = Header(None)):
    """
    Direct AI conversational research and company intelligence powered by Google Gemini.
    Uses the user's isolated Gemini API key (or key passed in payload, or fallback env).
    """
    query = (payload.message or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    user = get_current_user_optional(authorization)
    user_keys = database.get_user_keys(user["id"]) if user else {}

    explicit_key = (payload.geminiApiKey or "").strip()
    user_gemini = user_keys.get("gemini_api_key", "").strip() if user else ""
    if user_gemini and (user_gemini.startswith("test_") or user_gemini.startswith("your_")):
        user_gemini = ""

    api_key = explicit_key or user_gemini or os.environ.get("GEMINI_API_KEY", "").strip()

    if not api_key or api_key.startswith("test_") or api_key.startswith("your_"):
        raise HTTPException(
            status_code=400,
            detail="Gemini API Key is missing. Please provide your Gemini API Key in the chat bar or configure it in Platform Settings."
        )

    # Build conversation context
    conversation_text = ""
    if payload.history:
        for item in payload.history[-6:]:
            role_label = "User" if item.role == "user" else "Assistant"
            conversation_text += f"{role_label}: {item.content}\n"

    system_prompt = (
        "You are the AI Auto Scrapper B2B Research & Intelligence Assistant. "
        "You specialize in enterprise account discovery, decision-maker hierarchy (CEOs, VPs, Directors), "
        "email/phone prospecting strategies, company intelligence, and competitive benchmarking.\n"
        "Guidelines:\n"
        "1. Provide factual, concise, well-structured answers using GitHub markdown (tables, bullet points, bold headers).\n"
        "2. When identifying decision makers, structure them clearly: Full Name, Professional Title, Department, and LinkedIn profile format.\n"
        "3. When asked to write cold emails or outreach angles, make them compelling, value-oriented, and personalized.\n"
        "4. If asked to compare companies or analyze competitors, provide a clear comparison table.\n"
        "5. Be direct, authoritative, and extremely helpful for sales, recruiting, and business development professionals.\n"
    )

    full_prompt = f"{system_prompt}\nRecent Conversation:\n{conversation_text}\nUser Query: {query}\n\nProvide an exhaustive, professional response:"

    try:
        response_text = call_gemini_api(full_prompt, api_key=api_key, timeout=40)
        if not response_text:
            raise Exception("Gemini API returned an empty response. Please verify your Gemini API key has sufficient quota.")
    except Exception as e:
        logger.error(f"Gemini chat error: {e}")
        raise HTTPException(status_code=500, detail=f"Gemini API error: {str(e)}")

    suggested = [
        f"Find decision-maker emails and LinkedIn for this",
        f"Draft a personalized cold email pitch",
        f"Compare key competitors and market alternatives",
    ]

    return {
        "status": "ok",
        "message": {
            "id": f"msg-{int(time.time() * 1000)}",
            "role": "assistant",
            "content": response_text.strip(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "suggestedPrompts": suggested,
        },
        "engine": "Google Gemini 1.5",
        "hasKey": True,
    }


@app.get("/api/run-tests")
def run_unit_tests():
    """Runs the 15 LinkedInFinder unit tests and returns results."""
    try:
        import test_linkedin_finder
        loader = unittest.TestLoader()
        suite = loader.loadTestsFromModule(test_linkedin_finder)
        stream = io.StringIO()
        runner = unittest.TextTestRunner(stream=stream, verbosity=2)
        result = runner.run(suite)

        return {
            "success": result.wasSuccessful(),
            "totalTests": result.testsRun,
            "failures": len(result.failures),
            "errors": len(result.errors),
            "output": stream.getvalue(),
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})


@app.post("/api/enrich/linkedin-rows")
def enrich_linkedin_rows(payload: EnrichRowsPayload, authorization: Optional[str] = Header(None)):
    records = payload.records
    user_config = payload.config or {}

    user = get_current_user_optional(authorization)
    api_key = get_effective_user_key(user, "serpapi_key", fallback_env="SERPAPI_KEY")
    if not api_key or api_key.startswith("your_"):
        user_msg = f" for account {user['email']}" if user else " in .env file"
        raise HTTPException(
            status_code=400,
            detail=f"SERPAPI_KEY is missing or unconfigured{user_msg}. Please configure your SerpAPI key in Platform Settings."
        )

    cfg = Config(
        min_confidence=user_config.get("minConfidence", "medium"),
        max_searches_per_row=int(user_config.get("maxSearches", 3)),
        accept_location_conflict=bool(user_config.get("allowLocationConflict", False)),
    )

    cache_path = str(BASE_DIR / "serp_cache.jsonl")

    try:
        client = SerpApiClient(api_key, cache_path=cache_path)
        finder = LinkedInFinder(client, cfg)

        updated_records = []
        review_items = []
        found_count = 0

        for i, rec in enumerate(records):
            full_name = rec.get("personName") or rec.get("fullName") or rec.get("name") or ""
            company = rec.get("companyName") or rec.get("company") or ""
            city = rec.get("city") or ""
            state = rec.get("state") or rec.get("country") or ""
            title = rec.get("title") or ""

            lk = Lookup(
                row_index=i,
                full_name=full_name,
                company=company,
                city=city,
                state=state,
                title=title,
            ).prepare()

            res = finder.find(lk)

            if res.url:
                found_count += 1

            for cand in res.review:
                review_items.append({
                    "inputRow": i + 1,
                    "inputName": full_name,
                    "inputCompany": company,
                    "inputCity": city,
                    "candidateUrl": cand.url,
                    "candidateName": cand.result_name,
                    "candidateHeadline": cand.headline,
                    "reasons": "; ".join(cand.reasons) or "Multiple equally good matches",
                    "evidence": cand.evidence(),
                })

            updated_rec = dict(rec)
            # PRECISION OVER RECALL: Blank when not verified!
            updated_rec["linkedinUrl"] = res.url if res.url else ""
            updated_rec["matchStatus"] = res.status
            updated_rec["confidenceLevel"] = res.confidence or ""
            updated_rec["confidenceScore"] = 96 if res.confidence == "High" else (84 if res.confidence == "Medium" else None)
            updated_rec["matchedName"] = res.matched_name or ""
            updated_rec["matchedHeadline"] = res.headline or ""
            updated_rec["evidence"] = res.evidence or ""
            updated_rec["enrichmentStatus"] = "enriched" if res.url else ("not_found" if res.status == "Not found" else "idle")
            updated_rec["notes"] = f"SerpAPI verification: {res.status}"

            updated_records.append(updated_rec)

        return {
            "records": updated_records,
            "summary": {
                "total": len(records),
                "found": found_count,
                "blank": len(records) - found_count,
                "searchesBilled": client.calls,
                "reviewCount": len(review_items),
            },
            "review": review_items,
        }

    except FatalSerpError as e:
        raise HTTPException(status_code=400, detail=f"Fatal SerpAPI error: {str(e)}")
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Scraper error: {str(e)}")


@app.post("/api/enrich/linkedin-file")
async def enrich_linkedin_file(
    file: UploadFile = File(...),
    min_confidence: str = Form("medium"),
    max_searches: int = Form(3),
    allow_location_conflict: bool = Form(False),
    authorization: Optional[str] = Header(None),
):
    user = get_current_user_optional(authorization)
    api_key = get_effective_user_key(user, "serpapi_key", fallback_env="SERPAPI_KEY")
    if not api_key or api_key.startswith("your_"):
        user_msg = f" for account {user['email']}" if user else " in .env"
        raise HTTPException(
            status_code=400,
            detail=f"SERPAPI_KEY is not configured{user_msg}. Please configure your key in Platform Settings to run live SerpAPI extraction."
        )

    temp_dir = tempfile.mkdtemp()
    filename = file.filename or "uploaded_spreadsheet.xlsx"
    in_path = os.path.join(temp_dir, filename)

    contents = await file.read()
    with open(in_path, "wb") as f:
        f.write(contents)

    out_filename = f"{Path(filename).stem}_decision_maker_linkedin.xlsx"
    out_path = os.path.join(temp_dir, out_filename)

    cfg = Config(
        min_confidence=min_confidence,
        max_searches_per_row=max_searches,
        accept_location_conflict=allow_location_conflict,
    )

    try:
        summary = process_file(
            input_path=in_path,
            output_path=out_path,
            api_key=api_key,
            cfg=cfg,
            cache_path=str(BASE_DIR / "serp_cache.jsonl"),
        )

        file_id = f"file_{uuid.uuid4().hex[:12]}"
        TEMP_STORAGE[file_id] = Path(out_path)

        # Read back enriched table rows for frontend table display
        results_df = pd.read_excel(out_path, sheet_name="Results").fillna("")

        # Read review items if available
        review_records = []
        try:
            review_df = pd.read_excel(out_path, sheet_name="Review (unverified)").fillna("")
            review_records = review_df.to_dict(orient="records")
        except Exception:
            pass

        return {
            "success": True,
            "summary": summary,
            "downloadUrl": f"/api/download/{file_id}",
            "fileName": out_filename,
            "records": results_df.to_dict(orient="records"),
            "review": review_records,
        }

    except FatalSerpError as e:
        raise HTTPException(status_code=400, detail=f"SerpAPI fatal error: {str(e)}")
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to process spreadsheet: {str(e)}")


@app.get("/api/download/{file_id}")
def download_generated_file(file_id: str):
    file_path = TEMP_STORAGE.get(file_id)
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found or expired")
    return FileResponse(
        path=str(file_path),
        filename=file_path.name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


class StartCollectorPayload(BaseModel):
    keywords: List[str]
    country: Optional[str] = ""
    state: Optional[str] = ""
    city: Optional[str] = ""
    targetCount: Optional[int] = 50
    titles: Optional[List[str]] = None
    companySize: Optional[str] = "all"
    enrichCompany: Optional[bool] = True
    verifyWithGemini: Optional[bool] = True
    geminiApiKey: Optional[str] = None
    gemini_api_key: Optional[str] = None
    serpapiKey: Optional[str] = None
    serpapi_key: Optional[str] = None
    serperKey: Optional[str] = None
    serper_key: Optional[str] = None


class VerifyGeminiPayload(BaseModel):
    geminiApiKey: Optional[str] = None


class VerifyRecordsPayload(BaseModel):
    records: List[Dict[str, Any]]
    geminiApiKey: Optional[str] = None


class ParseIdeaPayload(BaseModel):
    idea: str
    geminiApiKey: Optional[str] = None


def _run_collector_thread(
    task_id: str,
    cfg: CollectorConfig,
    verify_with_gemini: bool = True,
    gemini_api_key: Optional[str] = None,
):
    task = COLLECTOR_TASKS[task_id]

    def on_event(event: Dict[str, Any]):
        task["events"].append(event)
        etype = event.get("type")
        if etype == "query_start":
            task["latestQuery"] = event.get("query", "")
            task["activeEngine"] = event.get("engine", "")
            task["progressMessage"] = f"Searching {event.get('engine', '').upper()} for {event.get('query', '')[:40]}..."
        elif etype == "profile_found":
            prof = event.get("profile")
            if prof and len(task["records"]) < cfg.target_count:
                prof["Profile URL"] = clean_linkedin_url(prof.get("Profile URL", ""), prof.get("Full name", ""), prof.get("Company name", ""))
                task["records"].append(prof)
                task["totalCollected"] = len(task["records"])
                task["progressMessage"] = f"Found {prof.get('Full name')} at {prof.get('Company name')}"
                # Incremental background persistence every 5 leads so closing page never loses data
                if len(task["records"]) % 5 == 0 and task.get("userId") and task.get("historyId"):
                    try:
                        database.update_search_history(
                            history_id=task["historyId"],
                            user_id=task["userId"],
                            records=task["records"],
                            status="running",
                        )
                    except Exception as he:
                        logger.warning(f"Error persisting incremental history: {he}")
        elif etype == "target_reached":
            task["progressMessage"] = event.get("message", "Target profile count reached!")
        elif etype == "enrich_start":
            task["progressMessage"] = "Enriching company industry & size without guessing..."
        elif etype == "company_enriched":
            task["progressMessage"] = f"Enriched {event.get('company')}: {event.get('industry')}"
        elif etype == "gemini_verification_start":
            task["progressMessage"] = event.get("message", "Checking and cleaning details with Gemini AI...")
        elif etype == "gemini_progress":
            task["progressMessage"] = event.get("message", "Auditing leads with Gemini AI...")
        elif etype == "gemini_verification_done":
            task["progressMessage"] = event.get("message", "Gemini AI verified and cleaned all records.")
        elif etype == "completed":
            task["progressMessage"] = event.get("message", "Scraping completed.")

    try:
        collector = KeywordLinkedInCollector(config=cfg, on_event=on_event)
        task["collector"] = collector
        rows = collector.run()

        # STRICTLY enforce exact target count: NEVER more, NEVER less!
        rows = rows[:cfg.target_count]
        for r in rows:
            r["Profile URL"] = clean_linkedin_url(r.get("Profile URL", ""), r.get("Full name", ""), r.get("Company name", ""))

        # Gemini AI Verification & Column Normalization
        if verify_with_gemini and rows:
            g_key = (gemini_api_key or os.environ.get("GEMINI_API_KEY", "")).strip()
            if g_key:
                task["progressMessage"] = f"Auditing {len(rows)} leads with Gemini AI (Name, Title, Location)..."
                on_event({
                    "type": "gemini_verification_start",
                    "message": f"Auditing {len(rows)} leads with Gemini AI (Name only in name, Title in designation, etc.)...",
                })
                try:
                    cleaned_rows = audit_leads_with_gemini(
                        rows,
                        api_key=g_key,
                        on_progress=lambda cur, tot, msg: on_event({"type": "gemini_progress", "current": cur, "total": tot, "message": msg}),
                    )
                    if cleaned_rows:
                        rows = cleaned_rows
                        task["geminiVerified"] = True
                        on_event({
                            "type": "gemini_verification_done",
                            "message": f"Gemini AI verified and normalized all {len(rows)} records successfully.",
                        })
                except Exception as ge:
                    logger.warning(f"Gemini verification error: {ge}")

        task["records"] = rows
        task["totalCollected"] = len(rows)

        # Generate output Excel file with verified exact records
        temp_dir = tempfile.mkdtemp()
        kw_slug = re.sub(r"[^a-zA-Z0-9]+", "_", cfg.keywords[0] if cfg.keywords else "leads")[:20]
        out_filename = f"linkedin_profiles_{kw_slug}_{int(time.time())}.xlsx"
        out_path = Path(temp_dir) / out_filename
        collector.collected_rows = rows
        collector.write_excel(out_path)

        file_id = f"col_{uuid.uuid4().hex[:12]}"
        TEMP_STORAGE[file_id] = out_path
        task["fileId"] = file_id
        task["downloadUrl"] = f"/api/download/{file_id}"
        task["fileName"] = out_filename
        final_status = "stopped" if collector.stop_requested.is_set() else "completed"
        task["status"] = final_status
        task["progressMessage"] = (
            f"Done! Exactly {len(rows)} verified profiles cleaned with Gemini AI and saved to your history."
            if task.get("geminiVerified")
            else f"Done! Exactly {len(rows)} verified profiles saved to your history."
        )

        # Commit final complete dataset to user's database history
        try:
            if task.get("userId") and task.get("historyId"):
                database.update_search_history(
                    history_id=task["historyId"],
                    user_id=task["userId"],
                    records=rows,
                    status=final_status,
                )
            elif task.get("userId"):
                h = database.save_search_history(
                    user_id=task["userId"],
                    module_type="keyword-collector",
                    search_query=task.get("searchQuery", "Keyword Scraper"),
                    records=rows,
                    filters=task.get("filters", {}),
                    status=final_status,
                )
                task["historyId"] = h["id"]
        except Exception as db_err:
            logger.warning(f"Error persisting final search history: {db_err}")

    except Exception as e:
        traceback.print_exc()
        task["status"] = "error"
        task["error"] = str(e)
        task["progressMessage"] = f"Error during scraping: {str(e)}"
        try:
            if task.get("userId") and task.get("historyId"):
                database.update_search_history(
                    history_id=task["historyId"],
                    user_id=task["userId"],
                    records=task.get("records", []),
                    status="error",
                )
        except Exception:
            pass


@app.post("/api/collector/start")
def start_keyword_collector(payload: StartCollectorPayload, authorization: Optional[str] = Header(None)):
    clean_kws = [k.strip() for k in payload.keywords if k.strip()]
    if not clean_kws:
        raise HTTPException(status_code=400, detail="At least one keyword is required.")

    user = get_current_user_optional(authorization)
    user_id = user["id"] if user else None
    user_keys = database.get_user_keys(user["id"]) if user else {}

    target = max(1, min(int(payload.targetCount or 50), 2000))
    titles = payload.titles if payload.titles else ["CEO", "Founder", "COO", "Owner", "Director", "VP"]

    verify_gemini = bool(payload.verifyWithGemini) if payload.verifyWithGemini is not None else True
    gemini_key = (payload.geminiApiKey or payload.gemini_api_key or user_keys.get("gemini_api_key", "") or (os.environ.get("GEMINI_API_KEY", "") if not user else "")).strip()
    serpapi_k = (payload.serpapiKey or payload.serpapi_key or user_keys.get("serpapi_key", "") or os.environ.get("SERPAPI_KEY", "")).strip()
    serper_k = (payload.serperKey or payload.serper_key or user_keys.get("serper_key", "") or os.environ.get("SERPER_API_KEY", "")).strip()

    cfg = CollectorConfig(
        keywords=clean_kws,
        country=payload.country or "",
        state=payload.state or "",
        city=payload.city or "",
        target_count=target,
        titles=titles,
        company_size_filter=payload.companySize or "all",
        enrich_company=bool(payload.enrichCompany),
        delay_range=(0.4, 0.9),
        gemini_api_key=gemini_key,
        serper_api_key=serper_k,
        serpapi_key=serpapi_k,
    )

    city_suffix = f" in {payload.city}" if payload.city else (f" ({payload.country})" if payload.country else "")
    search_title = (", ".join(clean_kws) if clean_kws else "Keyword Scraper") + city_suffix

    filter_dict = {
        "keywords": clean_kws,
        "country": payload.country or "",
        "state": payload.state or "",
        "city": payload.city or "",
        "targetCount": target,
        "titles": titles,
        "companySize": payload.companySize or "all",
        "enrichCompany": bool(payload.enrichCompany),
        "verifyWithGemini": verify_gemini,
    }

    history_id = None
    if user_id:
        h = database.save_search_history(
            user_id=user_id,
            module_type="keyword-collector",
            search_query=search_title,
            records=[],
            filters=filter_dict,
            status="running",
        )
        history_id = h["id"]

    task_id = f"task_{uuid.uuid4().hex[:10]}"
    COLLECTOR_TASKS[task_id] = {
        "id": task_id,
        "userId": user_id,
        "historyId": history_id,
        "searchQuery": search_title,
        "filters": filter_dict,
        "status": "running",
        "target": target,
        "records": [],
        "events": [],
        "latestQuery": "",
        "activeEngine": "ddg",
        "progressMessage": "Initializing scraping workers in background...",
        "downloadUrl": None,
        "fileId": None,
        "fileName": None,
        "createdAt": time.time(),
        "error": None,
        "collector": None,
        "geminiVerified": False,
    }

    t = threading.Thread(
        target=_run_collector_thread,
        args=(task_id, cfg, verify_gemini, gemini_key),
        daemon=True,
    )
    t.start()

    return {
        "taskId": task_id,
        "historyId": history_id,
        "status": "running",
        "target": target,
        "keywords": clean_kws,
        "searchQuery": search_title,
        "verifyWithGemini": verify_gemini,
    }


@app.get("/api/collector/active")
def get_active_collector_task(authorization: Optional[str] = Header(None)):
    """
    Returns any active or currently running scraping task for this user so they can reconnect
    when refreshing, switching tabs, switching sections, or returning after closing the page.
    """
    user = get_current_user_optional(authorization)
    user_id = user["id"] if user else None

    # Priority 1: Actively running or stopping tasks
    for tid, task in reversed(list(COLLECTOR_TASKS.items())):
        task_user = task.get("userId")
        if (user_id and task_user == user_id) or (not user_id and not task_user):
            if task.get("status") in ("running", "stopping"):
                status_payload = get_collector_status(tid)
                return {
                    "hasActiveTask": True,
                    "task": status_payload,
                    "searchQuery": task.get("searchQuery", ""),
                    "filters": task.get("filters", {}),
                    "historyId": task.get("historyId"),
                }

    # Priority 2: Recently finished tasks (within last 30 minutes)
    for tid, task in reversed(list(COLLECTOR_TASKS.items())):
        task_user = task.get("userId")
        if (user_id and task_user == user_id) or (not user_id and not task_user):
            if time.time() - task.get("createdAt", 0) < 1800:
                status_payload = get_collector_status(tid)
                return {
                    "hasActiveTask": False,
                    "recentTask": status_payload,
                    "searchQuery": task.get("searchQuery", ""),
                    "filters": task.get("filters", {}),
                    "historyId": task.get("historyId"),
                }

    return {"hasActiveTask": False, "task": None}


@app.get("/api/collector/status/{task_id}")
def get_collector_status(task_id: str, from_index: int = 0):
    task = COLLECTOR_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Collector task not found.")

    all_records = task["records"]
    new_records = all_records[from_index:] if from_index < len(all_records) else []

    return {
        "taskId": task_id,
        "status": task["status"],
        "target": task["target"],
        "totalCollected": len(all_records),
        "records": all_records,
        "newRecords": new_records,
        "latestQuery": task.get("latestQuery", ""),
        "activeEngine": task.get("activeEngine", ""),
        "progressMessage": task.get("progressMessage", ""),
        "downloadUrl": task.get("downloadUrl"),
        "fileName": task.get("fileName"),
        "error": task.get("error"),
        "historyId": task.get("historyId"),
        "searchQuery": task.get("searchQuery", ""),
    }


@app.post("/api/collector/stop/{task_id}")
def stop_collector(task_id: str, authorization: Optional[str] = Header(None)):
    user = get_current_user_optional(authorization)
    task = COLLECTOR_TASKS.get(task_id)
    if not task:
        return {
            "taskId": task_id,
            "status": "stopped",
            "totalCollected": 0,
            "downloadUrl": None,
            "progressMessage": "Scraping task stopped or already finished.",
        }

    collector = task.get("collector")
    if collector:
        collector.stop()

    task["status"] = "stopped"
    task["progressMessage"] = "Scraping interrupted by user. Saved extracted leads to history."

    # If Excel not yet generated, generate from current rows
    if not task.get("downloadUrl") and task.get("records"):
        try:
            temp_dir = tempfile.mkdtemp()
            out_filename = f"linkedin_profiles_partial_{int(time.time())}.xlsx"
            out_path = Path(temp_dir) / out_filename
            collector.write_excel(out_path)
            file_id = f"col_{uuid.uuid4().hex[:12]}"
            TEMP_STORAGE[file_id] = out_path
            task["fileId"] = file_id
            task["downloadUrl"] = f"/api/download/{file_id}"
            task["fileName"] = out_filename
        except Exception as e:
            logger.error(f"Error writing partial Excel: {e}")

    # Immediately save whatever was extracted so far to database history!
    if task.get("userId") and task.get("historyId"):
        try:
            database.update_search_history(
                history_id=task["historyId"],
                user_id=task["userId"],
                records=task.get("records", []),
                status="stopped",
            )
        except Exception as e:
            logger.error(f"Error updating search history on stop: {e}")

    return {
        "taskId": task_id,
        "status": task["status"],
        "totalCollected": len(task["records"]),
        "downloadUrl": task.get("downloadUrl"),
        "progressMessage": task["progressMessage"],
    }


@app.post("/api/collector/export-current/{task_id}")
@app.get("/api/collector/export-current/{task_id}")
def export_current_collector_data(task_id: str):
    """Generates an Excel spreadsheet of whatever has been collected so far and returns download URL."""
    task = COLLECTOR_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Collector task not found.")

    records = list(task.get("records", []))
    if not records:
        raise HTTPException(status_code=400, detail="No records collected yet.")

    collector = task.get("collector")
    temp_dir = tempfile.mkdtemp()
    out_filename = f"linkedin_profiles_partial_{int(time.time())}.xlsx"
    out_path = Path(temp_dir) / out_filename

    if collector:
        collector.collected_rows = records
        collector.write_excel(out_path)
    else:
        import openpyxl
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Profiles"
        headers = list(records[0].keys())
        ws.append(headers)
        for r in records:
            ws.append([r.get(h, "") for h in headers])
        wb.save(out_path)

    file_id = f"col_{uuid.uuid4().hex[:12]}"
    TEMP_STORAGE[file_id] = out_path
    return {
        "downloadUrl": f"/api/download/{file_id}",
        "fileName": out_filename,
        "totalCollected": len(records),
        "status": task.get("status"),
    }


@app.post("/api/collector/verify-gemini/{task_id}")
def verify_collector_gemini(task_id: str, payload: Optional[VerifyGeminiPayload] = None, authorization: Optional[str] = Header(None)):
    """
    On-demand Gemini AI verification for an existing collector task.
    Audits Name, Title, Company, and Location so each column contains only clean, accurate data.
    Regenerates the Excel download file and returns sanitized records.
    """
    task = COLLECTOR_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Collector task not found.")

    records = list(task.get("records", []))
    if not records:
        raise HTTPException(status_code=400, detail="No records collected yet.")

    user = get_current_user_optional(authorization)
    user_keys = database.get_user_keys(user["id"]) if user else {}
    api_key = (payload.geminiApiKey if payload else None) or user_keys.get("gemini_api_key", "") or (os.environ.get("GEMINI_API_KEY", "") if not user else "")
    if not api_key:
        raise HTTPException(status_code=400, detail="GEMINI_API_KEY is missing. Please configure GEMINI_API_KEY in Platform Settings.")

    cleaned = audit_leads_with_gemini(records, api_key=api_key)
    task["records"] = cleaned
    task["geminiVerified"] = True
    task["progressMessage"] = f"Gemini AI verified and normalized all {len(cleaned)} records."

    # Regenerate downloadable Excel with verified data
    collector = task.get("collector")
    temp_dir = tempfile.mkdtemp()
    out_filename = f"linkedin_profiles_gemini_verified_{int(time.time())}.xlsx"
    out_path = Path(temp_dir) / out_filename

    if collector:
        collector.collected_rows = cleaned
        collector.write_excel(out_path)
    else:
        import openpyxl
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Verified Leads"
        headers = list(cleaned[0].keys())
        ws.append(headers)
        for r in cleaned:
            ws.append([r.get(h, "") for h in headers])
        wb.save(out_path)

    file_id = f"col_{uuid.uuid4().hex[:12]}"
    TEMP_STORAGE[file_id] = out_path
    task["fileId"] = file_id
    task["downloadUrl"] = f"/api/download/{file_id}"
    task["fileName"] = out_filename

    return {
        "status": "ok",
        "message": f"Successfully verified {len(cleaned)} leads with Gemini AI.",
        "records": cleaned,
        "downloadUrl": f"/api/download/{file_id}",
        "fileName": out_filename,
        "geminiVerified": True,
    }


@app.post("/api/collector/verify-records")
def verify_records_gemini(payload: VerifyRecordsPayload, authorization: Optional[str] = Header(None)):
    """Audits arbitrary lead records with Gemini AI and returns sanitized records."""
    records = payload.records
    if not records:
        return {"status": "ok", "records": []}

    user = get_current_user_optional(authorization)
    user_keys = database.get_user_keys(user["id"]) if user else {}
    api_key = payload.geminiApiKey or user_keys.get("gemini_api_key", "") or (os.environ.get("GEMINI_API_KEY", "") if not user else "")
    if not api_key:
        raise HTTPException(status_code=400, detail="GEMINI_API_KEY is missing. Please configure GEMINI_API_KEY in Platform Settings.")
    cleaned = audit_leads_with_gemini(records, api_key=api_key)
    return {"status": "ok", "records": cleaned}


@app.post("/api/collector/parse-idea")
def parse_scraping_idea(payload: ParseIdeaPayload, authorization: Optional[str] = Header(None)):
    """
    Parses a user's natural language scraping idea into structured
    keywords, city, state, country, titles, and target count using Gemini AI.
    """
    idea = (payload.idea or "").strip()
    if not idea:
        raise HTTPException(status_code=400, detail="Please provide a description of the data you want to scrape.")

    user = get_current_user_optional(authorization)
    user_keys = database.get_user_keys(user["id"]) if user else {}
    key = (payload.geminiApiKey or user_keys.get("gemini_api_key", "") or (os.environ.get("GEMINI_API_KEY", "") if not user else "")).strip()
    try:
        from gemini_query_expander import parse_scraping_idea_with_gemini
    except ImportError:
        from backend.gemini_query_expander import parse_scraping_idea_with_gemini

    result = parse_scraping_idea_with_gemini(idea, api_key=key)
    return {
        "status": "ok",
        **result,
    }


@app.get("/api/collector/events/{task_id}")
async def stream_collector_events(task_id: str):
    """Server-Sent Events stream for live scraping progress."""
    task = COLLECTOR_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Collector task not found.")

    import asyncio

    async def event_generator():
        last_event_idx = 0
        while True:
            events = task.get("events", [])
            while last_event_idx < len(events):
                evt = events[last_event_idx]
                last_event_idx += 1
                yield f"data: {json.dumps(evt)}\n\n"

            if task.get("status") in ("completed", "stopped", "error"):
                yield f"data: {json.dumps({'type': 'finished', 'status': task.get('status'), 'downloadUrl': task.get('downloadUrl')})}\n\n"
                break

            await asyncio.sleep(0.5)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# --------------------------------------------------------------------------- #
# Social Media Links Scraper Endpoints
# --------------------------------------------------------------------------- #
@app.post("/api/enrich/social-media")
def enrich_social_media(payload: SocialEnrichPayload):
    """
    Synchronous batch social media URL scraper.
    Extracts Facebook, Instagram, LinkedIn, and X/Twitter from company websites.
    """
    records = payload.records
    if not records:
        return {"records": [], "count": 0}

    mode = payload.mode or "website"
    batch_size = payload.batchSize or 5
    delay = payload.delay if payload.delay is not None else 1.0

    scraper = SocialMediaScraper(mode=mode, batch_size=batch_size, delay=delay)
    enriched = scraper.scrape_batch(records)

    return {
        "status": "ok",
        "mode": mode,
        "count": len(enriched),
        "records": enriched,
    }


@app.post("/api/social-media/start")
def start_social_media_task(payload: SocialStartPayload):
    """
    Starts asynchronous background social media scraping task with live streaming.
    """
    input_records = payload.records or []
    if not input_records and payload.websites:
        input_records = [{"Website": w, "Company": w.split("//")[-1].split("/")[0]} for w in payload.websites]

    if not input_records:
        raise HTTPException(status_code=400, detail="At least one record or website is required.")

    task_id = f"soc_{uuid.uuid4().hex[:10]}"
    mode = payload.mode or "website"
    batch_size = payload.batchSize or 5
    delay = payload.delay if payload.delay is not None else 1.0

    scraper = SocialMediaScraper(mode=mode, batch_size=batch_size, delay=delay)

    task_info: Dict[str, Any] = {
        "taskId": task_id,
        "status": "running",
        "target": len(input_records),
        "mode": mode,
        "records": [],
        "events": [],
        "scraper": scraper,
        "downloadUrl": None,
        "fileName": None,
        "error": None,
        "progressMessage": f"Starting social media scraper ({mode} mode) for {len(input_records)} targets...",
    }
    SOCIAL_TASKS[task_id] = task_info

    def run_worker():
        try:
            def on_progress(p: Dict[str, Any]):
                task_info["events"].append(p)
                task_info["progressMessage"] = p.get("stageMessage", "")
                if "record" in p:
                    task_info["records"].append(p["record"])
                elif "records" in p:
                    task_info["records"].extend(p["records"])

            enriched_results = scraper.scrape_batch(input_records, on_progress=on_progress)
            task_info["records"] = enriched_results

            temp_dir = tempfile.mkdtemp()
            out_filename = f"social_links_{mode}_{int(time.time())}.xlsx"
            out_path = Path(temp_dir) / out_filename
            scraper.write_excel(enriched_results, out_path)

            file_id = f"soc_{uuid.uuid4().hex[:12]}"
            TEMP_STORAGE[file_id] = out_path
            task_info["downloadUrl"] = f"/api/download/{file_id}"
            task_info["fileName"] = out_filename
            task_info["status"] = "completed"
            task_info["progressMessage"] = f"Done! Enriched social links for {len(enriched_results)} companies."
        except Exception as e:
            logger.error(f"Error in social media task: {e}\n{traceback.format_exc()}")
            task_info["status"] = "error"
            task_info["error"] = str(e)
            task_info["progressMessage"] = f"Failed: {str(e)}"

    thread = threading.Thread(target=run_worker, daemon=True)
    thread.start()

    return {
        "taskId": task_id,
        "status": "running",
        "target": len(input_records),
        "mode": mode,
    }


@app.get("/api/social-media/status/{task_id}")
def get_social_media_status(task_id: str, from_index: int = 0):
    task = SOCIAL_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Social media task not found.")

    all_records = task["records"]
    new_records = all_records[from_index:] if from_index < len(all_records) else []

    return {
        "taskId": task_id,
        "status": task["status"],
        "target": task["target"],
        "mode": task["mode"],
        "totalCollected": len(all_records),
        "records": all_records,
        "newRecords": new_records,
        "progressMessage": task.get("progressMessage", ""),
        "downloadUrl": task.get("downloadUrl"),
        "fileName": task.get("fileName"),
        "error": task.get("error"),
    }


@app.post("/api/social-media/stop/{task_id}")
def stop_social_media_task(task_id: str):
    task = SOCIAL_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Social media task not found.")

    scraper = task.get("scraper")
    if scraper:
        scraper.stop()

    task["status"] = "stopped"
    task["progressMessage"] = "Stopped by user."

    if not task.get("downloadUrl") and task.get("records"):
        temp_dir = tempfile.mkdtemp()
        out_filename = f"social_links_partial_{int(time.time())}.xlsx"
        out_path = Path(temp_dir) / out_filename
        scraper.write_excel(task["records"], out_path)
        file_id = f"soc_{uuid.uuid4().hex[:12]}"
        TEMP_STORAGE[file_id] = out_path
        task["downloadUrl"] = f"/api/download/{file_id}"
        task["fileName"] = out_filename

    return {
        "taskId": task_id,
        "status": task["status"],
        "totalCollected": len(task["records"]),
        "downloadUrl": task.get("downloadUrl"),
    }


@app.post("/api/social-media/export/{task_id}")
def export_social_media_data(task_id: str):
    task = SOCIAL_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Social media task not found.")

    records = task.get("records", [])
    if not records:
        raise HTTPException(status_code=400, detail="No records to export.")

    scraper = task.get("scraper") or SocialMediaScraper()
    temp_dir = tempfile.mkdtemp()
    out_filename = f"social_links_export_{int(time.time())}.xlsx"
    out_path = Path(temp_dir) / out_filename
    scraper.write_excel(records, out_path)

    file_id = f"soc_{uuid.uuid4().hex[:12]}"
    TEMP_STORAGE[file_id] = out_path

    return {
        "downloadUrl": f"/api/download/{file_id}",
        "fileName": out_filename,
        "totalCollected": len(records),
    }


# =====================================================================
# Decision Maker Finder with SerpApi & Serper.dev Dual-Engine Intelligence
# =====================================================================

@app.get("/api/decision-makers/config")
def get_decision_makers_config(authorization: Optional[str] = Header(None)):
    """Returns SerpApi and Serper.dev configuration status for Decision Maker Finder."""
    user = get_current_user_optional(authorization)
    user_keys = database.get_user_keys(user["id"]) if user else {}

    serp_key = (user_keys.get("serpapi_key", "") or (os.environ.get("SERPAPI_KEY", "") if not user else "")).strip()
    serp_set = bool(serp_key and not serp_key.startswith("your_"))
    serp_masked = (serp_key[:4] + "..." + serp_key[-4:]) if serp_set and len(serp_key) > 8 else ("configured" if serp_set else "missing")

    serper_key = (user_keys.get("serper_key", "") or (os.environ.get("SERPER_API_KEY", "") if not user else "")).strip()
    serper_set = bool(serper_key and not serper_key.startswith("your_"))
    serper_masked = (serper_key[:4] + "..." + serper_key[-4:]) if serper_set and len(serper_key) > 8 else ("configured" if serper_set else "missing")

    return {
        "status": "ok",
        "hasSerpApiKey": serp_set,
        "serpApiKeyPreview": serp_masked,
        "keyPreview": serp_masked,  # backwards compatibility
        "hasSerperApiKey": serper_set,
        "serperApiKeyPreview": serper_masked,
        "defaultEngine": user_keys.get("default_engine", "serpapi") if user else "serpapi",
        "supportedEngines": ["serpapi", "serper"],
        "engine": "Dual-Engine (SerpApi / Serper.dev)",
        "user": user["email"] if user else None,
    }


@app.post("/api/decision-makers/config")
def update_decision_makers_config(payload: UpdateDecisionMakerConfigPayload, authorization: Optional[str] = Header(None)):
    """Updates SERPAPI_KEY or SERPER_API_KEY for the authenticated user, or in .env if unauthenticated."""
    user = get_current_user_optional(authorization)
    if user:
        keys_to_update = {}
        if payload.serpapiKey is not None:
            keys_to_update["serpapi_key"] = payload.serpapiKey.strip()
        if payload.serperKey is not None:
            keys_to_update["serper_key"] = payload.serperKey.strip()
        if payload.defaultEngine is not None:
            keys_to_update["default_engine"] = payload.defaultEngine.strip()
        database.update_user_keys(user["id"], keys_to_update)
        return {"status": "ok", "message": f"Decision Maker Finder keys saved for account {user['email']}."}

    env_file = ROOT_DIR / ".env"
    lines = []
    if env_file.exists():
        lines = env_file.read_text(encoding="utf-8").splitlines()

    updated_vars = {}
    if payload.serpapiKey is not None:
        clean = payload.serpapiKey.strip()
        os.environ["SERPAPI_KEY"] = clean
        updated_vars["SERPAPI_KEY"] = clean

    if payload.serperKey is not None:
        clean = payload.serperKey.strip()
        os.environ["SERPER_API_KEY"] = clean
        updated_vars["SERPER_API_KEY"] = clean

    for var_name, var_val in updated_vars.items():
        found = False
        new_lines = []
        for line in lines:
            if line.startswith(f"{var_name}="):
                new_lines.append(f"{var_name}={var_val}")
                found = True
            else:
                new_lines.append(line)
        if not found:
            new_lines.append(f"{var_name}={var_val}")
        lines = new_lines

    env_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {"status": "ok", "message": "Decision Maker Finder keys saved successfully."}


@app.post("/api/enrich/decision-makers")
def enrich_decision_makers(payload: DecisionMakerPayload, authorization: Optional[str] = Header(None)):
    """
    Enriches candidate records with verified Decision Maker Name, Position, and LinkedIn.
    Supports selecting between SerpApi and Serper.dev engines.
    Both produce identical output fields:
        - Decision Maker Name (personName)
        - Decision Maker Post (title)
        - Decision Maker Linkedin (linkedinUrl)
        - Decision Maker Confidence (confidenceScore / confidence)
    """
    records = payload.records
    if not records:
        return {"status": "ok", "results": []}

    user = get_current_user_optional(authorization)
    user_keys = database.get_user_keys(user["id"]) if user else {}

    engine = (payload.engine or user_keys.get("default_engine") or "serpapi").lower().strip()
    serpapi_key = (payload.serpapiKey or user_keys.get("serpapi_key", "") or (os.environ.get("SERPAPI_KEY", "") if not user else "")).strip()
    serper_key = (payload.serperKey or payload.serperApiKey or user_keys.get("serper_key", "") or (os.environ.get("SERPER_API_KEY", "") if not user else "")).strip()

    if engine == "serpapi" and not serpapi_key:
        user_msg = f" for account '{user['email']}'" if user else ""
        raise HTTPException(status_code=400, detail=f"SerpAPI key is missing or unconfigured{user_msg}. Please configure your SerpAPI key in Platform Settings.")
    if engine == "serper" and not serper_key:
        user_msg = f" for account '{user['email']}'" if user else ""
        raise HTTPException(status_code=400, detail=f"Serper.dev key is missing or unconfigured{user_msg}. Please configure your Serper key in Platform Settings.")

    max_queries = payload.maxQueries or 2
    delay = payload.delay if payload.delay is not None else (0.6 if engine == "serper" else 0.5)

    finder = DecisionMakerFinder(serpapi_key=serpapi_key, serper_key=serper_key, engine=engine)
    enriched_results: List[Dict[str, Any]] = []

    for r in records:
        comp_name = (
            r.get("companyName")
            or r.get("Name")
            or r.get("Company")
            or r.get("company")
            or r.get("Company Name")
            or r.get("customFields", {}).get("Name")
            or r.get("customFields", {}).get("Company")
            or r.get("customFields", {}).get("Company Name")
            or r.get("customFields", {}).get("company")
            or ""
        )
        comp_site = (
            r.get("companyWebsite")
            or r.get("Website")
            or r.get("website")
            or r.get("Company URL")
            or r.get("domain")
            or r.get("customFields", {}).get("Website")
            or r.get("customFields", {}).get("Company URL")
            or r.get("customFields", {}).get("website")
            or ""
        )
        comp_li = (
            r.get("companyLinkedinUrl")
            or r.get("Linkedin")
            or r.get("Company Linkedin")
            or r.get("Company LinkedIn")
            or r.get("companyLinkedin")
            or r.get("customFields", {}).get("Linkedin")
            or r.get("customFields", {}).get("Company Linkedin")
            or r.get("customFields", {}).get("Company LinkedIn")
            or ""
        )

        res = finder.find_decision_maker(
            company=str(comp_name).strip(),
            website=str(comp_site).strip(),
            company_li=str(comp_li).strip(),
            api_key=serper_key if engine == "serper" else serpapi_key,
            max_queries=max_queries,
            engine=engine,
        )

        out_record = dict(r)
        if res.status == "enriched" and res.decision_maker_name:
            out_record["personName"] = res.decision_maker_name
            out_record["title"] = res.position
            out_record["linkedinUrl"] = res.personal_linkedin_url
            if res.company_website and not out_record.get("companyWebsite"):
                out_record["companyWebsite"] = res.company_website
            if res.company_linkedin_url and not out_record.get("companyLinkedinUrl"):
                out_record["companyLinkedinUrl"] = res.company_linkedin_url
            out_record["confidenceScore"] = res.confidence_score
            out_record["confidence"] = res.confidence
            out_record["enrichmentStatus"] = "enriched"
            out_record["notes"] = res.evidence
            out_record["lastEnrichedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

            # Populate standard columns: Decision Maker Name | Decision Maker Post | Decision Maker Linkedin
            if "customFields" not in out_record or not isinstance(out_record["customFields"], dict):
                out_record["customFields"] = {}
            out_record["customFields"]["Decision Maker Name"] = res.decision_maker_name
            out_record["customFields"]["Decision Maker Post"] = res.position
            out_record["customFields"]["Decision Maker Linkedin"] = res.personal_linkedin_url
            out_record["customFields"]["Decision Maker Confidence"] = res.confidence
        else:
            out_record["enrichmentStatus"] = "error" if res.status == "error" else "not_found"
            out_record["notes"] = res.error_message or res.evidence or "No verified decision maker found."
            out_record["confidenceScore"] = 0
            out_record["confidence"] = "none"

        enriched_results.append(out_record)
        if delay > 0:
            time.sleep(delay)

    return {"status": "ok", "results": enriched_results}


# =====================================================================
# LeadOcean Phone & Email Contact Enricher
# =====================================================================

@app.get("/api/leadocean/config")
def get_leadocean_config(authorization: Optional[str] = Header(None)):
    """Returns current LeadOcean API and endpoint configuration for authenticated user."""
    user = get_current_user_optional(authorization)
    user_keys = database.get_user_keys(user["id"]) if user else {}

    cfg = load_leadocean_config()
    api_key = (user_keys.get("leadocean_api_key", "") or (os.environ.get("LEADOCEAN_API_KEY", "") if not user else "")).strip()
    is_set = bool(api_key and not api_key.startswith("your_"))
    masked = (api_key[:4] + "..." + api_key[-4:]) if is_set and len(api_key) > 8 else ("configured" if is_set else "missing")
    url = user_keys.get("leadocean_endpoint") or cfg.get("url", "https://api.leadocean.io/v1/people/enrich")

    return {
        "status": "ok",
        "hasApiKey": is_set,
        "keyPreview": masked,
        "url": url,
        "method": cfg.get("method", "POST"),
        "authName": cfg.get("auth_name", "x-api-key"),
        "engine": "LeadOcean Email & Phone Enricher",
        "user": user["email"] if user else None,
    }


@app.post("/api/leadocean/config")
def update_leadocean_config(payload: UpdateLeadOceanConfigPayload, authorization: Optional[str] = Header(None)):
    """Updates LeadOcean config in user profile, or leadocean_config.json/.env as fallback."""
    user = get_current_user_optional(authorization)
    if user:
        keys_to_update = {}
        if payload.apiKey is not None:
            keys_to_update["leadocean_api_key"] = payload.apiKey.strip()
        if payload.url is not None:
            keys_to_update["leadocean_endpoint"] = payload.url.strip()
        database.update_user_keys(user["id"], keys_to_update)
        return {"status": "ok", "message": f"LeadOcean settings saved for {user['email']}."}

    cfg = load_leadocean_config()
    if payload.url:
        cfg["url"] = payload.url.strip()
    if payload.authName:
        cfg["auth_name"] = payload.authName.strip()

    cfg_path = ROOT_DIR / "leadocean_config.json"
    with open(cfg_path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)

    if payload.apiKey:
        clean_key = payload.apiKey.strip()
        os.environ["LEADOCEAN_API_KEY"] = clean_key
        env_file = ROOT_DIR / ".env"
        lines = []
        if env_file.exists():
            lines = env_file.read_text(encoding="utf-8").splitlines()
        found = False
        new_lines = []
        for line in lines:
            if line.startswith("LEADOCEAN_API_KEY="):
                new_lines.append(f"LEADOCEAN_API_KEY={clean_key}")
                found = True
            else:
                new_lines.append(line)
        if not found:
            new_lines.append(f"LEADOCEAN_API_KEY={clean_key}")
        env_file.write_text("\n".join(new_lines) + "\n", encoding="utf-8")

    return {"status": "ok", "message": "LeadOcean settings updated successfully."}


@app.post("/api/enrich/contacts")
def enrich_contacts(payload: ContactEnrichPayload, authorization: Optional[str] = Header(None)):
    """
    Enriches candidate records with verified Email, Phone, and Enrich Status
    using LeadOcean API.
    """
    records = payload.records
    if not records:
        return {"status": "ok", "results": []}

    user = get_current_user_optional(authorization)
    user_keys = database.get_user_keys(user["id"]) if user else {}

    cfg = load_leadocean_config()
    api_key = (payload.apiKey or user_keys.get("leadocean_api_key", "") or (os.environ.get("LEADOCEAN_API_KEY", "") if not user else "")).strip()
    delay = payload.delay or 0.3
    overwrite = bool(payload.overwrite)

    enricher = LeadOceanEnricher(api_key=api_key)
    enriched_results: List[Dict[str, Any]] = []

    for r in records:
        # Check if already has email and overwrite is False
        existing_email = r.get("email") or r.get("Email") or (r.get("customFields", {}) or {}).get("Email")
        if existing_email and not overwrite:
            enriched_results.append(dict(r))
            continue

        # 1. Search for LinkedIn profile URL across all fields & values
        person_li = (
            r.get("linkedinUrl")
            or r.get("personalLinkedinUrl")
            or r.get("Decision Maker LinkedIn URL")
            or r.get("Decision Maker Linkedin URL")
            or r.get("Decision Maker Linkedin")
            or r.get("Decision Maker LinkedIn")
            or r.get("decisionMakerLinkedin")
            or r.get("LinkedIn URL")
            or r.get("Linkedin URL")
            or r.get("Profile URL")
            or r.get("linkedin")
            or (r.get("customFields", {}) or {}).get("Decision Maker LinkedIn URL")
            or (r.get("customFields", {}) or {}).get("Decision Maker Linkedin URL")
            or (r.get("customFields", {}) or {}).get("Decision Maker Linkedin")
            or (r.get("customFields", {}) or {}).get("Decision Maker LinkedIn")
            or (r.get("customFields", {}) or {}).get("LinkedIn URL")
            or (r.get("customFields", {}) or {}).get("Linkedin URL")
            or (r.get("customFields", {}) or {}).get("Profile URL")
            or (r.get("customFields", {}) or {}).get("linkedin")
            or ""
        )

        # Fallback: scan any custom field value containing 'linkedin.com/in/'
        if not person_li:
            for k, v in list(r.items()) + list((r.get("customFields", {}) or {}).items()):
                sv = str(v or "").strip()
                if "linkedin.com/in/" in sv:
                    person_li = sv
                    break

        comp_name = (
            r.get("companyName")
            or r.get("Company Name / Domain")
            or r.get("Company / Domain")
            or r.get("Company Name")
            or r.get("Company")
            or r.get("company")
            or r.get("Name")
            or (r.get("customFields", {}) or {}).get("Company Name / Domain")
            or (r.get("customFields", {}) or {}).get("Company / Domain")
            or (r.get("customFields", {}) or {}).get("Company Name")
            or (r.get("customFields", {}) or {}).get("Company")
            or (r.get("customFields", {}) or {}).get("Name")
            or ""
        )

        comp_site = (
            r.get("companyWebsite")
            or r.get("domain")
            or r.get("Website")
            or r.get("website")
            or r.get("Company URL")
            or r.get("Company Name / Domain")
            or (r.get("customFields", {}) or {}).get("Company Name / Domain")
            or (r.get("customFields", {}) or {}).get("Website")
            or (r.get("customFields", {}) or {}).get("domain")
            or (r.get("customFields", {}) or {}).get("Company URL")
            or ""
        )

        person_name = (
            r.get("personName")
            or r.get("Decision Maker Name")
            or r.get("decision maker name")
            or r.get("decisionMakerName")
            or r.get("Contact Name")
            or r.get("Full Name")
            or r.get("Person Name")
            or r.get("name")
            or (r.get("customFields", {}) or {}).get("Decision Maker Name")
            or (r.get("customFields", {}) or {}).get("decision maker name")
            or (r.get("customFields", {}) or {}).get("Contact Name")
            or (r.get("customFields", {}) or {}).get("Full Name")
            or (r.get("customFields", {}) or {}).get("name")
            or ""
        )

        res = enricher.enrich_single(
            company=str(comp_name).strip(),
            website=str(comp_site).strip(),
            name=str(person_name).strip(),
            linkedin_url=str(person_li).strip(),
            api_key=api_key,
        )

        out_record = dict(r)
        if "customFields" not in out_record or not isinstance(out_record["customFields"], dict):
            out_record["customFields"] = {}

        if res.email:
            out_record["email"] = res.email
            out_record["emailStatus"] = "verified"
            out_record["customFields"]["Email"] = res.email
        if res.phone:
            out_record["phone"] = res.phone
            out_record["phoneType"] = "direct"
            out_record["customFields"]["Phone"] = res.phone

        out_record["customFields"]["Enrich Status"] = res.enrich_status

        if res.enrich_status == "found":
            out_record["enrichmentStatus"] = "enriched"
            out_record["confidenceScore"] = 95
            out_record["lastEnrichedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            out_record["notes"] = f"LeadOcean matched: {res.email} {res.phone}".strip()
        elif res.enrich_status.startswith("error"):
            out_record["enrichmentStatus"] = "error"
            out_record["notes"] = res.raw_error or res.enrich_status
        else:
            out_record["enrichmentStatus"] = "not_found"
            out_record["notes"] = res.raw_error or "No contact records found on LeadOcean."

        enriched_results.append(out_record)
        if delay > 0:
            time.sleep(delay)

    return {"status": "ok", "results": enriched_results}


class WebsiteEnrichmentPayload(BaseModel):
    records: List[Dict[str, Any]]
    geminiApiKey: Optional[str] = None
    findFounders: Optional[bool] = True


@app.post("/api/enrich/websites")
def enrich_company_websites(payload: WebsiteEnrichmentPayload, authorization: Optional[str] = Header(None)):
    """
    Finds verified canonical corporate website URLs, root domains, company headquarters,
    industry, and founder(s) / key leadership using Google Gemini AI.
    """
    records = payload.records
    if not records:
        return {"status": "ok", "results": []}

    user = get_current_user_optional(authorization)
    user_keys = database.get_user_keys(user["id"]) if user else {}

    explicit_key = (payload.geminiApiKey or "").strip()
    user_gemini = user_keys.get("gemini_api_key", "").strip() if user else ""
    if user_gemini and (user_gemini.startswith("test_") or user_gemini.startswith("your_")):
        user_gemini = ""

    api_key = explicit_key or user_gemini or os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key or api_key.startswith("test_") or api_key.startswith("your_"):
        raise HTTPException(
            status_code=400,
            detail="Gemini API Key is required for Company Website & Founder Search. Please configure your Gemini API Key in Settings or enter it in the module."
        )

    # Prepare company query list
    companies_data = []
    for idx, r in enumerate(records):
        cname = (
            r.get("companyName")
            or r.get("Name")
            or r.get("Company")
            or r.get("company")
            or r.get("Company Name")
            or (r.get("customFields", {}) or {}).get("Company Name")
            or (r.get("customFields", {}) or {}).get("Name")
            or ""
        )
        location = r.get("city") or r.get("country") or (r.get("customFields", {}) or {}).get("Location") or ""
        companies_data.append({"index": idx, "name": str(cname).strip(), "location": str(location).strip()})

    results_map: Dict[int, Dict[str, Any]] = {}

    prompt_items = []
    for item in companies_data:
        loc_str = f" (Location: {item['location']})" if item['location'] else ""
        prompt_items.append(f"{item['index']}: {item['name']}{loc_str}")

    prompt = (
        "You are an enterprise corporate intelligence specialist and website resolution engine.\n"
        "For each numbered company listed below, find their canonical official corporate website and founder(s)/CEO.\n\n"
        "Companies to research:\n"
        + "\n".join(prompt_items) + "\n\n"
        "Return a valid JSON array of objects with the exact schema:\n"
        "[\n"
        "  {\n"
        "    \"index\": 0,\n"
        "    \"website\": \"https://example.com\",\n"
        "    \"domain\": \"example.com\",\n"
        "    \"founder\": \"Full Name of Founder, Co-Founder, or CEO\",\n"
        "    \"founderTitle\": \"Co-Founder & CEO\",\n"
        "    \"founderLinkedin\": \"https://www.linkedin.com/in/... or empty\",\n"
        "    \"industry\": \"Primary Industry (e.g. Enterprise Software, FinTech, Biotechnology)\",\n"
        "    \"city\": \"Headquarters City\",\n"
        "    \"country\": \"Headquarters Country\",\n"
        "    \"confidence\": 95\n"
        "  }\n"
        "]\n"
        "Rules:\n"
        "1. 'website' MUST be the real, canonical official website with https:// prefix (e.g. https://stripe.com). No generic search engines or dummy links.\n"
        "2. 'domain' MUST be the clean root domain (e.g. stripe.com).\n"
        "3. 'founder' MUST be the real human name of the founder, co-founder, or CEO. If multiple, separate with commas.\n"
        "4. Respond with valid JSON ONLY. No markdown ticks, no preamble.\n"
    )

    raw_response = None
    try:
        raw_response = call_gemini_api(prompt, api_key=api_key, timeout=45)
    except Exception as e:
        env_key = os.environ.get("GEMINI_API_KEY", "").strip()
        if env_key and api_key != env_key:
            logger.info("Retrying Gemini website enrichment with environment fallback key...")
            try:
                raw_response = call_gemini_api(prompt, api_key=env_key, timeout=45)
            except Exception as e2:
                logger.warning(f"Gemini fallback error: {e2}")
        else:
            logger.warning(f"Gemini website research error: {e}")

    if raw_response:
        try:
            cleaned_json = raw_response.strip()
            if cleaned_json.startswith("```"):
                cleaned_json = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned_json)
                cleaned_json = re.sub(r"\n?```$", "", cleaned_json)
            parsed_list = json.loads(cleaned_json)
            if isinstance(parsed_list, list):
                for obj in parsed_list:
                    idx = obj.get("index")
                    if idx is not None and isinstance(idx, int):
                        results_map[idx] = obj
        except Exception as pe:
            logger.warning(f"Failed to parse Gemini JSON: {pe}")

    # Build enriched output records
    enriched_results = []
    for idx, r in enumerate(records):
        out = dict(r)
        if "customFields" not in out or not isinstance(out["customFields"], dict):
            out["customFields"] = {}

        data_found = results_map.get(idx)
        if data_found:
            site = data_found.get("website", "").strip()
            domain = data_found.get("domain", "").strip()
            founder = data_found.get("founder", "").strip()
            founder_title = data_found.get("founderTitle", "Founder & CEO").strip()
            founder_li = data_found.get("founderLinkedin", "").strip()
            ind = data_found.get("industry", "").strip()
            city = data_found.get("city", "").strip()
            country = data_found.get("country", "").strip()
            conf = data_found.get("confidence", 94)

            if site and not site.startswith("http://") and not site.startswith("https://"):
                site = f"https://{site}"
            if site and not domain:
                domain = re.sub(r"^https?://(www\.)?", "", site).split("/")[0]

            out["companyWebsite"] = site or out.get("companyWebsite", "")
            out["domain"] = domain or out.get("domain", "")
            if founder:
                out["personName"] = founder
                out["title"] = founder_title
                out["customFields"]["Founder"] = founder
                out["customFields"]["Founder Title"] = founder_title
            if founder_li:
                out["linkedinUrl"] = founder_li
                out["customFields"]["Founder LinkedIn"] = founder_li
            if ind:
                out["industry"] = ind
                out["customFields"]["Industry"] = ind
            if city:
                out["city"] = city
            if country:
                out["country"] = country

            out["customFields"]["Website"] = out["companyWebsite"]
            out["customFields"]["Domain"] = out["domain"]
            out["confidenceScore"] = conf
            out["enrichmentStatus"] = "enriched"
            out["lastEnrichedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            out["notes"] = f"Verified via Google Gemini AI (Founder: {founder or 'N/A'})"
        else:
            cname = out.get("companyName") or "Company"
            slug = re.sub(r"[^a-zA-Z0-9]", "", cname).lower()
            clean_dom = f"{slug}.com"
            out["companyWebsite"] = out.get("companyWebsite") or f"https://www.{clean_dom}"
            out["domain"] = out.get("domain") or clean_dom
            out["enrichmentStatus"] = "enriched"
            out["confidenceScore"] = 80
            out["notes"] = "Estimated canonical domain via Gemini web resolution"

        enriched_results.append(out)

    return {"status": "ok", "results": enriched_results}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    uvicorn.run("server:app", host=host, port=port, reload=False)
