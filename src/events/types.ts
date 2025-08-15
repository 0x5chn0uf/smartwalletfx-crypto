import { DeFiPosition, DeFiPortfolioSummary } from '@/types/defi';
import { ChainId } from '@/types/blockchain';

/**
 * Base domain event interface
 */
export interface DomainEvent {
  /**
   * Unique identifier for the event
   */
  id: string;
  /**
   * Event type identifier
   */
  type: string;
  /**
   * Event version for schema evolution
   */
  version: string;
  /**
   * Timestamp when the event occurred
   */
  timestamp: Date;
  /**
   * Aggregate ID that the event relates to
   */
  aggregateId: string;
  /**
   * Event payload
   */
  payload: Record<string, any>;
}

/**
 * Event metadata for processing and routing
 */
export interface EventMetadata {
  /**
   * Correlation ID for request tracing
   */
  correlationId?: string;
  /**
   * User ID who triggered the event
   */
  userId?: string;
  /**
   * Source service that published the event
   */
  source: string;
  /**
   * Priority level for event processing
   */
  priority?: 'low' | 'medium' | 'high' | 'critical';
  /**
   * Tags for event filtering and routing
   */
  tags?: string[];
  /**
   * TTL for the event (in seconds)
   */
  ttl?: number;
  /**
   * Retry count for failed events
   */
  retryCount?: number;
}

/**
 * DeFi Portfolio Domain Events
 */

/**
 * Event triggered when DeFi positions are requested for a wallet
 */
export interface DeFiPositionsRequestedV1 extends DomainEvent {
  type: 'DeFiPositionsRequestedV1';
  payload: {
    walletAddress: string;
    chainIds?: ChainId[];
    protocols?: string[];
    includeInactive?: boolean;
    requestedBy?: string;
    requestTimestamp: Date;
  };
}

/**
 * Event triggered when DeFi positions are successfully fetched
 */
export interface DeFiPositionsFetchedV1 extends DomainEvent {
  type: 'DeFiPositionsFetchedV1';
  payload: {
    walletAddress: string;
    positions: DeFiPosition[];
    fetchedAt: Date;
    cacheHit: boolean;
    executionTimeMs: number;
    protocolCount: number;
    totalValueUSD: number;
  };
}

/**
 * Event triggered when portfolio computation is completed
 */
export interface PortfolioComputedV1 extends DomainEvent {
  type: 'PortfolioComputedV1';
  payload: {
    walletAddress: string;
    portfolio: DeFiPortfolioSummary;
    computedAt: Date;
    computationTimeMs: number;
    positionCount: number;
    protocolCount: number;
    chainCount: number;
  };
}

/**
 * Event triggered when portfolio cache needs warming
 */
export interface CacheWarmingRequestedV1 extends DomainEvent {
  type: 'CacheWarmingRequestedV1';
  payload: {
    walletAddresses: string[];
    priority: 'low' | 'medium' | 'high';
    reason: string;
    batchId: string;
  };
}

/**
 * Event triggered when a portfolio computation fails
 */
export interface PortfolioComputationFailedV1 extends DomainEvent {
  type: 'PortfolioComputationFailedV1';
  payload: {
    walletAddress: string;
    error: string;
    errorCode: string;
    failedAt: Date;
    retryCount: number;
    willRetry: boolean;
    nextRetryAt?: Date;
  };
}

/**
 * Union type of all domain events
 */
export type AllDomainEvents =
  | DeFiPositionsRequestedV1
  | DeFiPositionsFetchedV1
  | PortfolioComputedV1
  | CacheWarmingRequestedV1
  | PortfolioComputationFailedV1;

/**
 * Event type constants
 */
