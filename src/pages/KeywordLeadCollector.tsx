import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Play,
  Square,
  Download,
  Search,
  MapPin,
  Building2,
  Users,
  Briefcase,
  Layers,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Plus,
  X,
  FileSpreadsheet,
  Globe,
  Radio,
  Clock,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { cn } from '../lib/utils';
import { getApiBaseUrl } from '../config/api';

export interface ScrapedProfile {
  'Company name': string;
  'Company website'?: string;
  'Company LinkedIn URL'?: string;
  Industry: string;
  'Company size': string;
  Headquarters?: string;
  'Decision maker name'?: string;
  'Decision maker title'?: string;
  'Decision maker LinkedIn URL'?: string;
  'DM confidence'?: string;
  'Other decision makers'?: string;
  'Company data source'?: string;
  'Date collected'?: string;
  'Full name'?: string;
  Title?: string;
  'Profile URL'?: string;
  Location?: string;
  'Contact type'?: string;
}

const PRESET_KEYWORDS = [
  'SaaS',
  'Artificial Intelligence',
  'Fintech',
  'Healthcare Tech',
  'Cybersecurity',
  'E-commerce',
  'Clean Energy',
  'Digital Marketing',
  'Cloud Infrastructure',
  'Logistics & Supply Chain',
];

const TARGET_PRESETS = [10, 25, 50, 100, 250, 500, 1000];

const DEFAULT_TITLES = ['CEO', 'Founder', 'Co-Founder', 'Owner', 'COO', 'VP'];

export const cleanLinkedInUrl = (url: string, fullName: string = '', company: string = ''): string => {
  if (!url) return '';
  const base = url.includes('in.linkedin.com') || url.includes('/in/') ? 'https://in.linkedin.com/in/' : 'https://www.linkedin.com/in/';
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!match) return url.split('?')[0].replace(/\/+$/, '');
  const slug = match[1].trim();

  if (fullName) {
    const nameClean = fullName.replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
    const slugClean = slug.replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
    if (nameClean && (slugClean.startsWith(nameClean) || nameClean.includes(slugClean))) {
      const rem = slugClean.slice(nameClean.length);
      if (/^\d+$/.test(rem)) {
        return `${base}${nameClean}${rem}`;
      }
      return `${base}${nameClean}`;
    }
  }

  const cleanSlug = slug.replace(/[^a-zA-Z0-9]+/g, '');
  return `${base}${cleanSlug}`;
};

