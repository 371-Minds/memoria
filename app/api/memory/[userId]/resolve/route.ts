import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { guard, handleError, readJson } from '@/lib/http';

/**
 * POST /api/memory/:userId/resolve  { mrefs: ["mref_ab12", ...] }
 *
 * Batch resolve for a prompt that carries several pointers. Unknown pointers come
 * back as null rather than failing the batch: a stale pointer should cost one
 * sentence of context, not the whole turn.
 */
export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const blocked = guard(request, userId, 'resolve', 200);
  if (blocked) return blocked;
  const body = await readJson(request);
  const mrefs = body?.mrefs;
  if (!Array.isArray(mrefs) || mrefs.length === 0) {
    return NextResponse.json({ error: 'mrefs must be a non-empty array' }, { status: 400 });
  }
  if (mrefs.length > 100) return NextResponse.json({ error: 'maximum 100 mrefs per request' }, { status: 400 });
  try {
    const resolved = await store.resolveMrefs(userId, mrefs.map(String));
    return NextResponse.json({
      memories: resolved,
      missing: Object.entries(resolved).filter(([, v]) => !v).map(([k]) => k),
    });
  } catch (e) {
    return handleError(e, `POST /api/memory/${userId}/resolve`);
  }
}
