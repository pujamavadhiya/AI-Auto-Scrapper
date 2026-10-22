#!/usr/bin/env python3
"""
Upload page for the lead enricher.

    pip install streamlit requests pandas openpyxl
    streamlit run leadocean_app.py

Needs leadocean_enricher.py and a filled-in leadocean_config.json in the same folder.
"""
import io
import json
import os
import sys
from pathlib import Path

import pandas as pd

# Load environment variables from .env
try:
    from dotenv import load_dotenv
    load_dotenv(".env", override=True)
    load_dotenv(Path(__file__).resolve().parent / ".env", override=True)
except ImportError:
    pass

try:
    import streamlit as st
except ImportError:
    print("Streamlit is not installed. Run: pip install streamlit")
    sys.exit(1)

# Ensure backend and current directory are in path
ROOT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT_DIR))
sys.path.insert(0, str(ROOT_DIR / "backend"))

try:
    import leadocean_enricher as le
except ImportError:
    from backend import leadocean_enricher as le

st.set_page_config(page_title="LeadOcean Lead Enricher", page_icon="📇", layout="wide")
st.title("📇 Find Email & Phone for Your Leads (LeadOcean)")
st.caption("Extract verified direct business emails and phone numbers using the LeadOcean API.")

cfg_default = le.load_config("leadocean_config.json")
default_key = os.getenv("LEADOCEAN_API_KEY", "") or os.getenv(cfg_default.get("api_key_env", ""), "")

# API Key & Endpoint Configuration bar
with st.expander("⚙️ LeadOcean API Credentials & Settings", expanded=not bool(default_key)):
    col1, col2 = st.columns([2, 1])
    with col1:
        api_key = st.text_input("LeadOcean API Key (x-api-key)", value=default_key, type="password")
    with col2:
        endpoint_url = st.text_input(
            "API Endpoint URL",
            value=cfg_default.get("url", "https://api.leadocean.io/v1/people/enrich"),
        )
    if api_key:
        st.success(f"API Key configured ({api_key[:4]}...{api_key[-4:] if len(api_key) > 8 else ''})")
    else:
        st.warning("Please provide your LeadOcean API key above or set LEADOCEAN_API_KEY in your .env file.")

tab_batch, tab_single = st.tabs(["📄 Batch Upload (CSV / Excel)", "🔍 Single Lead Quick Lookup"])

# --------------------------------------------------------------------------- #
# TAB 1: Batch Upload
# --------------------------------------------------------------------------- #
with tab_batch:
    file = st.file_uploader("Upload CSV or Excel file", type=["csv", "xlsx", "xls"])
    col_l, col_o = st.columns(2)
    with col_l:
        limit = st.number_input("Only process first N rows (0 = all, recommended: 5 for testing)", 0, 100000, 5)
    with col_o:
        overwrite = st.checkbox("Re-enrich rows that already have an email", value=False)

    if file is not None:
        df = (
            pd.read_excel(file, dtype=str)
            if file.name.lower().endswith(("xlsx", "xls"))
            else pd.read_csv(file, dtype=str, encoding="utf-8-sig")
        ).fillna("")

        st.write(f"**Loaded {len(df)} rows** from `{file.name}`", df.head(3))
        detected = le.detect_columns(df)
        st.write("Detected columns:", detected)

        if st.button("🚀 Start LeadOcean Enrichment", type="primary"):
            if not api_key:
                st.error("Please enter your LeadOcean API key above.")
                st.stop()

            cfg = le.load_config("leadocean_config.json")
            cfg["url"] = endpoint_url

            log_box = st.empty()
            bar = st.progress(0)
            lines = []

            def progress(msg):
                lines.append(str(msg))
                log_box.code("\n".join(lines[-12:]))

            out = le.enrich_dataframe(df, cfg, api_key, int(limit), overwrite, progress=progress)
            bar.progress(100)

            found_cnt = (out["Enrich Status"] == "found").sum()
            st.success(f"Done! {found_cnt} of {len(out)} rows enriched with verified contact data.")
            st.dataframe(out)

            buf = io.BytesIO()
            out.to_csv(buf, index=False, encoding="utf-8-sig")
            st.download_button(
                "📥 Download Enriched CSV",
                buf.getvalue(),
                f"{os.path.splitext(file.name)[0]}_enriched.csv",
                "text/csv",
            )

# --------------------------------------------------------------------------- #
# TAB 2: Single Lead Quick Lookup
# --------------------------------------------------------------------------- #
with tab_single:
    st.subheader("Instant Direct Contact Lookup")
    st.write("Test LeadOcean with a single decision maker to verify email and direct phone extraction.")

    c1, c2 = st.columns(2)
    with c1:
        s_name = st.text_input("Decision Maker Name", value="Patrick Collison")
        s_li = st.text_input("Decision Maker LinkedIn URL", value="https://www.linkedin.com/in/patrickcollison")
    with c2:
        s_company = st.text_input("Company Name", value="Stripe")
        s_web = st.text_input("Company Website", value="https://stripe.com")

    if st.button("🔍 Find Email & Phone", type="primary", key="btn_single"):
        if not api_key:
            st.error("Please enter your LeadOcean API key above.")
            st.stop()

        enricher = le.LeadOceanEnricher(api_key=api_key)
        enricher.config["url"] = endpoint_url

        with st.spinner(f"Querying LeadOcean for {s_name}..."):
            res = enricher.enrich_single(
                company=s_company,
                website=s_web,
                name=s_name,
                linkedin_url=s_li,
                api_key=api_key,
            )

        if res.enrich_status == "found":
            st.success(f"Found contact data for {s_name}!")
            m1, m2, m3 = st.columns(3)
            with m1:
                st.metric("Email Address", res.email or "None")
            with m2:
                st.metric("Direct Phone", res.phone or "None")
            with m3:
                st.metric("Status", res.enrich_status.upper())
        elif res.enrich_status.startswith("error"):
            st.error(f"LeadOcean Error: {res.raw_error or res.enrich_status}")
        else:
            st.warning(f"No contact records found on LeadOcean for this profile ({res.enrich_status}).")
