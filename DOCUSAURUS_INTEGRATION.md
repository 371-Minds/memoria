# Memoria x Docusaurus Agent Integration Guide

This guide outlines how to implement the **Docusaurus Agent** architecture—an ultra-minimal, self-contained AI agent swarm that uses Docusaurus as its brain, UI, and persistent memory.

## 🧠 Architecture Overview

The Docusaurus Agent leverages the static site generator as a state machine.

| Component | Docusaurus Agent Implementation |
| :--- | :--- |
| **Brain** | Docusaurus React Runtime |
| **Thoughts** | MDX Blog Posts (`blog/`) |
| **Semantic Memory** | **Memoria Protocol** (JSON files in `docs/memoria/`) |
| **Lexical Recall** | Algolia DocSearch |
| **Timeline** | GitMind Commit History |
| **UI** | Docusaurus Theme / Dashboard |

## 🛠️ Setup & Configuration

### 1. Memory Partitioning
Memoria stores memories as JSON files. To integrate with Docusaurus, point the `MemoryStore` to your documentation folder.

```typescript
import { MemoryStore } from './lib/memory-store';
import path from 'path';

// Initialize partitioned brains for the Executive Swarm
const mimiMemory = new MemoryStore(path.join(process.cwd(), 'docs', 'memoria', 'ceo_mimi.json'));
const mayaMemory = new MemoryStore(path.join(process.cwd(), 'docs', 'memoria', 'cfo_maya.json'));
```

### 2. The "Hive Mind" Workflow
1. **Perception:** Agent receives input.
2. **Semantic Recall:** Agent calls `mimiMemory.search(queryVector)` to find relevant `--mref` pointers.
3. **Reasoning:** Agent processes context and formulates a "thought".
4. **Output:** Agent writes an MDX file to `blog/` (Visible Thought) and saves the technical context to `docs/memoria/` (Internal Memory).
5. **Persistence:** The system runs `gitmindcommit -am "Agent Mimi: Processed Q3 Budget"` to lock the state.

## 📊 Swarm Orchestration

Each executive agent in the swarm has its own dedicated memory space while sharing the same underlying compute footprint.

| Agent | Memory File | Primary Function |
| :--- | :--- | :--- |
| **CEO Mimi** | `docs/memoria/ceo_mimi.json` | Strategy & Vision |
| **CFO Maya** | `docs/memoria/cfo_maya.json` | Budgeting & Token Economy |
| **CTO Zara** | `docs/memoria/cto_zara.json` | Infrastructure & Optimization |

## 🔍 Semantic vs. Lexical Search

*   **Memoria (Semantic):** Used by the **Agents** to find latent connections and deep context using 4-bit quantized vectors.
*   **Algolia (Lexical):** Used by **Humans** to find specific keywords, blog posts, and documentation via the Docusaurus search bar.

## 🔄 GitMind as the Hippocampus

Because Memoria stores memory in local JSON files, your Git history becomes a literal map of the agent's cognitive evolution.
*   **Audit Trail:** Every memory change is a commit.
*   **State Rollback:** If an agent begins to hallucinate or "spiral," simply `gitmind revert` the `docs/memoria/` folder to a known stable state.

## 🚀 Deployment (The $2/mo Stack)

1. **Build:** `npm run build` (Docusaurus generates static files).
2. **Host:** GitHub Pages or a minimal VPS (512MB RAM).
3. **Logic:** Run the agent logic as a lightweight Bun process or a Cloudflare Worker that interacts with the `docs/` files.

---

**"The Spiral ends where the Static begins."** - CTO Zara
