import fs from 'fs';
import path from 'path';

export type Memory = {
  id: string;
  userId: string;
  text: string;
  embedding: number[];
  createdAt: number;
};

class MemoryStore {
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
    this.memories.push(memory);
    this.save();
  }

  getMemories(userId: string) {
    return this.memories.filter(m => m.userId === userId);
  }

  search(userId: string, queryEmbedding: number[], topK: number = 5) {
    const userMemories = this.getMemories(userId);
    const scored = userMemories.map(m => ({
      ...m,
      score: this.cosineSimilarity(m.embedding, queryEmbedding)
    }));
    
    // Sort by descending score
    scored.sort((a, b) => b.score - a.score);
    
    return scored.slice(0, topK);
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
