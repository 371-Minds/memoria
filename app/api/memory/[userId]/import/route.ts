import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { guard, handleError, readJson } from '@/lib/http';

/**
 * POST /api/memory/:userId/import  { memories: [{ text, createdAt? }] }
 *
 * One embedding call per batch would be faster, but per-item writes are what the
 * dedupe path needs, and it runs inside SQLite's WAL so the batch is no longer
 * 100 full-file rewrites. The response counts what actually happened: imported,
 * refreshed (was already current) and superseded.
 */
export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const blocked = guard(request, userId, 'import', 10);
  if (blocked) return blocked;

  const body = await readJson(request);
  const memories = body?.memories;
  if (!Array.isArray(memories) || memories.length === 0) {
    return NextResponse.json({ error: 'An array of memories is required' }, { status: 400 });
  }
  if (memories.length > 100) {
    return NextResponse.json({ error: 'Maximum 100 memories can be imported at once' }, { status: 400 });
  }
  const valid = memories.filter((m: any) => typeof m?.text === 'string' && m.text.trim());
  if (valid.length === 0) return NextResponse.json({ error: 'No valid text found in memories' }, { status: 400 });

  try {
    let imported = 0;
    let refreshed = 0;
    let superseded = 0;
    const ids: string[] = [];
    for (const m of valid) {
      const r = await store.addMemory({ userId, text: m.text, createdAt: m.createdAt, source: 'import' });
      if (r.deduped) refreshed++;
      else imported++;
      if (r.superseded) superseded++;
      ids.push(r.id);
    }
    return NextResponse.json({
      success: true,
      importedCount: ids.length,
      imported,
      refreshed,
      superseded,
      ids,
      message: 'Memories imported successfully',
    });
  } catch (e) {
    return handleError(e, `POST /api/memory/${userId}/import`);
  }
}
