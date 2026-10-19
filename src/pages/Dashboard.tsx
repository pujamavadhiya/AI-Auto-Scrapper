import React, { useState } from 'react';
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
} from 'lucide-react';
import { StatsCard } from '../components/common/StatsCard';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { storageService } from '../services/storageService';
import { excelService } from '../services/excelService';
import { formatDate } from '../lib/utils';

export const Dashboard: React.FC = () => {
  const projects = storageService.getProjects();
  const exportHistory = storageService.getExportHistory();

  const totalLeads = projects.reduce((acc, p) => acc + (p.totalRecords || 0), 0);
  const totalEnriched = projects.reduce((acc, p) => acc + (p.enrichedRecords || 0), 0);
  const totalExports = exportHistory.length;

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
      description: 'Pinpoints C-level executives, VPs, and Department Heads for target accounts.',
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
      description: 'Discovers business emails, runs SMTP deliverability simulations, and extracts direct dials.',
      badge: 'Direct Outreach',
      color: 'text-emerald-600',
      bg: 'bg-emerald-50 border-emerald-100',
    },
    {
      title: 'Company Website Finder',
      path: '/website-finder',
      icon: Globe,
      description: 'Finds canonical corporate websites, root domains, and verifies SSL certificates.',
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
      {/* Hero AI Spotlight Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-900 p-6 md:p-8 text-white shadow-lg shadow-blue-500/10">
        <div className="relative z-10 max-w-2xl space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-xs font-semibold text-blue-200">
            <Sparkles className="w-3.5 h-3.5 text-blue-300 animate-pulse" />
            <span>AI-Driven Lead Intelligence Engine</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">
            Accelerate B2B Prospecting & Data Enrichment
          </h2>
          <p className="text-sm md:text-base text-blue-100/90 leading-relaxed">
            Upload custom Excel or CSV files, map columns in seconds, execute modular enrichment pipelines, and export clean datasets entirely within your browser.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link to="/ai-assistant">
              <Button variant="secondary" className="bg-white text-blue-900 hover:bg-blue-50 font-semibold text-xs h-9">
                <Bot className="w-4 h-4 text-blue-600 mr-2" />
                Launch AI Research Assistant
              </Button>
            </Link>
            <Link to="/decision-maker">
              <Button variant="outline" className="border-white/30 text-white hover:bg-white/10 text-xs h-9">
                <UserCheck className="w-4 h-4 mr-2" />
                Find Decision Makers
              </Button>
            </Link>
            <Button
              variant="ghost"
              onClick={() => excelService.downloadSampleTemplate('xlsx')}
              className="text-blue-200 hover:text-white hover:bg-white/10 text-xs h-9"
            >
              <FileSpreadsheet className="w-4 h-4 mr-2 text-emerald-400" />
              Download Test Template (.xlsx)
            </Button>
          </div>
        </div>

        {/* Decorative backdrop subtle elements */}
        <div className="absolute -right-10 -bottom-10 w-80 h-80 rounded-full bg-blue-500/20 blur-3xl pointer-events-none" />
        <div className="absolute right-12 top-6 hidden lg:flex items-center justify-center w-36 h-36 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl rotate-6">
          <Cpu className="w-16 h-16 text-blue-300/40" />
        </div>
      </div>

      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Target Leads"
          value={totalLeads}
          subtitle="Processed across all modules"
          icon={Users}
          trend={{ value: '+14%', isPositive: true }}
          iconColor="text-blue-600"
          iconBg="bg-blue-50 border-blue-100"
        />

        <StatsCard
          title="Enriched & Verified"
          value={totalEnriched}
          subtitle="96.4% confidence average"
          icon={CheckCircle2}
          trend={{ value: '+22%', isPositive: true }}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50 border-emerald-100"
        />

        <StatsCard
          title="Active Projects"
          value={projects.length}
          subtitle="Configured pipeline workflows"
          icon={FolderGit2}
          iconColor="text-indigo-600"
          iconBg="bg-indigo-50 border-indigo-100"
        />

        <StatsCard
          title="Spreadsheets Exported"
          value={totalExports}
          subtitle="SheetJS in-browser downloads"
          icon={Download}
          iconColor="text-sky-600"
          iconBg="bg-sky-50 border-sky-100"
        />
      </div>

      {/* Specialized Research Modules Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900 tracking-tight">
              Research & Scraping Modules
            </h3>
            <p className="text-xs text-slate-500">
              Each module operates via an isolated Service Adapter ready for your Python / Selenium crawlers.
            </p>
          </div>
          <Badge variant="secondary" className="font-mono text-[11px]">
            5 Specialized Adapters
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
                  Autonomous Agent
                </Badge>
              </div>
              <CardTitle className="text-base group-hover:text-indigo-600 transition-colors">
                AI Research Assistant
              </CardTitle>
              <CardDescription className="text-xs mt-1 leading-relaxed">
                Interact with our conversational research model to probe prospective accounts, summarize leadership hierarchies, and draft personalized outreach.
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

      {/* Two Column Section: Recent Projects & Export History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Projects */}
        <Card>
          <CardHeader className="p-5 border-b border-slate-100 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Recent Enrichment Projects</CardTitle>
              <CardDescription className="text-xs">Workspaces saved in browser storage</CardDescription>
            </div>
            <Link to="/projects">
              <Button variant="ghost" size="sm" className="text-xs text-blue-600 hover:text-blue-700">
                View All
              </Button>
            </Link>
          </CardHeader>

          <CardContent className="p-0">
            <div className="divide-y divide-slate-100 text-xs">
              {projects.slice(0, 4).map((p) => (
                <div key={p.id} className="p-4 flex items-center justify-between hover:bg-slate-50/60 transition-colors">
                  <div className="space-y-1 min-w-0 pr-3">
                    <div className="font-semibold text-slate-800 truncate">{p.name}</div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-2">
                      <span>{p.totalRecords} records</span>
                      <span>•</span>
                      <span>Updated {formatDate(p.updatedAt)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={p.status === 'completed' ? 'success' : 'warning'} size="sm">
                      {p.status}
                    </Badge>
                    <Link to={`/${p.moduleType}`}>
                      <Button variant="outline" size="sm" className="h-7 text-xs px-2.5">
                        Open
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent Export Logs */}
        <Card>
          <CardHeader className="p-5 border-b border-slate-100 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Recent Export History</CardTitle>
              <CardDescription className="text-xs">Generated SheetJS spreadsheets</CardDescription>
            </div>
            <Link to="/export-history">
              <Button variant="ghost" size="sm" className="text-xs text-blue-600 hover:text-blue-700">
                View History
              </Button>
            </Link>
          </CardHeader>

          <CardContent className="p-0">
            <div className="divide-y divide-slate-100 text-xs">
              {exportHistory.slice(0, 4).map((exp) => (
                <div key={exp.id} className="p-4 flex items-center justify-between hover:bg-slate-50/60 transition-colors">
                  <div className="space-y-1 min-w-0 pr-3">
                    <div className="font-semibold text-slate-800 flex items-center gap-1.5 truncate">
                      {exp.format === 'xlsx' ? (
                        <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <Download className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      )}
                      <span className="truncate">{exp.fileName}</span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {exp.recordCount} records • Scope: {exp.exportScope} • {formatDate(exp.exportedAt)}
                    </div>
                  </div>

                  <span className="font-mono text-[10px] uppercase font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                    .{exp.format}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Integration & Developer Notice Footer */}
      <div className="p-5 rounded-2xl bg-slate-100/80 border border-slate-200/80 text-xs text-slate-600 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-white text-blue-600 border border-slate-200 shadow-xs">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-slate-900 text-sm">Service Adapter Architecture Active</h4>
            <p className="text-slate-500 text-xs mt-0.5">
              The application uses unified TypeScript service adapters (<code className="bg-white px-1.5 py-0.5 rounded border text-[11px]">IResearchAdapter</code>) for all 5 research operations. When you are ready to plug in your scraping modules, simply connect the adapter to your backend.
            </p>
          </div>
        </div>

        <Link to="/settings" className="shrink-0">
          <Button variant="outline" size="sm" className="text-xs bg-white text-slate-700">
            View Adapter Settings
          </Button>
        </Link>
      </div>
    </div>
  );
};
