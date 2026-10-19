import React, { useState, useRef } from 'react';
import { UserCheck, FileSpreadsheet, Plus, UploadCloud, RotateCcw } from 'lucide-react';
import { ModuleHeader } from '../components/common/ModuleHeader';
import { FileUploader } from '../components/common/FileUploader';
import { ColumnMapper } from '../components/common/ColumnMapper';
import { ConfigOptionsPanel } from '../components/common/ConfigOptionsPanel';
import { DataTable } from '../components/common/DataTable';
import { ProgressIndicator } from '../components/common/ProgressIndicator';
import { ExportModal } from '../components/common/ExportModal';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EnrichmentRecord, ResearchConfig, ResearchProgress, ColumnMapping } from '../types';
import { ParsedFileResult, excelService } from '../services/excelService';
import { decisionMakerService } from '../services/adapters';
import { getSampleInitialRecords } from '../services/mockData';
import { storageService } from '../services/storageService';

export const DecisionMakerFinder: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'table' | 'upload' | 'config'>('table');
  const [records, setRecords] = useState<EnrichmentRecord[]>(() => getSampleInitialRecords());
  const [parsedFile, setParsedFile] = useState<ParsedFileResult | null>(null);

  const [config, setConfig] = useState<ResearchConfig>({
    seniorityLevels: ['C-Level', 'VP'],
    verifyEmails: true,
    findDirectPhones: true,
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

  const handleFileParsed = (parsed: ParsedFileResult) => {
    setParsedFile(parsed);
  };

  const handleMappingConfirmed = (newRecords: EnrichmentRecord[], mapping: ColumnMapping) => {
    setRecords(newRecords);
    setParsedFile(null);
    setActiveTab('table');

    // Save as project in localStorage
    storageService.saveProject({
      id: `proj-${Date.now()}`,
      name: `Imported Accounts (${new Date().toLocaleDateString()})`,
      description: 'Uploaded via Decision Maker Finder',
      moduleType: 'decision-maker',
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
      const enrichedBatch = await decisionMakerService.enrichBatch(
        targets,
        config,
        (p) => setProgress(p),
        abortControllerRef.current.signal
      );

      // Merge enriched records back
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
          stageMessage: 'Enrichment cancelled by user.',
        }));
      } else {
        alert(`Enrichment failed: ${err.message}`);
      }
    }
  };

  const handleCancelEnrichment = () => {
    abortControllerRef.current?.abort();
  };

  const handleResetToSample = () => {
    setRecords(getSampleInitialRecords());
    setActiveTab('table');
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

      {/* Mode / Tabs Bar */}
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
            Dataset & Results ({records.length})
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
            Upload Spreadsheet
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
            Configure Rules
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResetToSample}
            className="text-xs text-slate-500 hover:text-slate-800"
            title="Reset to default enterprise sample accounts"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            Load Sample Leads
          </Button>
        </div>
      </div>

      {/* Progress Indicator */}
      <ProgressIndicator
        progress={progress}
        onCancel={handleCancelEnrichment}
        moduleName={decisionMakerService.metadata.name}
      />

      {/* Tab: Upload & Mapping */}
      {activeTab === 'upload' && (
        <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-6">
          {!parsedFile ? (
            <div className="max-w-2xl mx-auto space-y-4">
              <div className="text-center space-y-1">
                <h3 className="text-base font-bold text-slate-900">Upload Target Companies</h3>
                <p className="text-xs text-slate-500">
                  Upload an Excel or CSV file containing company names or domains.
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

      {/* Tab: Configuration */}
      {activeTab === 'config' && (
        <ConfigOptionsPanel
          moduleType="decision-maker"
          config={config}
          onChange={setConfig}
        />
      )}

      {/* Tab: Data Table */}
      {activeTab === 'table' && (
        <DataTable
          records={records}
          onRecordsChange={setRecords}
          onRunSelectedEnrichment={(selectedIds) => handleStartEnrichment(selectedIds)}
          onOpenExportModal={openExportModal}
          isLoading={progress.isActive}
        />
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
