/**
 * Contradiction detection: the one thing similarity cannot do.
 *
 * Cosine finds facts that *look* alike. Two facts that disagree often do not:
 * "lives in Brooklyn" and "moved to Queens last month" are different sentences in
 * different words, and a vector store keeps both forever. That is a retrieval
 * quality bug you cannot fix with a threshold, so it needs a reader — one cheap
 * model call that decides what a new fact does to the facts around it.
 *
 * Configuration (all optional; without MEMORIA_JUDGE_MODEL none of this runs):
 *
 *   MEMORIA_JUDGE_MODEL          e.g. gpt-5-mini, a local model, your gateway's route
 *   MEMORIA_JUDGE_BASE_URL       OpenAI-compatible base; defaults to MEMORIA_EMBED_BASE_URL
 *   MEMORIA_JUDGE_API_KEY        defaults to MEMORIA_EMBED_API_KEY
 *   MEMORIA_JUDGE_TIMEOUT_MS     default 12000
 *   MEMORIA_CONTRADICTION_FLOOR  similarity floor for *candidates* (default 0.5)
 *   MEMORIA_JUDGE_MAX_CANDIDATES candidates per write (default 4)
 *
 * The judge is a suggestion, not an authority: its answer is validated against the
 * candidate list it was given, it can only ever invalidate rows that were offered,
 * and a failure or a malformed answer falls back to an ordinary write. Losing a
 * memory because a model timed out would be worse than keeping a stale one.
 */
import { EmbeddingError } from './embedder';

export type Relation = 'contradiction' | 'duplicate' | 'refines' | 'unrelated';

export type Judgement = {
  relation: Relation;
  supersedes: number[]; // 1-based indexes into the candidate list
  reason: string;
};

export type JudgeInfo = { id: string; model: string };

export class JudgeError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'JudgeError';
  }
}

export function judgeInfo(): JudgeInfo | null {
  const model = (process.env.MEMORIA_JUDGE_MODEL || '').trim();
  if (!model) return null;
  if ((process.env.MEMORIA_JUDGE_PROVIDER || '').toLowerCase() === 'none') return null;
  return { model, id: `judge:${model}` };
}

function config() {
  const baseUrl = (
    process.env.MEMORIA_JUDGE_BASE_URL ||
    process.env.MEMORIA_EMBED_BASE_URL ||
    'https://api.openai.com/v1'
  )
    .trim()
    .replace(/\/+$/, '');
  const apiKey = (process.env.MEMORIA_JUDGE_API_KEY || process.env.MEMORIA_EMBED_API_KEY || '').trim();
  const timeoutMs = Number(process.env.MEMORIA_JUDGE_TIMEOUT_MS || 0) || 12000;
  let extra: Record<string, string> = {};
  if (process.env.MEMORIA_JUDGE_HEADERS) {
    try {
      extra = JSON.parse(process.env.MEMORIA_JUDGE_HEADERS);
    } catch {
      throw new JudgeError('MEMORIA_JUDGE_HEADERS is not valid JSON');
    }
  }
  return { baseUrl, apiKey, timeoutMs, extra };
}

export const CONTRADICTION_FLOOR = () => {
  const n = Number(process.env.MEMORIA_CONTRADICTION_FLOOR || 0.5);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
};

export const MAX_CANDIDATES = () => {
  const n = Number(process.env.MEMORIA_JUDGE_MAX_CANDIDATES || 4);
  return Number.isFinite(n) ? Math.max(1, Math.min(20, Math.floor(n))) : 4;
};

const SYSTEM = `You maintain a long-term memory store for an assistant.
You are given one NEW fact and a numbered list of EXISTING facts.
Decide how the new fact relates to the existing ones.

Answer with JSON only, no prose, no code fences:
{"relation":"contradiction"|"duplicate"|"refines"|"unrelated","supersedes":[<existing numbers>],"reason":"<one short sentence>"}

Definitions:
- contradiction: the new fact makes an existing fact false (moved, changed job, reversed a preference, corrected a value). List exactly the numbers it falsifies.
- duplicate: the same fact in different words; nothing is added. List the number it duplicates.
- refines: compatible with the existing facts and adds detail. supersedes is empty.
- unrelated: none of them are about the same thing. supersedes is empty.

Never list a number you were not given. Never explain outside "reason".`;

function buildUser(newFact: string, candidates: { text: string }[]) {
  const list = candidates.map((c, i) => `${i + 1}. ${c.text}`).join('\n');
  return `NEW fact:\n${newFact}\n\nEXISTING facts:\n${list}`;
}

/** Tolerant parse: models wrap JSON in prose and code fences even when told not to. */
export function parseJudgement(raw: string): Judgement {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new JudgeError(`judge did not return JSON: ${raw.slice(0, 200)}`);
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    throw new JudgeError(`judge returned unparseable JSON: ${raw.slice(0, 200)}`, e);
  }
  const relation = String(parsed.relation || '').toLowerCase();
  if (!['contradiction', 'duplicate', 'refines', 'unrelated'].includes(relation)) {
    throw new JudgeError(`judge returned an unknown relation "${parsed.relation}"`);
  }
  const supersedes = Array.isArray(parsed.supersedes)
    ? parsed.supersedes.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
    : [];
  return {
    relation: relation as Relation,
    supersedes,
    reason: String(parsed.reason || '').slice(0, 300),
  };
}

export async function judgeFacts(newFact: string, candidates: { text: string }[]): Promise<Judgement> {
  const info = judgeInfo();
  if (!info) throw new JudgeError('no judge configured (MEMORIA_JUDGE_MODEL)');
  if (candidates.length === 0) return { relation: 'unrelated', supersedes: [], reason: 'no candidates' };
  const c = config();

  const body = {
    model: info.model,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildUser(newFact, candidates) },
    ],
    temperature: 0,
    max_tokens: 200,
    response_format: { type: 'json_object' },
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), c.timeoutMs);
    try {
      const res = await fetch(`${c.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}),
          ...c.extra,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (res.status >= 500 && attempt === 0) continue;
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new JudgeError(`judge endpoint returned ${res.status}: ${text.slice(0, 200)}`);
      }
      const json: any = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new JudgeError('judge returned an empty message');
      }
      const judgement = parseJudgement(content);
      // It may only invalidate what it was offered.
      judgement.supersedes = judgement.supersedes.filter((n) => n >= 1 && n <= candidates.length);
      if (judgement.relation !== 'contradiction' && judgement.relation !== 'duplicate') {
        judgement.supersedes = [];
      }
      return judgement;
    } catch (e: any) {
      const last = attempt === 1;
      if (e instanceof JudgeError) throw e;
      if (last) {
        throw new JudgeError(
          `could not reach the judge at ${c.baseUrl}: ${e?.name === 'AbortError' ? 'timed out' : e?.message || e}`,
          e
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new JudgeError('judge failed');
}

export { EmbeddingError };
