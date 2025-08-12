import { z } from 'zod';
import { ChainId } from './blockchain';

// Core DeFi position types
export enum DeFiProtocol {
  AAVE_V3 = 'aave-v3',
  COMPOUND_V3 = 'compound-v3',
  UNISWAP_V3 = 'uniswap-v3',
  CURVE = 'curve',
  YEARN = 'yearn',
  CONVEX = 'convex',
  MAKER_DAO = 'makerdao',
  LIDO = 'lido',
  ROCKET_POOL = 'rocket-pool',
  BALANCER = 'balancer',
}

export enum PositionType {
  LENDING = 'lending',
  BORROWING = 'borrowing',
  LIQUIDITY_POOL = 'liquidity_pool',
  STAKING = 'staking',
  YIELD_FARMING = 'yield_farming',
  VAULT = 'vault',
  CDP = 'cdp', // Collateralized Debt Position
  INSURANCE = 'insurance',
}

export enum PositionStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  AT_RISK = 'at_risk',
  LIQUIDATED = 'liquidated',
  CLOSED = 'closed',
}

export enum RiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

// Token information for DeFi positions
export interface DeFiToken {
  address: string;
  chainId: ChainId;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
  priceUSD?: number;
  isStable?: boolean;
}

// Yield/APY information
export interface YieldInfo {
  apy: number; // Annual Percentage Yield
  apr: number; // Annual Percentage Rate
  dailyRate?: number;
  source: 'lending' | 'farming' | 'staking' | 'fees' | 'rewards';
  isCompounding: boolean;
  calculatedAt: Date;
}

// Reward token information
export interface RewardToken {
  token: DeFiToken;
  amount: string;
  amountFormatted: string;
  valueUSD?: number;
  apy?: number;
  vesting?: {
    isVesting: boolean;
    vestingPeriod?: number; // seconds
    claimableAt?: Date;
  };
}

// Risk metrics for positions
export interface RiskMetrics {
  healthFactor?: number; // Lending protocols
  liquidationPrice?: number;
  liquidationRisk: RiskLevel;
  collateralRatio?: number;
  utilizationRate?: number;
  timeToLiquidation?: number; // seconds
  impermanentLoss?: number; // for LP positions
}

// Base DeFi position interface
export interface DeFiPosition {
  id: string;
  protocol: DeFiProtocol;
  chainId: ChainId;
  type: PositionType;
  status: PositionStatus;
  
  // Position details
  name: string;
  description?: string;
  url?: string; // Protocol URL
  
  // Assets
  suppliedTokens: Array<{
    token: DeFiToken;
    amount: string;
    amountFormatted: string;
    valueUSD?: number;
  }>;
  
  borrowedTokens?: Array<{
    token: DeFiToken;
    amount: string;
    amountFormatted: string;
    valueUSD?: number;
  }>;
  
  // Financial metrics
  totalValueUSD: number;
  netValueUSD: number; // Total supplied - total borrowed
  yieldInfo?: YieldInfo[];
  rewards?: RewardToken[];
  
  // Risk assessment
  riskMetrics: RiskMetrics;
  
  // Metadata
  createdAt: Date;
  lastUpdatedAt: Date;
  lastActivityAt?: Date;
  
  // Protocol-specific data
  protocolData: Record<string, any>;
}

// Specific position type implementations
export interface LendingPosition extends DeFiPosition {
  type: PositionType.LENDING;
  collateralTokens: Array<{
    token: DeFiToken;
    amount: string;
    amountFormatted: string;
    valueUSD?: number;
    isCollateral: boolean;
  }>;
  borrowingPower: {
    totalBorrowingPowerUSD: number;
    usedBorrowingPowerUSD: number;
    availableBorrowingPowerUSD: number;
  };
}

export interface LiquidityPosition extends DeFiPosition {
  type: PositionType.LIQUIDITY_POOL;
  poolInfo: {
    poolAddress: string;
    poolName: string;
    fee?: number; // Pool fee percentage
    totalLiquidity?: number;
    volume24h?: number;
  };
  lpTokens: {
    address: string;
    amount: string;
    totalSupply?: string;
    share?: number; // Percentage of pool owned
  };
  fees?: {
    collected24h?: number;
    collectedTotal?: number;
    pendingFees?: Array<{
      token: DeFiToken;
      amount: string;
      valueUSD?: number;
    }>;
  };
}

