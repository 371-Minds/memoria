import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { guard, handleError, readJson } from '@/lib/http';

/**
 * POST /api/memory/:userId   { text, mediaUrl?, mediaType?, actionPayload?, createdAt?, source? }
 * GET  /api/memory/:userId   ?limit&offset&includeHistory
 *
 * The response keeps its old shape and adds what the write path now knows:
 * whether the write was a duplicate (`deduped`) and which memory it superseded.
 */
export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const blocked = guard(request, userId, 'post', 50);
  if (blocked) return blocked;

  const body = await readJson(request);
  if (!body) return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  const { text, mediaData, mediaMimeType, mediaUrl, actionPayload, createdAt, source } = body;

  if (!text && !mediaData && !actionPayload) {
    return NextResponse.json({ error: 'Text, mediaData, or actionPayload is required' }, { status: 400 });
  }

  try {
    const result = await store.addMemory({
      userId,
      text,
      mediaUrl,
      mediaType: mediaMimeType,
      actionPayload,
      createdAt,
      source: source || 'api',
    });
    return NextResponse.json({
      success: true,
      id: result.id,
      mref: result.mref,
      deduped: result.deduped,
      ...(result.superseded ? { superseded: result.superseded } : {}),
      embedded: result.embedded,
      ...(result.embedModel ? { embedModel: result.embedModel } : {}),
      message: result.deduped ? 'Memory already current; its timestamp was refreshed' : 'Memory stored successfully',
    });
  } catch (e) {
    return handleError(e, `POST /api/memory/${userId}`);
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const blocked = guard(request, userId, 'get', 100);
  if (blocked) return blocked;

  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get('limit') || 200);
    const offset = Number(searchParams.get('offset') || 0);
    const includeHistory = searchParams.get('includeHistory') === 'true';
    const memories = await store.getMemories(userId, { limit, offset, includeHistory });
    return NextResponse.json({
      memories: memories.map((m) => ({
        id: m.id,
        mref: m.mref,
        text: m.text,
        actionPayload: m.actionPayload,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        version: m.version,
        current: m.validTo === null,
      })),
    });
  } catch (e) {
    return handleError(e, `GET /api/memory/${userId}`);
  }
}
