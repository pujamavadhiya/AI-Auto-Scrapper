import { Project, ExportHistoryItem, AppSettings, EnrichmentRecord } from '../types';
import { INITIAL_PROJECTS, INITIAL_EXPORT_HISTORY } from './mockData';

const STORAGE_KEYS = {
  PROJECTS: 'ai_auto_scrapper_projects_v1',
  EXPORTS: 'ai_auto_scrapper_exports_v1',
  SETTINGS: 'ai_auto_scrapper_settings_v1',
};

const DEFAULT_SETTINGS: AppSettings = {
  simulationSpeed: 'fast',
  defaultExportFormat: 'xlsx',
  includeConfidenceScore: true,
  includeTimestampInExport: true,
  adapterMode: 'real',
};

export const storageService = {
  getProjects(): Project[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PROJECTS);
      if (!data) {
        localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(INITIAL_PROJECTS));
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
    if (existingIndex >= 0) {
      projects[existingIndex] = { ...project, updatedAt: new Date().toISOString() };
    } else {
      projects.unshift({ ...project, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projects));
  },

  deleteProject(id: string): void {
    const projects = this.getProjects().filter((p) => p.id !== id);
    localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projects));
  },

  getExportHistory(): ExportHistoryItem[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.EXPORTS);
      if (!data) {
        localStorage.setItem(STORAGE_KEYS.EXPORTS, JSON.stringify(INITIAL_EXPORT_HISTORY));
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
    localStorage.setItem(STORAGE_KEYS.EXPORTS, JSON.stringify(history));
    return newItem;
  },

  clearExportHistory(): void {
    localStorage.setItem(STORAGE_KEYS.EXPORTS, JSON.stringify([]));
  },

  getSettings(): AppSettings {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
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
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
    return updated;
  },

  resetAllData(): void {
    localStorage.removeItem(STORAGE_KEYS.PROJECTS);
    localStorage.removeItem(STORAGE_KEYS.EXPORTS);
    localStorage.removeItem(STORAGE_KEYS.SETTINGS);
  },
};
