import { IntegrationEvent } from '../ports/EventBusPort';
import { ChainId } from '@/types/blockchain';
import { MultiChainPortfolio } from '@/types/blockchain';

/**
 * Portfolio Event Types
 */
export const PORTFOLIO_EVENT_TYPES = {
  COMPUTED: 'PortfolioComputedV1',
  CACHE_WARM_REQUEST: 'CacheWarmRequestV1',
  AGGREGATION_REQUEST: 'PortfolioAggregationRequestV1',
  AGGREGATION_COMPLETED: 'PortfolioAggregationCompletedV1',
  AGGREGATION_ERROR: 'PortfolioAggregationErrorV1',
} as const;

/**
 * Portfolio Computed Event
 * Emitted after complete portfolio aggregation and enrichment
 */
export interface PortfolioComputedV1 extends IntegrationEvent {
  type: typeof PORTFOLIO_EVENT_TYPES.COMPUTED;
  data: {
    /** Wallet address */
    address: string;
    /** Complete aggregated portfolio */
    portfolio: {
      /** Total portfolio value in USD */
      totalValueUSD: number;
      /** Net worth (assets - liabilities) */
      netWorth: number;
      /** DeFi component summary */
      defi?: {
        totalValueUSD: number;
        totalBorrowedUSD: number;
        netValueUSD: number;
        positionCount: number;
        protocolCount: number;
        riskLevel: 'low' | 'medium' | 'high' | 'critical';
      };
      /** NFT component summary */
      nft?: {
        totalValueUSD: number;
        totalFloorValueUSD: number;
        collectionCount: number;
        tokenCount: number;
      };
      /** Cross-chain distribution */
      chainDistribution: Array<{
        chainId: ChainId;
        totalValueUSD: number;
        percentage: number;
        assetTypes: string[];
      }>;
      /** Asset allocation breakdown */
      assetAllocation: {
        defiPercentage: number;
        nftPercentage: number;
        liquidPercentage?: number;
      };
    };
    /** When computation completed */
    computedAt: string; // ISO 8601
    /** Computation performance metrics */
    metrics: {
      /** Total computation time */
      computationTimeMs: number;
      /** Data freshness (how old was the newest data) */
      dataFreshnessMs: number;
      /** Cache utilization during computation */
      cacheUtilization: {
        hitRate: number;
        totalQueries: number;
        cacheHits: number;
        cacheMisses: number;
      };
      /** API call statistics */
      apiStats: {
        totalCalls: number;
        totalCostUSD?: number;
        callsByProvider: Record<string, number>;
        costByProvider: Record<string, number>;
      };
      /** Data quality metrics */
      quality: {
        completeness: number; // 0-1 score
        confidence: number;   // 0-1 score
        missingData: string[];
        staleData: string[];
      };
    };
    /** Components that contributed to this portfolio */
    sources: {
      defiSources?: Array<{
        protocol: string;
        chainId: ChainId;
        positionCount: number;
        valueUSD: number;
        lastUpdated: string;
      }>;
      nftSources?: Array<{
        chainId: ChainId;
        collectionCount: number;
        tokenCount: number;
        valueUSD: number;
        lastUpdated: string;
      }>;
    };
  };
}

/**
 * Cache Warm Request Event
 * Emitted to pre-compute and cache frequently accessed data
 */
export interface CacheWarmRequestV1 extends IntegrationEvent {
  type: typeof PORTFOLIO_EVENT_TYPES.CACHE_WARM_REQUEST;
  data: {
    /** Cache key pattern to warm */
    cacheKey: string;
    /** Target wallet address */
    address: string;
    /** Specific chains to warm cache for */
    chains?: ChainId[];
    /** Cache TTL to use */
    ttl: number;
    /** Request priority */
    priority: 'low' | 'medium' | 'high' | 'urgent';
    /** Cache warming strategy */
    strategy: 'full-refresh' | 'selective-refresh' | 'extend-ttl';
    /** Trigger reason */
    trigger: {
      source: 'user-activity' | 'scheduled' | 'cache-miss' | 'manual';
      details?: string;
      triggeredAt: string;
    };
    /** Data types to warm */
    dataTypes: Array<'defi' | 'nft' | 'balances' | 'transactions' | 'prices'>;
    /** Warm cache constraints */
    constraints?: {
      maxCostUSD?: number;
      maxDurationMs?: number;
      skipIfRecentlyUpdated?: boolean;
    };
  };
}

