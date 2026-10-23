import React, { useState, useRef, useEffect } from 'react';
import {
  Mail,
  UploadCloud,
  RotateCcw,
  Plus,
  Play,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ExternalLink,
  Phone,
  ShieldCheck,
  Search,
  Sparkles,
  Sliders,
  Copy,
  Check,
  FileSpreadsheet,
  Globe,
  Linkedin,
} from 'lucide-react';
import { ModuleHeader } from '../components/common/ModuleHeader';
import { FileUploader } from '../components/common/FileUploader';
import { ColumnMapper } from '../components/common/ColumnMapper';
import { DataTable } from '../components/common/DataTable';
import { ProgressIndicator } from '../components/common/ProgressIndicator';
import { ExportModal } from '../components/common/ExportModal';
import { Button } from '../components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EnrichmentRecord, ResearchConfig, ResearchProgress, ColumnMapping } from '../types';
import { ParsedFileResult } from '../services/excelService';
import { contactFinderService } from '../services/adapters';
import { getSampleInitialRecords } from '../services/mockData';
import { storageService } from '../services/storageService';
import { getApiBaseUrl } from '../config/api';

export const ContactFinder: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'table' | 'quick' | 'bulk' | 'upload' | 'config'>('table');
  const [records, setRecords] = useState<EnrichmentRecord[]>(() => {
    // Start with a clean list or sample
    return getSampleInitialRecords().map((r) => ({
      ...r,
      customFields: {
        ...(r.customFields || {}),
        Email: r.email || '',
        Phone: r.phone || '',
        'Enrich Status': r.email || r.phone ? 'found' : 'no_data',
      },
    }));
  });
  const [parsedFile, setParsedFile] = useState<ParsedFileResult | null>(null);

  // Quick single form input state
  const [quickForm, setQuickForm] = useState({
    name: '',
    linkedin: '',
    company: '',
    website: '',
  });

  // Bulk paste text state
  const [bulkPasteText, setBulkPasteText] = useState('');

  // LeadOcean server config state
  const [serverConfig, setServerConfig] = useState<{
    hasApiKey: boolean;
    keyPreview: string;
    url: string;
    authName: string;
    engine: string;
  }>({
    hasApiKey: false,
    keyPreview: 'checking...',
    url: 'https://api.leadocean.io/v1/people/enrich',
    authName: 'x-api-key',
    engine: 'LeadOcean Email & Phone Enricher',
  });

  // Config tab form
  const [configForm, setConfigForm] = useState({
    apiKey: '',
    url: 'https://api.leadocean.io/v1/people/enrich',
    authName: 'x-api-key',
  });
  const [configSaveNotice, setConfigSaveNotice] = useState<string | null>(null);

  // Copied indicator state
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [config, setConfig] = useState<ResearchConfig>({
    verifyEmails: true,
    findDirectPhones: true,
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

  // Query backend LeadOcean config on mount
  const refreshServerConfig = async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    try {
      const res = await fetch(`${apiBase}/api/leadocean/config`);
      if (res.ok) {
        const data = await res.json();
        setServerConfig({
          hasApiKey: !!data.hasApiKey,
          keyPreview: data.keyPreview || 'missing',
          url: data.url || 'https://api.leadocean.io/v1/people/enrich',
          authName: data.authName || 'x-api-key',
          engine: data.engine || 'LeadOcean Email & Phone Enricher',
        });
        setConfigForm({
          apiKey: '',
          url: data.url || 'https://api.leadocean.io/v1/people/enrich',
          authName: data.authName || 'x-api-key',
        });
      }
    } catch (e) {
      console.warn('Could not query LeadOcean config:', e);
    }
  };

  useEffect(() => {
    refreshServerConfig();
  }, []);

  const handleSaveConfig = async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    try {
      const res = await fetch(`${apiBase}/api/leadocean/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: configForm.apiKey.trim() || undefined,
          url: configForm.url.trim() || undefined,
          authName: configForm.authName.trim() || undefined,
        }),
      });
      if (res.ok) {
        setConfigSaveNotice('LeadOcean settings updated successfully!');
        await refreshServerConfig();
        setTimeout(() => setConfigSaveNotice(null), 3000);
      }
    } catch (e: any) {
      alert(`Failed to save config: ${e.message}`);
    }
  };

  const handleFileParsed = (parsed: ParsedFileResult) => {
    setParsedFile(parsed);
  };

  const handleMappingConfirmed = (newRecords: EnrichmentRecord[], _mapping: ColumnMapping) => {
    const normalized = newRecords.map((r) => {
      // 1. Extract LinkedIn profile URL (most critical for LeadOcean)
      let li = r.linkedinUrl || '';
      if (!li && r.customFields) {
        for (const [k, v] of Object.entries(r.customFields)) {
          const lk = k.toLowerCase();
          const sv = String(v || '').trim();
          if (
            (lk.includes('linkedin') || lk.includes('profile')) &&
            sv.includes('linkedin.com/in/')
          ) {
            li = sv;
            break;
          }
        }
      }
      if (!li && r.customFields) {
        for (const [k, v] of Object.entries(r.customFields)) {
          const sv = String(v || '').trim();
          if (sv.includes('linkedin.com/in/')) {
            li = sv;
            break;
          }
        }
      }
      if (!li) {
        li =
          r.customFields?.['Decision Maker LinkedIn URL'] ||
          r.customFields?.['Decision Maker Linkedin URL'] ||
          r.customFields?.['Decision Maker LinkedIn'] ||
          r.customFields?.['Decision Maker Linkedin'] ||
          r.customFields?.['LinkedIn URL'] ||
          r.customFields?.['Linkedin URL'] ||
          r.customFields?.['LinkedIn Profile'] ||
          r.customFields?.['Profile URL'] ||
          r.customFields?.['linkedin'] ||
          '';
      }

      // Normalize LinkedIn URL format
      const mLi = String(li || '').match(/linkedin\.com\/in\/([^/?#\s]+)/i);
      const cleanLi = mLi ? `https://www.linkedin.com/in/${mLi[1]}` : (li ? String(li).trim() : '');

      // 2. Extract Company Name & Website
      let comp =
        r.companyName ||
        r.customFields?.['Company Name / Domain'] ||
        r.customFields?.['Company / Domain'] ||
        r.customFields?.['Company Name'] ||
        r.customFields?.['Company'] ||
        r.customFields?.['Name'] ||
        '';

      let web =
        r.companyWebsite ||
        r.domain ||
        r.customFields?.['Website'] ||
        r.customFields?.['Domain'] ||
        r.customFields?.['Company URL'] ||
        '';

      // If 'Company Name / Domain' combined header was used:
      if (!web && r.customFields?.['Company Name / Domain']) {
        const rawCompDomain = String(r.customFields['Company Name / Domain']);
        if (rawCompDomain.includes('.') && !rawCompDomain.includes(' ')) {
          web = rawCompDomain;
        } else if (rawCompDomain.includes('/') || rawCompDomain.includes('|')) {
          const parts = rawCompDomain.split(/[/|]/).map((p) => p.trim());
          comp = parts[0] || comp;
          web = parts[1] || web;
        }
      }

      // 3. Extract Decision Maker Name
      const name =
        r.personName ||
        r.customFields?.['Decision Maker Name'] ||
        r.customFields?.['decision maker name'] ||
        r.customFields?.['Contact Name'] ||
        r.customFields?.['Full Name'] ||
        r.customFields?.['Person Name'] ||
        r.customFields?.['name'] ||
        '';

      return {
        ...r,
        companyName: comp,
        companyWebsite: web,
        domain: web ? web.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : r.domain,
        personName: name,
        linkedinUrl: cleanLi,
        enrichmentStatus: 'idle' as const,
        customFields: {
          ...(r.customFields || {}),
          'Decision Maker Name': name,
          'Decision Maker Linkedin': cleanLi,
          'Decision Maker LinkedIn URL': cleanLi,
          'Company Name': comp,
          Email: r.email || r.customFields?.['Email'] || '',
          Phone: r.phone || r.customFields?.['Phone'] || '',
          'Enrich Status': 'idle',
        },
      };
    });

    setRecords(normalized);
    setParsedFile(null);
    setActiveTab('table');

    storageService.saveProject({
      id: `proj-${Date.now()}`,
      name: `LeadOcean Enrichment (${new Date().toLocaleDateString()})`,
      description: 'Uploaded via LeadOcean Email & Phone Finder',
      moduleType: 'contact-finder',
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

  // Add single lead from quick form
  const handleAddQuickLead = async (andEnrich: boolean = true) => {
    if (!quickForm.name && !quickForm.linkedin && !quickForm.company) {
      alert('Please provide at least a Decision Maker Name or LinkedIn URL.');
      return;
    }

    const domain = quickForm.website
      ? quickForm.website.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]
      : '';

    const newRecord: EnrichmentRecord = {
      id: `rec-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      companyName: quickForm.company.trim() || 'Company',
      companyWebsite: quickForm.website.trim(),
      domain,
      personName: quickForm.name.trim(),
      linkedinUrl: quickForm.linkedin.trim(),
      enrichmentStatus: 'idle',
      customFields: {
        'Decision Maker Name': quickForm.name.trim(),
        'Decision Maker Linkedin': quickForm.linkedin.trim(),
        Website: quickForm.website.trim(),
        Company: quickForm.company.trim(),
        Email: '',
        Phone: '',
        'Enrich Status': 'idle',
      },
    };

    setRecords((prev) => [newRecord, ...prev]);
    setQuickForm({ name: '', linkedin: '', company: '', website: '' });
    setActiveTab('table');

    if (andEnrich) {
      setTimeout(() => {
        handleStartEnrichment([newRecord.id]);
      }, 100);
    }
  };

  // Bulk paste parser
  const handleProcessBulkPaste = () => {
    if (!bulkPasteText.trim()) return;

    const lines = bulkPasteText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const parsedRecords: EnrichmentRecord[] = lines.map((line, idx) => {
      const parts = line.split(/[,\t|]/).map((p) => p.trim());
      // Try to intelligently detect company vs name vs linkedin vs website
      let comp = parts[0] || '';
      let name = parts[1] || '';
      let li = '';
      let site = '';

      for (const p of parts) {
        if (p.includes('linkedin.com/in/')) {
          li = p;
        } else if (p.startsWith('http://') || p.startsWith('https://') || p.includes('.com') || p.includes('.io') || p.includes('.co')) {
          if (!p.includes('linkedin.com')) site = p;
        }
      }

      if (!li && parts[2]?.includes('linkedin.com')) li = parts[2];
      if (!site && (parts[3] || parts[2])) site = parts[3] || (!parts[2]?.includes('linkedin.com') ? parts[2] : '');

      const domain = site ? site.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : '';

      return {
        id: `rec-bulk-${Date.now()}-${idx}`,
        companyName: comp || 'Company',
        companyWebsite: site,
        domain,
        personName: name,
        linkedinUrl: li,
        enrichmentStatus: 'idle',
        customFields: {
          'Decision Maker Name': name,
          'Decision Maker Linkedin': li,
          Company: comp,
          Website: site,
          Email: '',
          Phone: '',
          'Enrich Status': 'idle',
        },
      };
    });

    setRecords((prev) => [...parsedRecords, ...prev]);
    setBulkPasteText('');
    setActiveTab('table');
  };

  const handleStartEnrichment = async (subsetIds?: string[]) => {
    const targets = subsetIds
      ? records.filter((r) => subsetIds.includes(r.id))
      : records;

    if (targets.length === 0) return;

    abortControllerRef.current = new AbortController();

    try {
      const enrichedBatch = await contactFinderService.enrichBatch(
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
          stageMessage: 'LeadOcean enrichment cancelled.',
        }));
      } else {
        alert(`LeadOcean enrichment error: ${err.message}`);
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

  const copyToClipboard = (text: string, id: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const pendingCount = records.filter(
    (r) => !r.email && !r.phone && r.enrichmentStatus !== 'enriched'
  ).length;

  return (
    <div className="space-y-6">
      <ModuleHeader
        title={contactFinderService.metadata.name}
        badge={contactFinderService.metadata.badge}
        description={contactFinderService.metadata.description}
        icon={Mail}
        inputRequirements={contactFinderService.metadata.inputRequirements}
        outputFields={contactFinderService.metadata.outputFields}
        integrationNote={contactFinderService.metadata.integrationNote}
        onRunEnrichment={() => handleStartEnrichment()}
        isRunning={progress.isActive}
        totalRecordsCount={records.length}
      />

      {/* LeadOcean Configuration Status Banner */}
      <div className="p-4 rounded-xl border bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
        <div className="flex items-start sm:items-center gap-3">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
              serverConfig.hasApiKey ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
            }`}
          >
            {serverConfig.hasApiKey ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-white">LeadOcean Enrichment Engine</span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                  serverConfig.hasApiKey
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                }`}
              >
                {serverConfig.hasApiKey ? 'API Key Active' : 'Key Missing'}
              </span>
            </div>
            <div className="text-xs text-slate-300 mt-0.5 flex flex-wrap items-center gap-3 font-mono">
              <span>
                Endpoint: <span className="text-emerald-300">{serverConfig.url}</span>
              </span>
              <span>
                Key:{' '}
                <span className="text-slate-400">
                  {serverConfig.hasApiKey ? serverConfig.keyPreview : 'None (Set LEADOCEAN_API_KEY)'}
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!serverConfig.hasApiKey && (
            <button
              type="button"
              onClick={() => setActiveTab('config')}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-all shadow-xs"
            >
              Configure API Key
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveTab('config')}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-all flex items-center gap-1.5"
          >
            <Sliders className="w-3.5 h-3.5" />
            Config
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
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
            Leads Table ({records.length})
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
            Single Lead Lookup
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('bulk')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'bulk'
                ? 'bg-blue-50 text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Bulk Paste
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
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'config'
                ? 'bg-blue-50 text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            LeadOcean Settings
          </button>
        </div>

        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <Button
              size="sm"
              onClick={() => handleStartEnrichment()}
              disabled={progress.isActive}
              className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Play className="w-3.5 h-3.5 mr-1" />
              Enrich {pendingCount} Pending Leads
            </Button>
          )}

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
            Reset Samples
          </Button>
        </div>
      </div>

      <ProgressIndicator
        progress={progress}
        onCancel={handleCancelEnrichment}
        moduleName={contactFinderService.metadata.name}
      />

      {/* TAB 1: Single Lead Quick Lookup */}
      {activeTab === 'quick' && (
        <Card className="border-emerald-200 shadow-xs">
          <CardHeader className="p-5 border-b border-slate-100 bg-emerald-50/40">
            <div className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-emerald-600" />
              <div>
                <CardTitle className="text-base text-slate-900">
                  Direct Decision Maker Email & Phone Lookup
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Enter a prospect's details to query LeadOcean for verified email address and direct phone.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  Decision Maker Name *
                </label>
                <input
                  type="text"
                  value={quickForm.name}
                  onChange={(e) => setQuickForm({ ...quickForm, name: e.target.value })}
                  placeholder="e.g. Feruz Khasanov"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  Decision Maker LinkedIn URL
                </label>
                <input
                  type="text"
                  value={quickForm.linkedin}
                  onChange={(e) => setQuickForm({ ...quickForm, linkedin: e.target.value })}
                  placeholder="https://www.linkedin.com/in/feruz-khasanov..."
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  Company Name
                </label>
                <input
                  type="text"
                  value={quickForm.company}
                  onChange={(e) => setQuickForm({ ...quickForm, company: e.target.value })}
                  placeholder="e.g. Sevencore"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  Company Website / Domain
                </label>
                <input
                  type="text"
                  value={quickForm.website}
                  onChange={(e) => setQuickForm({ ...quickForm, website: e.target.value })}
                  placeholder="https://sevencore.com"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAddQuickLead(false)}
                className="text-xs"
              >
                Add to Table Only
              </Button>
              <Button
                size="sm"
                onClick={() => handleAddQuickLead(true)}
                className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Search className="w-3.5 h-3.5 mr-1.5" />
                Find Email & Phone Now
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* TAB 2: Bulk Paste */}
      {activeTab === 'bulk' && (
        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="p-5 border-b border-slate-100">
            <CardTitle className="text-base text-slate-900">Bulk Paste Decision Makers</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Paste rows with Company, Name, LinkedIn URL, Website separated by commas, tabs, or pipes.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <textarea
              rows={6}
              value={bulkPasteText}
              onChange={(e) => setBulkPasteText(e.target.value)}
              placeholder={`Stripe, Patrick Collison, https://www.linkedin.com/in/patrickcollison, https://stripe.com\nZapier, Wade Foster, https://www.linkedin.com/in/wadefoster, https://zapier.com\nSevencore, Feruz Khasanov, https://www.linkedin.com/in/feruz-khasanov-102aa8397, https://sevencore.com`}
              className="w-full p-3 font-mono text-xs rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-slate-500">
                Format: <code className="bg-slate-100 px-1 py-0.5 rounded">Company, Name, LinkedIn, Website</code>
              </span>
              <Button
                size="sm"
                onClick={handleProcessBulkPaste}
                disabled={!bulkPasteText.trim()}
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white"
              >
                Parse and Add to Table
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* TAB 3: File Upload */}
      {activeTab === 'upload' && (
        <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-6">
          {!parsedFile ? (
            <div className="max-w-2xl mx-auto space-y-4">
              <div className="text-center space-y-1">
                <h3 className="text-base font-bold text-slate-900">
                  Upload Leads Sheet for LeadOcean Enrichment
                </h3>
                <p className="text-xs text-slate-500">
                  Supports CSV, XLSX with columns: <strong>company name</strong>, <strong>website</strong>,{' '}
                  <strong>decision maker name</strong>, <strong>decision maker linkedin url</strong>.
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

      {/* TAB 4: LeadOcean Settings */}
      {activeTab === 'config' && (
        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="p-5 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Sliders className="w-5 h-5 text-emerald-600" />
              <div>
                <CardTitle className="text-base text-slate-900">LeadOcean Provider Settings</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Configure API endpoint, authentication header, and request payload schema.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-5 space-y-4">
            {configSaveNotice && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                {configSaveNotice}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-800">
                  LeadOcean API Key
                </label>
                <input
                  type="password"
                  value={configForm.apiKey}
                  onChange={(e) => setConfigForm({ ...configForm, apiKey: e.target.value })}
                  placeholder={serverConfig.hasApiKey ? `Current: ${serverConfig.keyPreview}` : 'Enter LeadOcean API key'}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20"
                />
                <p className="text-[11px] text-slate-500">
                  Stored securely in your backend <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">.env</code>.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-800">
                  API Endpoint URL
                </label>
                <input
                  type="text"
                  value={configForm.url}
                  onChange={(e) => setConfigForm({ ...configForm, url: e.target.value })}
                  placeholder="https://api.leadocean.io/v1/people/enrich"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20"
                />
                <p className="text-[11px] text-slate-500">
                  Default: <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">https://api.leadocean.io/v1/people/enrich</code>
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-800">
                  Authentication Header Name
                </label>
                <input
                  type="text"
                  value={configForm.authName}
                  onChange={(e) => setConfigForm({ ...configForm, authName: e.target.value })}
                  placeholder="x-api-key"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20"
                />
                <p className="text-[11px] text-slate-500">
                  Usually <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">x-api-key</code> or <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">Authorization</code>
                </p>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <Button
                size="sm"
                onClick={handleSaveConfig}
                className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                Save LeadOcean Settings
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* TAB 5: Leads Table View */}
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
        moduleType="contact-finder"
        projectName="LeadOcean_Enriched_Contacts"
      />
    </div>
  );
};
