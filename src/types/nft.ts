import { z } from 'zod';
import { ChainId } from './blockchain';

// NFT Standards
export enum NFTStandard {
  ERC_721 = 'erc-721',
  ERC_1155 = 'erc-1155',
  SPL_TOKEN = 'spl-token', // Solana
  METAPLEX = 'metaplex', // Solana
}

// NFT Marketplaces
export enum NFTMarketplace {
  OPENSEA = 'opensea',
  MAGIC_EDEN = 'magic-eden',
  BLUR = 'blur',
  LOOKSRARE = 'looksrare',
  X2Y2 = 'x2y2',
  FOUNDATION = 'foundation',
  SUPERRARE = 'superrare',
  ASYNC_ART = 'async-art',
  TENSOR = 'tensor', // Solana
  SOLANART = 'solanart', // Solana
}

// NFT Categories
export enum NFTCategory {
  ART = 'art',
  COLLECTIBLES = 'collectibles',
  GAMING = 'gaming',
  PFPS = 'pfps', // Profile Pictures
  MUSIC = 'music',
  PHOTOGRAPHY = 'photography',
  SPORTS = 'sports',
  UTILITY = 'utility',
  VIRTUAL_WORLDS = 'virtual-worlds',
  DOMAIN_NAMES = 'domain-names',
  MEMES = 'memes',
  UNKNOWN = 'unknown',
}

// NFT Rarity Ranks
export enum RarityRank {
  COMMON = 'common',
  UNCOMMON = 'uncommon',
  RARE = 'rare',
  EPIC = 'epic',
  LEGENDARY = 'legendary',
  MYTHIC = 'mythic',
}

// Base NFT Token Interface
export interface NFTToken {
  // Core identification
  id: string; // Format: {chainId}:{contractAddress}:{tokenId}
  chainId: ChainId;
  contractAddress: string;
  tokenId: string;
  standard: NFTStandard;

  // Ownership
  owner: string;
  ownershipHistory?: NFTOwnershipRecord[];

  // Metadata
  name: string;
  description?: string;
  image?: string;
  imageHighRes?: string;
  animationUrl?: string;
  externalUrl?: string;
  attributes?: NFTAttribute[];

  // Collection information
  collectionName?: string;
  collectionSymbol?: string;
  collectionSlug?: string;
  collectionAddress?: string;

  // Market data
  lastSalePrice?: NFTPrice;
  floorPrice?: NFTPrice;
  estimatedValue?: NFTPrice;
  listingPrice?: NFTPrice;
  isListed: boolean;

  // Rarity and analytics
  rarityRank?: number;
  rarityScore?: number;
  rarityTier?: RarityRank;
  totalSupply?: number;

  // Metadata
  category: NFTCategory;
  createdAt: Date;
  lastUpdatedAt: Date;
  lastTransferredAt?: Date;

  // Technical details
  metadata?: Record<string, any>;
  tokenUri?: string;
  contractMetadata?: NFTContractMetadata;
}

// NFT Attribute Interface
export interface NFTAttribute {
  traitType: string;
  value: string | number;
  displayType?: string;
  maxValue?: number;
  traitCount?: number;
  rarityPercentage?: number;
}

// NFT Price Interface
export interface NFTPrice {
  amount: string;
  currency: string; // ETH, SOL, USDC, etc.
  usdValue?: number;
  timestamp: Date;
  marketplace?: NFTMarketplace;
  transactionHash?: string;
}

// NFT Ownership Record
export interface NFTOwnershipRecord {
  owner: string;
  acquiredAt: Date;
  acquiredPrice?: NFTPrice;
  transferType: 'mint' | 'purchase' | 'transfer' | 'airdrop';
  transactionHash: string;
  blockNumber: number;
}

// NFT Contract Metadata
export interface NFTContractMetadata {
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  externalLink?: string;
  totalSupply?: number;
  createdAt?: Date;
  creatorAddress?: string;
  creatorEarnings?: number; // Royalty percentage
  verified: boolean;
  category: NFTCategory;

