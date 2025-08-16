// Database Validation Schemas and Utilities
// Centralized validation for all database operations

import { z } from 'zod';
import type { ValidationResult } from '@/models/interfaces';

// Re-export common base schemas from models/schema/common
export {
  AddressSchema,
  ChainIdSchema,
  CuidSchema,
  UUIDSchema,
  HashSchema,
  UrlSchema,
  PositiveNumberSchema,
  NonNegativeNumberSchema,
  PercentageSchema,
  DecimalStringSchema,
  FutureDateSchema,
  PastDateSchema,
  PaginationSchema,
} from '@/models/schema/common';

// Re-export specific entity schemas from models/schema/*
export {
  UserWalletCreateSchema,
  UserWalletUpdateSchema,
  UserWalletQuerySchema,
} from '@/models/schema/userWallet';

export { TokenCreateSchema, TokenUpdateSchema, TokenQuerySchema } from '@/models/schema/token';

export { TokenBalanceCreateSchema, TokenBalanceUpdateSchema } from '@/models/schema/tokenBalance';

export { PriceCacheCreateSchema } from '@/models/schema/priceCache';

// ============================================================================
// PORTFOLIO VALIDATIONS
// ============================================================================

export const PortfolioCreateSchema = z.object({
  walletId: CuidSchema,
  chainId: ChainIdSchema,
  totalValueUSD: NonNegativeNumberSchema,
  tokenCount: z.number().int().min(0),
  diversificationScore: PercentageSchema,
  value24hAgo: NonNegativeNumberSchema.optional(),
  value7dAgo: NonNegativeNumberSchema.optional(),
  value30dAgo: NonNegativeNumberSchema.optional(),
});

export const PortfolioUpdateSchema = PortfolioCreateSchema.partial();

