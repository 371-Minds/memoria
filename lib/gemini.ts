import { GoogleGenAI } from "@google/genai";

// Initialize the Gemini client
// We use the NEXT_PUBLIC_ prefix so it can be used in client components if needed,
// but for embeddings we'll primarily use it server-side.
const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });

export async function generateEmbedding(text?: string, mediaData?: string, mimeType?: string): Promise<number[]> {
  const contents: any[] = [];
  if (text) contents.push(text);
  if (mediaData && mimeType) {
    contents.push({
      inlineData: {
        data: mediaData,
        mimeType: mimeType,
      },
    });
  }

  const result = await ai.models.embedContent({
    model: 'gemini-embedding-2-preview',
    contents: contents,
  });
  
  if (!result.embeddings || result.embeddings.length === 0 || !result.embeddings[0].values) {
    throw new Error("Failed to generate embedding");
  }
  
  return result.embeddings[0].values;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const result = await ai.models.embedContent({
    model: 'gemini-embedding-2-preview',
    contents: texts,
  });
  
  if (!result.embeddings || result.embeddings.length !== texts.length) {
    throw new Error("Failed to generate batch embeddings");
  }
  
  return result.embeddings.map(e => e.values || []);
}
