import { IntegrationEvent } from '@/ports/EventBusPort';
import { ChainId } from '@/types/blockchain';
import { DeFiProtocol, DeFiPosition, DeFiPortfolioSummary } from '@/types/defi';

/**
 * Event Types - Following semantic versioning for schema evolution
 */
export const DEFI_EVENT_TYPES = {
  POSITIONS_REQUESTED: 'DeFiPositionsRequestedV1',
  POSITIONS_FETCHED: 'DeFiPositionsFetchedV1',
  POSITIONS_ERROR: 'DeFiPositionsErrorV1',
} as const;

/**
 * DeFi Positions Requested Event
 * Emitted by HTTP routes when detailed DeFi portfolio is requested
 * Triggers async computation of positions
 */
export interface DeFiPositionsRequestedV1 extends IntegrationEvent {
  type: typeof DEFI_EVENT_TYPES.POSITIONS_REQUESTED;
  payload: any;
  aggregateId: string;
  data: {
    /** Wallet address to fetch positions for */
    address: string;
    /** Specific chains to query (optional - all healthy chains if omitted) */
    chainIds?: ChainId[];
    /** Specific protocols to query (optional - all enabled if omitted) */
    protocols?: DeFiProtocol[];
    /** Whether to include inactive/dust positions */
    includeInactive?: boolean;
    /** Minimum USD value threshold for positions */
    minValueUSD?: number;
    /** Client preferences for data enrichment */
    enrichment?: {
      includeYieldData?: boolean;
      includeRiskMetrics?: boolean;
      includeRewards?: boolean;
      includeHistoricalData?: boolean;
    };
    /** When the request was initiated */
    requestedAt: string; // ISO 8601
    /** Client/user context for personalization */
    context?: {
      userId?: string;
      clientId?: string;
      userAgent?: string;
      priority?: 'low' | 'medium' | 'high' | 'urgent';
    };
  };
}

/**
 * DeFi Positions Fetched Event  
 * Emitted by DeFiOrchestrator after successfully fetching positions
 * Contains raw position data and fetch statistics
 */
export interface DeFiPositionsFetchedV1 extends IntegrationEvent {
  type: typeof DEFI_EVENT_TYPES.POSITIONS_FETCHED;
  data: {
    /** Wallet address that was queried */
    address: string;
    /** Successfully fetched positions */
    positions: DeFiPosition[];
    /** Aggregated portfolio summary */
    portfolioSummary: DeFiPortfolioSummary;
    /** When positions were fetched */
    fetchedAt: string; // ISO 8601
    /** Fetch operation statistics */
    stats: {
      /** Number of protocols queried */
      protocolsQueried: number;
      /** Number of protocols that responded successfully */
      protocolsSuccessful: number;
      /** Total number of API calls made */
      totalApiCalls: number;
      /** Total time spent fetching data */
      fetchDurationMs: number;
      /** Cost incurred for this operation */
      costUSD?: number;
      /** Cache hit/miss statistics */
      cacheStats: {
        hits: number;
        misses: number;
        hitRate: number;
      };
      /** Chain-specific performance */
      chainPerformance: Array<{
        chainId: ChainId;
        durationMs: number;
        positionCount: number;
        success: boolean;
        error?: string;
      }>;
      /** Protocol-specific performance */
      protocolPerformance: Array<{
        protocol: DeFiProtocol;
        chainId: ChainId;
        durationMs: number;
        positionCount: number;
        success: boolean;
        error?: string;
        costUSD?: number;
      }>;
    };
    /** Original request parameters for correlation */
    originalRequest: {
      chainIds?: ChainId[];
      protocols?: DeFiProtocol[];
      includeInactive?: boolean;
      minValueUSD?: number;
    };
  };
}

/**
 * DeFi Positions Error Event
 * Emitted when DeFi position fetching fails
 */
export interface DeFiPositionsErrorV1 extends IntegrationEvent {
  type: typeof DEFI_EVENT_TYPES.POSITIONS_ERROR;
  data: {
    /** Wallet address that failed */
    address: string;
    /** Error details */
    error: {
      code: string;
      message: string;
      details?: any;
      stack?: string;
    };
    /** Partial results if any protocols succeeded */
    partialResults?: {
      positions: DeFiPosition[];
      successfulProtocols: DeFiProtocol[];
      failedProtocols: Array<{
        protocol: DeFiProtocol;
        chainId: ChainId;
        error: string;
      }>;
    };
    /** When error occurred */
    errorAt: string; // ISO 8601
    /** Original request for correlation */
    originalRequest: {
      chainIds?: ChainId[];
      protocols?: DeFiProtocol[];
      includeInactive?: boolean;
      minValueUSD?: number;
    };
    /** Recovery suggestions */
    recovery?: {
      retryable: boolean;
      retryAfterMs?: number;
      fallbackToCache?: boolean;
      suggestedAction?: string;
    };
  };
}