/**
 * Compound V3 specific types and interfaces
 *
 * Contains all the specialized data structures used by the Compound V3 protocol adapter.
 */

import { ChainId } from './blockchain';
import { DeFiToken, RewardToken } from './defi';

// Compound V3 Market Configuration
export interface CompoundV3Market {
  chainId: ChainId;
  market: string; // e.g., 'USDC', 'WETH'
  comet: string; // Comet contract address
  baseToken: string; // Base asset address
  name: string; // Human-readable name
  description?: string;
}

// Asset information from Comet contract
export interface CompoundV3AssetInfo {
  offset: number;
  asset: string; // Token address
  priceFeed: string; // Chainlink price feed address
  scale: bigint; // Scaling factor for the asset
  borrowCollateralFactor: bigint; // Collateral factor for borrowing (in wei)
  liquidateCollateralFactor: bigint; // Liquidation threshold (in wei)
  liquidationFactor: bigint; // Liquidation penalty (in wei)
  supplyCap: bigint; // Maximum supply allowed (in asset units)
}

// User's account data in a specific Compound V3 market
export interface CompoundV3AccountData {
  market: string;
  baseBalance: bigint; // Positive = supplied, Negative = borrowed
  borrowBalance: bigint; // Always positive, represents borrowed amount
  collateralBalances: Array<{
    asset: string;
    balance: bigint;
    assetInfo: CompoundV3AssetInfo;
    token: DeFiToken;
    valueUSD: number;
  }>;
  isLiquidatable: boolean;
  liquidationThreshold: bigint;
  healthFactor?: number;
}

// Market-level information
export interface CompoundV3MarketInfo {
  comet: string;
  baseToken: string;
  baseSymbol: string;
  baseName: string;
  baseDecimals: number;
  baseScale: bigint;

  // Interest rates (per second, in wei)
  supplyRate: bigint;
  borrowRate: bigint;

  // Market metrics
  utilization: bigint; // Utilization rate (in wei, 1e18 = 100%)
  totalSupply: bigint; // Total supplied (in base token units)
  totalBorrow: bigint; // Total borrowed (in base token units)

  // Asset information
  assets: CompoundV3AssetInfo[];

  // Rewards configuration
  baseMinForRewards: bigint; // Minimum balance to earn rewards
  baseTrackingSupplySpeed: bigint; // Supply reward rate
  baseTrackingBorrowSpeed: bigint; // Borrow reward rate
}

// Reward information for a user
export interface CompoundV3RewardInfo {
  market: string;
  cometAddress: string;
  rewardToken: DeFiToken;

  // Claimable rewards
  claimableAmount: bigint;
  claimableAmountFormatted: string;
  claimableValueUSD: number;

  // Historical rewards
  totalClaimed: bigint;
  totalClaimedFormatted: string;
  totalClaimedValueUSD: number;

  // Reward configuration
  rescaleFactor: bigint;
  shouldUpscale: boolean;

  // Estimated future rewards (optional)
  estimatedDailyRewards?: number;
  estimatedAPR?: number;
}

// Liquidation information
export interface CompoundV3LiquidationInfo {
  isLiquidatable: boolean;
  healthFactor?: number;
  liquidationPrice?: number; // Price at which liquidation would occur
  collateralRatio: number; // Current collateral ratio
  requiredCollateralRatio: number; // Minimum required ratio
  liquidationPenalty: number; // Penalty percentage if liquidated
  timeToLiquidation?: number; // Estimated seconds until liquidation (if applicable)
}

// Position summary combining all data
export interface CompoundV3PositionSummary {
  address: string;
  chainId: ChainId;
  market: string;

  // Account balances
  account: CompoundV3AccountData;

  // Market information
  marketInfo: CompoundV3MarketInfo;

  // Rewards
  rewards: CompoundV3RewardInfo[];

  // Risk assessment
  liquidation: CompoundV3LiquidationInfo;

