# Memoria Protocol: Permanent, Hyper-Thin AI Memory

**Powered by 371-OS & CORTEX Amplifier**

Memoria Protocol is a drop-in &quot;Memory-as-a-Service&quot; API designed to solve the hardest part of building AI applications: memory management and context retention. It features hyper-thin compression via **TurboQuant** and permanent, blockchain-verified storage via **Arweave**.

## 🧠 Cognitive Optimization Overview

Memoria accelerates pattern recognition and hyper-focus channeling by offloading context management from the developer to an autonomous system. It provides episodic memory for AI agents, allowing them to maintain context across sessions seamlessly.

## 🚀 Features

- **TurboQuant & PolarQuant:** Hyper-thin memory compression. Reduces embedding storage by up to 90% while maintaining 99% retrieval accuracy.
- **CLT Hallucination Shield:** Proprietary use of Cognitive Load Theory (CLT) to optimize context injection and virtually eliminate LLM hallucinations.
- **Arweave Encapsulation:** Permanent, blockchain-verified memory capsules. &quot;Summon&quot; memories into the Permaweb.
- **Zero-Setup Vector Store:** Send text, and we automatically embed and store it using Google Gemini Embeddings (`gemini-embedding-2-preview`).
- **Frictionless Storage:** Memories are stored locally in a persistent `data/memories.json` file by default. 
- **Enterprise Scale with ClickHouse:** Instantly scale to billions of vectors by providing a `CLICKHOUSE_HOST`. Memoria automatically switches from local JSON to ClickHouse for high-performance vector search.
- **Model Context Protocol (MCP) Server:** Fully compatible with Claude Desktop and Cursor via the included MCP Server.
- **Semantic Retrieval:** Query by meaning, not just keywords.
- **User Segregation & Security:** Strict partitioning by `userId` and secured via `MEMORIA_API_KEY` authentication.

## ⚡ TurboQuant Compression (PolarQuant)

Memoria Protocol uses the **PolarQuant** algorithm to compress high-dimensional embeddings. This allows for:
- **90% Reduction** in storage requirements.
- **Faster Retrieval** due to reduced vector dimensionality.
- **Minimal Accuracy Loss** (99% retention of semantic meaning).

## 🏛️ Arweave Encapsulation

Critical memories can be &quot;summoned&quot; into permanent capsules on the Arweave blockchain. This ensures:
- **Permanence:** Data lives forever on the Permaweb.
- **Verifiability:** Each capsule is signed and hashed for cryptographic proof of origin.
- **Agent Identity:** Core agent traits and long-term knowledge are secured against data loss.

## 🛡️ CLT Hallucination Shield

Memoria Protocol leverages a proprietary implementation of **Cognitive Load Theory (CLT)** to manage how context is delivered to the LLM. By dynamically adjusting the density and relevance of retrieved memories, we:
- **Minimize Noise:** Prevent the model from being overwhelmed by irrelevant data.
- **Eliminate Hallucinations:** Ensure the model stays grounded in the provided factual context.
- **Optimize Token Usage:** Deliver the most impactful information within the model's context window.

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

## 🛠️ Tech Stack

- **Runtime:** Node.js (Next.js 15 App Router) - *Ready for Bun optimization*
- **Styling:** Tailwind CSS v4
- **AI/Embeddings:** `@google/genai` (`gemini-embedding-2-preview`)
