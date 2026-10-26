import { getApiBaseUrl, getAuthHeaders, setAuthToken, getAuthToken } from '../config/api';
import { AuthResponse, User, UserApiKeys } from '../types/auth';

export const authService = {
  async login(email: string, password: string): Promise<AuthResponse> {
    const apiBase = getApiBaseUrl() || (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://127.0.0.1:8000' : '');
    const res = await fetch(`${apiBase}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: email.trim(), password }),
    });

    if (!res.ok) {
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
};
