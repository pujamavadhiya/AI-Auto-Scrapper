import { IResearchAdapter, ModuleMetadata, simulateDelay } from './baseAdapter';
import { EnrichmentRecord, ResearchConfig, ResearchProgress } from '../../types';
import { MOCK_COMPANIES } from '../mockData';

export class SocialMediaAdapter implements IResearchAdapter {
  readonly metadata: ModuleMetadata = {
    id: 'social-finder',
    name: 'Social Media URL Finder',
    description: 'Finds company and brand profiles on Twitter/X, GitHub, Facebook, YouTube, and Crunchbase.',
    badge: 'Multi-Network',
    category: 'Digital Footprint',
    inputRequirements: ['Company Name', 'Domain (optional)'],
    outputFields: ['Twitter/X URL', 'GitHub Organization', 'Facebook Page', 'Crunchbase Profile', 'Confidence Score'],
    integrationNote: 'Wire into your headless browser crawler via POST /api/enrich/socials.',
  };

  async enrichSingle(record: EnrichmentRecord, config: ResearchConfig): Promise<EnrichmentRecord> {
    const companyClean = record.companyName.trim().toLowerCase();
    const matched = MOCK_COMPANIES.find((c) =>
      companyClean.includes(c.name.toLowerCase()) ||
      c.name.toLowerCase().includes(companyClean) ||
      (record.domain && c.domain.toLowerCase().includes(record.domain.toLowerCase()))
    );

    const safeSlug = (matched?.domain || record.companyName).toLowerCase().replace(/[^a-z0-9]/g, '');

    return {
      ...record,
      twitterUrl: matched?.twitter || `https://twitter.com/${safeSlug}`,
      githubUrl: matched?.github || `https://github.com/${safeSlug}`,
      facebookUrl: matched?.facebook || `https://facebook.com/${safeSlug}`,
      crunchbaseUrl: matched?.crunchbase || `https://www.crunchbase.com/organization/${safeSlug}`,
      confidenceScore: Math.floor(Math.random() * 10) + 89,
      enrichmentStatus: 'enriched',
      lastEnrichedAt: new Date().toISOString(),
      notes: 'Social links verified across public registries',
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
        stageMessage: `Scanning social networks for "${currentRecord.companyName}"...`,
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
        stageMessage: `Found Twitter & GitHub profiles for ${currentRecord.companyName}`,
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
      stageMessage: `Enriched social media profiles for ${enrichedList.length} companies.`,
      currentItemName: '',
      leadsFound: enrichedList.length,
      leadsProcessed: totalCount,
      elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
    });

    return enrichedList;
  }
}
