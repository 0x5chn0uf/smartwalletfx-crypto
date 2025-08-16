import type { IntegrationEvent } from '@/ports/EventBusPort';
import type { ChainId } from '@/types/blockchain';
import type { DeFiProtocol, DeFiPosition, DeFiPortfolioSummary } from '@/types/defi';

export interface DeFiPositionsRequestedV1 extends IntegrationEvent {
  type: 'DeFiPositionsRequestedV1';
  payload: any;
  aggregateId: string;
  data: {
    address: string;
    chainIds?: ChainId[];
    protocols?: DeFiProtocol[];
    includeInactive?: boolean;
    minValueUSD?: number;
    enrichment?: {
      includeYieldData?: boolean;
      includeRiskMetrics?: boolean;
      includeRewards?: boolean;
      includeHistoricalData?: boolean;
    };
    requestedAt: string;
    context?: {
      userId?: string;
      clientId?: string;
      userAgent?: string;
      priority?: 'low' | 'medium' | 'high' | 'urgent';
    };
  };
}

export interface DeFiPositionsFetchedV1 extends IntegrationEvent {
  type: 'DeFiPositionsFetchedV1';
  data: {
    address: string;
    positions: DeFiPosition[];
    portfolioSummary: DeFiPortfolioSummary;
    fetchedAt: string;
    stats: {
      protocolsQueried: number;
      protocolsSuccessful: number;
      totalApiCalls: number;
      fetchDurationMs: number;
      costUSD?: number;
      cacheStats: { hits: number; misses: number; hitRate: number };
      chainPerformance: Array<{
        chainId: ChainId;
        durationMs: number;
        positionCount: number;
        success: boolean;
        error?: string;
      }>;
    };
  };
}

export interface DeFiPositionsErrorV1 extends IntegrationEvent {
  type: 'DeFiPositionsErrorV1';
  data: {
    address: string;
    error: {
      message: string;
      code?: string;
      provider?: string;
      chainId?: ChainId;
      protocol?: DeFiProtocol;
      retryable?: boolean;
    };
    failedAt: string;
    context?: { requestId?: string; userId?: string };
  };
}
