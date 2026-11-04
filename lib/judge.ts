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
 *   MEMORIA_JUDGE_FORMAT         letters (default) | word | json
 *                                letters: one letter per candidate — four tokens of
 *                                output, measured fastest and most accurate on a
 *                                local 1.7B; word: one word per candidate; json: one
 *                                answer for the whole list, for a model big enough to
 *                                keep indexes straight
 *   MEMORIA_JUDGE_NO_THINK      append Qwen3's /no_think so it answers instead of
 *                                reasoning for a hundred tokens
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

const LETTER_SYSTEM = `Compare two facts about the same user and pick one letter.
A = the new fact makes the old fact FALSE (moved, changed job, changed value, reversed preference).
B = they say the SAME thing in different words.
C = the new fact ADDS DETAIL and does not contradict.
D = they are UNRELATED.
Answer with just the letter.`;

const LETTERS: Record<string, Relation> = { a: 'contradiction', b: 'duplicate', c: 'refines', d: 'unrelated' };

/** Strip Qwen3-style reasoning blocks before looking for an answer. */
export function stripThinking(raw: string) {
  return raw.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '').trim();
}

/** True when the model opened a reasoning block and the token cap cut it off. */
function truncatedThinking(raw: string) {
  return /<think\b[^>]*>/i.test(raw) && !/<\/think>/i.test(raw);
}

export function parseLetter(raw: string): Relation {
  const m = /(?:^|[^a-z])([abcd])(?![a-z])/i.exec(stripThinking(raw));
  if (!m) throw new JudgeError(`judge did not answer with a letter: ${raw.slice(0, 120)}`);
  return LETTERS[m[1].toLowerCase()];
}

const THINK_SUFFIX = () => (process.env.MEMORIA_JUDGE_NO_THINK === '1' ? '\n/no_think' : '');

const WORD_SYSTEM = `You compare two facts stored about the same user.
Answer with exactly one word, nothing else.

CONTRADICTION - the new fact makes the old fact false (moved, changed job, changed a
  value, reversed a preference, a count that cannot both be true).
DUPLICATE - both facts say the same thing, in different words.
REFINES - the new fact adds detail and does not contradict the old one.
UNRELATED - they are about different things.

Answer with one of: CONTRADICTION, DUPLICATE, REFINES, UNRELATED`;

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

const WORD_RE = /\b(contradiction|duplicate|refines|unrelated)\b/i;

/**
 * The word protocol: one candidate, one word, eight tokens of output.
 *
 * A 1.5B model on two cores produced valid JSON 81% of the time and got the
 * relation right 44% of the time; most of the failures were the JSON envelope, not
 * the judgement. Asking for one of four words, and validating the word, removes the
 * envelope from the task.
 */
export function parseWord(raw: string): Relation {
  const m = WORD_RE.exec(stripThinking(raw));
  if (!m) throw new JudgeError(`judge did not answer with a relation word: ${raw.slice(0, 120)}`);
  return m[1].toLowerCase() as Relation;
}

function buildWordUser(newFact: string, existing: string) {
  return `OLD fact: ${existing}\nNEW fact: ${newFact}\nAnswer with one word:`;
}

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

  const format = (process.env.MEMORIA_JUDGE_FORMAT || 'letters').toLowerCase();

  if (format === 'letters' || format === 'word') {
    const letters = format === 'letters';
    // One call per candidate; the first contradiction or duplicate settles it.
    const verdicts: { index: number; relation: Relation }[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const system = letters ? LETTER_SYSTEM : WORD_SYSTEM;
      const user = letters
        ? `OLD: ${candidates[i].text}\nNEW: ${newFact}\nLetter:${THINK_SUFFIX()}`
        : buildWordUser(newFact, candidates[i].text) + THINK_SUFFIX();
      const r = await callJudge(info.model, c, {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        // Qwen3 spends ~4 tokens on an empty <think></think> block even with
        // /no_think, so a 4-token cap truncates the answer and looks like a
        // refusal. The ceiling is not a cost: generation stops at the answer.
        max_tokens: letters ? 16 : 8,
      });
      const content = r?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new JudgeError('judge returned an empty message');
      if (truncatedThinking(content)) {
        throw new JudgeError(
          'judge was cut off inside its reasoning block; raise max_tokens for this model (it spends tokens thinking even with /no_think)'
        );
      }
      const relation: Relation = letters ? parseLetter(content) : parseWord(content);
      verdicts.push({ index: i, relation });
      if (relation === 'contradiction' || relation === 'duplicate') break;
    }
    const contradictions = verdicts.filter((v) => v.relation === 'contradiction').map((v) => v.index + 1);
    const duplicates = verdicts.filter((v) => v.relation === 'duplicate').map((v) => v.index + 1);
    if (contradictions.length) return { relation: 'contradiction', supersedes: contradictions, reason: 'model answered CONTRADICTION' };
    if (duplicates.length) return { relation: 'duplicate', supersedes: duplicates, reason: 'model answered DUPLICATE' };
    if (verdicts.every((v) => v.relation === 'refines')) return { relation: 'refines', supersedes: [], reason: 'model answered REFINES' };
    return { relation: 'unrelated', supersedes: [], reason: 'model answered UNRELATED' };
  }

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

  const json = await callJudge(info.model, c, body);
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new JudgeError('judge returned an empty message');
  const judgement = parseJudgement(content);
  judgement.supersedes = judgement.supersedes.filter((n) => n >= 1 && n <= candidates.length);
  if (judgement.relation !== 'contradiction' && judgement.relation !== 'duplicate') judgement.supersedes = [];
  return judgement;
}

async function callJudge(
  model: string,
  c: { baseUrl: string; apiKey: string; timeoutMs: number; extra: Record<string, string> },
  body: unknown
): Promise<any> {
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
      return await res.json();
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
