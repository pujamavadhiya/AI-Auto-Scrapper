import { ChatMessage } from '../../types';
import { getApiBaseUrl, getAuthHeaders } from '../../config/api';

export interface AIResearchResponse {
  message: ChatMessage;
}

export class AIAssistantAdapter {
  private getInitialGreeting(): ChatMessage {
    return {
      id: 'msg-welcome',
      role: 'assistant',
      content: `Hello! I am your **AI Auto Scrapper B2B Research Assistant**, powered by **Google Gemini AI**.

I can directly research prospective companies, identify key decision makers (CEOs, VPs, Directors), analyze market competitors, and draft personalized outreach strategies.

### What would you like to explore?
- **Decision Maker Discovery**: Find executive contacts (CEOs, CTOs, VPs) with verified titles & companies
- **Company Intelligence**: Analyze company products, market alternatives, and competitor positioning
- **Outreach Strategy**: Draft personalized executive cold emails and tailored value propositions

Select a suggested inquiry below or ask any research question to get started!`,
      timestamp: new Date().toISOString(),
      suggestedPrompts: [
        'Find the CEO and VP of Sales at Stripe',
        'List top 5 cybersecurity startups in Austin with decision makers',
        'Draft an executive cold email to the CTO of Datadog',
        'Compare Snowflake vs Databricks for enterprise outreach',
      ],
    };
  }

  getInitialMessages(): ChatMessage[] {
    return [this.getInitialGreeting()];
  }

  async checkStatus(): Promise<{ hasGeminiKey: boolean; maskedKey: string; engine: string }> {
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      return { hasGeminiKey: false, maskedKey: '', engine: 'Google Gemini' };
    }
    try {
      const res = await fetch(`${apiBase}/api/assistant/status`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn('Could not fetch assistant status:', e);
    }
    return { hasGeminiKey: false, maskedKey: '', engine: 'Google Gemini' };
  }

  async askAssistant(
    userQuery: string,
    history: ChatMessage[],
    geminiApiKey?: string,
    signal?: AbortSignal
  ): Promise<ChatMessage> {
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      throw new Error('Backend server is offline or URL is not configured. Please start backend on port 8000.');
    }

    const payload = {
      message: userQuery,
      history: history.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      })),
      geminiApiKey: geminiApiKey?.trim() || undefined,
    };

    const res = await fetch(`${apiBase}/api/assistant/chat`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const detail = errData.detail || `Server error (${res.status})`;
      throw new Error(detail);
    }

    const data = await res.json();
    return data.message;
  }
}

export const aiAssistantService = new AIAssistantAdapter();
