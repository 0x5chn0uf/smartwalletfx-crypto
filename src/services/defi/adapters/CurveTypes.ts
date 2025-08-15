/**
 * Curve Protocol Specific Types
 * 
 * Extends the base DeFi types with Curve-specific interfaces and data structures.
 */

import { DeFiToken, LiquidityPosition, RewardToken } from '@/types/defi';
import { ChainId } from '@/types/blockchain';

// Curve Pool Types
export enum CurvePoolType {
  STABLE = 'stable',           // Stablecoin pools (3pool, Y pool, etc.)
  CRYPTO = 'crypto',           // Volatile asset pools (tricrypto, etc.)
  META = 'meta',               // Meta pools (pools that pair with base pools)
  FACTORY = 'factory',         // Factory deployed pools
  LENDING = 'lending',         // Lending pools (compound, aave)
}

// Curve Pool Interface
export interface CurvePool {
  address: string;
  name: string;
  lpToken: string;
  type: CurvePoolType;
  
  // Pool composition
  coins: string[];
  nCoins: number;
  underlying?: string[];        // For meta pools and lending pools
  
  // Pool parameters
  A: bigint;                   // Amplification coefficient
  fee: bigint;                 // Trading fee (4 decimal places)
  adminFee: bigint;            // Admin fee percentage
  virtualPrice: bigint;        // Virtual price of LP token
  
  // Pool state
  balances: bigint[];
  totalSupply: bigint;
  
  // Meta pool specific
  basePool?: string;           // Base pool address for meta pools
  baseLpToken?: string;        // Base pool LP token
  
  // Factory pool specific
  implementation?: string;     // Implementation contract for factory pools
  
  // Timestamps
  createdAt?: Date;
  lastUpdatedAt: Date;
}

// Curve Gauge Interface
export interface CurveGauge {
  address: string;
  lpToken: string;
  
  // Gauge state
  totalSupply: bigint;
  workingSupply: bigint;
  
  // Weights and emissions
  weight: bigint;              // Gauge weight from controller
  relativeWeight: bigint;      // Relative weight for CRV emissions
  inflationRate: bigint;       // CRV inflation rate for this gauge
  
  // Reward tokens
  rewardTokens: string[];
  rewardData: Map<string, {
    rate: bigint;              // Reward rate per second
    periodFinish: Date;        // When reward period ends
    lastUpdateTime: Date;      // Last update timestamp
  }>;
  
  // Kill status
  isKilled: boolean;
  
  // Timestamps
  createdAt?: Date;
  lastUpdatedAt: Date;
}

// User Position in Curve Pool
export interface CurveUserPoolPosition {
  pool: CurvePool;
  
  // LP token holdings
  lpBalance: bigint;
  lpShare: number;             // Percentage of pool owned
  
  // Underlying token balances
  underlyingBalances: {
    token: DeFiToken;
    balance: bigint;
    balanceFormatted: number;
    valueUSD: number;
  }[];
  
  // Position value
  totalValueUSD: number;
  
  // Fees earned (if available)
  feesEarned?: {
    token: DeFiToken;
    amount: bigint;
    valueUSD: number;
  }[];
  
  lastUpdatedAt: Date;
}

// User Position in Curve Gauge
export interface CurveUserGaugePosition {
  gauge: CurveGauge;
  
  // Staked amounts
  stakedBalance: bigint;
  workingBalance: bigint;      // Boosted balance
  
  // Boost information
  boost: number;               // Current boost multiplier (1.0 - 2.5)
  maxBoost: number;            // Maximum possible boost
  
  // Claimable rewards
  claimableRewards: {
    token: DeFiToken;
    amount: bigint;
    amountFormatted: number;
    valueUSD: number;
    apy?: number;              // Estimated APY from this reward
  }[];
  
  // CRV specific
  crvClaimable: bigint;
  crvApy: number;
  
  // Vote escrow related
  veCrvBalance?: bigint;       // veCRV balance affecting boost
  veCrvUnlockTime?: Date;      // When veCRV unlocks
  
  lastUpdatedAt: Date;
}

