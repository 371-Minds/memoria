/**
 * Bearer keys, bound to a scope.
 *
 * The old checkAuth() returned true when no keys were configured at all, which
 * is a convenience in `npm run dev` and an open memory store on a VPS with a
 * forgotten environment variable. It also let any key read any userId taken
 * straight from the URL.
 *
 * Rules now:
 *  - Keys are `key=scope` pairs, comma separated. Scope is a userId or `*`.
 *      MEMORIA_API_KEYS="k_client_a=client_a, k_admin=*"
 *      MEMORIA_API_KEY="k_local"        (legacy, scope *)
 *  - No keys configured: allowed in development, refused in production unless
 *    MEMORIA_ALLOW_ANON=1 says so on purpose.
 *  - A key scoped to a userId may only touch that userId.
 *  - Comparison is constant-time.
 */
import crypto from 'crypto';

type Scope = { key: string; userId: string };

function parseKeys(): Scope[] {
  const out: Scope[] = [];
  const multi = process.env.MEMORIA_API_KEYS;
  if (multi) {
    for (const entry of multi.split(',')) {
      const t = entry.trim();
      if (!t) continue;
      const eq = t.indexOf('=');
      out.push(eq === -1 ? { key: t, userId: '*' } : { key: t.slice(0, eq).trim(), userId: t.slice(eq + 1).trim() || '*' });
    }
  }
  const single = process.env.MEMORIA_API_KEY;
  if (single && single.trim()) out.push({ key: single.trim(), userId: '*' });
  return out.filter((s) => s.key.length > 0);
}

function same(a: string, b: string) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export type AuthResult =
  | { ok: true; scope: string }
  | { ok: false; status: number; error: string };

export function authorize(req: Request, userId?: string): AuthResult {
  const keys = parseKeys();
  const allowAnon =
    process.env.MEMORIA_ALLOW_ANON === '1' ||
    (keys.length === 0 && process.env.NODE_ENV !== 'production');

  if (keys.length === 0 && !allowAnon) {
    return {
      ok: false,
      status: 503,
      error:
        'no API key is configured: set MEMORIA_API_KEY, or MEMORIA_API_KEYS="key=userId,...", or MEMORIA_ALLOW_ANON=1 for a deliberately open instance',
    };
  }

  const header = req.headers.get('authorization') || '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!presented) {
    if (allowAnon) return { ok: true, scope: '*' };
    return { ok: false, status: 401, error: 'missing Authorization: Bearer <key>' };
  }

  const match = keys.find((k) => same(k.key, presented));
  if (!match) return { ok: false, status: 401, error: 'invalid API key' };

  if (userId && match.userId !== '*' && match.userId !== userId) {
    return { ok: false, status: 403, error: `this key is scoped to "${match.userId}"` };
  }
  return { ok: true, scope: match.userId };
}

/** Kept for callers that only need a yes/no (the MCP server, scripts). */
export function checkAuth(req: Request, userId?: string): boolean {
  return authorize(req, userId).ok;
}
