### 📋 Memoria Protocol — 371 Minds Catalog Entry

| Element | Value |
| :--- | :--- |
| **Catalog ID** | `371-REPO-CORE-001` |
| **One-sentence summary** | A memory engine for agents: one SQLite file, exact vectors, hybrid retrieval, and a write path that dedupes and supersedes instead of appending. |
| **Autonomy level** | `AI_Assisted` |
| **Autonomy target** | `95%` |

#### 🏗️ Technical detail

| Requirement | Value |
| :--- | :--- |
| **Strategic tier** | `Tier 1 (Core)` |
| **Priority score** | `10` |
| **Tech stack** | `TypeScript` · `Next.js` · `SQLite (WAL, FTS5)` · `better-sqlite3` · `MCP` |
| **Storage** | One file: `data/memoria.db` (memories + FTS index + edges + meta) |
| **Embeddings** | Provider-agnostic: any OpenAI-compatible endpoint, TEI, Gemini, or offline lexical hashing |
| **Retrieval** | FTS5 BM25 + cosine over exact vectors, fused by reciprocal rank |
| **Deployment** | Local, single VPS, Docker (`memoria_data` volume), Akash |

#### 💰 Economics

| Metric | Value |
| :--- | :--- |
| **Infrastructure cost** | $0 marginal: SQLite, no vector service, no graph database |
| **Model cost** | One embedding call per new fact (dedupes do not re-embed) |
| **Measured throughput (this VM, 2 cores)** | ~740 writes/s at 1,000 memories; 2.5 ms hybrid search — see README |

#### Status

| Step | Result | Status |
| :--- | :--- | :--- |
| Storage rewrite (SQLite + FTS5 + vectors) | One file, transactional writes | `Completed` |
| Dedupe / supersede write path | History kept, duplicates collapsed | `Completed` |
| Provider-agnostic embeddings | OpenAI-compatible, TEI, Gemini, hash | `Completed` |
| Pointer (`mref`) resolution | Single + batch endpoints, MCP tool | `Completed` |
| Graph endpoint + page | Capped neighbourhood, no new dependency | `Completed` |
| Contradiction detection (LLM pass) | — | `Pending` |
| Entity edges / extraction | — | `Pending` |
| Tokenisation for the DAO | — | `Pending` |

#### Claims corrected in v2

Earlier versions of this entry and of `metadata.json` said "4-bit compression"
(it was 8-bit), "Arweave encapsulation" (removed), and "ClickHouse" (removed).
The engine is 32-bit floats by default and int8 optionally; the permanence story
is a content hash you can recompute, not a chain transaction.
