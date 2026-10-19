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
    };

    const normalize = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');

    for (const header of headers) {
      const norm = normalize(header);

      if (!mapping.companyName && (norm.includes('company') || norm.includes('organization') || norm.includes('account') || norm.includes('business'))) {
        mapping.companyName = header;
      } else if (!mapping.personName && (norm.includes('contact') || norm.includes('fullname') || norm.includes('person') || norm.includes('name') || norm.includes('lead'))) {
        mapping.personName = header;
      } else if (!mapping.title && (norm.includes('title') || norm.includes('job') || norm.includes('role') || norm.includes('position') || norm.includes('designation'))) {
        mapping.title = header;
      } else if (!mapping.domain && (norm.includes('domain') || norm.includes('url') || norm.includes('website') || norm.includes('web'))) {
        mapping.domain = header;
      } else if (!mapping.country && (norm.includes('country') || norm.includes('location') || norm.includes('nation') || norm.includes('region'))) {
        mapping.country = header;
      } else if (!mapping.industry && (norm.includes('industry') || norm.includes('sector') || norm.includes('vertical') || norm.includes('category'))) {
        mapping.industry = header;
      }
    }

    // Fallback if companyName still empty: take the first column
    if (!mapping.companyName && headers.length > 0) {
      mapping.companyName = headers[0];
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
      const domainVal = mapping.domain ? String(row[mapping.domain] || '').trim() : '';
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

      return {
        id: `rec-${Date.now()}-${index + 1}`,
        companyName: companyVal || `Company #${index + 1}`,
        personName: personVal || undefined,
        title: titleVal || undefined,
        domain: domainVal || undefined,
        country: countryVal || undefined,
        industry: industryVal || undefined,
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
        'Twitter URL': record.twitterUrl || '',
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
