import React, { useState, useRef } from 'react';
import {
  Share2,
  UploadCloud,
  Globe,
  Building2,
  Trash2,
  Play,
  Download,
  PlusCircle,
  Clock,
  Layers,
  CheckCircle,
  ExternalLink,
} from 'lucide-react';
import { ModuleHeader } from '../components/common/ModuleHeader';
import { FileUploader } from '../components/common/FileUploader';
import { ColumnMapper } from '../components/common/ColumnMapper';
import { DataTable } from '../components/common/DataTable';
import { ProgressIndicator } from '../components/common/ProgressIndicator';
import { ExportModal } from '../components/common/ExportModal';
import { Button } from '../components/ui/Button';
import { EnrichmentRecord, ResearchConfig, ResearchProgress, ColumnMapping } from '../types';
import { ParsedFileResult } from '../services/excelService';
import { socialMediaService } from '../services/adapters';
import { storageService } from '../services/storageService';

export const SocialMediaFinder: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'table' | 'upload' | 'quick-input' | 'settings'>('table');
  // Zero dummy data: initial state is empty
  const [records, setRecords] = useState<EnrichmentRecord[]>([]);
  const [parsedFile, setParsedFile] = useState<ParsedFileResult | null>(null);

  // Algorithm mode: 'website' (concurrent 5 sites) vs 'company' (strict regex, sequential)
  const [socialMode, setSocialMode] = useState<'website' | 'company'>('website');
  const [batchSize, setBatchSize] = useState<number>(5);
  const [delaySec, setDelaySec] = useState<number>(1.0);

  // Quick input text state
  const [quickInputText, setQuickInputText] = useState<string>('');

  const [config, setConfig] = useState<ResearchConfig>({
    socialPlatforms: ['Facebook', 'Instagram', 'LinkedIn', 'Twitter/X'],
    simulationSpeedMs: 0,
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

  const handleFileParsed = (parsed: ParsedFileResult) => {
    setParsedFile(parsed);
  };

  const handleMappingConfirmed = (newRecords: EnrichmentRecord[], _mapping: ColumnMapping) => {
    setRecords(newRecords);
    setParsedFile(null);
    setActiveTab('table');

    storageService.saveProject({
      id: `proj-${Date.now()}`,
      name: `Social Media Scrape (${new Date().toLocaleDateString()})`,
      description: `Uploaded via Social Media URL Finder (${socialMode} mode)`,
      moduleType: 'social-finder',
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

  const handleAddQuickInput = (autoStart: boolean = false) => {
    const lines = quickInputText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) return;

    const newItems: EnrichmentRecord[] = lines.map((line, idx) => {
      // Support either "domain.com", "https://site.com", or "Company Name, https://site.com"
      let comp = '';
      let url = '';

      if (line.includes(',')) {
        const parts = line.split(',');
        comp = parts[0].trim();
        url = parts.slice(1).join(',').trim();
      } else {
        comp = line.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].split('.')[0] || line;
        comp = comp.charAt(0).toUpperCase() + comp.slice(1);
        url = line;
      }

      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
      }

      return {
        id: `rec-${Date.now()}-${idx + 1}`,
        companyName: comp || `Target Company #${records.length + idx + 1}`,
        companyWebsite: url,
        domain: url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0],
        enrichmentStatus: 'idle',
      };
    });

    const merged = [...records, ...newItems];
    setRecords(merged);
    setQuickInputText('');
    setActiveTab('table');

    if (autoStart) {
      setTimeout(() => {
        handleStartEnrichment(newItems.map((item) => item.id), merged);
      }, 50);
    }
  };

  const handleStartEnrichment = async (subsetIds?: string[], sourceRecords?: EnrichmentRecord[]) => {
    const currentRecords = sourceRecords || records;
    const targets = subsetIds
      ? currentRecords.filter((r) => subsetIds.includes(r.id))
      : currentRecords;

    if (targets.length === 0) {
      alert('Please add or upload website URLs before starting the scraper.');
      return;
    }

    abortControllerRef.current = new AbortController();

    try {
      const activeConfig: any = {
        ...config,
        socialMode,
        batchSize,
        delay: delaySec,
      };

      await (socialMediaService as any).enrichBatch(
        targets,
        activeConfig,
        (p: ResearchProgress) => setProgress(p),
        abortControllerRef.current.signal,
        // Live streaming update: as each chunk completes, immediately reflect in the table!
        (chunkResults: EnrichmentRecord[]) => {
          setRecords((prev) => {
            const chunkMap = new Map(chunkResults.map((item) => [item.id, item]));
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
          stageMessage: 'Social search cancelled by user.',
        }));
      } else {
        alert(`Social scraping error: ${err.message}`);
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

  const handleClearAll = () => {
    if (records.length === 0) return;
    if (window.confirm('Are you sure you want to clear all records from the table?')) {
      setRecords([]);
    }
  };

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Social Media URL Finder"
        badge={socialMode === 'website' ? 'Website Concurrent Mode' : 'Company Strict Mode'}
        description="Authentic n8n scraper algorithm: extracts verified Facebook, Instagram, LinkedIn, and X/Twitter links directly from target websites."
        icon={Share2}
        inputRequirements={socialMode === 'website' ? ['Website Column'] : ['Company URL', 'Company Name']}
        outputFields={['Facebook URL', 'Instagram URL', 'Company LinkedIn URL', 'X / Twitter URL', 'Confidence Score']}
        integrationNote="Multi-threaded HTML crawler with strict subpath filters for real corporate channels."
        onRunEnrichment={() => handleStartEnrichment()}
        isRunning={progress.isActive}
        totalRecordsCount={records.length}
      />

      {/* Mode Selector & Navigation Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('table')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'table'
                ? 'bg-blue-50 text-blue-700 shadow-xs border border-blue-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            Social Leads ({records.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('quick-input')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'quick-input'
                ? 'bg-blue-50 text-blue-700 shadow-xs border border-blue-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <PlusCircle className="w-3.5 h-3.5" />
            Quick Paste URLs
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'upload'
                ? 'bg-blue-50 text-blue-700 shadow-xs border border-blue-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <UploadCloud className="w-3.5 h-3.5" />
            Upload File
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'settings'
                ? 'bg-blue-50 text-blue-700 shadow-xs border border-blue-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Algorithm Mode ({socialMode})
          </button>
        </div>

        <div className="flex items-center gap-2">
          {records.length > 0 && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openExportModal('all', records)}
                className="text-xs text-slate-700 border-slate-300 hover:bg-slate-50"
              >
                <Download className="w-3.5 h-3.5 mr-1 text-slate-500" />
                Export Data
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearAll}
                className="text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                Clear
              </Button>
            </>
          )}

          <Button
            size="sm"
            onClick={() => handleStartEnrichment()}
            disabled={progress.isActive || records.length === 0}
            className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-xs"
          >
            <Play className="w-3.5 h-3.5 mr-1.5 fill-current" />
            {progress.isActive ? 'Scraping...' : 'Run Social Scraper'}
          </Button>
        </div>
      </div>

      {/* Real-time Progress Bar */}
      <ProgressIndicator
        progress={progress}
        onCancel={handleCancelEnrichment}
        moduleName="Social Media URL Finder"
      />

      {/* Quick Paste URLs Panel */}
      {activeTab === 'quick-input' && (
        <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-5">
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <PlusCircle className="w-5 h-5 text-blue-600" />
              Quick Paste Website URLs
            </h3>
            <p className="text-xs text-slate-500">
              Paste website URLs or domains (one per line). You can also include company names formatted as{' '}
              <code className="text-blue-600 bg-blue-50 px-1 py-0.5 rounded">Company Name, website.com</code>.
            </p>
          </div>

          <textarea
            value={quickInputText}
            onChange={(e) => setQuickInputText(e.target.value)}
            rows={7}
            placeholder={`stripe.com\nappsumo.com\nuserpilot.com\nSlack, slack.com\nhttps://linear.app`}
            className="w-full p-3 text-sm font-mono rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-slate-50/50"
          />

          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">
              {quickInputText.split('\n').filter((l) => l.trim()).length} website(s) detected
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAddQuickInput(false)}
                disabled={!quickInputText.trim()}
              >
                Add to List
              </Button>
              <Button
                size="sm"
                onClick={() => handleAddQuickInput(true)}
                disabled={!quickInputText.trim() || progress.isActive}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Play className="w-3.5 h-3.5 mr-1 fill-current" />
                Add & Scrape Immediately
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* File Upload Tab */}
      {activeTab === 'upload' && (
        <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-6">
          {!parsedFile ? (
            <div className="max-w-2xl mx-auto space-y-4">
              <div className="text-center space-y-1">
                <h3 className="text-base font-bold text-slate-900">Upload Companies or Websites</h3>
                <p className="text-xs text-slate-500">
                  Upload your spreadsheet (.xlsx, .csv) with a "Website" or "Company URL" column to extract Facebook, Instagram, LinkedIn, and X URLs.
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

      {/* Settings / Mode Switcher */}
      {activeTab === 'settings' && (
        <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-6">
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-5 h-5 text-blue-600" />
              Algorithm & Scraper Engine Configuration
            </h3>
            <p className="text-xs text-slate-500">
              Select between the two n8n engine modes for extracting corporate social media profiles.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Website Mode */}
            <div
              onClick={() => setSocialMode('website')}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                socialMode === 'website'
                  ? 'border-blue-600 bg-blue-50/40 ring-2 ring-blue-500/20'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-blue-100 text-blue-700">
                    <Globe className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Website Mode (Scheduled / Batch)</h4>
                    <span className="text-[11px] font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                      Default & Fastest
                    </span>
                  </div>
                </div>
                {socialMode === 'website' && <CheckCircle className="w-5 h-5 text-blue-600" />}
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-3">
                Uses the <code className="bg-slate-100 px-1 py-0.5 rounded text-blue-700">Website</code> column. Concurrently crawls target sites in batches of 5, parses all <code className="bg-slate-100 px-1 py-0.5 rounded">&lt;a href&gt;</code> links, cleans query params and share dialogs, and extracts Facebook, Instagram, LinkedIn, and X URLs.
              </p>
              <div className="text-[11px] text-slate-500 flex items-center gap-1.5 pt-2 border-t border-slate-200/60">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>Concurrent workers: 5 sites at once</span>
              </div>
            </div>

            {/* Company Mode */}
            <div
              onClick={() => setSocialMode('company')}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                socialMode === 'company'
                  ? 'border-blue-600 bg-blue-50/40 ring-2 ring-blue-500/20'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Company Mode (Strict Regex)</h4>
                    <span className="text-[11px] font-medium text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                      High Precision
                    </span>
                  </div>
                </div>
                {socialMode === 'company' && <CheckCircle className="w-5 h-5 text-blue-600" />}
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-3">
                Uses <code className="bg-slate-100 px-1 py-0.5 rounded text-indigo-700">Company URL</code>. Sequential scan with a customizable pause between sites. Applies strict regex patterns and verifies LinkedIn pages only match corporate paths (<code className="bg-slate-100 px-1 py-0.5 rounded">/company</code>, <code className="bg-slate-100 px-1 py-0.5 rounded">/showcase</code>, <code className="bg-slate-100 px-1 py-0.5 rounded">/school</code>).
              </p>
              <div className="text-[11px] text-slate-500 flex items-center gap-1.5 pt-2 border-t border-slate-200/60">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>Inter-site pause: {delaySec}s delay</span>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs font-semibold text-slate-800 block">Performance Parameters</span>
              <span className="text-[11px] text-slate-500">
                Adjust batch parallelism and throttling for rate limiting protection.
              </span>
            </div>

            <div className="flex items-center gap-4">
              {socialMode === 'website' ? (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-600 font-medium">Batch Size:</label>
                  <select
                    value={batchSize}
                    onChange={(e) => setBatchSize(Number(e.target.value))}
                    className="text-xs border border-slate-200 bg-white rounded-lg px-2.5 py-1.5"
                  >
                    <option value={3}>3 sites</option>
                    <option value={5}>5 sites (recommended)</option>
                    <option value={10}>10 sites</option>
                  </select>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-600 font-medium">Pause between sites:</label>
                  <select
                    value={delaySec}
                    onChange={(e) => setDelaySec(Number(e.target.value))}
                    className="text-xs border border-slate-200 bg-white rounded-lg px-2.5 py-1.5"
                  >
                    <option value={0.5}>0.5 seconds</option>
                    <option value={1.0}>1.0 second (standard)</option>
                    <option value={2.0}>2.0 seconds</option>
                  </select>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Table View */}
      {activeTab === 'table' && (
        <div className="space-y-4">
          {records.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-4">
              <div className="w-12 h-12 mx-auto rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                <Share2 className="w-6 h-6" />
              </div>
              <div className="max-w-md mx-auto space-y-1">
                <h4 className="text-base font-bold text-slate-900">No websites loaded yet</h4>
                <p className="text-xs text-slate-500">
                  Upload an Excel/CSV file with company websites or use Quick Paste to enter URLs directly.
                </p>
              </div>
              <div className="flex items-center justify-center gap-3 pt-2">
                <Button
                  size="sm"
                  onClick={() => setActiveTab('quick-input')}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs"
                >
                  <PlusCircle className="w-3.5 h-3.5 mr-1.5" />
                  Quick Paste URLs
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveTab('upload')}
                  className="text-xs"
                >
                  <UploadCloud className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
                  Upload Spreadsheet
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

      <ExportModal
        isOpen={exportModalState.isOpen}
        onClose={() => setExportModalState((prev) => ({ ...prev, isOpen: false }))}
        scope={exportModalState.scope}
        records={exportModalState.records}
        allRecordsCount={records.length}
        filteredRecordsCount={exportModalState.records.length}
        selectedRecordsCount={exportModalState.records.length}
        moduleType="social-finder"
        projectName="Social_Profiles_Export"
      />
    </div>
  );
};
