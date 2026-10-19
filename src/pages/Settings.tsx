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
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { storageService } from '../services/storageService';
import { AppSettings } from '../types';

export const Settings: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(() => storageService.getSettings());
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const handleUpdate = (updated: Partial<AppSettings>) => {
    const next = storageService.saveSettings(updated);
    setSettings(next);
    setSaveNotice('Settings updated successfully!');
    setTimeout(() => setSaveNotice(null), 2000);
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
            Manage research simulation speed, export preferences, and view scraper integration hooks.
          </p>
        </div>
        <Badge variant="default" className="text-xs">
          Modular Sandbox
        </Badge>
      </div>

      {saveNotice && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{saveNotice}</span>
        </div>
      )}

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
