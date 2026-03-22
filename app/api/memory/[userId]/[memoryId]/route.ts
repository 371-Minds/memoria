import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { checkAuth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { generateEmbedding } from '@/lib/gemini';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string; memoryId: string }> }
) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let userId: string;
  let memoryId: string;
  try {
    const resolvedParams = await params;
    userId = resolvedParams.userId;
    memoryId = resolvedParams.memoryId;
  } catch (error: any) {
    console.error("[DELETE /api/memory] Failed to resolve parameters:", error.stack || error);
    return NextResponse.json({ error: 'Invalid request parameters.' }, { status: 400 });
  }

  // Rate limiting: 100 requests per minute per user for DELETE
  const rateLimit = checkRateLimit(`delete_${userId}`, 100, 60000);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { 
        status: 429,
        headers: {
          'X-RateLimit-Limit': rateLimit.limit.toString(),
          'X-RateLimit-Remaining': rateLimit.remaining.toString(),
          'X-RateLimit-Reset': rateLimit.reset.toString(),
        }
      }
    );
  }

  try {
    await store.deleteMemory(userId, memoryId);
    return NextResponse.json({ success: true, message: "Memory deleted successfully" });
  } catch (error: any) {
    console.error(`[DELETE /api/memory/${userId}/${memoryId}] Error deleting memory:`, error.stack || error);
    return NextResponse.json({ error: 'Failed to delete memory from the database.' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ userId: string; memoryId: string }> }
) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let userId: string;
  let memoryId: string;
  try {
    const resolvedParams = await params;
    userId = resolvedParams.userId;
    memoryId = resolvedParams.memoryId;
  } catch (error: any) {
    console.error("[PUT /api/memory] Failed to resolve parameters:", error.stack || error);
    return NextResponse.json({ error: 'Invalid request parameters.' }, { status: 400 });
  }

  // Rate limiting: 50 requests per minute per user for PUT
  const rateLimit = checkRateLimit(`put_${userId}`, 50, 60000);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { 
        status: 429,
        headers: {
          'X-RateLimit-Limit': rateLimit.limit.toString(),
          'X-RateLimit-Remaining': rateLimit.remaining.toString(),
          'X-RateLimit-Reset': rateLimit.reset.toString(),
        }
      }
    );
  }

  try {
    const body = await request.json();
    const { text } = body;

    if (!text) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    let embedding;
    try {
      // Generate embedding using Gemini
      embedding = await generateEmbedding(text);
    } catch (embeddingError: any) {
      console.error(`[PUT /api/memory/${userId}/${memoryId}] Failed to generate embedding:`, embeddingError.stack || embeddingError);
      return NextResponse.json({ error: 'Failed to generate embedding for the provided text. Please check your AI provider configuration.' }, { status: 502 });
    }

    await store.updateMemory(userId, memoryId, text, embedding);
    return NextResponse.json({ success: true, message: "Memory updated successfully" });
  } catch (error: any) {
    console.error(`[PUT /api/memory/${userId}/${memoryId}] Error updating memory:`, error.stack || error);
    return NextResponse.json({ error: 'Failed to update memory in the database.' }, { status: 500 });
  }
}
