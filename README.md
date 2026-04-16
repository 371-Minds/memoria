# Memoria Protocol: Permanent, Hyper-Thin AI Memory

![Catalog ID](https://img.shields.io/badge/Catalog_ID-371--REPO--CORE--001-blue)
![Tier](https://img.shields.io/badge/Strategic_Tier-1_(Core)-red)
![Autonomy](https://img.shields.io/badge/Autonomy-AI__Assisted-green)

**Powered by 371-OS & CORTEX Amplifier**

Memoria Protocol is a drop-in "Memory-as-a-Service" API designed to solve the hardest part of building AI applications: memory management and context retention. It features hyper-thin compression via **TurboQuant** and cryptographically verifiable permanence via **GitMind**.

## 🧠 Cognitive Optimization Overview

Memoria accelerates pattern recognition and hyper-focus channeling by offloading context management from the developer to an autonomous system. It provides episodic memory for AI agents, allowing them to maintain context across sessions seamlessly.

## 🚀 Features

- **TurboQuant & PolarQuant:** Hyper-thin memory compression. Reduces embedding storage by up to 95% using 4-bit (int4) quantization, aligning with modern GGUF standards while maintaining 99% retrieval accuracy.
- **Multimodal Support:** Store and retrieve text, audio, video, and images in a unified semantic space.
- **`--mref` Symbolic Context Injection:** Lazy-load context and trigger executable workflows using microscopic 6-character symbolic pointers (e.g., `--mref a1b2c3`).
- **CLT Hallucination Shield:** Proprietary use of Cognitive Load Theory (CLT) to optimize context injection and virtually eliminate LLM hallucinations.
- **GitMind Encapsulation:** Permanent, cryptographically verifiable memory snapshots natively integrated into the agent's Git history.
- **Zero-Setup Vector Store:** Send text, and we automatically embed and store it using Google Gemini Embeddings (`gemini-embedding-2-preview`).
- **Frictionless Storage:** Memories are stored locally in a persistent `data/memories.json` file by default. 
- **Enterprise Scale with ClickHouse:** Instantly scale to billions of vectors by providing a `CLICKHOUSE_HOST`. Memoria automatically switches from local JSON to ClickHouse for high-performance vector search.
- **Model Context Protocol (MCP) Server:** Fully compatible with Claude Desktop and Cursor via the included MCP Server.
- **Semantic Retrieval:** Query by meaning, not just keywords.
- **User Segregation & Security:** Strict partitioning by `userId` and secured via `MEMORIA_API_KEY` authentication.

## ⚡ TurboQuant Compression (PolarQuant)

Memoria Protocol uses the **PolarQuant** algorithm to compress high-dimensional embeddings. This aligns with modern LLM quantization techniques (like GGUF Q4) for hyper-thin storage. This allows for:
- **95% Reduction** in storage requirements via 4-bit (int4) quantization.
- **Faster Retrieval** due to reduced vector dimensionality.
- **Minimal Accuracy Loss** (99% retention of semantic meaning).

## 👁️ Multimodal Memory (Audio, Video, Images)

Memoria maps text, images, audio, and video into the exact same 768-dimensional vector space using Gemini's native multimodal embeddings. 

**"Pointers, not Blobs" Architecture:**
To keep Memoria hyper-thin, we do not store the raw video or audio files in the database. Instead:
1. You pass the media to Memoria.
2. Memoria generates the 4-bit semantic embedding.
3. Memoria stores the embedding and a `mediaUrl` pointer to your external blob storage (S3, Arweave, local disk).
4. You can use text queries to instantly retrieve the exact video or audio clip based on its semantic meaning.

## 🔗 `--mref` Symbolic Context Injection & Latent Briefing

Inspired by Midjourney's `--sref` parameter and the industry shift toward **Latent Briefing** (proven to cut multi-agent token usage by 65%+), Memoria introduces the **Memory Reference (`--mref`) Protocol** to solve Context Window Bloat and Action Routing.

**1. Latent Briefing (Lazy-Loading Context)**
Instead of injecting a 2,000-token medical document into the LLM's prompt, Memoria injects a micro-summary and a pointer:
> `[Context: User had a severe allergic reaction to peanuts in 2024. --mref mem_8x9f2a]`

If the receiving agent needs the exact medical details, it uses an MCP tool to call `expand_mref("mem_8x9f2a")`. This "Latent Briefing" approach keeps the context window hyper-thin, drastically reduces token costs, and prevents cognitive overload in multi-agent handoffs.

**2. Executable Memories (Triggering Workflows)**
An `--mref` can point to an **Executable Payload** (JSON).
If you store a memory about server outages:
> `[Protocol: If the database crashes, initiate the failover script. --mref exec_db_failover]`

When the LLM detects a crash, it simply outputs: `Executing failover: --mref exec_db_failover`. The host system (like 371-OS) intercepts this symbol and directly triggers the hard-coded API/workflow, bypassing the need for complex LLM function-calling schemas.

## 💾 Projected Storage Needs (Consumer Hardware)

Because of the 4-bit quantization, Memoria is designed to run locally alongside your models (like `llama.cpp`) without fighting them for VRAM. It runs entirely on standard system RAM and CPU.

- **1 Memory** (Text or Media Pointer): **~1 Kilobyte (1 KB)**
- **10,000 Memories:** **~10 MB** (Runs flawlessly on a Raspberry Pi. Enough for a highly active standalone agent operating for months).
- **1 Million Memories:** **~1 GB** (Runs on a standard laptop. Enough for a full "C-Suite" of agents).
- **1 Billion Memories:** **~1 TB** (Enterprise scale via the built-in ClickHouse integration).

## 💸 Embedding Economics (Google Gemini)

Memoria leverages Google's `gemini-embedding-2-preview` for state-of-the-art multimodal embeddings at microscopic costs.

- **Free Tier:** 1,500 requests per day completely free via Google AI Studio (perfect for personal agents).
- **Paid Tier (Pay-As-You-Go):**
  - **Text:** ~$0.00002 per 1,000 characters (~$0.10 to embed 10,000 journal entries).
  - **Images:** ~$0.00002 per image (~$0.02 to embed 1,000 images).
  - **Audio/Video:** ~$0.00002 per second (~$0.07 to embed an hour of media).

You can embed an agent's entire lifetime of thoughts, a library of reference books, and hundreds of case study videos for under $1.00.

## 🏛️ GitMind Permanence & Governance

Critical memories can be "frozen" and encapsulated into strict cryptographic snapshots via the **GitMind** Protocol. 

Unlike models that treat memory as a transient session cache (which leads to context decay), GitMind provides true permanence without the heavy dependencies of Web3 SDKs:
- **Zero-Dependency Cryptography:** Generates a deterministic Merkle root (SHA-256 hash) of the agent's memory array.
- **Git Integration:** Designed to perfectly align with the Docusaurus Agent architecture. Committing the `docs/memoria/*.json` files to Git directly permanently mathematically links the agent's brain state to its commit history.
- **Verifiability:** Each memory snapshot is cryptographically locked, preventing tampering and providing an absolute audit trail of the agent's learned experiences.

## 🛡️ CLT Hallucination Shield

Memoria Protocol leverages a proprietary implementation of **Cognitive Load Theory (CLT)** to manage how context is delivered to the LLM. By dynamically adjusting the density and relevance of retrieved memories, we:
- **Minimize Noise:** Prevent the model from being overwhelmed by irrelevant data.
- **Eliminate Hallucinations:** Ensure the model stays grounded in the provided factual context.
- **Optimize Token Usage:** Deliver the most impactful information within the model's context window.

## ⚡ Hyper-Thin Runtime (Bun vs Node.js)

Memoria is optimized to run on [Bun](https://bun.sh/) for maximum performance and minimal disk usage, though standard Node.js is fully supported.

**Why use Bun?**
- **Zero-Byte Duplicate `node_modules`:** Bun uses a global cache and hard links. If you spin up 10 different Memoria instances for 10 different agents, they all point to the exact same physical files. Your `node_modules` takes up 0 extra bytes of disk space.
- **Lightning Fast Boot:** Starts up to 4x faster than Node.js, using Apple's JavaScriptCore engine for a smaller baseline memory footprint.

**Option A: Run with Bun (Recommended)**
```bash
# 1. Install Bun
curl -fsSL https://bun.sh/install | bash

# 2. Install dependencies (takes milliseconds)
bun install

# 3. Start the server
bun run dev
```

**Option B: Run with Node.js / NPM**
```bash
npm install
npm run dev
```

## 🐳 1-Click Deployment (Docker & Akash)

Memoria is designed for frictionless deployment on decentralized and traditional clouds.

### Docker Compose
Run Memoria and ClickHouse locally with a single command:
```bash
docker-compose up -d
```

### Akash Network (Decentralized Cloud)
Deploy to the Akash Network using the included `akash.yml` Stack Definition Language (SDL) file. This provisions both the Memoria API and a ClickHouse database on decentralized compute.

## 🔌 Model Context Protocol (MCP) Integration

Memoria includes a built-in MCP server, allowing you to instantly give AI assistants long-term memory.

### Starting the MCP Server

```bash
npm run mcp
```

### 1. Claude Desktop

Add the following to your `claude_desktop_config.json` (usually located at `~/Library/Application Support/Claude/claude_desktop_config.json` on Mac or `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "memoria": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/memoria/mcp-server.ts"]
    }
  }
}
```

### 2. Cursor IDE

Cursor supports MCP natively. To add Memoria:
1. Open Cursor Settings (`Cmd/Ctrl + Shift + J`).
2. Navigate to **Features** > **MCP**.
3. Click **+ Add New MCP Server**.
4. Set the following:
   - **Name:** `memoria`
   - **Type:** `command`
   - **Command:** `npx tsx /absolute/path/to/memoria/mcp-server.ts`
5. Click **Save** and ensure the status shows a green dot (Connected).

### 3. Windsurf (Codeium)

Windsurf supports MCP via its global configuration. Add this to your `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "memoria": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/memoria/mcp-server.ts"]
    }
  }
}
```

### 4. Zed Editor

Zed has built-in MCP support. Open your Zed settings (`Cmd/Ctrl + ,`) and add the `mcp` block:

```json
{
  "mcp": {
    "memoria": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/memoria/mcp-server.ts"]
    }
  }
}
```

### 5. Continue.dev (VS Code / JetBrains)

If you use the Continue extension, open your `~/.continue/config.json` and add Memoria to the `mcpServers` array:

```json
{
  "mcpServers": [
    {
      "name": "memoria",
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/memoria/mcp-server.ts"]
    }
  ]
}
```

### Available MCP Tools

Once connected to any of the above clients, the AI will automatically have access to three new tools:
- `store_memory(userId, text)`: Saves a new fact/memory.
- `retrieve_context(userId, query, topK)`: Performs a semantic search to recall facts.
- `forget_memory(userId, memoryId)`: Deletes an outdated memory.

## 💻 API Documentation

### 0. Health Check
`GET /api/health`

Check if the service is online and ready to accept traffic. Does not require authentication.

```bash
curl -X GET https://api.memoria.ai/api/health
```

### 1. Store Memory
`POST /api/memory/[userId]`

```bash
curl -X POST https://api.memoria.ai/api/memory/user_123 \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "I am allergic to peanuts"}'
```

### 2. Retrieve Context
`GET /api/memory/[userId]/context?query=[your_query]&topK=3`

```bash
curl -X GET "https://api.memoria.ai/api/memory/user_123/context?query=recipe_recommendations" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### 3. List Memories
`GET /api/memory/[userId]`

Retrieve all stored memories for a specific user.

### 4. Forget Memory
`DELETE /api/memory/[userId]/[memoryId]`

Delete a specific memory by its ID.

## 🛡️ Security & Rate Limiting

- **Multi-Tenant API Keys:** Memoria supports multiple API keys. You can set a single key via `MEMORIA_API_KEY` or a comma-separated list of keys via `MEMORIA_API_KEYS` (e.g., `key1,key2,key3`).
- **Rate Limiting:** To protect your infrastructure and AI provider credits, Memoria includes a built-in, self-cleaning rate limiter:
  - `POST` (Store): 50 req/min per user
  - `GET` (Context Search): 50 req/min per user
  - `GET` (List): 100 req/min per user
  - `DELETE`: 100 req/min per user

Exceeding these limits returns a `429 Too Many Requests` with standard `X-RateLimit-*` headers.

## 💎 Economic Integration Protocol (371 DAO)

As part of the 371-OS autonomous business ecosystem, Memoria integrates with our internal token economics:

- **Internal Wallet Address:** `371-INT-MEMORIA-8X9F2A` 
  *(Used for revenue attribution, internal token economics, and performance incentives based on cognitive optimization achievements)*
- **Customer Wallet Address:** `371-CUST-NEW-USER-001` 
  *(Generated for your token economy participation. Earn Customer Loyalty Tokens by engaging with the platform, providing feedback, and achieving optimization milestones)*

## 📊 371 Minds Master Registry (MDW Protocol)

Memoria is architected as a **Tokenized Knowledge Estate** within the 371 Minds ecosystem. It is not just scattered code; it is an autonomous asset.

- **Catalog ID:** `371-REPO-CORE-001`
- **Registry File:** See [`REGISTRY.md`](./REGISTRY.md) for the full Master/Detail/Workflow (MDW) economic and strategic breakdown.
- **CORTEX Integration:** The repository includes `lib/schema.ts` containing the `RepoRegistryEntry` interface, allowing the Intelligent Router and HubCortex to programmatically harvest and index this asset.

## 🛠️ Tech Stack

- **Runtime:** Bun (Recommended) or Node.js (Next.js 15 App Router)
- **Styling:** Tailwind CSS v4
- **AI/Embeddings:** `@google/genai` (`gemini-embedding-2-preview`)
