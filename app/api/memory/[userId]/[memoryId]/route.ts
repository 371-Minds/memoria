import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { guard, handleError, readJson } from '@/lib/http';

/** GET / PUT / DELETE one memory. History rows are readable, not editable. */
export async function GET(request: Request, { params }: { params: Promise<{ userId: string; memoryId: string }> }) {
  const { userId, memoryId } = await params;
  const blocked = guard(request, userId, 'getone', 120);
  if (blocked) return blocked;
  try {
    const memory = await store.getMemory(userId, memoryId);
    if (!memory) return NextResponse.json({ error: 'memory not found' }, { status: 404 });
    return NextResponse.json({ memory });
  } catch (e) {
    return handleError(e, `GET /api/memory/${userId}/${memoryId}`);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ userId: string; memoryId: string }> }) {
  const { userId, memoryId } = await params;
  const blocked = guard(request, userId, 'put', 50);
  if (blocked) return blocked;

  const body = await readJson(request);
  if (!body) return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  const { text, actionPayload } = body;
  if (!text && actionPayload === undefined) {
    return NextResponse.json({ error: 'Text is required' }, { status: 400 });
  }

  try {
    const ok = await store.updateMemory(userId, memoryId, { text, actionPayload });
    if (!ok) return NextResponse.json({ error: 'memory not found' }, { status: 404 });
    return NextResponse.json({ success: true, message: 'Memory updated successfully' });
  } catch (e) {
    return handleError(e, `PUT /api/memory/${userId}/${memoryId}`);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ userId: string; memoryId: string }> }) {
  const { userId, memoryId } = await params;
  const blocked = guard(request, userId, 'delete', 100);
  if (blocked) return blocked;
  try {
    const ok = await store.deleteMemory(userId, memoryId);
    if (!ok) return NextResponse.json({ error: 'memory not found' }, { status: 404 });
    return NextResponse.json({ success: true, message: 'Memory deleted successfully' });
  } catch (e) {
    return handleError(e, `DELETE /api/memory/${userId}/${memoryId}`);
  }
}
