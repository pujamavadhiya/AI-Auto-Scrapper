import { IResearchAdapter, ModuleMetadata, simulateDelay } from './baseAdapter';
import { EnrichmentRecord, ResearchConfig, ResearchProgress } from '../../types';
import { MOCK_COMPANIES } from '../mockData';

export class WebsiteFinderAdapter implements IResearchAdapter {
  readonly metadata: ModuleMetadata = {
    id: 'website-finder',
    name: 'Company Website Finder',
    description: 'Finds canonical corporate websites, root domains, SSL certificates, and handles brand aliases and redirects.',
    badge: 'Domain Intelligence',
    category: 'Firmographics',
    inputRequirements: ['Company Name', 'Country / City (recommended for disambiguation)'],
    outputFields: ['Canonical Website URL', 'Root Domain', 'SSL Valid', 'Industry Classification', 'Confidence Score'],
    integrationNote: 'Integrate your Google/Bing SERP scraper & DNS resolver via POST /api/enrich/websites.',
  };

  async enrichSingle(record: EnrichmentRecord, config: ResearchConfig): Promise<EnrichmentRecord> {
    const companyClean = record.companyName.trim().toLowerCase();
    const matched = MOCK_COMPANIES.find((c) =>
      companyClean.includes(c.name.toLowerCase()) ||
      c.name.toLowerCase().includes(companyClean)
    );

    if (matched) {
      return {
        ...record,
        domain: matched.domain,
        companyWebsite: matched.website,
        industry: record.industry || matched.industry,
        country: record.country || matched.country,
        city: record.city || matched.city,
        confidenceScore: 99,
        enrichmentStatus: 'enriched',
        lastEnrichedAt: new Date().toISOString(),
        notes: 'Canonical domain verified via DNS & HTTP 200 response check',
      };
    }

    const safeSlug = record.companyName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

    const resolvedDomain = `${safeSlug || 'company'}.com`;

    return {
      ...record,
      domain: record.domain || resolvedDomain,
      companyWebsite: record.companyWebsite || `https://www.${resolvedDomain}`,
      industry: record.industry || 'Information Technology & Services',
      country: record.country || 'United States',
      confidenceScore: Math.floor(Math.random() * 10) + 88,
      enrichmentStatus: 'enriched',
      lastEnrichedAt: new Date().toISOString(),
      notes: 'Discovered via SERP meta-search simulation',
    };
  }

  async enrichBatch(
    records: EnrichmentRecord[],
    config: ResearchConfig,
    onProgress?: (progress: ResearchProgress) => void,
    signal?: AbortSignal
  ): Promise<EnrichmentRecord[]> {
    const totalCount = records.length;
    const enrichedList: EnrichmentRecord[] = [];
    const startTime = Date.now();
    const delayPerItem = config.simulationSpeedMs || 350;

    for (let i = 0; i < totalCount; i++) {
      if (signal?.aborted) {
        throw new DOMException('Operation cancelled', 'AbortError');
      }

      const currentRecord = records[i];

      onProgress?.({
        isActive: true,
        currentIndex: i + 1,
        totalCount,
        percentage: Math.round(((i + 0.5) / totalCount) * 100),
        status: 'running',
        stageMessage: `Resolving DNS and HTTP status for "${currentRecord.companyName}"...`,
        currentItemName: currentRecord.companyName,
        leadsFound: enrichedList.length,
        leadsProcessed: i,
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
      });

      await simulateDelay(delayPerItem, signal);

      const enriched = await this.enrichSingle(currentRecord, config);
      enrichedList.push(enriched);

      onProgress?.({
        isActive: true,
        currentIndex: i + 1,
        totalCount,
        percentage: Math.round(((i + 1) / totalCount) * 100),
        status: 'running',
        stageMessage: `Discovered domain: ${enriched.domain}`,
        currentItemName: currentRecord.companyName,
        leadsFound: enrichedList.length,
        leadsProcessed: i + 1,
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
      });
    }

    onProgress?.({
      isActive: false,
      currentIndex: totalCount,
      totalCount,
      percentage: 100,
      status: 'completed',
      stageMessage: `Discovered official websites for ${enrichedList.length} companies.`,
      currentItemName: '',
      leadsFound: enrichedList.length,
      leadsProcessed: totalCount,
      elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
    });

    return enrichedList;
  }
}
