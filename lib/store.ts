/**
 * The memory store: one SQLite file, exact vectors, hybrid retrieval, and a
 * write path that decides what a write *means*.
 *
 * Why the write path is the important half
 * ----------------------------------------
 * The previous store appended. Appending is why retrieval looked broken: five
 * paraphrases of one fact each scored well, contradictions both survived, and
 * nothing could be corrected without a delete. A memory system's quality is set
 * at write time, not at query time.
 *
 * So `addMemory` does three things before it inserts:
 *   1. exact duplicate  (same normalised text, still current) -> touch, no new row
 *   2. near duplicate   (cosine >= MEMORIA_DEDUPE_THRESHOLD, default 0.95)
 *                       -> insert the new version, mark the old one invalid
 *                          (`validTo`, `supersededBy`) and record the edge.
 *                          History is kept; default reads see only what's true.
 *   3. otherwise insert, and link its nearest neighbours as graph edges.
 *
 * Retrieval is hybrid: FTS5 (BM25) and vectors, fused by reciprocal rank. Either
 * half can be absent — with no embedder configured the store still works as
 * keyword search rather than returning nothing.
 */
import crypto from 'crypto';
import { getDb, meta, prep, setMeta } from './db';
import { embed, embedOne, embedderInfo, EmbedderInfo } from './embedder';
import { Codec, decode, encode, normalize } from './vector';

export type Memory = {
  id: string;
  mref: string;
  userId: string;
  text: string;
  mediaUrl?: string;
  mediaType?: string;
  actionPayload?: any;
  createdAt: number;
  updatedAt: number;
  validFrom: number;
  validTo?: number | null;
  supersededBy?: string | null;
  version: number;
  source: string;
  score?: number;
  similarity?: number | null;
  match?: 'vector' | 'keyword' | 'both';
};

export type AddInput = {
  userId: string;
  text?: string;
  mediaUrl?: string;
  mediaType?: string;
  actionPayload?: any;
  createdAt?: number;
  source?: string;
};

export type AddResult = {
  id: string;
  mref: string;
  deduped: boolean;
  superseded?: string;
  embedded: boolean;
  embedModel?: string;
};

const MAX_TEXT = 64 * 1024;
const CODEc = (): Codec => (process.env.MEMORIA_VECTOR_CODEC === 'int8' ? 'int8' : 'f32');
const DEDUPE_THRESHOLD = () => {
  const v = process.env.MEMORIA_DEDUPE_THRESHOLD;
  if (v === undefined) return 0.95;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.95;
};
const WRITE_WINDOW = () => {
  const n = Number(process.env.MEMORIA_WRITE_WINDOW || 2000);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2000;
};
const GRAPH_SIMILARITY = () => {
  const n = Number(process.env.MEMORIA_GRAPH_SIMILARITY || 0.72);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.72;
};

function normalizeText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function hashText(userId: string, text: string) {
  return crypto.createHash('sha256').update(userId).update('\u0000').update(normalizeText(text)).digest('hex');
}

function newMref() {
  // mref_ + 8 base32-ish characters; collision-checked on insert.
  return 'mref_' + crypto.randomBytes(5).toString('hex');
}

function rowToMemory(r: any): Memory {
  return {
    id: r.id,
    mref: r.mref,
    userId: r.userId,
    text: r.text,
    mediaUrl: r.mediaUrl || undefined,
    mediaType: r.mediaType || undefined,
    actionPayload: r.actionPayload ? safeJson(r.actionPayload) : undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    validFrom: r.validFrom,
    validTo: r.validTo ?? null,
    supersededBy: r.supersededBy ?? null,
    version: r.version,
    source: r.source,
  };
}

function safeJson(s: string) {
  try { return JSON.parse(s); } catch { return s; }
}

const SELECT = `SELECT id, mref, userId, text, mediaUrl, mediaType, actionPayload,
                       createdAt, updatedAt, validFrom, validTo, supersededBy, version, source`;

function bestAtPush(ids: string[], sims: Float64Array, id: string, sim: number) {
  ids.push(id);
  sims[ids.length - 1] = sim;
}

