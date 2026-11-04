#!/usr/bin/env tsx
/**
 * Sweep stored memories for contradictions.
 *
 *   npm run contradictions                    # report only, 25 judge calls per user
 *   npm run contradictions -- --apply         # supersede what it finds
 *   npm run contradictions -- --user alice --limit 100 --max-calls 10
 *
 * This is the pass you run after configuring a judge, and the pass you run on a
 * schedule if you care that old facts get corrected. Without --apply it changes
 * nothing, which is what makes it safe to run against a real database.
 */
import { getDb } from '../lib/db';
import { store } from '../lib/store';
import { judgeInfo } from '../lib/judge';

function flag(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true;
}

async function main() {
  const info = judgeInfo();
  if (!info) {
    console.error('no judge configured: set MEMORIA_JUDGE_MODEL (and MEMORIA_JUDGE_BASE_URL / API_KEY if needed)');
    process.exit(1);
  }
  const apply = flag('apply') === true;
  const only = typeof flag('user') === 'string' ? (flag('user') as string) : undefined;
  const limit = Number(flag('limit') || 200);
  const maxCalls = Number(flag('max-calls') || 25);

  const users = only
    ? [{ userId: only }]
    : (getDb().prepare(`SELECT DISTINCT userId FROM memories WHERE validTo IS NULL`).all() as { userId: string }[]);

  console.log(`judge ${info.id} · ${users.length} user(s) · limit ${limit} rows · max ${maxCalls} calls each${apply ? ' · APPLYING' : ' · report only'}`);

  let totals = { scanned: 0, pairsJudged: 0, contradictions: 0, duplicates: 0, applied: 0 };
  for (const { userId } of users) {
    const r = await store.auditContradictions(userId, { limit, maxCalls, apply });
    totals.scanned += r.scanned;
    totals.pairsJudged += r.pairsJudged;
    totals.contradictions += r.contradictions;
    totals.duplicates += r.duplicates;
    totals.applied += r.applied;
    if (r.results.length === 0) {
      console.log(`${userId}: nothing found in ${r.scanned} memories`);
      continue;
    }
    console.log(`\n${userId}: ${r.scanned} memories, ${r.pairsJudged} pairs judged`);
    for (const x of r.results) {
      if (x.relation === 'unrelated' || x.relation === 'refines') continue;
      console.log(`  ${x.relation.padEnd(13)} sim ${x.similarity.toFixed(3)}  ${x.older.slice(0, 8)} → ${x.newer.slice(0, 8)}${x.applied ? '  [superseded]' : ''}\n    ${x.reason}`);
    }
  }
  console.log(`\n${totals.pairsJudged} pairs judged · ${totals.contradictions} contradictions · ${totals.duplicates} duplicates · ${totals.applied} applied`);
  if (!apply && totals.contradictions + totals.duplicates > 0) console.log('re-run with --apply to supersede them');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
