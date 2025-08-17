import { ChainId } from '@/types/blockchain';

// Core batching request and grouping types
export interface BatchRequest {
  id: string;
  type: 'balance' | 'transaction' | 'token_metadata' | 'price' | 'nft' | 'defi';
  chainId?: ChainId;
  params: Record<string, any>;
  priority: 'low' | 'normal' | 'high' | 'critical';
  maxWaitTime: number;
  callback: (result: any, error?: Error) => void;
  timestamp: number;
  estimatedCost: number;
  requester?: string;
}

export interface BatchGroup {
  id: string;
  type: string;
  chainId?: ChainId;
  provider: string;
  requests: BatchRequest[];
  totalCost: number;
  estimatedSavings: number;
  createdAt: number;
  maxWaitTime: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
}

export interface BatchingStrategy {
  name: string;
  condition: (request: BatchRequest) => boolean;
  maxBatchSize: number;
  maxWaitTime: number;
  costSavingsThreshold: number;
  consolidationLogic: (requests: BatchRequest[]) => any;
  responseDistribution: (batchResponse: any, requests: BatchRequest[]) => Map<string, any>;
}

export interface BatchingMetrics {
  totalRequests: number;
  batchedRequests: number;
  batchingRate: number;
  averageBatchSize: number;
  totalCostSavings: number;
  averageWaitTime: number;
  batchSuccessRate: number;
  providerBreakdown: Record<string, { batches: number; requests: number; savings: number }>;
}

// Enhanced batching engine types
export interface EnhancedBatchRequest extends BatchRequest {
  relationships?: string[];
  crossChainCompatible?: boolean;
  dataFreshness?: 'real_time' | 'near_time' | 'eventual';
  userIntent?: 'analytics' | 'trading' | 'portfolio' | 'discovery';
  geographicRegion?: string;
  deviceType?: 'mobile' | 'desktop' | 'api';
}

export interface CoalescingStrategy {
  name: string;
  condition: (requests: EnhancedBatchRequest[]) => boolean;
  coalesceLogic: (requests: EnhancedBatchRequest[]) => {
    coalescedRequest: any;
    expectedSavings: number;
    riskScore: number;
  };
  resultDistribution: (response: any, requests: EnhancedBatchRequest[]) => Map<string, any>;
  maxCoalesceSize: number;
  maxCoalesceLatency: number;
  savingsThreshold: number;
}

export interface BatchOptimizationMetrics {
  totalRequests: number;
  batchedRequests: number;
  coalescedRequests: number;
  crossChainBatches: number;
  totalCostSavings: number;
  totalLatencyReduction: number;
  averageBatchEfficiency: number;
  averageCoalesceEfficiency: number;
  queueAgeDistribution: {
    under_1s: number;
    _1_to_5s: number;
    _5_to_15s: number;
    over_15s: number;
  };
  providerOptimizationSavings: number;
  crossChainOptimizationSavings: number;
  mlOptimizationAccuracy: number;
  backpressureEvents: number;
  priorityOverrides: number;
}

export interface QueueManagementConfig {
  maxQueueSize: number;
  agingThresholds: { yellow: number; red: number; critical: number };
  priorityWeights: { critical: number; high: number; normal: number; low: number };
  backpressureConfig: {
    enabled: boolean;
    triggerThreshold: number;
    shedPercentage: number;
    recoveryThreshold: number;
  };
}

export interface CrossChainBatchConfig {
  enabled: boolean;
  compatibleChains: { [key in ChainId]?: ChainId[] };
  consolidationStrategies: {
    balance: boolean;
    token_metadata: boolean;
    price: boolean;
    transaction: boolean;
  };
  maxLatencyIncrease: number;
}
