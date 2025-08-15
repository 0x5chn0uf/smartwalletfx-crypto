// Database Models Index
// Centralized exports for all database models and utilities

// Re-export Prisma client and utilities
export { prisma, dbUtils } from '@/utils/database';

// Re-export Prisma types
export type {
  UserWallet,
  Token,
  TokenBalance,
  PriceCache,
  Portfolio,
  DeFiToken,
  DeFiPosition,
  DeFiSuppliedToken,
  DeFiBorrowedToken,
  DeFiCollateralToken,
  DeFiRewardToken,
  DeFiYieldInfo,
  NFTCollection,
  NFTToken,
  NFTOwnership,
  NFTListing,
  Transaction,
  TransactionToken,
  AnalyticsEvent,
  CacheMetadata,
  SystemHealth,
  Prisma,
} from '@prisma/client';

// Model service classes
export { UserWalletModel } from './UserWalletModel';
export { TokenModel } from './TokenModel';
export { TokenBalanceModel } from './TokenBalanceModel';
export { PriceCacheModel } from './PriceCacheModel';
export { PortfolioModel } from './PortfolioModel';
export { DeFiPositionModel } from './DeFiPositionModel';
export { NFTCollectionModel } from './NFTCollectionModel';
export { NFTTokenModel } from './NFTTokenModel';
export { TransactionModel } from './TransactionModel';
export { AnalyticsModel } from './AnalyticsModel';