  // Calculated values
  totalSuppliedUSD: number;
  totalBorrowedUSD: number;
  totalCollateralUSD: number;
  netWorthUSD: number;

  // APY information
  supplyAPY: number;
  borrowAPY: number;
  netAPY: number; // Net APY considering both supply and borrow

  // Timestamps
  lastUpdated: Date;
  blockNumber?: number;
}

// API response wrapper for Compound V3 operations
export interface CompoundV3ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata: {
    market?: string;
    chainId: ChainId;
    blockNumber?: number;
    timestamp: number;
    cacheHit?: boolean;
  };
}

// Compound V3 specific events and state changes
export enum CompoundV3EventType {
  SUPPLY = 'supply',
  WITHDRAW = 'withdraw',
  BORROW = 'borrow',
  REPAY = 'repay',
  LIQUIDATION = 'liquidation',
  REWARD_CLAIM = 'reward_claim',
  COLLATERAL_DEPOSIT = 'collateral_deposit',
  COLLATERAL_WITHDRAW = 'collateral_withdraw',
}

export interface CompoundV3Event {
  type: CompoundV3EventType;
  market: string;
  user: string;
  asset: string;
  amount: bigint;
  amountUSD: number;
  txHash: string;
  blockNumber: number;
  timestamp: Date;
  gasUsed?: number;
  gasPrice?: bigint;
}

// Configuration for Compound V3 adapter
export interface CompoundV3Config {
  // Contract addresses by chain
  contracts: Record<
    ChainId,
    {
      markets: Record<string, CompoundV3Market>;
      cometRewards: string;
      subgraphUrl: string;
    }
  >;

  // Adapter settings
  settings: {
    // Cache settings
    positionCacheTTL: number;
    marketDataCacheTTL: number;
    rewardsCacheTTL: number;

    // Rate limiting
    maxRequestsPerSecond: number;
    requestTimeout: number;

    // Health check settings
    healthCheckInterval: number;
    maxRetries: number;

    // Minimum values
    dustThresholdUSD: number;
    minPositionValueUSD: number;
  };

  // Feature flags
  features: {
    enableRewards: boolean;
    enableLiquidationMonitoring: boolean;
    enableEventTracking: boolean;
    enableAdvancedMetrics: boolean;
  };
}

// Utility types for Compound V3 calculations
export interface CompoundV3MathUtils {
  // Convert rates
  secondsPerYear: number;

  // Convert rate per second to APY
  rateToAPY(ratePerSecond: bigint): number;

  // Calculate health factor
  calculateHealthFactor(
    totalCollateralUSD: number,
    totalBorrowUSD: number,
    liquidationThreshold: number
  ): number;

  // Calculate liquidation price
  calculateLiquidationPrice(
    collateralAmount: number,
    borrowAmount: number,
    collateralPrice: number,
    liquidationThreshold: number
  ): number;

  // Convert scaled balance using index
  calculateActualBalance(scaledBalance: bigint, index: bigint, decimals: number): number;
}

// Constants
export const COMPOUND_V3_CONSTANTS = {
  // Standard decimal precision
  WAD: BigInt('1000000000000000000'), // 1e18
  RAY: BigInt('1000000000000000000000000000'), // 1e27

  // Compound V3 specific
  SCALE_FACTOR: BigInt('1000000000000000000'), // 1e18
  BASIS_POINTS: 10000,
  SECONDS_PER_YEAR: 365.25 * 24 * 60 * 60,

  // Default values
  DEFAULT_HEALTH_FACTOR_THRESHOLD: 1.0,
  LIQUIDATION_WARNING_THRESHOLD: 1.1,
  CRITICAL_THRESHOLD: 1.05,

  // Network-specific settings
  ETHEREUM_BLOCK_TIME: 12, // seconds
  POLYGON_BLOCK_TIME: 2.3, // seconds
  ARBITRUM_BLOCK_TIME: 0.26, // seconds
} as const;

export default CompoundV3Config;