function argmin(sims: Float64Array, n: number) {
  let at = 0;
  for (let i = 1; i < n; i++) if (sims[i] < sims[at]) at = i;
  return at;
}

/**
 * In-process vector index, one per user.
 *
 * Two measurements drive this shape. Decoding embeddings from SQLite on every
 * write made the write path O(n) in allocations and O(n^2) across an import. And
 * a scan over an array of Float32Array objects cost ~8 ms per 1,000 x 384 on this
 * VM, where the same vectors in one flat Float32Array cost ~1.1 ms — the
 * per-array iteration is what the interpreter cannot keep fast. So: one
 * contiguous matrix per user, unit-normalised on the way in, dot product for
 * similarity, and capacity that doubles.
 *
 * Correctness with two processes: every write bumps `meta.write_seq`, and the
 * index is reloaded when the sequence it was built from is no longer current. A
 * script or a second server is therefore noticed on the next read rather than
 * silently ignored. `window` bounds how many recent memories a *write* compares
 * against — exact duplicates are caught by hash regardless of age, and the bound
 * is what keeps an import linear.
 */
type Index = {
  seq: string;
  model: string;
  dim: number;
  path: string;
  ids: string[];
  createdAt: number[];
  mat: Float32Array;
  count: number;
};

const indexCache = new Map<string, Index>();
const dbPathKey = () => process.env.MEMORIA_DB_PATH || '';

function writeSeq(): string {
  return meta('write_seq') || '0';
}

function bumpSeq() {
  setMeta('write_seq', String(Number(writeSeq()) + 1));
}

function emptyIndex(model: string, dim: number): Index {
  return {
    seq: writeSeq(),
    model,
    dim,
    path: dbPathKey(),
    ids: [],
    createdAt: [],
    mat: new Float32Array(Math.max(64, dim * 64)),
    count: 0,
  };
}

function indexAppend(idx: Index, id: string, vec: Float32Array, createdAt: number) {
  const need = (idx.count + 1) * idx.dim;
  if (need > idx.mat.length) {
    const grown = new Float32Array(Math.max(need, idx.mat.length * 2));
    grown.set(idx.mat);
    idx.mat = grown;
  }
  idx.mat.set(vec, idx.count * idx.dim);
  idx.ids.push(id);
  idx.createdAt.push(createdAt);
  idx.count += 1;
  idx.seq = writeSeq();
}

/** Swap-remove: order does not matter, and it keeps the matrix dense. */
function indexRemove(idx: Index, id: string) {
  const at = idx.ids.indexOf(id);
  if (at === -1) return;
  const last = idx.count - 1;
  if (at !== last) {
    idx.mat.copyWithin(at * idx.dim, last * idx.dim, (last + 1) * idx.dim);
    idx.ids[at] = idx.ids[last];
    idx.createdAt[at] = idx.createdAt[last];
  }
  idx.ids.length = last;
  idx.createdAt.length = last;
  idx.count = last;
  idx.seq = writeSeq();
}

function vectorIndex(userId: string, info: EmbedderInfo): Index {
  const seq = writeSeq();
  const cached = indexCache.get(userId);
  if (cached && cached.seq === seq && cached.model === info.id && cached.dim === info.dim && cached.path === dbPathKey()) {
    return cached;
  }

  const rows = prep(
    `SELECT id, embedding, codec, createdAt FROM memories
      WHERE userId = ? AND validTo IS NULL AND embedding IS NOT NULL AND embedModel = ? AND embedDim = ?
      ORDER BY createdAt`
  ).all(userId, info.id, info.dim) as { id: string; embedding: Buffer; codec: string; createdAt: number }[];

  const idx = emptyIndex(info.id, info.dim);
  idx.ids = [];
  idx.createdAt = [];
  idx.mat = new Float32Array(Math.max(64, info.dim * Math.max(64, rows.length)));
  idx.count = 0;
  for (const r of rows) {
    let vec: Float32Array;
    try {
      vec = normalize(decode(r.embedding, r.codec));
    } catch {
      continue; // wrong-length row: corruption, not a candidate
    }
    idx.mat.set(vec, idx.count * info.dim);
    idx.ids.push(r.id);
    idx.createdAt.push(r.createdAt);
    idx.count += 1;
  }
  indexCache.set(userId, idx);
  if (process.env.MEMORIA_DEBUG_INDEX === '1') console.log('[index] loaded', userId, idx.count, 'vectors');
  return idx;
}

