import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { embedderInfo } from '@/lib/embedder';

/**
 * GET /api/health — liveness plus what the instance is actually configured with:
 * the embedder and the store. A health check that only says "ok" cannot tell you
 * why retrieval is returning keyword-only results.
 */
export async function GET() {
  let embedder: string | null = null;
  let embedderError: string | null = null;
  try {
    embedder = embedderInfo()?.id ?? null;
  } catch (e) {
    embedderError = e instanceof Error ? e.message : String(e);
  }
  let storeStats: Record<string, unknown> | null = null;
  let storeError: string | null = null;
  try {
    storeStats = store.stats();
  } catch (e) {
    storeError = e instanceof Error ? e.message : String(e);
  }
  return NextResponse.json(
    {
      status: storeError ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      service: 'memoria',
      embedder,
      ...(embedderError ? { embedderError } : {}),
      store: storeStats,
      ...(storeError ? { storeError } : {}),
    },
    { status: storeError ? 503 : 200 }
  );
}
