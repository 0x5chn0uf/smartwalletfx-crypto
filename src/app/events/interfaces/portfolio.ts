import type { IntegrationEvent } from '@/ports/EventBusPort';
import type { ChainId } from '@/types/blockchain';

export interface PortfolioComputedV1 extends IntegrationEvent {
  type: 'PortfolioComputedV1';
  data: {
    address: string;
    portfolio: {
      totalValueUSD: number;
      netWorth: number;
      defi?: {
        totalValueUSD: number;
        totalBorrowedUSD: number;
        netValueUSD: number;
        positionCount: number;
        protocolCount: number;
        riskLevel: 'low' | 'medium' | 'high' | 'critical';
      };
      nft?: {
        totalValueUSD: number;
        totalFloorValueUSD: number;
        collectionCount: number;
        tokenCount: number;
      };
      chainDistribution: Array<{
        chainId: ChainId;
        totalValueUSD: number;
        percentage: number;
        assetTypes: string[];
      }>;
      assetAllocation: { defiPercentage: number; nftPercentage: number; liquidPercentage?: number };
    };
    computedAt: string;
    metrics: {
      computationTimeMs: number;
      dataFreshnessMs: number;
      cacheUtilization: {
        hitRate: number;
        totalQueries: number;
        cacheHits: number;
        cacheMisses: number;
      };
      apiStats: {
        totalCalls: number;
        totalCostUSD?: number;
        callsByProvider: Record<string, number>;
        costByProvider: Record<string, number>;
      };
      quality: {
        completeness: number;
        confidence: number;
        missingData: string[];
        staleData: string[];
      };
    };
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

export interface CacheWarmRequestV1 extends IntegrationEvent {
  type: 'CacheWarmRequestV1';
  data: {
    cacheKey: string;
    address: string;
    chains?: ChainId[];
    ttl: number;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    strategy: 'full-refresh' | 'selective-refresh' | 'extend-ttl';
    trigger: {
      source: 'user-activity' | 'scheduled' | 'cache-miss' | 'manual';
      details?: string;
      triggeredAt: string;
    };
    dataTypes: Array<'defi' | 'nft' | 'balances' | 'transactions' | 'prices'>;
    constraints?: { maxCostUSD?: number; maxDurationMs?: number; skipIfRecentlyUpdated?: boolean };
  };
}

export interface PortfolioAggregationRequestV1 extends IntegrationEvent {
  type: 'PortfolioAggregationRequestV1';
  data: {
    address: string;
    components: { includeDefi: boolean; includeNft: boolean; includeBalances: boolean };
    chains?: ChainId[];
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    requestedAt: string;
  };
}

export interface PortfolioAggregationCompletedV1 extends IntegrationEvent {
  type: 'PortfolioAggregationCompletedV1';
  data: {
    address: string;
    requestId: string;
    completedAt: string;
    resultLocation?: string;
    summary: { totalValueUSD: number; positions: number; collections: number };
  };
}

export interface PortfolioAggregationErrorV1 extends IntegrationEvent {
  type: 'PortfolioAggregationErrorV1';
  data: {
    address: string;
    requestId: string;
    error: { message: string; code?: string };
    failedAt: string;
  };
}