export const PortfolioQuerySchema = z.object({
  walletId: CuidSchema.optional(),
  chainId: ChainIdSchema.optional(),
  minValue: NonNegativeNumberSchema.optional(),
  maxValue: NonNegativeNumberSchema.optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['totalValueUSD', 'lastSyncAt', 'diversificationScore']).default('totalValueUSD'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ============================================================================
// DEFI POSITION VALIDATIONS
// ============================================================================

export const DeFiPositionCreateSchema = z.object({
  walletId: CuidSchema,
  protocol: z.string().min(1).max(50),
  chainId: ChainIdSchema,
  type: z.enum([
    'lending',
    'borrowing',
    'liquidity_pool',
    'staking',
    'yield_farming',
    'vault',
    'cdp',
    'insurance',
  ]),
  status: z.enum(['active', 'inactive', 'at_risk', 'liquidated', 'closed']),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  url: UrlSchema.optional(),
  positionId: z.string().max(100).optional(),
  totalValueUSD: NonNegativeNumberSchema,
  netValueUSD: z.number(),
  healthFactor: PositiveNumberSchema.optional(),
  liquidationPrice: PositiveNumberSchema.optional(),
  liquidationRisk: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
  collateralRatio: NonNegativeNumberSchema.optional(),
  utilizationRate: z.number().min(0).max(1).optional(),
  timeToLiquidation: z.number().int().positive().optional(),
  impermanentLoss: z.number().optional(),
  protocolData: z.record(z.any()).default({}),
});

export const DeFiPositionUpdateSchema = DeFiPositionCreateSchema.partial();

export const DeFiPositionQuerySchema = z.object({
  walletId: CuidSchema.optional(),
  protocol: z.string().optional(),
  chainId: ChainIdSchema.optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  minValue: NonNegativeNumberSchema.optional(),
  maxValue: NonNegativeNumberSchema.optional(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['totalValueUSD', 'lastUpdatedAt', 'healthFactor']).default('totalValueUSD'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ============================================================================
// NFT VALIDATIONS
// ============================================================================

export const NFTCollectionCreateSchema = z.object({
  chainId: ChainIdSchema,
  contractAddress: AddressSchema,
  standard: z.enum(['erc-721', 'erc-1155', 'spl-token', 'metaplex']),
  name: z.string().min(1).max(200),
  symbol: z.string().min(1).max(20),
  description: z.string().max(2000).optional(),
  slug: z.string().min(1).max(100),
  category: z
    .enum([
      'art',
      'collectibles',
      'gaming',
      'pfps',
      'music',
      'photography',
      'sports',
      'utility',
      'virtual-worlds',
      'domain-names',
      'memes',
      'unknown',
    ])
    .default('unknown'),
  verified: z.boolean().default(false),
  image: UrlSchema.optional(),
  bannerImage: UrlSchema.optional(),
  featuredImage: UrlSchema.optional(),
  creatorAddress: AddressSchema.optional(),
  creatorEarnings: z.number().min(0).max(1).optional(),
  socialLinks: z.record(z.string()).default({}),
  metadata: z.record(z.any()).default({}),
});

export const NFTCollectionUpdateSchema = NFTCollectionCreateSchema.partial();

export const NFTTokenCreateSchema = z.object({
  walletId: CuidSchema,
  collectionId: CuidSchema,
  chainId: ChainIdSchema,
  contractAddress: AddressSchema,
  tokenId: z.string().min(1),
  standard: z.enum(['erc-721', 'erc-1155', 'spl-token', 'metaplex']),
  owner: AddressSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  image: UrlSchema.optional(),
  imageHighRes: UrlSchema.optional(),
  animationUrl: UrlSchema.optional(),
  externalUrl: UrlSchema.optional(),
  tokenUri: UrlSchema.optional(),
  attributes: z.array(z.any()).default([]),
  lastSalePriceUSD: NonNegativeNumberSchema.optional(),
  floorPriceUSD: NonNegativeNumberSchema.optional(),
  estimatedValueUSD: NonNegativeNumberSchema.optional(),
  listingPriceUSD: NonNegativeNumberSchema.optional(),
  isListed: z.boolean().default(false),
  rarityRank: z.number().int().positive().optional(),
  rarityScore: NonNegativeNumberSchema.optional(),
  rarityTier: z.enum(['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']).optional(),
  metadata: z.record(z.any()).default({}),
});

export const NFTTokenUpdateSchema = NFTTokenCreateSchema.partial();

export const NFTQuerySchema = z.object({
  walletId: CuidSchema.optional(),
  collectionId: CuidSchema.optional(),
  chainId: ChainIdSchema.optional(),
  category: z.string().optional(),
  isListed: z.boolean().optional(),
  minPrice: NonNegativeNumberSchema.optional(),
  maxPrice: NonNegativeNumberSchema.optional(),
  rarityTier: z.string().optional(),
  search: z.string().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z
    .enum(['name', 'lastSalePriceUSD', 'rarityRank', 'lastTransferredAt'])
    .default('lastTransferredAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ============================================================================
// TRANSACTION VALIDATIONS
// ============================================================================

export const TransactionCreateSchema = z.object({
  walletId: CuidSchema,
  hash: HashSchema,
  chainId: ChainIdSchema,
  from: AddressSchema,
  to: AddressSchema.optional(),
  value: DecimalStringSchema,
  valueUSD: NonNegativeNumberSchema.optional(),
  gasPrice: DecimalStringSchema.optional(),
  gasUsed: DecimalStringSchema.optional(),
  gasLimit: DecimalStringSchema.optional(),
  gasFeeUSD: NonNegativeNumberSchema.optional(),
  status: z.enum(['pending', 'confirmed', 'failed']),
  blockNumber: z.bigint().optional(),
  blockHash: HashSchema.optional(),
  timestamp: z.date(),
  type: z.string().max(50).optional(),
  category: z.string().max(50).optional(),
  metadata: z.record(z.any()).default({}),
});

export const TransactionUpdateSchema = TransactionCreateSchema.partial();

export const TransactionQuerySchema = z.object({
  walletId: CuidSchema.optional(),
  chainId: ChainIdSchema.optional(),
  status: z.enum(['pending', 'confirmed', 'failed']).optional(),
  type: z.string().optional(),
  category: z.string().optional(),
  from: AddressSchema.optional(),
  to: AddressSchema.optional(),
  minValue: NonNegativeNumberSchema.optional(),
  maxValue: NonNegativeNumberSchema.optional(),
  fromDate: z.date().optional(),
  toDate: z.date().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['timestamp', 'valueUSD', 'blockNumber']).default('timestamp'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ============================================================================
// ANALYTICS VALIDATIONS
// ============================================================================

export const AnalyticsEventCreateSchema = z.object({
  eventType: z.string().min(1).max(100),
  walletId: CuidSchema.optional(),
  chainId: ChainIdSchema.optional(),
  eventData: z.record(z.any()).default({}),
  duration: z.number().int().positive().optional(),
  success: z.boolean().default(true),
  errorCode: z.string().max(50).optional(),
  errorMessage: z.string().max(500).optional(),
  userAgent: z.string().max(500).optional(),
  ipAddress: z.string().ip().optional(),
  sessionId: z.string().max(100).optional(),
});

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Validate Ethereum address format
 */
export const validateEthereumAddress = (address: string): boolean => {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};

/**
 * Validate Solana address format
 */
export const validateSolanaAddress = (address: string): boolean => {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
};

/**
 * Validate address based on chain
 */
export const validateChainAddress = (address: string, chainId: string): boolean => {
  if (chainId === 'solana') {
    return validateSolanaAddress(address);
  }
  return validateEthereumAddress(address);
};

/**
 * Validate transaction hash format
 */
export const validateTransactionHash = (hash: string, chainId: string): boolean => {
  if (chainId === 'solana') {
    // Solana transaction signatures are base58 encoded
    return /^[1-9A-HJ-NP-Za-km-z]{88}$/.test(hash);
  }
  // Ethereum transaction hashes are hex
  return /^0x[a-fA-F0-9]{64}$/.test(hash);
};

/**
 * Validate decimal string format
 */
export const validateDecimalString = (value: string): boolean => {
  return /^\d+(\.\d+)?$/.test(value);
};

/**
 * Validate percentage (0-100)
 */
export const validatePercentage = (value: number): boolean => {
  return value >= 0 && value <= 100;
};

/**
 * Validate positive number
 */
export const validatePositiveNumber = (value: number): boolean => {
  return value > 0 && !isNaN(value) && isFinite(value);
};

/**
 * Validate non-negative number
 */
export const validateNonNegativeNumber = (value: number): boolean => {
  return value >= 0 && !isNaN(value) && isFinite(value);
};

/**
 * Sanitize user input
 */
export const sanitizeString = (input: string, maxLength: number = 1000): string => {
  return input.trim().slice(0, maxLength).replace(/[<>]/g, ''); // Remove potential HTML tags
};

/**
 * Validate and sanitize URL
 */
export const validateAndSanitizeUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    // Only allow http and https protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

/**
 * Custom validation error class
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly value: unknown,
    public readonly code: string = 'VALIDATION_ERROR'
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validation result type
 */
// ValidationResult moved to '@/models/interfaces'

/**
 * Generic validator function
 */
export const validate = <T>(schema: z.ZodSchema<T>, data: unknown): ValidationResult<T> => {
  try {
    const result = schema.parse(data);
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        errors: error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code,
        })),
      };
    }

    return {
      success: false,
      errors: [
        {
          field: 'unknown',
          message: 'Validation failed',
          code: 'UNKNOWN_ERROR',
        },
      ],
    };
  }
};
