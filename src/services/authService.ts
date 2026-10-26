import { getApiBaseUrl, getAuthHeaders, setAuthToken, getAuthToken } from '../config/api';
import { AuthResponse, User, UserApiKeys } from '../types/auth';

export const authService = {
  async login(email: string, password: string): Promise<AuthResponse> {
    const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const apiBase = getApiBaseUrl() || (isLocal ? 'http://127.0.0.1:8000' : '');

    if (!apiBase && !isLocal) {
      throw new Error(
        'Backend API Server URL is not configured. On Vercel, please set VITE_API_URL or enter your live Backend URL below (e.g. Render or Railway).'
      );
    }

    let res: Response;
    try {
      res = await fetch(`${apiBase}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: email.trim(), password }),
      });
    } catch (netErr: any) {
      throw new Error(
        `Unable to reach backend server at "${apiBase}". Please verify your backend is running and CORS is enabled.`
      );
    }

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(
          `Backend server at "${apiBase}" returned 404 for /api/auth/login. Please verify the URL points to your FastAPI backend.`
        );
      }
      if (res.status === 502 || res.status === 503) {
        throw new Error(
          `Backend server is starting up or temporarily unavailable (${res.status}). If hosted on Render free tier, please wait 30-50s for cold start.`
        );
      }
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Invalid email or password.');
    }

    const data: AuthResponse = await res.json();
    if (data.token) {
      setAuthToken(data.token);
    }
    return data;
  },

  async getMe(): Promise<{ user: User; keys: UserApiKeys }> {
    const token = getAuthToken();
    if (!token) {
      throw new Error('No authentication token found.');
    }

    const apiBase = getApiBaseUrl() || (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://127.0.0.1:8000' : '');
    const res = await fetch(`${apiBase}/api/auth/me`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    if (!res.ok) {
      setAuthToken(null);
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Session expired. Please log in again.');
    }

    const data = await res.json();
    return {
      user: data.user,
      keys: data.keys || {},
    };
  },

  async logout(): Promise<void> {
    const token = getAuthToken();
    const apiBase = getApiBaseUrl();
    if (token && apiBase) {
      try {
        await fetch(`${apiBase}/api/auth/logout`, {
          method: 'POST',
          headers: getAuthHeaders(),
        });
      } catch {
        // ignore logout network error
      }
    }
    setAuthToken(null);
  },

  async updateUserKeys(keys: Partial<UserApiKeys>): Promise<UserApiKeys> {
    const apiBase = getApiBaseUrl() || (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://127.0.0.1:8000' : '');
    const res = await fetch(`${apiBase}/api/user/keys`, {
      method: 'POST',
      headers: getAuthHeaders({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(keys),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to update user keys.');
    }

    const data = await res.json();
    return data.keys;
  },

  async listUsers(): Promise<any[]> {
    const apiBase = getApiBaseUrl() || (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://127.0.0.1:8000' : '');
    const res = await fetch(`${apiBase}/api/admin/users`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to list users.');
    }
    const data = await res.json();
    return data.users || [];
  },

  async createUser(payload: { email: string; password: string; name?: string; role?: string }): Promise<any> {
    const apiBase = getApiBaseUrl() || (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://127.0.0.1:8000' : '');
    const res = await fetch(`${apiBase}/api/admin/users/create`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to create user.');
    }
    return res.json();
  },

  async changeUserPassword(payload: { email: string; password: string }): Promise<any> {
    const apiBase = getApiBaseUrl() || (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://127.0.0.1:8000' : '');
    const res = await fetch(`${apiBase}/api/admin/users/change-password`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to change password.');
    }
    return res.json();
  },

  async deleteUser(email: string): Promise<any> {
    const apiBase = getApiBaseUrl() || (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://127.0.0.1:8000' : '');
    const res = await fetch(`${apiBase}/api/admin/users/delete`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to delete user.');
    }
    return res.json();
  },
};
