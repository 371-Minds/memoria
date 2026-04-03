import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { generateEmbedding } from '@/lib/gemini';
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

    // Rate limiting: 50 requests per minute per user for POST
    const rateLimit = checkRateLimit(`post_${userId}`, 50, 60000);
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

    const body = await request.json();
    const { text, mediaData, mediaMimeType, mediaUrl } = body;

    if (!text && !mediaData) {
      return NextResponse.json({ error: 'Text or mediaData is required' }, { status: 400 });
    }

    let embedding;
    try {
      // Generate embedding using Gemini
      embedding = await generateEmbedding(text, mediaData, mediaMimeType);
    } catch (embeddingError: any) {
      console.error(`[POST /api/memory/${userId}] Failed to generate embedding:`, embeddingError.stack || embeddingError);
      return NextResponse.json({ error: 'Failed to generate embedding for the provided text. Please check your AI provider configuration.' }, { status: 502 });
    }

    // Store the memory using a valid UUID for ClickHouse compatibility
    const memory = {
      id: crypto.randomUUID(),
      userId,
      text,
      mediaUrl,
      mediaType: mediaMimeType,
      embedding,
      createdAt: Date.now(),
    };

    try {
      await store.addMemory(memory);
    } catch (storeError: any) {
      console.error(`[POST /api/memory/${userId}] Failed to store memory in database:`, storeError.stack || storeError);
      return NextResponse.json({ error: 'Failed to save memory to the database.' }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      id: memory.id,
      message: "Memory stored successfully"
    });
  } catch (error: any) {
    console.error(`[POST /api/memory] Unexpected error:`, error.stack || error);
    return NextResponse.json({ error: 'An unexpected internal server error occurred.' }, { status: 500 });
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let userId: string;
  try {
    const resolvedParams = await params;
    userId = resolvedParams.userId;
  } catch (error: any) {
    console.error("[GET /api/memory] Failed to resolve parameters:", error.stack || error);
    return NextResponse.json({ error: 'Invalid request parameters.' }, { status: 400 });
  }

  // Rate limiting: 100 requests per minute per user for GET
  const rateLimit = checkRateLimit(`get_${userId}`, 100, 60000);
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
    const memories = await store.getMemories(userId);
    
    return NextResponse.json({
      memories: memories.map((m: any) => ({ id: m.id, text: m.text, createdAt: m.createdAt }))
    });
  } catch (error: any) {
    console.error(`[GET /api/memory/${userId}] Error fetching memories:`, error.stack || error);
    return NextResponse.json({ error: 'Failed to retrieve memories from the database.' }, { status: 500 });
  }
}
