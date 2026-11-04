# Memoria Agent Integration Guide

This document provides instructions for AI agents, autonomous systems, and external services on how to interact with the Memoria API.

## Base URL
All API requests should be made to the base URL where the Memoria service is deployed.

## Authentication
Memoria uses Bearer token authentication. 
Include the following header in all protected requests:
`Authorization: Bearer <YOUR_API_KEY>`

The API supports multi-tenant keys. Ensure your assigned key is included in the `MEMORIA_API_KEYS` environment variable on the server (comma-separated).

## Endpoints

### 1. Health Check
Check if the Memoria service is online and ready to accept requests.
- **Endpoint:** `GET /api/health`
- **Auth Required:** No
- **Response:**
  ```json
  {
    "status": "ok",
    "timestamp": "2026-03-11T22:46:14.000Z",
    "service": "memoria"
  }
  ```

### 2. Store Memory
Save a new fact or memory for a specific user.
- **Endpoint:** `POST /api/memory/[userId]`
- **Auth Required:** Yes
- **Rate Limit:** 50 requests / minute
- **Body:**
  ```json
  {
    "text": "The user prefers dark mode."
  }
  ```

### 3. Retrieve Context
Perform a semantic search to recall facts relevant to a query.
- **Endpoint:** `GET /api/memory/[userId]/context?query=[your_query]&topK=3`
- **Auth Required:** Yes
- **Rate Limit:** 50 requests / minute
- **Query Parameters:**
  - `query` (required): The search string.
  - `topK` (optional): Number of results to return (default: 3).

### 4. List Memories
Retrieve all stored memories for a specific user, ordered by creation date (newest first).
- **Endpoint:** `GET /api/memory/[userId]`
- **Auth Required:** Yes
- **Rate Limit:** 100 requests / minute

### 5. Forget Memory
Delete a specific memory by its ID.
- **Endpoint:** `DELETE /api/memory/[userId]/[memoryId]`
- **Auth Required:** Yes
- **Rate Limit:** 100 requests / minute

### 6. GitMind Freeze (Encapsulate)
Compute the SHA-256 Merkle root of the agent's current memory state. This provides cryptographic provenance without requiring an external blockchain.
- **Endpoint:** `POST /api/memory/[userId]/encapsulate`
- **Auth Required:** Yes
- **Rate Limit:** 10 requests / minute
- **Response:**
  ```json
  {
    "success": true,
    "txId": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "arweaveUrl": "git://local/user_123/commit/...",
    "bootloader": "data:text/html;base64,..."
  }
  ```

## Rate Limiting
The API enforces rate limits per user ID. If limits are exceeded, the API returns a `429 Too Many Requests` status with the following headers:
- `X-RateLimit-Limit`: The maximum number of requests allowed in the current window.
- `X-RateLimit-Remaining`: The number of requests remaining in the current window.
- `X-RateLimit-Reset`: Unix timestamp (in milliseconds) when the rate limit window resets.

## The store (v2)

The rules the storage layer keeps. Each one is here because the code broke it
first, and the failure mode is written down with it.

- **One writer, many readers: SQLite in WAL, `busy_timeout` set.** The old store
  was a JSON file rewritten in full on every write, so two processes each held a
  copy and the last saver won. Never reintroduce a second source of truth beside
  `data/memoria.db`.
- **A write that spans rows is a transaction.** A memory row plus its supersede
  edge and its similarity edges are one write. A half-applied write is a bug even
  when the error is returned.
- **`textHash` + the partial unique index are the duplicate rule.** One current
  row per `(userId, textHash)` is enforced by the database, not by a
  check-then-insert, because two writers can always interleave between the check
  and the insert. A `SQLITE_CONSTRAINT` on that index is a dedupe, not an error.
- **Superseding keeps history.** A near duplicate inserts a new row, gives the old
  one a `validTo` and a `supersededBy`, and records a `supersedes` edge. Default
  reads filter `validTo IS NULL`; `includeHistory=true` sees everything. Never
  delete a fact to correct it.
- **Every row records its embedder.** `embedModel` and `embedDim` travel with the
  vector because a vector is only comparable with a query from the same model.
  A mismatch is reported in `notes`, never blended into one ranking.
- **The vector codec is exact by default.** `f32` (4 bytes per dimension). `int8`
  uses a per-vector scale and is opt-in. Do not reintroduce uniform quantisation
  over a fixed range: it measured 81% recall@5 where exact vectors measured 100%
  at the same bytes per row.
- **The in-process index is a flat matrix, not an array of vectors.** One
  `Float32Array` per user, unit-normalised, swap-removed on delete/supersede, and
  reloaded when `meta.write_seq` moves. A per-vector object array measured ~7×
  slower on this VM, and rebuilding the index on every write made an import
  quadratic.
- **Retrieval is hybrid: FTS5 (BM25) and vectors, fused by reciprocal rank.**
  Neither half may be required. With no embedder configured the store still
  writes and still finds by keyword, and it says so instead of returning [].
- **A search that finds nothing says why.** `notes` carries the reason (no
  memories, no match, vectors from another model). An empty array with no
  sentence is how a retrieval bug survives for weeks.
- **`mref` is resolved out of band.** Search returns the pointer, `GET
  /api/memory/:userId/mref/:mref` (or `POST /resolve`) returns the text. Never
  inline every memory into a prompt when a pointer plus one lookup will do.
- **The graph endpoint returns a neighbourhood, capped and `truncated`-aware.**
  Force layouts are O(n²) per tick on one thread; sending the whole graph to one
  is what makes a graph view freeze.
- **A capsule is a content hash, not a chain transaction.** `encapsulate` hashes
  ids, text and validity (not embeddings, so re-embedding does not rewrite
  history). The old copy said "cryptographically locked"; that was not true.
- **Access is a key bound to a scope.** `MEMORIA_API_KEYS="k=userId,k_admin=*"`.
  No keys + production is a 503 with a sentence, not an open store. A key scoped
  to one user cannot read another.

## Tests

`npm test` is the store and vector contract (no network, no model, offline
hashing embedder). `npm run test:http` boots the built app and drives every route
the way an agent would. A change to the write path that is not covered by both is
a change nobody can review.
