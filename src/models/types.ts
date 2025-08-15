// Database Model Types
// Extended types and interfaces for database operations

import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { 
  TransactionCreateSchema, 
  TransactionUpdateSchema 
} from './validators';

// Import validation schemas
const CuidSchema = z.string().cuid('Invalid ID format');
const ChainIdSchema = z.string().min(1, 'Chain ID is required');

// ============================================================================
// NOTE: Validation schemas are now imported from validators.ts
// ============================================================================

// Transaction Query Options
export interface TransactionQueryOptions extends QueryOptions {
  walletId?: string;
  chainId?: string;
  status?: string;
  type?: string;
  category?: string;
  from?: string;
  to?: string;
  minValue?: number;
  maxValue?: number;
  fromDate?: Date;
  toDate?: Date;
  includeTokenTransfers?: boolean;
}

// ============================================================================
// EXTENDED MODEL TYPES
// ============================================================================

// User Wallet with relations
export type UserWalletWithRelations = Prisma.UserWalletGetPayload<{
  include: {
    portfolios: true;
    defiPositions: true;
    nftTokens: true;
    transactions: true;
    tokenBalances: {
      include: {
        token: true;
      };
    };
  };
}>;

// Token with price cache
export type TokenWithPrice = Prisma.TokenGetPayload<{
  include: {
    priceCache: {
      where: {
        expiresAt: {
          gt: Date;
        };
      };
      orderBy: {
        updatedAt: 'desc';
      };
      take: 1;
    };
  };
}>;

// Portfolio with token balances
export type PortfolioWithBalances = Prisma.PortfolioGetPayload<{
  include: {
    wallet: {
      include: {
        tokenBalances: {
          include: {
            token: true;
          };
        };
      };
    };
  };
}>;

// DeFi Position with all relations
export type DeFiPositionWithRelations = Prisma.DeFiPositionGetPayload<{
  include: {
    suppliedTokens: {
      include: {
        defiToken: {
          include: {
            token: true;
          };
        };
      };
    };
    borrowedTokens: {
      include: {
        defiToken: {
          include: {
            token: true;
          };
        };
      };
    };
    collateralTokens: {
      include: {
        defiToken: {
          include: {
            token: true;
          };
        };
      };
    };
    rewards: {
      include: {
        defiToken: {
          include: {
            token: true;
          };
        };
      };
    };
    yieldInfo: true;
    wallet: true;
  };
}>;

// NFT Token with collection and ownership
export type NFTTokenWithRelations = Prisma.NFTTokenGetPayload<{
  include: {
    collection: true;
    ownership: {
      orderBy: {
        acquiredAt: 'desc';
      };
    };
    listings: {
      where: {
        status: 'active';
      };
    };
    wallet: true;
  };
}>;

// NFT Collection with stats
export type NFTCollectionWithStats = Prisma.NFTCollectionGetPayload<{
  include: {
    nftTokens: {
      take: 1;
      select: {
        id: true;
      };
    };
    _count: {
      select: {
        nftTokens: true;
        listings: true;
      };
    };
  };
}>;

// Transaction with token transfers
export type TransactionWithTransfers = Prisma.TransactionGetPayload<{
  include: {
    tokenTransfers: {
      include: {
        token: true;
      };
    };
    wallet: true;
  };
}>;

// ============================================================================
// QUERY OPTIONS TYPES
// ============================================================================

// Common query options
export interface QueryOptions {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  includeDeleted?: boolean;
}

// Portfolio query options
export interface PortfolioQueryOptions extends QueryOptions {
  chainIds?: string[];
  minValue?: number;
  maxValue?: number;
  includeEmptyBalances?: boolean;
}

// DeFi position query options
export interface DeFiPositionQueryOptions extends QueryOptions {
  protocols?: string[];
  types?: string[];
  statuses?: string[];
  chainIds?: string[];
  minValue?: number;
  maxValue?: number;
  riskLevels?: string[];
}

