/**
 * Embeddings, from whichever model you actually run.
 *
 * The old code hard-coded one preview model behind a `NEXT_PUBLIC_` variable
 * (so the key could be inlined into a client bundle) and recorded nothing about
 * which model produced a stored vector. When that model changes — a preview
 * retires, you switch to a local model, a client wants their own endpoint — the
 * old vectors are in a different space and every comparison between old and new
 * is silent nonsense.
 *
 * So: the provider is configuration, the model and dimension travel with every
 * row, and a mismatch is reported rather than blended.
 *
 *   MEMORIA_EMBED_PROVIDER   openai | tei | gemini | hash | none
 *   MEMORIA_EMBED_BASE_URL   e.g. https://api.openai.com/v1, http://localhost:11434/v1,
 *                            https://api.ref... whatever speaks the OpenAI shape
 *   MEMORIA_EMBED_API_KEY    bearer token for that endpoint
 *   MEMORIA_EMBED_MODEL      e.g. text-embedding-3-small, bge-m3, nomic-embed-text
 *   MEMORIA_EMBED_DIM        optional: truncate (Matryoshka) to this many dims
 *   MEMORIA_EMBED_HEADERS    optional JSON object of extra headers for a gateway
 *   MEMORIA_EMBED_BATCH      texts per request (default 32)
 *   MEMORIA_EMBED_TIMEOUT_MS default 15000
 *
 * `openai` is the important one: it is the OpenAI `/v1/embeddings` shape, which
 * is also what Ollama, vLLM, LM Studio, LocalAI, OpenRouter-style gateways and
 * Doujev's gateway speak. One adapter, most of the world.
 */
import { normalize, truncate } from './vector';

export type EmbedderInfo = {
  provider: string;
  model: string;
  /** provider:model — what gets written on every row and compared on search */
  id: string;
  dim: number;
};

export type EmbedKind = 'document' | 'query';

export class EmbeddingError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

const CONFIG = () => {
  const provider = (process.env.MEMORIA_EMBED_PROVIDER || '').trim().toLowerCase();
  const baseUrl = (process.env.MEMORIA_EMBED_BASE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = (process.env.MEMORIA_EMBED_API_KEY || '').trim();
  const model = (process.env.MEMORIA_EMBED_MODEL || '').trim();
  const dim = Number(process.env.MEMORIA_EMBED_DIM || 0) || 0;
  const batch = Number(process.env.MEMORIA_EMBED_BATCH || 0) || 32;
  const timeoutMs = Number(process.env.MEMORIA_EMBED_TIMEOUT_MS || 0) || 15000;
  let extra: Record<string, string> = {};
  if (process.env.MEMORIA_EMBED_HEADERS) {
    try {
      extra = JSON.parse(process.env.MEMORIA_EMBED_HEADERS);
    } catch {
      throw new EmbeddingError('MEMORIA_EMBED_HEADERS is not valid JSON');
    }
  }

  // No explicit provider: if an endpoint is configured, speak OpenAI to it;
  // otherwise stay offline with the lexical embedder rather than fail.
  const resolved = provider || (baseUrl ? 'openai' : 'hash');
  return { provider: resolved, baseUrl, apiKey, model, dim, batch, timeoutMs, extra };
};

export function embedderInfo(): EmbedderInfo | null {
  const c = CONFIG();
  if (c.provider === 'none') return null;
  if (c.provider === 'hash') {
    const dim = c.dim || 384;
    return { provider: 'hash', model: 'lexical-hash', id: `hash:lexical-hash`, dim };
  }
  if (c.provider === 'gemini') {
    const model = c.model || 'gemini-embedding-001';
    const dim = c.dim || 3072;
    return { provider: 'gemini', model, id: `gemini:${model}`, dim };
  }
  if (c.provider === 'tei') {
    if (!c.baseUrl) throw new EmbeddingError('MEMORIA_EMBED_PROVIDER=tei needs MEMORIA_EMBED_BASE_URL');
    const model = c.model || 'tei';
    return { provider: 'tei', model, id: `tei:${model}`, dim: c.dim };
  }
  if (!c.baseUrl && !c.apiKey) {
    throw new EmbeddingError(
      'no embedding endpoint configured: set MEMORIA_EMBED_BASE_URL (and usually MEMORIA_EMBED_MODEL, MEMORIA_EMBED_API_KEY), or MEMORIA_EMBED_PROVIDER=hash for lexical-only'
    );
  }
  const model = c.model || 'text-embedding-3-small';
  return {
    provider: 'openai',
    model,
    id: `openai:${model}`,
    dim: c.dim,
  };
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

async function post(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { signal, done } = withTimeout(timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal,
      });
      if (res.status === 429 || res.status >= 500) {
        const text = await res.text().catch(() => '');
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
          continue;
        }
        throw new EmbeddingError(`embedding endpoint returned ${res.status}: ${text.slice(0, 300)}`);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new EmbeddingError(`embedding endpoint returned ${res.status}: ${text.slice(0, 300)}`);
      }
      return await res.json();
    } catch (e: any) {
      if (e instanceof EmbeddingError) throw e;
      if (attempt === 2) {
        throw new EmbeddingError(
          `could not reach the embedding endpoint at ${url}: ${e?.message || e}`,
          e
        );
      }
      await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
    } finally {
      done();
    }
  }
  throw new EmbeddingError('unreachable');
}

