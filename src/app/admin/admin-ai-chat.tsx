'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  Bot, 
  Send, 
  RefreshCw, 
  Trash2, 
  Copy, 
  Check, 
  MessageSquare
} from 'lucide-react';
import { askDatabaseAI, ChatMessage } from '@/app/actions/ai-chat';

interface AdminAIChatProps {
  className?: string;
}

export function AdminAIChat({ className = '' }: AdminAIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Clear any legacy client-side keys & load chat history
  useEffect(() => {
    try {
      localStorage.removeItem('fundflow_gemini_api_key');
      localStorage.removeItem('fundflow_openrouter_api_key');
    } catch {}

    const savedHistory = localStorage.getItem('fundflow_ai_chat_history');
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          return;
        }
      } catch {
        // ignore parse error
      }
    }

    setMessages([
      {
        role: 'model',
        content: 'Ask any question about workers, advances, supervisor spending, balances, or logging discrepancies.',
        timestamp: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      }
    ]);
  }, []);

  // Save history on change
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem('fundflow_ai_chat_history', JSON.stringify(messages));
    }
  }, [messages]);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleClearHistory = () => {
    const welcome: ChatMessage = {
      role: 'model',
      content: 'Ask any question about workers, advances, supervisor spending, balances, or logging discrepancies.',
      timestamp: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages([welcome]);
    localStorage.removeItem('fundflow_ai_chat_history');
  };

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleSend = async (queryText?: string) => {
    const textToSend = (queryText || inputValue).trim();
    if (!textToSend || loading) return;

    setInputValue('');
    const userMsg: ChatMessage = {
      role: 'user',
      content: textToSend,
      timestamp: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    };

    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setLoading(true);

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Request timed out. Please try again.')), 25000)
      );

      const response = await Promise.race([
        askDatabaseAI(
          textToSend,
          messages
        ),
        timeoutPromise
      ]);

      if (response.success && response.answer) {
        const aiMsg: ChatMessage = {
          role: 'model',
          content: response.answer,
          timestamp: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages([...newHistory, aiMsg]);
      } else {
        const errorMsg: ChatMessage = {
          role: 'model',
          content: `Error: ${response.error || 'Failed to query database.'}`,
          timestamp: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages([...newHistory, errorMsg]);
      }
    } catch (err: any) {
      setMessages([
        ...newHistory,
        {
          role: 'model',
          content: `Error: ${err?.message || 'Failed to communicate with AI server.'}`,
          timestamp: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const quickQuestions = [
    'Who has the most advance?',
    "Who hasn't been logging their spending?",
    'Are there any discrepancies or flagged transactions?',
    'Current cash on hand across all factories',
  ];

  // Helper to render markdown (bold, lists, tables, headers)
  const renderFormattedMarkdown = (content: string) => {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let tableBuffer: string[] = [];

    const flushTable = (buffer: string[], keyPrefix: number) => {
      if (buffer.length === 0) return null;
      const rows = buffer.map(line => 
        line.split('|').map(cell => cell.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
      );

      const headerRow = rows[0] || [];
      const bodyRows = rows.slice(1).filter(r => !r.every(cell => cell.match(/^[-:]+$/)));

      return (
        <div key={`table-${keyPrefix}`} className="overflow-x-auto my-3 rounded border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            {headerRow.length > 0 && (
              <thead className="bg-slate-100 font-bold text-slate-700">
                <tr>
                  {headerRow.map((h, i) => (
                    <th key={i} className="px-3 py-2 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody className="divide-y divide-slate-100 bg-white">
              {bodyRows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-slate-50">
                  {row.map((c, cIdx) => (
                    <td key={cIdx} className="px-3 py-1.5 text-slate-800">{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    };

    lines.forEach((line, idx) => {
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        tableBuffer.push(line.trim());
        return;
      } else if (tableBuffer.length > 0) {
        elements.push(flushTable(tableBuffer, idx));
        tableBuffer = [];
      }

      if (line.startsWith('### ')) {
        elements.push(<h4 key={idx} className="font-bold text-slate-900 text-sm mt-3 mb-1">{line.replace('### ', '')}</h4>);
      } else if (line.startsWith('## ')) {
        elements.push(<h3 key={idx} className="font-extrabold text-slate-900 text-base mt-3 mb-1.5 border-b border-slate-100 pb-1">{line.replace('## ', '')}</h3>);
      } else if (line.startsWith('* ') || line.startsWith('- ')) {
        const text = line.substring(2);
        elements.push(
          <li key={idx} className="ml-4 list-disc text-xs leading-relaxed text-slate-800 my-0.5">
            <span dangerouslySetInnerHTML={{ __html: formatInline(text) }} />
          </li>
        );
      } else if (line.match(/^\d+\.\s/)) {
        const text = line.replace(/^\d+\.\s/, '');
        elements.push(
          <li key={idx} className="ml-4 list-decimal text-xs leading-relaxed text-slate-800 my-0.5">
            <span dangerouslySetInnerHTML={{ __html: formatInline(text) }} />
          </li>
        );
      } else if (line.trim() === '') {
        elements.push(<div key={idx} className="h-1.5" />);
      } else {
        elements.push(
          <p key={idx} className="text-xs leading-relaxed text-slate-800 my-1">
            <span dangerouslySetInnerHTML={{ __html: formatInline(line) }} />
          </p>
        );
      }
    });

    if (tableBuffer.length > 0) {
      elements.push(flushTable(tableBuffer, lines.length));
    }

    return elements;
  };

  const formatInline = (text: string) => {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-extrabold text-slate-950">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
      .replace(/`([^`]+)`/g, '<code class="bg-slate-100 text-slate-800 px-1 py-0.5 rounded text-[11px] font-mono">$1</code>')
      .replace(/(₹[\d,]+)/g, '<strong class="font-black text-slate-900">$1</strong>');
  };

  return (
    <div 
      id="admin-ai-chat-section"
      className={`bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden ${className}`}
    >
        {/* Simple Clean Header */}
        <div className="bg-slate-900 text-white px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-slate-300" />
            <h3 className="text-sm font-bold text-white">Database Questions</h3>
          </div>

          <div className="flex items-center gap-1">
            {/* Clear History Button */}
            <button
              onClick={handleClearHistory}
              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Clear Chat"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Quick Prompts On Top */}
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 overflow-x-auto">
          <div className="flex items-center gap-2">
            {quickQuestions.map((q, idx) => (
              <button
                key={idx}
                type="button"
                disabled={loading}
                onClick={() => handleSend(q)}
                className="whitespace-nowrap px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-100 hover:text-slate-900 hover:border-slate-300 transition-colors disabled:opacity-50 shrink-0 shadow-sm"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Chat Messages Body */}
        <div className="p-4 max-h-[420px] min-h-[140px] overflow-y-auto space-y-3 bg-slate-50/50">
          {messages.map((msg, index) => {
            const isUser = msg.role === 'user';

            return (
              <div
                key={index}
                className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
              >
                {/* Avatar */}
                <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold border ${
                  isUser
                    ? 'bg-slate-900 text-white border-slate-800'
                    : 'bg-white text-slate-700 border-slate-200'
                }`}>
                  {isUser ? 'You' : <Bot className="h-3.5 w-3.5" />}
                </div>

                {/* Bubble */}
                <div className={`relative max-w-[85%] rounded-lg px-4 py-2.5 shadow-sm ${
                  isUser
                    ? 'bg-slate-900 text-white rounded-tr-none'
                    : 'bg-white border border-slate-200 text-slate-900 rounded-tl-none'
                }`}>
                  {/* Copy button on response */}
                  {!isUser && (
                    <div className="flex justify-end mb-1">
                      <button
                        onClick={() => handleCopy(msg.content, index)}
                        className="text-slate-400 hover:text-slate-600 transition-colors p-0.5"
                        title="Copy"
                      >
                        {copiedIndex === index ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  )}

                  {/* Content */}
                  <div className="prose prose-xs max-w-none">
                    {isUser ? (
                      <p className="text-xs leading-relaxed whitespace-pre-wrap font-medium">{msg.content}</p>
                    ) : (
                      renderFormattedMarkdown(msg.content)
                    )}
                  </div>

                  {/* Timestamp */}
                  {msg.timestamp && (
                    <div className="text-[9px] mt-1 text-right text-slate-400">
                      {msg.timestamp}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Thinking / Loading indicator */}
          {loading && (
            <div className="flex items-start gap-2.5">
              <div className="h-7 w-7 rounded-full bg-white text-slate-700 border border-slate-200 flex items-center justify-center shrink-0">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              </div>
              <div className="bg-white border border-slate-200 rounded-lg rounded-tl-none px-4 py-2.5 shadow-sm text-xs text-slate-600 flex items-center gap-2">
                <span className="font-medium">Checking database...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Section */}
        <div className="p-3 bg-white border-t border-slate-200">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask anything about workers, spending, balances, or transactions..."
              disabled={loading}
              className="flex-1 rounded border border-slate-300 px-3.5 py-2 text-xs text-slate-950 focus:border-slate-500 focus:outline-none min-h-[42px] bg-white shadow-sm"
            />

            <button
              type="submit"
              disabled={loading || !inputValue.trim()}
              className="flex items-center justify-center rounded bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-slate-800 disabled:opacity-50 min-h-[42px] min-w-[42px] transition-colors"
              title="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
  );
}
