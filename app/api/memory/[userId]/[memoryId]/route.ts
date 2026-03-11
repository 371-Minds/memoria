import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

function checkAuth(req: Request) {
  const apiKey = req.headers.get('authorization')?.split('Bearer ')[1];
  const expectedKey = process.env.MEMORIA_API_KEY;
  if (expectedKey && apiKey !== expectedKey) {
    return false;
  }
  return true;
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string; memoryId: string }> }
) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let userId: string;
  let memoryId: string;
  try {
    const resolvedParams = await params;
    userId = resolvedParams.userId;
    memoryId = resolvedParams.memoryId;
  } catch (error: any) {
    console.error("[DELETE /api/memory] Failed to resolve parameters:", error.stack || error);
    return NextResponse.json({ error: 'Invalid request parameters.' }, { status: 400 });
  }

  try {
    await store.deleteMemory(userId, memoryId);
    return NextResponse.json({ success: true, message: "Memory deleted successfully" });
  } catch (error: any) {
    console.error(`[DELETE /api/memory/${userId}/${memoryId}] Error deleting memory:`, error.stack || error);
    return NextResponse.json({ error: 'Failed to delete memory from the database.' }, { status: 500 });
  }
}
