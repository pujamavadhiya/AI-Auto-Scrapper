/**
 * Centralized API Base URL configuration
 * Supports:
 *  1. User custom endpoint configured in Settings (localStorage)
 *  2. Environment variable VITE_API_URL set during Vercel / Netlify build
 *  3. Default fallback to http://127.0.0.1:8000 for local development
 */

export const getApiBaseUrl = (): string => {
  try {
    // 1. Check user configured endpoint in Settings (saved in localStorage)
    const rawStorage = localStorage.getItem('leadpulse_app_settings');
    if (rawStorage) {
      const parsed = JSON.parse(rawStorage);
      if (parsed.customScraperEndpoint && typeof parsed.customScraperEndpoint === 'string') {
        const custom = parsed.customScraperEndpoint.trim().replace(/\/+$/, '');
        if (custom) return custom;
      }
    }
  } catch {
    // ignore json parse error
  }

  // 2. Check Vite build-time environment variable
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, '');
  }

  // 3. Fallback for local development
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://127.0.0.1:8000';
    }
  }

  // If deployed to Vercel/production and no backend URL provided yet, return empty
  return '';
};
