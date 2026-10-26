import { IResearchAdapter, ModuleMetadata } from './baseAdapter';
import { EnrichmentRecord, ResearchConfig, ResearchProgress } from '../../types';
import { getApiBaseUrl, getAuthHeaders } from '../../config/api';

export class DecisionMakerAdapter implements IResearchAdapter {
  readonly metadata: ModuleMetadata = {
    id: 'decision-maker',
    name: 'Decision Maker Finder',
    description: "Searches Google via SerpApi or Serper.dev for LinkedIn profiles of the company's top people, picks the most senior verified executive matching the company, and extracts Name, Post, and LinkedIn URL.",
    badge: 'Dual Engine: SerpApi / Serper',
    category: 'People Intelligence',
    inputRequirements: ['Company Name', 'Website (optional)', 'Company LinkedIn URL (optional)'],
    outputFields: ['Decision Maker Name', 'Decision Maker Post', 'Decision Maker Linkedin', 'Decision Maker Confidence'],
    integrationNote: 'Directly executes Google dorking and hierarchical executive title ranking via SerpApi or Serper.dev.',
  };

  async enrichSingle(record: EnrichmentRecord, config: ResearchConfig): Promise<EnrichmentRecord> {
    const list = await this.enrichBatch([record], config);
    return list[0] || record;
  }

  async enrichBatch(
    records: EnrichmentRecord[],
    config: ResearchConfig,
    onProgress?: (progress: ResearchProgress) => void,
    signal?: AbortSignal,
    onChunk?: (chunkResults: EnrichmentRecord[]) => void
  ): Promise<EnrichmentRecord[]> {
    const totalCount = records.length;
    if (totalCount === 0) return [];

    const enrichedList: EnrichmentRecord[] = [];
    const startTime = Date.now();
    const batchSize = 1; // 1 record per batch for fast real-time feedback

    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      throw new Error(
        'Backend server URL is not configured. Please go to Settings to set your Backend API URL (or run locally on http://127.0.0.1:8000).'
      );
    }

    for (let i = 0; i < totalCount; i += batchSize) {
      if (signal?.aborted) {
        throw new DOMException('Operation cancelled', 'AbortError');
      }

      const chunk = records.slice(i, i + batchSize);
      const currentItem = chunk[0];
      const displayName = currentItem.companyName || currentItem.companyWebsite || `Record #${i + 1}`;

      const engine = config.decisionMakerEngine || 'serpapi';
      const engineLabel = engine === 'serper' ? 'Serper.dev' : 'SerpApi';

      onProgress?.({
        isActive: true,
        currentIndex: i + 1,
        totalCount,
        percentage: Math.round(((i + 0.3) / totalCount) * 100),
        status: 'running',
        stageMessage: `Querying ${engineLabel} Google LinkedIn registry for "${displayName}"...`,
        currentItemName: displayName,
        leadsFound: enrichedList.filter((r) => r.enrichmentStatus === 'enriched').length,
        leadsProcessed: i,
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
      });

      try {
        const payloadRecords = chunk.map((r) => {
          const compName =
            r.companyName ||
            r.customFields?.['Name'] ||
            r.customFields?.['Company'] ||
            r.customFields?.['Company Name'] ||
            r.customFields?.['company'] ||
            '';

          let siteUrl =
            r.companyWebsite ||
            r.domain ||
            r.customFields?.['Website'] ||
            r.customFields?.['Company URL'] ||
            r.customFields?.['website'] ||
            r.customFields?.['URL'] ||
            r.customFields?.['Domain'] ||
            '';

          let compLi =
            r.companyLinkedinUrl ||
            r.customFields?.['Linkedin'] ||
            r.customFields?.['Company Linkedin'] ||
            r.customFields?.['Company LinkedIn'] ||
            r.customFields?.['companyLinkedin'] ||
            '';

          return {
            ...r,
            companyName: compName,
            companyWebsite: siteUrl,
            companyLinkedinUrl: compLi,
          };
        });

        const response = await fetch(`${apiBase}/api/enrich/decision-makers`, {
          method: 'POST',
          headers: getAuthHeaders({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            records: payloadRecords,
            engine: engine,
            serperKey: config.serperApiKey,
            maxQueries: 2,
            delay: engine === 'serper' ? 0.6 : 0.5,
          }),
          signal,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.detail || `Server error (${response.status})`);
        }

        const data = await response.json();
        const serverResults: EnrichmentRecord[] = data.results || [];

        const mergedChunk: EnrichmentRecord[] = chunk.map((orig, idx) => {
          const enriched = serverResults[idx];
          if (!enriched) return orig;

          return {
            ...orig,
            personName: enriched.personName || orig.personName,
            title: enriched.title || orig.title,
            companyWebsite: enriched.companyWebsite || orig.companyWebsite,
            companyLinkedinUrl: enriched.companyLinkedinUrl || orig.companyLinkedinUrl,
            linkedinUrl: enriched.linkedinUrl || orig.linkedinUrl,
            confidenceScore: enriched.confidenceScore ?? orig.confidenceScore,
            enrichmentStatus: enriched.enrichmentStatus || 'enriched',
            notes: enriched.notes || orig.notes,
            lastEnrichedAt: enriched.lastEnrichedAt || new Date().toISOString(),
            customFields: {
              ...(orig.customFields || {}),
              ...(enriched.customFields || {}),
            },
          };
        });

        enrichedList.push(...mergedChunk);
        if (onChunk) {
          onChunk(mergedChunk);
        }

        const foundSoFar = enrichedList.filter((r) => r.enrichmentStatus === 'enriched').length;
        const lastEnriched = mergedChunk[0];

        onProgress?.({
          isActive: true,
          currentIndex: Math.min(i + batchSize, totalCount),
          totalCount,
          percentage: Math.round(((i + batchSize) / totalCount) * 100),
          status: 'running',
          stageMessage: lastEnriched?.personName
            ? `Identified: ${lastEnriched.personName} (${lastEnriched.title}) for "${displayName}"`
            : `Completed analysis for "${displayName}"`,
          currentItemName: displayName,
          leadsFound: foundSoFar,
          leadsProcessed: Math.min(i + batchSize, totalCount),
          elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
        });
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw err;
        }

        console.error('Error enriching decision maker chunk:', err);
        const errorChunk: EnrichmentRecord[] = chunk.map((r) => ({
          ...r,
          enrichmentStatus: 'error',
          notes: `Failed: ${err.message || 'Unknown network error'}`,
        }));

        enrichedList.push(...errorChunk);
        if (onChunk) {
          onChunk(errorChunk);
        }
      }
    }

    onProgress?.({
      isActive: false,
      currentIndex: totalCount,
      totalCount,
      percentage: 100,
      status: 'completed',
      stageMessage: `Enrichment complete. Found ${enrichedList.filter((r) => r.enrichmentStatus === 'enriched').length} verified decision makers.`,
      currentItemName: '',
      leadsFound: enrichedList.filter((r) => r.enrichmentStatus === 'enriched').length,
      leadsProcessed: totalCount,
      elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
    });

    return enrichedList;
  }
}

export const decisionMakerService = new DecisionMakerAdapter();