// NFT query options
export interface NFTQueryOptions extends QueryOptions {
  collections?: string[];
  categories?: string[];
  chainIds?: string[];
  chainId?: string;
  minPrice?: number;
  maxPrice?: number;
  isListed?: boolean;
  rarityTiers?: string[];
  walletId?: string;
  collectionId?: string;
  category?: string;
  rarityTier?: string;
  search?: string;
}

// Transaction query options (removed duplicate - using the first definition)

// ============================================================================
// AGGREGATION TYPES
// ============================================================================

// Portfolio aggregation
export interface PortfolioAggregation {
  totalValueUSD: number;
  totalTokens: number;
  chainDistribution: Array<{
    chainId: string;
    valueUSD: number;
    percentage: number;
    tokenCount: number;
  }>;
  topTokens: Array<{
    token: TokenWithPrice;
    valueUSD: number;
    percentage: number;
  }>;
  change24h: {
    valueUSD: number;
    percentage: number;
  };
  change7d: {
    valueUSD: number;
    percentage: number;
  };
  change30d: {
    valueUSD: number;
    percentage: number;
  };
}

// DeFi aggregation
export interface DeFiAggregation {
  totalValueUSD: number;
  netValueUSD: number;
  totalSuppliedUSD: number;
  totalBorrowedUSD: number;
  totalRewardsUSD: number;
  protocolDistribution: Array<{
    protocol: string;
    valueUSD: number;
    percentage: number;
    positionCount: number;
  }>;
  typeDistribution: Array<{
    type: string;
    valueUSD: number;
    percentage: number;
    positionCount: number;
  }>;
  riskSummary: {
    overallRisk: string;
    positionsAtRisk: number;
    totalCollateralUSD: number;
    averageHealthFactor?: number;
  };
}

// NFT aggregation
export interface NFTAggregation {
  totalNFTs: number;
  totalCollections: number;
  totalValueUSD: number;
  floorValueUSD: number;
  chainDistribution: Array<{
    chainId: string;
    count: number;
    valueUSD: number;
    percentage: number;
  }>;
  categoryDistribution: Array<{
    category: string;
    count: number;
    valueUSD: number;
    percentage: number;
  }>;
  topCollections: Array<{
    collection: NFTCollectionWithStats;
    ownedCount: number;
    totalValueUSD: number;
    averageValueUSD: number;
  }>;
}

// ============================================================================
// CACHE TYPES
// ============================================================================

// Cache key generators
export interface CacheKeyParams {
  walletId?: string;
  chainId?: string;
  address?: string;
  protocol?: string;
  collection?: string;
  [key: string]: string | number | boolean | undefined;
}

// Cache metadata
export interface CacheInfo {
  key: string;
  category: string;
  ttl: number;
  size?: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  lastHit?: Date;
  createdAt: Date;
  expiresAt: Date;
}

// ============================================================================
// PERFORMANCE TYPES
// ============================================================================

// Query performance metrics
export interface QueryMetrics {
  query: string;
  duration: number;
  recordCount: number;
  cacheHit: boolean;
  timestamp: Date;
}

// Batch operation result
export interface BatchResult<T> {
  success: boolean;
  results: T[];
  errors: Array<{
    index: number;
    error: string;
  }>;
  metrics: {
    total: number;
    successful: number;
    failed: number;
    duration: number;
  };
}

// ============================================================================
// NOTE: Validation schemas moved to validators.ts for centralized management
// ============================================================================


// ============================================================================
// ERROR TYPES
// ============================================================================

export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly table?: string,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly value: unknown
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(
    public readonly resource: string,
    public readonly identifier: string
  ) {
    super(`${resource} not found: ${identifier}`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(
    public readonly resource: string,
    public readonly conflictField: string,
    public readonly value: string
  ) {
    super(`${resource} already exists with ${conflictField}: ${value}`);
    this.name = 'ConflictError';
  }
}

// ============================================================================
// NOTE: All validation schemas are now in validators.ts
// Type exports reference schemas from validators.ts if needed
// ============================================================================
