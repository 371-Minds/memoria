import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { generateEmbedding } from '@/lib/gemini';

function checkAuth(req: Request) {
  const apiKey = req.headers.get('authorization')?.split('Bearer ')[1];
  const expectedKey = process.env.MEMORIA_API_KEY;
  if (expectedKey && apiKey !== expectedKey) {
    return false;
  }
  return true;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { userId } = await params;
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
      console.error(`[POST /api/memory/${userId}] Failed to generate embedding:`, embeddingError.stack || embeddingError);
      return NextResponse.json({ error: 'Failed to generate embedding for the provided text. Please check your AI provider configuration.' }, { status: 502 });
    }

    // Store the memory
    const memory = {
      id: `mem_${Math.random().toString(36).substring(2, 11)}`,
      userId,
      text,
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
