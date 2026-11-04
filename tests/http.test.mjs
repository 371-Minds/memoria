/**
 * End-to-end: boot the built app on a free port with the offline hashing embedder
 * and exercise every route the way an agent would.
 *
 *   npm run build && npm run test:http
 *
 * It builds automatically if .next is missing or FORCE_BUILD=1 is set.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-http-'));

if (!fs.existsSync(path.join(root, '.next', 'BUILD_ID')) || process.env.FORCE_BUILD === '1') {
  const b = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  if (b.status !== 0) throw new Error('build failed');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: String(port),
  HOSTNAME: '127.0.0.1',
  MEMORIA_DB_PATH: path.join(dir, 'http.db'),
  MEMORIA_EMBED_PROVIDER: 'hash',
  MEMORIA_EMBED_DIM: '256',
  MEMORIA_ALLOW_ANON: '1',
};
delete env.MEMORIA_API_KEY;
delete env.MEMORIA_API_KEYS;

const server = spawn('node', ['.next/standalone/server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));

async function up() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok || r.status === 503) return r;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not start:\n${log}`);
}

const api = async (p, init = {}) => {
  const res = await fetch(`${base}${p}`, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
};
const post = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test.after(() => {
  server.kill('SIGTERM');
  fs.rmSync(dir, { recursive: true, force: true });
});

await up();

test('health reports the embedder and the store', async () => {
  const { status, body } = await api('/api/health');
  assert.equal(status, 200);
  assert.equal(body.embedder, 'hash:lexical-hash');
  assert.equal(body.store.codec, 'f32');
  assert.equal(body.status, 'ok');
});

let first;
test('store a memory and get a pointer back', async () => {
  const { status, body } = await post('/api/memory/alice', { text: 'Prefers terse answers with numbers' });
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.match(body.mref, /^mref_/);
  assert.equal(body.deduped, false);
  first = body;
});

test('the same text is a dedupe, not a second memory', async () => {
  const { body } = await post('/api/memory/alice', { text: 'Prefers terse answers with numbers ' });
  assert.equal(body.id, first.id);
  assert.equal(body.deduped, true);
});

test('search returns the text, the pointer and how it matched', async () => {
  const { status, body } = await api('/api/memory/alice/context?query=terse%20answers&topK=5');
  assert.equal(status, 200);
  assert.equal(body.context[0], 'Prefers terse answers with numbers');
  assert.equal(body.results[0].mref, first.mref);
  assert.ok(['vector', 'keyword', 'both'].includes(body.results[0].match));
  assert.ok(body.results[0].score > 0);
});

test('an identifier is findable by keyword', async () => {
  await post('/api/memory/alice', { text: 'The alert was ERR_7788 from the queue worker' });
  const { body } = await api('/api/memory/alice/context?query=ERR_7788&mode=keyword');
  assert.match(body.context[0], /ERR_7788/);
});

test('mref resolves, singly and in a batch', async () => {
  const one = await api(`/api/memory/alice/mref/${first.mref}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.memory.id, first.id);

  const batch = await post('/api/memory/alice/resolve', { mrefs: [first.mref, 'mref_doesnotexist'] });
  assert.equal(batch.status, 200);
  assert.equal(batch.body.memories[first.mref].id, first.id);
  assert.deepEqual(batch.body.missing, ['mref_doesnotexist']);
});

test('list, update, delete', async () => {
  const list = await api('/api/memory/alice');
  assert.ok(list.body.memories.length >= 2);

  const put = await api(`/api/memory/alice/${first.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Prefers terse answers with numbers and a table' }),
  });
  assert.equal(put.status, 200);

  const after = await api(`/api/memory/alice/${first.id}`);
  assert.match(after.body.memory.text, /table/);

  assert.equal((await api(`/api/memory/alice/${first.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await api(`/api/memory/alice/${first.id}`)).status, 404);
});

test('import reports what it did with each row', async () => {
  const { status, body } = await post('/api/memory/bob/import', {
    memories: [
      { text: 'Uses Postgres for the ledger' },
      { text: 'Runs the gateway on a two-core VM' },
      { text: 'Uses Postgres for the ledger' },
    ],
  });
  assert.equal(status, 200);
  assert.equal(body.imported, 2);
  assert.equal(body.refreshed, 1);
});

test('graph returns a neighbourhood', async () => {
  const { status, body } = await api('/api/memory/bob/graph?limit=50');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.nodes));
  assert.ok(body.nodes.length >= 2);
  assert.ok(Array.isArray(body.edges));
});

test('a capsule hashes the current state', async () => {
  const { status, body } = await post('/api/memory/bob/encapsulate');
  assert.equal(status, 200);
  assert.match(body.hash, /^[0-9a-f]{64}$/);
  assert.match(body.bootloader, /^data:text\/html;base64,/);
  assert.equal(typeof body.note, 'string');
});

test('a missing query is a sentence, not a 500', async () => {
  const { status, body } = await api('/api/memory/bob/context');
  assert.equal(status, 400);
  assert.match(body.error, /required/i);
});
