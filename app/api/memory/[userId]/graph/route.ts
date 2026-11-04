import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { guard, handleError } from '@/lib/http';

/**
 * GET /api/memory/:userId/graph?center=<id>&depth=1&limit=200
 *
 * Returns a neighbourhood, never the whole graph, because that is the difference
 * between a graph view that renders and one that locks up. `center` seeds it;
 * without a centre it starts from the 40 most recent memories. `truncated` says
 * the node cap was hit, so the caller can say "zoom in" instead of silently
 * showing a partial picture.
 */
export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const blocked = guard(request, userId, 'graph', 60);
  if (blocked) return blocked;
  try {
    const { searchParams } = new URL(request.url);
    const center = searchParams.get('center') || undefined;
    const depth = Number(searchParams.get('depth') || 1);
    const limit = Number(searchParams.get('limit') || 200);
    const graph = await store.graph(userId, { center, depth, limit });
    return NextResponse.json(graph);
  } catch (e) {
    return handleError(e, `GET /api/memory/${userId}/graph`);
  }
}