  // Collection stats
  floorPrice?: NFTPrice;
  volume24h?: NFTPrice;
  volume7d?: NFTPrice;
  volume30d?: NFTPrice;
  volumeTotal?: NFTPrice;
  marketCap?: NFTPrice;
  ownersCount?: number;
  listedCount?: number;

  // Social links
  socialLinks?: {
    website?: string;
    discord?: string;
    twitter?: string;
    instagram?: string;
    telegram?: string;
  };
}

// NFT Collection Summary
export interface NFTCollection {
  id: string; // Format: {chainId}:{contractAddress}
  chainId: ChainId;
  contractAddress: string;
  standard: NFTStandard;

  // Basic info
  name: string;
  symbol: string;
  description?: string;
  slug: string;

  // Visual assets
  image?: string;
  bannerImage?: string;
  featuredImage?: string;

  // Collection metadata
  metadata: NFTContractMetadata;
  category: NFTCategory;
  verified: boolean;

  // Statistics
  stats: {
    totalSupply: number;
    ownersCount: number;
    listedCount: number;
    floorPrice?: NFTPrice;
    volumeTotal: NFTPrice;
    volume24h: NFTPrice;
    volume7d: NFTPrice;
    volume30d: NFTPrice;
    marketCap?: NFTPrice;
    averagePrice?: NFTPrice;
    salesCount24h: number;
    salesCount7d: number;
    salesCount30d: number;
  };

  // Tracking
  createdAt: Date;
  lastUpdatedAt: Date;
}

// NFT Portfolio Summary
export interface NFTPortfolio {
  address: string;
  chainId?: ChainId;

  // Counts and basic stats
  totalNFTs: number;
  totalCollections: number;
  totalValue: NFTPrice;
  totalFloorValue: NFTPrice;

  // Distribution
  chainDistribution: Array<{
    chainId: ChainId;
    count: number;
    value: NFTPrice;
    percentage: number;
  }>;

  categoryDistribution: Array<{
    category: NFTCategory;
    count: number;
    value: NFTPrice;
    percentage: number;
  }>;

  collectionDistribution: Array<{
    collection: NFTCollection;
    count: number;
    totalValue: NFTPrice;
    floorValue: NFTPrice;
    percentage: number;
  }>;

  // Top holdings
  topCollections: Array<{
    collection: NFTCollection;
    ownedCount: number;
    totalValue: NFTPrice;
    averageValue: NFTPrice;
  }>;

  topValueNFTs: NFTToken[];
  recentlyAcquired: NFTToken[];

  // Activity summary
  activitySummary: {
    totalTransactions: number;
    totalSpent: NFTPrice;
    totalReceived: NFTPrice;
    netPosition: NFTPrice;
    firstActivityAt?: Date;
    lastActivityAt?: Date;
  };

  // Metadata
  lastUpdatedAt: Date;
  cacheExpiresAt: Date;
}

// NFT Transaction Interface
export interface NFTTransaction {
  id: string;
  chainId: ChainId;
  transactionHash: string;
  blockNumber: number;
  timestamp: Date;

  // Transaction details
  type: 'mint' | 'sale' | 'transfer' | 'listing' | 'offer' | 'bid';
  marketplace?: NFTMarketplace;

  // NFT details
  nft: {
    contractAddress: string;
    tokenId: string;
    collectionName?: string;
    name?: string;
    image?: string;
  };

  // Parties involved
  from: string;
  to: string;

  // Price details
  price?: NFTPrice;
  fees?: Array<{
    type: 'marketplace' | 'royalty' | 'gas';
    amount: NFTPrice;
    recipient?: string;
  }>;

  // Additional metadata
  metadata?: Record<string, any>;
}

// NFT API Response Types
export interface NFTApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata: {
    timestamp: string;
    requestId?: string;
    cacheHit?: boolean;
    processingTime?: string;
    totalCount?: number;
    page?: number;
    limit?: number;
  };
}

// NFT Detection Result
export interface NFTDetectionResult {
  address: string;
  chainId: ChainId;
  nfts: NFTToken[];
  collections: NFTCollection[];
  totalCount: number;

