# Memoria API

Every endpoint is JSON over HTTP. Authentication is `Authorization: Bearer <key>`;
`MEMORIA_API_KEYS="key=userId,key2=*"` binds a key to one user, and a key scoped to
a user is refused (403) for any other `userId`. With no keys configured and
`NODE_ENV=production`, the API answers 503 rather than serving everyone.

Base URL: `http://localhost:3000/api` (or your deployment).

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/health` | Liveness + the embedder and store the instance is actually using |
| `POST` | `/memory/:userId` | Store one memory (dedupes; may supersede) |
| `GET` | `/memory/:userId` | List current memories (`?limit&offset&includeHistory`) |
| `GET` | `/memory/:userId/:memoryId` | Read one memory, including superseded ones |
| `PUT` | `/memory/:userId/:memoryId` | Replace the text (re-embeds) |
| `DELETE` | `/memory/:userId/:memoryId` | Delete a memory and its edges |
| `GET` | `/memory/:userId/context` | Hybrid search (`?query&topK&mode&includeHistory&recencyWeight`) |
| `GET` | `/memory/:userId/mref/:mref` | Resolve one symbolic pointer |
| `POST` | `/memory/:userId/resolve` | Resolve up to 100 pointers |
| `POST` | `/memory/:userId/import` | Batch store (max 100), reports dedupe/supersede counts |
| `GET` | `/memory/:userId/graph` | Neighbourhood (`?center&depth&limit`) |
| `POST` | `/memory/:userId/encapsulate` | Content hash of the current memories |
| `POST` | `/parse-file`, `GET /fetch-url` | Text extraction helpers (do not write memories) |

---

## Store a memory

`POST /api/memory/:userId`

```json
{ "text": "Prefers terse answers with numbers", "actionPayload": { "optional": true } }
```

```json
{
  "success": true,
  "id": "0a9f…",
  "mref": "mref_3f1c2a9d80",
  "deduped": false,
  "embedded": true,
  "embedModel": "openai:text-embedding-3-small",
  "message": "Memory stored successfully"
}
```

- **Identical text, still current** → `deduped: true`, the same `id` comes back,
  and no embedding call is made.
- **Near duplicate** (cosine ≥ `MEMORIA_DEDUPE_THRESHOLD`, default 0.95) → a new
  row is stored and the old one is superseded: it keeps its text, gains a
  `validTo` and a `supersededBy`, and stops appearing in default reads.
  `superseded` names the old id.
- **No embedder reachable** → the row is still written and stays findable by
  keyword (`embedded: false`). Set `MEMORIA_REQUIRE_EMBEDDINGS=1` to make the
  write fail instead.

## Search

`GET /api/memory/:userId/context?query=terse+answers&topK=5`

```json
{
  "context": ["Prefers terse answers with numbers"],
  "results": [
    { "id": "0a9f…", "mref": "mref_3f1c2a9d80", "text": "…", "score": 1,
      "similarity": 0.87, "match": "both", "createdAt": 1762248000000 }
  ],
  "notes": []
}
```

- `context` is the plain-text array older agents expect.
- `score` is the fused rank, normalised to the best hit; `similarity` is the raw
  cosine; `match` says whether the hit came from `vector`, `keyword` or `both`.
- `mode` may be `hybrid` (default), `vector` or `keyword`.
- `notes` explains what a caller would otherwise have to guess: no memories, no
  match, or vectors stored by a different model (which are keyword-only until
  `npm run reembed`).

## Pointers (`mref`)

Search returns a pointer; resolving it is a separate, deliberate call. This is
what keeps prompts small.

```
GET  /api/memory/:userId/mref/mref_3f1c2a9d80      -> { "memory": { … } }
POST /api/memory/:userId/resolve  { "mrefs": ["mref_…", "mref_missing"] }
     -> { "memories": { "mref_…": {…}, "mref_missing": null }, "missing": ["mref_missing"] }
```

## Graph

`GET /api/memory/:userId/graph?center=<memoryId>&depth=1&limit=200`

```json
{
  "nodes": [{ "id": "…", "mref": "…", "label": "first 90 chars", "createdAt": 0, "current": true, "version": 1 }],
  "edges": [{ "from": "…", "to": "…", "kind": "similar", "weight": 0.81 }],
  "truncated": false
}
```

`kind` is `similar` (cosine ≥ `MEMORIA_GRAPH_SIMILARITY`, default 0.72) or
`supersedes`. `truncated` means the node cap was hit — the caller should centre on
a node rather than render a partial picture as if it were complete.

A browser view lives at `/graph`.

## Encapsulate

`POST /api/memory/:userId/encapsulate`

```json
{
  "success": true,
  "txId": "sha256…",
  "hash": "sha256…",
  "arweaveUrl": "git://local/:userId/commit/sha256…",
  "bootloader": "data:text/html;base64,…",
  "count": 12,
  "note": "content hash of current memories, not a chain transaction"
}
```

The hash covers ids, text hashes and validity windows — not embeddings — so
re-embedding with a new model does not rewrite history. `txId`, `arweaveUrl` and
`bootloader` are kept for clients written against the earlier API; `note` says
what they actually are.

## Errors

| Status | Meaning |
| --- | --- |
| `400` | bad input, with a sentence naming the field |
| `401` | missing or invalid key |
| `403` | key is scoped to another `userId` |
| `409` | an update would collide with an existing current memory |
| `429` | rate limit (`X-RateLimit-*` headers) |
| `502` | the embedding endpoint failed; the message names the endpoint |
| `503` | no API key configured on a production instance |

## MCP tools

`npm run mcp` exposes `store_memory`, `retrieve_context`, `resolve_memory`,
`memory_graph` and `forget_memory` over stdio. They call this HTTP API, so the
MCP path and the REST path cannot drift.
