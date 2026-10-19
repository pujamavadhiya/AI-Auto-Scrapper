import { ChatMessage } from '../../types';
import { MOCK_COMPANIES } from '../mockData';
import { simulateDelay } from './baseAdapter';

export interface AIResearchResponse {
  message: ChatMessage;
}

export class AIAssistantAdapter {
  private getInitialGreeting(): ChatMessage {
    return {
      id: 'msg-welcome',
      role: 'assistant',
      content: `Hello! I am your **AI Auto Scrapper Assistant**. 

I can help you analyze prospective B2B accounts, identify decision makers, craft cold outreach angles, and discover market competitors.

*Note: All data provided in this environment is generated via simulated research models and mock registries.*

What would you like to explore today?`,
      timestamp: new Date().toISOString(),
      suggestedPrompts: [
        'Find key decision makers at Stripe and Datadog',
        'Compare Snowflake and Datadog for enterprise outreach',
        'Analyze Figma leadership structure and recent hiring focus',
        'Generate cold email icebreakers for Alexandr Wang at Scale AI',
      ],
    };
  }

  getInitialMessages(): ChatMessage[] {
    return [this.getInitialGreeting()];
  }

  async askAssistant(
    userQuery: string,
    history: ChatMessage[],
    signal?: AbortSignal
  ): Promise<ChatMessage> {
    // Simulate streaming / thinking delay
    await simulateDelay(600, signal);

    const q = userQuery.toLowerCase();

    // Check if query matches any of our mock companies
    const matchedCompany = MOCK_COMPANIES.find((c) =>
      q.includes(c.name.toLowerCase()) ||
      c.name.toLowerCase().includes(q) ||
      q.includes(c.domain.toLowerCase())
    );

    if (q.includes('decision maker') || q.includes('leadership') || q.includes('who is the ceo') || q.includes('contacts')) {
      if (matchedCompany) {
        const leaders = matchedCompany.decisionMakers
          .map(
            (dm) =>
              `- **${dm.name}** — *${dm.title}* (${dm.department})\n  📧 Email: \`${dm.email}\` (${dm.emailStatus})\n  📞 Phone: \`${dm.phone}\`\n  🔗 LinkedIn: [Profile](${dm.linkedin})`
          )
          .join('\n\n');

        return {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: `Here is the verified executive leadership hierarchy identified for **${matchedCompany.name}** (${matchedCompany.website}):

${leaders}

### Key Outreach Angle
> ${matchedCompany.name} operates heavily in ${matchedCompany.industry}. Target the VP of Product or CTO when pitching technical integrations, or CEO Patrick / Olivier for strategic partnerships.

*(Simulated mock research output — ready for live scraper adapter integration)*`,
          timestamp: new Date().toISOString(),
          suggestedPrompts: [
            `Find direct phone numbers for ${matchedCompany.name}`,
            `Export decision makers at ${matchedCompany.name} to CSV`,
            `Analyze competitive positioning for ${matchedCompany.name}`,
          ],
          dataPayload: {
            type: 'leads_table',
            title: `Decision Makers at ${matchedCompany.name}`,
            items: matchedCompany.decisionMakers,
          },
        };
      }
    }

    if (q.includes('compare') || q.includes('vs') || (q.includes('snowflake') && q.includes('datadog'))) {
      return {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `### Comparative B2B Account Analysis

| Attribute | **Datadog** | **Snowflake** |
| :--- | :--- | :--- |
| **Primary Industry** | Cloud Monitoring & DevOps SaaS | Data Cloud & Data Warehousing |
| **Domain** | [datadoghq.com](https://datadoghq.com) | [snowflake.com](https://snowflake.com) |
| **Headquarters** | New York, NY | Bozeman, MT |
| **Key Decision Maker** | Olivier Pomel (CEO) | Sridhar Ramaswamy (CEO) |
| **Tech Focus** | Infrastructure observability, APM | Enterprise data lake, AI data sharing |
| **Outreach Readiness** | High (Multi-product cross-selling) | Very High (Migrating enterprise workloads) |

### Recommended Targeting Strategy:
1. **Datadog**: Engage Site Reliability Engineering (SRE) and DevOps leads. Emphasize reduction of alert fatigue.
2. **Snowflake**: Target Chief Data Officers and Heads of Business Intelligence. Pitch compute cost optimization.`,
        timestamp: new Date().toISOString(),
        suggestedPrompts: [
          'Find emails for Datadog SRE Directors',
          'Enrich Snowflake sales leadership',
          'Search for social profiles of Snowflake executives',
        ],
      };
    }

    if (q.includes('icebreaker') || q.includes('cold email') || q.includes('outreach')) {
      const targetName = matchedCompany ? matchedCompany.decisionMakers[0]?.name : 'Dylan Field';
      const targetCompany = matchedCompany ? matchedCompany.name : 'Figma';

      return {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `Here are **3 personalized cold outreach hooks** crafted for **${targetName}** at **${targetCompany}**:

#### Option 1: Product-Led & High Context
> **Subject**: Quick question regarding ${targetCompany}'s automated pipeline scalability
> 
> Hi ${targetName.split(' ')[0]},
> 
> Loved seeing your recent strides in accelerating collaboration across engineering and product teams. As ${targetCompany} scales its enterprise accounts, data hygiene and real-time enrichment usually become key bottlenecks.
> 
> We recently assisted a comparable enterprise SaaS streamline lead qualification cycles by 42%. Would you be open to a 7-minute intro this Thursday?

#### Option 2: The Direct Executive Hook
> **Subject**: Streamlining decision-maker workflows for ${targetCompany}
> 
> Hi ${targetName.split(' ')[0]},
> 
> Reaching out directly given your oversight of ${targetCompany}'s expansion. We've compiled a brief benchmark analysis of your industry peers. 
> 
> Open to reviewing the summary deck?

Would you like me to refine the tone or draft follow-up sequence templates?`,
        timestamp: new Date().toISOString(),
        suggestedPrompts: [
          'Generate follow-up email #2 with case study',
          'Draft a LinkedIn connection note for this contact',
          'Find verified direct mobile number',
        ],
      };
    }

    // Default intelligent conversational response
    return {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      content: `I've analyzed your inquiry regarding: **"${userQuery}"**.

### Research Findings & Synthesis:
1. **Target Account Scope**: Evaluated against our database of high-growth technology, FinTech, and enterprise SaaS companies.
2. **Enrichment Opportunities**: You can run batch enrichment through any of our 5 specialized modules:
   - **Decision Maker Finder**: Extract names, C-suite titles, and departments.
   - **Contact Finder**: Test deliverability with MX and SMTP simulations.
   - **LinkedIn Finder**: Resolve corporate and personal profile URLs.
   - **Website & Social Finder**: Extract canonical domains and social channels.

You can also upload a custom .xlsx or .csv spreadsheet anytime to run batch operations with live progress tracking!`,
      timestamp: new Date().toISOString(),
      suggestedPrompts: [
        'Find decision makers at Notion Labs',
        'Discover websites and domains for Vercel and Brex',
        'Show me recent export history',
      ],
    };
  }
}

export const aiAssistantService = new AIAssistantAdapter();
