'use client';

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Send, Settings, Brain, Trash2, Search, Save, Loader2, User, Download, Upload, Edit2, Link, Paperclip } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';

type ToolCall = {
  id: string;
  name: string;
  args: any;
  result?: any;
  status: 'pending' | 'success' | 'error';
};

type Message = {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  toolCalls?: ToolCall[];
};

const storeMemoryFunc = {
  name: "storeMemory",
  description: "Save a new fact or memory. Compress the information into dense, high-signal chunks (Extraneous Load reduction) before storing.",
  parameters: {
    type: "OBJECT" as any,
    properties: {
      text: { type: "STRING" as any, description: "The compacted, high-signal fact to remember (max 5-7 chunks)." }
    },
    required: ["text"]
  }
};

const retrieveContextFunc = {
  name: "retrieveContext",
  description: "Search the user's memory for relevant facts.",
  parameters: {
    type: "OBJECT" as any,
    properties: {
      query: { type: "STRING" as any, description: "The search query." }
    },
    required: ["query"]
  }
};

const forgetMemoryFunc = {
  name: "forgetMemory",
  description: "Delete a specific memory by ID.",
  parameters: {
    type: "OBJECT" as any,
    properties: {
      memoryId: { type: "STRING" as any, description: "The ID of the memory to delete." }
    },
    required: ["memoryId"]
  }
};

const editMemoryFunc = {
  name: "editMemory",
  description: "Edit an existing memory by ID with new text.",
  parameters: {
    type: "OBJECT" as any,
    properties: {
      memoryId: { type: "STRING" as any, description: "The ID of the memory to edit." },
      text: { type: "STRING" as any, description: "The new text for the memory." }
    },
    required: ["memoryId", "text"]
  }
};

