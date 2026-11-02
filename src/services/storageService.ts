import { Project, ExportHistoryItem, AppSettings, EnrichmentRecord } from '../types';
import { INITIAL_PROJECTS, INITIAL_EXPORT_HISTORY } from './mockData';
import { getApiBaseUrl, getAuthHeaders, getAuthToken } from '../config/api';

let activeUserId: string | null = null;

const getProjectsKey = () => (activeUserId ? `ai_auto_scrapper_projects_${activeUserId}_v1` : 'ai_auto_scrapper_projects_v1');
const getExportsKey = () => (activeUserId ? `ai_auto_scrapper_exports_${activeUserId}_v1` : 'ai_auto_scrapper_exports_v1');
const getSettingsKey = () => (activeUserId ? `ai_auto_scrapper_settings_${activeUserId}_v1` : 'ai_auto_scrapper_settings_v1');

const DEFAULT_SETTINGS: AppSettings = {
  simulationSpeed: 'fast',
  defaultExportFormat: 'xlsx',
  includeConfidenceScore: true,
  includeTimestampInExport: true,
  adapterMode: 'real',
  geminiApiKey: '',
  geminiModel: 'gemini-1.5-flash',
  openAiApiKey: '',
  openAiModel: 'gpt-4o-mini',
};

export const storageService = {
  setUserId(userId: string | null): void {
    activeUserId = userId;
  },

  getProjects(): Project[] {
    try {
      const scopedKey = getProjectsKey();
      let data = localStorage.getItem(scopedKey);
      // Fallback to legacy un-scoped key if user-scoped key is empty
      if (!data && activeUserId) {
        data = localStorage.getItem('ai_auto_scrapper_projects_v1');
        if (data) {
          localStorage.setItem(scopedKey, data);
        }
      }
      if (!data) {
        return INITIAL_PROJECTS;
      }
      return JSON.parse(data);
    } catch {
      return INITIAL_PROJECTS;
    }
  },

  getProjectById(id: string): Project | undefined {
    const projects = this.getProjects();
    return projects.find((p) => p.id === id);
  },

  saveProject(project: Project): void {
    const projects = this.getProjects();
    const existingIndex = projects.findIndex((p) => p.id === project.id);
    const updatedProject = {
      ...project,
      updatedAt: new Date().toISOString(),
      createdAt: project.createdAt || new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      projects[existingIndex] = updatedProject;
    } else {
      projects.unshift(updatedProject);
    }

    try {
      localStorage.setItem(getProjectsKey(), JSON.stringify(projects));
    } catch (e) {
      console.warn('LocalStorage saveProject quota exceeded or error:', e);
    }

    // Persist asynchronously to backend database so data is restored across sessions
    const apiBase = getApiBaseUrl();
    const token = getAuthToken();
    if (apiBase && token) {
      fetch(`${apiBase}/api/projects`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(updatedProject),
      }).catch((err) => {
        console.warn('Failed to save project to backend database:', err);
      });
    }
  },

  deleteProject(id: string): void {
    const projects = this.getProjects().filter((p) => p.id !== id);
    try {
      localStorage.setItem(getProjectsKey(), JSON.stringify(projects));
    } catch (e) {
      console.warn('LocalStorage deleteProject error:', e);
    }

    const apiBase = getApiBaseUrl();
    const token = getAuthToken();
    if (apiBase && token) {
      fetch(`${apiBase}/api/projects/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      }).catch((err) => {
        console.warn('Failed to delete project on backend database:', err);
      });
    }
  },

  async syncProjectsWithBackend(): Promise<Project[]> {
    const apiBase = getApiBaseUrl();
    const token = getAuthToken();
    if (!apiBase || !token) {
      return this.getProjects();
    }

    try {
      const res = await fetch(`${apiBase}/api/projects`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        return this.getProjects();
      }

      const json = await res.json();
      const backendProjects: Project[] = json.projects || [];
      const localProjects = this.getProjects();

      // Merge: backend is source of truth, retain any fresh local projects not yet in backend
      const map = new Map<string, Project>();
      for (const p of backendProjects) {
        map.set(p.id, p);
      }
      for (const p of localProjects) {
        if (!map.has(p.id)) {
          map.set(p.id, p);
          // Upload local unsaved project to backend
          fetch(`${apiBase}/api/projects`, {
            method: 'POST',
            headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(p),
          }).catch(() => {});
        }
      }

      const merged = Array.from(map.values()).sort(
        (a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
      );

      try {
        localStorage.setItem(getProjectsKey(), JSON.stringify(merged));
      } catch {
        // ignore quota
      }

      return merged;
    } catch (err) {
      console.warn('Failed to sync projects with backend:', err);
      return this.getProjects();
    }
  },

  getExportHistory(): ExportHistoryItem[] {
    try {
      const scopedKey = getExportsKey();
      let data = localStorage.getItem(scopedKey);
      if (!data && activeUserId) {
        data = localStorage.getItem('ai_auto_scrapper_exports_v1');
        if (data) {
          localStorage.setItem(scopedKey, data);
        }
      }
      if (!data) {
        return INITIAL_EXPORT_HISTORY;
      }
      return JSON.parse(data);
    } catch {
      return INITIAL_EXPORT_HISTORY;
    }
  },

  addExportHistory(item: Omit<ExportHistoryItem, 'id' | 'exportedAt'>): ExportHistoryItem {
    const history = this.getExportHistory();
    const newItem: ExportHistoryItem = {
      ...item,
      id: `exp-${Date.now()}`,
      exportedAt: new Date().toISOString(),
    };
    history.unshift(newItem);
    try {
      localStorage.setItem(getExportsKey(), JSON.stringify(history));
    } catch (e) {
      console.warn('LocalStorage addExportHistory error:', e);
    }
    return newItem;
  },

  clearExportHistory(): void {
    localStorage.setItem(getExportsKey(), JSON.stringify([]));
  },

  getSettings(): AppSettings {
    try {
      const scopedKey = getSettingsKey();
      let data = localStorage.getItem(scopedKey);
      if (!data && activeUserId) {
        data = localStorage.getItem('ai_auto_scrapper_settings_v1');
        if (data) {
          localStorage.setItem(scopedKey, data);
        }
      }
      if (!data) {
        return DEFAULT_SETTINGS;
      }
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  },

  saveSettings(settings: Partial<AppSettings>): AppSettings {
    const current = this.getSettings();
    const updated = { ...current, ...settings };
    try {
      localStorage.setItem(getSettingsKey(), JSON.stringify(updated));
      // Also keep un-scoped fallback updated for components that load before auth initializes
      localStorage.setItem('ai_auto_scrapper_settings_v1', JSON.stringify(updated));
    } catch (e) {
      console.warn('LocalStorage saveSettings error:', e);
    }
    return updated;
  },

  resetAllData(): void {
    localStorage.removeItem(getProjectsKey());
    localStorage.removeItem(getExportsKey());
    localStorage.removeItem(getSettingsKey());
    localStorage.removeItem('ai_auto_scrapper_projects_v1');
    localStorage.removeItem('ai_auto_scrapper_exports_v1');
    localStorage.removeItem('ai_auto_scrapper_settings_v1');
  },
};