  // Detection metadata
  detectionMethod: 'contract-scan' | 'transaction-history' | 'marketplace-api' | 'indexer-api';
  coverage: {
    standardsCovered: NFTStandard[];
    marketplacesCovered: NFTMarketplace[];
    blockRangeScanned?: {
      from: number;
      to: number;
    };
  };

  // Quality metrics
  metadataCompleteness: number; // 0-1 score
  priceDataAvailability: number; // 0-1 score
  lastScanAt: Date;
  nextScanAt: Date;
}

// Marketplace Listing
export interface NFTListing {
  id: string;
  chainId: ChainId;
  marketplace: NFTMarketplace;

  // NFT details
  contractAddress: string;
  tokenId: string;
  nft?: NFTToken;

  // Listing details
  seller: string;
  price: NFTPrice;
  startTime: Date;
  endTime?: Date;
  listingType: 'fixed-price' | 'auction' | 'dutch-auction';

  // Status
  status: 'active' | 'sold' | 'cancelled' | 'expired';

  // Metadata
  createdAt: Date;
  lastUpdatedAt: Date;
  externalUrl?: string;
}

// Collection Analytics
export interface CollectionAnalytics {
  collection: NFTCollection;
  timeframe: '1d' | '7d' | '30d' | '90d' | '1y' | 'all';

  // Price analytics
  priceHistory: Array<{
    timestamp: Date;
    floorPrice: NFTPrice;
    averagePrice: NFTPrice;
    volume: NFTPrice;
    salesCount: number;
  }>;

  // Trading metrics
  volatility: number; // Price volatility score
  liquidity: number; // Trading liquidity score
  momentum: number; // Price momentum indicator

  // Holder analytics
  holderDistribution: Array<{
    holderType: 'whale' | 'collector' | 'trader' | 'holder';
    count: number;
    percentage: number;
    totalValue: NFTPrice;
  }>;

  // Rarity distribution
  rarityDistribution: Array<{
    tier: RarityRank;
    count: number;
    percentage: number;
    floorPrice: NFTPrice;
  }>;

  // Social sentiment (if available)
  sentiment?: {
    score: number; // -1 to 1
    sources: string[];
    lastUpdatedAt: Date;
  };
}

// Zod Validation Schemas
export const NFTTokenSchema = z.object({
  id: z.string(),
  chainId: z.nativeEnum(ChainId),
  contractAddress: z.string(),
  tokenId: z.string(),
  standard: z.nativeEnum(NFTStandard),
  owner: z.string(),
  name: z.string(),
  description: z.string().optional(),
  image: z.string().optional(),
  collectionName: z.string().optional(),
  isListed: z.boolean(),
  category: z.nativeEnum(NFTCategory),
  createdAt: z.date(),
  lastUpdatedAt: z.date(),
});

export const NFTCollectionSchema = z.object({
  id: z.string(),
  chainId: z.nativeEnum(ChainId),
  contractAddress: z.string(),
  standard: z.nativeEnum(NFTStandard),
  name: z.string(),
  symbol: z.string(),
  slug: z.string(),
  category: z.nativeEnum(NFTCategory),
  verified: z.boolean(),
  createdAt: z.date(),
  lastUpdatedAt: z.date(),
});

export const NFTPortfolioSchema = z.object({
  address: z.string(),
  totalNFTs: z.number(),
  totalCollections: z.number(),
  lastUpdatedAt: z.date(),
  cacheExpiresAt: z.date(),
});

export const NFTDetectionResultSchema = z.object({
  address: z.string(),
  chainId: z.nativeEnum(ChainId),
  totalCount: z.number(),
  detectionMethod: z.enum([
    'contract-scan',
    'transaction-history',
    'marketplace-api',
    'indexer-api',
  ]),
  metadataCompleteness: z.number().min(0).max(1),
  priceDataAvailability: z.number().min(0).max(1),
  lastScanAt: z.date(),
  nextScanAt: z.date(),
});

// Type exports for external use removed to fix duplicate exports
// All types are already exported above through individual export statements
