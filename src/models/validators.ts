// Database Validation Schemas and Utilities
// Centralized validation for all database operations

import { z } from 'zod';

// ============================================================================
// COMMON VALIDATION SCHEMAS
// ============================================================================

// Basic field validations
export const AddressSchema = z.string().min(1, 'Address is required');
export const ChainIdSchema = z.string().min(1, 'Chain ID is required');
export const CuidSchema = z.string().cuid('Invalid ID format');
export const UUIDSchema = z.string().uuid('Invalid UUID format');
export const HashSchema = z.string().regex(/^0x[a-fA-F0-9]+$/, 'Invalid hash format');
export const UrlSchema = z.string().url('Invalid URL format');

// Numeric validations
export const PositiveNumberSchema = z.number().positive('Must be a positive number');
export const NonNegativeNumberSchema = z.number().min(0, 'Must be non-negative');
export const PercentageSchema = z.number().min(0).max(100, 'Must be between 0 and 100');
export const DecimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, 'Invalid decimal format');

// Date validations
export const FutureDateSchema = z
  .date()
  .refine(date => date > new Date(), 'Date must be in the future');
export const PastDateSchema = z
  .date()
  .refine(date => date <= new Date(), 'Date must be in the past or present');

// ============================================================================
// USER WALLET VALIDATIONS
// ============================================================================

export const UserWalletCreateSchema = z.object({
  address: AddressSchema,
  chainId: ChainIdSchema,
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().default(true),
});

export const UserWalletUpdateSchema = UserWalletCreateSchema.partial();

export const UserWalletQuerySchema = z.object({
  address: AddressSchema.optional(),
  chainId: ChainIdSchema.optional(),
  isActive: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['createdAt', 'updatedAt', 'lastSyncAt', 'address']).default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ============================================================================
// TOKEN VALIDATIONS
// ============================================================================

export const TokenCreateSchema = z.object({
  address: AddressSchema,
  chainId: ChainIdSchema,
  symbol: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
  decimals: z.number().int().min(0).max(18),
  logoUrl: UrlSchema.optional(),
  coingeckoId: z.string().min(1).max(50).optional(),
  isNative: z.boolean().default(false),
  isStable: z.boolean().default(false),
});

export const TokenUpdateSchema = TokenCreateSchema.partial();

export const TokenQuerySchema = z.object({
  chainId: ChainIdSchema.optional(),
  symbol: z.string().optional(),
  isNative: z.boolean().optional(),
  isStable: z.boolean().optional(),
  search: z.string().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(50),
  sortBy: z.enum(['symbol', 'name', 'createdAt', 'updatedAt']).default('symbol'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

// ============================================================================
// TOKEN BALANCE VALIDATIONS
// ============================================================================

export const TokenBalanceCreateSchema = z.object({
  walletId: CuidSchema,
  tokenId: CuidSchema,
  balance: DecimalStringSchema,
  balanceFormatted: z.string().min(1),
  balanceUSD: z.number().min(0).optional(),
  priceUSD: z.number().min(0).optional(),
  change24h: z.number().optional(),
  blockNumber: z.bigint().optional(),
});

export const TokenBalanceUpdateSchema = TokenBalanceCreateSchema.partial();

// ============================================================================
// PRICE CACHE VALIDATIONS
// ============================================================================

export const PriceCacheCreateSchema = z.object({
  tokenId: CuidSchema,
  priceUSD: PositiveNumberSchema,
  change24h: z.number().optional(),
  change7d: z.number().optional(),
  change30d: z.number().optional(),
  volume24h: NonNegativeNumberSchema.optional(),
  marketCap: NonNegativeNumberSchema.optional(),
  source: z.string().min(1).max(50),
  expiresAt: FutureDateSchema,
});

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
export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: Array<{
    field: string;
    message: string;
    code: string;
  }>;
}

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
