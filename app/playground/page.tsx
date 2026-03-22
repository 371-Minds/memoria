'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Send, Search, Database, Loader2, Trash2 } from 'lucide-react';

export default function Playground() {
  const [userId, setUserId] = useState('user_123');
  const [apiKey, setApiKey] = useState('');
  const [memoryText, setMemoryText] = useState('');
  const [queryText, setQueryText] = useState('');
  
  const [isAdding, setIsAdding] = useState(false);
  const [isQuerying, setIsQuerying] = useState(false);
  
  const [memories, setMemories] = useState<any[]>([]);
  const [queryResults, setQueryResults] = useState<any>(null);

  const getHeaders = React.useCallback(() => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    return headers;
  }, [apiKey]);

  useEffect(() => {
    // Fetch all memories for the user
    const fetchMemories = async () => {
      try {
        const res = await fetch(`/api/memory/${userId}`, { headers: getHeaders() });
        if (res.ok) {
          const data = await res.json();
          setMemories(data.memories || []);
        }
      } catch (error) {
        console.error("Failed to fetch memories", error);
      }
    };

    fetchMemories();
  }, [userId, getHeaders]);

  const fetchMemoriesManual = async () => {
    try {
      const res = await fetch(`/api/memory/${userId}`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories || []);
      }
    } catch (error) {
      console.error("Failed to fetch memories", error);
    }
  };

  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memoryText.trim()) return;

    setIsAdding(true);
    try {
      const res = await fetch(`/api/memory/${userId}`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ text: memoryText }),
      });
      
      if (res.ok) {
        setMemoryText('');
        fetchMemoriesManual();
      } else {
        const data = await res.json();
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error("Failed to add memory", error);
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteMemory = async (memoryId: string) => {
    try {
      const res = await fetch(`/api/memory/${userId}/${memoryId}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      if (res.ok) {
        fetchMemoriesManual();
      } else {
        const data = await res.json();
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error("Failed to delete memory", error);
    }
  };

  const handleQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryText.trim()) return;

    setIsQuerying(true);
    try {
      const res = await fetch(`/api/memory/${userId}/context?query=${encodeURIComponent(queryText)}&topK=3`, {
        headers: getHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setQueryResults(data);
      } else {
        const data = await res.json();
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error("Failed to query memory", error);
    } finally {
      setIsQuerying(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <header className="border-b border-zinc-800 bg-zinc-900/50">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-4">
          <Link href="/" className="text-zinc-400 hover:text-zinc-50 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="h-4 w-px bg-zinc-800" />
          <span className="font-semibold">API Playground</span>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-6 grid lg:grid-cols-2 gap-8">
        
        {/* Left Column: Add Memory & View Store */}
        <div className="space-y-8">
          
          {/* User Config */}
          <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">Configuration</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Active User ID</label>
                <input 
                  type="text" 
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                />
                <p className="text-xs text-zinc-500 mt-2">Memories are strictly partitioned by this ID.</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">API Key (Optional)</label>
                <input 
                  type="password" 
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter MEMORIA_API_KEY if configured"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                />
              </div>
            </div>
          </div>

          {/* Add Memory */}
          <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">1. Store Memory</h2>
            <form onSubmit={handleAddMemory} className="space-y-4">
              <div>
                <textarea 
                  value={memoryText}
                  onChange={(e) => setMemoryText(e.target.value)}
                  placeholder="e.g., I am allergic to peanuts and I love spicy food."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-sm min-h-[100px] resize-none focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                />
              </div>
              <button 
                type="submit" 
                disabled={isAdding || !memoryText.trim()}
                className="w-full h-10 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-950 font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                {isAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Save to Memory
              </button>
            </form>
          </div>

          {/* View Store */}
          <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Database State</h2>
              <span className="text-xs font-mono bg-zinc-800 px-2 py-1 rounded text-zinc-300">{memories.length} items</span>
            </div>
            
            {memories.length === 0 ? (
              <div className="text-center py-8 text-zinc-500 flex flex-col items-center">
                <Database className="w-8 h-8 mb-2 opacity-20" />
                <p className="text-sm">No memories stored for this user yet.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                {memories.map((m) => (
                  <div key={m.id} className="p-3 rounded-lg bg-zinc-950 border border-zinc-800/50 text-sm group relative">
                    <p className="text-zinc-300 pr-8">{m.text}</p>
                    <button 
                      onClick={() => handleDeleteMemory(m.id)}
                      className="absolute top-3 right-3 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Forget Memory"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-zinc-800/50">
                      <span className="text-[10px] font-mono text-zinc-600">{m.id}</span>
                      <span className="text-[10px] text-zinc-500">{new Date(m.createdAt).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* Right Column: Query Context */}
        <div className="space-y-8">
          
          {/* Query */}
          <div className="p-6 rounded-2xl bg-zinc-900 border border-emerald-500/30 shadow-[0_0_30px_rgba(16,185,129,0.05)] relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl" />
            
            <h2 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider mb-4">2. Retrieve Context</h2>
            <form onSubmit={handleQuery} className="space-y-4 relative z-10">
              <div>
                <label className="block text-sm font-medium mb-2">Simulate an LLM Prompt</label>
                <input 
                  type="text" 
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  placeholder="e.g., Can you recommend a good Thai recipe?"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                />
              </div>
              <button 
                type="submit" 
                disabled={isQuerying || !queryText.trim()}
                className="w-full h-10 rounded-lg bg-zinc-100 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed text-zinc-900 font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                {isQuerying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Fetch Relevant Context
              </button>
            </form>
          </div>

          {/* Results */}
          {queryResults && (
            <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">API Response</h2>
              
              <div className="mb-6">
                <h3 className="text-xs font-medium text-zinc-500 mb-2">Injected Context Array</h3>
                <div className="bg-zinc-950 rounded-lg p-4 border border-zinc-800 font-mono text-sm overflow-x-auto">
                  <pre className="text-emerald-400">
                    {JSON.stringify(queryResults.context, null, 2)}
                  </pre>
                </div>
                <p className="text-xs text-zinc-500 mt-2">
                  Inject this array directly into your system prompt before calling the LLM.
                </p>
              </div>

              <div>
                <h3 className="text-xs font-medium text-zinc-500 mb-2">Vector Search Details</h3>
                <div className="space-y-2">
                  {queryResults.results.map((r: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-zinc-950 border border-zinc-800/50">
                      <div className="flex-shrink-0 w-10 h-10 rounded bg-zinc-900 flex items-center justify-center text-xs font-mono text-zinc-500 border border-zinc-800">
                        {(r.score * 100).toFixed(0)}%
                      </div>
                      <p className="text-sm text-zinc-300 truncate">{r.text}</p>
                    </div>
                  ))}
                  {queryResults.results.length === 0 && (
                    <p className="text-sm text-zinc-500 italic">No relevant context found.</p>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
