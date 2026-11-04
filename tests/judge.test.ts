import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The contradiction pass, against a fake judge.
 *
 * The judge is the only part of the write path that can invalidate a memory, so
 * these tests pin the three things that matter: it may only touch what it was
 * shown, a failure never costs the write, and an import does not become 100 model
 * calls.
 */
let relation = 'contradiction';
let mode: 'ok' | 'fail500' | 'garbage' = 'ok';
let calls = 0;
let lastPrompt = '';

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    calls++;
    const body = JSON.parse(raw || '{}');
    lastPrompt = body.messages?.[1]?.content || '';
    if (mode === 'fail500') {
      res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'boom' }));
    }
    const content =
      mode === 'garbage'
        ? 'I think the second one is out of date.'
        : '```json\n' + JSON.stringify({ relation, supersedes: relation === 'unrelated' || relation === 'refines' ? [] : [1], reason: 'test says so' }) + '\n```';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-judge-'));
process.env.MEMORIA_DB_PATH = path.join(dir, 'judge.db');
process.env.MEMORIA_EMBED_PROVIDER = 'hash';
process.env.MEMORIA_EMBED_DIM = '256';
process.env.MEMORIA_CONTRADICTION_FLOOR = '0.05'; // the hashing embedder is lexical
delete process.env.MEMORIA_JUDGE_MODEL;

let store: typeof import('../lib/store')['store'];
let getDb: typeof import('../lib/db')['getDb'];
let closeDb: typeof import('../lib/db')['closeDb'];
let parseJudgement: typeof import('../lib/judge')['parseJudgement'];
let port = 0;

before(async () => {
  port = await new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as any).port)));
  ({ store } = await import('../lib/store'));
  ({ getDb, closeDb } = await import('../lib/db'));
  ({ parseJudgement } = await import('../lib/judge'));
  process.env.MEMORIA_JUDGE_MODEL = 'judge-test';
  process.env.MEMORIA_JUDGE_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.MEMORIA_JUDGE_API_KEY = 'jk';
});

after(() => {
  server.close();
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

const enable = () => {
  process.env.MEMORIA_JUDGE_MODEL = 'judge-test';
  process.env.MEMORIA_JUDGE_BASE_URL = `http://127.0.0.1:${port}/v1`;
};
const disable = () => delete process.env.MEMORIA_JUDGE_MODEL;

test('a contradiction supersedes the row it falsifies, with its own edge kind', async () => {
  disable();
  const old = await store.addMemory({ userId: 'c1', text: 'User lives in Brooklyn and works at Acme' });
  enable();
  relation = 'contradiction';
  calls = 0;
  const now = await store.addMemory({ userId: 'c1', text: 'User lives in Brooklyn and works at Acme on the payments team' });
  assert.equal(calls, 1, 'one judge call');
  assert.equal(now.judged?.relation, 'contradiction');
  assert.equal(now.superseded, old.id);

  const oldRow = await store.getMemory('c1', old.id);
  assert.ok(oldRow?.validTo, 'the contradicted row is invalidated, not deleted');
  assert.equal(oldRow?.supersededBy, now.id);
  const edges = getDb().prepare(`SELECT kind FROM edges WHERE userId = 'c1'`).all() as { kind: string }[];
  assert.ok(edges.some((e) => e.kind === 'contradicts'));
});

test('a duplicate is recognised and does not become a second row', async () => {
  disable();
  const first = await store.addMemory({ userId: 'c2', text: 'Preferred language is TypeScript' });
  enable();
  relation = 'duplicate';
  const again = await store.addMemory({ userId: 'c2', text: 'Preferred language is TypeScript, not Go' });
  assert.equal(again.deduped, true);
  assert.equal(again.id, first.id);
  const n = getDb().prepare(`SELECT COUNT(*) c FROM memories WHERE userId = 'c2'`).get() as { c: number };
  assert.equal(n.c, 1);
});

test('unrelated facts are left alone', async () => {
  relation = 'unrelated';
  const a = await store.addMemory({ userId: 'c3', text: 'Deploys on a two-core VM' });
  const b = await store.addMemory({ userId: 'c3', text: 'Prefers terse answers about Postgres' });
  assert.notEqual(a.id, b.id);
  assert.equal(b.superseded, undefined);
  const current = await store.getMemories('c3');
  assert.equal(current.length, 2);
});

test('a failing judge does not cost the write', async () => {
  disable();
  await store.addMemory({ userId: 'c4', text: 'A fact written while the judge is down about caching' });
  enable();
  mode = 'fail500';
  const r = await store.addMemory({ userId: 'c4', text: 'A fact written while the judge is down about caching layers' });
  mode = 'ok';
  assert.ok(r.judgeError, 'the failure is reported');
  assert.equal(await store.getMemory('c4', r.id).then((m) => m?.text), 'A fact written while the judge is down about caching layers');
});

test('a judge that answers with prose is not trusted', async () => {
  disable();
  await store.addMemory({ userId: 'c5', text: 'A fact judged by a chatty model about queues' });
  enable();
  mode = 'garbage';
  const r = await store.addMemory({ userId: 'c5', text: 'A fact judged by a chatty model about queues and retries' });
  mode = 'ok';
  assert.ok(r.judgeError);
  assert.ok(await store.getMemory('c5', r.id), 'the memory was written anyway');
});

test('import does not judge unless asked', async () => {
  disable();
  await store.addMemory({ userId: 'c6', text: 'Seed fact one about queues' });
  enable();
  calls = 0;
  await store.importMany('c6', [{ text: 'Seed fact one about queues and retries' }, { text: 'Seed fact two about caches' }]);
  assert.equal(calls, 0, 'an import of 100 rows must not be 100 model calls');
});

test('the audit finds contradictions already in the store', async () => {
  disable();
  const old = await store.addMemory({ userId: 'c7', text: 'The gateway runs on port 8080' });
  const newer = await store.addMemory({ userId: 'c7', text: 'The gateway runs on port 8080 after the port change' });
  enable();
  relation = 'contradiction';
  calls = 0;
  const report = await store.auditContradictions('c7', { limit: 50, maxCalls: 5, floor: 0.05, apply: true });
  assert.ok(report.pairsJudged >= 1);
  assert.ok(report.contradictions >= 1);
  assert.ok(report.applied >= 1);
  const oldRow = await store.getMemory('c7', old.id);
  assert.ok(oldRow?.validTo, 'the older fact was superseded by the audit');
  assert.ok(await store.getMemory('c7', newer.id));
});

test('the audit refuses to spend more than its budget', async () => {
  relation = 'unrelated';
  const r = await store.auditContradictions('c7', { limit: 50, maxCalls: 1, floor: 0.05 });
  assert.ok(r.pairsJudged <= 1);
});

test('the judge prompt only ever offers the candidates, and parses fenced JSON', () => {
  const j = parseJudgement('```json\n{"relation":"contradiction","supersedes":[2],"reason":"changed"}\n```');
  assert.equal(j.relation, 'contradiction');
  assert.deepEqual(j.supersedes, [2]);
  assert.match(lastPrompt, /NEW fact:/);
  assert.throws(() => parseJudgement('no json here'), /did not return JSON/);
});
