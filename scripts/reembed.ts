#!/usr/bin/env tsx
/**
 * Re-embed memories that have no vector or a vector from a different model.
 *
 *   npm run reembed            # everything that needs it
 *   npm run reembed -- --dry   # count only
 *
 * Why this exists: a stored vector is only comparable with a query vector from
 * the same model and dimension. Nothing about a mismatch is visible at query
 * time — you get plausible-looking results that are wrong — so the store tags
 * every row with its embedder and this command fixes the rows that fall behind.
 */
import { getDb, setMeta } from '../lib/db';
import { embed, embedderInfo, EmbeddingError } from '../lib/embedder';
import { cosine, decode, encode } from '../lib/vector';

const dry = process.argv.includes('--dry');
const batch = Number(process.env.MEMORIA_EMBED_BATCH || 32);

async function main() {
  let info;
  try {
    info = embedderInfo();
  } catch (e) {
    console.error(e instanceof EmbeddingError ? e.message : e);
    process.exit(1);
  }
  if (!info || info.provider === 'none') {
    console.error('no embedder configured; set MEMORIA_EMBED_* (MEMORIA_EMBED_PROVIDER=hash works offline but is lexical only)');
    process.exit(1);
  }

  const db = getDb();
  setMeta('embedder:last', info.id);
  const stale = db
    .prepare(
      `SELECT id, text FROM memories
        WHERE validTo IS NULL AND (embedding IS NULL OR embedModel != ? OR embedDim != ?)
        ORDER BY createdAt`
    )
    .all(info.id, info.dim) as { id: string; text: string }[];

  console.log(`embedder ${info.id} (${info.dim}d): ${stale.length} memories to re-embed`);
  if (dry) return;

  // The edge rebuild below runs even when no row needed re-embedding: it was
  // skipped by an early return before, so a store whose vectors were fine never
  // got a graph.
  let done = 0;
  for (let i = 0; i < stale.length; i += batch) {
    const chunk = stale.slice(i, i + batch);
    const { vectors } = await embed(chunk.map((c) => c.text), 'document');
    const update = db.prepare(
      `UPDATE memories SET embedding = ?, embedModel = ?, embedDim = ?, codec = 'f32' WHERE id = ?`
    );
    const tx = db.transaction(() => {
      chunk.forEach((row, j) => update.run(encode(vectors[j], 'f32'), info!.id, vectors[j].length, row.id));
    });
    tx();
    done += chunk.length;
    process.stdout.write(`\r${done}/${stale.length}`);
  }
  console.log(`\nrebuilding similarity edges… (${done} re-embedded)`);
  const rows = db
    .prepare(`SELECT id, embedding, codec FROM memories WHERE validTo IS NULL AND embedding IS NOT NULL AND embedModel = ?`)
    .all(info.id) as { id: string; embedding: Buffer; codec: string }[];
  const vecs = rows.map((r) => ({ id: r.id, v: decode(r.embedding, r.codec) }));
  const threshold = Number(process.env.MEMORIA_GRAPH_SIMILARITY || 0.72);
  const insert = db.prepare(
    `INSERT INTO edges(userId, fromId, toId, kind, weight, createdAt) VALUES(?, ?, ?, 'similar', ?, ?)
     ON CONFLICT(userId, fromId, toId, kind) DO UPDATE SET weight = excluded.weight`
  );
  db.transaction(() => {
    db.prepare(`DELETE FROM edges WHERE kind = 'similar'`).run();
    for (let a = 0; a < vecs.length; a++) {
      const scored: { id: string; s: number }[] = [];
      for (let b = 0; b < vecs.length; b++) {
        if (a === b) continue;
        const s = cosine(vecs[a].v, vecs[b].v);
        if (s >= threshold) scored.push({ id: vecs[b].id, s });
      }
      scored.sort((x, y) => y.s - x.s);
      for (const { id, s } of scored.slice(0, 4)) {
        const [from, to] = vecs[a].id < id ? [vecs[a].id, id] : [id, vecs[a].id];
        const userId = (db.prepare(`SELECT userId FROM memories WHERE id = ?`).get(from) as any)?.userId || '';
        insert.run(userId, from, to, Number(s.toFixed(4)), Date.now());
      }
    }
  })();
  console.log(`edges rebuilt over ${vecs.length} memories at similarity >= ${threshold}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
