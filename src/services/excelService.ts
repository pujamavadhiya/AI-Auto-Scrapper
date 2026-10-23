import * as XLSX from 'xlsx';
import { EnrichmentRecord, ColumnMapping } from '../types';
import { downloadBlob } from '../lib/utils';

export interface ParsedFileResult {
  fileName: string;
  fileSize: number;
  sheetNames: string[];
  activeSheet: string;
  headers: string[];
  rows: Record<string, any>[];
  totalRows: number;
}

export const excelService = {
  /**
   * Parse uploaded Excel (.xlsx, .xls) or CSV file in the browser
   */
  async parseFile(file: File): Promise<ParsedFileResult> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];

          // Convert sheet to JSON array of objects
          const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, {
            defval: '',
            raw: false,
          });

          // Extract header row
          const headerRow = XLSX.utils.sheet_to_json<string[]>(worksheet, {
            header: 1,
            defval: '',
          })[0] || [];

          // Clean headers
          const headers = (headerRow as string[])
            .map((h) => String(h || '').trim())
            .filter((h) => h.length > 0);

          resolve({
            fileName: file.name,
            fileSize: file.size,
            sheetNames: workbook.SheetNames,
            activeSheet: firstSheetName,
            headers,
            rows: jsonData,
            totalRows: jsonData.length,
          });
        } catch (error) {
          reject(new Error(`Failed to parse file: ${(error as Error).message}`));
        }
      };

      reader.onerror = () => reject(new Error('File reading failed.'));
      reader.readAsBinaryString(file);
    });
  },

  /**
   * Automatically detect column mappings based on common header names
   */
  autoDetectMapping(headers: string[]): ColumnMapping {
    const mapping: ColumnMapping = {
      companyName: '',
      personName: '',
      title: '',
      domain: '',
      country: '',
      industry: '',
      linkedinUrl: '',
    };

    const normalize = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');

    for (const header of headers) {
      const norm = normalize(header);

      // 1. Detect LinkedIn URL FIRST to prevent it being mistakenly grabbed by generic 'url' check
      if (
        !mapping.linkedinUrl &&
        (norm.includes('linkedin') || norm.includes('profileurl') || norm.includes('dmurl'))
      ) {
        mapping.linkedinUrl = header;
      }
      // 2. Detect Person / Decision Maker Name (exclude if it mentions linkedin or url)
      else if (
        !mapping.personName &&
        !norm.includes('linkedin') &&
        !norm.includes('url') &&
        (norm.includes('decisionmaker') ||
          norm.includes('contactname') ||
          norm.includes('fullname') ||
          norm.includes('personname') ||
          norm === 'person' ||
          norm === 'contact' ||
          norm === 'lead' ||
          norm === 'name')
      ) {
        mapping.personName = header;
      }
      // 3. Detect Domain / Company Website (only if not a linkedin column)
      else if (
        !mapping.domain &&
        !norm.includes('linkedin') &&
        (norm.includes('domain') ||
          norm.includes('website') ||
          norm.includes('companyurl') ||
          norm.includes('homepage') ||
          norm === 'web' ||
          norm === 'site' ||
          norm === 'url')
      ) {
        mapping.domain = header;
      }
      // 4. Detect Company Name
      else if (
        !mapping.companyName &&
        !norm.includes('linkedin') &&
        !norm.includes('decisionmaker') &&
        (norm.includes('company') ||
          norm.includes('organization') ||
          norm.includes('organisation') ||
          norm.includes('business') ||
          norm.includes('account'))
      ) {
        mapping.companyName = header;
      }
      // 5. Job Title / Role
      else if (
        !mapping.title &&
        (norm.includes('title') ||
          norm.includes('job') ||
          norm.includes('role') ||
          norm.includes('position') ||
          norm.includes('post') ||
          norm.includes('designation'))
      ) {
        mapping.title = header;
      }
      // 6. Country / Location
      else if (
        !mapping.country &&
        (norm.includes('country') ||
          norm.includes('location') ||
          norm.includes('nation') ||
          norm.includes('region') ||
          norm.includes('city') ||
          norm.includes('state'))
      ) {
        mapping.country = header;
      }
      // 7. Industry
      else if (
        !mapping.industry &&
        (norm.includes('industry') ||
          norm.includes('sector') ||
          norm.includes('vertical') ||
          norm.includes('category'))
      ) {
        mapping.industry = header;
      }
    }

    // Fallback if companyName still empty: take the first non-domain/non-linkedin column
    if (!mapping.companyName && headers.length > 0) {
      const firstNonDomain =
        headers.find((h) => h !== mapping.domain && h !== mapping.linkedinUrl) || headers[0];
      mapping.companyName = firstNonDomain;
    }

    return mapping;
  },

  /**
   * Convert parsed raw spreadsheet rows into standard EnrichmentRecord items using column mapping
   */
  mapRowsToRecords(rows: Record<string, any>[], mapping: ColumnMapping): EnrichmentRecord[] {
    return rows.map((row, index) => {
      const companyVal = mapping.companyName ? String(row[mapping.companyName] || '').trim() : '';
      const personVal = mapping.personName ? String(row[mapping.personName] || '').trim() : '';
      const titleVal = mapping.title ? String(row[mapping.title] || '').trim() : '';
      let rawDomain = mapping.domain ? String(row[mapping.domain] || '').trim() : '';

      // If domain wasn't mapped, check if row contains 'Website' or 'Company URL' or 'Domain'
      if (!rawDomain) {
        for (const [k, v] of Object.entries(row)) {
          const lk = k.toLowerCase();
          if (!lk.includes('linkedin') && (lk.includes('website') || lk.includes('domain') || lk.includes('url')) && v) {
            rawDomain = String(v).trim();
            break;
          }
        }
      }

      // Clean and normalize website URL
      let cleanWebsite = rawDomain;
      if (cleanWebsite) {
        cleanWebsite = cleanWebsite.replace(/^(https?:\/\/)+/i, 'https://').trim();
        if (!cleanWebsite.startsWith('http://') && !cleanWebsite.startsWith('https://')) {
          cleanWebsite = `https://${cleanWebsite.replace(/^\/+/, '')}`;
        }
      }

      // Canonical host domain (e.g. stripe.com)
      const cleanDomain = rawDomain
        ? rawDomain
            .replace(/^https?:\/\//i, '')
            .replace(/^www\./i, '')
            .split('/')[0]
            .split('?')[0]
            .split('#')[0]
            .trim()
        : '';

      // Extract LinkedIn profile URL (decision maker LinkedIn)
      let rawLinkedin = mapping.linkedinUrl ? String(row[mapping.linkedinUrl] || '').trim() : '';
      if (!rawLinkedin) {
        for (const [k, v] of Object.entries(row)) {
          const lk = k.toLowerCase();
          if (lk.includes('linkedin') && v) {
            rawLinkedin = String(v).trim();
            break;
          }
        }
      }
      // Also scan values in case column name is arbitrary but value contains linkedin.com/in/
      if (!rawLinkedin) {
        for (const v of Object.values(row)) {
          const s = String(v || '').trim();
          if (s.includes('linkedin.com/in/')) {
            rawLinkedin = s;
            break;
          }
        }
      }

      let cleanLinkedin = rawLinkedin;
      const mLi = cleanLinkedin.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
      if (mLi) {
        cleanLinkedin = `https://www.linkedin.com/in/${mLi[1]}`;
      }

      const countryVal = mapping.country ? String(row[mapping.country] || '').trim() : '';
      const industryVal = mapping.industry ? String(row[mapping.industry] || '').trim() : '';

      // Preserve any unmapped columns as custom fields
      const customFields: Record<string, any> = {};
      const mappedHeaders = Object.values(mapping).filter(Boolean);
      for (const [key, val] of Object.entries(row)) {
        if (!mappedHeaders.includes(key)) {
          customFields[key] = val;
        }
      }

      // Also ensure standard keys are present in customFields for export compatibility
      if (cleanLinkedin) {
        customFields['Decision Maker Linkedin'] = cleanLinkedin;
        customFields['Decision Maker LinkedIn URL'] = cleanLinkedin;
      }
      if (personVal) {
        customFields['Decision Maker Name'] = personVal;
      }
      if (companyVal) {
        customFields['Company Name'] = companyVal;
      }

      // Extract existing social media URLs if present in the uploaded sheet
      const getVal = (...keys: string[]) => {
        for (const k of keys) {
          if (row[k]) return String(row[k]).trim();
          if (customFields[k]) return String(customFields[k]).trim();
        }
        return '';
      };

      const existingFb = getVal('Facebook', 'facebookUrl', 'Facebook URL', 'facebook');
      const existingIg = getVal('Instagram', 'instagramUrl', 'Instagram URL', 'instagram');
      const existingLi = getVal('Company Linkedin', 'Company LinkedIn', 'companyLinkedinUrl');
      const existingTw = getVal('X', 'Twitter', 'twitterUrl', 'Twitter URL', 'Twitter / X URL', 'x', 'twitter');

      return {
        id: `rec-${Date.now()}-${index + 1}`,
        companyName: companyVal || `Company #${index + 1}`,
        companyWebsite: cleanWebsite || undefined,
        domain: cleanDomain || undefined,
        personName: personVal || undefined,
        title: titleVal || undefined,
        linkedinUrl: cleanLinkedin || undefined,
        country: countryVal || undefined,
        industry: industryVal || undefined,
        facebookUrl: existingFb || undefined,
        instagramUrl: existingIg || undefined,
        companyLinkedinUrl: existingLi || undefined,
        twitterUrl: existingTw || undefined,
        enrichmentStatus: 'idle',
        confidenceScore: undefined,
        customFields,
      };
    });
  },

  /**
   * Export records directly to Excel (.xlsx) or CSV (.csv) file in browser
   */
  exportRecords(
    records: EnrichmentRecord[],
    options: {
      fileName: string;
      format: 'xlsx' | 'csv';
      selectedColumns?: string[];
      includeConfidenceScore?: boolean;
    }
  ): { fileName: string; sizeBytes: number } {
    const { fileName, format, selectedColumns, includeConfidenceScore = true } = options;

    // Build tabular export rows
    const exportData = records.map((record) => {
      const row: Record<string, any> = {
        'Company Name': record.companyName || '',
        'Domain / Website': record.domain || record.companyWebsite || '',
        'Decision Maker Name': record.personName || '',
        'Job Title': record.title || '',
        'Email Address': record.email || '',
        'Email Status': record.emailStatus || '',
        'Phone Number': record.phone || '',
        'Phone Type': record.phoneType || '',
        'LinkedIn URL': record.linkedinUrl || '',
        'Match Status': record.matchStatus || (record.linkedinUrl ? 'Found' : 'Not verified'),
        'Confidence': record.confidenceLevel || (record.confidenceScore ? `${record.confidenceScore}%` : ''),
        'Matched Profile Name': record.matchedName || '',
        'Matched Headline': record.matchedHeadline || '',
        'Match Evidence': record.evidence || '',
        'Company LinkedIn': record.companyLinkedinUrl || '',
        'Facebook URL': record.facebookUrl || '',
        'Instagram URL': record.instagramUrl || '',
        'Twitter / X URL': record.twitterUrl || '',
        'Industry': record.industry || '',
        'Location': [record.city, record.country].filter(Boolean).join(', ') || '',
        'Enrichment Status': record.enrichmentStatus || 'idle',
      };

      if (includeConfidenceScore) {
        row['Confidence Score (%)'] = record.confidenceScore !== undefined ? `${record.confidenceScore}%` : 'N/A';
      }

      if (record.lastEnrichedAt) {
        row['Enriched Date'] = new Date(record.lastEnrichedAt).toLocaleString();
      }

      // If specific columns were requested, filter only those
      if (selectedColumns && selectedColumns.length > 0) {
        const filteredRow: Record<string, any> = {};
        for (const col of selectedColumns) {
          if (col in row) {
            filteredRow[col] = row[col];
          }
        }
        return filteredRow;
      }

      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);

    // Auto-fit column widths for polished presentation
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
    const colWidths: { wch: number }[] = [];
    for (let C = range.s.c; C <= range.e.c; ++C) {
      colWidths[C] = { wch: 22 };
    }
    worksheet['!cols'] = colWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Enriched Leads');

    const cleanBaseName = fileName.replace(/\.(xlsx|csv)$/i, '');
    const finalFileName = `${cleanBaseName}.${format}`;

    let blob: Blob;
    if (format === 'csv') {
      const csvOutput = XLSX.utils.sheet_to_csv(worksheet);
      blob = new Blob([csvOutput], { type: 'text/csv;charset=utf-8;' });
    } else {
      const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }

    downloadBlob(blob, finalFileName);

    return {
      fileName: finalFileName,
      sizeBytes: blob.size,
    };
  },

  /**
   * Generate a ready-to-use sample template file (.xlsx or .csv) for user testing
   */
  downloadSampleTemplate(format: 'xlsx' | 'csv' = 'xlsx') {
    const sampleRows = [
      {
        'Company Name': 'Stripe, Inc.',
        'Target Role / Title': 'CEO',
        'Website / Domain': 'stripe.com',
        'Country': 'United States',
        'Industry': 'FinTech',
      },
      {
        'Company Name': 'Datadog',
        'Target Role / Title': 'Chief Technology Officer',
        'Website / Domain': 'datadoghq.com',
        'Country': 'United States',
        'Industry': 'Cloud SaaS',
      },
      {
        'Company Name': 'Snowflake',
        'Target Role / Title': 'VP of Sales',
        'Website / Domain': 'snowflake.com',
        'Country': 'United States',
        'Industry': 'Data Cloud',
      },
      {
        'Company Name': 'Figma',
        'Target Role / Title': 'Head of Product',
        'Website / Domain': 'figma.com',
        'Country': 'United States',
        'Industry': 'Design Tools',
      },
      {
        'Company Name': 'Notion Labs',
        'Target Role / Title': 'Founder & CEO',
        'Website / Domain': 'notion.so',
        'Country': 'United States',
        'Industry': 'Productivity',
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sample Companies');

    const fileName = `AI_Auto_Scrapper_Sample_Import_Template.${format}`;
    let blob: Blob;
    if (format === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(worksheet);
      blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    } else {
      const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }

    downloadBlob(blob, fileName);
  },
};
