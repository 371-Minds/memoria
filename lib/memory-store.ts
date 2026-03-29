import fs from 'fs';
import path from 'path';
import { globalEncapsulator } from './arweave';

export type Memory = {
  id: string;
  userId: string;
  text: string;
  embedding: number[] | string; // Can be raw or TurboQuant compressed
  createdAt: number;
};

export class TurboQuant {
  /**
   * PolarQuant: Stage 1 - Polar-Coordinate Transform
   * Instead of quantizing raw Cartesian coordinates (x, y, z...), 
   * we separate the vector into its Magnitude (L2 norm) and its Unit Vector (direction).
   * This preserves the semantic "direction" of the thought while shrinking the storage.
   */
  static polarTransform(embedding: number[]): { magnitude: number, unitVector: number[] } {
    let sumSquares = 0;
    for (const val of embedding) sumSquares += val * val;
    const magnitude = Math.sqrt(sumSquares);
    
    // If magnitude is 0, return zero vector
    if (magnitude === 0) return { magnitude: 0, unitVector: new Array(embedding.length).fill(0) };
    
    const unitVector = embedding.map(v => v / magnitude);
    return { magnitude, unitVector };
  }

  /**
   * PolarQuant: Stage 2 - Extreme Quantization
   * We compress the Unit Vector to 8-bit (or lower) and store the Magnitude separately.
   */
  static compress(embedding: number[]): string {
    const { magnitude, unitVector } = this.polarTransform(embedding);
    
    // Quantize unit vector to 8-bit
    const quantized = new Uint8Array(unitVector.length);
    for (let i = 0; i < unitVector.length; i++) {
      // Unit vector values are in [-1, 1]
      quantized[i] = Math.round(((unitVector[i] + 1) / 2) * 255);
    }
    
    // Pack Magnitude (float32) + Quantized Vector
    const magBuffer = Buffer.alloc(4);
    magBuffer.writeFloatLE(magnitude, 0);
    
    const finalBuffer = Buffer.concat([magBuffer, Buffer.from(quantized)]);
    return finalBuffer.toString('base64');
  }

  /**
   * Decompress back to Cartesian coordinates
   */
  static decompress(compressed: string): number[] {
    const buffer = Buffer.from(compressed, 'base64');
    const magnitude = buffer.readFloatLE(0);
    const quantized = buffer.subarray(4);
    
    const embedding = new Array(quantized.length);
    for (let i = 0; i < quantized.length; i++) {
      const unitVal = (quantized[i] / 255) * 2 - 1;
      embedding[i] = unitVal * magnitude;
    }
    return embedding;
  }
}

export class MemoryStore {
  private memories: Memory[] = [];
  private dataFile = path.join(process.cwd(), 'data', 'memories.json');

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.dataFile)) {
        const data = fs.readFileSync(this.dataFile, 'utf-8');
        this.memories = JSON.parse(data);
      }
    } catch (e) {
      console.error('Failed to load memories:', e);
    }
  }

  private save() {
    try {
      const dir = path.dirname(this.dataFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dataFile, JSON.stringify(this.memories, null, 2));
    } catch (e) {
      console.error('Failed to save memories:', e);
    }
  }

  addMemory(memory: Memory) {
    // Apply TurboQuant compression if it's a raw array
    if (Array.isArray(memory.embedding)) {
      memory.embedding = TurboQuant.compress(memory.embedding);
    }
    this.memories.push(memory);
    this.save();
  }

  getMemories(userId: string) {
    return this.memories.filter(m => m.userId === userId);
  }

  deleteMemory(userId: string, memoryId: string) {
    this.memories = this.memories.filter(m => !(m.userId === userId && m.id === memoryId));
    this.save();
  }

  updateMemory(userId: string, memoryId: string, text: string, embedding: number[]) {
    const memoryIndex = this.memories.findIndex(m => m.userId === userId && m.id === memoryId);
    if (memoryIndex !== -1) {
      this.memories[memoryIndex] = {
        ...this.memories[memoryIndex],
        text,
        embedding: TurboQuant.compress(embedding)
      };
      this.save();
    }
  }

  search(userId: string, queryEmbedding: number[], topK: number = 5) {
    const userMemories = this.getMemories(userId);
    const scored = userMemories.map(m => {
      const embedding = typeof m.embedding === 'string' 
        ? TurboQuant.decompress(m.embedding) 
        : m.embedding;
      return {
        ...m,
        score: this.cosineSimilarity(embedding, queryEmbedding)
      };
    });
    
    // Sort by descending score
    scored.sort((a, b) => b.score - a.score);
    
    return scored.slice(0, topK);
  }

  /**
   * Encapsulate user memories into a permanent Arweave "Capability Capsule"
   */
  async encapsulate(userId: string) {
    const userMemories = this.getMemories(userId);
    if (userMemories.length === 0) {
      throw new Error("No memories found for this user.");
    }

    try {
      const { txId, hash } = await globalEncapsulator.encapsulate(userMemories);
      return {
        txId,
        hash,
        arweaveUrl: `https://gateway.irys.xyz/${txId}`,
        bootloader: `data:text/html;base64,${Buffer.from(`
          <html>
            <body>
              <script>
                const EXPECTED_HASH = "${hash}";
                const TX_ID = "${txId}";
                async function boot() {
                  const response = await fetch('https://gateway.irys.xyz/' + TX_ID);
                  const data = await response.text();
                  const encoder = new TextEncoder();
                  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
                  const actualHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
                  
                  if (actualHash === EXPECTED_HASH) {
                    document.write("<h1>Memoria Capsule Verified</h1><pre>" + data + "</pre>");
                  } else {
                    alert("SECURITY ALERT: Memory capsule tampering detected!");
                  }
                }
                boot();
              </script>
            </body>
          </html>
        `).toString('base64')}`
      };
    } catch (error) {
      console.error('Encapsulation failed:', error);
      throw error;
    }
  }

  private cosineSimilarity(a: number[], b: number[]) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

// Global instance for the prototype (in-memory)
// In production, this would be a real vector database like Pinecone, Weaviate, or pgvector.
export const globalMemoryStore = new MemoryStore();
