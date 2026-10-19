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
load_dotenv(ROOT_DIR / ".env")
load_dotenv(BASE_DIR / ".env")

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
from linkedin_collector import CollectorConfig, KeywordLinkedInCollector

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


class EnrichRowsPayload(BaseModel):
    records: List[Dict[str, Any]]
    config: Optional[Dict[str, Any]] = None


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
            if prof:
                task["records"].append(prof)
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

        # Generate output Excel file
        temp_dir = tempfile.mkdtemp()
        kw_slug = re.sub(r"[^a-zA-Z0-9]+", "_", cfg.keywords[0] if cfg.keywords else "leads")[:20]
        out_filename = f"linkedin_profiles_{kw_slug}_{int(time.time())}.xlsx"
        out_path = Path(temp_dir) / out_filename
        collector.write_excel(out_path)

        file_id = f"col_{uuid.uuid4().hex[:12]}"
        TEMP_STORAGE[file_id] = out_path
        task["fileId"] = file_id
        task["downloadUrl"] = f"/api/download/{file_id}"
        task["fileName"] = out_filename
        task["status"] = "stopped" if collector.stop_requested.is_set() else "completed"
        task["progressMessage"] = f"Done! {len(rows)} profiles ready for download."

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
        delay_range=(1.2, 2.8),
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)
