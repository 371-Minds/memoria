import { createHash } from 'crypto';

/**
 * GitMind Encapsulation
 * Computes a Merkle-like root (SHA-256) of the agent's memory to establish 
 * cryptographic provenance and timeline permanence, without the overhead of 
 * heavy Web3 SDKs. This integrates natively with the Docusaurus Agent's Git history.
 */
export class GitMindEncapsulator {
  
  /**
   * Generates a deterministic hash representing the exact state of the agent's brain.
   * This is equivalent to a Git commit hash for the memory array.
   */
  async encapsulate(memories: any[]): Promise<{ commitHash: string, timestamp: number }> {
    // Sort memories by ID to ensure deterministic hashing
    const sortedMemories = [...memories].sort((a, b) => a.id.localeCompare(b.id));
    
    // Create a payload that mimics a Git tree object
    const payload = JSON.stringify({
      agent_version: "1.0",
      memories: sortedMemories
    });
    
    const commitHash = createHash('sha256').update(payload).digest('hex');
    
    return {
      commitHash,
      timestamp: Date.now()
    };
  }
}

export const gitMind = new GitMindEncapsulator();
