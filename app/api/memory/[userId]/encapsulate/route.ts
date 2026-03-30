import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
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

    // Rate limiting: 10 requests per minute per user for encapsulation (expensive operation)
    const rateLimit = checkRateLimit(`encapsulate_${userId}`, 10, 60000);
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
      const result = await store.encapsulate(userId);
      return NextResponse.json({ 
        success: true, 
        ...result,
        message: "Memories encapsulated into Arweave capsule successfully"
      });
    } catch (encapsulateError: any) {
      console.error(`[POST /api/memory/${userId}/encapsulate] Failed:`, encapsulateError.stack || encapsulateError);
      return NextResponse.json({ error: encapsulateError.message || 'Failed to encapsulate memories.' }, { status: 500 });
    }
  } catch (error: any) {
    console.error(`[POST /api/memory/encapsulate] Unexpected error:`, error.stack || error);
    return NextResponse.json({ error: 'An unexpected internal server error occurred.' }, { status: 500 });
  }
}
