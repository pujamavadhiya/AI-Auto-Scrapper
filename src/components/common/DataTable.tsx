import React, { useState, useMemo } from 'react';
import {
  Search,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Mail,
  Phone,
  Linkedin,
  Globe,
  Edit2,
  Check,
  X,
  Filter,
  Trash2,
  Download,
  Play,
  RotateCcw,
  Sparkles,
  Facebook,
  Instagram,
} from 'lucide-react';
import { EnrichmentRecord } from '../../types';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { cn } from '../../lib/utils';

interface DataTableProps {
  records: EnrichmentRecord[];
  onRecordsChange: (updatedRecords: EnrichmentRecord[]) => void;
  onRunSelectedEnrichment?: (selectedIds: string[]) => void;
  onOpenExportModal: (scope: 'all' | 'filtered' | 'selected', recordsToExport: EnrichmentRecord[]) => void;
  isLoading?: boolean;
}

export const DataTable: React.FC<DataTableProps> = ({
  records,
  onRecordsChange,
  onRunSelectedEnrichment,
  onOpenExportModal,
  isLoading,
}) => {
  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enriched' | 'idle' | 'not_found'>('all');
  const [emailStatusFilter, setEmailStatusFilter] = useState<'all' | 'verified' | 'probable'>('all');

  // Sorting State
  const [sortField, setSortField] = useState<keyof EnrichmentRecord>('companyName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Inline Cell Editing State
  const [editingCell, setEditingCell] = useState<{ id: string; field: keyof EnrichmentRecord } | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  // Filtering Logic
  const filteredRecords = useMemo(() => {
    return records.filter((rec) => {
      // Global search
      if (searchTerm) {
        const query = searchTerm.toLowerCase();
        const matches =
          rec.companyName.toLowerCase().includes(query) ||
          (rec.personName && rec.personName.toLowerCase().includes(query)) ||
          (rec.title && rec.title.toLowerCase().includes(query)) ||
          (rec.email && rec.email.toLowerCase().includes(query)) ||
          (rec.phone && rec.phone.toLowerCase().includes(query)) ||
          (rec.domain && rec.domain.toLowerCase().includes(query));

        if (!matches) return false;
      }

      // Status filter
      if (statusFilter !== 'all' && rec.enrichmentStatus !== statusFilter) {
        return false;
      }

      // Email status filter
      if (emailStatusFilter !== 'all' && rec.emailStatus !== emailStatusFilter) {
        return false;
      }

      return true;
    });
  }, [records, searchTerm, statusFilter, emailStatusFilter]);

  // Sorting Logic
  const sortedRecords = useMemo(() => {
    return [...filteredRecords].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];

      if (aVal === undefined && bVal === undefined) return 0;
      if (aVal === undefined) return 1;
      if (bVal === undefined) return -1;

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }

      return 0;
    });
  }, [filteredRecords, sortField, sortDirection]);

  // Paginated records
  const totalPages = Math.ceil(sortedRecords.length / pageSize) || 1;
  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedRecords.slice(start, start + pageSize);
  }, [sortedRecords, currentPage, pageSize]);

  // Handle Sort Click
  const handleSort = (field: keyof EnrichmentRecord) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Selection handlers
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const allIds = new Set(filteredRecords.map((r) => r.id));
      setSelectedIds(allIds);
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Cell Editing
  const startEditing = (record: EnrichmentRecord, field: keyof EnrichmentRecord) => {
    setEditingCell({ id: record.id, field });
    setEditValue(String(record[field] || ''));
  };

  const saveEditing = () => {
    if (!editingCell) return;
    const updated = records.map((r) => {
      if (r.id === editingCell.id) {
        return {
          ...r,
          [editingCell.field]: editValue.trim() || undefined,
        };
      }
      return r;
    });
    onRecordsChange(updated);
    setEditingCell(null);
  };

  const cancelEditing = () => {
    setEditingCell(null);
  };

  // Delete selected
  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    if (confirm(`Are you sure you want to delete ${selectedIds.size} selected record(s)?`)) {
      const remaining = records.filter((r) => !selectedIds.has(r.id));
      onRecordsChange(remaining);
      setSelectedIds(new Set());
    }
  };

  const isAllSelected = filteredRecords.length > 0 && selectedIds.size === filteredRecords.length;
  const isIndeterminate = selectedIds.size > 0 && selectedIds.size < filteredRecords.length;

  return (
    <div className="space-y-4">
      {/* Search, Filters, and Action Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 bg-white rounded-xl border border-slate-200/80 shadow-xs">
        {/* Left: Search input */}
        <div className="flex flex-wrap items-center gap-2 flex-1 max-w-xl">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search companies, decision makers, emails, domains..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-300 text-xs shadow-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as any);
              setCurrentPage(1);
            }}
            className="h-9 px-2.5 rounded-lg border border-slate-300 text-xs bg-white text-slate-700 shadow-xs"
          >
            <option value="all">All Statuses</option>
            <option value="enriched">Enriched</option>
            <option value="idle">Idle / Pending</option>
            <option value="not_found">Not Found</option>
          </select>

          {/* Email verification filter */}
          <select
            value={emailStatusFilter}
            onChange={(e) => {
              setEmailStatusFilter(e.target.value as any);
              setCurrentPage(1);
            }}
            className="h-9 px-2.5 rounded-lg border border-slate-300 text-xs bg-white text-slate-700 shadow-xs"
          >
            <option value="all">All Email Deliverability</option>
            <option value="verified">Verified Deliverable</option>
            <option value="probable">Probable / Catch-All</option>
          </select>
        </div>

        {/* Right: Export & Multi-select actions */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 mr-2 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200">
              <span className="text-xs font-semibold text-blue-700">
                {selectedIds.size} selected
              </span>

              {onRunSelectedEnrichment && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => onRunSelectedEnrichment(Array.from(selectedIds))}
                  className="h-7 text-xs px-2 gap-1"
                >
                  <Sparkles className="w-3 h-3" />
                  Enrich ({selectedIds.size})
                </Button>
              )}

              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const selectedRecords = records.filter((r) => selectedIds.has(r.id));
                  onOpenExportModal('selected', selectedRecords);
                }}
                className="h-7 text-xs px-2 gap-1 text-slate-700"
              >
                <Download className="w-3 h-3 text-emerald-600" />
                Export
              </Button>

              <button
                onClick={handleDeleteSelected}
                className="p-1 text-rose-600 hover:text-rose-700 hover:bg-rose-100 rounded"
                title="Delete selected"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Export Dropdown / Trigger */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenExportModal('all', filteredRecords)}
            className="text-xs text-slate-700 font-semibold h-9 shadow-xs hover:border-blue-400"
          >
            <Download className="w-3.5 h-3.5 text-blue-600 mr-1.5" />
            Export Records ({filteredRecords.length})
          </Button>
        </div>
      </div>

      {/* Table Container */}
      <div className="rounded-xl border border-slate-200/80 bg-white overflow-hidden shadow-xs">
        <div className="overflow-x-auto min-h-[300px]">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold select-none">
                <th className="p-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = isIndeterminate;
                    }}
                    onChange={handleSelectAll}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </th>

                <th
                  className="p-3 cursor-pointer hover:bg-slate-100/60 transition-colors"
                  onClick={() => handleSort('companyName')}
                >
                  <div className="flex items-center gap-1.5">
                    <span>Company</span>
                    {sortField === 'companyName' && (
                      sortDirection === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-blue-600" /> : <ChevronDown className="w-3.5 h-3.5 text-blue-600" />
                    )}
                  </div>
                </th>

                <th
                  className="p-3 cursor-pointer hover:bg-slate-100/60 transition-colors"
                  onClick={() => handleSort('personName')}
                >
                  <div className="flex items-center gap-1.5">
                    <span>Decision Maker</span>
                    {sortField === 'personName' && (
                      sortDirection === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-blue-600" /> : <ChevronDown className="w-3.5 h-3.5 text-blue-600" />
                    )}
                  </div>
                </th>

                <th
                  className="p-3 cursor-pointer hover:bg-slate-100/60 transition-colors"
                  onClick={() => handleSort('title')}
                >
                  <div className="flex items-center gap-1.5">
                    <span>Title / Role</span>
                    {sortField === 'title' && (
                      sortDirection === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-blue-600" /> : <ChevronDown className="w-3.5 h-3.5 text-blue-600" />
                    )}
                  </div>
                </th>

                <th className="p-3">Verified Contact Info</th>

                <th className="p-3">Web & Social Links</th>

                <th
                  className="p-3 cursor-pointer hover:bg-slate-100/60 transition-colors"
                  onClick={() => handleSort('confidenceScore')}
                >
                  <div className="flex items-center gap-1.5">
                    <span>Confidence</span>
                    {sortField === 'confidenceScore' && (
                      sortDirection === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-blue-600" /> : <ChevronDown className="w-3.5 h-3.5 text-blue-600" />
                    )}
                  </div>
                </th>

                <th className="p-3 text-center">Status</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {paginatedRecords.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center">
                      <Search className="w-8 h-8 text-slate-300 mb-2" />
                      <p className="text-sm font-medium text-slate-600">No records found</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Try adjusting your search filters or upload a new spreadsheet.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedRecords.map((record) => {
                  const isSelected = selectedIds.has(record.id);

                  return (
                    <tr
                      key={record.id}
                      className={cn(
                        'hover:bg-slate-50/70 transition-colors',
                        isSelected && 'bg-blue-50/40'
                      )}
                    >
                      {/* Checkbox */}
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleSelectRow(record.id)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </td>

                      {/* Company Name & Domain */}
                      <td className="p-3 font-medium text-slate-900">
                        <div className="flex flex-col min-w-[130px]">
                          <span className="font-semibold text-slate-900 truncate">
                            {record.companyName}
                          </span>
                          {record.domain && (
                            <span className="text-[11px] text-slate-500 font-mono truncate">
                              {record.domain}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Decision Maker Name (Editable) */}
                      <td className="p-3">
                        {editingCell?.id === record.id && editingCell.field === 'personName' ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="h-7 px-2 border border-blue-500 rounded text-xs w-36"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEditing();
                                if (e.key === 'Escape') cancelEditing();
                              }}
                            />
                            <button onClick={saveEditing} className="text-emerald-600 hover:text-emerald-700">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={cancelEditing} className="text-slate-400 hover:text-slate-600">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="group flex items-center gap-1.5 min-w-[130px]">
                            <span className="text-slate-800 font-medium truncate">
                              {record.personName || <span className="text-slate-400 italic">Unidentified</span>}
                            </span>
                            <button
                              onClick={() => startEditing(record, 'personName')}
                              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-blue-600 transition-opacity"
                              title="Edit contact name"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </td>

                      {/* Job Title (Editable) */}
                      <td className="p-3">
                        {editingCell?.id === record.id && editingCell.field === 'title' ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="h-7 px-2 border border-blue-500 rounded text-xs w-40"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEditing();
                                if (e.key === 'Escape') cancelEditing();
                              }}
                            />
                            <button onClick={saveEditing} className="text-emerald-600">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={cancelEditing} className="text-slate-400">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="group flex items-center gap-1.5 min-w-[150px]">
                            <span className="text-slate-600 truncate max-w-[170px]" title={record.title}>
                              {record.title || <span className="text-slate-400 italic">Not set</span>}
                            </span>
                            <button
                              onClick={() => startEditing(record, 'title')}
                              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-blue-600 transition-opacity"
                              title="Edit job title"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </td>

                      {/* Contact Info (Email & Phone) */}
                      <td className="p-3">
                        <div className="flex flex-col space-y-1 min-w-[170px]">
                          {record.email ? (
                            <div className="flex items-center gap-1.5">
                              <a
                                href={`mailto:${record.email}`}
                                className="flex items-center gap-1 text-blue-600 hover:underline font-mono text-[11px] truncate max-w-[150px]"
                                title={record.email}
                              >
                                <Mail className="w-3 h-3 shrink-0" />
                                {record.email}
                              </a>
                              <span
                                className={cn(
                                  'text-[9px] font-semibold px-1 py-0.2 rounded border uppercase',
                                  record.emailStatus === 'verified'
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-amber-50 text-amber-700 border-amber-200'
                                )}
                              >
                                {record.emailStatus || 'Probable'}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-400 text-[11px] italic">No email</span>
                          )}

                          {record.phone ? (
                            <div className="flex items-center gap-1 text-slate-600 font-mono text-[11px]">
                              <Phone className="w-3 h-3 shrink-0 text-slate-400" />
                              <a href={`tel:${record.phone}`} className="hover:text-blue-600 hover:underline">
                                {record.phone}
                              </a>
                              {record.phoneType && (
                                <span className="text-[9px] text-slate-400 uppercase">
                                  ({record.phoneType})
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 text-[11px] italic">No phone</span>
                          )}
                        </div>
                      </td>

                      {/* Web & Social Links */}
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          {record.companyWebsite ? (
                            <a
                              href={record.companyWebsite}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1 rounded bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                              title={`Website: ${record.companyWebsite}`}
                            >
                              <Globe className="w-3.5 h-3.5" />
                            </a>
                          ) : null}

                          {record.linkedinUrl ? (
                            <div className="flex items-center gap-1.5">
                              <a
                                href={record.linkedinUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors font-medium text-[11px]"
                                title={`Verified: ${record.linkedinUrl}\nHeadline: ${record.matchedHeadline || ''}\nEvidence: ${record.evidence || ''}`}
                              >
                                <Linkedin className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                                <span className="font-mono text-[10px] truncate max-w-[130px]">
                                  {record.linkedinUrl.replace('https://www.linkedin.com/in/', '')}
                                </span>
                              </a>
                            </div>
                          ) : record.matchStatus ? (
                            <span
                              className="text-[10px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 inline-block truncate max-w-[150px]"
                              title={`Status: ${record.matchStatus}\nEvidence: ${record.evidence || 'None'}`}
                            >
                              {record.matchStatus}
                            </span>
                          ) : null}

                          {record.companyLinkedinUrl ? (
                            <a
                              href={record.companyLinkedinUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors text-[10px] font-bold"
                              title={`Company LinkedIn: ${record.companyLinkedinUrl}`}
                            >
                              Co.
                            </a>
                          ) : null}

                          {record.facebookUrl ? (
                            <a
                              href={record.facebookUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                              title={`Facebook: ${record.facebookUrl}`}
                            >
                              <Facebook className="w-3.5 h-3.5" />
                            </a>
                          ) : null}

                          {record.instagramUrl ? (
                            <a
                              href={record.instagramUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1 rounded bg-pink-50 text-pink-600 hover:bg-pink-100 transition-colors"
                              title={`Instagram: ${record.instagramUrl}`}
                            >
                              <Instagram className="w-3.5 h-3.5" />
                            </a>
                          ) : null}

                          {record.twitterUrl ? (
                            <a
                              href={record.twitterUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1 rounded bg-slate-900 text-white hover:bg-black transition-colors"
                              title={`Twitter/X: ${record.twitterUrl}`}
                            >
                              <span className="text-[10px] font-bold px-0.5">𝕏</span>
                            </a>
                          ) : null}

                          {!record.companyWebsite && !record.linkedinUrl && !record.matchStatus && !record.twitterUrl && !record.facebookUrl && !record.instagramUrl && (
                            <span className="text-slate-400 italic text-[11px]">None</span>
                          )}
                        </div>
                      </td>

                      {/* Confidence Score */}
                      <td className="p-3">
                        {record.confidenceScore !== undefined ? (
                          <div className="flex items-center gap-1.5">
                            <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={cn(
                                  'h-full rounded-full',
                                  record.confidenceScore > 90
                                    ? 'bg-emerald-500'
                                    : record.confidenceScore > 75
                                    ? 'bg-blue-500'
                                    : 'bg-amber-500'
                                )}
                                style={{ width: `${record.confidenceScore}%` }}
                              />
                            </div>
                            <span className="font-semibold text-[11px] text-slate-700">
                              {record.confidenceScore}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">-</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="p-3 text-center">
                        <Badge
                          variant={
                            record.enrichmentStatus === 'enriched'
                              ? 'success'
                              : record.enrichmentStatus === 'processing'
                              ? 'info'
                              : record.enrichmentStatus === 'not_found'
                              ? 'danger'
                              : 'secondary'
                          }
                          size="sm"
                        >
                          {record.enrichmentStatus === 'enriched'
                            ? 'Enriched'
                            : record.enrichmentStatus === 'processing'
                            ? 'Processing'
                            : record.enrichmentStatus === 'not_found'
                            ? 'Not Found'
                            : 'Pending'}
                        </Badge>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 py-3 bg-slate-50/60 border-t border-slate-200 text-xs text-slate-600 gap-3">
          <div className="flex items-center gap-2">
            <span>
              Showing <span className="font-semibold text-slate-800">{paginatedRecords.length}</span> of{' '}
              <span className="font-semibold text-slate-800">{filteredRecords.length}</span> records
              {records.length !== filteredRecords.length && ` (filtered from ${records.length} total)`}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="h-7 px-2 border border-slate-300 rounded bg-white text-xs text-slate-700"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="h-7 px-2.5 text-xs"
              >
                Prev
              </Button>
              <span className="px-2 font-medium">
                {currentPage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="h-7 px-2.5 text-xs"
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
