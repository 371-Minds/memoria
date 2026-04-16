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
        mref String,
        userId String,
        text String,
        mediaUrl String,
        mediaType String,
        actionPayload String,
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
          mref: memory.mref,
          userId: memory.userId,
          text: memory.text || '',
          mediaUrl: memory.mediaUrl || '',
          mediaType: memory.mediaType || '',
          actionPayload: memory.actionPayload ? JSON.stringify(memory.actionPayload) : '',
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
        query: `SELECT id, mref, userId, text, mediaUrl, mediaType, actionPayload, createdAt FROM memories WHERE userId = {userId:String} ORDER BY createdAt DESC`,
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
          SELECT id, mref, text, mediaUrl, mediaType, actionPayload, createdAt,
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
        mref: d.mref,
        text: d.text,
        mediaUrl: d.mediaUrl,
        mediaType: d.mediaType,
        actionPayload: d.actionPayload ? JSON.parse(d.actionPayload) : undefined,
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
  async updateMemory(userId: string, memoryId: string, text: string, embedding: number[], mediaUrl?: string, mediaType?: string, actionPayload?: any) {
    if (chClient) {
      await chClient.command({
        query: `ALTER TABLE memories UPDATE text = {text:String}, mediaUrl = {mediaUrl:String}, mediaType = {mediaType:String}, actionPayload = {actionPayload:String}, embedding = {embedding:Array(Float32)} WHERE userId = {userId:String} AND id = {memoryId:UUID}`,
        query_params: { userId, memoryId, text, mediaUrl: mediaUrl || '', mediaType: mediaType || '', actionPayload: actionPayload ? JSON.stringify(actionPayload) : '', embedding }
      });
    } else {
      localStore.updateMemory(userId, memoryId, text, embedding, mediaUrl, mediaType, actionPayload);
    }
  },
  async encapsulate(userId: string) {
    if (chClient) {
      throw new Error("Encapsulation via GitMind is currently managed locally.");
    }
    return localStore.encapsulate(userId);
  }
};
