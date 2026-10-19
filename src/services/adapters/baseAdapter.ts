import { EnrichmentRecord, ResearchConfig, ResearchProgress } from '../../types';

export interface ModuleMetadata {
  id: string;
  name: string;
  description: string;
  badge: string;
  category: string;
  inputRequirements: string[];
  outputFields: string[];
  integrationNote: string;
}

export interface IResearchAdapter {
  readonly metadata: ModuleMetadata;

  /**
   * Enrich a single record
   */
  enrichSingle(
    record: EnrichmentRecord,
    config: ResearchConfig
  ): Promise<EnrichmentRecord>;

  /**
   * Run batch enrichment with granular step-by-step progress callbacks
   */
  enrichBatch(
    records: EnrichmentRecord[],
    config: ResearchConfig,
    onProgress?: (progress: ResearchProgress) => void,
    signal?: AbortSignal
  ): Promise<EnrichmentRecord[]>;
}

// Utility delay function for realistic simulation of network & scraping pipeline stages
export const simulateDelay = (ms: number, signal?: AbortSignal): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('Operation aborted by user', 'AbortError'));
    }
    const timer = setTimeout(() => resolve(), ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Operation aborted by user', 'AbortError'));
    });
  });
};
