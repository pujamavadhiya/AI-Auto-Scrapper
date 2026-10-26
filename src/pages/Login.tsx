import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Lock,
  Mail,
  Eye,
  EyeOff,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  AlertCircle,
  KeyRound,
  CheckCircle2,
  Server,
  Layers,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Globe,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { getApiBaseUrl, setCustomApiBaseUrl } from '../config/api';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Backend connection drawer state for production/Vercel
  const [currentApiBase, setCurrentApiBase] = useState(() => getApiBaseUrl());
  const [showConfigDrawer, setShowConfigDrawer] = useState(() => !getApiBaseUrl() && typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1');
  const [inputApiUrl, setInputApiUrl] = useState(() => getApiBaseUrl());
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as any)?.from?.pathname || '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setErrorMessage('Please enter both your email and password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await login(cleanEmail, password);
      if (res.success) {
        navigate(from, { replace: true });
      } else {
        setErrorMessage(res.error || 'Invalid email or password.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Unable to connect to server. Ensure backend is running.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTestAndSaveBackend = async () => {
    setTestingConnection(true);
    setTestResult(null);
    const cleanUrl = inputApiUrl.trim().replace(/\/+$/, '');
    try {
      const target = cleanUrl || (isLocal ? 'http://127.0.0.1:8000' : '');
      if (!target) {
        throw new Error('Please enter a Backend URL (e.g. https://your-backend.onrender.com)');
      }
      const res = await fetch(`${target}/api/health`, { method: 'GET' });
      if (!res.ok) {
        throw new Error(`Server responded with HTTP ${res.status}`);
      }
      setCustomApiBaseUrl(cleanUrl);
      setCurrentApiBase(cleanUrl);
      setTestResult({ ok: true, message: 'Connected! Backend API is active.' });
    } catch (e: any) {
      setTestResult({ ok: false, message: e.message || 'Could not connect to backend endpoint.' });
    } finally {
      setTestingConnection(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 flex flex-col justify-center items-center p-4 sm:p-6 relative overflow-hidden select-none">
      {/* Background radial ambient lights */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-sky-500/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Grid Pattern overlay */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)`,
          backgroundSize: '36px 36px',
        }}
      />

      <div className="w-full max-w-md relative z-10 space-y-6">
        {/* Header / Brand */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold tracking-wide">
            <Sparkles className="w-3.5 h-3.5 text-blue-400" />
            Enterprise Lead Intelligence Suite
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center justify-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
              <Layers className="w-4 h-4" />
            </div>
            AI Auto Scrapper
          </h1>
          <p className="text-xs sm:text-sm text-slate-400">
            Sign in with your backend-provisioned credentials
          </p>
        </div>

        {/* Login Form Card */}
        <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl p-6 sm:p-8 space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">Account Login</span>
            </div>
            <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              Private API Keys
            </span>
          </div>

          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-2.5 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5 leading-relaxed">
                <span className="font-semibold block text-rose-200">Authentication Failed</span>
                <span>{errorMessage}</span>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Field */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-300">
                Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  autoComplete="email"
                  required
                  className="w-full pl-9 pr-3 py-2.5 text-xs rounded-xl bg-slate-950/60 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all font-mono"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-300">
                  Password
                </label>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  required
                  className="w-full pl-9 pr-10 py-2.5 text-xs rounded-xl bg-slate-950/60 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200 transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 mt-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-blue-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Signing In...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </Button>
          </form>

          {/* Backend Connection Drawer (Critical for Vercel) */}
          <div className="pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-slate-300">
                <span className={`w-2 h-2 rounded-full ${currentApiBase || isLocal ? 'bg-emerald-400' : 'bg-amber-400 animate-ping'}`} />
                <span className="text-[11px] font-medium text-slate-400">
                  {currentApiBase ? (
                    <span className="font-mono text-emerald-300">{currentApiBase.replace(/^https?:\/\//, '')}</span>
                  ) : isLocal ? (
                    <span className="text-slate-300">Localhost (127.0.0.1:8000)</span>
                  ) : (
                    <span className="text-amber-300 font-semibold">Backend URL Not Set</span>
                  )}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowConfigDrawer(!showConfigDrawer)}
                className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium cursor-pointer"
              >
                <span>{showConfigDrawer ? 'Hide Settings' : 'Change Backend URL'}</span>
                {showConfigDrawer ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>

            {showConfigDrawer && (
              <div className="mt-3 p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2.5 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Backend API Server URL (e.g. Render, Railway, or Tunnel)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={inputApiUrl}
                      onChange={(e) => setInputApiUrl(e.target.value)}
                      placeholder="https://ai-auto-scrapper-backend.onrender.com"
                      className="flex-1 px-2.5 py-1.5 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-500 font-mono focus:outline-hidden focus:border-blue-500"
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleTestAndSaveBackend}
                      disabled={testingConnection}
                      className="bg-blue-600 hover:bg-blue-500 text-white text-[11px] px-3 h-8 shrink-0 font-semibold cursor-pointer"
                    >
                      {testingConnection ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Connect'}
                    </Button>
                  </div>
                </div>

                {testResult && (
                  <div
                    className={`p-2 rounded-lg text-[11px] flex items-center gap-1.5 ${
                      testResult.ok
                        ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                        : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
                    }`}
                  >
                    {testResult.ok ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    )}
                    <span>{testResult.message}</span>
                  </div>
                )}

                <div className="text-[10px] text-slate-400 leading-normal">
                  <span className="font-semibold text-slate-300">Permanent Vercel setup:</span> Add{' '}
                  <code className="text-blue-300 bg-slate-900 px-1 py-0.5 rounded font-mono">VITE_API_URL</code> to{' '}
                  <span className="text-slate-300">Vercel &rarr; Settings &rarr; Environment Variables</span>, then redeploy.
                </div>
              </div>
            )}
          </div>

          {/* Backend Provisioned Notice (No Sign-up Form) */}
          <div className="p-3.5 rounded-xl bg-slate-950/50 border border-slate-800/80 text-[11px] text-slate-400 space-y-1.5">
            <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
              <Server className="w-3.5 h-3.5 text-blue-400" />
              <span>Backend Managed Access</span>
            </div>
            <p className="leading-relaxed">
              New user accounts are created directly on the backend server.
              Each user manages their own dedicated SerpAPI, Serper, and Gemini keys privately.
            </p>
          </div>
        </div>

        {/* Footer info */}
        <div className="text-center text-[11px] text-slate-500 flex items-center justify-center gap-4">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            Per-User API Isolation
          </span>
          <span>•</span>
          <span>FastAPI + SQLite Engine</span>
        </div>
      </div>
    </div>
  );
};