export interface StakingPosition extends DeFiPosition {
  type: PositionType.STAKING;
  stakingInfo: {
    stakedAmount: string;
    stakedAmountFormatted: string;
    stakedValueUSD: number;
    unbondingPeriod?: number; // seconds
    isUnbonding?: boolean;
    unbondingAmount?: string;
    unbondingCompletionDate?: Date;
  };
  validator?: {
    address: string;
    name?: string;
    commission?: number;
    votingPower?: number;
  };
}

// Portfolio aggregation types
export interface DeFiPortfolioSummary {
  address: string;
  totalValueUSD: number;
  netValueUSD: number;
  totalSuppliedUSD: number;
  totalBorrowedUSD: number;
  totalRewardsUSD: number;
  
  // Distribution by protocol
  protocolDistribution: Array<{
    protocol: DeFiProtocol;
    valueUSD: number;
    percentage: number;
    positionCount: number;
  }>;
  
  // Distribution by chain
  chainDistribution: Array<{
    chainId: ChainId;
    valueUSD: number;
    percentage: number;
    positionCount: number;
  }>;
  
  // Distribution by position type
  typeDistribution: Array<{
    type: PositionType;
    valueUSD: number;
    percentage: number;
    positionCount: number;
  }>;
  
  // Risk summary
  riskSummary: {
    overallRisk: RiskLevel;
    positionsAtRisk: number;
    totalCollateralUSD: number;
    averageHealthFactor?: number;
    liquidationThreshold?: number;
  };
  
  // Yield summary
  yieldSummary: {
    totalYieldUSD24h: number;
    totalYieldUSDLifetime: number;
    averageAPY: number;
    bestPerformingPosition?: string;
    worstPerformingPosition?: string;
  };
  
  positions: DeFiPosition[];
  lastUpdated: Date;
}

// Protocol adapter interface
export interface ProtocolAdapter {
  readonly protocol: DeFiProtocol;
  readonly supportedChains: ChainId[];
  readonly version: string;
  
  // Health check
  isHealthy(): Promise<boolean>;
  getHealth(): ProtocolHealth;
  
  // Position fetching
  getPositions(address: string, chainId?: ChainId): Promise<DeFiPosition[]>;
  getPosition(positionId: string, chainId: ChainId): Promise<DeFiPosition | null>;
  
  // Real-time updates
  subscribeToUpdates?(address: string, callback: (position: DeFiPosition) => void): Promise<string>;
  unsubscribeFromUpdates?(subscriptionId: string): Promise<void>;
  
  // Utility methods
  estimateGasCosts?(action: string, params: any): Promise<number>;
  getProtocolMetadata(): ProtocolMetadata;
}

export interface ProtocolHealth {
  isHealthy: boolean;
  lastCheckedAt: Date;
  responseTime?: number;
  errorRate: number;
  uptime: number;
  issues?: string[];
}

export interface ProtocolMetadata {
  name: string;
  description: string;
  website: string;
  logoUrl: string;
  tvlUSD?: number;
  supportedAssets: string[];
  features: string[];
}

// API Response types
export interface DeFiApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata: {
    provider: string;
    timestamp: number;
    requestId: string;
    cacheHit?: boolean;
    executionTime?: number;
  };
}

// Validation schemas
export const DeFiTokenSchema = z.object({
  address: z.string().min(1),
  chainId: z.nativeEnum(ChainId),
  symbol: z.string().min(1),
  name: z.string().min(1),
  decimals: z.number().min(0).max(18),
  logoUrl: z.string().url().optional(),
  priceUSD: z.number().positive().optional(),
  isStable: z.boolean().optional(),
});

export const YieldInfoSchema = z.object({
  apy: z.number(),
  apr: z.number(),
  dailyRate: z.number().optional(),
  source: z.enum(['lending', 'farming', 'staking', 'fees', 'rewards']),
  isCompounding: z.boolean(),
  calculatedAt: z.date(),
});

export const RiskMetricsSchema = z.object({
  healthFactor: z.number().positive().optional(),
  liquidationPrice: z.number().positive().optional(),
  liquidationRisk: z.nativeEnum(RiskLevel),
  collateralRatio: z.number().positive().optional(),
  utilizationRate: z.number().min(0).max(1).optional(),
  timeToLiquidation: z.number().positive().optional(),
  impermanentLoss: z.number().optional(),
});

