import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import {
  Menu,
  Sparkles,
  Zap,
  HelpCircle,
  FileSpreadsheet,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { excelService } from '../../services/excelService';

interface HeaderProps {
  onToggleMobileMenu: () => void;
  isSidebarCollapsed: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleMobileMenu,
  isSidebarCollapsed,
}) => {
  const location = useLocation();

  const getPageTitle = (pathname: string): { title: string; subtitle: string } => {
    switch (pathname) {
      case '/':
        return { title: 'Dashboard', subtitle: 'Overview of enrichment pipelines, active projects & intelligence metrics' };
      case '/ai-assistant':
        return { title: 'AI Research Assistant', subtitle: 'Autonomous conversational agent for B2B intelligence and company profiling' };
      case '/decision-maker':
        return { title: 'Decision Maker Finder', subtitle: 'Extract C-suite, VPs, and executive stakeholders for target organizations' };
      case '/linkedin-finder':
        return { title: 'LinkedIn URL Finder', subtitle: 'Discover verified personal profiles and official corporate pages' };
      case '/contact-finder':
        return { title: 'Email & Phone Finder', subtitle: 'Find deliverable business emails and direct dial phone numbers' };
      case '/website-finder':
        return { title: 'Company Website Finder', subtitle: 'Canonical website resolution, root domains and brand verification' };
      case '/social-finder':
        return { title: 'Social Media URL Finder', subtitle: 'Identify brand footprint across Twitter/X, GitHub, Crunchbase, & Facebook' };
      case '/projects':
        return { title: 'All Projects', subtitle: 'Manage, re-run, and organize batch research workflows' };
      case '/export-history':
        return { title: 'Export History', subtitle: 'Review and re-download generated browser-side Excel & CSV spreadsheets' };
      case '/settings':
        return { title: 'Platform Settings', subtitle: 'Configure simulation speed, adapter integrations, and export preferences' };
      default:
        return { title: 'AI Auto Scrapper Platform', subtitle: 'Enterprise B2B Data Enrichment Suite' };
    }
  };

  const { title, subtitle } = getPageTitle(location.pathname);

  const handleDownloadSample = () => {
    excelService.downloadSampleTemplate('xlsx');
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 md:px-8 bg-white/90 backdrop-blur-md border-b border-slate-200/80 transition-all">
      {/* Left: Mobile hamburger & breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onToggleMobileMenu}
          className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100"
          aria-label="Toggle mobile menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex flex-col truncate">
          <div className="flex items-center gap-2">
            <h1 className="text-base md:text-lg font-bold text-slate-900 tracking-tight truncate">
              {title}
            </h1>
            <Badge variant="secondary" size="sm" className="hidden sm:inline-flex text-[10px] font-medium text-slate-500">
              Mock Service Active
            </Badge>
          </div>
          <p className="hidden md:block text-xs text-slate-500 truncate">{subtitle}</p>
        </div>
      </div>

      {/* Right: Quick actions & status */}
      <div className="flex items-center gap-2 md:gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownloadSample}
          className="hidden sm:inline-flex text-xs h-8 font-medium text-slate-700 hover:text-blue-600"
          title="Download ready-to-test sample spreadsheet (.xlsx)"
        >
          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 mr-1.5" />
          Sample Template
        </Button>

        <div className="hidden xl:flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200/60 text-xs text-emerald-700 font-medium">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Browser SheetJS Ready</span>
        </div>

        <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
          <Link
            to="/ai-assistant"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-semibold shadow-xs hover:from-blue-700 hover:to-indigo-700 transition-all"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Ask AI</span>
          </Link>
        </div>
      </div>
    </header>
  );
};
