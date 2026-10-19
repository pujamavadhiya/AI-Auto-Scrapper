import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Bot,
  User,
  Sparkles,
  RotateCcw,
  Building2,
  Users,
  Copy,
  Check,
  Download,
  AlertCircle,
  HelpCircle,
  ExternalLink,
} from 'lucide-react';
import { ChatMessage } from '../types';
import { aiAssistantService } from '../services/adapters/aiAssistantAdapter';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';

export const AIResearchAssistant: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>(() => aiAssistantService.getInitialMessages());
  const [inputPrompt, setInputPrompt] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isThinking]);

  const handleSendMessage = async (textToSend?: string) => {
    const query = textToSend || inputPrompt;
    if (!query.trim() || isThinking) return;

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
      const response = await aiAssistantService.askAssistant(query, messages);
      setMessages((prev) => [...prev, response]);
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `Error during query processing: ${(err as Error).message}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
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
    if (confirm('Clear chat history and reset assistant?')) {
      setMessages(aiAssistantService.getInitialMessages());
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8.5rem)] max-w-5xl mx-auto space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-blue-600 to-sky-500 text-white shadow-md shadow-indigo-500/20">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-900">AI B2B Research Assistant</h3>
              <Badge variant="default" size="sm" className="bg-indigo-50 text-indigo-700 border-indigo-200">
                GPT-4o Simulated Engine
              </Badge>
            </div>
            <p className="text-xs text-slate-500">
              Ask deep questions on company hierarchies, prospecting angles, and outreach strategy.
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleResetChat}
          className="text-xs text-slate-600 hover:text-slate-900"
        >
          <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
          Reset Chat
        </Button>
      </div>

      {/* Notice Banner */}
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-50/80 border border-amber-200 text-xs text-amber-800">
        <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
        <span>
          <strong>Mock Simulation Mode:</strong> Assistant responses and lead suggestions are generated via local algorithmic models for development & design validation.
        </span>
      </div>

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
                className={`group relative max-w-2xl rounded-2xl p-4.5 text-xs md:text-sm leading-relaxed shadow-xs ${
                  isUser
                    ? 'bg-blue-600 text-white rounded-tr-xs'
                    : 'bg-white border border-slate-200/90 text-slate-800 rounded-tl-xs'
                }`}
              >
                {/* Text Body */}
                <div className="prose prose-sm max-w-none text-inherit space-y-3 whitespace-pre-line font-normal">
                  {msg.content}
                </div>

                {/* Structured Payload Render (e.g. leads cards) */}
                {msg.dataPayload && msg.dataPayload.items && (
                  <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                      {msg.dataPayload.title || 'Extracted Entities'}
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {msg.dataPayload.items.map((dm: any, i: number) => (
                        <div key={i} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                          <div className="font-bold text-slate-900">{dm.name}</div>
                          <div className="text-[11px] text-slate-500">{dm.title}</div>
                          <div className="text-[11px] text-blue-600 font-mono mt-1">{dm.email}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Suggested Follow-up Prompts */}
                {msg.suggestedPrompts && msg.suggestedPrompts.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                      Suggested Inquiries
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {msg.suggestedPrompts.map((prompt, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleSendMessage(prompt)}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 border border-slate-200/60 text-slate-700 text-xs font-medium transition-all text-left"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Footer copy button */}
                {!isUser && (
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100/60 text-[10px] text-slate-400">
                    <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyContent(msg.content, msg.id)}
                      className="inline-flex items-center gap-1 hover:text-slate-600 transition-colors"
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
                Analyzing account registry & querying organizational hierarchy...
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
            placeholder="Ask anything: e.g. 'Find decision makers at Stripe' or 'Draft cold outreach for Dylan Field'..."
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
          <span>Press <kbd className="px-1 py-0.5 rounded bg-slate-100 border text-slate-600 font-mono">Enter</kbd> to send, <kbd className="px-1 py-0.5 rounded bg-slate-100 border text-slate-600 font-mono">Shift + Enter</kbd> for newline</span>
          <span>AI Auto Scrapper Assistant v2.4</span>
        </div>
      </div>
    </div>
  );
};