export const DeFiPositionSchema = z.object({
  id: z.string().min(1),
  protocol: z.nativeEnum(DeFiProtocol),
  chainId: z.nativeEnum(ChainId),
  type: z.nativeEnum(PositionType),
  status: z.nativeEnum(PositionStatus),
  name: z.string().min(1),
  description: z.string().optional(),
  url: z.string().url().optional(),
  suppliedTokens: z.array(z.object({
    token: DeFiTokenSchema,
    amount: z.string(),
    amountFormatted: z.string(),
    valueUSD: z.number().optional(),
  })),
  borrowedTokens: z.array(z.object({
    token: DeFiTokenSchema,
    amount: z.string(),
    amountFormatted: z.string(),
    valueUSD: z.number().optional(),
  })).optional(),
  totalValueUSD: z.number(),
  netValueUSD: z.number(),
  yieldInfo: z.array(YieldInfoSchema).optional(),
  riskMetrics: RiskMetricsSchema,
  createdAt: z.date(),
  lastUpdatedAt: z.date(),
  lastActivityAt: z.date().optional(),
  protocolData: z.record(z.any()),
});

// Constants
export const PROTOCOL_CONFIGS: Record<DeFiProtocol, {
  name: string;
  website: string;
  logoUrl: string;
  supportedChains: ChainId[];
  category: string;
}> = {
  [DeFiProtocol.AAVE_V3]: {
    name: 'Aave V3',
    website: 'https://aave.com',
    logoUrl: 'https://cryptologos.cc/logos/aave-aave-logo.png',
    supportedChains: [ChainId.ETHEREUM, ChainId.POLYGON, ChainId.ARBITRUM, ChainId.OPTIMISM],
    category: 'Lending',
  },
  [DeFiProtocol.COMPOUND_V3]: {
    name: 'Compound V3',
    website: 'https://compound.finance',
    logoUrl: 'https://cryptologos.cc/logos/compound-comp-logo.png',
    supportedChains: [ChainId.ETHEREUM, ChainId.POLYGON, ChainId.ARBITRUM],
    category: 'Lending',
  },
  [DeFiProtocol.UNISWAP_V3]: {
    name: 'Uniswap V3',
    website: 'https://uniswap.org',
    logoUrl: 'https://cryptologos.cc/logos/uniswap-uni-logo.png',
    supportedChains: [ChainId.ETHEREUM, ChainId.POLYGON, ChainId.ARBITRUM, ChainId.OPTIMISM, ChainId.BASE],
    category: 'DEX',
  },
  [DeFiProtocol.CURVE]: {
    name: 'Curve Finance',
    website: 'https://curve.fi',
    logoUrl: 'https://cryptologos.cc/logos/curve-dao-token-crv-logo.png',
    supportedChains: [ChainId.ETHEREUM, ChainId.POLYGON, ChainId.ARBITRUM, ChainId.OPTIMISM],
    category: 'DEX',
  },
  [DeFiProtocol.YEARN]: {
    name: 'Yearn Finance',
    website: 'https://yearn.fi',
    logoUrl: 'https://cryptologos.cc/logos/yearn-finance-yfi-logo.png',
    supportedChains: [ChainId.ETHEREUM, ChainId.POLYGON, ChainId.ARBITRUM, ChainId.OPTIMISM],
    category: 'Yield Farming',
  },
  [DeFiProtocol.CONVEX]: {
    name: 'Convex Finance',
    website: 'https://convexfinance.com',
    logoUrl: 'https://cryptologos.cc/logos/convex-finance-cvx-logo.png',
    supportedChains: [ChainId.ETHEREUM],
    category: 'Yield Farming',
  },
  [DeFiProtocol.MAKER_DAO]: {
    name: 'MakerDAO',
    website: 'https://makerdao.com',
    logoUrl: 'https://cryptologos.cc/logos/maker-mkr-logo.png',
    supportedChains: [ChainId.ETHEREUM],
    category: 'CDP',
  },
  [DeFiProtocol.LIDO]: {
    name: 'Lido',
    website: 'https://lido.fi',
    logoUrl: 'https://cryptologos.cc/logos/lido-dao-ldo-logo.png',
    supportedChains: [ChainId.ETHEREUM, ChainId.POLYGON, ChainId.OPTIMISM],
    category: 'Staking',
  },
  [DeFiProtocol.ROCKET_POOL]: {
    name: 'Rocket Pool',
    website: 'https://rocketpool.net',
    logoUrl: 'https://cryptologos.cc/logos/rocket-pool-rpl-logo.png',
    supportedChains: [ChainId.ETHEREUM],
    category: 'Staking',
  },
  [DeFiProtocol.BALANCER]: {
    name: 'Balancer',
    website: 'https://balancer.fi',
    logoUrl: 'https://cryptologos.cc/logos/balancer-bal-logo.png',
    supportedChains: [ChainId.ETHEREUM, ChainId.POLYGON, ChainId.ARBITRUM],
    category: 'DEX',
  },
};