function invalidateIndex(userId: string) {
  indexCache.delete(userId);
}

/** Dot product over the flat matrix. Vectors are unit length, so this is cosine. */
function topMatches(
  idx: Index,
  query: Float32Array,
  limit: number,
  opts: { excludeId?: string; window?: number } = {}
): { id: string; similarity: number }[] {
  const dim = idx.dim;
  const q = normalize(query);
  const from = opts.window && opts.window > 0 && idx.count > opts.window ? idx.count - opts.window : 0;
  const mat = idx.mat;
  // Top-k without sorting on every improvement: keep k slots plus the index of
  // the current worst slot. Re-sorting a growing array inside the scan is what
  // made a 10,000-row search take 68 ms instead of 15.
  const bestIds: string[] = [];
  const bestSims = new Float64Array(limit);
  let worstAt = -1; // -1 until the slots are full
  for (let r = from; r < idx.count; r++) {
    const id = idx.ids[r];
    if (opts.excludeId && id === opts.excludeId) continue;
    const off = r * dim;
    let dot = 0;
    for (let i = 0; i < dim; i++) dot += mat[off + i] * q[i];

    if (bestIds.length < limit) {
      bestAtPush(bestIds, bestSims, id, dot);
      if (bestIds.length === limit) worstAt = argmin(bestSims, limit);
      continue;
    }
    if (dot <= bestSims[worstAt]) continue;
    bestIds[worstAt] = id;
    bestSims[worstAt] = dot;
    worstAt = argmin(bestSims, limit);
  }

  const out = bestIds.map((id, i) => ({ id, similarity: bestSims[i] }));
  return out.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

function nearest(
  userId: string,
  vec: Float32Array,
  info: EmbedderInfo,
  opts: { excludeId?: string; limit?: number; window?: number } = {}
): { id: string; similarity: number }[] {
  return topMatches(vectorIndex(userId, info), vec, opts.limit ?? 1, opts);
}

/** History search needs superseded rows too, so it reads them from SQL. */
function nearestIncludingHistory(userId: string, vec: Float32Array, info: EmbedderInfo, limit: number) {
  const rows = prep(
    `SELECT id, embedding, codec FROM memories
      WHERE userId = ? AND embedding IS NOT NULL AND embedModel = ? AND embedDim = ?`
  ).all(userId, info.id, info.dim) as { id: string; embedding: Buffer; codec: string }[];
  const q = normalize(vec);
  const scored: { id: string; similarity: number }[] = [];
  for (const r of rows) {
    try {
      const v = normalize(decode(r.embedding, r.codec));
      let dot = 0;
      for (let i = 0; i < v.length; i++) dot += v[i] * q[i];
      scored.push({ id: r.id, similarity: dot });
    } catch {
      /* wrong length: skip */
    }
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}

/**
 * FTS5 MATCH is a query language, not a bag of words: a stray quote or a hyphen
 * in user text is a syntax error, and an error here would 500 a search. So each
 * token is quoted and the tokens are OR-ed, widening rather than failing.
 */
function ftsQuery(text: string): string | null {
  const tokens = normalizeText(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length > 1)
    .slice(0, 12);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
}

function keywordSearch(userId: string, text: string, limit: number, includeHistory: boolean) {
  const q = ftsQuery(text);
  if (!q) return [] as { id: string; rank: number }[];
  const db = getDb();
  try {
    const rows = prep(
        `SELECT m.id AS id, bm25(memories_fts) AS score
           FROM memories_fts
           JOIN memories m ON m.rowid = memories_fts.rowid
          WHERE memories_fts MATCH ? AND m.userId = ?
            ${includeHistory ? '' : 'AND m.validTo IS NULL'}
          ORDER BY score
          LIMIT ?`
      )
      .all(q, userId, limit) as { id: string; score: number }[];
    return rows.map((r, i) => ({ id: r.id, rank: i + 1 }));
  } catch {
    return [];
  }
}

function upsertEdge(userId: string, a: string, b: string, kind: string, weight: number) {
  if (a === b) return;
  const [from, to] = a < b ? [a, b] : [b, a];
  prep(
      `INSERT INTO edges(userId, fromId, toId, kind, weight, createdAt)
       VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(userId, fromId, toId, kind) DO UPDATE SET weight = excluded.weight`
    )
    .run(userId, from, to, kind, weight, Date.now());
}

export const store = {
  /** Write path. See the file header for what "dedupe" means here. */
  async addMemory(input: AddInput): Promise<AddResult> {
    const db = getDb();
    const userId = String(input.userId || '').trim();
    if (!userId) throw new Error('userId is required');
    const text = normalizeText(input.text || '');
    const actionJson = input.actionPayload === undefined ? '' : JSON.stringify(input.actionPayload);
    if (!text && !actionJson) throw new Error('text or actionPayload is required');
    if (text.length > MAX_TEXT) throw new Error(`text is longer than ${MAX_TEXT} characters`);

    const now = Date.now();
    const createdAt = Number(input.createdAt) || now;
    const textForEmbedding = text || actionJson;
    const textHash = hashText(userId, textForEmbedding);

    // 1. Exact duplicate, still current: touch it rather than storing it twice.
    if (text) {
      const existing = prep(`SELECT id, mref, version FROM memories WHERE userId = ? AND textHash = ? AND validTo IS NULL LIMIT 1`)
        .get(userId, textHash) as { id: string; mref: string; version: number } | undefined;
      if (existing) {
        prep(`UPDATE memories SET updatedAt = ? WHERE id = ?`).run(now, existing.id);
        return { id: existing.id, mref: existing.mref, deduped: true, embedded: false };
      }
    }

    // Embed. When no embedder is configured the row is still written and stays
    // findable by keyword: a memory system that refuses writes because a model
    // is down is worse than one that degrades.
    let vector: Float32Array | null = null;
    let info: EmbedderInfo | null = null;
    try {
      const r = await embedOne(textForEmbedding, 'document');
      vector = r.vector;
      info = r.info;
    } catch (e) {
      if (process.env.MEMORIA_REQUIRE_EMBEDDINGS === '1') throw e;
      console.warn('[store] embedding failed, storing text only:', (e as Error).message);
    }

    // 2. Near duplicate: supersede rather than accumulate.
    let superseded: string | undefined;
    let version = 1;
    if (vector && info) {
      const [best] = nearest(userId, vector, info, { limit: 1, window: WRITE_WINDOW() });
      if (best && best.similarity >= DEDUPE_THRESHOLD()) {
        const prev = prep(`SELECT id, version FROM memories WHERE userId = ? AND id = ?`)
          .get(userId, best.id) as { id: string; version: number } | undefined;
        if (prev) {
          superseded = prev.id;
          version = prev.version + 1;
        }
      }
    }

    const id = crypto.randomUUID();
    const mref = newMref();
    const codec = CODEc();

    const insertMemory = prep(
      `INSERT INTO memories(id, userId, mref, text, mediaUrl, mediaType, actionPayload,
                            embedding, embedModel, embedDim, codec, textHash,
                            createdAt, updatedAt, validFrom, validTo, supersededBy, version, source)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
    );

    try {
      const tx = db.transaction(() => {
        insertMemory.run(
          id,
          userId,
          mref,
          text,
          input.mediaUrl || '',
          input.mediaType || '',
          actionJson,
          vector ? encode(normalize(vector), codec) : null,
          info?.id || '',
          vector ? vector.length : 0,
          codec,
          textHash,
          createdAt,
          now,
          now,
          version,
          input.source || 'api'
        );

        if (superseded) {
          prep(`UPDATE memories SET validTo = ?, supersededBy = ? WHERE userId = ? AND id = ?`).run(
            now,
            id,
            userId,
            superseded
          );
          upsertEdge(userId, id, superseded, 'supersedes', 1);
        }

        // Graph edges: nearest neighbours of the new memory. One pass over the
        // current vectors of this user, so the graph needs no background job.
        if (vector && info) {
          for (const n of nearest(userId, vector, info, { excludeId: id, limit: 4, window: WRITE_WINDOW() })) {
            if (n.similarity >= GRAPH_SIMILARITY()) upsertEdge(userId, id, n.id, 'similar', n.similarity);
          }
        }

        // Bumped last: every nearest() above must see the cache it already has,
        // not a cache invalidated by this same write.
        bumpSeq();
      });
      tx();
    } catch (e: any) {
      // Two writers storing the same text at the same instant: the partial unique
      // index rejects the second insert. That rejection is the answer — the fact
      // is already current — so it is reported as a dedupe, not an error.
      if (String(e?.code || '').startsWith('SQLITE_CONSTRAINT')) {
        const row = prep(`SELECT id, mref FROM memories WHERE userId = ? AND textHash = ? AND validTo IS NULL`)
          .get(userId, textHash) as { id: string; mref: string } | undefined;
        if (row) return { id: row.id, mref: row.mref, deduped: true, embedded: false };
      }
      throw e;
    }

    if (info) setMeta('embedder:last', info.id);

    // Fold this write into the in-process index. Dropping the cache here instead
    // would make a bulk import rebuild it from SQLite on every row.
    if (vector && info) {
      const cached = indexCache.get(userId);
      if (cached && cached.model === info.id && cached.dim === info.dim && cached.path === dbPathKey()) {
        if (superseded) indexRemove(cached, superseded);
        indexAppend(cached, id, normalize(vector), createdAt);
      }
    }

    return { id, mref, deduped: false, superseded, embedded: !!vector, embedModel: info?.id };
  },

  /** Batch write in one transaction, one embedding call. Used by /import. */
  async importMany(userId: string, items: { text: string; createdAt?: number }[]) {
    const results: AddResult[] = [];
    for (const item of items) {
      results.push(await this.addMemory({ userId, text: item.text, createdAt: item.createdAt, source: 'import' }));
    }
    return results;
  },

  async getMemories(
    userId: string,
    opts: { limit?: number; offset?: number; includeHistory?: boolean } = {}
  ): Promise<Memory[]> {
    const limit = Math.max(1, Math.min(1000, opts.limit ?? 200));
    const offset = Math.max(0, opts.offset ?? 0);
    const rows = prep(
        `${SELECT} FROM memories WHERE userId = ? ${opts.includeHistory ? '' : 'AND validTo IS NULL'}
          ORDER BY createdAt DESC LIMIT ? OFFSET ?`
      )
      .all(userId, limit, offset) as any[];
    return rows.map(rowToMemory);
  },

  async getMemory(userId: string, id: string): Promise<Memory | null> {
    const row = prep(`${SELECT} FROM memories WHERE userId = ? AND id = ?`).get(userId, id) as any;
    return row ? rowToMemory(row) : null;
  },

  /** Resolve a symbolic pointer. This is the out-of-band half of `mref`. */
  async getByMref(userId: string, mref: string): Promise<Memory | null> {
    const row = prep(`${SELECT} FROM memories WHERE userId = ? AND mref = ?`).get(userId, mref) as any;
    return row ? rowToMemory(row) : null;
  },

  async resolveMrefs(userId: string, mrefs: string[]) {
    const out: Record<string, Memory | null> = {};
    for (const m of mrefs.slice(0, 100)) out[m] = await this.getByMref(userId, m);
    return out;
  },

  /**
   * Hybrid search. Vectors and keywords each produce a ranking; the two are
   * fused by reciprocal rank so neither scale has to be calibrated against the
   * other. `similarity` is reported raw so a caller can threshold it.
   */
  async search(
    userId: string,
    opts: {
      query: string;
      topK?: number;
      includeHistory?: boolean;
      mode?: 'hybrid' | 'vector' | 'keyword';
      recencyWeight?: number;
    }
  ): Promise<{ results: Memory[]; notes: string[] }> {
    const query = normalizeText(opts.query || '');
    const topK = Math.max(1, Math.min(100, opts.topK ?? 5));
    const mode = opts.mode || 'hybrid';
    const notes: string[] = [];
    if (!query) return { results: [], notes: ['empty query'] };

    let vector: Float32Array | null = null;
    let info: EmbedderInfo | null = null;
    if (mode !== 'keyword') {
      try {
        const r = await embedOne(query, 'query');
        vector = r.vector;
        info = r.info;
      } catch (e) {
        notes.push(`vector search unavailable: ${(e as Error).message}`);
      }
    }
    if (!vector && mode === 'vector') return { results: [], notes };

    const pool = Math.max(topK * 4, 20);
    const kw = mode === 'vector' ? [] : keywordSearch(userId, query, pool, !!opts.includeHistory);
    const vec =
      vector && info
        ? opts.includeHistory
          ? nearestIncludingHistory(userId, vector, info, pool)
          : nearest(userId, vector, info, { limit: pool })
        : [];

    if (kw.length === 0 && vec.length === 0) {
      // Nothing matched at all: say why rather than return an empty list. A
      // vector scan that ran and found nothing is still nothing.
      const total = (prep(`SELECT COUNT(*) c FROM memories WHERE userId = ?`).get(userId) as { c: number }).c;
      if (total === 0) notes.push('no memories stored for this user yet');
      else notes.push('no memory matched the query; try fewer or different words');
    }
    if (vector && info) {
      const drifted = prep(
          `SELECT COUNT(*) c FROM memories WHERE userId = ? AND validTo IS NULL
             AND embedding IS NOT NULL AND (embedModel != ? OR embedDim != ?)`
        )
        .get(userId, info.id, info.dim) as { c: number };
      if (drifted.c > 0) {
        notes.push(
          `${drifted.c} memories were embedded with a different model (${meta('embedder:last') || 'unknown'}); they are keyword-only until re-embedded — see scripts/reembed.ts`
        );
      }
    }

    // Reciprocal rank fusion, k = 60.
    const K = 60;
    const fused = new Map<string, { score: number; similarity: number | null; kw: boolean; vec: boolean }>();
    const add = (id: string, rank: number, kind: 'kw' | 'vec', similarity: number | null) => {
      const cur = fused.get(id) || { score: 0, similarity: null, kw: false, vec: false };
      cur.score += 1 / (K + rank);
      if (kind === 'kw') cur.kw = true;
      if (kind === 'vec') cur.vec = true;
      if (similarity !== null) cur.similarity = similarity;
      fused.set(id, cur);
    };
    kw.forEach((r, i) => add(r.id, i + 1, 'kw', null));
    vec.forEach((r, i) => add(r.id, i + 1, 'vec', r.similarity));

    const ids = [...fused.keys()];
    if (ids.length === 0) return { results: [], notes };

    const rows = prep(`${SELECT} FROM memories WHERE userId = ? AND id IN (${ids.map(() => '?').join(',')})`)
      .all(userId, ...ids) as any[];
    const byId = new Map(rows.map((r) => [r.id, r]));

    const recency = Math.max(0, Math.min(1, opts.recencyWeight ?? 0));
    let scored = ids
      .map((id) => {
        const f = fused.get(id)!;
        const row = byId.get(id);
        if (!row) return null;
        let score = f.score;
        if (recency > 0) {
          const ageDays = Math.max(0, (Date.now() - row.createdAt) / 86_400_000);
          score *= 1 + recency * Math.exp(-ageDays / 30);
        }
        return { ...rowToMemory(row), score, similarity: f.similarity, match: (f.kw && f.vec ? 'both' : f.vec ? 'vector' : 'keyword') as Memory['match'] };
      })
      .filter(Boolean) as Memory[];

    const max = Math.max(...scored.map((s) => s.score ?? 0), 1e-9);
    scored = scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.createdAt - a.createdAt);
    scored.forEach((s) => (s.score = Number(((s.score ?? 0) / max).toFixed(4))));
    return { results: scored.slice(0, topK), notes };
  },

  async updateMemory(userId: string, id: string, patch: { text?: string; actionPayload?: any }) {
    invalidateIndex(userId);
    const db = getDb();
    const row = prep(`SELECT id, text, version FROM memories WHERE userId = ? AND id = ?`).get(userId, id) as
      | { id: string; text: string; version: number }
      | undefined;
    if (!row) return false;

    const text = patch.text !== undefined ? normalizeText(patch.text) : row.text;
    const embedding = patch.text !== undefined ? await embedOne(text, 'document').catch(() => ({ vector: null, info: null })) : { vector: null, info: null };
    const codec = CODEc();

    prep(
      `UPDATE memories SET text = ?, actionPayload = COALESCE(?, actionPayload), textHash = ?,
              updatedAt = ?, embedding = COALESCE(?, embedding),
              embedModel = COALESCE(?, embedModel), embedDim = COALESCE(?, embedDim), codec = ?
        WHERE userId = ? AND id = ?`
    ).run(
      text,
      patch.actionPayload === undefined ? null : JSON.stringify(patch.actionPayload),
      hashText(userId, text),
      Date.now(),
      embedding.vector ? encode(embedding.vector, codec) : null,
      embedding.info?.id ?? null,
      embedding.vector?.length ?? null,
      codec,
      userId,
      id
    );
    return true;
  },

  async deleteMemory(userId: string, id: string) {
    const db = getDb();
    invalidateIndex(userId);
    const tx = db.transaction(() => {
      const info = prep(`DELETE FROM memories WHERE userId = ? AND id = ?`).run(userId, id);
      prep(`DELETE FROM edges WHERE userId = ? AND (fromId = ? OR toId = ?)`).run(userId, id, id);
      bumpSeq();
      return info.changes;
    });
    return tx() > 0;
  },

  /**
   * Content-addressed snapshot of the *current* memories.
   *
   * The hash covers ids, text and validity — not embeddings — so switching
   * codecs or re-embedding with a new model does not rewrite history. This is a
   * hash you can recompute and compare, not a blockchain transaction; the
   * response keeps its old field names for API compatibility and says so.
   */
  async encapsulate(userId: string) {
    const rows = prep(
        `SELECT id, mref, textHash, text, createdAt, validFrom FROM memories
          WHERE userId = ? AND validTo IS NULL ORDER BY id`
      )
      .all(userId) as any[];
    if (rows.length === 0) throw new Error('No memories found for this user.');

    const payload = JSON.stringify({
      agent_version: '2.0',
      embedder: meta('embedder:last') || null,
      memories: rows.map((r) => ({
        id: r.id,
        mref: r.mref,
        hash: r.textHash,
        text: r.text,
        createdAt: r.createdAt,
        validFrom: r.validFrom,
      })),
    });
    const hash = crypto.createHash('sha256').update(payload).digest('hex');
    const timestamp = Date.now();
    setMeta(`capsule:${userId}`, JSON.stringify({ hash, timestamp, count: rows.length }));

    const html = `<!doctype html><meta charset="utf-8"><title>Memoria capsule</title>
<h2>Memoria capsule</h2>
<p><strong>User:</strong> ${escapeHtml(userId)}</p>
<p><strong>State hash:</strong> ${hash}</p>
<p><strong>Memories:</strong> ${rows.length}</p>
<p><strong>Timestamp:</strong> ${new Date(timestamp).toISOString()}</p>
<p><em>A content-addressed snapshot of this user's current memories. Recompute the hash to verify it; it is not a chain transaction.</em></p>`;

    return {
      txId: hash,
      hash,
      arweaveUrl: `git://local/${userId}/commit/${hash}`,
      bootloader: `data:text/html;base64,${Buffer.from(html).toString('base64')}`,
      count: rows.length,
      note: 'content hash of current memories, not a chain transaction',
    };
  },

  /**
   * A neighbourhood, never the whole graph: the renderer gets at most `limit`
   * nodes around a centre. Sending every node to a force layout is what makes a
   * graph view lock up.
   */
  async graph(userId: string, opts: { center?: string; depth?: number; limit?: number } = {}) {
    const db = getDb();
    const limit = Math.max(1, Math.min(2000, opts.limit ?? 200));
    const depth = Math.max(1, Math.min(3, opts.depth ?? 1));

    const nodes = new Map<string, any>();
    const edges: { from: string; to: string; kind: string; weight: number }[] = [];
    const seenPairs = new Set<string>();

    const loadNode = (id: string) => {
      if (nodes.has(id) || nodes.size >= limit) return;
      const r = prep(`SELECT id, mref, text, createdAt, validTo, version FROM memories WHERE userId = ? AND id = ?`)
        .get(userId, id) as any;
      if (!r) return;
      nodes.set(id, {
        id: r.id,
        mref: r.mref,
        label: r.text.length > 90 ? r.text.slice(0, 90) + '…' : r.text,
        createdAt: r.createdAt,
        current: r.validTo === null,
        version: r.version,
      });
    };

    if (!opts.center) {
      const seed = prep(`SELECT id FROM memories WHERE userId = ? AND validTo IS NULL ORDER BY createdAt DESC LIMIT ?`)
        .all(userId, Math.min(limit, 40)) as { id: string }[];
      for (const s of seed) loadNode(s.id);
    } else {
      loadNode(opts.center);
    }

    let frontier = [...nodes.keys()];
    for (let d = 0; d < depth && frontier.length > 0 && nodes.size < limit; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        const rows = prep(
            `SELECT fromId, toId, kind, weight FROM edges
              WHERE userId = ? AND (fromId = ? OR toId = ?) ORDER BY weight DESC`
          )
          .all(userId, id, id) as any[];
        for (const e of rows) {
          const other = e.fromId === id ? e.toId : e.fromId;
          const pair = e.fromId < e.toId ? `${e.fromId}|${e.toId}|${e.kind}` : `${e.toId}|${e.fromId}|${e.kind}`;
          if (!seenPairs.has(pair)) {
            seenPairs.add(pair);
            edges.push({ from: e.fromId, to: e.toId, kind: e.kind, weight: Number(e.weight.toFixed(4)) });
          }
          if (!nodes.has(other) && nodes.size < limit) {
            loadNode(other);
            next.push(other);
          }
        }
        if (nodes.size >= limit) break;
      }
      frontier = next;
    }

    const visible = new Set(nodes.keys());
    return {
      nodes: [...nodes.values()],
      edges: edges.filter((e) => visible.has(e.from) && visible.has(e.to)),
      truncated: nodes.size >= limit,
    };
  },

  stats(userId?: string) {
    const db = getDb();
    const where = userId ? 'WHERE userId = ?' : '';
    const args = userId ? [userId] : [];
    const total = (prep(`SELECT COUNT(*) c FROM memories ${where}`).get(...args) as { c: number }).c;
    const current = (prep(`SELECT COUNT(*) c FROM memories ${where ? where + ' AND' : 'WHERE'} validTo IS NULL`).get(...args) as { c: number }).c;
    const embedded = (prep(`SELECT COUNT(*) c FROM memories ${where ? where + ' AND' : 'WHERE'} embedding IS NOT NULL AND validTo IS NULL`).get(...args) as { c: number }).c;
    const edges = (prep(`SELECT COUNT(*) c FROM edges ${where}`).get(...args) as { c: number }).c;
    return {
      total,
      current,
      superseded: total - current,
      embedded,
      edges,
      embedder: embedderInfo()?.id ?? null,
      lastEmbedder: meta('embedder:last') ?? null,
      codec: CODEc(),
      schemaVersion: meta('schema_version') ?? null,
      dbPath: process.env.MEMORIA_DB_PATH || null,
    };
  },
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
