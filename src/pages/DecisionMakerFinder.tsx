import React, { useState, useRef, useEffect } from 'react';
import {
  UserCheck,
  FileSpreadsheet,
  Plus,
  UploadCloud,
  Key,
  CheckCircle2,
  AlertCircle,
  Briefcase,
  Globe,
  Linkedin,
  Trash2,
  Play,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { ModuleHeader } from '../components/common/ModuleHeader';
import { FileUploader } from '../components/common/FileUploader';
import { ColumnMapper } from '../components/common/ColumnMapper';
import { DataTable } from '../components/common/DataTable';
import { ProgressIndicator } from '../components/common/ProgressIndicator';
import { ExportModal } from '../components/common/ExportModal';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EnrichmentRecord, ResearchConfig, ResearchProgress, ColumnMapping } from '../types';
import { ParsedFileResult } from '../services/excelService';
import { decisionMakerService } from '../services/adapters';
import { storageService } from '../services/storageService';
import { getApiBaseUrl, getAuthHeaders } from '../config/api';
import { historyService } from '../services/historyService';

export const DecisionMakerFinder: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'table' | 'quick' | 'upload'>('table');
  const [records, setRecords] = useState<EnrichmentRecord[]>([]);
  const [parsedFile, setParsedFile] = useState<ParsedFileResult | null>(null);

  // Quick form input state
  const [quickForm, setQuickForm] = useState({
    companyName: '',
    companyWebsite: '',
    companyLinkedinUrl: '',
  });

  // Bulk paste text state
  const [bulkPasteText, setBulkPasteText] = useState('');

  // Engine selection state: 'serpapi' | 'serper'
  const [selectedEngine, setSelectedEngine] = useState<'serpapi' | 'serper'>(() => {
    return storageService.getSettings()?.defaultDecisionMakerEngine || 'serpapi';
  });

  // Backend config status for both SerpApi and Serper
  const [serverConfig, setServerConfig] = useState<{
    hasSerpApiKey: boolean;
    serpApiKeyPreview: string;
    hasSerperApiKey: boolean;
    serperApiKeyPreview: string;
    defaultEngine: string;
  }>({
    hasSerpApiKey: false,
    serpApiKeyPreview: 'checking...',
    hasSerperApiKey: false,
    serperApiKeyPreview: 'checking...',
    defaultEngine: 'serpapi',
  });

  // Inline API key entry state if selected engine is missing a key
  const [inlineKeyInput, setInlineKeyInput] = useState('');
  const [isSavingInlineKey, setIsSavingInlineKey] = useState(false);

  const [config, setConfig] = useState<ResearchConfig>({
    seniorityLevels: ['Owner', 'Founder', 'CEO', 'Managing Director'],
  });

  const [progress, setProgress] = useState<ResearchProgress>({
    isActive: false,
    currentIndex: 0,
    totalCount: 0,
    percentage: 0,
    status: 'idle',
    stageMessage: '',
    currentItemName: '',
    leadsFound: 0,
    leadsProcessed: 0,
    elapsedSeconds: 0,
  });

  const [exportModalState, setExportModalState] = useState<{
    isOpen: boolean;
    scope: 'all' | 'filtered' | 'selected';
    records: EnrichmentRecord[];
  }>({
    isOpen: false,
    scope: 'all',
    records: [],
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  // Check backend engine config on mount
  useEffect(() => {
    const checkServerConfig = async () => {
      const apiBase = getApiBaseUrl();
      if (!apiBase) return;
      try {
        const res = await fetch(`${apiBase}/api/decision-makers/config`, {
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          const data = await res.json();
          setServerConfig({
            hasSerpApiKey: !!data.hasSerpApiKey,
            serpApiKeyPreview: data.serpApiKeyPreview || data.keyPreview || 'missing',
            hasSerperApiKey: !!data.hasSerperApiKey,
            serperApiKeyPreview: data.serperApiKeyPreview || 'missing',
            defaultEngine: data.defaultEngine || 'serpapi',
          });
        }
      } catch (e) {
        console.warn('Could not query decision makers config:', e);
      }
    };
    checkServerConfig();
  }, []);

  const handleSaveInlineKey = async () => {
    const cleanKey = inlineKeyInput.trim();
    if (!cleanKey) return;
    setIsSavingInlineKey(true);
    try {
      const apiBase = getApiBaseUrl();
      if (apiBase) {
        await fetch(`${apiBase}/api/decision-makers/config`, {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(
            selectedEngine === 'serper'
              ? { serperKey: cleanKey }
              : { serpapiKey: cleanKey }
          ),
        });
      }
      if (selectedEngine === 'serper') {
        storageService.saveSettings({ serperApiKey: cleanKey });
        setServerConfig((prev) => ({
          ...prev,
          hasSerperApiKey: true,
          serperApiKeyPreview: cleanKey.slice(0, 4) + '...' + cleanKey.slice(-4),
        }));
      } else {
        storageService.saveSettings({ serpApiKey: cleanKey });
        setServerConfig((prev) => ({
          ...prev,
          hasSerpApiKey: true,
          serpApiKeyPreview: cleanKey.slice(0, 4) + '...' + cleanKey.slice(-4),
        }));
      }
      setInlineKeyInput('');
      alert(`${selectedEngine === 'serper' ? 'Serper.dev' : 'SerpApi'} key saved successfully!`);
    } catch (e: any) {
      alert(`Failed to save key: ${e.message}`);
    } finally {
      setIsSavingInlineKey(false);
    }
  };

  const handleFileParsed = (parsed: ParsedFileResult) => {
    setParsedFile(parsed);
  };

  const handleMappingConfirmed = (newRecords: EnrichmentRecord[], _mapping: ColumnMapping) => {
    const normalized = newRecords.map((r) => {
      let comp =
        r.companyName ||
        r.customFields?.['Name'] ||
        r.customFields?.['Company'] ||
        r.customFields?.['Company Name'] ||
        r.customFields?.['company'] ||
        '';

      let web =
        r.companyWebsite ||
        r.domain ||
        r.customFields?.['Website'] ||
        r.customFields?.['Company URL'] ||
        r.customFields?.['website'] ||
        r.customFields?.['URL'] ||
        '';
      web = String(web).trim().replace(/^(https?:\/\/)+/i, 'https://');
      if (web && !web.startsWith('http://') && !web.startsWith('https://')) {
        web = `https://${web.replace(/^\/+/, '')}`;
      }

      let li =
        r.companyLinkedinUrl ||
        r.customFields?.['Linkedin'] ||
        r.customFields?.['Company Linkedin'] ||
        r.customFields?.['Company LinkedIn'] ||
        r.customFields?.['companyLinkedin'] ||
        '';
      li = String(li).trim().replace(/^(https?:\/\/)+/i, 'https://');
      if (li && !li.startsWith('http://') && !li.startsWith('https://')) {
        li = `https://${li.replace(/^\/+/, '')}`;
      }

      return {
        ...r,
        companyName: comp,
        companyWebsite: web || r.companyWebsite,
        companyLinkedinUrl: li || r.companyLinkedinUrl,
      };
    });

    setRecords((prev) => [...prev, ...normalized]);
    setParsedFile(null);
    setActiveTab('table');

    storageService.saveProject({
      id: `proj-${Date.now()}`,
      name: `Decision Makers Import (${new Date().toLocaleDateString()})`,
      description: 'Imported via SerpApi Decision Maker Finder',
      moduleType: 'decision-maker',
      records: normalized,
      config,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceFileName: parsedFile?.fileName,
      totalRecords: normalized.length,
      enrichedRecords: 0,
    });
  };

  const handleAddSingleQuick = (autoStart: boolean = false) => {
    if (!quickForm.companyName.trim()) {
      alert('Please enter a Company Name.');
      return;
    }

    let web = quickForm.companyWebsite.trim();
    if (web && !web.startsWith('http://') && !web.startsWith('https://')) {
      web = `https://${web}`;
    }

    let li = quickForm.companyLinkedinUrl.trim();
    if (li && !li.startsWith('http://') && !li.startsWith('https://')) {
      li = `https://${li}`;
    }

    const newRec: EnrichmentRecord = {
      id: `dm-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      companyName: quickForm.companyName.trim(),
      companyWebsite: web,
      companyLinkedinUrl: li,
      enrichmentStatus: 'idle',
      confidenceScore: 0,
    };

    setRecords((prev) => [newRec, ...prev]);
    setQuickForm({ companyName: '', companyWebsite: '', companyLinkedinUrl: '' });
    setActiveTab('table');

    if (autoStart) {
      setTimeout(() => {
        handleStartEnrichment([newRec.id]);
      }, 100);
    }
  };

  const handleAddBulkPaste = (autoStart: boolean = false) => {
    const lines = bulkPasteText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      alert('Please paste at least one line of company data.');
      return;
    }

    const newItems: EnrichmentRecord[] = lines.map((line, idx) => {
      let parts: string[] = [];
      if (line.includes('\t')) {
        parts = line.split('\t').map((p) => p.trim());
      } else if (line.includes(',')) {
        parts = line.split(',').map((p) => p.trim());
      } else {
        parts = [line.trim()];
      }

      let cname = parts[0] || '';
      let csite = parts[1] || '';
      let cli = parts[2] || '';

      if (cname.startsWith('http://') || cname.startsWith('https://') || cname.includes('.com') || cname.includes('.io')) {
        if (!csite) csite = cname;
        cname = cname.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].split('.')[0] || cname;
        cname = cname.charAt(0).toUpperCase() + cname.slice(1);
      }

      if (csite && !csite.startsWith('http://') && !csite.startsWith('https://')) {
        csite = `https://${csite}`;
      }
      if (cli && !cli.startsWith('http://') && !cli.startsWith('https://')) {
        cli = `https://${cli}`;
      }

      return {
        id: `dm-bulk-${Date.now()}-${idx}`,
        companyName: cname,
        companyWebsite: csite,
        companyLinkedinUrl: cli,
        enrichmentStatus: 'idle',
        confidenceScore: 0,
      };
    });

    setRecords((prev) => [...newItems, ...prev]);
    setBulkPasteText('');
    setActiveTab('table');

    if (autoStart) {
      const ids = newItems.map((item) => item.id);
      setTimeout(() => {
        handleStartEnrichment(ids);
      }, 100);
    }
  };

  const handleStartEnrichment = async (subsetIds?: string[]) => {
    const targets = subsetIds
      ? records.filter((r) => subsetIds.includes(r.id))
      : records;

    if (targets.length === 0) {
      alert('No companies to enrich. Please add companies via Quick Paste or Upload Spreadsheet.');
      return;
    }

    abortControllerRef.current = new AbortController();

    try {
      const activeSettings = storageService.getSettings();
      await decisionMakerService.enrichBatch(
        targets,
        {
          ...config,
          decisionMakerEngine: selectedEngine,
          serperApiKey: config.serperApiKey || activeSettings?.serperApiKey,
        },
        (p) => setProgress(p),
        abortControllerRef.current.signal,
        (chunkResults) => {
          setRecords((prev) => {
            const chunkMap = new Map(chunkResults.map((r) => [r.id, r]));
            const nextRecords = prev.map((item) => chunkMap.get(item.id) || item);
            return nextRecords;
          });
        }
      );

      // Auto-save search and extracted results into user's private history
      const queryName =
        parsedFile?.fileName ||
        (targets[0]?.companyName
          ? `${targets[0].companyName}${targets.length > 1 ? ` & ${targets.length - 1} others` : ''}`
          : 'Decision Maker Discovery');

      historyService.saveSearchHistory({
        moduleType: 'decision-maker',
        searchQuery: queryName,
        records: targets,
        filters: { engine: selectedEngine },
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setProgress((prev) => ({
          ...prev,
          isActive: false,
          status: 'cancelled',
          stageMessage: 'Discovery cancelled by user.',
        }));
      } else {
        alert(`Discovery error: ${err.message}`);
      }
    }
  };

  const handleCancelEnrichment = () => {
    abortControllerRef.current?.abort();
  };

  const openExportModal = (scope: 'all' | 'filtered' | 'selected', recordsToExport: EnrichmentRecord[]) => {
    setExportModalState({
      isOpen: true,
      scope,
      records: recordsToExport,
    });
  };

  return (
    <div className="space-y-6">
      {/* Module Header */}
      <ModuleHeader
        title={decisionMakerService.metadata.name}
        badge={decisionMakerService.metadata.badge}
        description={decisionMakerService.metadata.description}
        icon={UserCheck}
        inputRequirements={decisionMakerService.metadata.inputRequirements}
        outputFields={decisionMakerService.metadata.outputFields}
        integrationNote={decisionMakerService.metadata.integrationNote}
        onRunEnrichment={() => handleStartEnrichment()}
        isRunning={progress.isActive}
        totalRecordsCount={records.length}
      />

      {/* Dual Engine Selector: SerpApi vs Serper.dev */}
      <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-900 tracking-tight">
                Search Engine Engine: Choose SerpApi or Serper.dev
              </h3>
              <p className="text-[11px] text-slate-500">
                Select which API to use for finding decision makers. Both engines return identical fields: <span className="font-semibold text-slate-700">Decision Maker Name</span>, <span className="font-semibold text-slate-700">Decision Maker Post</span>, and <span className="font-semibold text-slate-700">Decision Maker Linkedin</span>.
              </p>
            </div>
          </div>
          <div className="text-[11px] font-mono text-slate-400 shrink-0">
            Active: <span className="font-bold text-blue-600">{selectedEngine === 'serper' ? 'Serper.dev' : 'SerpApi'}</span>
          </div>
        </div>

        {/* Engine Toggle Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* SerpApi Option */}
          <button
            type="button"
            onClick={() => setSelectedEngine('serpapi')}
            className={`p-3.5 rounded-xl border text-left transition-all relative ${
              selectedEngine === 'serpapi'
                ? 'border-blue-600 bg-blue-50/40 ring-2 ring-blue-600/20 shadow-xs'
                : 'border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50/50'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-900">SerpApi (Google Engine)</span>
                {selectedEngine === 'serpapi' && (
                  <Badge variant="default" className="text-[9px] font-semibold py-0 px-1.5 bg-blue-600 text-white">
                    Selected
                  </Badge>
                )}
              </div>
              {serverConfig.hasSerpApiKey ? (
                <Badge variant="success" className="text-[10px] font-semibold py-0.5 px-2">
                  <CheckCircle2 className="w-3 h-3 mr-1 inline" />
                  Connected ({serverConfig.serpApiKeyPreview})
                </Badge>
              ) : (
                <Badge variant="danger" className="text-[10px] font-semibold py-0.5 px-2">
                  <AlertCircle className="w-3 h-3 mr-1 inline" />
                  Key Missing
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Hierarchical Boolean queries with executive seniority ranks (Owner, Founder, CEO, MD, VP).
            </p>
          </button>

          {/* Serper.dev Option */}
          <button
            type="button"
            onClick={() => setSelectedEngine('serper')}
            className={`p-3.5 rounded-xl border text-left transition-all relative ${
              selectedEngine === 'serper'
                ? 'border-blue-600 bg-blue-50/40 ring-2 ring-blue-600/20 shadow-xs'
                : 'border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50/50'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-900">Serper.dev (Google Serper API)</span>
                {selectedEngine === 'serper' && (
                  <Badge variant="default" className="text-[9px] font-semibold py-0 px-1.5 bg-blue-600 text-white">
                    Selected
                  </Badge>
                )}
              </div>
              {serverConfig.hasSerperApiKey ? (
                <Badge variant="success" className="text-[10px] font-semibold py-0.5 px-2">
                  <CheckCircle2 className="w-3 h-3 mr-1 inline" />
                  Connected ({serverConfig.serperApiKeyPreview})
                </Badge>
              ) : (
                <Badge variant="danger" className="text-[10px] font-semibold py-0.5 px-2">
                  <AlertCircle className="w-3 h-3 mr-1 inline" />
                  Key Missing
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Fast JSON Google search with n8n keyword weighting and company token matching (+20 boost).
            </p>
          </button>
        </div>

        {/* If active engine is missing an API key, show an inline key entry */}
        {((selectedEngine === 'serpapi' && !serverConfig.hasSerpApiKey) ||
          (selectedEngine === 'serper' && !serverConfig.hasSerperApiKey)) && (
          <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 animate-in fade-in">
            <div className="text-xs text-amber-900 space-y-0.5">
              <div className="font-semibold flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                Missing {selectedEngine === 'serper' ? 'Serper.dev API Key' : 'SerpApi Key'}
              </div>
              <p className="text-[11px] text-amber-700">
                Paste your key below to save it to your local environment.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={inlineKeyInput}
                onChange={(e) => setInlineKeyInput(e.target.value)}
                placeholder={selectedEngine === 'serper' ? 'Enter Serper API Key...' : 'Enter SerpApi Key...'}
                className="px-2.5 py-1.5 text-xs font-mono rounded-lg border border-amber-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 w-48 sm:w-60"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveInlineKey}
                disabled={isSavingInlineKey || !inlineKeyInput.trim()}
                className="text-xs shrink-0"
              >
                {isSavingInlineKey ? 'Saving...' : 'Save Key'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Tabs Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-2 rounded-xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setActiveTab('table')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'table'
                ? 'bg-blue-50 text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            Dataset & Results ({records.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('quick')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'quick'
                ? 'bg-blue-50 text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            Quick Paste / Input
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'upload'
                ? 'bg-blue-50 text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <UploadCloud className="w-3.5 h-3.5" />
            Upload Spreadsheet (.xlsx / .csv)
          </button>
        </div>

        {records.length > 0 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleStartEnrichment()}
              disabled={progress.isActive}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Play className="w-3.5 h-3.5 mr-1" />
              Find All Decision Makers ({records.length})
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (confirm('Clear all loaded companies and start fresh?')) {
                  setRecords([]);
                }
              }}
              disabled={progress.isActive}
              className="text-xs text-rose-600 hover:bg-rose-50"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              Clear
            </Button>
          </div>
        )}
      </div>

      {/* Progress Indicator */}
      <ProgressIndicator
        progress={progress}
        onCancel={handleCancelEnrichment}
        moduleName={decisionMakerService.metadata.name}
      />

      {/* Tab: Quick Paste / Input */}
      {activeTab === 'quick' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Option A: Single Company Entry */}
          <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-4">
            <div className="space-y-1 border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-blue-600" />
                Single Company Lookup
              </h3>
              <p className="text-xs text-slate-500">
                Enter company name, website, and LinkedIn URL to pinpoint the executive.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Company Name *</label>
                <input
                  type="text"
                  value={quickForm.companyName}
                  onChange={(e) => setQuickForm({ ...quickForm, companyName: e.target.value })}
                  placeholder="e.g. AppSumo, Stripe, Zapier"
                  className="w-full h-9 px-3 text-xs rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                  <Globe className="w-3.5 h-3.5 text-slate-400" /> Company Website (optional)
                </label>
                <input
                  type="text"
                  value={quickForm.companyWebsite}
                  onChange={(e) => setQuickForm({ ...quickForm, companyWebsite: e.target.value })}
                  placeholder="https://appsumo.com"
                  className="w-full h-9 px-3 text-xs rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                  <Linkedin className="w-3.5 h-3.5 text-blue-600" /> Company LinkedIn URL (optional)
                </label>
                <input
                  type="text"
                  value={quickForm.companyLinkedinUrl}
                  onChange={(e) => setQuickForm({ ...quickForm, companyLinkedinUrl: e.target.value })}
                  placeholder="https://www.linkedin.com/company/appsumo"
                  className="w-full h-9 px-3 text-xs rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  size="sm"
                  onClick={() => handleAddSingleQuick(true)}
                  className="flex-1 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                >
                  <Sparkles className="w-3.5 h-3.5 mr-1" /> Add & Find Decision Maker
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleAddSingleQuick(false)}
                  className="text-xs"
                >
                  Add to Table
                </Button>
              </div>
            </div>
          </div>

          {/* Option B: Bulk Paste */}
          <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-4">
            <div className="space-y-1 border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                Bulk Paste Accounts
              </h3>
              <p className="text-xs text-slate-500">
                Paste rows from Excel or CSV (one company per line: Company, Website, LinkedIn).
              </p>
            </div>

            <div className="space-y-3">
              <textarea
                rows={6}
                value={bulkPasteText}
                onChange={(e) => setBulkPasteText(e.target.value)}
                placeholder={`AppSumo, https://appsumo.com, https://www.linkedin.com/company/appsumo\nStripe, https://stripe.com, https://www.linkedin.com/company/stripe\nZapier, https://zapier.com, https://www.linkedin.com/company/zapier`}
                className="w-full p-3 text-xs font-mono rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20"
              />

              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleAddBulkPaste(true)}
                  className="flex-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Sparkles className="w-3.5 h-3.5 mr-1" /> Add & Start Batch Search
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleAddBulkPaste(false)}
                  className="text-xs"
                >
                  Add to Table Only
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Upload Spreadsheet */}
      {activeTab === 'upload' && (
        <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-6">
          {!parsedFile ? (
            <div className="max-w-2xl mx-auto space-y-4">
              <div className="text-center space-y-1">
                <h3 className="text-base font-bold text-slate-900">Upload Target Companies File</h3>
                <p className="text-xs text-slate-500">
                  Upload an Excel (.xlsx/.xls) or CSV containing: <strong>Name | Website | Linkedin</strong>.
                </p>
              </div>
              <FileUploader onFileParsed={handleFileParsed} />
            </div>
          ) : (
            <ColumnMapper
              parsedFile={parsedFile}
              onMappingConfirmed={handleMappingConfirmed}
              onCancel={() => setParsedFile(null)}
            />
          )}
        </div>
      )}

      {/* Tab: Data Table */}
      {activeTab === 'table' && (
        <div>
          {records.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-4">
              <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto">
                <UserCheck className="w-7 h-7" />
              </div>
              <div className="max-w-md mx-auto space-y-1">
                <h3 className="text-base font-bold text-slate-900">No Target Companies Loaded</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Provide company details (Name, Website, or Company LinkedIn URL) to discover verified decision makers and executive leadership.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <Button size="sm" onClick={() => setActiveTab('quick')} className="text-xs bg-blue-600 hover:bg-blue-700 text-white">
                  <Plus className="w-3.5 h-3.5 mr-1" /> Quick Paste Accounts
                </Button>
                <Button size="sm" variant="outline" onClick={() => setActiveTab('upload')} className="text-xs">
                  <UploadCloud className="w-3.5 h-3.5 mr-1" /> Upload Spreadsheet
                </Button>
              </div>
            </div>
          ) : (
            <DataTable
              records={records}
              onRecordsChange={setRecords}
              onRunSelectedEnrichment={(selectedIds) => handleStartEnrichment(selectedIds)}
              onOpenExportModal={openExportModal}
              isLoading={progress.isActive}
            />
          )}
        </div>
      )}

      {/* Export Modal */}
      <ExportModal
        isOpen={exportModalState.isOpen}
        onClose={() => setExportModalState((prev) => ({ ...prev, isOpen: false }))}
        scope={exportModalState.scope}
        records={exportModalState.records}
        allRecordsCount={records.length}
        filteredRecordsCount={exportModalState.records.length}
        selectedRecordsCount={exportModalState.records.length}
        moduleType="decision-maker"
        projectName="Decision_Makers_Enriched"
      />
    </div>
  );
};
