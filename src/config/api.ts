/**
 * Centralized API Base URL and Authentication Header configuration
 * Supports:
 *  1. User custom endpoint configured in Settings (localStorage)
 *  2. Environment variable VITE_API_URL set during Vercel / Netlify build
 *  3. Default fallback to http://127.0.0.1:8000 for local development
 *  4. Isolated user JWT / Bearer token injection
 */

const TOKEN_KEY = 'leadpulse_auth_token';

export const getAuthToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const setAuthToken = (token: string | null): void => {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // ignore
  }
};

export const getAuthHeaders = (customHeaders: Record<string, string> = {}): Record<string, string> => {
  const headers: Record<string, string> = { ...customHeaders };
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

export const API_BASE_URL_STORAGE_KEY = 'leadpulse_api_base_url';

export const setCustomApiBaseUrl = (url: string | null): void => {
  try {
    if (url && url.trim()) {
      localStorage.setItem(API_BASE_URL_STORAGE_KEY, url.trim().replace(/\/+$/, ''));
    } else {
      localStorage.removeItem(API_BASE_URL_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
};

export const getApiBaseUrl = (): string => {
  try {
    // 1. Direct explicit API base URL override
    const explicitUrl = localStorage.getItem(API_BASE_URL_STORAGE_KEY);
    if (explicitUrl && explicitUrl.trim()) {
      return explicitUrl.trim().replace(/\/+$/, '');
    }

    // 2. Check user configured endpoint in Settings (saved in localStorage)
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

  // 3. Check Vite build-time environment variable
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, '');
  }

  // 4. Fallback for local development
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://127.0.0.1:8000';
    }
  }

  // If deployed to Vercel/production and no backend URL provided yet, return empty
  return '';
};

export const authenticatedFetch = async (
  endpointOrFullUrl: string,
  init?: RequestInit
): Promise<Response> => {
  const apiBase = getApiBaseUrl();
  const url = endpointOrFullUrl.startsWith('http://') || endpointOrFullUrl.startsWith('https://')
    ? endpointOrFullUrl
    : `${apiBase}${endpointOrFullUrl.startsWith('/') ? '' : '/'}${endpointOrFullUrl}`;

  const token = getAuthToken();
  const headers = new Headers(init?.headers || {});

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(url, {
    ...init,
    headers,
  });
};
