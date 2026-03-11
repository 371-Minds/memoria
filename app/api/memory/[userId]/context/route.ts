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
    console.error("[GET /api/memory/context] Failed to resolve parameters:", error.stack || error);
    return NextResponse.json({ error: 'Invalid request parameters.' }, { status: 400 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');
    const topK = parseInt(searchParams.get('topK') || '3', 10);

    if (!query) {
      return NextResponse.json({ error: 'Query parameter is required' }, { status: 400 });
    }

    let queryEmbedding;
    try {
      // Generate embedding for the query
      queryEmbedding = await generateEmbedding(query);
    } catch (embeddingError: any) {
      console.error(`[GET /api/memory/${userId}/context] Failed to generate embedding for query:`, embeddingError.stack || embeddingError);
      return NextResponse.json({ error: 'Failed to generate embedding for the search query. Please check your AI provider configuration.' }, { status: 502 });
    }
    
    let results;
    try {
      // Search the memory store
      results = await store.search(userId, queryEmbedding, topK);
    } catch (storeError: any) {
      console.error(`[GET /api/memory/${userId}/context] Failed to search memory store:`, storeError.stack || storeError);
      return NextResponse.json({ error: 'Failed to query the database for context.' }, { status: 500 });
    }

    return NextResponse.json({
      context: results.map((r: any) => r.text),
      results: results.map((r: any) => ({ 
        id: r.id, 
        text: r.text, 
        score: r.score 
      }))
    });
  } catch (error: any) {
    console.error(`[GET /api/memory/${userId}/context] Unexpected error:`, error.stack || error);
    return NextResponse.json({ error: 'An unexpected internal server error occurred.' }, { status: 500 });
  }
}
