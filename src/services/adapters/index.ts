import { IResearchAdapter } from './baseAdapter';
import { DecisionMakerAdapter } from './decisionMakerAdapter';
import { LinkedInFinderAdapter } from './linkedinFinderAdapter';
import { ContactFinderAdapter } from './contactFinderAdapter';
import { WebsiteFinderAdapter } from './websiteFinderAdapter';
import { SocialMediaAdapter } from './socialMediaAdapter';
import { AIAssistantAdapter } from './aiAssistantAdapter';
import { ModuleType } from '../../types';

export const decisionMakerService = new DecisionMakerAdapter();
export const linkedinFinderService = new LinkedInFinderAdapter();
export const contactFinderService = new ContactFinderAdapter();
export const websiteFinderService = new WebsiteFinderAdapter();
export const socialMediaService = new SocialMediaAdapter();
export const aiAssistantService = new AIAssistantAdapter();

export function getAdapterForModule(moduleType: ModuleType): IResearchAdapter {
  switch (moduleType) {
    case 'decision-maker':
      return decisionMakerService;
    case 'linkedin-finder':
      return linkedinFinderService;
    case 'contact-finder':
      return contactFinderService;
    case 'website-finder':
      return websiteFinderService;
    case 'social-finder':
      return socialMediaService;
    default:
      return decisionMakerService;
  }
}

export * from './baseAdapter';
export * from './decisionMakerAdapter';
export * from './linkedinFinderAdapter';
export * from './contactFinderAdapter';
export * from './websiteFinderAdapter';
export * from './socialMediaAdapter';
export * from './aiAssistantAdapter';
