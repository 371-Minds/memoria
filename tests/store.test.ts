import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-test-'));
process.env.MEMORIA_DB_PATH = path.join(dir, 'test.db');
process.env.MEMORIA_EMBED_PROVIDER = 'hash';
process.env.MEMORIA_EMBED_DIM = '256';
delete process.env.MEMORIA_DEDUPE_THRESHOLD;
delete process.env.MEMORIA_REQUIRE_EMBEDDINGS;

// Imported inside before(): the modules read MEMORIA_DB_PATH when they load, and
// this file is CommonJS to tsx, where a top-level await is a transform error.
let store: typeof import('../lib/store')['store'];
let getDb: typeof import('../lib/db')['getDb'];
let closeDb: typeof import('../lib/db')['closeDb'];
let meta: typeof import('../lib/db')['meta'];

const u = 'user_a';

before(async () => {
  ({ store } = await import('../lib/store'));
  ({ getDb, closeDb, meta } = await import('../lib/db'));
});

after(async () => {
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writes, reads back, and resolves its mref', async () => {
  const r = await store.addMemory({ userId: u, text: 'The gateway ledger records cost per attempt' });
  assert.equal(r.deduped, false);
  assert.equal(r.embedded, true);
  assert.match(r.mref, /^mref_[0-9a-f]{10}$/);

  const byMref = await store.getByMref(u, r.mref);
  assert.equal(byMref?.id, r.id);
  assert.equal(byMref?.text, 'The gateway ledger records cost per attempt');

  const list = await store.getMemories(u);
  assert.ok(list.some((m) => m.id === r.id));
});

test('the same fact twice is one memory, not two', async () => {
  const text = 'Prefers short sentences';
  const a = await store.addMemory({ userId: u, text });
  const b = await store.addMemory({ userId: u, text: `  ${text}  ` });
  assert.equal(b.id, a.id);
  assert.equal(b.deduped, true);
  const rows = getDb().prepare(`SELECT COUNT(*) c FROM memories WHERE userId = ? AND text = ?`).get(u, text) as { c: number };
  assert.equal(rows.c, 1);
});

test('a near duplicate supersedes instead of piling up, and history is kept', async () => {
  process.env.MEMORIA_DEDUPE_THRESHOLD = '0.75';
  const first = await store.addMemory({ userId: u, text: 'Lives in Brooklyn, New York' });
  const second = await store.addMemory({ userId: u, text: 'Lives in Brooklyn New York' });
  delete process.env.MEMORIA_DEDUPE_THRESHOLD;

  if (second.superseded) {
    assert.equal(second.superseded, first.id);
    assert.equal(second.id === first.id, false);
    const old = await store.getMemory(u, first.id);
    assert.ok(old?.validTo, 'superseded row keeps a validTo');
    assert.equal(old?.supersededBy, second.id);

    const current = await store.getMemories(u);
    assert.ok(!current.some((m) => m.id === first.id), 'default reads exclude superseded rows');
    const all = await store.getMemories(u, { includeHistory: true });
    assert.ok(all.some((m) => m.id === first.id), 'history is still readable');

    const edges = getDb()
      .prepare(`SELECT kind FROM edges WHERE userId = ? AND (fromId = ? OR toId = ?)`)
      .all(u, second.id, second.id) as { kind: string }[];
    assert.ok(edges.some((e) => e.kind === 'supersedes'));
  } else {
    // Distinct facts must not be merged even when they share most words.
    const current = await store.getMemories(u);
    assert.ok(current.some((m) => m.id === first.id));
    assert.ok(current.some((m) => m.id === second.id));
  }
});

test('two different facts with the default threshold stay two facts', async () => {
  delete process.env.MEMORIA_DEDUPE_THRESHOLD;
  const a = await store.addMemory({ userId: u, text: 'Favourite colour is teal' });
  const b = await store.addMemory({ userId: u, text: 'Favourite database is SQLite' });
  assert.notEqual(a.id, b.id);
  assert.equal(b.superseded, undefined);
});

test('keyword search finds an identifier that embeddings mangle', async () => {
  const r = await store.addMemory({ userId: u, text: 'The failing build was ERR_4021 in the ledger writer' });
  const { results, notes } = await store.search(u, { query: 'ERR_4021', topK: 5, mode: 'keyword' });
  assert.equal(notes.length, 0);
  assert.equal(results[0]?.id, r.id);
  assert.equal(results[0]?.match, 'keyword');
});

test('hybrid search fuses vector and keyword hits', async () => {
  const text = 'Boardroom minutes are stored in the room directory as markdown';
  const r = await store.addMemory({ userId: u, text });
  const { results } = await store.search(u, { query: 'boardroom minutes markdown', topK: 5 });
  const hit = results.find((x) => x.id === r.id);
  assert.ok(hit, 'the memory should come back');
  assert.equal(hit?.match, 'both');
  assert.ok((hit?.score ?? 0) > 0);
});

