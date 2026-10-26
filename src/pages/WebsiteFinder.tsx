import React, { useState, useRef, useEffect } from 'react';
import {
  Globe,
  UploadCloud,
  RotateCcw,
  Sparkles,
  Key,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Save,
  Play,
  Building2,
  Plus,
  CheckCircle2,
  Search,
} from 'lucide-react';
import { ModuleHeader } from '../components/common/ModuleHeader';
import { FileUploader } from '../components/common/FileUploader';
import { ColumnMapper } from '../components/common/ColumnMapper';
import { ConfigOptionsPanel } from '../components/common/ConfigOptionsPanel';
import { DataTable } from '../components/common/DataTable';
import { ProgressIndicator } from '../components/common/ProgressIndicator';
import { ExportModal } from '../components/common/ExportModal';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { EnrichmentRecord, ResearchConfig, ResearchProgress, ColumnMapping } from '../types';
import { ParsedFileResult } from '../services/excelService';
import { websiteFinderService } from '../services/adapters';
import { getSampleInitialRecords } from '../services/mockData';
import { storageService } from '../services/storageService';
import { authService } from '../services/authService';
import { historyService } from '../services/historyService';
import { getApiBaseUrl, getAuthHeaders } from '../config/api';

export const WebsiteFinder: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'table' | 'quick' | 'upload' | 'config'>('table');
  const [records, setRecords] = useState<EnrichmentRecord[]>(() => getSampleInitialRecords());
  const [parsedFile, setParsedFile] = useState<ParsedFileResult | null>(null);

  // Quick / Single Company Input State
  const [singleCompany, setSingleCompany] = useState('');
  const [singleLocation, setSingleLocation] = useState('');
  const [bulkPasteText, setBulkPasteText] = useState('');

  // Gemini API Key State in Website Finder
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [hasConfiguredKey, setHasConfiguredKey] = useState<boolean | null>(null);
  const [maskedKey, setMaskedKey] = useState('');
  const [isKeyDrawerOpen, setIsKeyDrawerOpen] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [keySaveMessage, setKeySaveMessage] = useState<string | null>(null);
  const [findFounders, setFindFounders] = useState(true);

  const [config, setConfig] = useState<ResearchConfig>({
    deepWebsiteDiscovery: true,
    simulationSpeedMs: 300,
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

  // Check Gemini Key status upon mount
  const checkKeyStatus = async () => {
    try {
      const { keys } = await authService.getMe();
      const hasKey = bool(keys.gemini_api_key && !keys.gemini_api_key.startsWith('your_') && !keys.gemini_api_key.startsWith('test_'));
      setHasConfiguredKey(hasKey);
      if (hasKey && keys.gemini_api_key) {
        setMaskedKey(keys.gemini_api_key.slice(0, 4) + '...' + keys.gemini_api_key.slice(-4));
      } else {
        // Fallback check against backend status
        const apiBase = getApiBaseUrl();
        if (apiBase) {
          const res = await fetch(`${apiBase}/api/assistant/status`, { headers: getAuthHeaders() });
          if (res.ok) {
            const data = await res.json();
            setHasConfiguredKey(data.hasGeminiKey);
            setMaskedKey(data.maskedKey || '');
          }
        }
      }
    } catch (e) {
      console.warn('Could not check Gemini key status:', e);
    }
  };

  function bool(v: any) {
    return Boolean(v);
  }

  useEffect(() => {
    checkKeyStatus();
  }, []);

  // Save Gemini Key directly from Website Finder
  const handleSaveGeminiKey = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanKey = geminiApiKey.trim();
    if (!cleanKey) {
      alert('Please enter a valid Google Gemini API Key.');
      return;
    }

    setIsSavingKey(true);
    setKeySaveMessage(null);
    try {
      await authService.updateUserKeys({ gemini_api_key: cleanKey });
      setHasConfiguredKey(true);
      setMaskedKey(cleanKey.slice(0, 4) + '...' + cleanKey.slice(-4));
      setKeySaveMessage('✅ Gemini API Key connected successfully!');
      setTimeout(() => {
        setIsKeyDrawerOpen(false);
        setKeySaveMessage(null);
      }, 1500);
    } catch (err: any) {
      alert(`Error saving Gemini API Key: ${err.message}`);
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleFileParsed = (parsed: ParsedFileResult) => {
    setParsedFile(parsed);
  };

  const handleMappingConfirmed = (newRecords: EnrichmentRecord[], mapping: ColumnMapping) => {
    setRecords(newRecords);
    setParsedFile(null);
    setActiveTab('table');

    storageService.saveProject({
      id: `proj-${Date.now()}`,
      name: `Company Domains Batch (${new Date().toLocaleDateString()})`,
      description: 'Uploaded via Company Website Finder',
      moduleType: 'website-finder',
      records: newRecords,
      config,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceFileName: parsedFile?.fileName,
      totalRecords: newRecords.length,
      enrichedRecords: 0,
    });
  };

  // Add single company and auto-start
  const handleAddSingleCompany = (autoStart = true) => {
    const comp = singleCompany.trim();
    if (!comp) {
      alert('Please enter a company name.');
      return;
    }

    const newRecord: EnrichmentRecord = {
      id: `web-${Date.now()}`,
      companyName: comp,
      city: singleLocation.trim() || undefined,
      enrichmentStatus: 'idle',
      confidenceScore: 0,
    };

    setRecords((prev) => [newRecord, ...prev]);
    setSingleCompany('');
    setSingleLocation('');
    setActiveTab('table');

    if (autoStart) {
      setTimeout(() => {
        handleStartEnrichment([newRecord.id]);
      }, 100);
    }
  };

  // Bulk paste company names
  const handleAddBulkPaste = (autoStart = true) => {
    const lines = bulkPasteText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      alert('Please enter or paste at least one company name.');
      return;
    }

    const newRecords: EnrichmentRecord[] = lines.map((line, idx) => {
      const parts = line.split(/[,;\t]/).map((p) => p.trim());
      const cname = parts[0];
      const cloc = parts[1] || '';

      return {
        id: `web-bulk-${Date.now()}-${idx}`,
        companyName: cname,
        city: cloc || undefined,
        enrichmentStatus: 'idle',
        confidenceScore: 0,
      };
    });

    setRecords((prev) => [...newRecords, ...prev]);
    setBulkPasteText('');
    setActiveTab('table');

    if (autoStart) {
      const ids = newRecords.map((r) => r.id);
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
      alert('No companies to research. Please add companies via Quick Search or Upload Spreadsheet.');
      return;
    }

    if (!hasConfiguredKey && !geminiApiKey.trim()) {
      setIsKeyDrawerOpen(true);
      alert('Please configure your Google Gemini API Key above to begin searching company websites & founders.');
      return;
    }

    abortControllerRef.current = new AbortController();

    try {
      const activeSettings = storageService.getSettings();
      const enrichedBatch = await websiteFinderService.enrichBatch(
        targets,
        {
          ...config,
          geminiApiKey: geminiApiKey.trim() || activeSettings?.geminiApiKey,
        },
        (p) => setProgress(p),
        abortControllerRef.current.signal,
        (chunkResults) => {
          setRecords((prev) => {
            const chunkMap = new Map(chunkResults.map((item) => [item.id, item]));
            return prev.map((item) => chunkMap.get(item.id) || item);
          });
        }
      );

      setRecords((prev) => {
        const enrichedMap = new Map(enrichedBatch.map((item) => [item.id, item]));
        return prev.map((item) => enrichedMap.get(item.id) || item);
      });

      // Auto-save search and extracted results into user's private history
      const queryTitle =
        parsedFile?.fileName ||
        (targets[0]?.companyName
          ? `${targets[0].companyName}${targets.length > 1 ? ` & ${targets.length - 1} other companies` : ''}`
          : 'Company Website & Founder Discovery');

      historyService.saveSearchHistory({
        moduleType: 'website-finder',
        searchQuery: queryTitle,
        records: enrichedBatch,
        filters: { totalCompanies: enrichedBatch.length, findFounders: true },
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setProgress((prev) => ({
          ...prev,
          isActive: false,
          status: 'cancelled',
          stageMessage: 'Website & founder search cancelled by user.',
        }));
      } else {
        alert(`Website & founder search failed: ${err.message}`);
        if (err.message && err.message.toLowerCase().includes('gemini')) {
          setIsKeyDrawerOpen(true);
        }
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
        title={websiteFinderService.metadata.name}
        badge={websiteFinderService.metadata.badge}
        description={websiteFinderService.metadata.description}
        icon={Globe}
        inputRequirements={websiteFinderService.metadata.inputRequirements}
        outputFields={websiteFinderService.metadata.outputFields}
        integrationNote={websiteFinderService.metadata.integrationNote}
        onRunEnrichment={() => handleStartEnrichment()}
        isRunning={progress.isActive}
        totalRecordsCount={records.length}
      />

      {/* Gemini AI Key Toolbar & Configuration Drawer */}
      <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-xs">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold text-slate-900">
                  Google Gemini AI Website & Founder Engine
                </h3>
                <Badge variant="default" size="sm" className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white border-0 text-[10px]">
                  Gemini 1.5 Web Resolution
                </Badge>
              </div>
              <p className="text-[11px] text-slate-500">
                Searches canonical corporate websites, root domains, official headquarters, and founders / CEOs directly with Gemini.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsKeyDrawerOpen(!isKeyDrawerOpen)}
              className={`text-xs gap-1.5 font-semibold ${
                hasConfiguredKey
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  : 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 animate-pulse'
              }`}
            >
              <Key className="w-3.5 h-3.5 text-indigo-600" />
              <span>{hasConfiguredKey ? `Gemini Key Connected (${maskedKey || 'Active'})` : 'Configure Gemini Key'}</span>
              {isKeyDrawerOpen ? <ChevronUp className="w-3.5 h-3.5 ml-0.5" /> : <ChevronDown className="w-3.5 h-3.5 ml-0.5" />}
            </Button>
          </div>
        </div>

        {/* Gemini Key Config Drawer */}
        {isKeyDrawerOpen && (
          <div className="pt-3 border-t border-slate-100 space-y-3 animate-in fade-in duration-200">
            <form onSubmit={handleSaveGeminiKey} className="space-y-3 bg-indigo-50/50 p-4 rounded-xl border border-indigo-100">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800">
                  Enter or Update Your Google Gemini API Key
                </span>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold inline-flex items-center gap-1"
                >
                  Get Free Key from Google AI Studio <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-2">
                <input
                  type="password"
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder={hasConfiguredKey ? `Current Key: ${maskedKey} (Paste new key to replace)` : 'AIzaSy... Paste your Google Gemini API Key'}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white font-mono"
                />

                <Button
                  type="submit"
                  size="sm"
                  disabled={isSavingKey || !geminiApiKey.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold gap-1.5 shrink-0 w-full sm:w-auto"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingKey ? 'Saving...' : 'Save & Connect'}</span>
                </Button>
              </div>

              {keySaveMessage && (
                <div className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                  {keySaveMessage}
                </div>
              )}
            </form>
          </div>
        )}
      </div>

      {/* Tabs Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-2 rounded-xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('table')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'table'
                ? 'bg-blue-50 text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            Websites & Founders ({records.length})
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
            Quick Search & Paste
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
            Upload File
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
            Settings
          </button>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setRecords(getSampleInitialRecords());
            setActiveTab('table');
          }}
          className="text-xs text-slate-500 hover:text-slate-800"
        >
          <RotateCcw className="w-3.5 h-3.5 mr-1" />
          Load Sample Accounts
        </Button>
      </div>

      <ProgressIndicator
        progress={progress}
        onCancel={handleCancelEnrichment}
        moduleName="Company Website & Founder Finder"
      />

      {/* Quick Search & Bulk Paste View */}
      {activeTab === 'quick' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Single Company Search */}
          <Card className="p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Search className="w-4 h-4 text-blue-600" />
                <span>Single Company Search</span>
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Enter a target company name to instantly discover their official website, domain, and founders.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">Company Name *</label>
                <input
                  type="text"
                  value={singleCompany}
                  onChange={(e) => setSingleCompany(e.target.value)}
                  placeholder="e.g. Stripe, Datadog, or Snowflake"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">Location / HQ (Optional)</label>
                <input
                  type="text"
                  value={singleLocation}
                  onChange={(e) => setSingleLocation(e.target.value)}
                  placeholder="e.g. San Francisco, CA or London"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="pt-2 flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleAddSingleCompany(true)}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs gap-1.5"
                >
                  <Play className="w-3.5 h-3.5 fill-white" />
                  <span>Search Website & Founder with Gemini</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAddSingleCompany(false)}
                  className="text-xs"
                >
                  Add to List
                </Button>
              </div>
            </div>
          </Card>

          {/* Bulk Paste */}
          <Card className="p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-indigo-600" />
                <span>Bulk Paste Companies</span>
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Paste multiple company names (one per line, or with location: <code>Stripe, San Francisco</code>).
              </p>
            </div>

            <div className="space-y-3">
              <textarea
                rows={5}
                value={bulkPasteText}
                onChange={(e) => setBulkPasteText(e.target.value)}
                placeholder={"Stripe, San Francisco\nDatadog, New York\nFigma\nSnowflake, Bozeman\nOpenAI, San Francisco"}
                className="w-full p-3 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />

              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleAddBulkPaste(true)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs gap-1.5"
                >
                  <Play className="w-3.5 h-3.5 fill-white" />
                  <span>Enrich All with Gemini AI</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAddBulkPaste(false)}
                  className="text-xs"
                >
                  Add All to List
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* File Upload View */}
      {activeTab === 'upload' && (
        <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-6">
          {!parsedFile ? (
            <div className="max-w-2xl mx-auto space-y-4">
              <div className="text-center space-y-1">
                <h3 className="text-base font-bold text-slate-900">Upload Companies Spreadsheet</h3>
                <p className="text-xs text-slate-500">
                  Upload an Excel (.xlsx) or CSV file with company names to extract official websites, domains, and founders using Google Gemini AI.
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

      {/* Settings / Parameters View */}
      {activeTab === 'config' && (
        <ConfigOptionsPanel
          moduleType="website-finder"
          config={config}
          onChange={setConfig}
        />
      )}

      {/* DataTable View */}
      {activeTab === 'table' && (
        <DataTable
          records={records}
          onRecordsChange={setRecords}
          onRunSelectedEnrichment={(selectedIds) => handleStartEnrichment(selectedIds)}
          onOpenExportModal={openExportModal}
          isLoading={progress.isActive}
        />
      )}

      <ExportModal
        isOpen={exportModalState.isOpen}
        onClose={() => setExportModalState((prev) => ({ ...prev, isOpen: false }))}
        scope={exportModalState.scope}
        records={exportModalState.records}
        allRecordsCount={records.length}
        filteredRecordsCount={exportModalState.records.length}
        selectedRecordsCount={exportModalState.records.length}
        moduleType="website-finder"
        projectName="Company_Websites_and_Founders_Export"
      />
    </div>
  );
};
