import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/**
 * MCP front end. It deliberately does not import the store: every tool is an HTTP
 * call to the running app, so the MCP path and the REST path cannot drift into two
 * different behaviours (and the app remains the only writer of the SQLite file).
 */
const API_URL = process.env.APP_URL || process.env.MEMORIA_APP_URL || "http://localhost:3000";
const API_KEY = process.env.MEMORIA_API_KEY || "";

const headers: Record<string, string> = { "Content-Type": "application/json" };
if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

const server = new Server(
  { name: "memoria-mcp", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

const TOOLS = [
  {
    name: "store_memory",
    description:
      "Store a fact about a user. Duplicates are recognised: an identical fact refreshes the existing one, and a near-identical one supersedes it (history is kept). Returns the memory id and its mref.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "The ID of the user (e.g. 'user_123')" },
        text: { type: "string", description: "The memory or fact to store" },
      },
      required: ["userId", "text"],
    },
  },
  {
    name: "retrieve_context",
    description:
      "Search a user's memories (hybrid keyword + vector) and return the matching text with its mref and score. Use the mref values with resolve_memory when you want the full text of a specific memory.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string" },
        query: { type: "string", description: "What you are trying to remember, in words" },
        topK: { type: "number", description: "Number of results (default 5, max 100)" },
        mode: { type: "string", enum: ["hybrid", "vector", "keyword"], description: "Default hybrid" },
      },
      required: ["userId", "query"],
    },
  },
  {
    name: "resolve_memory",
    description: "Fetch the full text behind one or more mref pointers.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string" },
        mrefs: { type: "array", items: { type: "string" }, description: "One or more mref values" },
      },
      required: ["userId", "mrefs"],
    },
  },
  {
    name: "memory_graph",
    description: "Return a neighbourhood of a user's memory graph (nodes and edges) around a memory id.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string" },
        center: { type: "string", description: "Memory id to centre on; omit for the most recent memories" },
        depth: { type: "number", description: "1-3 hops, default 1" },
        limit: { type: "number", description: "Max nodes, default 200" },
      },
      required: ["userId"],
    },
  },
  {
    name: "audit_contradictions",
    description:
      "Sweep a user's stored memories for contradictions and duplicates. Report only unless apply is true. Each pair costs one model call, so maxCalls is part of the request.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string" },
        apply: { type: "boolean", description: "Supersede what it finds (default false)" },
        maxCalls: { type: "number", description: "Model calls to spend, default 25" },
        limit: { type: "number", description: "Memories to scan, default 200" },
      },
      required: ["userId"],
    },
  },
  {
    name: "forget_memory",
    description: "Delete a specific memory by id.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string" },
        memoryId: { type: "string" },
      },
      required: ["userId", "memoryId"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `HTTP ${res.status}`);
  return data as any;
}

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = (request.params.arguments || {}) as any;
  try {
    if (name === "store_memory") {
      const data = await call(`/api/memory/${encodeURIComponent(args.userId)}`, {
        method: "POST",
        body: JSON.stringify({ text: args.text }),
      });
      return text(
        `Stored. id=${data.id} mref=${data.mref}` +
          (data.deduped ? " (already current — timestamp refreshed)" : "") +
          (data.superseded ? ` (superseded ${data.superseded})` : "")
      );
    }

    if (name === "retrieve_context") {
      const q = new URLSearchParams({ query: String(args.query), topK: String(args.topK || 5) });
      if (args.mode) q.set("mode", String(args.mode));
      const data = await call(`/api/memory/${encodeURIComponent(args.userId)}/context?${q}`);
      const body: any = { results: data.results, notes: data.notes };
      return text(body);
    }

    if (name === "resolve_memory") {
      const data = await call(`/api/memory/${encodeURIComponent(args.userId)}/resolve`, {
        method: "POST",
        body: JSON.stringify({ mrefs: args.mrefs }),
      });
      return text(data);
    }

    if (name === "memory_graph") {
      const q = new URLSearchParams();
      if (args.center) q.set("center", String(args.center));
      if (args.depth) q.set("depth", String(args.depth));
      if (args.limit) q.set("limit", String(args.limit));
      const data = await call(`/api/memory/${encodeURIComponent(args.userId)}/graph?${q}`);
      return text(data);
    }

    if (name === "audit_contradictions") {
      const data = await call(`/api/memory/${encodeURIComponent(args.userId)}/audit`, {
        method: "POST",
        body: JSON.stringify({ apply: args.apply === true, maxCalls: args.maxCalls, limit: args.limit }),
      });
      return text(data);
    }

    if (name === "forget_memory") {
      await call(`/api/memory/${encodeURIComponent(args.userId)}/${encodeURIComponent(args.memoryId)}`, {
        method: "DELETE",
      });
      return text("Memory deleted successfully.");
    }

    throw new Error(`Tool not found: ${name}`);
  } catch (e: any) {
    return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Memoria MCP Server on stdio → ${API_URL}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