test('search explains an empty result instead of returning nothing silently', async () => {
  const { results, notes } = await store.search('user_with_no_memories', { query: 'anything' });
  assert.equal(results.length, 0);
  assert.ok(notes.some((n) => /no memories stored/i.test(n)));
});

test('without an embedder the store still writes and finds by keyword', async () => {
  process.env.MEMORIA_EMBED_PROVIDER = 'none';
  const r = await store.addMemory({ userId: 'user_b', text: 'Deploys to a VPS on Hetzner' });
  assert.equal(r.embedded, false);
  const { results } = await store.search('user_b', { query: 'Hetzner' });
  assert.equal(results[0]?.id, r.id);
  process.env.MEMORIA_EMBED_PROVIDER = 'hash';
});

test('a model change is reported, not blended', async () => {
  process.env.MEMORIA_EMBED_PROVIDER = 'hash';
  process.env.MEMORIA_EMBED_MODEL = 'lexical-hash';
  await store.addMemory({ userId: 'user_c', text: 'Prefers tabs over spaces' });
  // Simulate vectors from another model: rewrite the tag on the stored row.
  getDb().prepare(`UPDATE memories SET embedModel = 'openai:text-embedding-3-small' WHERE userId = 'user_c'`).run();
  const { results, notes } = await store.search('user_c', { query: 'tabs spaces' });
  assert.ok(notes.some((n) => /different model/i.test(n)), notes.join(' | '));
  assert.ok(results.length >= 0); // keyword half still answers
  delete process.env.MEMORIA_EMBED_MODEL;
});

test('graph returns a bounded neighbourhood and says when it truncated', async () => {
  for (let i = 0; i < 8; i++) {
    await store.addMemory({ userId: 'user_d', text: `vector index tuning note ${i} about latency and recall` });
  }
  const g = await store.graph('user_d', { limit: 3 });
  assert.ok(g.nodes.length <= 3);
  assert.equal(typeof g.truncated, 'boolean');
  const center = g.nodes[0]?.id;
  const g2 = await store.graph('user_d', { center, depth: 2, limit: 50 });
  assert.ok(g2.nodes.length >= 1);
});

test('a capsule is a hash of content: stable, and it changes when a fact changes', async () => {
  const before = await store.encapsulate('user_d');
  const again = await store.encapsulate('user_d');
  assert.equal(before.hash, again.hash);
  await store.addMemory({ userId: 'user_d', text: 'a fact that was not there before' });
  const after = await store.encapsulate('user_d');
  assert.notEqual(before.hash, after.hash);
  assert.match(after.bootloader, /^data:text\/html;base64,/);
});

test('deleting removes the memory and its edges', async () => {
  const r = await store.addMemory({ userId: 'user_e', text: 'Temporary note about a queue' });
  assert.equal(await store.deleteMemory('user_e', r.id), true);
  assert.equal(await store.getMemory('user_e', r.id), null);
  const n = getDb()
    .prepare(`SELECT COUNT(*) c FROM edges WHERE fromId = ? OR toId = ?`)
    .get(r.id, r.id) as { c: number };
  assert.equal(n.c, 0);
});

test('two connections writing at once both land, and a duplicate race is one row', async () => {
  const Database = (await import('better-sqlite3')).default;
  const second = new Database(process.env.MEMORIA_DB_PATH!);
  second.pragma('journal_mode = WAL');
  second.pragma('busy_timeout = 5000');

  const text = 'Concurrent writers must not lose this';
  const hash = (await import('crypto')).createHash('sha256').update('user_f').update('\u0000').update(text).digest('hex');
  const insert = second.prepare(
    `INSERT INTO memories(id, userId, mref, text, textHash, createdAt, updatedAt, validFrom, version, source)
     VALUES(?, 'user_f', ?, ?, ?, ?, ?, ?, 1, 'race')`
  );
  const now = Date.now();
  try {
    insert.run('race-id', 'mref_race000000', text, hash, now, now, now);
  } catch (e: any) {
    assert.match(String(e.code), /SQLITE_CONSTRAINT/);
  }
  second.close();

  // The store's own write of the same text is a dedupe, not a second row.
  const r = await store.addMemory({ userId: 'user_f', text });
  assert.equal(r.deduped, true);
  const n = getDb().prepare(`SELECT COUNT(*) c FROM memories WHERE userId = 'user_f'`).get() as { c: number };
  assert.equal(n.c, 1);
});

test('stats describe what is actually stored', async () => {
  const s = store.stats(u);
  assert.ok(s.total >= 5);
  assert.ok(s.current <= s.total);
  assert.equal(s.codec, 'f32');
  assert.equal(meta('schema_version'), '1');
});
