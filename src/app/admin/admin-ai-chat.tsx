'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  Bot, 
  Sparkles, 
  Send, 
  Key, 
  RefreshCw, 
  Trash2, 
  Copy, 
  Check, 
  ChevronDown, 
  ChevronUp, 
  Eye, 
  EyeOff,
  Database
} from 'lucide-react';
import { askDatabaseAI, checkServerGeminiKeyConfigured, ChatMessage } from '@/app/actions/ai-chat';

interface AdminAIChatProps {
  className?: string;
}

export function AdminAIChat({ className = '' }: AdminAIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Gemini API Key & Model Configuration
  const [hasServerKey, setHasServerKey] = useState<boolean>(false);
  const [customApiKey, setCustomApiKey] = useState<string>('');
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [showKeySecret, setShowKeySecret] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.8-flash');
  const [customModelInput, setCustomModelInput] = useState<string>('');
  const [isCustomModel, setIsCustomModel] = useState<boolean>(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Load custom API key from localStorage on mount & check server env key
  useEffect(() => {
    const savedKey = localStorage.getItem('fundflow_gemini_api_key');
    if (savedKey) {
      setCustomApiKey(savedKey);
    }

    const savedModel = localStorage.getItem('fundflow_gemini_model');
    if (savedModel && ['gemini-3.8-flash', 'gemini-3.8-pro', 'gemini-3.5-flash', 'gemini-3.5-pro'].includes(savedModel)) {
      setSelectedModel(savedModel);
    } else if (savedModel && savedModel !== 'gemini-2.5-flash' && savedModel !== 'gemini-2.0-flash' && savedModel !== 'gemini-1.5-flash') {
      setIsCustomModel(true);
      setCustomModelInput(savedModel);
      setSelectedModel(savedModel);
    } else {
      setSelectedModel('gemini-3.8-flash');
      localStorage.setItem('fundflow_gemini_model', 'gemini-3.8-flash');
    }

    checkServerGeminiKeyConfigured().then(res => {
      setHasServerKey(res.configured);
      // If no server key and no saved custom key, auto open setup modal
      if (!res.configured && !savedKey) {
        setShowKeyModal(true);
      }
    });

    // Default welcome message
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
        content: `👋 Hello Admin! I am **FundFlow AI**, your natural language database assistant powered by the latest **${selectedModel}** thinking model.\n\nI have complete, real-time access to your live factory database. You can ask me anything, such as:\n* *"Who has the highest advance right now?"*\n* *"Who hasn't been logging their spending recently?"*\n* *"Are there any discrepancies or flagged transactions?"*\n* *"What is the cash balance breakdown for all factories?"*`,
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
    if (!isMinimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading, isMinimized]);

  const handleSaveApiKey = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = customApiKey.trim();
    if (cleanKey) {
      localStorage.setItem('fundflow_gemini_api_key', cleanKey);
    } else {
      localStorage.removeItem('fundflow_gemini_api_key');
    }
    setShowKeyModal(false);
  };

  const handleModelChange = (model: string) => {
    if (model === 'custom') {
      setIsCustomModel(true);
    } else {
      setIsCustomModel(false);
      setSelectedModel(model);
      localStorage.setItem('fundflow_gemini_model', model);
    }
  };

  const handleSaveCustomModel = () => {
    const clean = customModelInput.trim();
    if (clean) {
      setSelectedModel(clean);
      localStorage.setItem('fundflow_gemini_model', clean);
      setIsCustomModel(false);
    }
  };

  const handleClearHistory = () => {
    const welcome: ChatMessage = {
      role: 'model',
      content: `Chat history cleared. I'm ready for your next query on the live database!`,
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

    // Check if key is available
    if (!hasServerKey && !customApiKey.trim()) {
      setShowKeyModal(true);
      return;
    }

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
      const response = await askDatabaseAI(
        textToSend,
        messages,
        customApiKey || undefined,
        selectedModel
      );

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
          content: response.error === 'MISSING_API_KEY'
            ? '⚠️ **Gemini API Key Required**: Please click the key icon in the header to enter your Google Gemini API key.'
            : `⚠️ **AI Query Error**: ${response.error || 'Failed to analyze database.'}`,
          timestamp: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages([...newHistory, errorMsg]);
        if (response.error === 'MISSING_API_KEY') {
          setShowKeyModal(true);
        }
      }
    } catch (err: any) {
      setMessages([
        ...newHistory,
        {
          role: 'model',
          content: `⚠️ **Unexpected Error**: ${err?.message || 'Failed to communicate with AI server.'}`,
          timestamp: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const quickQuestions = [
    'Who has the most advance right now?',
    "Who hasn't been logging their spending?",
    'Are there any discrepancies or flagged transactions?',
    'Current cash on hand across all factories',
  ];

  // Helper to render basic markdown nicely (bold, lists, tables, headers)
  const renderFormattedMarkdown = (content: string) => {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let tableBuffer: string[] = [];

    const flushTable = (buffer: string[], keyPrefix: number) => {
      if (buffer.length === 0) return null;
      const rows = buffer.map(line => 
        line.split('|').map(cell => cell.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
      );

      // Skip separator row (e.g. |---|---|)
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
      // Check for table line
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        tableBuffer.push(line.trim());
        return;
      } else if (tableBuffer.length > 0) {
        elements.push(flushTable(tableBuffer, idx));
        tableBuffer = [];
      }

      // Headers (### or ##)
      if (line.startsWith('### ')) {
        elements.push(<h4 key={idx} className="font-bold text-slate-900 text-sm mt-3 mb-1">{line.replace('### ', '')}</h4>);
      } else if (line.startsWith('## ')) {
        elements.push(<h3 key={idx} className="font-extrabold text-slate-900 text-base mt-4 mb-1.5 border-b border-slate-100 pb-1">{line.replace('## ', '')}</h3>);
      } else if (line.startsWith('* ') || line.startsWith('- ')) {
        // Bullet list item
        const text = line.substring(2);
        elements.push(
          <li key={idx} className="ml-4 list-disc text-xs leading-relaxed text-slate-800 my-0.5">
            <span dangerouslySetInnerHTML={{ __html: formatInline(text) }} />
          </li>
        );
      } else if (line.match(/^\d+\.\s/)) {
        // Numbered list
        const text = line.replace(/^\d+\.\s/, '');
        elements.push(
          <li key={idx} className="ml-4 list-decimal text-xs leading-relaxed text-slate-800 my-0.5">
            <span dangerouslySetInnerHTML={{ __html: formatInline(text) }} />
          </li>
        );
      } else if (line.trim() === '') {
        elements.push(<div key={idx} className="h-2" />);
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
      .replace(/`([^`]+)`/g, '<code class="bg-slate-100 text-indigo-700 px-1 py-0.5 rounded text-[11px] font-mono">$1</code>')
      .replace(/(₹[\d,]+)/g, '<strong class="font-black text-slate-900">$1</strong>');
  };

  return (
    <>
      {/* Floating launcher trigger pill in bottom right */}
      <button
        onClick={() => {
          setIsMinimized(false);
          chatContainerRef.current?.scrollIntoView({ behavior: 'smooth' });
        }}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-slate-900 text-white px-4 py-2.5 shadow-2xl hover:bg-slate-800 transition-all duration-200 border border-slate-700 hover:scale-105 min-h-[44px]"
        title="Open Database AI Assistant"
      >
        <Sparkles className="h-4 w-4 text-emerald-400 animate-pulse" />
        <span className="text-xs font-bold tracking-tight">Ask Database AI</span>
      </button>

      {/* Main Chat Section Container */}
      <div 
        ref={chatContainerRef}
        id="admin-ai-chat-section"
        className={`bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden transition-all duration-200 ${className}`}
      >
        {/* Header Bar */}
        <div className="bg-slate-900 text-white px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
                  FundFlow AI Intelligence
                </h3>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 text-emerald-300 px-2 py-0.5 text-[10px] font-semibold border border-emerald-500/30">
                  <Database className="h-2.5 w-2.5" />
                  Live DB
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Ask any natural language question about advances, spending, balances, & discrepancies
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Model Selector */}
            <div className="relative">
              <select
                value={isCustomModel ? 'custom' : selectedModel}
                onChange={(e) => handleModelChange(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-emerald-300 text-xs rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-400 min-h-[34px] font-mono cursor-pointer font-semibold"
                title="Select Gemini Model"
              >
                <option value="gemini-3.8-flash">⚡ gemini-3.8-flash (Latest Thinking)</option>
                <option value="gemini-3.8-pro">🧠 gemini-3.8-pro (Deep Reasoning)</option>
                <option value="gemini-3.5-flash">🚀 gemini-3.5-flash</option>
                <option value="custom">⚙️ Custom Model...</option>
              </select>
            </div>

            {/* API Key Config Button */}
            <button
              onClick={() => setShowKeyModal(true)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold border min-h-[34px] transition-colors ${
                hasServerKey || customApiKey
                  ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                  : 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30 animate-pulse'
              }`}
              title="Configure Gemini API Key"
            >
              <Key className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {hasServerKey ? 'Env Key' : customApiKey ? 'Key Active' : 'Set API Key'}
              </span>
            </button>

            {/* Clear History Button */}
            <button
              onClick={handleClearHistory}
              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Clear Chat History"
            >
              <Trash2 className="h-4 w-4" />
            </button>

            {/* Minimize / Expand Toggle */}
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title={isMinimized ? 'Expand Chat' : 'Minimize Chat'}
            >
              {isMinimized ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Custom Model Input Modal / Bar */}
        {isCustomModel && (
          <div className="bg-slate-800 px-5 py-2.5 border-b border-slate-700 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 flex-1">
              <span className="text-slate-300 font-semibold">Custom Model ID:</span>
              <input
                type="text"
                value={customModelInput}
                onChange={(e) => setCustomModelInput(e.target.value)}
                placeholder="e.g. gemini-3.5-flash or experimental endpoint"
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-white text-xs flex-1 max-w-sm font-mono"
              />
              <button
                type="button"
                onClick={handleSaveCustomModel}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded font-bold"
              >
                Apply
              </button>
            </div>
            <button
              type="button"
              onClick={() => { setIsCustomModel(false); setSelectedModel('gemini-3.8-flash'); }}
              className="text-slate-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        )}

        {!isMinimized && (
          <>
            {/* Quick Prompt Chips */}
            <div className="bg-slate-50 border-b border-slate-100 px-5 py-2.5 overflow-x-auto">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">
                  Quick Prompts:
                </span>
                {quickQuestions.map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    disabled={loading}
                    onClick={() => handleSend(q)}
                    className="whitespace-nowrap px-2.5 py-1 rounded-full bg-white border border-slate-200 text-slate-700 text-[11px] font-medium hover:bg-slate-100 hover:border-slate-300 hover:text-slate-900 transition-colors disabled:opacity-50 shrink-0"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {/* Chat Messages Body */}
            <div className="p-5 max-h-[460px] overflow-y-auto space-y-4 bg-slate-50/40">
              {messages.map((msg, index) => {
                const isUser = msg.role === 'user';

                return (
                  <div
                    key={index}
                    className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    {/* Avatar */}
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 border ${
                      isUser
                        ? 'bg-slate-900 text-white border-slate-800'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    }`}>
                      {isUser ? (
                        <span className="text-xs font-bold">You</span>
                      ) : (
                        <Bot className="h-4 w-4" />
                      )}
                    </div>

                    {/* Bubble */}
                    <div className={`relative max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${
                      isUser
                        ? 'bg-slate-900 text-white rounded-tr-none'
                        : 'bg-white border border-slate-200 text-slate-900 rounded-tl-none'
                    }`}>
                      {/* Header in AI response */}
                      {!isUser && (
                        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-1.5 mb-2">
                          <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1 font-mono">
                            <Sparkles className="h-2.5 w-2.5 text-emerald-500" />
                            {selectedModel}
                          </span>
                          <button
                            onClick={() => handleCopy(msg.content, index)}
                            className="text-slate-400 hover:text-slate-600 transition-colors"
                            title="Copy response"
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
                        <div className={`text-[9px] mt-1.5 text-right ${
                          isUser ? 'text-slate-400' : 'text-slate-400'
                        }`}>
                          {msg.timestamp}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Thinking / Loading indicator */}
              {loading && (
                <div className="flex items-start gap-3">
                  <div className="h-8 w-8 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center shrink-0">
                    <Bot className="h-4 w-4 animate-spin" />
                  </div>
                  <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none px-4 py-3 shadow-sm text-xs text-slate-600 space-y-2">
                    <div className="flex items-center gap-2">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-emerald-600" />
                      <span className="font-semibold text-slate-800">
                        Querying live database snapshot with {selectedModel}...
                      </span>
                    </div>
                    <div className="flex gap-1 pt-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <div className="p-4 bg-white border-t border-slate-200">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex items-center gap-2"
              >
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="Ask about workers, advances, spending, balances, discrepancies..."
                    disabled={loading}
                    className="w-full rounded-lg border border-slate-300 pl-4 pr-10 py-2.5 text-xs text-slate-950 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 min-h-[44px] shadow-sm bg-white"
                  />
                  {inputValue && (
                    <button
                      type="button"
                      onClick={() => setInputValue('')}
                      className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                    >
                      ×
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading || !inputValue.trim()}
                  className="flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow hover:bg-slate-800 disabled:opacity-50 min-h-[44px] min-w-[44px] transition-colors"
                  title="Send Question"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>

              <div className="flex justify-between items-center text-[10px] text-slate-400 mt-2 px-1">
                <span>
                  Active Model: <strong className="text-slate-600 font-mono">{selectedModel}</strong>
                </span>
                <span>
                  {hasServerKey ? (
                    <span className="text-emerald-600 font-semibold">● Server API Key Active</span>
                  ) : customApiKey ? (
                    <span className="text-indigo-600 font-semibold">● Custom API Key Active</span>
                  ) : (
                    <span className="text-amber-600 font-semibold">⚠️ No API Key Configured</span>
                  )}
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* API Key Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl p-6 max-w-md w-full space-y-4">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
              <div className="h-8 w-8 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
                <Key className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Gemini API Key Setup</h3>
                <p className="text-xs text-slate-500">Configure your Google AI Studio API key</p>
              </div>
            </div>

            <form onSubmit={handleSaveApiKey} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Google Gemini API Key
                </label>
                <div className="relative">
                  <input
                    type={showKeySecret ? 'text' : 'password'}
                    value={customApiKey}
                    onChange={(e) => setCustomApiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full rounded border border-slate-300 pl-3 pr-10 py-2 text-xs font-mono text-slate-950 focus:border-slate-500 focus:outline-none min-h-[42px]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKeySecret(!showKeySecret)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                  >
                    {showKeySecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                  You can get a free API key at{' '}
                  <a 
                    href="https://aistudio.google.com/app/apikey" 
                    target="_blank" 
                    rel="noreferrer" 
                    className="text-indigo-600 underline font-semibold"
                  >
                    Google AI Studio
                  </a>.
                  Your key is saved locally in your browser session and sent directly to Google Gemini.
                </p>
              </div>

              {hasServerKey && (
                <div className="rounded bg-emerald-50 p-2.5 border border-emerald-200 text-xs text-emerald-800">
                  ✓ A default <code>GEMINI_API_KEY</code> is already configured on the server. You can leave this blank to use the server key or enter one to override.
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowKeyModal(false)}
                  className="flex-1 rounded-md border border-slate-300 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 min-h-[42px]"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-md bg-slate-900 py-2.5 text-xs font-bold text-white hover:bg-slate-800 min-h-[42px]"
                >
                  Save Key
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
