import { IResearchAdapter, ModuleMetadata } from './baseAdapter';
import { EnrichmentRecord, ResearchConfig, ResearchProgress } from '../../types';
import { getApiBaseUrl, getAuthHeaders } from '../../config/api';

export class ContactFinderAdapter implements IResearchAdapter {
  readonly metadata: ModuleMetadata = {
    id: 'contact-finder',
    name: 'Decision Maker Email & Phone Finder (LeadOcean)',
    description:
      'Extracts verified direct email addresses and phone numbers for decision makers using the LeadOcean API.',
    badge: 'LeadOcean API',
    category: 'Direct Outreach',
    inputRequirements: ['Company Name / Domain', 'Decision Maker Name', 'Decision Maker LinkedIn URL'],
    outputFields: ['Email', 'Phone', 'Enrich Status', 'Deliverability Status', 'Confidence Score'],
    integrationNote: 'Connects to your LeadOcean API configured via leadocean_config.json or LEADOCEAN_API_KEY in .env.',
  };

  async enrichSingle(record: EnrichmentRecord, config?: ResearchConfig): Promise<EnrichmentRecord> {
    const apiBase = getApiBaseUrl();
    const payloadRecord = {
      ...record,
      companyName: record.companyName || record.customFields?.['Company'] || record.customFields?.['Company Name'] || '',
      companyWebsite: record.companyWebsite || record.domain || record.customFields?.['Website'] || record.customFields?.['Company URL'] || '',
      personName: record.personName || record.customFields?.['Decision Maker Name'] || record.customFields?.['Name'] || '',
      linkedinUrl: record.linkedinUrl || record.customFields?.['Decision Maker Linkedin'] || record.customFields?.['Decision Maker LinkedIn'] || '',
    };

    try {
      const res = await fetch(`${apiBase}/api/enrich/contacts`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          records: [payloadRecord],
          delay: 0,
          overwrite: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Server error (${res.status})`);
      }

      const data = await res.json();
      const enriched = data.results?.[0];
      if (!enriched) return record;

      return {
        ...record,
        email: enriched.email || record.email,
        phone: enriched.phone || record.phone,
        emailStatus: enriched.email ? 'verified' : record.emailStatus,
        phoneType: enriched.phone ? 'direct' : record.phoneType,
        confidenceScore: enriched.confidenceScore ?? record.confidenceScore,
        enrichmentStatus: enriched.enrichmentStatus || 'enriched',
        notes: enriched.notes || record.notes,
        lastEnrichedAt: enriched.lastEnrichedAt || new Date().toISOString(),
        customFields: {
          ...(record.customFields || {}),
          ...(enriched.customFields || {}),
          Email: enriched.email || record.email || '',
          Phone: enriched.phone || record.phone || '',
          'Enrich Status': enriched.customFields?.['Enrich Status'] || (enriched.email || enriched.phone ? 'found' : 'no_data'),
        },
      };
    } catch (err: any) {
      return {
        ...record,
        enrichmentStatus: 'error',
        notes: `LeadOcean error: ${err.message}`,
        customFields: {
          ...(record.customFields || {}),
          'Enrich Status': 'error',
        },
      };
    }
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
    const apiBase = getApiBaseUrl();

    // Process in small batches of 3-5 for live real-time UI updates
    const chunkSize = 4;

    for (let i = 0; i < totalCount; i += chunkSize) {
      if (signal?.aborted) {
        throw new DOMException('Operation cancelled', 'AbortError');
      }

      const chunk = records.slice(i, i + chunkSize);
      const currentItemName = chunk[0]?.personName || chunk[0]?.companyName || `Lead ${i + 1}`;

      onProgress?.({
        isActive: true,
        currentIndex: i + 1,
        totalCount,
        percentage: Math.round((i / totalCount) * 100),
        status: 'running',
        stageMessage: `Querying LeadOcean API for ${currentItemName}...`,
        currentItemName,
        leadsFound: enrichedList.filter((r) => r.enrichmentStatus === 'enriched').length,
        leadsProcessed: i,
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
      });

      try {
        const payloadRecords = chunk.map((r) => {
          const compName =
            r.companyName ||
            r.customFields?.['Company'] ||
            r.customFields?.['Company Name'] ||
            r.customFields?.['company'] ||
            r.customFields?.['Name'] ||
            '';

          const siteUrl =
            r.companyWebsite ||
            r.domain ||
            r.customFields?.['Website'] ||
            r.customFields?.['Company URL'] ||
            r.customFields?.['website'] ||
            r.customFields?.['URL'] ||
            '';

          const dmName =
            r.personName ||
            r.customFields?.['Decision Maker Name'] ||
            r.customFields?.['Contact Name'] ||
            r.customFields?.['Full Name'] ||
            r.customFields?.['name'] ||
            '';

          const dmLi =
            r.linkedinUrl ||
            r.customFields?.['Decision Maker Linkedin'] ||
            r.customFields?.['Decision Maker LinkedIn'] ||
            r.customFields?.['Linkedin'] ||
            r.customFields?.['Linkedin URL'] ||
            '';

          return {
            ...r,
            companyName: compName,
            companyWebsite: siteUrl,
            personName: dmName,
            linkedinUrl: dmLi,
          };
        });

        const response = await fetch(`${apiBase}/api/enrich/contacts`, {
          method: 'POST',
          headers: getAuthHeaders({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            records: payloadRecords,
            delay: 0.3,
            overwrite: false,
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

          const email = enriched.email || orig.email || '';
          const phone = enriched.phone || orig.phone || '';
          const enrichStatus = enriched.customFields?.['Enrich Status'] || (email || phone ? 'found' : 'no_data');

          return {
            ...orig,
            email: email || undefined,
            phone: phone || undefined,
            emailStatus: email ? 'verified' : orig.emailStatus,
            phoneType: phone ? 'direct' : orig.phoneType,
            confidenceScore: enriched.confidenceScore ?? orig.confidenceScore,
            enrichmentStatus: enriched.enrichmentStatus || (email || phone ? 'enriched' : 'not_found'),
            notes: enriched.notes || orig.notes,
            lastEnrichedAt: enriched.lastEnrichedAt || new Date().toISOString(),
            customFields: {
              ...(orig.customFields || {}),
              ...(enriched.customFields || {}),
              Email: email,
              Phone: phone,
              'Enrich Status': enrichStatus,
            },
          };
        });

        enrichedList.push(...mergedChunk);
      } catch (err: any) {
        if (err.name === 'AbortError') throw err;

        console.error('LeadOcean chunk error:', err);
        // Fallback gracefully for chunk records
        for (const item of chunk) {
          enrichedList.push({
            ...item,
            enrichmentStatus: 'error',
            notes: `LeadOcean error: ${err.message}`,
            customFields: {
              ...(item.customFields || {}),
              'Enrich Status': 'error',
            },
          });
        }
      }

      onProgress?.({
        isActive: true,
        currentIndex: Math.min(i + chunkSize, totalCount),
        totalCount,
        percentage: Math.round((Math.min(i + chunkSize, totalCount) / totalCount) * 100),
        status: 'running',
        stageMessage: `Enriched ${enrichedList.length} of ${totalCount} records`,
        currentItemName,
        leadsFound: enrichedList.filter((r) => r.email || r.phone).length,
        leadsProcessed: Math.min(i + chunkSize, totalCount),
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
      });
    }

    onProgress?.({
      isActive: false,
      currentIndex: totalCount,
      totalCount,
      percentage: 100,
      status: 'completed',
      stageMessage: `LeadOcean completed! Found contacts for ${
        enrichedList.filter((r) => r.email || r.phone).length
      } leads.`,
      currentItemName: '',
      leadsFound: enrichedList.filter((r) => r.email || r.phone).length,
      leadsProcessed: totalCount,
      elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
    });

    return enrichedList;
  }
}
