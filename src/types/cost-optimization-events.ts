import { ChainId } from '@/types/blockchain';

// Event payloads for the internal cost optimization event bus
export interface CacheWarmRequestV1 {
  type: 'CacheWarmRequestV1';
  timestamp: number;
  requestId: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  dataType: 'balance' | 'transaction' | 'token_metadata' | 'price' | 'nft' | 'defi';
  keys: string[];
  chainId?: ChainId;
  userContext?: string;
  preloadReason: 'user_pattern' | 'time_pattern' | 'cost_optimization' | 'manual';
  estimatedSavings: number;
  metadata?: Record<string, any>;
}

export interface CostThresholdExceededV1 {
  type: 'CostThresholdExceededV1';
  timestamp: number;
  provider: string;
  costType: 'hourly' | 'daily' | 'monthly' | 'per_request';
  currentValue: number;
  threshold: number;
  severity: 'warning' | 'critical';
  requestType?: string;
  chainId?: ChainId;
  actionRequired: string[];
  metadata?: Record<string, any>;
}

export interface RequestDeduplicationV1 {
  type: 'RequestDeduplicationV1';
  timestamp: number;
  originalRequestId: string;
  duplicateRequestIds: string[];
  deduplicationType: 'exact_match' | 'semantic_match' | 'temporal_window' | 'pattern_coalescing';
  dataType: string;
  chainId?: ChainId;
  costSaved: number;
  latencySaved: number;
  metadata?: Record<string, any>;
}

export interface BatchOptimizationV1 {
  type: 'BatchOptimizationV1';
  timestamp: number;
  batchId: string;
  requestCount: number;
  batchStrategy: string;
  costSavings: number;
  latencyImpact: number;
  efficiency: number;
  provider: string;
  chainId?: ChainId;
  metadata?: Record<string, any>;
}

export interface PerformanceDegradationV1 {
  type: 'PerformanceDegradationV1';
  timestamp: number;
  component: string;
  metric: 'response_time' | 'cache_hit_rate' | 'error_rate' | 'throughput';
  currentValue: number;
  baselineValue: number;
  degradationPercentage: number;
  severity: 'minor' | 'moderate' | 'severe';
  impact: 'cost_increase' | 'user_experience' | 'reliability';
  suggestedActions: string[];
  metadata?: Record<string, any>;
}

export interface CacheEvictionV1 {
  type: 'CacheEvictionV1';
  timestamp: number;
  cacheKey: string;
  cacheLayer: 'memory' | 'redis' | 'database';
  evictionReason: 'ttl_expired' | 'memory_pressure' | 'lru' | 'manual';
  dataSize: number;
  accessCount: number;
  lastAccessTime: number;
  costImplication: number;
  metadata?: Record<string, any>;
}

export interface ProviderFailoverV1 {
  type: 'ProviderFailoverV1';
  timestamp: number;
  fromProvider: string;
  toProvider: string;
  failoverReason: 'rate_limit' | 'error_threshold' | 'cost_optimization' | 'latency';
  requestType: string;
  chainId?: ChainId;
  costImpact: number;
  latencyImpact: number;
  expectedDuration: number;
  metadata?: Record<string, any>;
}

export type CostOptimizationEvent =
  | CacheWarmRequestV1
  | CostThresholdExceededV1
  | RequestDeduplicationV1
  | BatchOptimizationV1
  | PerformanceDegradationV1
  | CacheEvictionV1
  | ProviderFailoverV1;

export interface EventHandler<T extends CostOptimizationEvent = CostOptimizationEvent> {
  id: string;
  eventType: T['type'];
  handler: (event: T) => Promise<void>;
  priority: number;
  retryConfig: { maxRetries: number; backoffMs: number; exponentialBackoff: boolean };
  enabled: boolean;
}

export interface EventProcessingMetrics {
  totalEvents: number;
  processedEvents: number;
  failedEvents: number;
  averageProcessingTime: number;
  eventsPerSecond: number;
  queueLength: number;
  lastProcessedAt: number;
  errorsByType: Record<string, number>;
  handlerPerformance: Record<
    string,
    { averageTime: number; successRate: number; totalInvocations: number }
  >;
}