/**
 * Portfolio Aggregation Request Event
 * Emitted when a complete portfolio aggregation is requested
 */
export interface PortfolioAggregationRequestV1 extends IntegrationEvent {
  type: typeof PORTFOLIO_EVENT_TYPES.AGGREGATION_REQUEST;
  data: {
    /** Wallet address to aggregate */
    address: string;
    /** Components to include */
    components: {
      includeDefi: boolean;
      includeNft: boolean;
      includeBalances: boolean;
      includeTransactions?: boolean;
    };
    /** Chain filters */
    chains?: ChainId[];
    /** Aggregation options */
    options: {
      includeMetadata: boolean;
      includeAnalytics: boolean;
      forceRefresh: boolean;
      minDefiValue?: number;
      minNftValue?: number;
      maxStalenessMs?: number;
    };
    /** Request context */
    context: {
      userId?: string;
      sessionId?: string;
      clientType: 'web' | 'mobile' | 'api';
      priority: 'low' | 'medium' | 'high' | 'urgent';
    };
    /** When aggregation was requested */
    requestedAt: string; // ISO 8601
  };
}

/**
 * Portfolio Aggregation Completed Event
 * Emitted when portfolio aggregation successfully completes
 */
export interface PortfolioAggregationCompletedV1 extends IntegrationEvent {
  type: typeof PORTFOLIO_EVENT_TYPES.AGGREGATION_COMPLETED;
  data: {
    /** Wallet address */
    address: string;
    /** Result storage information */
    result: {
      /** Where the result is stored */
      storageKey: string;
      /** Result format/version */
      format: string;
      /** Result size in bytes */
      sizeBytes: number;
      /** Result TTL */
      ttl: number;
    };
    /** Performance summary */
    performance: {
      totalDurationMs: number;
      componentDurations: {
        defiMs?: number;
        nftMs?: number;
        balancesMs?: number;
        aggregationMs: number;
      };
      cacheHitRate: number;
      totalApiCalls: number;
      totalCostUSD?: number;
    };
    /** Data quality assessment */
    quality: {
      completeness: number;
      confidence: number;
      lastUpdated: string;
      dataAge: {
        defiAgeMs?: number;
        nftAgeMs?: number;
        balancesAgeMs?: number;
      };
    };
    /** When aggregation completed */
    completedAt: string; // ISO 8601
    /** Original request reference */
    originalRequest: {
      components: any;
      chains?: ChainId[];
      options: any;
    };
  };
}

/**
 * Portfolio Aggregation Error Event
 * Emitted when portfolio aggregation fails
 */
export interface PortfolioAggregationErrorV1 extends IntegrationEvent {
  type: typeof PORTFOLIO_EVENT_TYPES.AGGREGATION_ERROR;
  data: {
    /** Wallet address that failed */
    address: string;
    /** Error information */
    error: {
      code: string;
      message: string;
      category: 'network' | 'provider' | 'validation' | 'timeout' | 'rate-limit' | 'system';
      severity: 'low' | 'medium' | 'high' | 'critical';
      retryable: boolean;
      details?: any;
    };
    /** Partial results if any component succeeded */
    partialResults?: {
      defiSuccess: boolean;
      nftSuccess: boolean;
      balancesSuccess: boolean;
      partialData?: any;
    };
    /** Recovery options */
    recovery: {
      suggestedAction: 'retry' | 'fallback-to-cache' | 'partial-response' | 'manual-intervention';
      retryAfterMs?: number;
      fallbackDataAvailable: boolean;
      estimatedRecoveryTimeMs?: number;
    };
    /** Context at time of failure */
    context: {
      attemptNumber: number;
      lastSuccessfulAt?: string;
      resourceUtilization?: {
        cpuPercent?: number;
        memoryPercent?: number;
        activeConnections?: number;
      };
    };
    /** When error occurred */
    errorAt: string; // ISO 8601
    /** Original request reference */
    originalRequest: any;
  };
}