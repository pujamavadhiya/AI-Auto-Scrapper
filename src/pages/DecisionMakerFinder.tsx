import React, { useState, useRef, useEffect } from 'react';
import {
  UserCheck,
  FileSpreadsheet,
  Plus,
  UploadCloud,
  Sparkles,
  Key,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Briefcase,
  Globe,
  Linkedin,
  Trash2,
  Play,
  RotateCcw,
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
import { getApiBaseUrl } from '../config/api';

const AVAILABLE_SENIORITY = [
  'CEO',
  'Founder',
  'Co-Founder',
  'Owner',
  'President',
  'Managing Director',
  'Chief Executive Officer',
  'CTO',
  'COO',
  'VP',
  'Director',
];

export const DecisionMakerFinder: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'table' | 'quick' | 'upload' | 'config'>('table');
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

  // OpenAI Key & Engine Config State
  const [serverConfig, setServerConfig] = useState<{
    hasOpenAiKey: boolean;
    keyPreview: string;
    engine: string;
  }>({
    hasOpenAiKey: false,
    keyPreview: 'checking...',
    engine: 'OpenAI Multi-Engine Decision Maker Finder',
  });

  const [openAiKeyInput, setOpenAiKeyInput] = useState<string>(() => storageService.getSettings().openAiApiKey || '');
  const [openAiModel, setOpenAiModel] = useState<string>(() => storageService.getSettings().openAiModel || 'gpt-4o-mini');
  const [showKeyConfig, setShowKeyConfig] = useState(false);
  const [saveKeySuccess, setSaveKeySuccess] = useState(false);

  const [config, setConfig] = useState<ResearchConfig>({
    seniorityLevels: ['CEO', 'Founder', 'Co-Founder', 'Owner', 'Managing Director'],
    openAiApiKey: storageService.getSettings().openAiApiKey || '',
    openAiModel: storageService.getSettings().openAiModel || 'gpt-4o-mini',
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

  // Check backend server OpenAI config on mount
  useEffect(() => {
    const checkServerConfig = async () => {
      const apiBase = getApiBaseUrl();
      if (!apiBase) return;
      try {
        const res = await fetch(`${apiBase}/api/decision-makers/config`);
        if (res.ok) {
          const data = await res.json();
          setServerConfig({
            hasOpenAiKey: !!data.hasOpenAiKey,
            keyPreview: data.keyPreview || 'missing',
            engine: data.engine || 'OpenAI Decision Maker Finder',
          });
        }
      } catch (e) {
        console.warn('Could not query decision makers config:', e);
      }
    };
    checkServerConfig();
  }, []);

  const handleSaveOpenAiKey = () => {
    storageService.saveSettings({
      openAiApiKey: openAiKeyInput.trim(),
      openAiModel,
    });
    setConfig((prev) => ({
      ...prev,
      openAiApiKey: openAiKeyInput.trim(),
      openAiModel,
    }));
    setSaveKeySuccess(true);
    setTimeout(() => setSaveKeySuccess(false), 2500);
  };

  const handleFileParsed = (parsed: ParsedFileResult) => {
    setParsedFile(parsed);
  };

  const handleMappingConfirmed = (newRecords: EnrichmentRecord[], _mapping: ColumnMapping) => {
    // Normalize uploaded records
    const normalized = newRecords.map((r) => {
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
        r.customFields?.['Company Linkedin'] ||
        r.customFields?.['Company LinkedIn'] ||
        r.customFields?.['Linkedin'] ||
        '';
      li = String(li).trim().replace(/^(https?:\/\/)+/i, 'https://');
      if (li && !li.startsWith('http://') && !li.startsWith('https://')) {
        li = `https://${li.replace(/^\/+/, '')}`;
      }

      return {
        ...r,
        companyWebsite: web || r.companyWebsite,
        companyLinkedinUrl: li || r.companyLinkedinUrl,
      };
    });

    setRecords((prev) => [...prev, ...normalized]);
    setParsedFile(null);
    setActiveTab('table');

    // Save project in localStorage
    storageService.saveProject({
      id: `proj-${Date.now()}`,
      name: `Decision Makers Import (${new Date().toLocaleDateString()})`,
      description: 'Imported via Decision Maker Finder Spreadsheet',
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
    if (!quickForm.companyName.trim() && !quickForm.companyWebsite.trim() && !quickForm.companyLinkedinUrl.trim()) {
      alert('Please enter at least a Company Name, Website, or Company LinkedIn URL.');
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
      companyName: quickForm.companyName.trim() || web.replace(/^https?:\/\//i, '').split('/')[0],
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
      // Formats supported:
      // Tab separated (from Excel/Sheets): Company \t Website \t LinkedIn
      // Comma separated: Company, Website, LinkedIn
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

      // If user pasted a URL in the first column, parse domain
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
      await decisionMakerService.enrichBatch(
        targets,
        {
          ...config,
          openAiApiKey: openAiKeyInput.trim() || config.openAiApiKey,
          openAiModel,
        },
        (p) => setProgress(p),
        abortControllerRef.current.signal,
        (chunkResults) => {
          // Live chunk update directly into the table
          setRecords((prev) => {
            const chunkMap = new Map(chunkResults.map((r) => [r.id, r]));
            return prev.map((item) => chunkMap.get(item.id) || item);
          });
        }
      );
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

  const handleToggleSeniority = (role: string) => {
    setConfig((prev) => {
      const current = prev.seniorityLevels || [];
      const updated = current.includes(role)
        ? current.filter((r) => r !== role)
        : [...current, role];
      return { ...prev, seniorityLevels: updated };
    });
  };

  const openExportModal = (scope: 'all' | 'filtered' | 'selected', recordsToExport: EnrichmentRecord[]) => {
    setExportModalState({
      isOpen: true,
      scope,
      records: recordsToExport,
    });
  };

  const hasConfiguredOpenAi = serverConfig.hasOpenAiKey || !!openAiKeyInput.trim();

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

      {/* OpenAI API Key Status Banner / Expandable Config */}
      <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-xl ${hasConfiguredOpenAi ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-900">OpenAI Search & Reasoning Engine</span>
                {hasConfiguredOpenAi ? (
                  <Badge variant="success" className="text-[10px] font-semibold py-0.5 px-2">
                    <CheckCircle2 className="w-3 h-3 mr-1 inline" />
                    OpenAI Ready ({openAiModel})
                  </Badge>
                ) : (
                  <Badge variant="warning" className="text-[10px] font-semibold py-0.5 px-2">
                    <AlertCircle className="w-3 h-3 mr-1 inline" />
                    Key Optional (Heuristic Active)
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {hasConfiguredOpenAi
                  ? 'High-precision AI reasoning active. Extracts exact executive names and roles from web & LinkedIn snippets.'
                  : 'Add your OpenAI API Key below to unlock deep multi-engine intelligence and exact verification.'}
              </p>
            </div>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowKeyConfig(!showKeyConfig)}
            className="text-xs shrink-0 self-start sm:self-auto"
          >
            <Key className="w-3.5 h-3.5 mr-1 text-slate-500" />
            {showKeyConfig ? 'Hide OpenAI Key' : 'Configure OpenAI Key'}
            {showKeyConfig ? <ChevronUp className="w-3.5 h-3.5 ml-1" /> : <ChevronDown className="w-3.5 h-3.5 ml-1" />}
          </Button>
        </div>

        {showKeyConfig && (
          <div className="pt-3 border-t border-slate-100 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2 space-y-1">
                <label className="text-[11px] font-bold text-slate-700">OpenAI API Key (sk-...)</label>
                <input
                  type="password"
                  value={openAiKeyInput}
                  onChange={(e) => setOpenAiKeyInput(e.target.value)}
                  placeholder={serverConfig.hasOpenAiKey ? `Configured in .env (${serverConfig.keyPreview})` : 'sk-proj-...'}
                  className="w-full h-9 px-3 text-xs font-mono rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700">AI Model</label>
                <select
                  value={openAiModel}
                  onChange={(e) => setOpenAiModel(e.target.value)}
                  className="w-full h-9 px-3 text-xs rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="gpt-4o-mini">gpt-4o-mini (Recommended - Fast & Accurate)</option>
                  <option value="gpt-4o">gpt-4o (Maximum Intelligence)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-slate-400">
                Key is securely stored in local browser settings or server environment.
              </span>
              <div className="flex items-center gap-2">
                {saveKeySuccess && (
                  <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Key Saved!
                  </span>
                )}
                <Button size="sm" onClick={handleSaveOpenAiKey} className="text-xs bg-blue-600 hover:bg-blue-700 text-white">
                  Save Configuration
                </Button>
              </div>
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

          <button
            type="button"
            onClick={() => setActiveTab('config')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'config'
                ? 'bg-blue-50 text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            Target Roles & Filters
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
                Enter company name, website, and company LinkedIn URL to pinpoint the executive.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Company Name *</label>
                <input
                  type="text"
                  value={quickForm.companyName}
                  onChange={(e) => setQuickForm({ ...quickForm, companyName: e.target.value })}
                  placeholder="e.g. AppSumo, Stripe, Linear"
                  className="w-full h-9 px-3 text-xs rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                  <Globe className="w-3.5 h-3.5 text-slate-400" /> Company Website
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
                  <Linkedin className="w-3.5 h-3.5 text-blue-600" /> Company LinkedIn URL
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
                  <Sparkles className="w-3.5 h-3.5 mr-1" /> Add & Discover Decision Maker
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
                  <Sparkles className="w-3.5 h-3.5 mr-1" /> Add & Start Batch Discovery
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
                  Upload an Excel (.xlsx/.xls) or CSV containing company names, websites, and/or company LinkedIn URLs.
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

      {/* Tab: Target Roles & Config */}
      {activeTab === 'config' && (
        <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-6">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900">Target Executive Seniority & Titles</h3>
            <p className="text-xs text-slate-500">
              Select which decision maker titles should be prioritized during AI discovery.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">Priority Titles:</label>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_SENIORITY.map((role) => {
                  const isSelected = config.seniorityLevels?.includes(role);
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => handleToggleSeniority(role)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                        isSelected
                          ? 'bg-blue-50 border-blue-600 text-blue-700 shadow-xs'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {role} {isSelected && '✓'}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <Button size="sm" onClick={() => setActiveTab('table')} className="text-xs bg-blue-600 hover:bg-blue-700 text-white">
                Apply & Return to Table
              </Button>
            </div>
          </div>
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
                  Provide company details (Company Name, Website, or Company LinkedIn URL) to discover verified decision makers and executive leadership.
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
