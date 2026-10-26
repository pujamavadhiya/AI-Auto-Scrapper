import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Users,
  CheckCircle2,
  Download,
  FolderGit2,
  ArrowRight,
  Bot,
  UserCheck,
  Linkedin,
  Mail,
  Globe,
  Share2,
  FileSpreadsheet,
  Cpu,
  Layers,
  Sparkles,
  ExternalLink,
  Search,
  Key,
  ShieldCheck,
  AlertCircle,
  Clock,
  Square,
  Eye,
  RefreshCw,
} from 'lucide-react';
import { StatsCard } from '../components/common/StatsCard';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { useAuth } from '../context/AuthContext';
import { getApiBaseUrl, getAuthHeaders, getAuthToken } from '../config/api';
import { formatDate } from '../lib/utils';
import { excelService } from '../services/excelService';

interface DashboardData {
  user: {
    name: string;
    email: string;
    role: string;
  };
  stats: {
    totalLeads: number;
    totalEnriched: number;
    totalSearches: number;
    keysConfigured: number;
    keysTotal: number;
  };
  keysStatus: {
    serpapi: boolean;
    serper: boolean;
    gemini: boolean;
    leadocean: boolean;
  };
  activeTask: any | null;
  recentHistory: any[];
}

export const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchDashboardStats = async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    try {
      const res = await fetch(`${apiBase}/api/dashboard/stats`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('Error fetching dynamic dashboard stats:', err);
    } finally {
      setIsLoading(false);
      if (showRefresh) setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboardStats();
    // Poll every 8 seconds to keep live tasks and history updated
    const interval = setInterval(() => {
      fetchDashboardStats();
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleStopActiveTask = async (taskId: string) => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    try {
      await fetch(`${apiBase}/api/collector/stop/${taskId}`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      fetchDashboardStats();
    } catch (err) {
      console.error('Error stopping task:', err);
    }
  };

  const handleExportDownload = (historyId: string, format: 'xlsx' | 'csv') => {
    const apiBase = getApiBaseUrl();
    const token = getAuthToken();
    if (!apiBase) return;
    const url = `${apiBase}/api/history/${historyId}/export?format=${format}&token=${token || ''}`;
    window.open(url, '_blank');
  };

  const getModuleBadge = (type: string) => {
    switch (type) {
      case 'keyword-collector':
        return <Badge variant="default" size="sm" className="bg-emerald-600 text-white">Keyword Collector</Badge>;
      case 'decision-maker':
        return <Badge variant="info" size="sm">Decision Maker</Badge>;
      case 'linkedin-finder':
        return <Badge variant="secondary" size="sm">LinkedIn Finder</Badge>;
      case 'contact-finder':
        return <Badge variant="success" size="sm">Email & Phone</Badge>;
      case 'website-finder':
        return <Badge variant="secondary" size="sm">Website Finder</Badge>;
      case 'social-finder':
        return <Badge variant="warning" size="sm">Social Media</Badge>;
      default:
        return <Badge variant="secondary" size="sm">Lead Scraper</Badge>;
    }
  };

  const modules = [
    {
      title: 'Keyword Lead Collector',
      path: '/keyword-collector',
      icon: Search,
      description: 'Scrape verified LinkedIn decision-maker profiles by custom keywords, location, and data limits without paid APIs.',
      badge: 'Free / Live',
      color: 'text-emerald-600',
      bg: 'bg-emerald-50 border-emerald-100',
    },
    {
      title: 'Decision Maker Finder',
      path: '/decision-maker',
      icon: UserCheck,
      description: 'Pinpoints C-level executives, VPs, and Department Heads for target organizations.',
      badge: 'Core People Intel',
      color: 'text-blue-600',
      bg: 'bg-blue-50 border-blue-100',
    },
    {
      title: 'LinkedIn URL Finder',
      path: '/linkedin-finder',
      icon: Linkedin,
      description: 'Discovers verified personal profiles and official corporate company pages.',
      badge: 'Profile Resolution',
      color: 'text-indigo-600',
      bg: 'bg-indigo-50 border-indigo-100',
    },
    {
      title: 'Decision Maker Email & Phone',
      path: '/contact-finder',
      icon: Mail,
      description: 'Discovers business emails, runs deliverability checks, and extracts direct dials.',
      badge: 'Direct Outreach',
      color: 'text-emerald-600',
      bg: 'bg-emerald-50 border-emerald-100',
    },
    {
      title: 'Company Website Finder',
      path: '/website-finder',
      icon: Globe,
      description: 'Finds canonical corporate websites, root domains, and verifies official brands.',
      badge: 'Domain Intel',
      color: 'text-sky-600',
      bg: 'bg-sky-50 border-sky-100',
    },
    {
      title: 'Social Media URL Finder',
      path: '/social-finder',
      icon: Share2,
      description: 'Aggregates brand profiles across Twitter/X, GitHub, Facebook, and Crunchbase.',
      badge: 'Brand Footprint',
      color: 'text-purple-600',
      bg: 'bg-purple-50 border-purple-100',
    },
  ];

  return (
    <div className="space-y-8">
      {/* Hero Personalized Spotlight Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-900 p-6 md:p-8 text-white shadow-lg shadow-blue-500/10">
        <div className="relative z-10 max-w-2xl space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-xs font-semibold text-blue-200">
            <Sparkles className="w-3.5 h-3.5 text-blue-300 animate-pulse" />
            <span>AI-Driven Lead Intelligence Engine</span>
          </div>

          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">
            Welcome back, {data?.user?.name || user?.name || user?.email?.split('@')[0] || 'Prospector'}!
          </h2>
          <p className="text-sm md:text-base text-blue-100/90 leading-relaxed">
            Your personalized B2B intelligence hub. Search and extract decision makers, enrich corporate profiles, and audit data with Google Gemini AI.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link to="/keyword-collector">
              <Button variant="secondary" className="bg-white text-blue-900 hover:bg-blue-50 font-semibold text-xs h-9 shadow-xs">
                <Search className="w-4 h-4 text-emerald-600 mr-2" />
                Start Keyword Search
              </Button>
            </Link>
            <Link to="/ai-assistant">
              <Button variant="outline" className="border-white/30 text-white hover:bg-white/10 text-xs h-9">
                <Bot className="w-4 h-4 mr-2 text-indigo-300" />
                AI Research Assistant
              </Button>
            </Link>
            <Link to="/export-history">
              <Button variant="ghost" className="text-blue-200 hover:text-white hover:bg-white/10 text-xs h-9">
                <FileSpreadsheet className="w-4 h-4 mr-2 text-blue-300" />
                View Saved History ({data?.stats?.totalSearches ?? 0})
              </Button>
            </Link>
          </div>
        </div>

        {/* Decorative backdrop elements */}
        <div className="absolute -right-10 -bottom-10 w-80 h-80 rounded-full bg-blue-500/20 blur-3xl pointer-events-none" />
        <div className="absolute right-12 top-6 hidden lg:flex items-center justify-center w-36 h-36 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl rotate-6">
          <Cpu className="w-16 h-16 text-blue-300/40" />
        </div>
      </div>

      {/* Active Background Task Widget (if running) */}
      {data?.activeTask && (
        <div className="p-5 rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="relative flex h-3 w-3 mt-1.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-600"></span>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-slate-900 text-sm">Background Search in Progress</h4>
                <Badge variant="default" size="sm" className="bg-blue-600 text-white animate-pulse">
                  Live Crawler
                </Badge>
              </div>
              <p className="text-xs text-slate-600">
                Query: <span className="font-semibold text-slate-900">{data.activeTask.searchQuery || data.activeTask.latestQuery || 'Keyword Scraper'}</span>
              </p>
              <p className="text-[11px] text-slate-500">
                Status: {data.activeTask.progressMessage || 'Collecting leads...'} ({data.activeTask.totalCollected} / {data.activeTask.target} target leads)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link to="/keyword-collector">
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs">
                <Eye className="w-3.5 h-3.5 mr-1.5" />
                View Live Crawler
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleStopActiveTask(data.activeTask.taskId)}
              className="border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold"
            >
              <Square className="w-3.5 h-3.5 mr-1.5 text-rose-600 fill-rose-600" />
              Stop & Finalize
            </Button>
          </div>
        </div>
      )}

      {/* Real Metric Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Target Leads"
          value={data?.stats?.totalLeads ?? 0}
          subtitle="Extracted across your searches"
          icon={Users}
          iconColor="text-blue-600"
          iconBg="bg-blue-50 border-blue-100"
        />

        <StatsCard
          title="Verified & Enriched"
          value={data?.stats?.totalEnriched ?? 0}
          subtitle="Enriched with Gemini AI & LinkedIn"
          icon={CheckCircle2}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50 border-emerald-100"
        />

        <StatsCard
          title="Extraction Batches"
          value={data?.stats?.totalSearches ?? 0}
          subtitle="Archived in your private database"
          icon={FolderGit2}
          iconColor="text-indigo-600"
          iconBg="bg-indigo-50 border-indigo-100"
        />

        <StatsCard
          title="API Keys Configured"
          value={`${data?.stats?.keysConfigured ?? 0} of 4 Active`}
          subtitle="SerpApi, Serper, Gemini, LeadOcean"
          icon={Key}
          iconColor="text-sky-600"
          iconBg="bg-sky-50 border-sky-100"
        />
      </div>

      {/* Two Column Section: Real Recent User Extractions & API Vault Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Real User Search History (2 Columns) */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="h-full flex flex-col justify-between">
            <CardHeader className="p-5 border-b border-slate-100 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <span>Your Recent Extraction History</span>
                  <Badge variant="secondary" size="sm">
                    {data?.stats?.totalSearches ?? 0} Saved
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  Real searches and lead datasets extracted by your account
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fetchDashboardStats(true)}
                  disabled={isRefreshing}
                  className="h-7 px-2 text-xs text-slate-500 hover:text-slate-800"
                  title="Refresh stats"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
                </Button>
                <Link to="/export-history">
                  <Button variant="ghost" size="sm" className="text-xs text-blue-600 hover:text-blue-700 font-semibold">
                    View All History &rarr;
                  </Button>
                </Link>
              </div>
            </CardHeader>

            <CardContent className="p-0 flex-1">
              {!data?.recentHistory || data.recentHistory.length === 0 ? (
                <div className="p-8 text-center space-y-3">
                  <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                    <Search className="w-5 h-5" />
                  </div>
                  <h4 className="text-xs font-bold text-slate-700">No extractions recorded yet</h4>
                  <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                    Run your first search in Keyword Lead Collector or Decision Maker Finder. Extracted leads will be archived here permanently.
                  </p>
                  <Link to="/keyword-collector">
                    <Button size="sm" className="text-xs mt-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold">
                      Launch Keyword Scraper
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 text-xs">
                  {data.recentHistory.slice(0, 5).map((item) => (
                    <div
                      key={item.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
                    >
                      <div className="space-y-1 min-w-0 pr-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-900 truncate">
                            {item.searchQuery}
                          </span>
                          {getModuleBadge(item.moduleType)}
                          <span className="font-semibold text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                            {item.recordCount} leads
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-400" />
                            {formatDate(item.createdAt)}
                          </span>
                          <span>•</span>
                          <span>Status: <span className="capitalize font-medium text-slate-700">{item.status}</span></span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <Link to="/export-history">
                          <Button variant="outline" size="sm" className="h-7 text-xs px-2.5">
                            <Eye className="w-3 h-3 mr-1 text-slate-500" />
                            View
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleExportDownload(item.id, 'xlsx')}
                          className="h-7 text-xs px-2 text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 font-semibold"
                          title="Download Excel"
                        >
                          XLSX
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleExportDownload(item.id, 'csv')}
                          className="h-7 text-xs px-2 text-blue-700 hover:text-blue-800 hover:bg-blue-50 font-semibold"
                          title="Download CSV"
                        >
                          CSV
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* API Vault & Engine Status Card (1 Column) */}
        <div className="space-y-4">
          <Card className="h-full flex flex-col justify-between">
            <CardHeader className="p-5 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-600" />
                  <span>Platform API Vault</span>
                </CardTitle>
                <Link to="/settings">
                  <Button variant="ghost" size="sm" className="text-xs text-blue-600 hover:text-blue-700 font-semibold">
                    Manage &rarr;
                  </Button>
                </Link>
              </div>
              <CardDescription className="text-xs">
                Your account's isolated API keys
              </CardDescription>
            </CardHeader>

            <CardContent className="p-5 space-y-3.5 flex-1">
              {/* SerpApi */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs">
                <div>
                  <div className="font-bold text-slate-800">SerpAPI</div>
                  <div className="text-[10px] text-slate-500">Google decision maker discovery</div>
                </div>
                <Badge variant={data?.keysStatus?.serpapi ? 'success' : 'secondary'} size="sm">
                  {data?.keysStatus?.serpapi ? 'Connected' : 'Unconfigured'}
                </Badge>
              </div>

              {/* Google Gemini */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs">
                <div>
                  <div className="font-bold text-slate-800 flex items-center gap-1.5">
                    <span>Google Gemini AI</span>
                    <Sparkles className="w-3 h-3 text-indigo-500" />
                  </div>
                  <div className="text-[10px] text-slate-500">Data cleaning & AI Assistant</div>
                </div>
                <Badge variant={data?.keysStatus?.gemini ? 'success' : 'secondary'} size="sm">
                  {data?.keysStatus?.gemini ? 'Connected' : 'Unconfigured'}
                </Badge>
              </div>

              {/* Serper.dev */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs">
                <div>
                  <div className="font-bold text-slate-800">Serper.dev</div>
                  <div className="text-[10px] text-slate-500">Fast alternate Google search</div>
                </div>
                <Badge variant={data?.keysStatus?.serper ? 'success' : 'secondary'} size="sm">
                  {data?.keysStatus?.serper ? 'Connected' : 'Unconfigured'}
                </Badge>
              </div>

              {/* LeadOcean */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs">
                <div>
                  <div className="font-bold text-slate-800">LeadOcean</div>
                  <div className="text-[10px] text-slate-500">Email & direct dial finder</div>
                </div>
                <Badge variant={data?.keysStatus?.leadocean ? 'success' : 'secondary'} size="sm">
                  {data?.keysStatus?.leadocean ? 'Connected' : 'Unconfigured'}
                </Badge>
              </div>

              <div className="pt-2">
                <Link to="/settings" className="block">
                  <Button variant="outline" size="sm" className="w-full text-xs font-semibold justify-between">
                    <span>Configure Keys in Settings</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Specialized Research Modules Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900 tracking-tight">
              Research & Scraping Modules
            </h3>
            <p className="text-xs text-slate-500">
              Each module operates via an isolated Service Adapter with per-user data isolation.
            </p>
          </div>
          <Badge variant="secondary" className="font-mono text-[11px]">
            6 Intelligence Workspaces
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {modules.map((mod) => (
            <Card key={mod.path} className="flex flex-col justify-between hover:border-blue-300 hover:shadow-md transition-all group">
              <CardHeader className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className={`p-3 rounded-xl border ${mod.bg} ${mod.color}`}>
                    <mod.icon className="w-5 h-5" />
                  </div>
                  <Badge variant="default" size="sm" className="text-[10px]">
                    {mod.badge}
                  </Badge>
                </div>
                <CardTitle className="text-base group-hover:text-blue-600 transition-colors">
                  {mod.title}
                </CardTitle>
                <CardDescription className="text-xs mt-1 leading-relaxed">
                  {mod.description}
                </CardDescription>
              </CardHeader>

              <CardContent className="p-5 pt-0">
                <Link to={mod.path} className="block">
                  <Button variant="outline" size="sm" className="w-full text-xs font-semibold justify-between group-hover:bg-blue-50 group-hover:text-blue-700 group-hover:border-blue-200">
                    <span>Open Module Workspace</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}

          {/* AI Assistant Card in Grid */}
          <Card className="flex flex-col justify-between border-dashed border-indigo-200 bg-gradient-to-b from-indigo-50/40 to-white hover:border-indigo-400 hover:shadow-md transition-all group">
            <CardHeader className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="p-3 rounded-xl border bg-indigo-50 border-indigo-100 text-indigo-600">
                  <Bot className="w-5 h-5" />
                </div>
                <Badge variant="info" size="sm" className="text-[10px]">
                  Google Gemini Powered
                </Badge>
              </div>
              <CardTitle className="text-base group-hover:text-indigo-600 transition-colors">
                AI Research Assistant
              </CardTitle>
              <CardDescription className="text-xs mt-1 leading-relaxed">
                Direct Gemini AI research assistant to search prospective accounts, map executive hierarchies, and formulate personalized outreach strategies.
              </CardDescription>
            </CardHeader>

            <CardContent className="p-5 pt-0">
              <Link to="/ai-assistant" className="block">
                <Button variant="primary" size="sm" className="w-full text-xs font-semibold justify-between bg-indigo-600 hover:bg-indigo-700">
                  <span>Chat with Assistant</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};
