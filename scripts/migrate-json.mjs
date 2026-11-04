#!/usr/bin/env node
/**
 * Move data/memories.json into SQLite.
 *
 * Deliberately does not import the old vectors. The old codec quantised each
 * component of a unit vector over a fixed [-1, 1] range, which measured 81%
 * recall@5 against exact vectors — so a migrated row is imported with its text
 * and timestamps and *no* embedding, and `npm run reembed` gives it an exact one
 * from whichever model you run now. Keyword search works immediately in between.
 *
 *   node scripts/migrate-json.mjs --from data/memories.json --db data/memoria.db [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]);
    return acc;
  }, [])
);
const from = args.from || path.join(process.cwd(), 'data', 'memories.json');
const dbPath = args.db || process.env.MEMORIA_DB_PATH || path.join(process.cwd(), 'data', 'memoria.db');
const dry = !!args.dry;

if (!fs.existsSync(from)) {
  console.error(`no file at ${from}`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(from, 'utf8'));
if (!Array.isArray(raw)) {
  console.error(`${from} is not an array of memories`);
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
// schema comes from the app's migrations; refuse to invent it here
const hasTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memories'`).get();
if (!hasTable) {
  console.error(`no memories table in ${dbPath} — start the app once so migrations run, then re-run this`);
  process.exit(1);
}

const hash = (userId, text) =>
  crypto.createHash('sha256').update(userId).update('\u0000').update(text.replace(/\s+/g, ' ').trim()).digest('hex');

const seen = new Set();
const insert = db.prepare(
  `INSERT INTO memories(id, userId, mref, text, mediaUrl, mediaType, actionPayload, embedding, embedModel,
                        embedDim, codec, textHash, createdAt, updatedAt, validFrom, validTo, supersededBy, version, source)
   VALUES(?, ?, ?, ?, ?, ?, ?, NULL, '', 0, 'f32', ?, ?, ?, ?, NULL, NULL, 1, 'migrated')`
);

let imported = 0, skipped = 0, dup = 0;
db.transaction(() => {
  for (const m of raw) {
    const text = typeof m.text === 'string' ? m.text.replace(/\s+/g, ' ').trim() : '';
    if (!text || !m.userId) { skipped++; continue; }
    const h = hash(m.userId, text);
    if (seen.has(m.userId + h)) { dup++; continue; }
    seen.add(m.userId + h);
    if (dry) { imported++; continue; }
    const now = Date.now();
    insert.run(
      m.id || crypto.randomUUID(),
      m.userId,
      m.mref || 'mref_' + crypto.randomBytes(5).toString('hex'),
      text,
      m.mediaUrl || '',
      m.mediaType || '',
      m.actionPayload ? JSON.stringify(m.actionPayload) : '',
      h,
      Number(m.createdAt) || now,
      now,
      Number(m.createdAt) || now
    );
    imported++;
  }
})();

console.log(
  `${dry ? '[dry run] ' : ''}${imported} imported, ${dup} exact duplicates collapsed, ${skipped} rows without text or userId skipped`
);
if (!dry && (imported > 0 || dup > 0)) {
  console.log('next: npm run reembed   (gives the migrated rows exact vectors from your current model)');
}
db.close();
