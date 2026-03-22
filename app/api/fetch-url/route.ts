import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/auth';

export async function POST(request: Request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { url } = await request.json();
    
    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MemoriaBot/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.statusText}`);
    }

    const text = await response.text();
    
    // Basic HTML stripping to reduce token count and extraneous load
    const cleanText = text
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<[^>]*>?/gm, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 20000); // Limit to ~20k characters to avoid blowing up context

    return NextResponse.json({ text: cleanText });
  } catch (error: any) {
    console.error(`[POST /api/fetch-url] Error:`, error.stack || error);
    return NextResponse.json({ error: error.message || 'Failed to fetch URL' }, { status: 500 });
  }
}
