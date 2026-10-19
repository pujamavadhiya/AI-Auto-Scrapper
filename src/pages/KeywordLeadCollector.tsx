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

export interface ScrapedProfile {
  tab: string;
  Region: string;
  Segment: string;
  'Company name': string;
  'Company size': string;
  Industry: string;
  'Industry source': string;
  'Full name': string;
  Title: string;
  'Profile URL': string;
  Location: string;
  'Contact type': string;
  'Search used': string;
  'Date collected': string;
  Approved: string;
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

    try {
      const res = await fetch('http://127.0.0.1:8000/api/collector/start', {
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
      try {
        const res = await fetch(`http://127.0.0.1:8000/api/collector/status/${id}`);
        if (!res.ok) return;

        const data = await res.json();
        if (data.newRecords && data.newRecords.length > 0) {
          setRecords((prev) => {
            const seen = new Set(prev.map((r) => r['Profile URL'].toLowerCase()));
            const incoming = data.newRecords.filter((r: ScrapedProfile) => !seen.has(r['Profile URL'].toLowerCase()));
            return [...prev, ...incoming];
          });
        }

        if (data.latestQuery) setLatestQuery(data.latestQuery);
        if (data.activeEngine) setActiveEngine(data.activeEngine);
        if (data.progressMessage) setProgressMessage(data.progressMessage);
        if (data.downloadUrl) setDownloadUrl(data.downloadUrl);
        if (data.fileName) setFileName(data.fileName);

        if (data.status === 'completed' || data.status === 'stopped' || data.status === 'target_reached') {
          setIsRunning(false);
          setStatus(data.status);
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
    }, 1500);
  };

  // Stop Scraping
  const handleStopScraping = async () => {
    if (!taskId) return;
    setProgressMessage('Halting crawler and preparing Excel spreadsheet...');
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/collector/stop/${taskId}`, {
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

  // Client-side fallback Excel download
  const handleClientDownload = () => {
    if (downloadUrl) {
      window.open(`http://127.0.0.1:8000${downloadUrl}`, '_blank');
      return;
    }

    if (records.length === 0) {
      alert('No records available to download.');
      return;
    }

    const ws = XLSX.utils.json_to_sheet(records);
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
    return (
      r['Full name'].toLowerCase().includes(s) ||
      r.Title.toLowerCase().includes(s) ||
      r['Company name'].toLowerCase().includes(s) ||
      r.Location.toLowerCase().includes(s) ||
      r.Industry.toLowerCase().includes(s)
    );
  });

  const progressPercent = Math.min(100, Math.round((records.length / targetCount) * 100));

  return (
    <div className="space-y-6">
      {/* Top Banner / Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Keyword Lead Collector
            </h1>
            <Badge variant="success" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
              No SerpAPI Required (100% Free)
            </Badge>
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
              Download Excel ({records.length})
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
                  Download Excel Sheet ({records.length} Profiles)
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
                Export (.xlsx)
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
                  <tr key={`${r['Profile URL']}-${i}`} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono text-slate-400 text-[11px]">{i + 1}</td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{r['Full name']}</div>
                      <div className="text-[11px] text-slate-400">{r['Contact type']}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-700 font-medium max-w-[200px] truncate" title={r.Title}>
                      {r.Title || '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-900 font-semibold max-w-[180px] truncate" title={r['Company name']}>
                      {r['Company name'] || '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-600 text-[11px] max-w-[150px] truncate" title={r.Location}>
                      {r.Location || '—'}
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
                        href={r['Profile URL']}
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