// Combined Curve Position
export interface CurvePosition extends LiquidityPosition {
  // Curve specific protocol data
  protocolData: {
    poolType: CurvePoolType;
    
    // Pool data
    poolAddress: string;
    A: string;                 // Amplification coefficient
    virtualPrice: string;      // Virtual price
    fee: string;               // Trading fee
    adminFee: string;          // Admin fee
    
    // Gauge data (if staked)
    gaugeAddress?: string;
    stakedBalance?: string;
    workingBalance?: string;
    boost?: number;
    gaugeWeight?: string;
    relativeWeight?: string;
    
    // Meta pool data
    basePool?: string;
    baseLpToken?: string;
    
    // Factory pool data
    implementation?: string;
    
    // Additional metadata
    isFactory: boolean;
    isMetaPool: boolean;
    hasGauge: boolean;
  };
  
  // Curve specific rewards
  crvRewards?: {
    claimable: bigint;
    apy: number;
    boostedApy: number;        // APY with current boost
    maxApy: number;            // APY with max boost
  };
}

// Curve APY Breakdown
export interface CurveApyBreakdown {
  // Base APY from trading fees
  baseApy: number;
  
  // CRV rewards APY
  crvApy: number;
  crvBoostedApy: number;       // With current boost
  crvMaxApy: number;           // With max boost
  
  // Additional reward tokens APY
  rewardApys: {
    token: DeFiToken;
    apy: number;
  }[];
  
  // Total APY
  totalApy: number;
  totalBoostedApy: number;     // With current boost
  totalMaxApy: number;         // With max boost
  
  calculatedAt: Date;
}

// Curve Pool Analytics
export interface CurvePoolAnalytics {
  // Trading activity
  volume24h: number;
  volume7d: number;
  volume30d: number;
  
  // Fee analytics
  fees24h: number;
  fees7d: number;
  fees30d: number;
  
  // TVL analytics
  tvl: number;
  tvlChange24h: number;
  tvlChange7d: number;
  
  // APY analytics
  apy: CurveApyBreakdown;
  apyHistory: {
    timestamp: Date;
    baseApy: number;
    crvApy: number;
    totalApy: number;
  }[];
  
  lastUpdatedAt: Date;
}

// Curve Factory Pool Creation
export interface CurveFactoryPoolParams {
  name: string;
  symbol: string;
  coins: string[];
  A: number;                   // Amplification coefficient
  fee: number;                 // Trading fee (4 decimal places)
  assetTypes: number[];        // Asset types (0 = standard, 1 = oracle, etc.)
  implementationIdx: number;   // Implementation index
  
  // Meta pool specific
  basePool?: string;
  
  // Oracle specific
  oracleAddresses?: string[];
  oracleMethods?: string[];
}

// Curve Vote Escrow Position
export interface CurveVePosition {
  // veCRV holdings
  balance: bigint;
  balanceFormatted: number;
  
  // Lock information
  lockEnd: Date;
  lockDuration: number;        // Days remaining
  
  // Voting power
  votingPower: number;
  totalVotingPower: number;
  votingPowerShare: number;    // Percentage of total
  
  // Boost information
  maxBoost: number;            // Maximum boost this veCRV provides
  currentUtilization: number;  // How much boost is being used
  
  // Fee sharing
  claimableFees: {
    token: DeFiToken;
    amount: bigint;
    valueUSD: number;
  }[];
  
  lastUpdatedAt: Date;
}

// Curve Governance Proposal
export interface CurveProposal {
  id: string;
  title: string;
  description: string;
  
  // Voting details
  startTime: Date;
  endTime: Date;
  quorum: bigint;
  
  // Vote counts
  votesFor: bigint;
  votesAgainst: bigint;
  totalVotes: bigint;
  
  // Proposal status
  status: 'pending' | 'active' | 'succeeded' | 'failed' | 'executed';
  
  // User vote (if any)
  userVote?: {
    choice: 'for' | 'against';
    power: bigint;
    timestamp: Date;
  };
  
  createdAt: Date;
}

// Curve Protocol Summary
export interface CurveProtocolSummary {
  // Total metrics
  totalTvl: number;
  totalVolume24h: number;
  totalFees24h: number;
  
  // Pool counts
  totalPools: number;
  activePools: number;
  factoryPools: number;
  metaPools: number;
  
  // Token metrics
  crvPrice: number;
  crvSupply: bigint;
  crvMarketCap: number;
  
  // veCRV metrics
  totalVeCrv: bigint;
  averageLockTime: number;
  
  // Top pools
  topPoolsByTvl: {
    pool: CurvePool;
    tvl: number;
    apy: number;
  }[];
  
  topPoolsByVolume: {
    pool: CurvePool;
    volume24h: number;
    fees24h: number;
  }[];
  
  lastUpdatedAt: Date;
}

