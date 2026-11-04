/** Shared request plumbing: auth, scope check, rate limit, error shape. */
import { NextResponse } from 'next/server';
import { authorize } from './auth';
import { checkRateLimit, rateLimitHeaders } from './rate-limit';
import { EmbeddingError } from './embedder';

export function errorResponse(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

/** Returns a response to send, or null when the request may proceed. */
export function guard(
  req: Request,
  userId: string,
  bucket: string,
  limit = 60,
  windowMs = 60000
): NextResponse | null {
  const auth = authorize(req, userId);
  if (!auth.ok) return errorResponse(auth.status, auth.error);
  if (!userId || userId.length > 200) return errorResponse(400, 'userId is required and must be under 200 characters');

  const rl = checkRateLimit(`${bucket}_${userId}`, limit, windowMs);
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }
  return null;
}

/** Errors a client can act on: 502 for the model endpoint, 400 for bad input. */
export function handleError(e: unknown, where: string) {
  if (e instanceof EmbeddingError) return errorResponse(502, e.message);
  const message = e instanceof Error ? e.message : String(e);
  if (/is required|longer than|must be|non-empty/i.test(message)) return errorResponse(400, message);
  if (/SQLITE_CONSTRAINT|already has that text/i.test(message))
    return errorResponse(409, 'another current memory already has that text; store it as a new memory so the old one is superseded');
  console.error(`[${where}]`, e instanceof Error ? e.stack || message : message);
  return errorResponse(500, 'An unexpected internal server error occurred.');
}

export async function readJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