/** Lexical embeddings: hashed character trigrams, no network, no model. */
function hashEmbed(text: string, dim: number): Float32Array {
  const v = new Float32Array(dim);
  const s = ` ${text.toLowerCase().replace(/\s+/g, ' ').trim()} `;
  const grams: string[] = [];
  for (const word of s.split(' ')) {
    if (!word) continue;
    grams.push(word);
    for (let i = 0; i + 2 < word.length; i++) grams.push(word.slice(i, i + 3));
  }
  // FNV-1a over each token, signed so collisions cancel rather than pile up.
  for (const g of grams) {
    let h = 0x811c9dc5;
    for (let i = 0; i < g.length; i++) {
      h ^= g.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    const idx = h % dim;
    const sign = (h >>> 31) & 1 ? -1 : 1;
    v[idx] += sign / Math.sqrt(grams.length || 1);
  }
  return normalize(v);
}

function finish(v: number[] | Float32Array, info: EmbedderInfo): Float32Array {
  const out = v instanceof Float32Array ? v : Float32Array.from(v);
  return info.dim > 0 ? truncate(normalize(out), info.dim) : normalize(out);
}

export async function embed(texts: string[], kind: EmbedKind = 'document') {
  const c = CONFIG();
  const info = embedderInfo();
  if (!info) {
    throw new EmbeddingError(
      'embeddings are disabled (MEMORIA_EMBED_PROVIDER=none); keyword search is available but write paths that need a vector are not'
    );
  }
  if (texts.length === 0) return { vectors: [] as Float32Array[], info };

  if (info.provider === 'hash') {
    return { vectors: texts.map((t) => hashEmbed(t, info.dim)), info };
  }

  const headers: Record<string, string> = { ...c.extra };
  if (c.apiKey) headers.authorization = `Bearer ${c.apiKey}`;

  const vectors: Float32Array[] = [];

  for (let i = 0; i < texts.length; i += c.batch) {
    const chunk = texts.slice(i, i + c.batch);

    if (info.provider === 'tei') {
      const json: any = await post(`${c.baseUrl}/embed`, { inputs: chunk, truncate: true }, headers, c.timeoutMs);
      const rows: number[][] = Array.isArray(json) ? json : json?.embeddings;
      if (!Array.isArray(rows) || rows.length !== chunk.length) {
        throw new EmbeddingError('TEI returned a different number of vectors than inputs');
      }
      for (const r of rows) vectors.push(finish(r, info));
      continue;
    }

    if (info.provider === 'gemini') {
      const modelPath = info.model.startsWith('models/') ? info.model : `models/${info.model}`;
      const url = `${c.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'}/${modelPath}:batchEmbedContents`;
      const gheaders: Record<string, string> = { ...c.extra };
      if (c.apiKey) gheaders['x-goog-api-key'] = c.apiKey;
      const body: any = {
        requests: chunk.map((t) => ({
          model: modelPath,
          content: { parts: [{ text: t }] },
          // Gemini accepts an output dimensionality for the models that support it.
          ...(c.dim ? { outputDimensionality: c.dim } : {}),
        })),
      };
      const json: any = await post(url, body, gheaders, c.timeoutMs);
      const rows: any[] = json?.embeddings || [];
      if (rows.length !== chunk.length) {
        throw new EmbeddingError('Gemini returned a different number of vectors than inputs');
      }
      for (const r of rows) {
        if (!r?.values?.length) throw new EmbeddingError('Gemini returned an empty embedding');
        vectors.push(finish(r.values, info));
      }
      continue;
    }

    // openai-compatible
    const base = c.baseUrl || 'https://api.openai.com/v1';
    const body: any = { model: info.model, input: chunk, encoding_format: 'float' };
    if (c.dim) body.dimensions = c.dim;
    const json: any = await post(`${base}/embeddings`, body, headers, c.timeoutMs);
    const rows: any[] = json?.data || [];
    if (rows.length !== chunk.length) {
      throw new EmbeddingError(
        `embedding endpoint returned ${rows.length} vectors for ${chunk.length} inputs (model ${info.model})`
      );
    }
    for (const r of rows.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
      const raw = r.embedding?.length ? r.embedding : r.embedding?.data;
      if (!raw?.length) throw new EmbeddingError('embedding endpoint returned an empty vector');
      vectors.push(finish(raw, info));
    }
  }

  return { vectors, info };
}

/** Convenience for a single text; returns null when embeddings are disabled. */
export async function embedOne(text: string, kind: EmbedKind = 'document') {
  if (!embedderInfo()) return { vector: null as Float32Array | null, info: null as EmbedderInfo | null };
  const { vectors, info } = await embed([text], kind);
  return { vector: vectors[0] ?? null, info };
}

export { hashEmbed };
