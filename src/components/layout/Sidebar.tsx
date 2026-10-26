import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Bot,
  UserCheck,
  Linkedin,
  Mail,
  Globe,
  Share2,
  FolderGit2,
  Download,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  ShieldCheck,
  Search,
  LogOut,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/Badge';
import { useAuth } from '../../context/AuthContext';

interface SidebarProps {
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  isMobileOpen: boolean;
  setIsMobileOpen: (open: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isCollapsed,
  setIsCollapsed,
  isMobileOpen,
  setIsMobileOpen,
}) => {
  const { user, logout } = useAuth();
  const primaryNav = [
    {
      title: 'Dashboard',
      path: '/',
      icon: LayoutDashboard,
      badge: null,
    },
    {
      title: 'AI Research Assistant',
      path: '/ai-assistant',
      icon: Bot,
      badge: 'GPT-4o',
      badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    },
  ];

  const enrichmentModules = [
    {
      title: 'Keyword Lead Collector',
      path: '/keyword-collector',
      icon: Search,
      badge: 'Free / Live',
    },
    {
      title: 'Decision Maker Finder',
      path: '/decision-maker',
      icon: UserCheck,
      badge: 'Core',
    },
    {
      title: 'LinkedIn URL Finder',
      path: '/linkedin-finder',
      icon: Linkedin,
      badge: null,
    },
    {
      title: 'Email & Phone Finder',
      path: '/contact-finder',
      icon: Mail,
      badge: 'Direct',
    },
    {
      title: 'Company Website Finder',
      path: '/website-finder',
      icon: Globe,
      badge: null,
    },
    {
      title: 'Social Media Finder',
      path: '/social-finder',
      icon: Share2,
      badge: null,
    },
  ];

  const workspaceNav = [
    {
      title: 'All Projects',
      path: '/projects',
      icon: FolderGit2,
      badge: null,
    },
    {
      title: 'Export History',
      path: '/export-history',
      icon: Download,
      badge: null,
    },
    {
      title: 'Settings',
      path: '/settings',
      icon: SettingsIcon,
      badge: null,
    },
  ];

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm lg:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar container */}
      <aside
        className={cn(
          'fixed top-0 bottom-0 left-0 z-40 flex flex-col bg-white border-r border-slate-200/80 transition-all duration-300 shadow-sm',
          isCollapsed ? 'w-20' : 'w-72',
          isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Logo / Header */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-slate-100">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-sky-500 text-white shadow-md shadow-blue-500/20 shrink-0">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            {!isCollapsed && (
              <div className="flex flex-col min-w-0">
                <span className="font-bold text-base tracking-tight text-slate-900 flex items-center gap-1.5">
                  AI Auto Scrapper
                </span>
                <span className="text-[11px] text-slate-400 font-medium truncate">
                  B2B Intelligence Suite
                </span>
              </div>
            )}
          </div>

          {/* Desktop collapse toggle */}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="hidden lg:flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Scrollable Navigation Area */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {/* Main / Assistant */}
          <div>
            {!isCollapsed && (
              <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Overview & AI
              </p>
            )}
            <nav className="space-y-1">
              {primaryNav.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsMobileOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                      isActive
                        ? 'bg-blue-50/80 text-blue-700 font-semibold shadow-xs'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                      isCollapsed && 'justify-center px-0'
                    )
                  }
                  title={isCollapsed ? item.title : undefined}
                >
                  <item.icon className="w-5 h-5 shrink-0 transition-colors text-slate-500 group-hover:text-blue-600 group-[.active]:text-blue-600" />
                  {!isCollapsed && (
                    <div className="flex items-center justify-between flex-1 truncate">
                      <span className="truncate">{item.title}</span>
                      {item.badge && (
                        <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded border', item.badgeColor || 'bg-slate-100 text-slate-600 border-slate-200')}>
                          {item.badge}
                        </span>
                      )}
                    </div>
                  )}
                </NavLink>
              ))}
            </nav>
          </div>

          {/* Research Modules */}
          <div>
            {!isCollapsed && (
              <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Enrichment Modules
              </p>
            )}
            <nav className="space-y-1">
              {enrichmentModules.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsMobileOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                      isActive
                        ? 'bg-blue-50/80 text-blue-700 font-semibold shadow-xs'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                      isCollapsed && 'justify-center px-0'
                    )
                  }
                  title={isCollapsed ? item.title : undefined}
                >
                  <item.icon className="w-5 h-5 shrink-0 transition-colors text-slate-500 group-hover:text-blue-600 group-[.active]:text-blue-600" />
                  {!isCollapsed && (
                    <div className="flex items-center justify-between flex-1 truncate">
                      <span className="truncate">{item.title}</span>
                      {item.badge && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200/60">
                          {item.badge}
                        </span>
                      )}
                    </div>
                  )}
                </NavLink>
              ))}
            </nav>
          </div>

          {/* Workspace Management */}
          <div>
            {!isCollapsed && (
              <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Data & Workspace
              </p>
            )}
            <nav className="space-y-1">
              {workspaceNav.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsMobileOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                      isActive
                        ? 'bg-blue-50/80 text-blue-700 font-semibold shadow-xs'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                      isCollapsed && 'justify-center px-0'
                    )
                  }
                  title={isCollapsed ? item.title : undefined}
                >
                  <item.icon className="w-5 h-5 shrink-0 transition-colors text-slate-500 group-hover:text-blue-600 group-[.active]:text-blue-600" />
                  {!isCollapsed && <span className="truncate">{item.title}</span>}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>

        {/* User Account & Logout Footer */}
        {!isCollapsed ? (
          <div className="p-3 m-3 rounded-xl bg-slate-900 text-white text-xs border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
                  {user?.email ? user.email.charAt(0).toUpperCase() : 'U'}
                </div>
                <div className="min-w-0 truncate">
                  <p className="font-semibold text-white truncate text-[11px] leading-tight">
                    {user?.name || user?.email?.split('@')[0] || 'User'}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate leading-tight">
                    {user?.email || 'Authenticated'}
                  </p>
                </div>
              </div>
              <button
                onClick={async () => {
                  if (confirm('Log out of account?')) {
                    await logout();
                    window.location.href = '/login';
                  }
                }}
                title="Log out"
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Isolated Keys
              </span>
              <NavLink to="/settings" className="text-blue-400 hover:underline">
                Configure Keys
              </NavLink>
            </div>
          </div>
        ) : (
          <div className="p-3 flex flex-col items-center gap-2 border-t border-slate-100">
            <div
              className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-xs"
              title={user?.email || 'Logged In'}
            >
              {user?.email ? user.email.charAt(0).toUpperCase() : 'U'}
            </div>
            <button
              onClick={async () => {
                if (confirm('Log out?')) {
                  await logout();
                  window.location.href = '/login';
                }
              }}
              title="Log out"
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </aside>
    </>
  );
};
