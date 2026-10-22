import React, { useState } from 'react';
import {
  Settings as SettingsIcon,
  Sliders,
  Code2,
  FileSpreadsheet,
  Trash2,
  CheckCircle2,
  Cpu,
  Layers,
  HelpCircle,
  ShieldCheck,
  Zap,
  Server,
  Globe,
  Activity,
  Wifi,
  WifiOff,
  ExternalLink,
  Sparkles,
  Key,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { storageService } from '../services/storageService';
import { AppSettings } from '../types';
import { getApiBaseUrl } from '../config/api';

export const Settings: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(() => storageService.getSettings());
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  // Backend connection state
  const [backendEndpoint, setBackendEndpoint] = useState<string>(
    settings.customScraperEndpoint || (typeof window !== 'undefined' && window.location.hostname === 'localhost' ? 'http://127.0.0.1:8000' : '')
  );
  const [testState, setTestState] = useState<{
    status: 'idle' | 'testing' | 'online' | 'offline';
    message: string;
  }>({
    status: 'idle',
    message: '',
  });

  const handleUpdate = (updated: Partial<AppSettings>) => {
    const next = storageService.saveSettings(updated);
    setSettings(next);
    setSaveNotice('Settings updated successfully!');
    setTimeout(() => setSaveNotice(null), 2500);
  };

  const handleTestBackend = async () => {
    const target = backendEndpoint.trim().replace(/\/+$/, '');
    if (!target) {
      setTestState({
        status: 'offline',
        message: 'Please enter a valid backend URL (e.g. https://your-backend.onrender.com or http://127.0.0.1:8000).',
      });
      return;
    }

    setTestState({ status: 'testing', message: 'Pinging backend health endpoint...' });

    try {
      const startTime = Date.now();
      const res = await fetch(`${target}/api/health`, { method: 'GET' });
      const latency = Date.now() - startTime;

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setTestState({
          status: 'online',
          message: `Backend Online! Connected successfully (${latency}ms latency). Engine: ${data.engine || 'FastAPI'}`,
        });
        // Auto-save the working endpoint
        handleUpdate({ customScraperEndpoint: target });
      } else {
        setTestState({
          status: 'offline',
          message: `Server returned HTTP ${res.status}. Check your backend server logs.`,
        });
      }
    } catch (err: any) {
      setTestState({
        status: 'offline',
        message: `Failed to connect: ${err.message}. If deploying to Vercel, deploy your Python backend on Render/Railway with HTTPS.`,
      });
    }
  };

  const handleSaveEndpoint = () => {
    handleUpdate({ customScraperEndpoint: backendEndpoint.trim() });
  };

  const handleResetData = () => {
    if (confirm('Are you sure you want to reset all projects, exports, and local storage state back to defaults?')) {
      storageService.resetAllData();
      window.location.reload();
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Title */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Platform & Adapter Settings</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure backend crawler endpoints, research latency, and export formats.
          </p>
        </div>
        <Badge variant="default" className="text-xs">
          Modular Architecture
        </Badge>
      </div>

      {saveNotice && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{saveNotice}</span>
        </div>
      )}

      {/* 0. Cloud & Vercel Backend Server Configuration */}
      <Card className="border-blue-200 shadow-xs">
        <CardHeader className="p-5 border-b border-slate-100 bg-blue-50/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="w-5 h-5 text-blue-600" />
              <div>
                <CardTitle className="text-base text-slate-900">Python Backend Server (Cloud & Vercel)</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Connect your deployed FastAPI backend server to power live multi-threaded scraping.
                </CardDescription>
              </div>
            </div>
            {testState.status === 'online' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                <Wifi className="w-3.5 h-3.5 text-emerald-600" />
                Online
              </span>
            )}
            {testState.status === 'offline' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800">
                <WifiOff className="w-3.5 h-3.5 text-rose-600" />
                Offline
              </span>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-800">
              Backend API Server URL
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={backendEndpoint}
                onChange={(e) => setBackendEndpoint(e.target.value)}
                placeholder="https://ai-auto-scrapper-backend.onrender.com or http://127.0.0.1:8000"
                className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleTestBackend}
                  disabled={testState.status === 'testing'}
                  className="text-xs whitespace-nowrap"
                >
                  <Activity className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
                  {testState.status === 'testing' ? 'Testing...' : 'Test Connection'}
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveEndpoint}
                  className="text-xs bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap"
                >
                  Save URL
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Active endpoint resolved by frontend:{' '}
              <code className="text-blue-700 bg-blue-50 px-1 py-0.5 rounded font-mono">
                {getApiBaseUrl() || 'None (Running in local-only mode)'}
              </code>
            </p>
          </div>

          {testState.message && (
            <div
              className={`p-3 rounded-xl border text-xs font-medium flex items-start gap-2 ${
                testState.status === 'online'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {testState.status === 'online' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <WifiOff className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <span>{testState.message}</span>
            </div>
          )}

          {/* Setup Guide Accordion / Box */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <Globe className="w-4 h-4 text-slate-600" />
              How to configure your backend for Vercel deployment:
            </h4>
            <div className="text-xs text-slate-600 space-y-2 leading-relaxed">
              <p>
                <strong>Why was the backend offline?</strong> Vercel only hosts the compiled React frontend. The Python scrapers (<code className="font-mono bg-white px-1 py-0.5 rounded text-slate-700">backend/server.py</code>) require a running Python runtime.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-1">
                  <span className="font-bold text-slate-800 text-[11px] block">Option 1: Deploy on Render.com (Free)</span>
                  <p className="text-[11px] text-slate-500">
                    1. Create a free Web Service on <strong>Render.com</strong> from your GitHub repo.
                    <br />
                    2. Build Command: <code className="bg-slate-100 px-1 rounded">pip install -r requirements.txt</code>
                    <br />
                    3. Start Command: <code className="bg-slate-100 px-1 rounded">uvicorn backend.server:app --host 0.0.0.0 --port $PORT</code>
                    <br />
                    4. Paste your Render URL above (or set <code className="bg-slate-100 px-1 rounded">VITE_API_URL</code> in Vercel).
                  </p>
                </div>

                <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-1">
                  <span className="font-bold text-slate-800 text-[11px] block">Option 2: Local Development</span>
                  <p className="text-[11px] text-slate-500">
                    If testing on your local machine, run:
                    <br />
                    <code className="bg-slate-100 px-1 rounded font-mono">venv/bin/python backend/server.py</code>
                    <br />
                    The frontend automatically detects <code className="bg-slate-100 px-1 rounded font-mono">http://127.0.0.1:8000</code>.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI Intelligence & API Keys (Google Gemini Free Tier) */}
      <Card>
        <CardHeader className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            <CardTitle className="text-base">AI Intelligence Engine (Decision Maker Finder)</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Connect your free Google Gemini API key (or OpenAI API key) for real-time executive decision maker identification, company verification, and title resolution.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-800">
                  Google Gemini API Key (Free)
                </label>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-blue-600 hover:underline flex items-center gap-1 font-medium"
                >
                  Get free key at Google AI Studio <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={settings.geminiApiKey || ''}
                  onChange={(e) => handleUpdate({ geminiApiKey: e.target.value.trim() })}
                  placeholder="AIzaSy..."
                  className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                />
              </div>
              <p className="text-[11px] text-slate-500">
                Can also be provided as <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">GEMINI_API_KEY</code> in your backend <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">.env</code>.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-800">
                Gemini Model
              </label>
              <select
                value={settings.geminiModel || 'gemini-1.5-flash'}
                onChange={(e) => handleUpdate({ geminiModel: e.target.value })}
                className="w-full h-9 px-3 text-xs rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="gemini-1.5-flash">gemini-1.5-flash (Fast & Free Tier)</option>
                <option value="gemini-2.0-flash">gemini-2.0-flash (Latest Ultra-Fast)</option>
                <option value="gemini-1.5-pro">gemini-1.5-pro (Deep Multi-Source Reasoning)</option>
              </select>
              <p className="text-[11px] text-slate-500">
                Default: <span className="font-semibold text-slate-700">gemini-1.5-flash</span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* LeadOcean Phone & Email Enricher Settings */}
      <Card>
        <CardHeader className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-emerald-600" />
            <CardTitle className="text-base">LeadOcean Email & Phone Enrichment API</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Connect your LeadOcean API key to enrich leads with verified corporate emails and direct phone numbers.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-800">
                LeadOcean API Key
              </label>
              <input
                type="password"
                value={settings.leadoceanApiKey || ''}
                onChange={(e) => {
                  const key = e.target.value.trim();
                  handleUpdate({ leadoceanApiKey: key });
                  const apiBase = getApiBaseUrl();
                  if (apiBase) {
                    fetch(`${apiBase}/api/leadocean/config`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ apiKey: key }),
                    }).catch(() => {});
                  }
                }}
                placeholder="lo_live_..."
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white"
              />
              <p className="text-[11px] text-slate-500">
                Stored in <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">.env</code> as <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">LEADOCEAN_API_KEY</code>.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-800">
                LeadOcean Endpoint URL
              </label>
              <input
                type="text"
                value={settings.leadoceanEndpoint || 'https://api.leadocean.io/v1/people/enrich'}
                onChange={(e) => {
                  const url = e.target.value.trim();
                  handleUpdate({ leadoceanEndpoint: url });
                  const apiBase = getApiBaseUrl();
                  if (apiBase) {
                    fetch(`${apiBase}/api/leadocean/config`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ url }),
                    }).catch(() => {});
                  }
                }}
                placeholder="https://api.leadocean.io/v1/people/enrich"
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white"
              />
              <p className="text-[11px] text-slate-500">
                Configured in <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">leadocean_config.json</code>.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 1. Simulation & Crawler Timing */}
      <Card>
        <CardHeader className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-blue-600" />
            <CardTitle className="text-base">Simulation Engine & Latency</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Controls artificial crawler delay and networking simulation stages across all 5 modules.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Default Crawling Speed
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { id: 'fast', title: 'Turbo Fast', desc: '200ms delay per company' },
                { id: 'realistic', title: 'Realistic Simulation', desc: '400ms delay with MX check' },
                { id: 'thorough', title: 'Deep Crawl', desc: '900ms delay with full verification' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleUpdate({ simulationSpeed: opt.id as any })}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    settings.simulationSpeed === opt.id
                      ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20 text-blue-900'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="text-xs font-bold">{opt.title}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. Default Export Preferences */}
      <Card>
        <CardHeader className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <CardTitle className="text-base">Default Spreadsheet Export Settings</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Default configurations applied when generating SheetJS Excel (.xlsx) and CSV files.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-5 space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                Preferred File Format
              </label>
              <select
                value={settings.defaultExportFormat}
                onChange={(e) => handleUpdate({ defaultExportFormat: e.target.value as any })}
                className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-700 shadow-xs"
              >
                <option value="xlsx">Microsoft Excel (.xlsx)</option>
                <option value="csv">Comma-Separated Values (.csv)</option>
              </select>
            </div>

            <div className="space-y-2 pt-5">
              <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.includeConfidenceScore}
                  onChange={(e) => handleUpdate({ includeConfidenceScore: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>Include algorithmic confidence percentage (0-100%) in exports</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.includeTimestampInExport}
                  onChange={(e) => handleUpdate({ includeTimestampInExport: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>Include timestamp in generated spreadsheet filenames</span>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. Scraper Integration Guide & Adapter Architecture */}
      <Card>
        <CardHeader className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-indigo-600" />
            <CardTitle className="text-base">Scraping Algorithm Integration Guide</CardTitle>
          </div>
          <CardDescription className="text-xs">
            How to plug your existing Python/Node scraping modules into the frontend adapters.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-5 space-y-4 text-xs leading-relaxed text-slate-600">
          <p>
            The UI is decoupled from any backend via the TypeScript adapter interface{' '}
            <code className="bg-slate-100 px-1.5 py-0.5 rounded text-blue-700 font-mono text-[11px]">
              IResearchAdapter
            </code>{' '}
            located in <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono text-[11px]">src/services/adapters/baseAdapter.ts</code>.
          </p>

          <div className="p-4 rounded-xl bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto space-y-2 shadow-inner">
            <div className="text-slate-400">// Example: To connect your real Python scraper later:</div>
            <div>
              <span className="text-purple-400">export class</span>{' '}
              <span className="text-yellow-300">LiveScraperAdapter</span>{' '}
              <span className="text-purple-400">implements</span>{' '}
              <span className="text-emerald-400">IResearchAdapter</span> &#123;
            </div>
            <div className="pl-4">
              <span className="text-purple-400">async</span>{' '}
              <span className="text-blue-400">enrichSingle</span>(record, config) &#123;
            </div>
            <div className="pl-8 text-slate-400">// Replace mock generation with your local API call</div>
            <div className="pl-8">
              <span className="text-purple-400">const</span> response ={' '}
              <span className="text-purple-400">await</span> fetch(<span className="text-emerald-300">'http://localhost:8000/api/scrape'</span>, &#123;
            </div>
            <div className="pl-12">method: <span className="text-emerald-300">'POST'</span>, body: JSON.stringify(record)</div>
            <div className="pl-8">&#125;);</div>
            <div className="pl-8"><span className="text-purple-400">return await</span> response.json();</div>
            <div className="pl-4">&#125;</div>
            <div>&#125;</div>
          </div>

          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-[11px] flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <span>
              <strong>Zero Security Exposure:</strong> The application does not bundle API keys, secrets, or database credentials. All scraping operations can remain hosted on your private backend service.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 4. Danger Zone / Reset */}
      <Card className="border-rose-200 bg-rose-50/20">
        <CardHeader className="p-5 border-b border-rose-100">
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-rose-600" />
            <CardTitle className="text-base text-rose-900">Reset Local Application State</CardTitle>
          </div>
          <CardDescription className="text-xs text-rose-700">
            Clear all saved projects, imported spreadsheets, and export history from browser localStorage.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-5">
          <Button
            variant="danger"
            size="sm"
            onClick={handleResetData}
            className="text-xs"
          >
            Reset All Data to Factory Default
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
