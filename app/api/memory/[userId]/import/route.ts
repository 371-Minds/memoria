import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { generateEmbeddings } from '@/lib/gemini';
import { checkAuth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { userId } = await params;

    const rateLimit = checkRateLimit(`import_${userId}`, 10, 60000);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { memories } = body;

    if (!Array.isArray(memories) || memories.length === 0) {
      return NextResponse.json({ error: 'An array of memories is required' }, { status: 400 });
    }

    // Limit batch size to prevent payload/timeout issues
    if (memories.length > 100) {
      return NextResponse.json({ error: 'Maximum 100 memories can be imported at once' }, { status: 400 });
    }

    const texts = memories.map((m: any) => m.text).filter(Boolean);
    if (texts.length === 0) {
      return NextResponse.json({ error: 'No valid text found in memories' }, { status: 400 });
    }

    let embeddings;
    try {
      embeddings = await generateEmbeddings(texts);
    } catch (embeddingError: any) {
      console.error(`[POST /api/memory/${userId}/import] Failed to generate embeddings:`, embeddingError.stack || embeddingError);
      return NextResponse.json({ error: 'Failed to generate embeddings for the provided texts.' }, { status: 502 });
    }

    const newMemories = [];
    for (let i = 0; i < texts.length; i++) {
      const memory = {
        id: crypto.randomUUID(),
        mref: `mref_${Math.random().toString(36).substring(2, 8)}`,
        userId,
        text: texts[i],
        embedding: embeddings[i],
        createdAt: memories[i].createdAt || Date.now(),
      };
      newMemories.push(memory);
      
      try {
        await store.addMemory(memory);
      } catch (storeError: any) {
        console.error(`[POST /api/memory/${userId}/import] Failed to store memory:`, storeError.stack || storeError);
        // Continue storing others even if one fails
      }
    }

    return NextResponse.json({ 
      success: true, 
      importedCount: newMemories.length,
      message: "Memories imported successfully"
    });
  } catch (error: any) {
    console.error(`[POST /api/memory/import] Unexpected error:`, error.stack || error);
    return NextResponse.json({ error: 'An unexpected internal server error occurred.' }, { status: 500 });
  }
}
