export type ModuleType =
  | 'decision-maker'
  | 'linkedin-finder'
  | 'contact-finder'
  | 'website-finder'
  | 'social-finder'
  | 'ai-assistant';

export type VerificationStatus = 'verified' | 'catch-all' | 'probable' | 'unverified';
export type JobSeniority = 'C-Level' | 'VP' | 'Director' | 'Manager' | 'Senior' | 'All';

export interface EnrichmentRecord {
  id: string;
  // Raw uploaded / mapped fields
  companyName: string;
  domain?: string;
  personName?: string;
  title?: string;
  country?: string;
  city?: string;
  industry?: string;

  // Enriched contact info
  email?: string;
  emailStatus?: VerificationStatus;
  phone?: string;
  phoneType?: 'direct' | 'hq' | 'mobile';

  // Enriched links & socials
  companyWebsite?: string;
  linkedinUrl?: string;
  companyLinkedinUrl?: string;
  twitterUrl?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  githubUrl?: string;
  crunchbaseUrl?: string;

  // Algorithm match verification details (LinkedIn Finder SerpAPI)
  matchStatus?: string;
  confidenceLevel?: 'High' | 'Medium' | string;
  matchedName?: string;
  matchedHeadline?: string;
  evidence?: string;

  // Metadata & scores
  confidenceScore?: number; // 0 to 100
  enrichmentStatus: 'idle' | 'processing' | 'enriched' | 'not_found' | 'error';
  lastEnrichedAt?: string;
  notes?: string;

  // Arbitrary additional custom columns preserved from user import
  customFields?: Record<string, any>;
}

export interface ColumnMapping {
  companyName: string;
  personName?: string;
  title?: string;
  domain?: string;
  country?: string;
  industry?: string;
  [key: string]: string | undefined;
}

export interface ResearchConfig {
  seniorityLevels?: string[];
  departments?: string[];
  maxContactsPerCompany?: number;
  countryFilter?: string;
  verifyEmails?: boolean;
  findDirectPhones?: boolean;
  findPersonalLinkedIn?: boolean;
  findCompanyLinkedIn?: boolean;
  deepWebsiteDiscovery?: boolean;
  socialPlatforms?: string[];
  confidenceThreshold?: number; // e.g. 70%
  simulationSpeedMs?: number; // Mock processing delay
  openAiApiKey?: string;
  openAiModel?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  moduleType: ModuleType;
  records: EnrichmentRecord[];
  config: ResearchConfig;
  status: 'draft' | 'running' | 'completed' | 'paused';
  createdAt: string;
  updatedAt: string;
  sourceFileName?: string;
  totalRecords: number;
  enrichedRecords: number;
}

export interface ExportHistoryItem {
  id: string;
  projectId?: string;
  projectName: string;
  fileName: string;
  format: 'xlsx' | 'csv';
  recordCount: number;
  exportScope: 'all' | 'filtered' | 'selected';
  exportedAt: string;
  moduleType: ModuleType;
  fileSizeBytes?: number;
}

export interface ResearchProgress {
  isActive: boolean;
  currentIndex: number;
  totalCount: number;
  percentage: number;
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'error';
  stageMessage: string;
  currentItemName: string;
  leadsFound: number;
  leadsProcessed: number;
  elapsedSeconds: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  suggestedPrompts?: string[];
  dataPayload?: {
    type: 'company_profile' | 'leads_table' | 'enrichment_summary';
    title?: string;
    items?: any[];
  };
}

export interface AppSettings {
  simulationSpeed: 'fast' | 'realistic' | 'thorough';
  defaultExportFormat: 'xlsx' | 'csv';
  includeConfidenceScore: boolean;
  includeTimestampInExport: boolean;
  customScraperEndpoint?: string;
  adapterMode: 'mock' | 'custom_api' | 'real';
  openAiApiKey?: string;
  openAiModel?: string;
}
