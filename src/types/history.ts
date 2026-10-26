import { EnrichmentRecord } from './index';

export interface SearchHistorySummary {
  id: string;
  moduleType: string;
  searchQuery: string;
  recordCount: number;
  enrichedCount: number;
  status: string;
  filters: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface SearchHistoryDetail extends SearchHistorySummary {
  userId: string;
  records: EnrichmentRecord[];
}
