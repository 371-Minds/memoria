import Irys from "@irys/sdk";
import { ethers } from "ethers";
import { createHash } from "crypto";

/**
 * Arweave Encapsulation Module (via Irys)
 * This allows "summoning" memories into permanent, blockchain-verified capsules.
 */
export class ArweaveEncapsulator {
  private irys: any = null;

  async init() {
    // In a browser environment, this would use window.ethereum
    // In a server environment (like this Next.js app), we need a private key
    const privateKey = process.env.IRYS_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("IRYS_PRIVATE_KEY is required for Arweave encapsulation.");
    }

    // Initialize Irys (using Polygon/Matic as the payment token)
    // You can change this to 'arweave', 'ethereum', etc.
    // @ts-ignore
    this.irys = new Irys({ 
      network: "mainnet", 
      token: "matic", 
      key: privateKey 
    });
    await this.irys.ready();
  }

  /**
   * Encapsulate memories into a permanent Arweave transaction
   */
  async encapsulate(memories: any[]): Promise<{ txId: string; hash: string }> {
    if (!this.irys) await this.init();

    const content = JSON.stringify(memories);
    
    // 1. Generate SHA-256 Hash for verification
    const hash = createHash('sha256').update(content).digest('hex');

    // 2. Upload to Arweave via Irys
    const tags = [
      { name: "Content-Type", value: "application/json" },
      { name: "App-Name", value: "Memoria-Protocol-CCP" },
      { name: "Verification-Hash", value: hash }
    ];

    const receipt = await this.irys.upload(content, { tags });
    
    return {
      txId: receipt.id,
      hash: hash
    };
  }
}

export const globalEncapsulator = new ArweaveEncapsulator();
