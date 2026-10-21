import { IResearchAdapter, ModuleMetadata } from './baseAdapter';
import { EnrichmentRecord, ResearchConfig, ResearchProgress } from '../../types';

const API_BASE = 'http://127.0.0.1:8000';

export class SocialMediaAdapter implements IResearchAdapter {
  readonly metadata: ModuleMetadata = {
    id: 'social-finder',
    name: 'Social Media URL Finder',
    description: 'Scrapes verified Facebook, Instagram, LinkedIn, and Twitter/X URLs directly from company websites.',
    badge: 'Multi-Network',
    category: 'Digital Footprint',
    inputRequirements: ['Company Name', 'Website / Company URL'],
    outputFields: ['Facebook URL', 'Instagram URL', 'Company LinkedIn URL', 'Twitter/X URL', 'Confidence Score'],
    integrationNote: 'Directly crawls websites and extracts social links using concurrent regex parsers.',
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
    const batchSize = (config as any)?.batchSize || 5;
    const mode = (config as any)?.socialMode || 'website';
    const delay = (config as any)?.delay ?? (mode === 'company' ? 1.0 : 0);

    for (let i = 0; i < totalCount; i += batchSize) {
      if (signal?.aborted) {
        throw new DOMException('Operation cancelled', 'AbortError');
      }

      const chunk = records.slice(i, i + batchSize);
      const currentItem = chunk[0];

      onProgress?.({
        isActive: true,
        currentIndex: i + 1,
        totalCount,
        percentage: Math.round(((i + 0.5) / totalCount) * 100),
        status: 'running',
        stageMessage: `Scanning social profiles for "${currentItem.companyName || currentItem.companyWebsite || 'companies'}"...`,
        currentItemName: currentItem.companyName || currentItem.companyWebsite || '',
        leadsFound: enrichedList.filter((r) => r.facebookUrl || r.instagramUrl || r.companyLinkedinUrl || r.twitterUrl).length,
        leadsProcessed: i,
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
      });

      try {
        const payloadRecords = chunk.map((r) => ({
          ...r,
          Company: r.companyName,
          Website: r.companyWebsite || (r.domain ? `https://${r.domain}` : ''),
          Facebook: r.facebookUrl || '',
          Instagram: r.instagramUrl || '',
          Linkedin: r.companyLinkedinUrl || r.linkedinUrl || '',
          X: r.twitterUrl || '',
        }));

        const res = await fetch(`${API_BASE}/api/enrich/social-media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            records: payloadRecords,
            mode,
            batchSize: 5,
            delay: mode === 'company' ? 0.5 : 0,
          }),
          signal,
        });

        if (!res.ok) {
          throw new Error(`Social media API returned HTTP ${res.status}`);
        }

        const data = await res.json();
        const serverRecords: any[] = data.records || [];

        const chunkResults: EnrichmentRecord[] = [];
        for (let j = 0; j < chunk.length; j++) {
          const original = chunk[j];
          const enrichedServer = serverRecords[j] || {};

          const fb = enrichedServer.facebookUrl || enrichedServer.Facebook || original.facebookUrl || '';
          const ig = enrichedServer.instagramUrl || enrichedServer.Instagram || original.instagramUrl || '';
          const li = enrichedServer.companyLinkedinUrl || enrichedServer.Linkedin || original.companyLinkedinUrl || original.linkedinUrl || '';
          const tw = enrichedServer.twitterUrl || enrichedServer.X || original.twitterUrl || '';

          const hasSocial = Boolean(fb || ig || li || tw);
          const score = enrichedServer.confidenceScore ?? (hasSocial ? 90 : 0);

          const item: EnrichmentRecord = {
            ...original,
            facebookUrl: fb,
            instagramUrl: ig,
            companyLinkedinUrl: li,
            linkedinUrl: original.linkedinUrl || li,
            twitterUrl: tw,
            confidenceScore: score,
            enrichmentStatus: hasSocial ? 'enriched' : 'not_found',
            lastEnrichedAt: new Date().toISOString(),
            notes: hasSocial ? `Found social links via ${mode} scraper` : 'No social links detected on website',
          };
          enrichedList.push(item);
          chunkResults.push(item);
        }
        onChunk?.(chunkResults);
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw err;
        }
        // Fallback for failed network requests on this chunk
        const fallbackChunk: EnrichmentRecord[] = [];
        for (const r of chunk) {
          const item: EnrichmentRecord = {
            ...r,
            enrichmentStatus: 'error',
            notes: `Network error: ${err.message}`,
          };
          enrichedList.push(item);
          fallbackChunk.push(item);
        }
        onChunk?.(fallbackChunk);
      }

      onProgress?.({
        isActive: true,
        currentIndex: Math.min(i + batchSize, totalCount),
        totalCount,
        percentage: Math.round((Math.min(i + batchSize, totalCount) / totalCount) * 100),
        status: 'running',
        stageMessage: `Processed ${Math.min(i + batchSize, totalCount)}/${totalCount} companies.`,
        currentItemName: currentItem.companyName,
        leadsFound: enrichedList.filter((r) => r.facebookUrl || r.instagramUrl || r.companyLinkedinUrl || r.twitterUrl).length,
        leadsProcessed: Math.min(i + batchSize, totalCount),
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
      });
    }

    const foundTotal = enrichedList.filter((r) => r.facebookUrl || r.instagramUrl || r.companyLinkedinUrl || r.twitterUrl).length;

    onProgress?.({
      isActive: false,
      currentIndex: totalCount,
      totalCount,
      percentage: 100,
      status: 'completed',
      stageMessage: `Extracted verified social media links for ${foundTotal} companies (${totalCount} scanned).`,
      currentItemName: '',
      leadsFound: foundTotal,
      leadsProcessed: totalCount,
      elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
    });

    return enrichedList;
  }
}
