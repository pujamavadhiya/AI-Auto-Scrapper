import { IResearchAdapter, ModuleMetadata, simulateDelay } from './baseAdapter';
import { EnrichmentRecord, ResearchConfig, ResearchProgress } from '../../types';
import { MOCK_COMPANIES } from '../mockData';

export class ContactFinderAdapter implements IResearchAdapter {
  readonly metadata: ModuleMetadata = {
    id: 'contact-finder',
    name: 'Decision Maker Email & Phone Finder',
    description: 'Generates corporate email permutations, checks MX/SMTP deliverability, and extracts verified direct dial numbers.',
    badge: 'Contact Discovery',
    category: 'Direct Outreach',
    inputRequirements: ['Company Name / Domain', 'Person Full Name', 'Job Title (recommended)'],
    outputFields: ['Verified Email', 'Email Deliverability Status', 'Direct Phone', 'Phone Line Type', 'Confidence Score'],
    integrationNote: 'Connect to your SMTP pinging & phone lookup worker via POST /api/enrich/contacts.',
  };

  async enrichSingle(record: EnrichmentRecord, config: ResearchConfig): Promise<EnrichmentRecord> {
    const companyClean = record.companyName.trim().toLowerCase();
    const matched = MOCK_COMPANIES.find((c) =>
      companyClean.includes(c.name.toLowerCase()) ||
      c.name.toLowerCase().includes(companyClean) ||
      (record.domain && c.domain.toLowerCase().includes(record.domain.toLowerCase()))
    );

    const domain = record.domain || matched?.domain || `${record.companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
    const personName = record.personName || matched?.decisionMakers[0]?.name || 'Executive Contact';
    const title = record.title || matched?.decisionMakers[0]?.title || 'Managing Director';

    let email = record.email;
    let emailStatus = record.emailStatus || 'verified';
    let phone = record.phone;
    let phoneType = record.phoneType || 'direct';

    if (matched && matched.decisionMakers.length > 0) {
      const dm = matched.decisionMakers[0];
      email = dm.email;
      emailStatus = dm.emailStatus;
      phone = dm.phone;
      phoneType = dm.phoneType;
    } else {
      // Algorithmic pattern generator
      const names = personName.trim().split(' ');
      const first = (names[0] || 'lead').toLowerCase().replace(/[^a-z]/g, '');
      const last = (names[names.length - 1] || 'contact').toLowerCase().replace(/[^a-z]/g, '');

      // Common corporate email patterns: first.last@domain or first@domain
      email = `${first}.${last}@${domain}`;
      emailStatus = Math.random() > 0.15 ? 'verified' : 'probable';
      const randomPrefix = Math.floor(Math.random() * 800) + 200;
      const randomMid = Math.floor(Math.random() * 900) + 100;
      const randomEnd = Math.floor(Math.random() * 9000) + 1000;
      phone = `+1 (${randomPrefix}) ${randomMid}-${randomEnd}`;
      phoneType = Math.random() > 0.4 ? 'direct' : 'mobile';
    }

    return {
      ...record,
      personName,
      title,
      domain,
      email: config.verifyEmails !== false ? email : record.email,
      emailStatus: config.verifyEmails !== false ? emailStatus : undefined,
      phone: config.findDirectPhones !== false ? phone : record.phone,
      phoneType: config.findDirectPhones !== false ? phoneType : undefined,
      confidenceScore: emailStatus === 'verified' ? 98 : 84,
      enrichmentStatus: 'enriched',
      lastEnrichedAt: new Date().toISOString(),
      notes: `Verified SMTP handshake simulation for ${email}`,
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
    const delayPerItem = config.simulationSpeedMs || 450;

    for (let i = 0; i < totalCount; i++) {
      if (signal?.aborted) {
        throw new DOMException('Operation cancelled', 'AbortError');
      }

      const currentRecord = records[i];

      // SMTP / MX step
      onProgress?.({
        isActive: true,
        currentIndex: i + 1,
        totalCount,
        percentage: Math.round(((i + 0.3) / totalCount) * 100),
        status: 'running',
        stageMessage: `Pinging MX mail exchangers for ${currentRecord.companyName}...`,
        currentItemName: currentRecord.companyName,
        leadsFound: enrichedList.length,
        leadsProcessed: i,
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
      });

      await simulateDelay(delayPerItem * 0.4, signal);

      // Phone registry step
      onProgress?.({
        isActive: true,
        currentIndex: i + 1,
        totalCount,
        percentage: Math.round(((i + 0.7) / totalCount) * 100),
        status: 'running',
        stageMessage: `Looking up telecom carrier direct lines...`,
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
        stageMessage: `Verified: ${enriched.email} (${enriched.emailStatus})`,
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
      stageMessage: `Successfully discovered contact info for ${enrichedList.length} leads.`,
      currentItemName: '',
      leadsFound: enrichedList.length,
      leadsProcessed: totalCount,
      elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
    });

    return enrichedList;
  }
}
