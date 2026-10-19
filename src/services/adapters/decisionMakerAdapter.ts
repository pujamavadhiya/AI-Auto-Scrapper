import { IResearchAdapter, ModuleMetadata, simulateDelay } from './baseAdapter';
import { EnrichmentRecord, ResearchConfig, ResearchProgress } from '../../types';
import { MOCK_COMPANIES } from '../mockData';

export class DecisionMakerAdapter implements IResearchAdapter {
  readonly metadata: ModuleMetadata = {
    id: 'decision-maker',
    name: 'Decision Maker Finder',
    description: 'Pinpoints executive leadership, C-suite, VPs, and Department Heads from corporate registries and professional networks.',
    badge: 'Core Enrichment',
    category: 'People Intelligence',
    inputRequirements: ['Company Name', 'Domain (optional)', 'Target Seniority (optional)'],
    outputFields: ['Decision Maker Name', 'Exact Job Title', 'Department', 'Confidence Score', 'Enrichment Status'],
    integrationNote: 'Plugs directly into your custom Scraping Module via POST /api/enrich/decision-makers when ready.',
  };

  async enrichSingle(record: EnrichmentRecord, config: ResearchConfig): Promise<EnrichmentRecord> {
    const companyClean = record.companyName.trim().toLowerCase();
    const matched = MOCK_COMPANIES.find((c) =>
      companyClean.includes(c.name.toLowerCase()) ||
      c.name.toLowerCase().includes(companyClean) ||
      (record.domain && c.domain.toLowerCase().includes(record.domain.toLowerCase()))
    );

    if (matched && matched.decisionMakers.length > 0) {
      // Pick a decision maker respecting seniority if possible
      let dm = matched.decisionMakers[0];
      if (config.seniorityLevels && config.seniorityLevels.length > 0 && !config.seniorityLevels.includes('All')) {
        const found = matched.decisionMakers.find((d) =>
          config.seniorityLevels?.some((lvl) => d.title.toLowerCase().includes(lvl.toLowerCase()))
        );
        if (found) dm = found;
      }

      return {
        ...record,
        personName: dm.name,
        title: dm.title,
        domain: record.domain || matched.domain,
        companyWebsite: record.companyWebsite || matched.website,
        email: config.verifyEmails ? dm.email : record.email,
        emailStatus: config.verifyEmails ? dm.emailStatus : record.emailStatus,
        phone: config.findDirectPhones ? dm.phone : record.phone,
        phoneType: config.findDirectPhones ? dm.phoneType : record.phoneType,
        linkedinUrl: dm.linkedin,
        companyLinkedinUrl: matched.companyLinkedin,
        confidenceScore: dm.confidence,
        enrichmentStatus: 'enriched',
        lastEnrichedAt: new Date().toISOString(),
        notes: `Simulated match via AI Auto Scrapper Mock Registry for ${matched.name}`,
      };
    }

    // Dynamic fallback generation based on company name
    const syntheticTitle = config.seniorityLevels && config.seniorityLevels.length > 0 && !config.seniorityLevels.includes('All')
      ? `${config.seniorityLevels[0]} of Growth & Strategy`
      : 'Chief Executive Officer';

    const safeSlug = record.companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const syntheticDomain = record.domain || `${safeSlug || 'company'}.io`;

    return {
      ...record,
      personName: record.personName || 'Alexander Sterling',
      title: record.title || syntheticTitle,
      domain: syntheticDomain,
      companyWebsite: record.companyWebsite || `https://${syntheticDomain}`,
      email: config.verifyEmails ? `leadership@${syntheticDomain}` : record.email,
      emailStatus: 'probable',
      phone: config.findDirectPhones ? '+1 (555) 019-2834' : record.phone,
      phoneType: 'direct',
      linkedinUrl: `https://www.linkedin.com/in/exec-${safeSlug}`,
      companyLinkedinUrl: `https://www.linkedin.com/company/${safeSlug}`,
      confidenceScore: Math.floor(Math.random() * 15) + 82, // 82-96%
      enrichmentStatus: 'enriched',
      lastEnrichedAt: new Date().toISOString(),
      notes: 'Generated via algorithmic pattern simulation',
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
    const delayPerItem = config.simulationSpeedMs || 400;

    for (let i = 0; i < totalCount; i++) {
      if (signal?.aborted) {
        throw new DOMException('Operation cancelled', 'AbortError');
      }

      const currentRecord = records[i];

      // Stage 1: Initializing & querying indices
      onProgress?.({
        isActive: true,
        currentIndex: i + 1,
        totalCount,
        percentage: Math.round(((i + 0.3) / totalCount) * 100),
        status: 'running',
        stageMessage: `Querying executive directory for "${currentRecord.companyName}"...`,
        currentItemName: currentRecord.companyName,
        leadsFound: enrichedList.length,
        leadsProcessed: i,
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
      });

      await simulateDelay(delayPerItem * 0.4, signal);

      // Stage 2: Entity matching & validation
      onProgress?.({
        isActive: true,
        currentIndex: i + 1,
        totalCount,
        percentage: Math.round(((i + 0.7) / totalCount) * 100),
        status: 'running',
        stageMessage: `Matching decision maker titles (${config.seniorityLevels?.join(', ') || 'C-Suite'})...`,
        currentItemName: currentRecord.companyName,
        leadsFound: enrichedList.length,
        leadsProcessed: i,
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
      });

      await simulateDelay(delayPerItem * 0.6, signal);

      const enriched = await this.enrichSingle(currentRecord, config);
      enrichedList.push(enriched);

      onProgress?.({
        isActive: true,
        currentIndex: i + 1,
        totalCount,
        percentage: Math.round(((i + 1) / totalCount) * 100),
        status: 'running',
        stageMessage: `Identified: ${enriched.personName} (${enriched.title})`,
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
      stageMessage: `Batch finished. Successfully enriched ${enrichedList.length} decision makers.`,
      currentItemName: '',
      leadsFound: enrichedList.length,
      leadsProcessed: totalCount,
      elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
    });

    return enrichedList;
  }
}
