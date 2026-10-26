import React, { useState, useRef, useEffect } from 'react';
import {
  Linkedin,
  UploadCloud,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Play,
  FileSpreadsheet,
  Download,
  ShieldCheck,
  FlaskConical,
  HelpCircle,
  ExternalLink,
  ChevronRight,
  Info,
  Layers,
} from 'lucide-react';
import { ModuleHeader } from '../components/common/ModuleHeader';
import { FileUploader } from '../components/common/FileUploader';
import { ColumnMapper } from '../components/common/ColumnMapper';
import { ConfigOptionsPanel } from '../components/common/ConfigOptionsPanel';
import { DataTable } from '../components/common/DataTable';
import { ProgressIndicator } from '../components/common/ProgressIndicator';
import { ExportModal } from '../components/common/ExportModal';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { EnrichmentRecord, ResearchConfig, ResearchProgress, ColumnMapping } from '../types';
import { ParsedFileResult, excelService } from '../services/excelService';
import { linkedinFinderService } from '../services/adapters';
import { getSampleInitialRecords } from '../services/mockData';
import { storageService } from '../services/storageService';
import { historyService } from '../services/historyService';

export const LinkedInFinder: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'table' | 'upload' | 'config' | 'review'>('table');
  const [records, setRecords] = useState<EnrichmentRecord[]>(() => {
    return getSampleInitialRecords().map((r, i) => {
      if (i < 3) {
        return {
          ...r,
          matchStatus: 'Found (High)',
          confidenceLevel: 'High',
          matchedName: r.personName,
          matchedHeadline: `${r.title} - ${r.companyName}`,
          evidence: 'name:exact; company:strong(headline); location:match_city',
        };
      }
      return {
        ...r,
        linkedinUrl: '', // Precision rule demo: leave blank if not confirmed
        matchStatus: 'Not verified - see Review sheet',
        confidenceLevel: '',
        evidence: 'company not confirmed in search result',
        enrichmentStatus: 'not_found',
      };
    });
  });

  const [parsedFile, setParsedFile] = useState<ParsedFileResult | null>(null);
  const [rawUploadedFile, setRawUploadedFile] = useState<File | null>(null);

  // Backend Health & Key state
  const [backendHealth, setBackendHealth] = useState<{
    isOnline: boolean;
    hasKey: boolean;
    keyPreview: string;
  }>({ isOnline: false, hasKey: false, keyPreview: 'checking' });

  // Unit Test Modal State
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [testResult, setTestResult] = useState<{
    isLoading: boolean;
    success?: boolean;
    totalTests?: number;
    output?: string;
  }>({ isLoading: false });

  // Direct backend generated file download URL
  const [generatedFileDownload, setGeneratedFileDownload] = useState<{
    url: string;
    fileName: string;
    summary: any;
  } | null>(null);

  const [reviewCandidates, setReviewCandidates] = useState<any[]>([]);

  const [config, setConfig] = useState<ResearchConfig>({
    findCompanyLinkedIn: true,
    findPersonalLinkedIn: true,
    simulationSpeedMs: 350,
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

  // Check health on mount
  useEffect(() => {
    checkHealth();
  }, []);

  const checkHealth = async () => {
    const health = await linkedinFinderService.checkBackendHealth();
    setBackendHealth(health);
  };

  const handleRunTests = async () => {
    setIsTestModalOpen(true);
    setTestResult({ isLoading: true });
    const result = await linkedinFinderService.runAlgorithmUnitTests();
    setTestResult({
      isLoading: false,
      success: result.success,
      totalTests: result.totalTests,
      output: result.output,
    });
  };

  const handleFileParsed = (parsed: ParsedFileResult) => {
    setParsedFile(parsed);
  };

  const handleRawFileSelected = (file: File) => {
    setRawUploadedFile(file);
  };

  const handleMappingConfirmed = (newRecords: EnrichmentRecord[], mapping: ColumnMapping) => {
    setRecords(newRecords);
    setParsedFile(null);
    setActiveTab('table');

    storageService.saveProject({
      id: `proj-${Date.now()}`,
      name: `LinkedIn Precision Search (${new Date().toLocaleDateString()})`,
      description: 'Uploaded via LinkedIn URL Finder',
      moduleType: 'linkedin-finder',
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

  const handleStartEnrichment = async (subsetIds?: string[]) => {
    const targets = subsetIds
      ? records.filter((r) => subsetIds.includes(r.id))
      : records;

    if (targets.length === 0) return;

    abortControllerRef.current = new AbortController();

    try {
      const enrichedBatch = await linkedinFinderService.enrichBatch(
        targets,
        config,
        (p) => setProgress(p),
        abortControllerRef.current.signal
      );

      setRecords((prev) => {
        const enrichedMap = new Map(enrichedBatch.map((item) => [item.id, item]));
        return prev.map((item) => enrichedMap.get(item.id) || item);
      });

      // Auto-save to user history
      const queryTitle =
        parsedFile?.fileName ||
        (targets[0]?.companyName
          ? `${targets[0].companyName}${targets.length > 1 ? ` & ${targets.length - 1} others` : ''}`
          : 'LinkedIn URL Discovery');

      historyService.saveSearchHistory({
        moduleType: 'linkedin-finder',
        searchQuery: queryTitle,
        records: enrichedBatch,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setProgress((prev) => ({
          ...prev,
          isActive: false,
          status: 'cancelled',
          stageMessage: 'Search cancelled by user.',
        }));
      } else {
        alert(`Search failed: ${err.message}`);
      }
    }
  };

  // Direct 1-click Python backend processing for uploaded spreadsheets
  const handleProcessFileDirectly = async () => {
    if (!rawUploadedFile) return;

    setProgress({
      isActive: true,
      currentIndex: 1,
      totalCount: 1,
      percentage: 20,
      status: 'running',
      stageMessage: 'Processing file with SerpAPI decision maker engine...',
      currentItemName: rawUploadedFile.name,
      leadsFound: 0,
      leadsProcessed: 0,
      elapsedSeconds: 0,
    });

    try {
      const res = await linkedinFinderService.enrichFileViaBackend(rawUploadedFile, {
        minConfidence: 'medium',
        maxSearches: 3,
        allowLocationConflict: false,
      });

      setGeneratedFileDownload({
        url: res.downloadUrl,
        fileName: res.fileName,
        summary: res.summary,
      });

      if (res.review) {
        setReviewCandidates(res.review);
      }

      // If records were returned, map them into the table
      if (res.records && res.records.length > 0) {
        const mappedRecords: EnrichmentRecord[] = res.records.map((r: any, idx: number) => ({
          id: `rec-${Date.now()}-${idx + 1}`,
          companyName: r['Company'] || r['Company Name'] || r['company'] || `Company ${idx + 1}`,
          personName: r['Decision Maker'] || r['Full Name'] || r['Name'] || r['Decision Maker Name'] || '',
          title: r['Job Title'] || r['Title'] || '',
          city: r['City'] || '',
          linkedinUrl: r['LinkedIn URL'] || '',
          matchStatus: r['Match Status'] || (r['LinkedIn URL'] ? 'Found' : 'Not verified'),
          confidenceLevel: r['Confidence'] || '',
          matchedName: r['Matched Profile Name'] || '',
          matchedHeadline: r['Matched Headline'] || '',
          evidence: r['Match Evidence'] || '',
          enrichmentStatus: r['LinkedIn URL'] ? 'enriched' : 'not_found',
        }));
        setRecords(mappedRecords);
        setActiveTab('table');

        // Auto-save file enrichment to user history
        historyService.saveSearchHistory({
          moduleType: 'linkedin-finder',
          searchQuery: rawUploadedFile.name,
          records: mappedRecords,
        });
      }

      setProgress({
        isActive: false,
        currentIndex: 1,
        totalCount: 1,
        percentage: 100,
        status: 'completed',
        stageMessage: `Generated 3-sheet XLSX (${res.summary?.found || 0} verified, ${res.summary?.blank || 0} unverified blank).`,
        currentItemName: '',
        leadsFound: res.summary?.found || 0,
        leadsProcessed: res.summary?.rows || 1,
        elapsedSeconds: 2,
      });
    } catch (err: any) {
      alert(`File processing error: ${err.message}`);
      setProgress((prev) => ({ ...prev, isActive: false, status: 'error' }));
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

  const verifiedCount = records.filter((r) => r.linkedinUrl).length;
  const blankCount = records.length - verifiedCount;

  return (
    <div className="space-y-6">
      {/* Top Banner with SerpAPI Status & Unit Test runner */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-white/10 backdrop-blur-md border border-white/20 text-blue-300">
            <Linkedin className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold tracking-tight">LinkedIn Decision-Maker Engine</h3>
              {backendHealth.hasKey ? (
                <Badge variant="success" size="sm" className="bg-emerald-500/20 text-emerald-300 border-emerald-400/30 text-[10px]">
                  ● SerpAPI Key Active ({backendHealth.keyPreview})
                </Badge>
              ) : (
                <Badge variant="warning" size="sm" className="bg-amber-500/20 text-amber-300 border-amber-400/30 text-[10px]">
                  SERPAPI_KEY in .env required for live Google search
                </Badge>
              )}
            </div>
            <p className="text-xs text-blue-200/80 mt-0.5">
              Rule: <strong>Precision over recall</strong>. URLs are written only when search results show verified evidence; otherwise cells stay blank.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleRunTests}
            className="bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400/40 text-xs font-semibold h-8 shadow-xs"
          >
            <FlaskConical className="w-3.5 h-3.5 mr-1.5 text-indigo-200" />
            Run 15 Unit Tests
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={checkHealth}
            className="bg-white text-slate-900 hover:bg-slate-100 text-xs h-8 font-semibold"
          >
            Check .env Key
          </Button>
        </div>
      </div>

      {/* Generated File Notice */}
      {generatedFileDownload && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <div className="font-bold text-xs">
                Generated Multi-Sheet Excel Workbook: {generatedFileDownload.fileName}
              </div>
              <div className="text-[11px] text-emerald-700">
                Sheets included: <strong>Results</strong> (with verified links), <strong>Review (unverified)</strong>, and <strong>Summary</strong> ({generatedFileDownload.summary?.found || 0} found, {generatedFileDownload.summary?.blank || 0} blank).
              </div>
            </div>
          </div>

          <a href={generatedFileDownload.url} download={generatedFileDownload.fileName}>
            <Button variant="success" size="sm" className="text-xs font-semibold gap-1.5 shadow-sm">
              <Download className="w-3.5 h-3.5" />
              Download Generated .XLSX
            </Button>
          </a>
        </div>
      )}

      {/* Module Header */}
      <ModuleHeader
        title={linkedinFinderService.metadata.name}
        badge={linkedinFinderService.metadata.badge}
        description={linkedinFinderService.metadata.description}
        icon={Linkedin}
        inputRequirements={linkedinFinderService.metadata.inputRequirements}
        outputFields={linkedinFinderService.metadata.outputFields}
        integrationNote={linkedinFinderService.metadata.integrationNote}
        onRunEnrichment={() => handleStartEnrichment()}
        isRunning={progress.isActive}
        totalRecordsCount={records.length}
      />

      {/* Mode / Tabs Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-2 rounded-xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setActiveTab('table')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${activeTab === 'table'
                ? 'bg-blue-50 text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
          >
            Verified Profiles ({verifiedCount} verified / {blankCount} blank)
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${activeTab === 'upload'
                ? 'bg-blue-50 text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
          >
            <UploadCloud className="w-3.5 h-3.5" />
            Upload Spreadsheet
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('config')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${activeTab === 'config'
                ? 'bg-blue-50 text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
          >
            Matching Rules
          </button>
        </div>

        <div className="flex items-center gap-2">
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
            Reset Sample Leads
          </Button>
        </div>
      </div>

      {/* Progress Indicator */}
      <ProgressIndicator
        progress={progress}
        onCancel={handleCancelEnrichment}
        moduleName={linkedinFinderService.metadata.name}
      />

      {/* Tab: Upload */}
      {activeTab === 'upload' && (
        <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-6">
          {!parsedFile ? (
            <div className="max-w-2xl mx-auto space-y-4">
              <div className="text-center space-y-1">
                <h3 className="text-base font-bold text-slate-900">Upload Target Decision Makers</h3>
                <p className="text-xs text-slate-500">
                  Upload an Excel (.xlsx) or CSV file with <strong>Decision Maker Name</strong>, <strong>Company</strong>, and optional <strong>City/State</strong>.
                </p>
              </div>

              <div
                onChange={(e: any) => {
                  if (e.target.files && e.target.files[0]) {
                    handleRawFileSelected(e.target.files[0]);
                  }
                }}
              >
                <FileUploader onFileParsed={handleFileParsed} />
              </div>

              {rawUploadedFile && backendHealth.hasKey && (
                <div className="p-4 rounded-xl bg-blue-50/80 border border-blue-200 flex items-center justify-between">
                  <div className="text-xs text-blue-900">
                    <span className="font-bold">Direct Python Worker Mode:</span> Process{' '}
                    <code className="font-mono font-semibold">{rawUploadedFile.name}</code> directly through SerpAPI and generate the 3-sheet XLSX file.
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={handleProcessFileDirectly}
                    className="text-xs font-semibold shrink-0 gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Process File Directly
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <ColumnMapper
              parsedFile={parsedFile}
              onMappingConfirmed={handleMappingConfirmed}
              onCancel={() => {
                setParsedFile(null);
                setRawUploadedFile(null);
              }}
            />
          )}
        </div>
      )}

      {/* Tab: Config */}
      {activeTab === 'config' && (
        <ConfigOptionsPanel
          moduleType="linkedin-finder"
          config={config}
          onChange={setConfig}
        />
      )}

      {/* Tab: Table */}
      {activeTab === 'table' && (
        <div className="space-y-4">
          <DataTable
            records={records}
            onRecordsChange={setRecords}
            onRunSelectedEnrichment={(selectedIds) => handleStartEnrichment(selectedIds)}
            onOpenExportModal={openExportModal}
            isLoading={progress.isActive}
          />
        </div>
      )}

      {/* Unit Test Modal */}
      <Modal
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
        title="LinkedIn Finder Algorithm Unit Tests"
        description="Executing test_linkedin_finder.py unit test suite"
        maxWidth="2xl"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
            <div className="flex items-center gap-2">
              <FlaskConical className="w-5 h-5 text-indigo-600" />
              <div>
                <div className="text-xs font-bold text-slate-800">
                  {testResult.isLoading ? 'Running 15 tests...' : testResult.success ? 'All 15 Tests Passed Successfully' : 'Test Failures Detected'}
                </div>
                <div className="text-[11px] text-slate-500">
                  Covers: precision verification, wrong company rejection, education noise, ambiguity detection, location conflict, nicknames, and multi-sheet Excel generation.
                </div>
              </div>
            </div>

            {testResult.success && (
              <Badge variant="success" size="md">
                15 / 15 OK
              </Badge>
            )}
          </div>

          <div className="p-4 rounded-xl bg-slate-900 text-emerald-400 font-mono text-xs overflow-x-auto max-h-72 shadow-inner whitespace-pre-wrap">
            {testResult.isLoading ? 'Executing test suite in Python virtualenv...' : testResult.output}
          </div>

          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setIsTestModalOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>

      {/* Export Modal */}
      <ExportModal
        isOpen={exportModalState.isOpen}
        onClose={() => setExportModalState((prev) => ({ ...prev, isOpen: false }))}
        scope={exportModalState.scope}
        records={exportModalState.records}
        allRecordsCount={records.length}
        filteredRecordsCount={exportModalState.records.length}
        selectedRecordsCount={exportModalState.records.length}
        moduleType="linkedin-finder"
        projectName="Decision_Maker_LinkedIn_Profiles"
      />
    </div>
  );
};
