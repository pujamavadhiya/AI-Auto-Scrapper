import { getApiBaseUrl, getAuthHeaders, getAuthToken } from '../config/api';
import { SearchHistorySummary, SearchHistoryDetail } from '../types/history';
import { EnrichmentRecord } from '../types';

export const historyService = {
  async fetchHistory(): Promise<SearchHistorySummary[]> {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return [];

    try {
      const res = await fetch(`${apiBase}/api/history`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.history || [];
    } catch (e) {
      console.warn('Failed to fetch user extraction history:', e);
      return [];
    }
  },

  async fetchHistoryItem(id: string): Promise<SearchHistoryDetail | null> {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return null;

    try {
      const res = await fetch(`${apiBase}/api/history/${id}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.history || null;
    } catch (e) {
      console.warn(`Failed to fetch history details for ${id}:`, e);
      return null;
    }
  },

  async saveSearchHistory(params: {
    moduleType: string;
    searchQuery: string;
    records: EnrichmentRecord[] | any[];
    filters?: Record<string, any>;
    status?: string;
    enrichedCount?: number;
  }): Promise<SearchHistorySummary | null> {
    const apiBase = getApiBaseUrl();
    if (!apiBase || !params.records || params.records.length === 0) return null;

    try {
      const res = await fetch(`${apiBase}/api/history`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          moduleType: params.moduleType,
          searchQuery: params.searchQuery || 'Extracted Leads',
          records: params.records,
          filters: params.filters || {},
          status: params.status || 'completed',
          enrichedCount: params.enrichedCount,
        }),
      });

      if (!res.ok) return null;
      const data = await res.json();
      return data.history || null;
    } catch (e) {
      console.warn('Failed to auto-save search extraction to history:', e);
      return null;
    }
  },

  async deleteHistoryItem(id: string): Promise<boolean> {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return false;

    try {
      const res = await fetch(`${apiBase}/api/history/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async clearHistory(): Promise<boolean> {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return false;

    try {
      const res = await fetch(`${apiBase}/api/history`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  getExportUrl(historyId: string, format: 'xlsx' | 'csv' = 'xlsx'): string {
    const apiBase = getApiBaseUrl();
    const token = getAuthToken() || '';
    return `${apiBase}/api/history/${historyId}/export?format=${format}&token=${encodeURIComponent(token)}`;
  },

  async downloadHistoryFile(historyId: string, format: 'xlsx' | 'csv' = 'xlsx', defaultName: string = 'leads'): Promise<void> {
    const apiBase = getApiBaseUrl();
    const res = await fetch(`${apiBase}/api/history/${historyId}/export?format=${format}`, {
      headers: getAuthHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Failed to download file (HTTP ${res.status})`);
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${defaultName}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },
};
