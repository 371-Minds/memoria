import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { guard, handleError, readJson } from '@/lib/http';
import { judgeInfo } from '@/lib/judge';

/**
 * POST /api/memory/:userId/audit  { apply?: boolean, limit?: number, maxCalls?: number }
 *
 * Finds contradictions among memories that are already stored — the facts the
 * write path never judged — and optionally supersedes them. Every pair is a model
 * call, so the budget (`maxCalls`, default 25) is part of the API rather than a
 * surprise on the bill.
 */
export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const blocked = guard(request, userId, 'audit', 2);
  if (blocked) return blocked;

  if (!judgeInfo()) {
    return NextResponse.json(
      {
        error:
          'no judge configured: set MEMORIA_JUDGE_MODEL (and MEMORIA_JUDGE_BASE_URL / MEMORIA_JUDGE_API_KEY if it is not an OpenAI-compatible default endpoint)',
      },
      { status: 503 }
    );
  }

  const body = (await readJson(request)) || {};
  try {
    const report = await store.auditContradictions(userId, {
      apply: body.apply === true,
      limit: body.limit,
      maxCalls: body.maxCalls,
      floor: body.floor,
    });
    return NextResponse.json({ success: true, ...report });
  } catch (e) {
    return handleError(e, `POST /api/memory/${userId}/audit`);
  }
}
