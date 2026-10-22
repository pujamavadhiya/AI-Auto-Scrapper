#!/usr/bin/env python3
"""
Upload page for the lead enricher.

    pip install streamlit requests pandas openpyxl
    streamlit run leadocean_app.py

Needs leadocean_enricher.py and a filled-in leadocean_config.json in the same folder.
"""
import io
import os
import sys
from pathlib import Path

import pandas as pd

try:
    import streamlit as st
except ImportError:
    print("Streamlit is not installed. Run: pip install streamlit")
    sys.exit(1)

# Ensure backend or current directory is in path
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))

try:
    import leadocean_enricher as le
except ImportError:
    from backend import leadocean_enricher as le

st.set_page_config(page_title="Lead Enricher", page_icon="📇", layout="wide")
st.title("📇 Find email & phone for your leads (LeadOcean)")
st.caption("Upload a sheet with company name, website, decision maker name and LinkedIn URL.")

cfg_default = le.load_config("leadocean_config.json")
default_key = os.getenv("LEADOCEAN_API_KEY", "")

col1, col2 = st.columns([2, 1])
with col1:
    api_key = st.text_input("LeadOcean API key", value=default_key, type="password")
with col2:
    endpoint_url = st.text_input("API Endpoint URL", value=cfg_default.get("url", "https://api.leadocean.io/v1/people/enrich"))

file = st.file_uploader("Upload CSV or Excel", type=["csv", "xlsx", "xls"])
col_l, col_o = st.columns(2)
with col_l:
    limit = st.number_input("Only process first N rows (0 = all, use a small number to test)", 0, 100000, 5)
with col_o:
    overwrite = st.checkbox("Re-enrich rows that already have an email", value=False)

if file is not None:
    df = (
        pd.read_excel(file, dtype=str)
        if file.name.lower().endswith(("xlsx", "xls"))
        else pd.read_csv(file, dtype=str, encoding="utf-8-sig")
    ).fillna("")
    st.write(f"**{len(df)} rows loaded**", df.head(3))
    detected = le.detect_columns(df)
    st.write("Detected columns:", detected)

    if st.button("Start enrichment", type="primary"):
        if not api_key:
            st.error("Enter your LeadOcean API key.")
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
        st.success(f"Done! {found_cnt} rows enriched with contact data.")
        st.dataframe(out)

        buf = io.BytesIO()
        out.to_csv(buf, index=False, encoding="utf-8-sig")
        st.download_button(
            "Download enriched CSV",
            buf.getvalue(),
            f"{os.path.splitext(file.name)[0]}_enriched.csv",
            "text/csv",
        )