export const KeywordLeadCollector: React.FC = () => {
  // Input Configuration State
  const [keywords, setKeywords] = useState<string[]>(['SaaS']);
  const [keywordInput, setKeywordInput] = useState('');
  const [country, setCountry] = useState('United States');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [targetCount, setTargetCount] = useState<number>(50);
  const [titles, setTitles] = useState<string[]>(DEFAULT_TITLES);
  const [titleInput, setTitleInput] = useState('');
  const [companySize, setCompanySize] = useState('all');
  const [enrichCompany, setEnrichCompany] = useState(true);

  // Execution & Live Scraper State
  const [isRunning, setIsRunning] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [records, setRecords] = useState<ScrapedProfile[]>([]);
  const [progressMessage, setProgressMessage] = useState<string>('Ready to scrape');
  const [latestQuery, setLatestQuery] = useState<string>('');
  const [activeEngine, setActiveEngine] = useState<string>('ddg');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'target_reached' | 'completed' | 'stopped' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Table Search Filter
  const [tableSearch, setTableSearch] = useState('');

  // Polling ref
  const pollIntervalRef = useRef<any>(null);
  const sseRef = useRef<EventSource | null>(null);

  // Backend connection status
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    const checkBackend = async () => {
      const apiBase = getApiBaseUrl();
      if (!apiBase) {
        if (mounted) setBackendOnline(false);
        return;
      }
      try {
        const res = await fetch(`${apiBase}/api/health`);
        if (mounted) setBackendOnline(res.ok);
      } catch {
        if (mounted) setBackendOnline(false);
      }
    };
    checkBackend();
    const interval = setInterval(checkBackend, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Add keyword
  const handleAddKeyword = (kw: string) => {
    const clean = kw.trim();
    if (clean && !keywords.includes(clean)) {
      setKeywords([...keywords, clean]);
      setKeywordInput('');
    }
  };

  const handleRemoveKeyword = (kw: string) => {
    setKeywords(keywords.filter((k) => k !== kw));
  };

  // Add title
  const handleAddTitle = (t: string) => {
    const clean = t.trim();
    if (clean && !titles.includes(clean)) {
      setTitles([...titles, clean]);
      setTitleInput('');
    }
  };

  const handleRemoveTitle = (t: string) => {
    setTitles(titles.filter((item) => item !== t));
  };

  // Start Scraping
  const handleStartScraping = async () => {
    if (keywords.length === 0) {
      alert('Please enter at least one keyword.');
      return;
    }

    setIsRunning(true);
    setStatus('running');
    setRecords([]);
    setDownloadUrl(null);
    setFileName(null);
    setErrorMessage(null);
    setProgressMessage('Connecting to search workers...');

    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setIsRunning(false);
      setStatus('error');
      setErrorMessage(
        'Backend server URL is not configured. Please set your Backend API URL in Settings or start the backend locally on port 8000.'
      );
      return;
    }

    try {
      const res = await fetch(`${apiBase}/api/collector/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords,
          country,
          state,
          city,
          targetCount,
          titles,
          companySize,
          enrichCompany,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to start scraping worker.');
      }

      const data = await res.json();
      setTaskId(data.taskId);

      // Start Polling loop to stream records
      startPolling(data.taskId);
    } catch (err: any) {
      setIsRunning(false);
      setStatus('error');
      setErrorMessage(err.message || 'Error launching scraper.');
    }
  };

  // Start polling backend status
  const startPolling = (id: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(async () => {
      const apiBase = getApiBaseUrl();
      if (!apiBase) return;

      try {
        const res = await fetch(`${apiBase}/api/collector/status/${id}`);
        if (!res.ok) return;

        const data = await res.json();
        // Live instantaneous records synchronization
        if (data.records && data.records.length > 0) {
          const cleaned = data.records.slice(0, targetCount).map((r: ScrapedProfile) => ({
            ...r,
            'Profile URL': cleanLinkedInUrl(r['Profile URL'] || '', r['Full name'] || '', r['Company name'] || ''),
          }));
          setRecords(cleaned);
        }

        if (data.latestQuery) setLatestQuery(data.latestQuery);
        if (data.activeEngine) setActiveEngine(data.activeEngine);
        if (data.progressMessage) setProgressMessage(data.progressMessage);
        if (data.downloadUrl) setDownloadUrl(data.downloadUrl);
        if (data.fileName) setFileName(data.fileName);

        if (data.status === 'completed' || data.status === 'stopped' || data.status === 'target_reached') {
          setIsRunning(false);
          setStatus(data.status);
          if (data.records && data.records.length > 0) {
            const cleaned = data.records.slice(0, targetCount).map((r: ScrapedProfile) => ({
              ...r,
              'Profile URL': cleanLinkedInUrl(r['Profile URL'] || '', r['Full name'] || '', r['Company name'] || ''),
            }));
            setRecords(cleaned);
          }
          clearInterval(pollIntervalRef.current);
        } else if (data.status === 'error') {
          setIsRunning(false);
          setStatus('error');
          setErrorMessage(data.error || 'Scraping encountered an error.');
          clearInterval(pollIntervalRef.current);
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 600);
  };

  // Stop Scraping
  const handleStopScraping = async () => {
    if (!taskId) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setProgressMessage('Halting crawler and preparing Excel spreadsheet...');
    try {
      const res = await fetch(`${apiBase}/api/collector/stop/${taskId}`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        setStatus('stopped');
        setIsRunning(false);
        if (data.downloadUrl) setDownloadUrl(data.downloadUrl);
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      }
    } catch (err) {
      console.error('Stop error:', err);
    }
  };

  // Download Excel (works both during live scraping and after completion)
  const handleClientDownload = async () => {
    if (records.length === 0) {
      alert('No records available to download yet.');
      return;
    }

    const apiBase = getApiBaseUrl();

    // If scraper is running or stopped, try exporting current snapshot from backend first
    if (taskId && apiBase) {
      try {
        const expRes = await fetch(`${apiBase}/api/collector/export-current/${taskId}`);
        if (expRes.ok) {
          const expData = await expRes.json();
          if (expData.downloadUrl) {
            window.open(`${apiBase}${expData.downloadUrl}`, '_blank');
            return;
          }
        }
      } catch (err) {
        console.warn('Backend export snapshot failed, falling back to instant client XLSX generation:', err);
      }
    }

    if (downloadUrl && apiBase) {
      window.open(`${apiBase}${downloadUrl}`, '_blank');
      return;
    }

    // Instant client-side Excel file generation
    const cleanRecords = records.map((r) => ({
      ...r,
      'Profile URL': cleanLinkedInUrl(r['Profile URL'] || '', r['Full name'] || '', r['Company name'] || ''),
    }));
    const ws = XLSX.utils.json_to_sheet(cleanRecords);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Profiles');
    const outName = fileName || `linkedin_profiles_${keywords[0] || 'leads'}_${Date.now()}.xlsx`;
    XLSX.writeFile(wb, outName);
  };

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (sseRef.current) sseRef.current.close();
    };
  }, []);

  // Filtered records for table view
  const filteredRecords = records.filter((r) => {
    if (!tableSearch) return true;
    const s = tableSearch.toLowerCase();
    const name = (r['Full name'] || r['Decision maker name'] || '').toLowerCase();
    const title = (r.Title || r['Decision maker title'] || '').toLowerCase();
    const comp = (r['Company name'] || '').toLowerCase();
    const loc = (r.Location || r['Headquarters'] || '').toLowerCase();
    const ind = (r.Industry || '').toLowerCase();
    return name.includes(s) || title.includes(s) || comp.includes(s) || loc.includes(s) || ind.includes(s);
  });

  const progressPercent = Math.min(100, Math.round((records.length / targetCount) * 100));

  return (
    <div className="space-y-6">
      {/* Top Banner / Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="p-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Keyword Lead Collector
            </h1>
            <Badge variant="success" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
              No SerpAPI Required (100% Free)
            </Badge>

            {backendOnline === true ? (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"
                title="FastAPI Python engine is active"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Engine Online
              </span>
            ) : backendOnline === false ? (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200"
                title="Python backend server is offline"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                Engine Offline
              </span>
            ) : null}
          </div>
          <p className="text-sm text-slate-600 max-w-3xl">
            Extract verified decision-maker LinkedIn profiles using precision search dorks on DuckDuckGo and Bing.
            Provide custom keywords, locations, company size, and your desired data count. The scraper halts automatically
            once your target is reached and prepares an Excel spreadsheet.
          </p>
        </div>

        {/* Global Action / Stats Header */}
        <div className="flex items-center gap-3 shrink-0">
          {records.length > 0 && (
            <Button
              variant="outline"
              onClick={handleClientDownload}
              className="border-emerald-600 text-emerald-700 hover:bg-emerald-50 font-semibold flex items-center gap-2"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              {isRunning ? `Export Collected (${records.length})` : `Download Excel (${records.length})`}
            </Button>
          )}

          {!isRunning ? (
            <Button
              variant="primary"
              onClick={handleStartScraping}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-2 shadow-sm"
            >
              <Play className="w-4 h-4 fill-white" />
              Start Live Scraping
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={handleStopScraping}
              className="border-rose-300 text-rose-700 hover:bg-rose-50 font-semibold flex items-center gap-2"
            >
              <Square className="w-4 h-4 fill-rose-600 text-rose-600" />
              Stop & Finalize
            </Button>
          )}
        </div>
      </div>

      {backendOnline === false && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-3 shadow-xs">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1.5">
            <div className="font-bold text-sm text-amber-950">
              Python Scraping Engine Offline on Deployed Web
            </div>
            <p className="text-amber-800 leading-relaxed text-xs">
              Keyword Lead Collector uses the Python backend (<code className="bg-white/80 px-1 py-0.5 rounded font-mono text-slate-800">backend/server.py</code>) to execute real-time searches and profile extraction.
              Because Vercel only hosts the React frontend, you must connect the frontend to your running backend (e.g. deployed on Render.com, Railway, or via Ngrok/Cloudflare tunnel).
            </p>
            <div className="pt-1 flex items-center gap-3">
              <a
                href="/settings"
                className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:text-blue-800 bg-white px-3 py-1.5 rounded-lg border border-amber-200 shadow-xs text-xs"
              >
                Configure Backend URL in Settings &rarr;
              </a>
              <span className="text-amber-700 text-[11px]">
                Tip: Run <code className="bg-white/80 px-1 rounded font-mono">npx ngrok http 8000</code> or deploy on Render.com.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Main Grid: Config Form & Live Crawler Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Scraping Parameters (7 Cols) */}
        <div className="lg:col-span-7 space-y-5">
          <Card className="p-5 border-slate-200/80 shadow-xs">
            <h2 className="text-base font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              Target Parameters & Filters
            </h2>

            {/* Keywords Section */}
            <div className="space-y-3 mb-5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center justify-between">
                <span>1. Keywords (Niche, Product, or Industry) *</span>
                <span className="text-slate-400 font-normal lowercase">{keywords.length} added</span>
              </label>

              {/* Tag Box */}
              <div className="flex flex-wrap gap-2 p-2.5 min-h-[44px] rounded-lg border border-slate-200 bg-slate-50/50">
                {keywords.map((kw) => (
                  <span
                    key={kw}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-100/80 text-blue-800 border border-blue-200"
                  >
                    {kw}
                    <button
                      type="button"
                      onClick={() => handleRemoveKeyword(kw)}
                      className="hover:text-blue-900 focus:outline-none"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}

                <input
                  type="text"
                  placeholder={keywords.length === 0 ? 'Type keyword & press Enter...' : 'Add another...'}
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      handleAddKeyword(keywordInput);
                    }
                  }}
                  className="flex-1 bg-transparent border-none outline-none text-xs text-slate-800 min-w-[140px]"
                />
              </div>

              {/* Suggested Niche Chips */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] text-slate-400 font-medium">Quick Suggestions:</span>
                {PRESET_KEYWORDS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => handleAddKeyword(item)}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 border border-slate-200/80 transition-colors"
                  >
                    + {item}
                  </button>
                ))}
              </div>
            </div>

            {/* Target Data Size Section (Prompt: Ask the user about the size of data) */}
            <div className="space-y-3 mb-5 p-4 rounded-xl bg-blue-50/50 border border-blue-100">
              <label className="text-xs font-bold uppercase tracking-wider text-blue-950 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-blue-600" />
                  2. Target Data Size (How much data do you want?) *
                </span>
                <span className="text-blue-700 font-bold">{targetCount} Profiles Max</span>
              </label>

              <div className="flex items-center gap-3">
                <div className="w-36">
                  <Input
                    type="number"
                    min={1}
                    max={2000}
                    value={targetCount}
                    onChange={(e) => setTargetCount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="bg-white font-semibold text-slate-900"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5 flex-1">
                  {TARGET_PRESETS.map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => setTargetCount(cnt)}
                      className={cn(
                        'text-xs font-semibold px-2.5 py-1 rounded-md border transition-all',
                        targetCount === cnt
                          ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      )}
                    >
                      {cnt}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[11px] text-blue-700/80">
                The algorithm automatically stops and finalizes your Excel sheet as soon as this limit is reached.
              </p>
            </div>

            {/* Location Section (Country, State, City) */}
            <div className="space-y-3 mb-5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-slate-500" />
                3. Geographic Location (Country, State, City)
              </label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <span className="text-[11px] font-medium text-slate-500 block mb-1">Country</span>
                  <Input
                    placeholder="e.g. United States"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                  />
                </div>
                <div>
                  <span className="text-[11px] font-medium text-slate-500 block mb-1">State / Region</span>
                  <Input
                    placeholder="e.g. Texas, New Jersey"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                  />
                </div>
                <div>
                  <span className="text-[11px] font-medium text-slate-500 block mb-1">City</span>
                  <Input
                    placeholder="e.g. Austin, Las Vegas"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Decision Maker Roles / Titles */}
            <div className="space-y-3 mb-5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5 text-slate-500" />
                  4. Decision Maker Titles / Roles
                </span>
                <span className="text-slate-400 font-normal lowercase">{titles.length} selected</span>
              </label>

              <div className="flex flex-wrap gap-2 p-2 rounded-lg border border-slate-200 bg-slate-50/50">
                {titles.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-slate-200 text-slate-800"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => handleRemoveTitle(t)}
                      className="hover:text-slate-900"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  placeholder="Add role (e.g. CTO) & press Enter"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      handleAddTitle(titleInput);
                    }
                  }}
                  className="bg-transparent border-none outline-none text-xs text-slate-800 min-w-[120px]"
                />
              </div>
            </div>

            {/* Company Size & Verified Enrichment Toggle */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-600 block mb-1.5">
                  5. Company Size Filter
                </label>
                <Select
                  value={companySize}
                  onChange={(e) => setCompanySize(e.target.value)}
                >
                  <option value="all">Any Size (All Companies)</option>
                  <option value="1-10">1-10 employees (Micro)</option>
                  <option value="11-50">11-50 employees (Small)</option>
                  <option value="51-200">51-200 employees (Mid-Market)</option>
                  <option value="201-500">201-500 employees (Medium)</option>
                  <option value="501-1000">501-1000 employees (Upper Mid)</option>
                  <option value="1000+">1000+ employees (Enterprise)</option>
                </Select>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200/80">
                <div>
                  <span className="text-xs font-semibold text-slate-800 block">Enrich Company & Industry</span>
                  <span className="text-[11px] text-slate-500 block">Industry is never guessed; verified from company data</span>
                </div>
                <input
                  type="checkbox"
                  checked={enrichCompany}
                  onChange={(e) => setEnrichCompany(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                />
              </div>
            </div>
          </Card>
        </div>

        {/* Right Column: Live Scraping Monitor (5 Cols) */}
        <div className="lg:col-span-5 space-y-5">
          <Card className="p-5 border-slate-200/80 shadow-xs bg-slate-900 text-white">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Radio className={cn('w-4 h-4', isRunning ? 'text-emerald-400 animate-pulse' : 'text-slate-400')} />
                <span className="font-semibold text-sm">Live Scraper Engine</span>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  'border text-[11px]',
                  isRunning
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                    : status === 'completed' || status === 'target_reached'
                      ? 'border-blue-500/50 bg-blue-500/10 text-blue-300'
                      : 'border-slate-700 bg-slate-800 text-slate-400'
                )}
              >
                {isRunning ? 'Scraping Live' : status.toUpperCase()}
              </Badge>
            </div>

            {/* Live Progress Percentage */}
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-300 font-medium">
                <span>Progress ({records.length} / {targetCount} profiles)</span>
                <span className="text-emerald-400 font-mono font-bold">{progressPercent}%</span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* Metric Counters */}
            <div className="grid grid-cols-2 gap-3 mt-5">
              <div className="p-3 rounded-lg bg-slate-800/80 border border-slate-700/60">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Collected</span>
                <p className="text-2xl font-bold text-white mt-0.5">{records.length}</p>
                <span className="text-[10px] text-slate-400 font-medium">Cap: {targetCount} max</span>
              </div>
              <div className="p-3 rounded-lg bg-slate-800/80 border border-slate-700/60">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Engine In Rotation</span>
                <p className="text-xl font-bold text-emerald-400 mt-0.5 uppercase">{activeEngine}</p>
                <span className="text-[10px] text-slate-400 font-medium">DuckDuckGo / Bing</span>
              </div>
            </div>

            {/* Current Query & Log Feed */}
            <div className="mt-4 space-y-1.5">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                Live Scanner Feed
              </span>
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono space-y-1.5 max-h-36 overflow-y-auto">
                <p className="text-slate-300 flex items-center gap-1.5">
                  <Clock className="w-3 h-3 text-slate-500" />
                  <span className="text-emerald-400">&gt;</span> {progressMessage}
                </p>
                {latestQuery && (
                  <p className="text-slate-400 text-[11px] truncate">
                    <span className="text-blue-400">query:</span> {latestQuery}
                  </p>
                )}
                {records.length > 0 && (
                  <p className="text-slate-400 text-[11px]">
                    <span className="text-emerald-400">latest:</span> {records[records.length - 1]['Full name']} (
                    {records[records.length - 1]['Company name']})
                  </p>
                )}
              </div>
            </div>

            {/* Excel Download CTA */}
            {records.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-800">
                <Button
                  variant="primary"
                  onClick={handleClientDownload}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center justify-center gap-2 shadow-sm"
                >
                  <Download className="w-4 h-4" />
                  {isRunning ? `Export Current Progress (${records.length} Profiles)` : `Download Excel Sheet (${records.length} Profiles)`}
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Real-Time Live Data Table */}
      <Card className="border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white">
          <div className="flex items-center gap-3">
            <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              Scraped LinkedIn Profiles
            </h3>
            <Badge variant="outline" className="text-xs bg-slate-50">
              {records.length} Profiles
            </Badge>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
              <Input
                placeholder="Search extracted leads..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>

            {records.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClientDownload}
                className="text-xs border-emerald-600 text-emerald-700 hover:bg-emerald-50 font-semibold flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5 text-emerald-600" />
                {isRunning ? `Export Partial (${records.length})` : 'Export (.xlsx)'}
              </Button>
            )}
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4">#</th>
                <th className="py-3 px-4">Full Name</th>
                <th className="py-3 px-4">Title / Role</th>
                <th className="py-3 px-4">Company Name</th>
                <th className="py-3 px-4">Location</th>
                <th className="py-3 px-4">Industry (Verified)</th>
                <th className="py-3 px-4">Company Size</th>
                <th className="py-3 px-4 text-right">LinkedIn Profile</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    {isRunning ? (
                      <div className="flex flex-col items-center justify-center gap-2">
                        <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
                        <span className="font-medium text-slate-600">Scraping search engines... profiles will appear live here</span>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="font-semibold text-slate-600">No scraped profiles yet</p>
                        <p className="text-xs text-slate-400">
                          Configure your keywords, location, and data target above, then click &ldquo;Start Live Scraping&rdquo;.
                        </p>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                filteredRecords.map((r, i) => (
                  <tr key={`${r['Decision maker LinkedIn URL'] || r['Profile URL'] || r['Company LinkedIn URL']}-${i}`} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono text-slate-400 text-[11px]">{i + 1}</td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{r['Decision maker name'] || r['Full name'] || r['Company name']}</div>
                      <div className="text-[11px] text-slate-400">{r['DM confidence'] || r['Contact type'] || 'Verified'}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-700 font-medium max-w-[200px] truncate" title={r['Decision maker title'] || r.Title}>
                      {r['Decision maker title'] || r.Title || '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-900 font-semibold max-w-[180px] truncate" title={r['Company name']}>
                      {r['Company name'] || '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-600 text-[11px] max-w-[150px] truncate" title={r['Headquarters'] || r.Location}>
                      {r['Headquarters'] || r.Location || '—'}
                    </td>
                    <td className="py-3 px-4">
                      {r.Industry ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {r.Industry}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">Unverified (Blank)</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-600 text-[11px]">
                      {r['Company size'] || '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <a
                        href={r['Decision maker LinkedIn URL'] || r['Profile URL'] || r['Company LinkedIn URL']}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium hover:underline text-xs"
                      >
                        <span>View Profile</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