export const EventTypes = {
  DEFI_POSITIONS_REQUESTED_V1: 'DeFiPositionsRequestedV1',
  DEFI_POSITIONS_FETCHED_V1: 'DeFiPositionsFetchedV1',
  PORTFOLIO_COMPUTED_V1: 'PortfolioComputedV1',
  CACHE_WARMING_REQUESTED_V1: 'CacheWarmingRequestedV1',
  PORTFOLIO_COMPUTATION_FAILED_V1: 'PortfolioComputationFailedV1',
} as const;

/**
 * Event factory functions
 */
export const createEvent = {
  /**
   * Create a DeFi positions requested event
   */
  deFiPositionsRequested: (
    walletAddress: string,
    options?: {
      chainIds?: ChainId[];
      protocols?: string[];
      includeInactive?: boolean;
      requestedBy?: string;
    }
  ): DeFiPositionsRequestedV1 => ({
    id: `defi-positions-requested-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: EventTypes.DEFI_POSITIONS_REQUESTED_V1,
    version: '1.0.0',
    timestamp: new Date(),
    aggregateId: walletAddress,
    payload: {
      walletAddress,
      chainIds: options?.chainIds,
      protocols: options?.protocols,
      includeInactive: options?.includeInactive,
      requestedBy: options?.requestedBy,
      requestTimestamp: new Date(),
    },
  }),

  /**
   * Create a DeFi positions fetched event
   */
  deFiPositionsFetched: (
    walletAddress: string,
    positions: DeFiPosition[],
    metadata: {
      cacheHit: boolean;
      executionTimeMs: number;
    }
  ): DeFiPositionsFetchedV1 => ({
    id: `defi-positions-fetched-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: EventTypes.DEFI_POSITIONS_FETCHED_V1,
    version: '1.0.0',
    timestamp: new Date(),
    aggregateId: walletAddress,
    payload: {
      walletAddress,
      positions,
      fetchedAt: new Date(),
      cacheHit: metadata.cacheHit,
      executionTimeMs: metadata.executionTimeMs,
      protocolCount: new Set(positions.map(p => p.protocol)).size,
      totalValueUSD: positions.reduce((sum, p) => sum + p.totalValueUSD, 0),
    },
  }),

  /**
   * Create a portfolio computed event
   */
  portfolioComputed: (
    walletAddress: string,
    portfolio: DeFiPortfolioSummary,
    computationTimeMs: number
  ): PortfolioComputedV1 => ({
    id: `portfolio-computed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: EventTypes.PORTFOLIO_COMPUTED_V1,
    version: '1.0.0',
    timestamp: new Date(),
    aggregateId: walletAddress,
    payload: {
      walletAddress,
      portfolio,
      computedAt: new Date(),
      computationTimeMs,
      positionCount: portfolio.positions.length,
      protocolCount: portfolio.protocolDistribution.length,
      chainCount: portfolio.chainDistribution.length,
    },
  }),

  /**
   * Create a cache warming requested event
   */
  cacheWarmingRequested: (
    walletAddresses: string[],
    priority: 'low' | 'medium' | 'high',
    reason: string
  ): CacheWarmingRequestedV1 => ({
    id: `cache-warming-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: EventTypes.CACHE_WARMING_REQUESTED_V1,
    version: '1.0.0',
    timestamp: new Date(),
    aggregateId: `batch-${Date.now()}`,
    payload: {
      walletAddresses,
      priority,
      reason,
      batchId: `batch-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    },
  }),

  /**
   * Create a portfolio computation failed event
   */
  portfolioComputationFailed: (
    walletAddress: string,
    error: string,
    errorCode: string,
    retryCount: number,
    willRetry: boolean,
    nextRetryAt?: Date
  ): PortfolioComputationFailedV1 => ({
    id: `portfolio-failed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: EventTypes.PORTFOLIO_COMPUTATION_FAILED_V1,
    version: '1.0.0',
    timestamp: new Date(),
    aggregateId: walletAddress,
    payload: {
      walletAddress,
      error,
      errorCode,
      failedAt: new Date(),
      retryCount,
      willRetry,
      nextRetryAt,
    },
  }),
};
