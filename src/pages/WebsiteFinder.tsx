import React, { useState, useRef } from 'react';
import { Globe, UploadCloud, RotateCcw } from 'lucide-react';
import { ModuleHeader } from '../components/common/ModuleHeader';
import { FileUploader } from '../components/common/FileUploader';
import { ColumnMapper } from '../components/common/ColumnMapper';
import { ConfigOptionsPanel } from '../components/common/ConfigOptionsPanel';
import { DataTable } from '../components/common/DataTable';
import { ProgressIndicator } from '../components/common/ProgressIndicator';
import { ExportModal } from '../components/common/ExportModal';
import { Button } from '../components/ui/Button';
import { EnrichmentRecord, ResearchConfig, ResearchProgress, ColumnMapping } from '../types';
import { ParsedFileResult } from '../services/excelService';
import { websiteFinderService } from '../services/adapters';
import { getSampleInitialRecords } from '../services/mockData';
import { storageService } from '../services/storageService';

export const WebsiteFinder: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'table' | 'upload' | 'config'>('table');
  const [records, setRecords] = useState<EnrichmentRecord[]>(() => getSampleInitialRecords());
  const [parsedFile, setParsedFile] = useState<ParsedFileResult | null>(null);

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

  const handleStartEnrichment = async (subsetIds?: string[]) => {
    const targets = subsetIds
      ? records.filter((r) => subsetIds.includes(r.id))
      : records;

    if (targets.length === 0) return;

    abortControllerRef.current = new AbortController();

    try {
      const enrichedBatch = await websiteFinderService.enrichBatch(
        targets,
        config,
        (p) => setProgress(p),
        abortControllerRef.current.signal
      );

      setRecords((prev) => {
        const enrichedMap = new Map(enrichedBatch.map((item) => [item.id, item]));
        return prev.map((item) => enrichedMap.get(item.id) || item);
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setProgress((prev) => ({
          ...prev,
          isActive: false,
          status: 'cancelled',
          stageMessage: 'Website search cancelled.',
        }));
      } else {
        alert(`Website search failed: ${err.message}`);
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

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-2 rounded-xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('table')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'table'
                ? 'bg-blue-50 text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            Websites & Domains ({records.length})
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
            Crawl Parameters
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
        moduleName={websiteFinderService.metadata.name}
      />

      {activeTab === 'upload' && (
        <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-6">
          {!parsedFile ? (
            <div className="max-w-2xl mx-auto space-y-4">
              <div className="text-center space-y-1">
                <h3 className="text-base font-bold text-slate-900">Upload Companies for Website Discovery</h3>
                <p className="text-xs text-slate-500">
                  Upload raw company lists to resolve canonical websites, HTTP 200 checks, and brand domains.
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

      {activeTab === 'config' && (
        <ConfigOptionsPanel
          moduleType="website-finder"
          config={config}
          onChange={setConfig}
        />
      )}

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
        projectName="Company_Websites_Export"
      />
    </div>
  );
};
