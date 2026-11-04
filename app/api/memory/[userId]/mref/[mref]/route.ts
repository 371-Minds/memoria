import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { guard, handleError } from '@/lib/http';

/**
 * GET /api/memory/:userId/mref/:mref — resolve a symbolic pointer.
 *
 * This is what makes `mref` real: an agent puts `[Context: ... --mref mref_ab12]`
 * in a prompt and the text behind it is fetched here, on demand, instead of every
 * memory being pasted into every prompt.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string; mref: string }> }
) {
  const { userId, mref } = await params;
  const blocked = guard(request, userId, 'mref', 200);
  if (blocked) return blocked;
  try {
    const memory = await store.getByMref(userId, mref);
    if (!memory) return NextResponse.json({ error: `no memory with mref ${mref}` }, { status: 404 });
    return NextResponse.json({ memory });
  } catch (e) {
    return handleError(e, `GET /api/memory/${userId}/mref/${mref}`);
  }
}
