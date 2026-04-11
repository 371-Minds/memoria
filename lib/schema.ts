/**
 * 371 Minds Master Registry Template
 * Used by CORTEX and HubCortex for automated ecosystem harvesting and valuation.
 */
export interface RepoRegistryEntry {
  catalogId: string; // e.g., 371-REPO-CORE-001
  name: string;
  automation_level: 'Legacy_Manual' | 'AI_Assisted' | 'Fully_Autonomous';
  autonomy_target: string; // e.g., "95%"
  strategic: {
    tier: 1 | 2 | 3 | 4;
    priority: number; // 1-10 scale
    dependencies: string[]; 
  };
  economic: {
    monthlyOpsUSD: number;
    akashSavingsUSD: number; // Target: 97.6% reduction
    assetValueUSD: number;
  };
  blockchain: {
    catalogHash: string;
    tokenAllocation: number; // For DAO governance
  };
}
