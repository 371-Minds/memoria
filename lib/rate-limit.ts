/**
 * In-memory per-key limit. Good enough for one process, which is the deployment
 * this ships for; a multi-replica deployment needs Redis or the limit is per
 * replica.
 *
 * The sweep timer is unref'd: a module-level setInterval keeps the Node process
 * (and `next dev`) alive forever, which is a surprising thing for a helper file
 * to do.
 */
interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const rateLimitCache = new Map<string, RateLimitRecord>();

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitCache.entries()) {
    if (now > record.resetTime) rateLimitCache.delete(key);
  }
}, 5 * 60 * 1000);
if (typeof sweeper.unref === 'function') sweeper.unref();

export function checkRateLimit(identifier: string, limit: number = 100, windowMs: number = 60000) {
  const now = Date.now();
  const record = rateLimitCache.get(identifier);

  if (!record || now > record.resetTime) {
    rateLimitCache.set(identifier, { count: 1, resetTime: now + windowMs });
    return { success: true, limit, remaining: limit - 1, reset: now + windowMs };
  }

  if (record.count >= limit) {
    return { success: false, limit, remaining: 0, reset: record.resetTime };
  }

  record.count += 1;
  return { success: true, limit, remaining: limit - record.count, reset: record.resetTime };
}

export function rateLimitHeaders(r: { limit: number; remaining: number; reset: number }) {
  return {
    'X-RateLimit-Limit': String(r.limit),
    'X-RateLimit-Remaining': String(r.remaining),
    'X-RateLimit-Reset': String(r.reset),
  };
}
