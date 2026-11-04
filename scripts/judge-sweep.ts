#!/usr/bin/env tsx
/**
 * The recall/precision curve, by candidate floor.
 *
 *   npm run judge:sweep                    # floors 0.35 … 0.75
 *   npm run judge:sweep -- --floors 0.4,0.5,0.6 --max 40
 *
 * Two stages decide whether a contradiction is caught:
 *   1. retrieval — the old fact has to be close enough in vector space to reach the
 *      judge at all (this is `MEMORIA_CONTRADICTION_FLOOR`, and it is free);
 *   2. judgement — the model has to call that pair a contradiction (this costs a
 *      call, and it is where a small model is weakest).
 *
 * So the sweep embeds each pair once, judges each pair that clears the *lowest*
 * floor once, and then reports both stages per floor. Higher floors are subsets of
 * lower ones, which is why one pass of judgements is enough.
 */
import { embed, embedderInfo } from '../lib/embedder';
import { judgeFacts } from '../lib/judge';
import { cosine } from '../lib/vector';
import { PAIRS } from './judge-pairs';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const floors = (arg('floors') || '0.35,0.40,0.45,0.50,0.55,0.60,0.65,0.70,0.75')
  .split(',')
  .map(Number)
  .sort((a, b) => a - b);
const maxPairs = Number(arg('max') || PAIRS.length);

(async () => {
  const info = embedderInfo();
  if (!info) {
    console.error('no embedder configured: set MEMORIA_EMBED_PROVIDER / MEMORIA_EMBED_BASE_URL');
    process.exit(1);
  }
  const pairs = PAIRS.slice(0, maxPairs);
  const texts = pairs.flatMap((p) => [p.old, p.new]);
  const { vectors } = await embed(texts, 'document');

  const sims = pairs.map((p, i) => cosine(vectors[i * 2], vectors[i * 2 + 1]));
  const lowest = floors[0];

  // judge each pair that could ever be a candidate, once
  const verdicts: (string | null)[] = new Array(pairs.length).fill(null);
  const errors: (string | null)[] = new Array(pairs.length).fill(null);
  let calls = 0;
  for (let i = 0; i < pairs.length; i++) {
    if (sims[i] < lowest) continue;
    calls++;
    try {
      verdicts[i] = (await judgeFacts(pairs[i].new, [{ text: pairs[i].old }])).relation;
    } catch (e) {
      errors[i] = e instanceof Error ? e.message.slice(0, 60) : String(e);
    }
  }

  const positives = pairs.filter((p) => p.expected === 'contradiction').length;
  const negatives = pairs.length - positives;

  console.log(`embedder ${info.id} · judge ${process.env.MEMORIA_JUDGE_MODEL || '?'} · ${pairs.length} pairs (${positives} contradictions) · ${calls} judge calls\n`);
  console.log('floor  reach  recall-e2e        precision   false-supersedes  calls/pair');
  for (const f of floors) {
    const candidates = pairs.map((_, i) => sims[i] >= f);
    const reachable = pairs.filter((p, i) => p.expected === 'contradiction' && candidates[i]).length;
    let tp = 0, fp = 0;
    for (let i = 0; i < pairs.length; i++) {
      if (!candidates[i]) continue;
      if (verdicts[i] !== 'contradiction') continue;
      if (pairs[i].expected === 'contradiction') tp++;
      else fp++;
    }
    const called = candidates.filter(Boolean).length;
    console.log(
      `${f.toFixed(2)}   ${String(reachable + '/' + positives).padEnd(6)} ${String(tp + '/' + positives).padEnd(18)} ${(tp + fp ? ((100 * tp) / (tp + fp)).toFixed(0) + '%' : '—').padEnd(11)} ${String(fp).padEnd(17)} ${(called / pairs.length).toFixed(2)}`
    );
  }

  const near = pairs
    .map((p, i) => ({ p, s: sims[i], v: verdicts[i], e: errors[i] }))
    .sort((a, b) => b.s - a.s);
  console.log('\nby similarity:');
  for (const { p, s, v, e } of near) {
    const mark = v === p.expected ? '✓' : v === null ? '·' : '✗';
    console.log(`  ${mark} ${s.toFixed(3)}  want ${p.expected.padEnd(13)} got ${(v || (e ? 'error' : 'not-judged')).padEnd(13)} ${p.kind.padEnd(13)} ${p.why}`);
  }
})();
