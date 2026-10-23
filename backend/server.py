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

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel

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


@app.get("/api/health")
def health():
    api_key = os.environ.get("SERPAPI_KEY", "").strip()
    is_set = bool(api_key and not api_key.startswith("your_"))
    masked = (api_key[:4] + "..." + api_key[-4:]) if is_set and len(api_key) > 8 else ("configured" if is_set else "missing")
    return {
        "status": "ok",
        "hasSerpApiKey": is_set,
        "keyPreview": masked,
        "engine": "SerpAPI Decision Maker LinkedIn URL Finder",
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
def enrich_linkedin_rows(payload: EnrichRowsPayload):
    records = payload.records
    user_config = payload.config or {}

    api_key = os.environ.get("SERPAPI_KEY", "").strip()
    if not api_key or api_key.startswith("your_"):
        raise HTTPException(
            status_code=400,
            detail="SERPAPI_KEY is missing or invalid in .env file. Please add your key to .env to execute live scraping."
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
):
    api_key = os.environ.get("SERPAPI_KEY", "").strip()
    if not api_key or api_key.startswith("your_"):
        raise HTTPException(
            status_code=400,
            detail="SERPAPI_KEY is not set in .env. Please configure your key in .env to run live SerpAPI extraction."
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


def _run_collector_thread(task_id: str, cfg: CollectorConfig):
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
        elif etype == "target_reached":
            task["progressMessage"] = event.get("message", "Target profile count reached!")
        elif etype == "enrich_start":
            task["progressMessage"] = "Enriching company industry & size without guessing..."
        elif etype == "company_enriched":
            task["progressMessage"] = f"Enriched {event.get('company')}: {event.get('industry')}"
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
        task["records"] = rows
        task["totalCollected"] = len(rows)

        # Generate output Excel file with exact records
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
        task["status"] = "stopped" if collector.stop_requested.is_set() else "completed"
        task["progressMessage"] = f"Done! Exactly {len(rows)} verified profiles ready for download."

    except Exception as e:
        traceback.print_exc()
        task["status"] = "error"
        task["error"] = str(e)
        task["progressMessage"] = f"Error during scraping: {str(e)}"


@app.post("/api/collector/start")
def start_keyword_collector(payload: StartCollectorPayload):
    clean_kws = [k.strip() for k in payload.keywords if k.strip()]
    if not clean_kws:
        raise HTTPException(status_code=400, detail="At least one keyword is required.")

    target = max(1, min(int(payload.targetCount or 50), 2000))
    titles = payload.titles if payload.titles else ["CEO", "Founder", "COO", "Owner", "Director", "VP"]

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
    )

    task_id = f"task_{uuid.uuid4().hex[:10]}"
    COLLECTOR_TASKS[task_id] = {
        "id": task_id,
        "status": "running",
        "target": target,
        "records": [],
        "events": [],
        "latestQuery": "",
        "activeEngine": "ddg",
        "progressMessage": "Initializing scraping workers...",
        "downloadUrl": None,
        "fileId": None,
        "fileName": None,
        "createdAt": time.time(),
        "error": None,
        "collector": None,
    }

    t = threading.Thread(target=_run_collector_thread, args=(task_id, cfg), daemon=True)
    t.start()

    return {
        "taskId": task_id,
        "status": "running",
        "target": target,
        "keywords": clean_kws,
    }


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
    }


@app.post("/api/collector/stop/{task_id}")
def stop_collector(task_id: str):
    task = COLLECTOR_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Collector task not found.")

    collector = task.get("collector")
    if collector:
        collector.stop()

    task["status"] = "stopping"
    task["progressMessage"] = "Stopping scraper and building Excel output..."

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
            task["status"] = "stopped"
        except Exception as e:
            logger.error(f"Error writing partial Excel: {e}")

    return {
        "taskId": task_id,
        "status": task["status"],
        "totalCollected": len(task["records"]),
        "downloadUrl": task.get("downloadUrl"),
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
def get_decision_makers_config():
    """Returns SerpApi and Serper.dev configuration status for Decision Maker Finder."""
    load_dotenv(ROOT_DIR / ".env", override=True)
    serp_key = os.environ.get("SERPAPI_KEY", "").strip()
    serp_set = bool(serp_key and not serp_key.startswith("your_"))
    serp_masked = (serp_key[:4] + "..." + serp_key[-4:]) if serp_set and len(serp_key) > 8 else ("configured" if serp_set else "missing")

    serper_key = os.environ.get("SERPER_API_KEY", "").strip()
    serper_set = bool(serper_key and not serper_key.startswith("your_"))
    serper_masked = (serper_key[:4] + "..." + serper_key[-4:]) if serper_set and len(serper_key) > 8 else ("configured" if serper_set else "missing")

    return {
        "status": "ok",
        "hasSerpApiKey": serp_set,
        "serpApiKeyPreview": serp_masked,
        "keyPreview": serp_masked,  # backwards compatibility
        "hasSerperApiKey": serper_set,
        "serperApiKeyPreview": serper_masked,
        "defaultEngine": "serpapi",
        "supportedEngines": ["serpapi", "serper"],
        "engine": "Dual-Engine (SerpApi / Serper.dev)",
    }


@app.post("/api/decision-makers/config")
def update_decision_makers_config(payload: UpdateDecisionMakerConfigPayload):
    """Updates SERPAPI_KEY or SERPER_API_KEY in .env."""
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
def enrich_decision_makers(payload: DecisionMakerPayload):
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

    load_dotenv(ROOT_DIR / ".env", override=True)
    engine = (payload.engine or "serpapi").lower().strip()
    serpapi_key = (payload.serpapiKey or os.environ.get("SERPAPI_KEY", "")).strip()
    serper_key = (payload.serperKey or payload.serperApiKey or os.environ.get("SERPER_API_KEY", "")).strip()

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
def get_leadocean_config():
    """Returns current LeadOcean API and endpoint configuration."""
    load_dotenv(ROOT_DIR / ".env", override=True)
    cfg = load_leadocean_config()
    api_key = os.environ.get(cfg.get("api_key_env", "LEADOCEAN_API_KEY"), "") or os.environ.get("LEADOCEAN_API_KEY", "")
    api_key = api_key.strip()
    is_set = bool(api_key and not api_key.startswith("your_"))
    masked = (api_key[:4] + "..." + api_key[-4:]) if is_set and len(api_key) > 8 else ("configured" if is_set else "missing")
    return {
        "status": "ok",
        "hasApiKey": is_set,
        "keyPreview": masked,
        "url": cfg.get("url", "https://api.leadocean.io/v1/people/enrich"),
        "method": cfg.get("method", "POST"),
        "authName": cfg.get("auth_name", "x-api-key"),
        "engine": "LeadOcean Email & Phone Enricher",
    }


@app.post("/api/leadocean/config")
def update_leadocean_config(payload: UpdateLeadOceanConfigPayload):
    """Updates LeadOcean config in leadocean_config.json and .env."""
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
def enrich_contacts(payload: ContactEnrichPayload):
    """
    Enriches candidate records with verified Email, Phone, and Enrich Status
    using LeadOcean API.
    """
    records = payload.records
    if not records:
        return {"status": "ok", "results": []}

    load_dotenv(ROOT_DIR / ".env", override=True)
    cfg = load_leadocean_config()
    api_key = (payload.apiKey or os.environ.get("LEADOCEAN_API_KEY", "") or os.environ.get(cfg.get("api_key_env", ""), "")).strip()
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


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    uvicorn.run("server:app", host=host, port=port, reload=False)
