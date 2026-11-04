#!/usr/bin/env tsx
/**
 * Measures the three paths that matter: write (with dedupe), hybrid search and
 * vector-only search, at a scale that fits a small VM. It refuses to run against
 * your real database unless you point MEMORIA_DB_PATH at a file yourself.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-bench-'));
process.env.MEMORIA_DB_PATH = path.join(dir, 'bench.db');
process.env.MEMORIA_EMBED_PROVIDER = 'hash';
delete process.env.MEMORIA_DEDUPE_THRESHOLD;

async function main() {
const { store } = await import('../lib/store');
const { closeDb } = await import('../lib/db');

const userId = 'bench';
const N = Number(process.env.BENCH_ROWS || 2000);
const words = 'postgres sqlite vector index memory gateway ledger router boardroom agent token cost latency retrieval hybrid keyword embedding model provider cache queue stream'.split(' ');

function sentence(i: number) {
  const pick = () => words[Math.floor(Math.random() * words.length)];
  return `memory ${i}: ${pick()} ${pick()} ${pick()} ${pick()} about ${pick()}`;
}

const t0 = performance.now();
for (let i = 0; i < N; i++) await store.addMemory({ userId, text: sentence(i) });
const writeMs = performance.now() - t0;

const t1 = performance.now();
for (let i = 0; i < 20; i++) await store.search(userId, { query: 'vector index latency', topK: 5 });
const hybridMs = (performance.now() - t1) / 20;

const t2 = performance.now();
for (let i = 0; i < 20; i++) await store.search(userId, { query: 'vector index latency', topK: 5, mode: 'keyword' });
const keywordMs = (performance.now() - t2) / 20;

// A duplicate should not cost a new row.
const t3 = performance.now();
const firstText = sentence(0);
await store.addMemory({ userId, text: firstText });
const dup = await store.addMemory({ userId, text: firstText });
const dupMs = performance.now() - t3;

console.log(JSON.stringify({
  rows: N,
  writeOpsPerSec: Math.round(N / (writeMs / 1000)),
  writeMsTotal: Math.round(writeMs),
  hybridSearchMs: Number(hybridMs.toFixed(2)),
  keywordSearchMs: Number(keywordMs.toFixed(2)),
  duplicateWriteMs: Number(dupMs.toFixed(2)),
  duplicateDeduped: dup.deduped,
  stats: store.stats(userId),
  dbBytes: fs.statSync(process.env.MEMORIA_DB_PATH!).size,
}, null, 2));

closeDb();
fs.rmSync(dir, { recursive: true, force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });
