#!/usr/bin/env tsx
/**
 * Calibrate the contradiction judge.
 *
 *   npm run judge:calibrate                # one pass over the labelled pairs
 *   npm run judge:calibrate -- --runs 3    # repeat, to see variance
 *
 * The point is to answer three questions with numbers before the judge is allowed
 * to invalidate anything real:
 *   1. does it return parseable JSON at all,
 *   2. how often does its relation match an expected one, and
 *   3. what does a call cost in wall time on the machine it will run on.
 *
 * The pairs below are written to be hard: contradictions that share little
 * vocabulary (the case embeddings miss), duplicates that differ in wording, and
 * related-but-compatible facts that must not be merged.
 */
import { judgeFacts, judgeInfo, JudgeError } from '../lib/judge';

type Expected = 'contradiction' | 'duplicate' | 'refines' | 'unrelated';

const PAIRS: { newFact: string; existing: string; expected: Expected; why: string }[] = [
  // contradictions: the fact changed
  { newFact: 'User moved to Queens in March 2026.', existing: 'User lives in Brooklyn.', expected: 'contradiction', why: 'a move falsifies the address' },
  { newFact: 'User now works at Stripe as a staff engineer.', existing: 'User works at Acme as a backend engineer.', expected: 'contradiction', why: 'employer changed' },
  { newFact: 'User cancelled the Hetzner account last week.', existing: 'User runs three servers on Hetzner.', expected: 'contradiction', why: 'account gone' },
  { newFact: 'The gateway now listens on port 9527.', existing: 'The gateway listens on port 8080.', expected: 'contradiction', why: 'config changed' },
  { newFact: 'User prefers dark mode in every editor.', existing: 'User prefers light mode in every editor.', expected: 'contradiction', why: 'preference reversed' },
  { newFact: 'User has two children.', existing: 'User has three children.', expected: 'contradiction', why: 'a count that cannot both be true' },
  // duplicates: same fact, different words
  { newFact: 'User’s answers should be short and numeric.', existing: 'User prefers terse replies with numbers.', expected: 'duplicate', why: 'same preference, rephrased' },
  { newFact: 'Runs a two-core VM for the gateway.', existing: 'The gateway runs on a VM with two cores.', expected: 'duplicate', why: 'word order only' },
  { newFact: 'Produces research that cites its sources.', existing: 'Every research output must be cited.', expected: 'duplicate', why: 'same rule, active vs passive' },
  // refinements: compatible, adds detail
  { newFact: 'User’s Postgres is 16.3, managed by RDS.', existing: 'User uses Postgres.', expected: 'refines', why: 'narrows the same fact' },
  { newFact: 'The alert was ERR_4021 from the ledger writer.', existing: 'The build failed with ERR_4021.', expected: 'refines', why: 'same error, more location' },
  { newFact: 'User is based in New York and travels monthly.', existing: 'User is based in New York.', expected: 'refines', why: 'adds detail' },
  // unrelated: must not be merged
  { newFact: 'User prefers tabs over spaces.', existing: 'User runs a Postgres database.', expected: 'unrelated', why: 'different subjects' },
  { newFact: 'The boardroom has six seats.', existing: 'The gateway fails over after three attempts.', expected: 'unrelated', why: 'different subsystems' },
  { newFact: 'User drinks black coffee.', existing: 'User writes Go and TypeScript.', expected: 'unrelated', why: 'nothing in common' },
  { newFact: 'User dislikes YAML tabs.', existing: 'User likes the colour teal.', expected: 'unrelated', why: 'different topics' },
];

const runs = (() => {
  const i = process.argv.indexOf('--runs');
  return i === -1 ? 1 : Math.max(1, Number(process.argv[i + 1]) || 1);
})();

type Row = { expected: Expected; got: string; ms: number; parse: boolean; reason: string; why: string };

async function main() {
  const info = judgeInfo();
  if (!info) {
    console.error('no judge configured: set MEMORIA_JUDGE_MODEL and MEMORIA_JUDGE_BASE_URL');
    process.exit(1);
  }
  console.log(`judge ${info.id} · ${PAIRS.length} pairs × ${runs} run(s)\n`);

  const rows: Row[] = [];
  for (let r = 1; r <= runs; r++) {
    if (runs > 1) console.log(`-- run ${r}`);
    for (const p of PAIRS) {
      const t0 = process.hrtime.bigint();
      let got = 'error';
      let reason = '';
      let parse = false;
      try {
        const j = await judgeFacts(p.newFact, [{ text: p.existing }]);
        got = j.relation;
        reason = j.reason;
        parse = true;
      } catch (e) {
        reason = e instanceof JudgeError ? e.message : String(e);
      }
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      rows.push({ expected: p.expected, got, ms, parse, reason: reason.slice(0, 60), why: p.why });
      const mark = got === p.expected ? '✓' : got === 'error' ? '✗' : '≠';
      console.log(`${mark} ${String(Math.round(ms)).padStart(5)} ms  expected ${p.expected.padEnd(13)} got ${got.padEnd(13)} ${p.why}`);
      if (got !== p.expected && reason) console.log(`         ${reason}`);
    }
  }

  const total = rows.length;
  const parsed = rows.filter((r) => r.parse).length;
  const correct = rows.filter((r) => r.got === r.expected).length;
  const contradictionRows = rows.filter((r) => r.expected === 'contradiction');
  const duplicates = rows.filter((r) => r.expected === 'duplicate');
  const unrelated = rows.filter((r) => r.expected === 'unrelated');
  const tp = contradictionRows.filter((r) => r.got === 'contradiction').length;
  const fp = rows.filter((r) => r.expected !== 'contradiction' && r.got === 'contradiction').length;
  const fn = contradictionRows.length - tp;
  const times = rows.map((r) => r.ms).sort((a, b) => a - b);
  const p = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))];

  console.log(`\nJSON parseable      ${parsed}/${total} (${((100 * parsed) / total).toFixed(0)}%)`);
  console.log(`relation correct    ${correct}/${total} (${((100 * correct) / total).toFixed(1)}%)`);
  console.log(`contradiction       recall ${tp}/${contradictionRows.length}, precision ${tp}/${tp + fp}${tp + fp ? ` (${((100 * tp) / (tp + fp)).toFixed(0)}%)` : ''}, missed ${fn}`);
  console.log(`duplicate found     ${duplicates.filter((r) => r.got === 'duplicate').length}/${duplicates.length}`);
  console.log(`unrelated kept      ${unrelated.filter((r) => r.got === 'unrelated').length}/${unrelated.length}`);
  console.log(`latency             mean ${(times.reduce((a, b) => a + b, 0) / total).toFixed(0)} ms · p50 ${Math.round(p(0.5))} ms · p95 ${Math.round(p(0.95))} ms · max ${Math.round(times[times.length - 1])} ms`);

  const wrong = rows.filter((r) => r.got !== r.expected);
  if (wrong.length) {
    console.log('\nmismatches:');
    for (const w of wrong) console.log(`  expected ${w.expected} got ${w.got} — ${w.why}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
