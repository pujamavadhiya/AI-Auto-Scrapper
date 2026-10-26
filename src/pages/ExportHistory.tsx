import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
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
  Eye,
  X,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Building2,
  Mail,
  Phone,
  Linkedin,
  Filter,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { historyService } from '../services/historyService';
import { SearchHistorySummary, SearchHistoryDetail } from '../types/history';
import { formatDate } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import { EnrichmentRecord } from '../types';

export const ExportHistory: React.FC = () => {
  const { user } = useAuth();
  const [history, setHistory] = useState<SearchHistorySummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Modal inspection state
  const [activeItemDetail, setActiveItemDetail] = useState<SearchHistoryDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);
  const [modalSearchTerm, setModalSearchTerm] = useState('');

  const loadHistory = async () => {
    setIsLoading(true);
    try {
      const items = await historyService.fetchHistory();
      setHistory(items);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const filteredHistory = history.filter((item) => {
    const matchesSearch =
      !searchTerm ||
      item.searchQuery.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.moduleType.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesModule = moduleFilter === 'all' || item.moduleType === moduleFilter;

    return matchesSearch && matchesModule;
  });

  const handleDownload = async (item: SearchHistorySummary, format: 'xlsx' | 'csv') => {
    try {
      const cleanName = item.searchQuery.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
      await historyService.downloadHistoryFile(item.id, format, `${cleanName}_${item.id.slice(-6)}`);
      setStatusNotice(`Downloaded "${item.searchQuery}" (${format.toUpperCase()})`);
      setTimeout(() => setStatusNotice(null), 3000);
    } catch (err: any) {
      alert(`Download failed: ${err.message}`);
    }
  };

  const handleOpenDetail = async (item: SearchHistorySummary) => {
    setIsLoadingDetail(true);
    try {
      const detail = await historyService.fetchHistoryItem(item.id);
      setActiveItemDetail(detail);
      setModalSearchTerm('');
    } catch (err: any) {
      alert(`Could not open search details: ${err.message}`);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Delete search history record "${name}"?`)) {
      const ok = await historyService.deleteHistoryItem(id);
      if (ok) {
        setHistory((prev) => prev.filter((h) => h.id !== id));
        if (activeItemDetail?.id === id) {
          setActiveItemDetail(null);
        }
      }
    }
  };

  const handleClearAll = async () => {
    if (confirm(`Are you sure you want to clear your entire extraction history archive?`)) {
      const ok = await historyService.clearHistory();
      if (ok) {
        setHistory([]);
        setActiveItemDetail(null);
      }
    }
  };

  const getModuleBadge = (type: string) => {
    switch (type) {
      case 'decision-maker':
        return <Badge variant="default" className="text-[10px]">Decision Maker Finder</Badge>;
      case 'keyword-collector':
        return <Badge variant="info" className="text-[10px]">Keyword Collector</Badge>;
      case 'linkedin-finder':
        return <Badge variant="secondary" className="text-[10px]">LinkedIn URL Finder</Badge>;
      case 'contact-finder':
        return <Badge variant="success" className="text-[10px]">Email & Phone Finder</Badge>;
      case 'social-finder':
        return <Badge variant="warning" className="text-[10px]">Social Media Finder</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px]">{type}</Badge>;
    }
  };

  // Filter records within the preview modal
  const filteredModalRecords = (activeItemDetail?.records || []).filter((r: any) => {
    if (!modalSearchTerm) return true;
    const q = modalSearchTerm.toLowerCase();
    const name = (r.personName || r['Full name'] || r.name || '').toLowerCase();
    const comp = (r.companyName || r['Company name'] || r.company || '').toLowerCase();
    const title = (r.title || r['Decision maker title'] || '').toLowerCase();
    const email = (r.email || r.Email || '').toLowerCase();
    return name.includes(q) || comp.includes(q) || title.includes(q) || email.includes(q);
  });

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Extraction & Search History</h2>
            <Badge variant="secondary" size="sm">
              {history.length} Extractions Stored
            </Badge>
          </div>
          <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            Private archive for <span className="font-semibold text-slate-700">{user?.email}</span>. Past searches and extracted leads remain saved permanently for your account.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={loadHistory}
            disabled={isLoading}
            className="text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 text-blue-600 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {history.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearAll}
              className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 hover:border-rose-200"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              Clear Archive
            </Button>
          )}
        </div>
      </div>

      {statusNotice && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{statusNotice}</span>
        </div>
      )}

      {/* Filter toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by keywords, company name, or file..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs rounded-lg border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>

        {/* Module Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          {[
            { id: 'all', label: 'All Modules' },
            { id: 'decision-maker', label: 'Decision Maker' },
            { id: 'keyword-collector', label: 'Keyword Collector' },
            { id: 'linkedin-finder', label: 'LinkedIn Finder' },
            { id: 'contact-finder', label: 'Email & Phone' },
            { id: 'social-finder', label: 'Social Media' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setModuleFilter(tab.id)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                moduleFilter === tab.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* History Items List */}
      {isLoading ? (
        <div className="py-20 text-center space-y-3">
          <div className="w-8 h-8 mx-auto border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-slate-500 font-medium">Loading your extraction history...</p>
        </div>
      ) : filteredHistory.length === 0 ? (
        <div className="text-center py-16 px-4 bg-white rounded-2xl border border-slate-200/80 space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
            <Layers className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-800">
            {searchTerm || moduleFilter !== 'all' ? 'No matching extraction history found' : 'No extractions saved yet'}
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Whenever you run an extraction or lead discovery in any of the 5 modules, your search queries and extracted records will automatically be archived here for future access.
          </p>
          <div className="pt-2 flex items-center justify-center gap-2">
            <Link to="/decision-maker">
              <Button size="sm" className="text-xs bg-blue-600 hover:bg-blue-700 text-white">
                Launch Decision Maker Finder
              </Button>
            </Link>
            <Link to="/keyword-collector">
              <Button size="sm" variant="outline" className="text-xs">
                Keyword Lead Collector
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredHistory.map((item) => (
            <div
              key={item.id}
              className="bg-white rounded-xl border border-slate-200/80 p-4 shadow-xs hover:border-blue-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
            >
              <div className="space-y-1.5 min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-sm text-slate-900 group-hover:text-blue-600 transition-colors truncate">
                    {item.searchQuery}
                  </span>
                  {getModuleBadge(item.moduleType)}
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    {item.recordCount} {item.recordCount === 1 ? 'Lead' : 'Leads'} Extracted
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-slate-400" />
                    {formatDate(item.createdAt)}
                  </span>
                  <span>•</span>
                  <span>
                    Verified: <span className="font-semibold text-slate-700">{item.enrichedCount}</span>
                  </span>
                  <span>•</span>
                  <span className="capitalize font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                    ID: {item.id.slice(-8)}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleOpenDetail(item)}
                  className="text-xs h-8 text-blue-600 border-blue-200 hover:bg-blue-50 cursor-pointer"
                  title="Inspect all extracted leads in a table"
                >
                  <Eye className="w-3.5 h-3.5 mr-1.5" />
                  View Leads
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDownload(item, 'xlsx')}
                  className="text-xs h-8 text-emerald-700 border-emerald-200 hover:bg-emerald-50 cursor-pointer"
                  title="Download formatted Excel spreadsheet"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                  Excel
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDownload(item, 'csv')}
                  className="text-xs h-8 text-slate-700 border-slate-200 hover:bg-slate-50 cursor-pointer"
                  title="Download CSV file"
                >
                  <FileText className="w-3.5 h-3.5 mr-1 text-slate-500" />
                  CSV
                </Button>

                <button
                  onClick={() => handleDelete(item.id, item.searchQuery)}
                  className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                  title="Delete from history"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: View Extracted Leads Detail */}
      {activeItemDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900 tracking-tight">
                    {activeItemDetail.searchQuery}
                  </h3>
                  {getModuleBadge(activeItemDetail.moduleType)}
                </div>
                <p className="text-xs text-slate-500">
                  {activeItemDetail.recordCount} total extracted leads • Saved on {formatDate(activeItemDetail.createdAt)}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => handleDownload(activeItemDetail, 'xlsx')}
                  className="text-xs h-8 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />
                  Export Excel
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDownload(activeItemDetail, 'csv')}
                  className="text-xs h-8"
                >
                  <FileText className="w-3.5 h-3.5 mr-1.5" />
                  Export CSV
                </Button>
                <button
                  onClick={() => setActiveItemDetail(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/60 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Filter */}
            <div className="p-3 border-b border-slate-100 bg-white">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter within these extracted leads (Name, Company, Title, Email)..."
                  value={modalSearchTerm}
                  onChange={(e) => setModalSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>

            {/* Modal Table Content */}
            <div className="flex-1 overflow-auto p-4">
              {filteredModalRecords.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  No matching leads found for "{modalSearchTerm}".
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                        <th className="p-3">#</th>
                        <th className="p-3">Company</th>
                        <th className="p-3">Executive / Person</th>
                        <th className="p-3">Position / Title</th>
                        <th className="p-3">LinkedIn URL</th>
                        <th className="p-3">Email & Phone</th>
                        <th className="p-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                      {filteredModalRecords.map((r: any, idx: number) => {
                        const name = r.personName || r['Full name'] || r.name || r['Decision maker name'] || '—';
                        const comp = r.companyName || r['Company name'] || r.company || r['Company'] || '—';
                        const title = r.title || r['Decision maker title'] || r['Designation'] || '—';
                        const liUrl = r.linkedinUrl || r['Profile URL'] || r['Decision Maker Linkedin'] || r.companyLinkedinUrl || '';
                        const email = r.email || r['Email'] || '';
                        const phone = r.phone || r['Phone'] || '';

                        return (
                          <tr key={idx} className="hover:bg-blue-50/40 transition-colors">
                            <td className="p-3 text-slate-400 font-sans">{idx + 1}</td>
                            <td className="p-3 font-semibold text-slate-900 font-sans">
                              {comp}
                            </td>
                            <td className="p-3 font-semibold text-blue-700 font-sans">
                              {name}
                            </td>
                            <td className="p-3 text-slate-600 font-sans">
                              {title}
                            </td>
                            <td className="p-3 max-w-[200px] truncate">
                              {liUrl ? (
                                <a
                                  href={liUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-blue-600 hover:underline flex items-center gap-1 truncate"
                                >
                                  <Linkedin className="w-3.5 h-3.5 shrink-0 text-blue-700" />
                                  <span className="truncate">{liUrl}</span>
                                </a>
                              ) : (
                                <span className="text-slate-400 font-sans">—</span>
                              )}
                            </td>
                            <td className="p-3 space-y-0.5">
                              {email ? (
                                <div className="flex items-center gap-1 text-slate-700">
                                  <Mail className="w-3 h-3 text-emerald-600" />
                                  <span>{email}</span>
                                </div>
                              ) : null}
                              {phone ? (
                                <div className="flex items-center gap-1 text-slate-700">
                                  <Phone className="w-3 h-3 text-blue-600" />
                                  <span>{phone}</span>
                                </div>
                              ) : null}
                              {!email && !phone && (
                                <span className="text-slate-400 font-sans">—</span>
                              )}
                            </td>
                            <td className="p-3">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-sans font-semibold bg-emerald-100 text-emerald-800">
                                Extracted
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 text-right">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActiveItemDetail(null)}
                className="text-xs"
              >
                Close Preview
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
