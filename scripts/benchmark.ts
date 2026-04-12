import { MemoryStore } from '../lib/memory-store';
import fs from 'fs';
import path from 'path';

async function runBenchmark() {
  console.log('🚀 Starting Memoria Core Benchmark...\n');
  
  // Use a temporary data file for the benchmark
  const dataPath = path.join(process.cwd(), 'data', 'memories.json');
  
  const store = new MemoryStore();
  const userId = 'benchmark_user_' + Date.now();
  const numMemories = 10000; // Test with 10k memories
  const vectorDim = 768; // Gemini embedding dimension

  console.log(`📊 1. Testing Insertion & TurboQuant Compression (${numMemories} vectors)...`);
  const startTime = performance.now();
  
  for (let i = 0; i < numMemories; i++) {
    // Generate a random 768-dimensional vector (simulating a Gemini embedding)
    const embedding = Array.from({ length: vectorDim }, () => Math.random() * 2 - 1);
    
    store.addMemory({
      id: `mem_${i}`,
      mref: `mref_${Math.random().toString(36).substring(2, 8)}`,
      userId,
      text: `This is a simulated memory payload for benchmark testing. ID: ${i}`,
      embedding,
      createdAt: Date.now()
    });
  }
  
  const insertTime = performance.now() - startTime;
  console.log(`✅ Inserted ${numMemories} memories in ${insertTime.toFixed(2)}ms`);
  console.log(`⚡ Insert speed: ${(numMemories / (insertTime / 1000)).toFixed(2)} ops/sec\n`);

  console.log(`🔍 2. Testing Semantic Search Latency...`);
  const queryVector = Array.from({ length: vectorDim }, () => Math.random() * 2 - 1);
  
  const searchStart = performance.now();
  const results = store.search(userId, queryVector, 5);
  const searchTime = performance.now() - searchStart;
  
  console.log(`✅ Top-5 Search completed in ${searchTime.toFixed(2)}ms`);
  console.log(`🎯 Found ${results.length} results.\n`);
  
  console.log(`💾 3. Testing Storage Efficiency...`);
  if (fs.existsSync(dataPath)) {
    const stats = fs.statSync(dataPath);
    const sizeMB = stats.size / (1024 * 1024);
    const sizePerMemory = stats.size / numMemories;
    
    console.log(`📦 Total Disk Size for ${numMemories} memories: ${sizeMB.toFixed(2)} MB`);
    console.log(`🔬 Average Size per Memory: ${sizePerMemory.toFixed(2)} bytes`);
    
    // Compare against raw uncompressed JSON arrays
    const rawFloatSize = vectorDim * 8; // 8 bytes per float64 in JS
    console.log(`📉 Compression Ratio vs Raw Floats: ~${((sizePerMemory / rawFloatSize) * 100).toFixed(1)}% of original size`);
  }

  console.log('\n✨ Benchmark Complete.');
}

runBenchmark().catch(console.error);
