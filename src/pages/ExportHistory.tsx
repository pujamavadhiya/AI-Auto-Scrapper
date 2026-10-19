import React, { useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  FileText,
  Search,
  Trash2,
  Calendar,
  Layers,
  ArrowDownToLine,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { storageService } from '../services/storageService';
import { excelService } from '../services/excelService';
import { ExportHistoryItem } from '../types';
import { formatDate } from '../lib/utils';
import { getSampleInitialRecords } from '../services/mockData';

export const ExportHistory: React.FC = () => {
  const [history, setHistory] = useState<ExportHistoryItem[]>(() => storageService.getExportHistory());
  const [searchTerm, setSearchTerm] = useState('');
  const [downloadSuccessNotice, setDownloadSuccessNotice] = useState<string | null>(null);

  const filteredHistory = history.filter((item) => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return (
      item.fileName.toLowerCase().includes(q) ||
      item.projectName.toLowerCase().includes(q) ||
      item.moduleType.toLowerCase().includes(q)
    );
  });

  const handleDownloadAgain = (item: ExportHistoryItem) => {
    try {
      // Generate sample records matching the count
      const mockRecords = getSampleInitialRecords().slice(0, Math.min(item.recordCount, 8));
      excelService.exportRecords(mockRecords, {
        fileName: item.fileName,
        format: item.format,
        includeConfidenceScore: true,
      });

      setDownloadSuccessNotice(`Re-downloaded "${item.fileName}"!`);
      setTimeout(() => setDownloadSuccessNotice(null), 2500);
    } catch (err) {
      alert(`Download failed: ${(err as Error).message}`);
    }
  };

  const handleClearHistory = () => {
    if (confirm('Are you sure you want to clear your local export history log?')) {
      storageService.clearExportHistory();
      setHistory([]);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Export History</h2>
            <Badge variant="secondary" size="sm">
              {history.length} Downloads Logged
            </Badge>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Browse and re-download spreadsheets created in your browser via SheetJS.
          </p>
        </div>

        {history.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearHistory}
            className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 hover:border-rose-200 self-start sm:self-auto"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
            Clear Log History
          </Button>
        )}
      </div>

      {downloadSuccessNotice && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{downloadSuccessNotice}</span>
        </div>
      )}

      {/* Filter toolbar */}
      <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200/80 shadow-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search by file name, project..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-300 text-xs shadow-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => excelService.downloadSampleTemplate('xlsx')}
          className="text-xs text-slate-600 font-medium"
        >
          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 mr-1.5" />
          Download Sample Template (.xlsx)
        </Button>
      </div>

      {/* History Table */}
      <div className="rounded-xl border border-slate-200/80 bg-white overflow-hidden shadow-xs">
        <div className="overflow-x-auto min-h-[300px]">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold select-none">
                <th className="p-3.5">Spreadsheet Name</th>
                <th className="p-3.5">Format</th>
                <th className="p-3.5">Record Count</th>
                <th className="p-3.5">Export Scope</th>
                <th className="p-3.5">Origin Module</th>
                <th className="p-3.5">Exported Date</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center">
                      <Download className="w-8 h-8 text-slate-300 mb-2" />
                      <p className="text-sm font-medium text-slate-600">No export records found</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Whenever you download an Excel or CSV file from any module, it will be cataloged here.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredHistory.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                    {/* File Name */}
                    <td className="p-3.5 font-medium text-slate-900">
                      <div className="flex items-center gap-2">
                        {item.format === 'xlsx' ? (
                          <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                            <FileSpreadsheet className="w-4 h-4" />
                          </div>
                        ) : (
                          <div className="p-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200/60">
                            <FileText className="w-4 h-4" />
                          </div>
                        )}
                        <div>
                          <span className="font-semibold text-slate-900 block">{item.fileName}</span>
                          <span className="text-[11px] text-slate-400">{item.projectName}</span>
                        </div>
                      </div>
                    </td>

                    {/* Format */}
                    <td className="p-3.5">
                      <span className="font-mono text-[10px] uppercase font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border">
                        .{item.format}
                      </span>
                    </td>

                    {/* Record count */}
                    <td className="p-3.5 font-semibold text-slate-800">
                      {item.recordCount} records
                    </td>

                    {/* Scope */}
                    <td className="p-3.5">
                      <Badge
                        variant={
                          item.exportScope === 'all'
                            ? 'default'
                            : item.exportScope === 'selected'
                            ? 'success'
                            : 'secondary'
                        }
                        size="sm"
                      >
                        {item.exportScope}
                      </Badge>
                    </td>

                    {/* Module */}
                    <td className="p-3.5 capitalize text-slate-600">
                      {item.moduleType.replace('-', ' ')}
                    </td>

                    {/* Timestamp */}
                    <td className="p-3.5 text-slate-500 font-mono text-[11px]">
                      {formatDate(item.exportedAt)}
                    </td>

                    {/* Action */}
                    <td className="p-3.5 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDownloadAgain(item)}
                        className="h-7 text-xs font-semibold gap-1 text-slate-700 hover:text-blue-600 hover:border-blue-300"
                        title="Download file again"
                      >
                        <ArrowDownToLine className="w-3.5 h-3.5 text-blue-600" />
                        <span>Download</span>
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
