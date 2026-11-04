/**
 * One SQLite file, one writer at a time, WAL mode.
 *
 * This replaces two previous stores that both lost data:
 *  - a JSON file rewritten in full on every write (`writeFileSync` with no lock,
 *    so two processes each held their own copy and the last saver won), and
 *  - an optional ClickHouse path that was still switched on in docker-compose
 *    after the commit that said it was removed.
 *
 * The rules that keep this one honest:
 *  - `busy_timeout` is set, because two processes (the Next server and a script)
 *    are allowed and SQLITE_BUSY must wait rather than throw.
 *  - the handle is cached on globalThis, because Next re-evaluates modules on HMR
 *    and in dev each route handler imports this file independently.
 *  - a write that spans rows is a transaction. A memory plus its supersede edge
 *    is two rows; a half-applied write is a bug even when the error is returned.
 *  - migrations are numbered, applied in order, and recorded in `meta` inside the
 *    same transaction that applies them.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export type DB = Database.Database;

export const DB_PATH =
  process.env.MEMORIA_DB_PATH || path.join(process.cwd(), 'data', 'memoria.db');

type Cache = { db?: DB; path?: string };
const g = globalThis as unknown as { __memoriaDb?: Cache };
if (!g.__memoriaDb) g.__memoriaDb = {};

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE memories(
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        userId TEXT NOT NULL,
        mref TEXT NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        mediaUrl TEXT NOT NULL DEFAULT '',
        mediaType TEXT NOT NULL DEFAULT '',
        actionPayload TEXT NOT NULL DEFAULT '',
        embedding BLOB,
        embedModel TEXT NOT NULL DEFAULT '',
        embedDim INTEGER NOT NULL DEFAULT 0,
        codec TEXT NOT NULL DEFAULT 'f32',
        textHash TEXT NOT NULL DEFAULT '',
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        validFrom INTEGER NOT NULL,
        validTo INTEGER,
        supersededBy TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL DEFAULT 'api'
      );
      CREATE UNIQUE INDEX ux_memories_mref ON memories(userId, mref);
      CREATE INDEX ix_memories_current ON memories(userId, validTo, createdAt DESC);
      CREATE INDEX ix_memories_hash ON memories(userId, textHash, validTo);
      -- One current row per exact text, enforced by the database rather than by a
      -- check-then-insert. Two processes storing the same fact at once is a race
      -- the old JSON store lost silently.
      CREATE UNIQUE INDEX ux_memories_current_hash ON memories(userId, textHash) WHERE validTo IS NULL;
      CREATE INDEX ix_memories_model ON memories(userId, embedModel, embedDim);

      CREATE VIRTUAL TABLE memories_fts USING fts5(
        text,
        content='memories',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
      CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, text) VALUES('delete', old.rowid, old.text);
      END;
      CREATE TRIGGER memories_au AFTER UPDATE OF text ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, text) VALUES('delete', old.rowid, old.text);
        INSERT INTO memories_fts(rowid, text) VALUES (new.rowid, new.text);
      END;

      CREATE TABLE edges(
        userId TEXT NOT NULL,
        fromId TEXT NOT NULL,
        toId TEXT NOT NULL,
        kind TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL,
        PRIMARY KEY(userId, fromId, toId, kind)
      );
      CREATE INDEX ix_edges_to ON edges(userId, toId);
    `,
  },
];

function migrate(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const current = Number(
    (db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value?: string })?.value || 0
  );
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    const run = db.transaction(() => {
      db.exec(m.sql);
      db.prepare(`INSERT INTO meta(key, value) VALUES('schema_version', ?)
                  ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(m.version));
    });
    run();
  }
}

export function getDb(): DB {
  const cache = g.__memoriaDb!;
  if (cache.db && cache.path === DB_PATH) return cache.db;
  if (cache.db) {
    try { cache.db.close(); } catch { /* already closed */ }
    cache.db = undefined;
    stmtCache.clear();
  }

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  cache.db = db;
  cache.path = DB_PATH;
  return db;
}

/** Close the handle. Tests and scripts use this; the server never needs to. */
export function closeDb() {
  const cache = g.__memoriaDb!;
  stmtCache.clear();
  if (cache.db) {
    try { cache.db.close(); } catch { /* already closed */ }
    cache.db = undefined;
    cache.path = undefined;
  }
}

/**
 * Prepared statements are memoised per SQL string.
 *
 * better-sqlite3 compiles a statement on every prepare() call, and the write path
 * touches a dozen of them; on a two-core VM that compilation was most of the cost
 * of a write. A prepared statement belongs to its connection, so the memo is
 * keyed to the handle and cleared when the handle is.
 */
type Stmt = Database.Statement;
const stmtCache = new Map<string, Stmt>();

export function prep(sql: string): Stmt {
  getDb(); // ensures the handle exists and the cache is for this handle
  let s = stmtCache.get(sql);
  if (!s) {
    s = getDb().prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

export function meta(key: string): string | undefined {
  const row = prep(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value;
}

export function setMeta(key: string, value: string) {
  prep(
    `INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}
