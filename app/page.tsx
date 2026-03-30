import Link from 'next/link';
import { ArrowRight, Brain, Database, Zap, Code2, Terminal, Shield } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Navigation */}
      <header className="border-b border-zinc-800/50 bg-zinc-950/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-6 h-6 text-emerald-500" />
            <span className="font-bold text-lg tracking-tight">Memoria Protocol</span>
          </div>
          <nav className="flex items-center gap-6 text-sm font-medium text-zinc-400">
            <Link href="#features" className="hover:text-zinc-50 transition-colors">Features</Link>
            <Link href="#docs" className="hover:text-zinc-50 transition-colors">Documentation</Link>
            <Link href="/chat" className="text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1">
              <Brain className="w-4 h-4" /> Agent
            </Link>
            <Link href="/playground" className="text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1">
              Playground <ArrowRight className="w-4 h-4" />
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative pt-32 pb-20 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-emerald-900/20 via-zinc-950 to-zinc-950 -z-10" />
          
          <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-16 items-center">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-medium mb-6 border border-emerald-500/20">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                v1.0 API Now Live
              </div>
              <h1 className="text-5xl sm:text-6xl font-bold tracking-tight mb-6 leading-[1.1]">
                Permanent, Hyper-Thin Memory for <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">AI Agents</span>
              </h1>
              <p className="text-lg text-zinc-400 mb-8 leading-relaxed">
                The hardest part of building AI apps isn&apos;t the LLM call—it&apos;s memory management. 
                Memoria Protocol is a drop-in &quot;Memory-as-a-Service&quot; API that handles vector databases, 
                hyper-thin compression with <b>TurboQuant</b>, and permanent storage via <b>Arweave</b>.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <Link 
                  href="/chat" 
                  className="h-12 px-6 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold flex items-center gap-2 transition-colors"
                >
                  <Brain className="w-4 h-4" />
                  Talk to Agent
                </Link>
                <Link 
                  href="/playground" 
                  className="h-12 px-6 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold flex items-center gap-2 transition-colors"
                >
                  Try the Playground
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link 
                  href="#docs" 
                  className="h-12 px-6 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-50 font-medium flex items-center gap-2 transition-colors"
                >
                  <Terminal className="w-4 h-4" />
                  View API Docs
                </Link>
              </div>
            </div>

            {/* Code Window */}
            <div className="relative rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900/50 shadow-2xl">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-zinc-900">
                <div className="w-3 h-3 rounded-full bg-rose-500/20 border border-rose-500/50" />
                <div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/50" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500/50" />
                <span className="ml-2 text-xs font-mono text-zinc-500">api-example.sh</span>
              </div>
              <div className="p-6 font-mono text-sm overflow-x-auto">
                <div className="text-zinc-500 mb-2"># 1. Save a memory for a user</div>
                <div className="text-emerald-400 mb-6">
                  <span className="text-pink-400">curl</span> -X POST https://api.memoria.ai/v1/memory/user_123 \
                  <br />  -H <span className="text-yellow-300">&quot;Content-Type: application/json&quot;</span> \
                  <br />  -d <span className="text-yellow-300">&apos;&#123;&quot;text&quot;: &quot;I am allergic to peanuts&quot;&#125;&apos;</span>
                </div>
                
                <div className="text-zinc-500 mb-2"># 2. Retrieve relevant context later</div>
                <div className="text-emerald-400 mb-2">
                  <span className="text-pink-400">curl</span> -X GET &quot;https://api.memoria.ai/v1/memory/user_123/context?query=recipe_recommendations&quot;
                </div>
                <div className="text-zinc-400">
                  &#123;
                  <br />  <span className="text-cyan-300">&quot;context&quot;</span>: [
                  <br />    <span className="text-yellow-300">&quot;I am allergic to peanuts&quot;</span>
                  <br />  ]
                  <br />&#125;
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="py-24 border-t border-zinc-800/50 bg-zinc-950">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight mb-4">Infrastructure you don&apos;t have to build</h2>
              <p className="text-zinc-400 max-w-2xl mx-auto">
                Stop wrestling with vector databases and embedding models. We provide a simple REST API that handles the complexity.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800">
                <div className="w-12 h-12 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-6">
                  <Zap className="w-6 h-6 text-emerald-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">TurboQuant Compression</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">
                  Our proprietary <b>PolarQuant</b> algorithm reduces embedding storage by up to 90% while maintaining 99% retrieval accuracy. Hyper-thin memory for the next generation of agents.
                </p>
              </div>
              <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800">
                <div className="w-12 h-12 rounded-lg bg-cyan-500/10 flex items-center justify-center mb-6">
                  <Database className="w-6 h-6 text-cyan-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Arweave Encapsulation</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">
                  &quot;Summon&quot; memories into permanent, blockchain-verified capsules. Ensure your agent&apos;s core identity and critical knowledge live forever on the Permaweb.
                </p>
              </div>
              <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800">
                <div className="w-12 h-12 rounded-lg bg-violet-500/10 flex items-center justify-center mb-6">
                  <Shield className="w-6 h-6 text-violet-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Protocol-Level Privacy</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">
                  Memory is strictly partitioned and encrypted. Memoria Protocol ensures that user context is never leaked across agent boundaries or sessions.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="py-8 border-t border-zinc-800/50 text-center text-sm text-zinc-500">
        <p>Built with Next.js, Google Gemini, and Arweave. Part of the 371-OS Ecosystem.</p>
      </footer>
    </div>
  );
}
