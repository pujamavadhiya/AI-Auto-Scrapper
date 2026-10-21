import React, { useState } from 'react';
import { Download, FileSpreadsheet, FileText, CheckCircle2, ShieldCheck } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { EnrichmentRecord, ModuleType } from '../../types';
import { excelService } from '../../services/excelService';
import { storageService } from '../../services/storageService';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  scope: 'all' | 'filtered' | 'selected';
  records: EnrichmentRecord[];
  allRecordsCount: number;
  filteredRecordsCount: number;
  selectedRecordsCount: number;
  moduleType: ModuleType;
  projectName?: string;
}

const AVAILABLE_COLUMNS = [
  { id: 'Company Name', label: 'Company Name', default: true },
  { id: 'Domain / Website', label: 'Domain / Canonical Website', default: true },
  { id: 'Decision Maker Name', label: 'Decision Maker Name', default: true },
  { id: 'Job Title', label: 'Job Title / Role', default: true },
  { id: 'Email Address', label: 'Email Address', default: true },
  { id: 'Email Status', label: 'Email Deliverability Status', default: true },
  { id: 'Phone Number', label: 'Phone Number', default: true },
  { id: 'Phone Type', label: 'Phone Line Type', default: true },
  { id: 'LinkedIn URL', label: 'Personal LinkedIn URL', default: true },
  { id: 'Match Status', label: 'Match Status (Found / Not verified)', default: true },
  { id: 'Confidence', label: 'Confidence Level (High / Medium)', default: true },
  { id: 'Matched Profile Name', label: 'Matched Profile Name', default: true },
  { id: 'Matched Headline', label: 'Matched Headline', default: true },
  { id: 'Match Evidence', label: 'Match Evidence (name/company/location)', default: true },
  { id: 'Company LinkedIn', label: 'Company LinkedIn Page', default: true },
  { id: 'Facebook URL', label: 'Facebook URL', default: true },
  { id: 'Instagram URL', label: 'Instagram URL', default: true },
  { id: 'Twitter / X URL', label: 'Twitter / X URL', default: true },
  { id: 'Industry', label: 'Industry', default: true },
  { id: 'Location', label: 'Location (City, Country)', default: true },
  { id: 'Enrichment Status', label: 'Enrichment Status', default: true },
  { id: 'Confidence Score (%)', label: 'Confidence Score (%)', default: true },
];

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  scope: initialScope,
  records,
  allRecordsCount,
  filteredRecordsCount,
  selectedRecordsCount,
  moduleType,
  projectName = 'Leads_Enrichment_Batch',
}) => {
  const [selectedScope, setSelectedScope] = useState<'all' | 'filtered' | 'selected'>(initialScope);
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [fileName, setFileName] = useState<string>(
    `${projectName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}`
  );
  const [selectedColumns, setSelectedColumns] = useState<string[]>(
    AVAILABLE_COLUMNS.filter((c) => c.default).map((c) => c.id)
  );
  const [isExporting, setIsExporting] = useState(false);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const toggleColumn = (colId: string) => {
    setSelectedColumns((prev) =>
      prev.includes(colId) ? prev.filter((id) => id !== colId) : [...prev, colId]
    );
  };

  const handleSelectAllCols = () => {
    setSelectedColumns(AVAILABLE_COLUMNS.map((c) => c.id));
  };

  const handleClearCols = () => {
    setSelectedColumns(['Company Name']);
  };

  const getRecordCountForScope = () => {
    if (selectedScope === 'selected') return selectedRecordsCount || records.length;
    if (selectedScope === 'filtered') return filteredRecordsCount;
    return allRecordsCount;
  };

  const handleExport = () => {
    setIsExporting(true);
    setSuccessNotice(null);

    try {
      const result = excelService.exportRecords(records, {
        fileName,
        format,
        selectedColumns,
        includeConfidenceScore: true,
      });

      // Save to export history
      storageService.addExportHistory({
        projectName: projectName,
        fileName: result.fileName,
        format,
        recordCount: records.length,
        exportScope: selectedScope,
        moduleType,
        fileSizeBytes: result.sizeBytes,
      });

      setSuccessNotice(`Successfully exported ${records.length} records as ${result.fileName}!`);
      setTimeout(() => {
        setIsExporting(false);
        onClose();
      }, 1200);
    } catch (err) {
      alert(`Export failed: ${(err as Error).message}`);
      setIsExporting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Export Enriched Dataset"
      description="Download your data directly in browser as Microsoft Excel or CSV"
      maxWidth="xl"
    >
      <div className="space-y-5">
        {/* Scope Selector */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2">
            1. Select Export Scope
          </label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setSelectedScope('all')}
              className={`p-3 rounded-xl border text-left transition-all ${
                selectedScope === 'all'
                  ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20 text-blue-900'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
              }`}
            >
              <div className="font-semibold text-xs">All Records</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{allRecordsCount} total</div>
            </button>

            <button
              type="button"
              onClick={() => setSelectedScope('filtered')}
              className={`p-3 rounded-xl border text-left transition-all ${
                selectedScope === 'filtered'
                  ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20 text-blue-900'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
              }`}
            >
              <div className="font-semibold text-xs">Filtered Records</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{filteredRecordsCount} match filters</div>
            </button>

            <button
              type="button"
              disabled={selectedRecordsCount === 0}
              onClick={() => setSelectedScope('selected')}
              className={`p-3 rounded-xl border text-left transition-all ${
                selectedScope === 'selected'
                  ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20 text-blue-900'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed'
              }`}
            >
              <div className="font-semibold text-xs">Selected Only</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{selectedRecordsCount} selected</div>
            </button>
          </div>
        </div>

        {/* Format Selector */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2">
            2. Choose File Format
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setFormat('xlsx')}
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                format === 'xlsx'
                  ? 'border-emerald-600 bg-emerald-50/60 ring-2 ring-emerald-500/20 text-emerald-950 font-semibold'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
              }`}
            >
              <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div className="text-left">
                <div className="text-xs font-bold">Microsoft Excel (.xlsx)</div>
                <div className="text-[10px] text-slate-500">Formatted with auto-sized column widths</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setFormat('csv')}
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                format === 'csv'
                  ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20 text-blue-950 font-semibold'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
              }`}
            >
              <div className="p-2 rounded-lg bg-blue-100 text-blue-700">
                <FileText className="w-5 h-5" />
              </div>
              <div className="text-left">
                <div className="text-xs font-bold">Comma-Separated (.csv)</div>
                <div className="text-[10px] text-slate-500">Universal plain text standard</div>
              </div>
            </button>
          </div>
        </div>

        {/* File Name Input */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            3. File Name
          </label>
          <div className="flex items-center">
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              className="flex-1 h-9 px-3 rounded-l-lg border border-slate-300 text-xs shadow-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
            <span className="h-9 px-3 flex items-center bg-slate-100 border border-l-0 border-slate-300 rounded-r-lg text-xs font-mono text-slate-600">
              .{format}
            </span>
          </div>
        </div>

        {/* Column Selection */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-semibold text-slate-700">
              4. Columns to Include ({selectedColumns.length} of {AVAILABLE_COLUMNS.length})
            </label>
            <div className="flex items-center gap-2 text-[11px]">
              <button
                type="button"
                onClick={handleSelectAllCols}
                className="text-blue-600 hover:underline"
              >
                Select All
              </button>
              <span className="text-slate-300">|</span>
              <button
                type="button"
                onClick={handleClearCols}
                className="text-slate-500 hover:underline"
              >
                Reset
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-44 overflow-y-auto p-3 border border-slate-200 rounded-xl bg-slate-50/50">
            {AVAILABLE_COLUMNS.map((col) => {
              const isChecked = selectedColumns.includes(col.id);
              return (
                <label
                  key={col.id}
                  className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none hover:text-slate-900"
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleColumn(col.id)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="truncate">{col.label}</span>
                </label>
              );
            })}
          </div>
        </div>

        {successNotice && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successNotice}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Zero server upload • Instant browser download</span>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={isExporting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleExport}
              isLoading={isExporting}
              className="gap-1.5"
            >
              <Download className="w-4 h-4" />
              Download {records.length} Records
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
