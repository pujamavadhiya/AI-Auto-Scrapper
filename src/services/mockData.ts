import { EnrichmentRecord, Project, ExportHistoryItem } from '../types';

// Zero pre-fed / dummy reference data. Everything is derived live from user input and live scraping.
export const MOCK_COMPANIES: any[] = [];

export function getSampleInitialRecords(): EnrichmentRecord[] {
  return [];
}

export const INITIAL_PROJECTS: Project[] = [];

export const INITIAL_EXPORT_HISTORY: ExportHistoryItem[] = [];
