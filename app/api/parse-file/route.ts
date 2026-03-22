import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let text = '';

    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      // Dynamic import to bypass static analysis issues with pdf-parse
      const pdfParseModule = await import('pdf-parse');
      const pdfParse = (pdfParseModule as any).default || pdfParseModule;
      const pdfData = await (pdfParse as any)(buffer);
      text = pdfData.text;
    } else {
      // Assume it's a text-based file
      text = buffer.toString('utf-8');
    }

    // Clean up text to reduce extraneous load
    const cleanText = text
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 50000); // Limit to ~50k characters to avoid blowing up context

    return NextResponse.json({ text: cleanText });
  } catch (error: any) {
    console.error('[POST /api/parse-file] Error parsing file:', error.stack || error);
    return NextResponse.json({ error: error.message || 'Failed to parse file' }, { status: 500 });
  }
}
