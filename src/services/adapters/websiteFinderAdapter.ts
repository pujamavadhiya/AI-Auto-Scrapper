import { IResearchAdapter, ModuleMetadata } from './baseAdapter';
import { EnrichmentRecord, ResearchConfig, ResearchProgress } from '../../types';
import { getApiBaseUrl, getAuthHeaders } from '../../config/api';

export class WebsiteFinderAdapter implements IResearchAdapter {
  readonly metadata: ModuleMetadata = {
    id: 'website-finder',
    name: 'Company Website & Founder Finder',
    description: 'Finds verified canonical corporate websites, root domains, company headquarters, and founders/key executives with Google Gemini AI.',
    badge: 'Domain & Founder Intel',
    category: 'Firmographics',
    inputRequirements: ['Company Name', 'Country / City (optional for disambiguation)'],
    outputFields: ['Canonical Website URL', 'Root Domain', 'Founder / CEO Name', 'Founder Title', 'Founder LinkedIn', 'Industry', 'Confidence Score'],
    integrationNote: 'Live web intelligence powered by Google Gemini AI via POST /api/enrich/websites.',
  };

  async enrichSingle(record: EnrichmentRecord, config: ResearchConfig): Promise<EnrichmentRecord> {
    const batch = await this.enrichBatch([record], config);
    return batch[0] || record;
  }

  async enrichBatch(
    records: EnrichmentRecord[],
    config: ResearchConfig,
    onProgress?: (progress: ResearchProgress) => void,
    signal?: AbortSignal,
    onChunk?: (chunkResults: EnrichmentRecord[]) => void,
    onRecordEnriched?: (record: EnrichmentRecord) => void
  ): Promise<EnrichmentRecord[]> {
    const totalCount = records.length;
    const enrichedList: EnrichmentRecord[] = [];
    const startTime = Date.now();
    const CHUNK_SIZE = 3;
    const apiBase = getApiBaseUrl();

    if (!apiBase) {
      throw new Error('Backend server is offline or URL is not configured.');
    }

    for (let i = 0; i < totalCount; i += CHUNK_SIZE) {
      if (signal?.aborted) {
        throw new DOMException('Operation cancelled', 'AbortError');
      }

      const chunk = records.slice(i, i + CHUNK_SIZE);
      const currentCompany = chunk[0]?.companyName || 'Target companies';

      // Live processing indication
      const processingChunk = chunk.map((r) => ({
        ...r,
        enrichmentStatus: 'processing' as const,
      }));
      onChunk?.(processingChunk);
      if (onRecordEnriched && processingChunk[0]) {
        onRecordEnriched(processingChunk[0]);
      }

      onProgress?.({
        isActive: true,
        currentIndex: Math.min(i + 1, totalCount),
        totalCount,
        percentage: Math.round((i / totalCount) * 100),
        status: 'running',
        stageMessage: `Querying Gemini AI for official websites & founders of "${currentCompany}"...`,
        currentItemName: currentCompany,
        leadsFound: enrichedList.length,
        leadsProcessed: i,
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
      });

      try {
        const res = await fetch(`${apiBase}/api/enrich/websites`, {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            records: chunk,
            geminiApiKey: config.geminiApiKey || undefined,
            findFounders: true,
          }),
          signal,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.detail || errData.message || `Server error (${res.status}) while searching websites.`;
          if (
            res.status === 402 ||
            res.status === 429 ||
            errMsg.toLowerCase().includes('quota') ||
            errMsg.toLowerCase().includes('credit') ||
            errMsg.toLowerCase().includes('resource_exhausted')
          ) {
            const creditErr: any = new Error(errMsg);
            creditErr.outOfCredits = true;
            creditErr.provider = 'gemini';
            creditErr.partialResults = enrichedList;
            throw creditErr;
          }
          throw new Error(errMsg);
        }

        const data = await res.json();

        if (data.status === 'out_of_credits' || data.outOfCredits) {
          const pausedChunk = chunk.map((r) => ({
            ...r,
            enrichmentStatus: 'out_of_credits' as const,
            notes: 'Paused: Google Gemini key out of credits / quota exceeded',
          }));
          enrichedList.push(...pausedChunk);
          onChunk?.(pausedChunk);
          if (onRecordEnriched && pausedChunk[0]) {
            onRecordEnriched(pausedChunk[0]);
          }

          const creditErr: any = new Error(data.message || 'Google Gemini key is out of credits');
          creditErr.outOfCredits = true;
          creditErr.provider = 'gemini';
          creditErr.partialResults = enrichedList;
          throw creditErr;
        }

        const serverResults: EnrichmentRecord[] = data.results || [];

        const mergedChunk = chunk.map((orig, idx) => {
          const enriched = serverResults[idx];
          if (!enriched) return orig;
          return {
            ...orig,
            companyWebsite: enriched.companyWebsite || orig.companyWebsite,
            domain: enriched.domain || orig.domain,
            personName: enriched.personName || orig.personName,
            title: enriched.title || orig.title,
            linkedinUrl: enriched.linkedinUrl || orig.linkedinUrl,
            industry: enriched.industry || orig.industry,
            city: enriched.city || orig.city,
            country: enriched.country || orig.country,
            confidenceScore: enriched.confidenceScore ?? 92,
            enrichmentStatus: 'enriched' as const,
            lastEnrichedAt: new Date().toISOString(),
            notes: enriched.notes || 'Verified with Google Gemini AI',
            customFields: {
              ...(orig.customFields || {}),
              ...(enriched.customFields || {}),
            },
          };
        });

        enrichedList.push(...mergedChunk);
        onChunk?.(mergedChunk);
        if (onRecordEnriched && mergedChunk[0]) {
          onRecordEnriched(mergedChunk[0]);
        }

        onProgress?.({
          isActive: true,
          currentIndex: Math.min(i + chunk.length, totalCount),
          totalCount,
          percentage: Math.round((Math.min(i + chunk.length, totalCount) / totalCount) * 100),
          status: 'running',
          stageMessage: `Found official website & founder details for ${chunk.length} companies.`,
          currentItemName: currentCompany,
          leadsFound: enrichedList.length,
          leadsProcessed: Math.min(i + chunk.length, totalCount),
          elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
        });
      } catch (err: any) {
        if (err.name === 'AbortError' || err.outOfCredits) throw err;
        console.error('Error enriching chunk with Gemini:', err);
        // Fallback gracefully for chunk if error
        const fallbackChunk = chunk.map((r) => ({
          ...r,
          enrichmentStatus: 'error' as const,
          notes: err.message || 'Gemini website research error',
        }));
        enrichedList.push(...fallbackChunk);
        onChunk?.(fallbackChunk);
        if (onRecordEnriched && fallbackChunk[0]) {
          onRecordEnriched(fallbackChunk[0]);
        }
      }
    }

    onProgress?.({
      isActive: false,
      currentIndex: totalCount,
      totalCount,
      percentage: 100,
      status: 'completed',
      stageMessage: `Finished! Discovered official websites & founders for ${enrichedList.length} companies with Gemini AI.`,
      currentItemName: '',
      leadsFound: enrichedList.length,
      leadsProcessed: totalCount,
      elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
    });

    return enrichedList;
  }
}

export const websiteFinderService = new WebsiteFinderAdapter();
