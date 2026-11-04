# Memoria — TODO

## Done in v2 (was the TODO's whole premise)
- [x] One store instead of three: SQLite + WAL replaces the JSON file and the ClickHouse path.
- [x] Exact vectors by default; int8 is opt-in and measured, not guessed.
- [x] Hybrid retrieval (FTS5 BM25 + vectors, reciprocal rank fusion).
- [x] Dedupe and supersede on write, with history kept.
- [x] `mref` resolution (single and batch) — the pointer protocol is now real.
- [x] Graph endpoint that returns a capped neighbourhood.
- [x] Provider-agnostic embeddings (OpenAI-compatible, TEI, Gemini, offline hash).
- [x] Keys bound to a scope; open-by-default is now dev-only and explicit.
- [x] Migration from `data/memories.json` (`npm run migrate`) and `npm run reembed`.
- [x] Tests: store contract, vector codec, auth, and HTTP end-to-end.

## Next, in order of value
- [ ] **Contradiction handling.** Supersede is similarity-based today. A cheap LLM
      pass ("does this new fact contradict one of these three?") is the next
      quality step, and it should run through the gateway that already routes.
- [ ] **Entity edges.** `similar` and `supersedes` are the only edge kinds.
      Extracted entities (`person:…`, `repo:…`) would make the graph an index
      rather than a similarity map.
- [ ] **A `POST /v1/embeddings` route in Doujev's gateway**, so memory writes are
      routed, ledgered and costed like every other model call.
- [ ] **Packaging the MCP server as a single file** (`tsx mcp-server.ts` needs Node
      and the repo today; a compiled `memoria-mcp` would install anywhere).
- [ ] **PDF/file ingest into memories.** `parse-file` extracts text but does not
      write memories; chunk the text, dedupe, and store.
- [ ] **Backup command.** `sqlite3 .backup` on a schedule, into the volume.
- [ ] **Second-process cache coherence test** under real concurrency (the
      `write_seq` guard is unit-tested; a two-server soak test is not).
