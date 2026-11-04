import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { guard, handleError } from '@/lib/http';

/**
 * GET /api/memory/:userId/context?query=...&topK=5&mode=hybrid|vector|keyword
 *
 * `context` stays an array of strings so existing agents keep working. `results`
 * now carries the pointer (`mref`), the raw `similarity`, and how each hit was
 * found (`match`), plus `notes` that explain an empty or partly-stale result
 * instead of returning [] and letting the caller guess.
 */
export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const blocked = guard(request, userId, 'search', 50);
  if (blocked) return blocked;

  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');
    const topK = Number(searchParams.get('topK') || 5);
    const mode = (searchParams.get('mode') || 'hybrid') as 'hybrid' | 'vector' | 'keyword';
    const includeHistory = searchParams.get('includeHistory') === 'true';
    const recencyWeight = searchParams.get('recencyWeight');
    if (!query) return NextResponse.json({ error: 'Query parameter is required' }, { status: 400 });

    const { results, notes } = await store.search(userId, {
      query,
      topK,
      includeHistory,
      mode,
      recencyWeight: recencyWeight === null ? 0 : Number(recencyWeight),
    });

    return NextResponse.json({
      context: results.map((r) => r.text),
      results: results.map((r) => ({
        id: r.id,
        mref: r.mref,
        text: r.text,
        score: r.score,
        similarity: r.similarity ?? null,
        match: r.match ?? null,
        createdAt: r.createdAt,
      })),
      notes,
    });
  } catch (e) {
    return handleError(e, `GET /api/memory/${userId}/context`);
  }
}
