import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Bot,
  User,
  Sparkles,
  RotateCcw,
  Key,
  Check,
  Copy,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Save,
  Search,
} from 'lucide-react';
import { ChatMessage } from '../types';
import { aiAssistantService } from '../services/adapters/aiAssistantAdapter';
import { authService } from '../services/authService';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { MarkdownView } from '../components/common/MarkdownView';
import { useAuth } from '../context/AuthContext';
import { storageService } from '../services/storageService';

export const AIResearchAssistant: React.FC = () => {
  const { keys: authKeys, updateKeys } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>(() => aiAssistantService.getInitialMessages());
  const [inputPrompt, setInputPrompt] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Gemini API Key State in Chatbot - automatically synchronized with Settings
  const [geminiApiKey, setGeminiApiKey] = useState(() => storageService.getSettings()?.geminiApiKey || '');
  const [hasConfiguredKey, setHasConfiguredKey] = useState<boolean>(() => {
    const localKey = storageService.getSettings()?.geminiApiKey || '';
    return Boolean(localKey && !localKey.startsWith('your_') && !localKey.startsWith('test_'));
  });
  const [maskedKey, setMaskedKey] = useState(() => {
    const localKey = storageService.getSettings()?.geminiApiKey || '';
    return localKey.length > 8 ? localKey.slice(0, 4) + '...' + localKey.slice(-4) : '';
  });
  const [isKeyDrawerOpen, setIsKeyDrawerOpen] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [keySaveMessage, setKeySaveMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isThinking]);

  // Check Gemini Key status upon mount or whenever settings / authKeys update
  const checkKeyStatus = async () => {
    // 1. First check storageService / settings
    const settingKey = storageService.getSettings()?.geminiApiKey || authKeys?.gemini_api_key || '';
    if (settingKey && !settingKey.startsWith('your_') && !settingKey.startsWith('test_')) {
      setHasConfiguredKey(true);
      setMaskedKey(settingKey.slice(0, 4) + '...' + settingKey.slice(-4));
      setGeminiApiKey(settingKey);
      return;
    }

    try {
      const status = await aiAssistantService.checkStatus();
      if (status.hasGeminiKey) {
        setHasConfiguredKey(true);
        setMaskedKey(status.maskedKey);
      }
    } catch (e) {
      console.warn('Could not check Gemini key status:', e);
    }
  };

  useEffect(() => {
    checkKeyStatus();
  }, [authKeys]);

  // Save Gemini Key directly from chatbot interface and two-way sync with Settings
  const handleSaveGeminiKey = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanKey = geminiApiKey.trim();
    if (!cleanKey) {
      alert('Please enter a valid Google Gemini API Key.');
      return;
    }

    setIsSavingKey(true);
    setKeySaveMessage(null);
    try {
      // 1. Save to local storage for Settings page
      storageService.saveSettings({ geminiApiKey: cleanKey });
      // 2. Save to user keys via AuthContext (syncs everywhere + backend)
      await updateKeys({ gemini_api_key: cleanKey, geminiApiKey: cleanKey });
      await authService.updateUserKeys({ gemini_api_key: cleanKey, geminiApiKey: cleanKey });

      setHasConfiguredKey(true);
      setMaskedKey(cleanKey.slice(0, 4) + '...' + cleanKey.slice(-4));
      setKeySaveMessage('✅ Gemini API Key connected & synced with Settings!');
      setTimeout(() => {
        setIsKeyDrawerOpen(false);
        setKeySaveMessage(null);
      }, 1500);
    } catch (err: any) {
      alert(`Error saving Gemini API Key: ${err.message}`);
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const query = textToSend || inputPrompt;
    if (!query.trim() || isThinking) return;

    // Check key from state, settings, or authKeys
    const activeSettings = storageService.getSettings();
    const effectiveGeminiKey = geminiApiKey.trim() || activeSettings?.geminiApiKey || authKeys?.gemini_api_key || '';

    if (!effectiveGeminiKey || effectiveGeminiKey.startsWith('your_') || effectiveGeminiKey.startsWith('test_')) {
      setIsKeyDrawerOpen(true);
      alert('Please provide your Google Gemini API Key in the box above or configure it in Settings to enable direct AI search & research.');
      return;
    }

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: query.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputPrompt('');
    setIsThinking(true);

    try {
      const response = await aiAssistantService.askAssistant(
        query,
        messages,
        effectiveGeminiKey
      );
      setMessages((prev) => [...prev, response]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `⚠️ **AI Query Notice:** ${err.message || 'Error communicating with Google Gemini API.'}\n\n*Make sure your Gemini API key is valid and has sufficient quota.*`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      // If error indicates key issue, open key drawer
      if (err.message && err.message.toLowerCase().includes('key')) {
        setIsKeyDrawerOpen(true);
      }
    } finally {
      setIsThinking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleCopyContent = (content: string, id: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleResetChat = () => {
    if (confirm('Clear chat conversation history and reset assistant?')) {
      setMessages(aiAssistantService.getInitialMessages());
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8.5rem)] max-w-5xl mx-auto space-y-4">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-blue-600 to-sky-500 text-white shadow-md shadow-indigo-500/20">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-900">AI B2B Research & Search Assistant</h3>
              <Badge variant="default" size="sm" className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white border-0">
                <Sparkles className="w-3 h-3 mr-1" />
                Google Gemini AI
              </Badge>
            </div>
            <p className="text-xs text-slate-500">
              Direct AI research for company profiles, executive decision makers, and personalized outreach strategy.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Gemini Key Config Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsKeyDrawerOpen(!isKeyDrawerOpen)}
            className={`text-xs gap-1.5 font-semibold ${
              hasConfiguredKey
                ? 'border-emerald-200 bg-emerald-50/60 text-emerald-800 hover:bg-emerald-100'
                : 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 animate-pulse'
            }`}
          >
            <Key className="w-3.5 h-3.5 text-indigo-600" />
            <span>
              {hasConfiguredKey
                ? `Gemini Key Active (${maskedKey || 'Configured'})`
                : 'Configure Gemini API Key'}
            </span>
            {isKeyDrawerOpen ? <ChevronUp className="w-3.5 h-3.5 ml-0.5" /> : <ChevronDown className="w-3.5 h-3.5 ml-0.5" />}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleResetChat}
            className="text-xs text-slate-600 hover:text-slate-900"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            Reset Chat
          </Button>
        </div>
      </div>

      {/* Gemini API Key Direct Configuration Drawer */}
      {isKeyDrawerOpen && (
        <Card className="p-4 bg-gradient-to-r from-indigo-50/70 via-blue-50/50 to-white border-indigo-200 shadow-sm animate-in fade-in duration-200">
          <form onSubmit={handleSaveGeminiKey} className="space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-indigo-600 text-white">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-900">
                    Google Gemini API Key for Direct AI Research & Search
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Your Gemini key is stored securely in your private account vault and used directly for live queries.
                  </p>
                </div>
              </div>

              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold inline-flex items-center gap-1"
              >
                Get Free Gemini Key <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-2">
              <div className="relative flex-1 w-full">
                <input
                  type="password"
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder={hasConfiguredKey ? `Current Key: ${maskedKey} (Paste new key to replace)` : 'AIzaSy... Paste your Google Gemini API Key'}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white font-mono"
                />
              </div>

              <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSavingKey || !geminiApiKey.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold gap-1.5 w-full sm:w-auto"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingKey ? 'Saving...' : 'Save & Connect Key'}</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsKeyDrawerOpen(false)}
                  className="text-xs text-slate-500"
                >
                  Close
                </Button>
              </div>
            </div>

            {keySaveMessage && (
              <div className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                {keySaveMessage}
              </div>
            )}
          </form>
        </Card>
      )}

      {/* Message Stream */}
      <div className="flex-1 overflow-y-auto space-y-5 px-1 py-2">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';

          return (
            <div
              key={msg.id}
              className={`flex items-start gap-3.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {/* Avatar */}
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 shadow-xs ${
                  isUser
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-slate-200 text-indigo-600'
                }`}
              >
                {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              {/* Message Content Bubble */}
              <div
                className={`group relative max-w-3xl rounded-2xl p-4.5 text-xs md:text-sm leading-relaxed shadow-xs ${
                  isUser
                    ? 'bg-blue-600 text-white rounded-tr-xs'
                    : 'bg-white border border-slate-200/90 text-slate-800 rounded-tl-xs'
                }`}
              >
                {/* Text Body with rich Markdown styling */}
                <MarkdownView content={msg.content} isUser={isUser} />

                {/* Suggested Follow-up Prompts */}
                {msg.suggestedPrompts && msg.suggestedPrompts.length > 0 && !isUser && (
                  <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                      Suggested Next Inquiries:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {msg.suggestedPrompts.map((promptText, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => handleSendMessage(promptText)}
                          className="px-2.5 py-1 text-[11px] rounded-lg bg-slate-50 border border-slate-200 text-slate-700 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition-colors text-left flex items-center gap-1 cursor-pointer"
                        >
                          <Search className="w-2.5 h-2.5 text-slate-400" />
                          <span>{promptText}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Footer copy button & timestamp */}
                {!isUser && (
                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100/60 text-[10px] text-slate-400">
                    <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • Google Gemini AI</span>
                    <button
                      type="button"
                      onClick={() => handleCopyContent(msg.content, msg.id)}
                      className="inline-flex items-center gap-1 hover:text-slate-600 transition-colors cursor-pointer"
                      title="Copy response"
                    >
                      {copiedId === msg.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span className="text-emerald-600 font-semibold">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isThinking && (
          <div className="flex items-start gap-3.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white border border-slate-200 text-indigo-600 shadow-xs">
              <Bot className="w-4 h-4 animate-spin" />
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4 text-xs text-slate-500 shadow-xs flex items-center gap-2">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" />
              </div>
              <span className="font-medium text-slate-600 ml-1">
                Querying Google Gemini AI for live enterprise research & intelligence...
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input box */}
      <div className="pt-2 border-t border-slate-200">
        <div className="relative flex items-center bg-white border border-slate-300 rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition-all">
          <textarea
            ref={inputRef}
            rows={2}
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasConfiguredKey ? "Ask Gemini anything: e.g. 'Find key decision makers at Stripe' or 'Draft cold email for Dylan Field'..." : "Please configure your Gemini API Key above to begin live search..."}
            className="w-full resize-none p-3.5 pr-14 bg-transparent text-xs md:text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />

          <div className="absolute right-3 bottom-3 flex items-center gap-1.5">
            <Button
              variant="primary"
              size="icon"
              disabled={!inputPrompt.trim() || isThinking}
              onClick={() => handleSendMessage()}
              className="w-8 h-8 rounded-xl bg-blue-600 hover:bg-blue-700 shadow-xs"
              title="Send prompt (Enter)"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-400 px-2 mt-1.5">
          <span>Press <kbd className="px-1 py-0.5 rounded bg-slate-100 border text-slate-600 font-mono">Enter</kbd> to search, <kbd className="px-1 py-0.5 rounded bg-slate-100 border text-slate-600 font-mono">Shift + Enter</kbd> for newline</span>
          <span className="flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-indigo-500" />
            Direct Gemini Search Enabled
          </span>
        </div>
      </div>
    </div>
  );
};
