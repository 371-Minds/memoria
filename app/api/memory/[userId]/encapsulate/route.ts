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

  const { userId } = await params;

  // Rate limiting
  const rateLimit = checkRateLimit(`encapsulate_${userId}`, 10, 60000);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 }
    );
  }

  try {
    const result = await store.encapsulate(userId);
    
    return NextResponse.json({ 
      success: true, 
      ...result,
      message: "Memories encapsulated into GitMind capsule successfully"
    });
  } catch (error: any) {
    console.error(`[POST /api/memory/${userId}/encapsulate] Failed:`, error.stack || error);
    return NextResponse.json({ error: error.message || 'Failed to encapsulate memories.' }, { status: 500 });
  }
}
