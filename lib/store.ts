import { createClient } from '@clickhouse/client';
import { MemoryStore as LocalStore, Memory } from './memory-store';

const clickhouseHost = process.env.CLICKHOUSE_HOST;
let chClient: any = null;

if (clickhouseHost) {
  chClient = createClient({
    url: clickhouseHost,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
  });
  
  // Initialize table
  chClient.command({
    query: `
      CREATE TABLE IF NOT EXISTS memories (
        id UUID,
        userId String,
        text String,
        embedding Array(Float32),
        createdAt DateTime64(3)
      ) ENGINE = MergeTree()
      ORDER BY (userId, createdAt)
    `
  }).catch((e: any) => console.error('ClickHouse init error:', e));
}

const localStore = new LocalStore();

export const store = {
  async addMemory(memory: Memory) {
    if (chClient) {
      await chClient.insert({
        table: 'memories',
        values: [{
          id: memory.id,
          userId: memory.userId,
          text: memory.text,
          embedding: memory.embedding,
          createdAt: memory.createdAt
        }],
        format: 'JSONEachRow'
      });
    } else {
      localStore.addMemory(memory);
    }
  },
  async getMemories(userId: string) {
    if (chClient) {
      const rs = await chClient.query({
        query: `SELECT id, userId, text, createdAt FROM memories WHERE userId = {userId:String} ORDER BY createdAt DESC`,
        query_params: { userId }
      });
      const data = await rs.json();
      return data.data;
    } else {
      return localStore.getMemories(userId);
    }
  },
  async search(userId: string, queryEmbedding: number[], topK: number = 3) {
    if (chClient) {
      const rs = await chClient.query({
        query: `
          SELECT id, text, createdAt,
                 cosineDistance(embedding, {embedding:Array(Float32)}) AS distance
          FROM memories
          WHERE userId = {userId:String}
          ORDER BY distance ASC
          LIMIT {topK:UInt32}
        `,
        query_params: { userId, embedding: queryEmbedding, topK }
      });
      const data = await rs.json();
      // Map distance to score (1 - distance)
      return data.data.map((d: any) => ({
        id: d.id,
        text: d.text,
        score: 1 - d.distance,
        createdAt: d.createdAt
      }));
    } else {
      return localStore.search(userId, queryEmbedding, topK);
    }
  },
  async deleteMemory(userId: string, memoryId: string) {
    if (chClient) {
      // ClickHouse mutations are async, but fine for this use case
      await chClient.command({
        query: `ALTER TABLE memories DELETE WHERE userId = {userId:String} AND id = {memoryId:UUID}`,
        query_params: { userId, memoryId }
      });
    } else {
      localStore.deleteMemory(userId, memoryId);
    }
  },
  async updateMemory(userId: string, memoryId: string, text: string, embedding: number[]) {
    if (chClient) {
      await chClient.command({
        query: `ALTER TABLE memories UPDATE text = {text:String}, embedding = {embedding:Array(Float32)} WHERE userId = {userId:String} AND id = {memoryId:UUID}`,
        query_params: { userId, memoryId, text, embedding }
      });
    } else {
      localStore.updateMemory(userId, memoryId, text, embedding);
    }
  }
};