// Curve API Response Types
export interface CurveApiPool {
  address: string;
  name: string;
  symbol: string;
  coins: {
    address: string;
    symbol: string;
    decimals: number;
  }[];
  totalSupply: string;
  virtualPrice: string;
  A: string;
  fee: string;
  adminFee: string;
  
  // Analytics
  volumeUSD: string;
  totalSupplyUSD: string;
  
  // Gauge info
  gauge?: {
    address: string;
    weight: string;
    relativeWeight: string;
    emissions: string;
  };
}

export interface CurveApiGauge {
  address: string;
  lpToken: string;
  weight: string;
  relativeWeight: string;
  emissions: string;
  isKilled: boolean;
  
  rewardTokens?: {
    address: string;
    symbol: string;
    rate: string;
    periodFinish: string;
  }[];
}

// Curve Subgraph Response Types
export interface CurveSubgraphPool {
  id: string;
  name: string;
  lpToken: string;
  coins: string[];
  balances: string[];
  A: string;
  fee: string;
  adminFee: string;
  virtualPrice: string;
  
  dailySnapshots: {
    timestamp: string;
    totalSupply: string;
    totalSupplyUSD: string;
    volumeUSD: string;
  }[];
}

// Error Types
export class CurveError extends Error {
  constructor(
    message: string,
    public readonly code: CurveErrorCode,
    public readonly context?: Record<string, any>
  ) {
    super(message);
    this.name = 'CurveError';
  }
}

export enum CurveErrorCode {
  POOL_NOT_FOUND = 'POOL_NOT_FOUND',
  GAUGE_NOT_FOUND = 'GAUGE_NOT_FOUND',
  INVALID_POOL_TYPE = 'INVALID_POOL_TYPE',
  INSUFFICIENT_LIQUIDITY = 'INSUFFICIENT_LIQUIDITY',
  SLIPPAGE_EXCEEDED = 'SLIPPAGE_EXCEEDED',
  ORACLE_ERROR = 'ORACLE_ERROR',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  CONTRACT_CALL_FAILED = 'CONTRACT_CALL_FAILED',
}

// Constants
export const CURVE_CONSTANTS = {
  // CRV token addresses by chain
  CRV_TOKEN: {
    [ChainId.ETHEREUM]: '0xD533a949740bb3306d119CC777fa900bA034cd52',
    [ChainId.POLYGON]: '0x172370d5Cd63279eFa6d502DAB29171933a610AF',
    [ChainId.ARBITRUM]: '0x11cDb42B0EB46D95f990BeDD4695A6e3fA034978',
    [ChainId.OPTIMISM]: '0x0994206dfE8De6Ec6920FF4d779B0d950605fb53',
  },
  
  // Well-known pool addresses
  WELL_KNOWN_POOLS: {
    [ChainId.ETHEREUM]: {
      THREE_POOL: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7',
      TRICRYPTO2: '0xD51a44d3FaE010294C616388b506AcdA1bfAAE46',
      STETH_ETH: '0xDC24316b9AE028F1497c275EB9192a3Ea0f67022',
      FRAX_USDC: '0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2',
    }
  },
  
  // Boost parameters
  BOOST: {
    MIN_BOOST: 1.0,
    MAX_BOOST: 2.5,
    BOOST_WARMUP: 86400 * 7,     // 7 days in seconds
  },
  
  // Fee parameters
  FEES: {
    MAX_FEE: 5000,               // 0.5% in basis points
    MAX_ADMIN_FEE: 10000,        // 100% of fees
    DEFAULT_FEE: 400,            // 0.04%
  },
  
  // API endpoints
  API_ENDPOINTS: {
    CURVE_API: 'https://api.curve.fi/api',
    CURVE_SUBGRAPH: 'https://api.thegraph.com/subgraphs/name/curvefi/curve',
  },
} as const;

// Utility Types
export type CurveChainId = ChainId.ETHEREUM | ChainId.POLYGON | ChainId.ARBITRUM | ChainId.OPTIMISM;

export type CurvePoolFilter = {
  type?: CurvePoolType;
  minTvl?: number;
  maxTvl?: number;
  minApy?: number;
  maxApy?: number;
  hasGauge?: boolean;
  isFactory?: boolean;
  coinAddress?: string;
};

export type CurvePositionFilter = {
  minValue?: number;
  poolType?: CurvePoolType;
  hasRewards?: boolean;
  isStaked?: boolean;
};