import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { guard, handleError } from '@/lib/http';

/**
 * POST /api/memory/:userId/encapsulate
 *
 * Content-addressed snapshot of the current memories. The response keeps its
 * historical field names (`txId`, `arweaveUrl`, `bootloader`) because clients
 * were written against them, and adds `note`: this is a hash you can recompute,
 * not a chain transaction.
 */
export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const blocked = guard(request, userId, 'encapsulate', 10);
  if (blocked) return blocked;
  try {
    const result = await store.encapsulate(userId);
    return NextResponse.json({
      success: true,
      ...result,
      message: 'Memories encapsulated into a content-addressed capsule',
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/No memories/i.test(message)) return NextResponse.json({ error: message }, { status: 404 });
    return handleError(e, `POST /api/memory/${userId}/encapsulate`);
  }
}
