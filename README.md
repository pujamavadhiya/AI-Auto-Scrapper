# AI Auto Scrapper | B2B Lead Research & Data Enrichment SaaS Platform

A professional, AI-powered B2B Lead Intelligence and Data Enrichment web application built with **React**, **TypeScript**, **Vite**, **Tailwind CSS**, and **SheetJS**.

Designed with an isolated **Service Adapter Architecture**, allowing you to run in sandbox simulation mode today and seamlessly plug in your Python / Selenium / Playwright scraping modules whenever you are ready.

---

## 🚀 Quick Start (Running Locally)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure SerpAPI Key in `.env`
Create or edit `.env` in the root folder:
```bash
SERPAPI_KEY=your_serpapi_key_here
```

### 3. Start Frontend & Backend
In terminal 1 (Vite frontend):
```bash
npm run dev
```
In terminal 2 (FastAPI SerpAPI engine):
```bash
npm run server
```

### 4. Run LinkedIn Finder Unit Tests
```bash
npm run test:python
```
(Or click the **"Run 15 Unit Tests"** button directly inside the LinkedIn Finder interface)

---

## 🌟 Key Features

1. **Dashboard (`/`)**: Executive metrics, interactive modules directory, AI spotlight banner, recent enrichment projects, and SheetJS export history log.
2. **AI Research Assistant (`/ai-assistant`)**: GPT-style conversational interface to explore company organizational charts, leadership structures, and cold outreach pitch angles.
3. **Decision Maker Finder (`/decision-maker`)**: Identifies C-level executives, VPs, and directors with job titles, departments, and confidence metrics.
4. **LinkedIn URL Finder (`/linkedin-finder`)**: Resolves verified personal executive profiles and official corporate company pages.
5. **Decision Maker Email & Phone Finder (`/contact-finder`)**: Generates permutations, simulates MX/SMTP handshake deliverability, and extracts direct dial numbers.
6. **Company Website Finder (`/website-finder`)**: Resolves canonical domains, redirects, and brand URLs.
7. **Social Media URL Finder (`/social-finder`)**: Aggregates corporate footprints across Twitter/X, GitHub, LinkedIn, and Crunchbase.
8. **All Projects (`/projects`)**: Manage, duplicate, inspect, and re-run batch workspaces saved in browser localStorage.
9. **Export History (`/export-history`)**: Complete audit trail of generated spreadsheets with 1-click re-download.
10. **Settings (`/settings`)**: Configurable crawl simulation speeds (Turbo, Realistic, Deep), default export options, and adapter integration guide.

---

## 📊 Spreadsheet Import & In-Browser SheetJS Export

- **File Formats Supported**: Microsoft Excel (`.xlsx`, `.xls`) and Comma-Separated Values (`.csv`).
- **Interactive Column Mapping**: Automatically detects headers (`Company`, `Contact`, `Title`, `Domain`, `Country`) with first-row sample value previews.
- **Export Scopes**:
  - Export **All Records**
  - Export **Filtered Records** (active search/filter matches)
  - Export **Selected Records** (multi-select checkboxes)
- **Zero Server Uploads**: File parsing and spreadsheet generation happen 100% locally in the browser using SheetJS.

---

## 🔌 Decoupled Service Adapter Architecture

All research operations implement the standardized `IResearchAdapter` interface located in [`src/services/adapters/baseAdapter.ts`](file:///Users/apple/Downloads/Sevencore_automation_systems/Auto_Scrapper/src/services/adapters/baseAdapter.ts):

```typescript
export interface IResearchAdapter {
  readonly metadata: ModuleMetadata;
  enrichSingle(record: EnrichmentRecord, config: ResearchConfig): Promise<EnrichmentRecord>;
  enrichBatch(
    records: EnrichmentRecord[],
    config: ResearchConfig,
    onProgress?: (progress: ResearchProgress) => void,
    signal?: AbortSignal
  ): Promise<EnrichmentRecord[]>;
}
```

### Connecting Your Real Scraping Algorithms Later

To connect your existing scraping scripts (e.g. Python FastAPI, Flask, or Node scraper service):
1. In [`src/services/adapters/`](file:///Users/apple/Downloads/Sevencore_automation_systems/Auto_Scrapper/src/services/adapters/), swap the mock logic with an HTTP call to your backend:
   ```typescript
   async enrichSingle(record: EnrichmentRecord, config: ResearchConfig) {
     const response = await fetch('http://localhost:8000/api/scrape', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ company: record.companyName, domain: record.domain, config }),
     });
     return await response.json();
   }
   ```
2. No API keys or credentials need to be exposed in frontend code.