const readUrlFunc = {
  name: "readUrl",
  description: "Fetch and read the content of a URL provided by the user.",
  parameters: {
    type: "OBJECT" as any,
    properties: {
      url: { type: "STRING" as any, description: "The URL to fetch." }
    },
    required: ["url"]
  }
};

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([{
    id: 'welcome',
    role: 'model',
    text: 'Hello! I am Memoria, your Metasystemic AI Architect. I operate using Cognitive Load Theory (CLT) principles to ensure high-signal, hallucination-free interactions. What would you like to process or discuss today?'
  }]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  // Settings
  const [userId, setUserId] = useState('user_123');
  const [apiKey, setApiKey] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingDoc(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/parse-file', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setInput(prev => {
        const prefix = prev ? prev + '\n\n' : '';
        return prefix + `--- Document: ${file.name} ---\n${data.text}\n--- End Document ---`;
      });
    } catch (error: any) {
      console.error("Upload error:", error);
      alert(`Failed to process document: ${error.message}`);
    } finally {
      setIsUploadingDoc(false);
      if (documentInputRef.current) documentInputRef.current.value = '';
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const headers: Record<string, string> = {};
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      
      const res = await fetch(`/api/memory/${userId}`, { headers });
      const data = await res.json();
      
      if (data.error) throw new Error(data.error);
      
      const blob = new Blob([JSON.stringify(data.memories, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `memoria_export_${userId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', text: `Successfully exported ${data.memories.length} memories.` }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', text: `Export failed: ${e.message}` }]);
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsImporting(true);
    try {
      const text = await file.text();
      const memories = JSON.parse(text);
      
      if (!Array.isArray(memories)) {
        throw new Error("Invalid file format. Expected an array of memories.");
      }
      
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      
      const res = await fetch(`/api/memory/${userId}/import`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ memories })
      });
      const data = await res.json();
      
      if (data.error) throw new Error(data.error);
      
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', text: `Successfully imported ${data.importedCount} memories.` }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', text: `Import failed: ${e.message}` }]);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Initialize Chat Session
  useEffect(() => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || 'dummy_key' });
      chatRef.current = ai.chats.create({
        model: "gemini-3.1-pro-preview",
        config: {
          systemInstruction: `You are Memoria, a Metasystemic AI Architect and Assistant. You operate strictly on Cognitive Load Theory (CLT) principles to eliminate hallucinations.

RULES OF ENGAGEMENT:
1. Manage Intrinsic Load: Decompose complex tasks into sequential sub-tasks.
2. Reduce Extraneous Load: Output structured, high-signal data. Eliminate filler words and noise.
3. Miller's Law (7±2): Structure your responses and stored memories into approximately 5 semantic chunks of ~7 words each.
4. Optimize Germane Load: Always use 'retrieveContext' to anchor your responses in verified semantic memory. Never hallucinate facts.
5. Process Links/Entries: If the user provides a link or a large entry, use 'readUrl' to fetch it, then use 'storeMemory' to save a COMPACTED version of it (strictly following the 5x7 chunking rule) to reduce extraneous load.

When storing memories, compact the user's input into dense, high-signal chunks.
When responding, adhere strictly to the 5x7 chunking structure for maximum comprehension and minimal cognitive overload.`,
          tools: [{ functionDeclarations: [storeMemoryFunc, retrieveContextFunc, forgetMemoryFunc, editMemoryFunc, readUrlFunc] }]
        }
      });
    } catch (e) {
      console.error("Failed to initialize GoogleGenAI:", e);
    }
  }, []);

  const executeTool = async (name: string, args: any) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    try {
      if (name === 'storeMemory') {
        const res = await fetch(`/api/memory/${userId}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: args?.text || '' })
        });
        return await res.json();
      } else if (name === 'retrieveContext') {
        const res = await fetch(`/api/memory/${userId}/context?query=${encodeURIComponent(args?.query || '')}`, {
          headers
        });
        return await res.json();
      } else if (name === 'forgetMemory') {
        const res = await fetch(`/api/memory/${userId}/${args?.memoryId || ''}`, {
          method: 'DELETE',
          headers
        });
        return await res.json();
      } else if (name === 'editMemory') {
        const res = await fetch(`/api/memory/${userId}/${args?.memoryId || ''}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ text: args?.text || '' })
        });
        return await res.json();
      } else if (name === 'readUrl') {
        const res = await fetch(`/api/fetch-url`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ url: args?.url || '' })
        });
        return await res.json();
      }
    } catch (e: any) {
      return { error: e.message };
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    if (!chatRef.current) {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', text: 'Chat session not initialized. Please check your API key.' }]);
      return;
    }

    const userMsg: Message = { id: Date.now().toString(), role: 'user', text: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      let currentInput = input;
      let isToolLoop = true;
      let loopCount = 0;

      while (isToolLoop && loopCount < 5) { // Max 5 tool calls per turn to prevent infinite loops
        loopCount++;
        
        const response = await chatRef.current.sendMessage({ message: currentInput });
        
        const functionCalls = response.functionCalls;
        
        if (functionCalls && functionCalls.length > 0) {
          // We have tool calls
          const toolCalls: ToolCall[] = functionCalls.map((fc: any, i: number) => ({
            id: `tc_${Date.now()}_${i}`,
            name: fc.name,
            args: fc.args,
            status: 'pending'
          }));

          const toolMsgId = Date.now().toString() + '_tool';
          setMessages(prev => [...prev, {
            id: toolMsgId,
            role: 'model',
            text: '',
            toolCalls
          }]);

          // Execute all tools in parallel
          const results = await Promise.all(toolCalls.map(async (tc) => {
            const result = await executeTool(tc.name, tc.args);
            
            // Update UI with result
            setMessages(prev => prev.map(msg => {
              if (msg.id === toolMsgId && msg.toolCalls) {
                return {
                  ...msg,
                  toolCalls: msg.toolCalls.map(t => t.id === tc.id ? { ...t, result, status: 'success' } : t)
                };
              }
              return msg;
            }));
            
            return { name: tc.name, result };
          }));

          // Prepare next input for the model with the tool results
          currentInput = `System: The tools returned the following results:\n${results.map(r => `- ${r.name}: ${JSON.stringify(r.result)}`).join('\n')}\nPlease continue your response based on these results.`;
          
        } else {
          // No tool calls, just normal text response
          isToolLoop = false;
          if (response.text) {
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              role: 'model',
              text: response.text
            }]);
          }
        }
      }
    } catch (error: any) {
      console.error("Chat error:", error);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'system',
        text: `Error: ${error.message}`
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const renderToolCall = (tc: ToolCall) => {
    const icons = {
      storeMemory: <Save className="w-4 h-4 text-emerald-500" />,
      retrieveContext: <Search className="w-4 h-4 text-blue-500" />,
      forgetMemory: <Trash2 className="w-4 h-4 text-red-500" />,
      editMemory: <Edit2 className="w-4 h-4 text-amber-500" />,
      readUrl: <Link className="w-4 h-4 text-indigo-500" />
    };

    const labels = {
      storeMemory: 'Storing Memory',
      retrieveContext: 'Recalling Context',
      forgetMemory: 'Forgetting Memory',
      editMemory: 'Editing Memory',
      readUrl: 'Reading URL'
    };

    return (
      <div key={tc.id} className="flex flex-col gap-2 my-2 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700/50 text-sm">
        <div className="flex items-center gap-2 font-medium text-zinc-700 dark:text-zinc-300">
          {tc.status === 'pending' ? <Loader2 className="w-4 h-4 animate-spin text-zinc-400" /> : icons[tc.name as keyof typeof icons]}
          <span>{labels[tc.name as keyof typeof labels] || tc.name}</span>
        </div>
        
        <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono bg-zinc-100 dark:bg-zinc-900 p-2 rounded">
          {tc.name === 'storeMemory' && `"${tc.args?.text || ''}"`}
          {tc.name === 'retrieveContext' && `Query: "${tc.args?.query || ''}"`}
          {tc.name === 'forgetMemory' && `ID: ${tc.args?.memoryId || ''}`}
          {tc.name === 'editMemory' && `ID: ${tc.args?.memoryId || ''} -> "${tc.args?.text || ''}"`}
          {tc.name === 'readUrl' && `URL: ${tc.args?.url || ''}`}
        </div>

        {tc.status === 'success' && tc.result && (
          <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 border-t border-zinc-200 dark:border-zinc-700 pt-2">
            {tc.name === 'retrieveContext' ? (
              <div>
                <span className="font-semibold">Found {tc.result.results?.length || 0} memories:</span>
                <ul className="list-disc pl-4 mt-1">
                  {tc.result.results?.map((m: any, i: number) => (
                    <li key={i} className="truncate">{m.text}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <span className="text-emerald-600 dark:text-emerald-400">Success</span>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-4xl mx-auto bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center">
            <Brain className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Memoria Agent</h2>
            <p className="text-xs text-zinc-500">Knowledge-augmented assistant</p>
          </div>
        </div>
        <button 
          onClick={() => setShowSettings(!showSettings)}
          className="p-2 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
        >
          <Settings className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
        </button>
      </div>

      {/* Settings Panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80 overflow-hidden"
          >
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">User ID</label>
                <input 
                  type="text" 
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="e.g., user_123"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Memoria API Key (Optional)</label>
                <input 
                  type="password" 
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="Bearer token..."
                />
              </div>
              <div className="md:col-span-2 flex flex-wrap gap-3 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  onClick={handleExport}
                  disabled={isExporting}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
                >
                  {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  Export Memories
                </button>
                
                <input 
                  type="file" 
                  accept=".json" 
                  ref={fileInputRef} 
                  onChange={handleImport} 
                  className="hidden" 
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isImporting}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
                >
                  {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  Import Memories
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {messages.map((msg) => (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            key={msg.id} 
            className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
              msg.role === 'user' 
                ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400' 
                : msg.role === 'system'
                ? 'bg-red-100 text-red-600'
                : 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400'
            }`}>
              {msg.role === 'user' ? <User className="w-5 h-5" /> : msg.role === 'system' ? <Settings className="w-5 h-5" /> : <Brain className="w-5 h-5" />}
            </div>
            
            <div className={`flex flex-col max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              {msg.text && (
                <div className={`px-4 py-3 rounded-2xl ${
                  msg.role === 'user' 
                    ? 'bg-indigo-600 text-white rounded-tr-sm' 
                    : msg.role === 'system'
                    ? 'bg-red-50 text-red-900 border border-red-200 rounded-tl-sm text-sm font-mono'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-tl-sm'
                }`}>
                  {msg.role === 'user' ? (
                    msg.text
                  ) : (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                  )}
                </div>
              )}
              
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="w-full mt-2 flex flex-col gap-2">
                  {msg.toolCalls.map(renderToolCall)}
                </div>
              )}
            </div>
          </motion.div>
        ))}
        
        {isLoading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center shrink-0">
              <Brain className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="px-4 py-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800 rounded-tl-sm flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
              <span className="text-sm text-zinc-500">Thinking...</span>
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <form 
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 rounded-full p-1 border border-zinc-200 dark:border-zinc-700 focus-within:ring-2 focus-within:ring-indigo-500/50 transition-all"
        >
          <input
            type="file"
            accept=".txt,.md,.csv,.json,.pdf"
            ref={documentInputRef}
            onChange={handleDocumentUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => documentInputRef.current?.click()}
            disabled={isLoading || isUploadingDoc}
            className="p-2 rounded-full text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
            title="Upload Document"
          >
            {isUploadingDoc ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask me anything, paste a link, or upload a document..."
            className="flex-1 bg-transparent px-2 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none"
            disabled={isLoading || isUploadingDoc}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading || isUploadingDoc}
            className="p-2 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:hover:bg-indigo-600 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
        <div className="text-center mt-2">
          <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-semibold">Powered by Memoria & Gemini</span>
        </div>
      </div>
    </div>
  );
}
