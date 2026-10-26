import React, { useState, useEffect } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import {
  Menu,
  Sparkles,
  Zap,
  HelpCircle,
  FileSpreadsheet,
  CheckCircle2,
  LogOut,
  User as UserIcon,
  Loader2,
  Square,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { excelService } from '../../services/excelService';
import { useAuth } from '../../context/AuthContext';
import { getApiBaseUrl, getAuthHeaders } from '../../config/api';

interface HeaderProps {
  onToggleMobileMenu: () => void;
  isSidebarCollapsed: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleMobileMenu,
  isSidebarCollapsed,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

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

  const [activeTask, setActiveTask] = useState<{
    taskId: string;
    status: string;
    totalCollected: number;
    target: number;
    searchQuery?: string;
  } | null>(null);

  // Poll for background scraping activity across the application
  useEffect(() => {
    let mounted = true;
    const checkActive = async () => {
      if (!user) {
        if (mounted) setActiveTask(null);
        return;
      }
      const apiBase = getApiBaseUrl();
      if (!apiBase) return;
      try {
        const res = await fetch(`${apiBase}/api/collector/active`, {
          headers: getAuthHeaders(),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        if (data.hasActiveTask && data.task && (data.task.status === 'running' || data.task.status === 'stopping')) {
          setActiveTask(data.task);
        } else {
          setActiveTask(null);
        }
      } catch {
        if (mounted) setActiveTask(null);
      }
    };

    checkActive();
    const interval = setInterval(checkActive, 3000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [user]);

  const handleHeaderStop = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!activeTask?.taskId) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    try {
      await fetch(`${apiBase}/api/collector/stop/${activeTask.taskId}`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      setActiveTask(null);
    } catch (err) {
      console.error('Stop error from header:', err);
    }
  };

  const handleDownloadSample = () => {
    excelService.downloadSampleTemplate('xlsx');
  };

  const handleLogout = async () => {
    if (confirm('Are you sure you want to log out?')) {
      await logout();
      navigate('/login');
    }
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
              Active Session
            </Badge>
          </div>
          <p className="hidden md:block text-xs text-slate-500 truncate">{subtitle}</p>
        </div>
      </div>

      {/* Right: Quick actions, background scraper indicator, user profile & logout */}
      <div className="flex items-center gap-2 md:gap-3">
        {/* Persistent Background Scraping Indicator */}
        {activeTask && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-xs text-blue-900 shadow-xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600"></span>
            </span>
            <span className="hidden sm:inline font-medium text-blue-800">
              Background Scraping:
            </span>
            <span className="font-bold text-blue-950">
              {activeTask.totalCollected}/{activeTask.target} leads
            </span>
            <Link
              to="/keyword-collector"
              className="text-blue-700 hover:text-blue-900 font-semibold underline text-[11px] ml-0.5"
            >
              View
            </Link>
            <button
              onClick={handleHeaderStop}
              className="text-rose-600 hover:text-rose-800 font-semibold text-[11px] hover:underline cursor-pointer ml-1"
              title="Stop scraping now"
            >
              Stop
            </button>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={handleDownloadSample}
          className="hidden lg:inline-flex text-xs h-8 font-medium text-slate-700 hover:text-blue-600"
          title="Download ready-to-test sample spreadsheet (.xlsx)"
        >
          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 mr-1.5" />
          Sample Template
        </Button>

        {user && (
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200/70 text-xs">
            <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-[10px]">
              {user.email.charAt(0).toUpperCase()}
            </div>
            <span className="font-semibold text-slate-800 truncate max-w-[140px] md:max-w-[180px]">
              {user.email}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
          <Link
            to="/ai-assistant"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-semibold shadow-xs hover:from-blue-700 hover:to-indigo-700 transition-all"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Ask AI</span>
          </Link>

          <button
            onClick={handleLogout}
            title="Log out of application"
            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-all cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
