import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  Sliders,
  Code2,
  FileSpreadsheet,
  Trash2,
  CheckCircle2,
  Cpu,
  Layers,
  HelpCircle,
  ShieldCheck,
  Zap,
  Server,
  Globe,
  Activity,
  Wifi,
  WifiOff,
  ExternalLink,
  Sparkles,
  Key,
  Users,
  UserPlus,
  KeyRound,
  Shield,
  X,
  Lock,
  RefreshCw,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { storageService } from '../services/storageService';
import { AppSettings } from '../types';
import { getApiBaseUrl } from '../config/api';
import { useAuth } from '../context/AuthContext';
import { authService } from '../services/authService';

export const Settings: React.FC = () => {
  const { user, keys: authKeys, updateKeys } = useAuth();
  const [settings, setSettings] = useState<AppSettings>(() => storageService.getSettings());
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  // User Management State (No Shell Access Required)
  const [teamUsers, setTeamUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [isCreateUserModalOpen, setIsCreateUserModalOpen] = useState(false);
  const [newUserData, setNewUserData] = useState({ email: '', password: '', name: '', role: 'user' });
  const [userActionError, setUserActionError] = useState<string | null>(null);
  const [userActionSuccess, setUserActionSuccess] = useState<string | null>(null);
  const [passwordModalUser, setPasswordModalUser] = useState<string | null>(null);
  const [newPasswordValue, setNewPasswordValue] = useState('');

  // Synchronize initial settings if auth keys arrived
  useEffect(() => {
    if (authKeys && Object.keys(authKeys).length > 0) {
      setSettings((prev) => ({
        ...prev,
        serpApiKey: authKeys.serpapi_key || prev.serpApiKey,
        serperApiKey: authKeys.serper_key || prev.serperApiKey,
        geminiApiKey: authKeys.gemini_api_key || prev.geminiApiKey,
        leadoceanApiKey: authKeys.leadocean_api_key || prev.leadoceanApiKey,
        leadoceanEndpoint: authKeys.leadocean_endpoint || prev.leadoceanEndpoint,
        defaultDecisionMakerEngine: authKeys.default_engine || prev.defaultDecisionMakerEngine,
      }));
    }
  }, [authKeys]);

  // Backend connection state
  const [backendEndpoint, setBackendEndpoint] = useState<string>(
    settings.customScraperEndpoint || (typeof window !== 'undefined' && window.location.hostname === 'localhost' ? 'http://127.0.0.1:8000' : '')
  );
  const [testState, setTestState] = useState<{
    status: 'idle' | 'testing' | 'online' | 'offline';
    message: string;
  }>({
    status: 'idle',
    message: '',
  });

  const loadTeamUsers = async () => {
    setLoadingUsers(true);
    try {
      const list = await authService.listUsers();
      setTeamUsers(list);
    } catch (e: any) {
      console.warn('Could not load team users:', e);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    loadTeamUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserActionError(null);
    setUserActionSuccess(null);
    try {
      await authService.createUser(newUserData);
      setUserActionSuccess(`User "${newUserData.email}" created successfully!`);
      setIsCreateUserModalOpen(false);
      setNewUserData({ email: '', password: '', name: '', role: 'user' });
      loadTeamUsers();
    } catch (err: any) {
      setUserActionError(err.message || 'Failed to create user.');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordModalUser || !newPasswordValue) return;
    setUserActionError(null);
    setUserActionSuccess(null);
    try {
      await authService.changeUserPassword({ email: passwordModalUser, password: newPasswordValue });
      setUserActionSuccess(`Password for "${passwordModalUser}" updated successfully!`);
      setPasswordModalUser(null);
      setNewPasswordValue('');
      loadTeamUsers();
    } catch (err: any) {
      setUserActionError(err.message || 'Failed to update password.');
    }
  };

  const handleDeleteUser = async (emailToDelete: string) => {
    if (!confirm(`Are you sure you want to delete account "${emailToDelete}"?`)) return;
    setUserActionError(null);
    setUserActionSuccess(null);
    try {
      await authService.deleteUser(emailToDelete);
      setUserActionSuccess(`User "${emailToDelete}" deleted.`);
      loadTeamUsers();
    } catch (err: any) {
      setUserActionError(err.message || 'Failed to delete user.');
    }
  };

  const handleUpdate = async (updated: Partial<AppSettings>) => {
    const next = storageService.saveSettings(updated);
    setSettings(next);

    // Sync to backend per-user private keys
    const backendKeys: Record<string, string> = {};
    if (updated.serpApiKey !== undefined) backendKeys.serpapiKey = updated.serpApiKey;
    if (updated.serperApiKey !== undefined) backendKeys.serperKey = updated.serperApiKey;
    if (updated.geminiApiKey !== undefined) backendKeys.geminiApiKey = updated.geminiApiKey;
    if (updated.leadoceanApiKey !== undefined) backendKeys.leadoceanApiKey = updated.leadoceanApiKey;
    if (updated.leadoceanEndpoint !== undefined) backendKeys.leadoceanEndpoint = updated.leadoceanEndpoint;
    if (updated.defaultDecisionMakerEngine !== undefined) backendKeys.defaultEngine = updated.defaultDecisionMakerEngine;

    if (Object.keys(backendKeys).length > 0) {
      await updateKeys(backendKeys);
    }

    setSaveNotice('Settings and API keys saved to your account!');
    setTimeout(() => setSaveNotice(null), 2500);
  };

  const handleTestBackend = async () => {
    const target = backendEndpoint.trim().replace(/\/+$/, '');
    if (!target) {
      setTestState({
        status: 'offline',
        message: 'Please enter a valid backend URL (e.g. https://your-backend.onrender.com or http://127.0.0.1:8000).',
      });
      return;
    }

    setTestState({ status: 'testing', message: 'Pinging backend health endpoint...' });

    try {
      const startTime = Date.now();
      const res = await fetch(`${target}/api/health`, { method: 'GET' });
      const latency = Date.now() - startTime;

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setTestState({
          status: 'online',
          message: `Backend Online! Connected successfully (${latency}ms latency). Engine: ${data.engine || 'FastAPI'}`,
        });
        // Auto-save the working endpoint
        handleUpdate({ customScraperEndpoint: target });
      } else {
        setTestState({
          status: 'offline',
          message: `Server returned HTTP ${res.status}. Check your backend server logs.`,
        });
      }
    } catch (err: any) {
      setTestState({
        status: 'offline',
        message: `Failed to connect: ${err.message}. If deploying to Vercel, deploy your Python backend on Render/Railway with HTTPS.`,
      });
    }
  };

  const handleSaveEndpoint = () => {
    handleUpdate({ customScraperEndpoint: backendEndpoint.trim() });
  };

  const handleResetData = () => {
    if (confirm('Are you sure you want to reset all projects, exports, and local storage state back to defaults?')) {
      storageService.resetAllData();
      window.location.reload();
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Title */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Platform & Adapter Settings</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure backend crawler endpoints, research latency, and export formats.
          </p>
        </div>
        <Badge variant="default" className="text-xs">
          Modular Architecture
        </Badge>
      </div>

      {saveNotice && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{saveNotice}</span>
        </div>
      )}

      {/* Authenticated User Account Card */}
      {user && (
        <Card className="border-indigo-200 bg-gradient-to-r from-indigo-50/50 via-white to-blue-50/30 shadow-xs">
          <CardHeader className="p-5 border-b border-indigo-100/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
                  {user.email.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base text-slate-900 font-bold">
                      {user.name || user.email.split('@')[0]}
                    </CardTitle>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 text-indigo-800">
                      Private Key Vault Active
                    </span>
                  </div>
                  <CardDescription className="text-xs text-slate-600">
                    Logged in as <span className="font-mono font-medium text-slate-800">{user.email}</span>
                  </CardDescription>
                </div>
              </div>
              <Badge variant="outline" className="text-xs border-indigo-200 text-indigo-700 font-medium">
                Isolated Profile
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-4 text-xs text-slate-600 bg-white/70 space-y-1">
            <p className="flex items-center gap-1.5 font-medium text-slate-700">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              API Key Privacy Guarantee:
            </p>
            <p className="text-[11px] text-slate-500 leading-relaxed pl-5">
              All keys entered below (SerpAPI, Serper.dev, Google Gemini, and LeadOcean) are stored securely in your private user profile in the backend database. Other users cannot access or view your keys, and saving changes here will not overwrite another user's configuration.
            </p>
          </CardContent>
        </Card>
      )}

      {/* 0. Cloud & Vercel Backend Server Configuration */}
      <Card className="border-blue-200 shadow-xs">
        <CardHeader className="p-5 border-b border-slate-100 bg-blue-50/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="w-5 h-5 text-blue-600" />
              <div>
                <CardTitle className="text-base text-slate-900">Python Backend Server (Cloud & Vercel)</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Connect your deployed FastAPI backend server to power live multi-threaded scraping.
                </CardDescription>
              </div>
            </div>
            {testState.status === 'online' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                <Wifi className="w-3.5 h-3.5 text-emerald-600" />
                Online
              </span>
            )}
            {testState.status === 'offline' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800">
                <WifiOff className="w-3.5 h-3.5 text-rose-600" />
                Offline
              </span>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-800">
              Backend API Server URL
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={backendEndpoint}
                onChange={(e) => setBackendEndpoint(e.target.value)}
                placeholder="https://ai-auto-scrapper-backend.onrender.com or http://127.0.0.1:8000"
                className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleTestBackend}
                  disabled={testState.status === 'testing'}
                  className="text-xs whitespace-nowrap"
                >
                  <Activity className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
                  {testState.status === 'testing' ? 'Testing...' : 'Test Connection'}
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveEndpoint}
                  className="text-xs bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap"
                >
                  Save URL
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Active endpoint resolved by frontend:{' '}
              <code className="text-blue-700 bg-blue-50 px-1 py-0.5 rounded font-mono">
                {getApiBaseUrl() || 'None (Running in local-only mode)'}
              </code>
            </p>
          </div>

          {testState.message && (
            <div
              className={`p-3 rounded-xl border text-xs font-medium flex items-start gap-2 ${
                testState.status === 'online'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {testState.status === 'online' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <WifiOff className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <span>{testState.message}</span>
            </div>
          )}

          {/* Setup Guide Accordion / Box */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <Globe className="w-4 h-4 text-slate-600" />
              How to configure your backend for Vercel deployment:
            </h4>
            <div className="text-xs text-slate-600 space-y-2 leading-relaxed">
              <p>
                <strong>Why was the backend offline?</strong> Vercel only hosts the compiled React frontend. The Python scrapers (<code className="font-mono bg-white px-1 py-0.5 rounded text-slate-700">backend/server.py</code>) require a running Python runtime.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-1">
                  <span className="font-bold text-slate-800 text-[11px] block">Option 1: Deploy on Render.com (Free)</span>
                  <p className="text-[11px] text-slate-500">
                    1. Create a free Web Service on <strong>Render.com</strong> from your GitHub repo.
                    <br />
                    2. Build Command: <code className="bg-slate-100 px-1 rounded">pip install -r requirements.txt</code>
                    <br />
                    3. Start Command: <code className="bg-slate-100 px-1 rounded">uvicorn backend.server:app --host 0.0.0.0 --port $PORT</code>
                    <br />
                    4. Paste your Render URL above (or set <code className="bg-slate-100 px-1 rounded">VITE_API_URL</code> in Vercel).
                  </p>
                </div>

                <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-1">
                  <span className="font-bold text-slate-800 text-[11px] block">Option 2: Local Development</span>
                  <p className="text-[11px] text-slate-500">
                    If testing on your local machine, run:
                    <br />
                    <code className="bg-slate-100 px-1 rounded font-mono">venv/bin/python backend/server.py</code>
                    <br />
                    The frontend automatically detects <code className="bg-slate-100 px-1 rounded font-mono">http://127.0.0.1:8000</code>.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI Intelligence & API Keys (Google Gemini Free Tier) */}
      <Card>
        <CardHeader className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            <CardTitle className="text-base">AI Intelligence Engine (Decision Maker Finder)</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Connect your free Google Gemini API key (or OpenAI API key) for real-time executive decision maker identification, company verification, and title resolution.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-800">
                  Google Gemini API Key (Free)
                </label>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-blue-600 hover:underline flex items-center gap-1 font-medium"
                >
                  Get free key at Google AI Studio <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={settings.geminiApiKey || ''}
                  onChange={(e) => handleUpdate({ geminiApiKey: e.target.value.trim() })}
                  placeholder="AIzaSy..."
                  className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                />
              </div>
              <p className="text-[11px] text-slate-500">
                Can also be provided as <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">GEMINI_API_KEY</code> in your backend <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">.env</code>.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-800">
                Gemini Model
              </label>
              <select
                value={settings.geminiModel || 'gemini-1.5-flash'}
                onChange={(e) => handleUpdate({ geminiModel: e.target.value })}
                className="w-full h-9 px-3 text-xs rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="gemini-1.5-flash">gemini-1.5-flash (Fast & Free Tier)</option>
                <option value="gemini-2.0-flash">gemini-2.0-flash (Latest Ultra-Fast)</option>
                <option value="gemini-1.5-pro">gemini-1.5-pro (Deep Multi-Source Reasoning)</option>
              </select>
              <p className="text-[11px] text-slate-500">
                Default: <span className="font-semibold text-slate-700">gemini-1.5-flash</span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Decision Maker Search Engines (SerpApi & Serper.dev Dual-Engine) */}
      <Card>
        <CardHeader className="p-5 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-blue-600" />
              <CardTitle className="text-base">Decision Maker Search Engines (SerpApi / Serper.dev)</CardTitle>
            </div>
            <Badge variant="default" className="text-[10px] font-semibold">
              Dual-Engine Support
            </Badge>
          </div>
          <CardDescription className="text-xs">
            Choose your preferred search engine for executive discovery or provide both keys to switch dynamically anytime.
            Both engines output identical columns: <span className="font-semibold text-slate-700">Decision Maker Name</span>, <span className="font-semibold text-slate-700">Decision Maker Post</span>, and <span className="font-semibold text-slate-700">Decision Maker Linkedin</span>.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-5 space-y-4">
          {/* Default Engine Selector */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-800">
              Default Decision Maker Engine
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleUpdate({ defaultDecisionMakerEngine: 'serpapi' })}
                className={`p-3 rounded-xl border text-left transition-all ${
                  (settings.defaultDecisionMakerEngine || 'serpapi') === 'serpapi'
                    ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-500/20'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-slate-900">SerpApi (Google Engine)</span>
                  {(settings.defaultDecisionMakerEngine || 'serpapi') === 'serpapi' && (
                    <span className="w-2 h-2 rounded-full bg-blue-600" />
                  )}
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Precision Google dorking queries with hierarchical seniority ranking (Owner, Founder, CEO, MD, VP).
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleUpdate({ defaultDecisionMakerEngine: 'serper' })}
                className={`p-3 rounded-xl border text-left transition-all ${
                  settings.defaultDecisionMakerEngine === 'serper'
                    ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-500/20'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-slate-900">Serper.dev (Google Serper API)</span>
                  {settings.defaultDecisionMakerEngine === 'serper' && (
                    <span className="w-2 h-2 rounded-full bg-blue-600" />
                  )}
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Fast JSON-based Google search with n8n keyword weighting and company token matching (+20 boost).
                </p>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            {/* SerpApi Key */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-800">
                  SerpApi Key
                </label>
                <a
                  href="https://serpapi.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-blue-600 hover:underline flex items-center gap-1 font-medium"
                >
                  Get SerpApi key <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <input
                type="password"
                value={settings.serpApiKey || ''}
                onChange={(e) => {
                  const key = e.target.value.trim();
                  handleUpdate({ serpApiKey: key });
                  const apiBase = getApiBaseUrl();
                  if (apiBase) {
                    fetch(`${apiBase}/api/decision-makers/config`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ serpapiKey: key }),
                    }).catch(() => {});
                  }
                }}
                placeholder="06f439e2..."
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
              />
              <p className="text-[11px] text-slate-500">
                Stored in <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">.env</code> as <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">SERPAPI_KEY</code>.
              </p>
            </div>

            {/* Serper.dev Key */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-800">
                  Serper.dev API Key
                </label>
                <a
                  href="https://serper.dev/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-blue-600 hover:underline flex items-center gap-1 font-medium"
                >
                  Get Serper key <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <input
                type="password"
                value={settings.serperApiKey || ''}
                onChange={(e) => {
                  const key = e.target.value.trim();
                  handleUpdate({ serperApiKey: key });
                  const apiBase = getApiBaseUrl();
                  if (apiBase) {
                    fetch(`${apiBase}/api/decision-makers/config`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ serperKey: key }),
                    }).catch(() => {});
                  }
                }}
                placeholder="serper_api_key..."
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
              />
              <p className="text-[11px] text-slate-500">
                Stored in <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">.env</code> as <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">SERPER_API_KEY</code>.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* LeadOcean Phone & Email Enricher Settings */}
      <Card>
        <CardHeader className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-emerald-600" />
            <CardTitle className="text-base">LeadOcean Email & Phone Enrichment API</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Connect your LeadOcean API key to enrich leads with verified corporate emails and direct phone numbers.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-800">
                LeadOcean API Key
              </label>
              <input
                type="password"
                value={settings.leadoceanApiKey || ''}
                onChange={(e) => {
                  const key = e.target.value.trim();
                  handleUpdate({ leadoceanApiKey: key });
                  const apiBase = getApiBaseUrl();
                  if (apiBase) {
                    fetch(`${apiBase}/api/leadocean/config`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ apiKey: key }),
                    }).catch(() => {});
                  }
                }}
                placeholder="lo_live_..."
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white"
              />
              <p className="text-[11px] text-slate-500">
                Stored in <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">.env</code> as <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">LEADOCEAN_API_KEY</code>.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-800">
                LeadOcean Endpoint URL
              </label>
              <input
                type="text"
                value={settings.leadoceanEndpoint || 'https://api.leadocean.io/v1/people/enrich'}
                onChange={(e) => {
                  const url = e.target.value.trim();
                  handleUpdate({ leadoceanEndpoint: url });
                  const apiBase = getApiBaseUrl();
                  if (apiBase) {
                    fetch(`${apiBase}/api/leadocean/config`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ url }),
                    }).catch(() => {});
                  }
                }}
                placeholder="https://api.leadocean.io/v1/people/enrich"
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white"
              />
              <p className="text-[11px] text-slate-500">
                Configured in <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">leadocean_config.json</code>.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 1. Simulation & Crawler Timing */}
      <Card>
        <CardHeader className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-blue-600" />
            <CardTitle className="text-base">Simulation Engine & Latency</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Controls artificial crawler delay and networking simulation stages across all 5 modules.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Default Crawling Speed
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { id: 'fast', title: 'Turbo Fast', desc: '200ms delay per company' },
                { id: 'realistic', title: 'Realistic Simulation', desc: '400ms delay with MX check' },
                { id: 'thorough', title: 'Deep Crawl', desc: '900ms delay with full verification' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleUpdate({ simulationSpeed: opt.id as any })}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    settings.simulationSpeed === opt.id
                      ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20 text-blue-900'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="text-xs font-bold">{opt.title}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. Default Export Preferences */}
      <Card>
        <CardHeader className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <CardTitle className="text-base">Default Spreadsheet Export Settings</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Default configurations applied when generating SheetJS Excel (.xlsx) and CSV files.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-5 space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                Preferred File Format
              </label>
              <select
                value={settings.defaultExportFormat}
                onChange={(e) => handleUpdate({ defaultExportFormat: e.target.value as any })}
                className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-700 shadow-xs"
              >
                <option value="xlsx">Microsoft Excel (.xlsx)</option>
                <option value="csv">Comma-Separated Values (.csv)</option>
              </select>
            </div>

            <div className="space-y-2 pt-5">
              <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.includeConfidenceScore}
                  onChange={(e) => handleUpdate({ includeConfidenceScore: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>Include algorithmic confidence percentage (0-100%) in exports</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.includeTimestampInExport}
                  onChange={(e) => handleUpdate({ includeTimestampInExport: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>Include timestamp in generated spreadsheet filenames</span>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. Scraper Integration Guide & Adapter Architecture */}
      <Card>
        <CardHeader className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-indigo-600" />
            <CardTitle className="text-base">Scraping Algorithm Integration Guide</CardTitle>
          </div>
          <CardDescription className="text-xs">
            How to plug your existing Python/Node scraping modules into the frontend adapters.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-5 space-y-4 text-xs leading-relaxed text-slate-600">
          <p>
            The UI is decoupled from any backend via the TypeScript adapter interface{' '}
            <code className="bg-slate-100 px-1.5 py-0.5 rounded text-blue-700 font-mono text-[11px]">
              IResearchAdapter
            </code>{' '}
            located in <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono text-[11px]">src/services/adapters/baseAdapter.ts</code>.
          </p>

          <div className="p-4 rounded-xl bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto space-y-2 shadow-inner">
            <div className="text-slate-400">// Example: To connect your real Python scraper later:</div>
            <div>
              <span className="text-purple-400">export class</span>{' '}
              <span className="text-yellow-300">LiveScraperAdapter</span>{' '}
              <span className="text-purple-400">implements</span>{' '}
              <span className="text-emerald-400">IResearchAdapter</span> &#123;
            </div>
            <div className="pl-4">
              <span className="text-purple-400">async</span>{' '}
              <span className="text-blue-400">enrichSingle</span>(record, config) &#123;
            </div>
            <div className="pl-8 text-slate-400">// Replace mock generation with your local API call</div>
            <div className="pl-8">
              <span className="text-purple-400">const</span> response ={' '}
              <span className="text-purple-400">await</span> fetch(<span className="text-emerald-300">'http://localhost:8000/api/scrape'</span>, &#123;
            </div>
            <div className="pl-12">method: <span className="text-emerald-300">'POST'</span>, body: JSON.stringify(record)</div>
            <div className="pl-8">&#125;);</div>
            <div className="pl-8"><span className="text-purple-400">return await</span> response.json();</div>
            <div className="pl-4">&#125;</div>
            <div>&#125;</div>
          </div>

          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-[11px] flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <span>
              <strong>Zero Security Exposure:</strong> The application does not bundle API keys, secrets, or database credentials. All scraping operations can remain hosted on your private backend service.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* User & Team Account Management (Web-Based Admin - No Shell Access Needed) */}
      <Card className="border-blue-100 shadow-xs">
        <CardHeader className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-600" />
              <CardTitle className="text-base">Team & User Accounts</CardTitle>
              <Badge variant="secondary" size="sm" className="font-mono text-[10px]">
                {teamUsers.length} Registered
              </Badge>
            </div>
            <CardDescription className="text-xs mt-0.5">
              Create, update, and manage accounts directly in the database without cloud shell access.
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadTeamUsers}
              disabled={loadingUsers}
              className="text-xs h-8 px-2.5"
              title="Refresh users"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingUsers ? 'animate-spin text-blue-600' : ''}`} />
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setUserActionError(null);
                setUserActionSuccess(null);
                setIsCreateUserModalOpen(true);
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 px-3 font-semibold gap-1.5 shadow-xs"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Create User</span>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-5 space-y-4">
          {userActionSuccess && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{userActionSuccess}</span>
            </div>
          )}

          {userActionError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <X className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{userActionError}</span>
            </div>
          )}

          <div className="overflow-x-auto border border-slate-200/80 rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                  <th className="p-3">User</th>
                  <th className="p-3">Role</th>
                  <th className="p-3">Configured API Keys</th>
                  <th className="p-3">Created</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {teamUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-400 text-xs">
                      {loadingUsers ? 'Loading registered accounts...' : 'No users found.'}
                    </td>
                  </tr>
                ) : (
                  teamUsers.map((u) => {
                    const isSelf = user?.email?.toLowerCase() === u.email?.toLowerCase();
                    return (
                      <tr key={u.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="p-3">
                          <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                            <span>{u.name || u.email.split('@')[0]}</span>
                            {isSelf && (
                              <Badge variant="outline" size="sm" className="text-[9px] py-0 px-1 border-blue-200 text-blue-700 bg-blue-50">
                                You
                              </Badge>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">{u.email}</div>
                        </td>
                        <td className="p-3">
                          <Badge variant={u.role === 'admin' ? 'default' : 'secondary'} size="sm" className="capitalize text-[10px]">
                            {u.role || 'user'}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${u.has_serpapi_key ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-400'}`}>
                              SerpAPI: {u.has_serpapi_key ? '✓' : '—'}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${u.has_gemini_key ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-slate-100 text-slate-400'}`}>
                              Gemini: {u.has_gemini_key ? '✓' : '—'}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${u.has_serper_key ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-slate-100 text-slate-400'}`}>
                              Serper: {u.has_serper_key ? '✓' : '—'}
                            </span>
                          </div>
                        </td>
                        <td className="p-3 text-[11px] text-slate-500">
                          {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setUserActionError(null);
                                setUserActionSuccess(null);
                                setPasswordModalUser(u.email);
                                setNewPasswordValue('');
                              }}
                              className="h-7 px-2 text-[11px] text-slate-700 hover:text-blue-700 hover:border-blue-300"
                              title="Reset Password"
                            >
                              <KeyRound className="w-3 h-3 mr-1" />
                              Password
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteUser(u.email)}
                              disabled={isSelf}
                              className={`h-7 px-2 text-[11px] ${
                                isSelf
                                  ? 'opacity-30 cursor-not-allowed'
                                  : 'text-rose-600 hover:bg-rose-50 hover:text-rose-700'
                              }`}
                              title={isSelf ? 'Cannot delete your active account' : 'Delete user'}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Modal: Create User (Web-based Admin) */}
      {isCreateUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-slate-900 text-sm">Create New Team User</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateUserModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-5 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Email Address <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  placeholder="colleague@company.com"
                  value={newUserData.email}
                  onChange={(e) => setNewUserData({ ...newUserData, email: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Display Name</label>
                <input
                  type="text"
                  placeholder="Jane Doe"
                  value={newUserData.name}
                  onChange={(e) => setNewUserData({ ...newUserData, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Password <span className="text-rose-500">*</span> (min 6 characters)
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="••••••••••••"
                  value={newUserData.password}
                  onChange={(e) => setNewUserData({ ...newUserData, password: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Role</label>
                <select
                  value={newUserData.role}
                  onChange={(e) => setNewUserData({ ...newUserData, role: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="user">User (Standard Access)</option>
                  <option value="admin">Admin (User Management Access)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCreateUserModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" className="bg-blue-600 hover:bg-blue-700 text-white font-semibold">
                  Create Account
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Change Password (Web-based Admin) */}
      {passwordModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-indigo-600" />
                <h3 className="font-bold text-slate-900 text-sm">Reset Password</h3>
              </div>
              <button
                type="button"
                onClick={() => setPasswordModalUser(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleChangePassword} className="p-5 space-y-3.5 text-xs">
              <div>
                <div className="text-slate-500 text-[11px] mb-2">
                  Updating password for account:
                  <div className="font-mono font-bold text-slate-800 text-xs">{passwordModalUser}</div>
                </div>
                <label className="block font-semibold text-slate-700 mb-1">
                  New Password <span className="text-rose-500">*</span>
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="Enter new password (min 6 chars)"
                  value={newPasswordValue}
                  onChange={(e) => setNewPasswordValue(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPasswordModalUser(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">
                  Update Password
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Danger Zone / Reset */}
      <Card className="border-rose-200 bg-rose-50/20">
        <CardHeader className="p-5 border-b border-rose-100">
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-rose-600" />
            <CardTitle className="text-base text-rose-900">Reset Local Application State</CardTitle>
          </div>
          <CardDescription className="text-xs text-rose-700">
            Clear all saved projects, imported spreadsheets, and export history from browser localStorage.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-5">
          <Button
            variant="danger"
            size="sm"
            onClick={handleResetData}
            className="text-xs"
          >
            Reset All Data to Factory Default
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
