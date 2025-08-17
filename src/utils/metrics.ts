/**
 * Metrics - Simplified Implementation
 * 
 * Simplified metrics to avoid circular imports while maintaining functionality.
 * Individual metrics organized by domain but in single file for clarity.
 */

import { Registry, collectDefaultMetrics, Histogram, Counter, Gauge } from 'prom-client';
import { ChainId } from '@/types/blockchain';

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'crypto_data_' });

// HTTP Request Metrics
export const httpDuration = new Histogram({
  name: 'crypto_data_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5],
});
registry.registerMetric(httpDuration);

export const httpRequestsTotal = new Counter({
  name: 'crypto_data_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
});
registry.registerMetric(httpRequestsTotal);

// Provider Metrics
export const providerDuration = new Histogram({
  name: 'crypto_data_provider_request_duration_seconds',
  help: 'Duration of provider API requests in seconds',
  labelNames: ['provider', 'chain_id', 'operation', 'status', 'error_code'] as const,
  buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30],
});
registry.registerMetric(providerDuration);

export const providerRequestsTotal = new Counter({
  name: 'crypto_data_provider_requests_total',
  help: 'Total number of provider API requests',
  labelNames: ['provider', 'chain_id', 'operation', 'status', 'error_code'] as const,
});
registry.registerMetric(providerRequestsTotal);

export const providerErrorsTotal = new Counter({
  name: 'crypto_data_provider_errors_total',
  help: 'Total number of provider errors',
  labelNames: ['provider', 'chain_id', 'error_type', 'error_code'] as const,
});
registry.registerMetric(providerErrorsTotal);

// Cache Metrics
export const cacheHits = new Counter({
  name: 'crypto_data_cache_hits_total',
  help: 'Number of cache hits',
  labelNames: ['source', 'operation'] as const,
});
registry.registerMetric(cacheHits);

export const cacheMisses = new Counter({
  name: 'crypto_data_cache_misses_total',
  help: 'Number of cache misses',
  labelNames: ['source', 'operation'] as const,
});
registry.registerMetric(cacheMisses);

// Budget Metrics
export const providerCostUSD = new Counter({
  name: 'crypto_data_provider_cost_usd_total',
  help: 'Total cost in USD for provider requests',
  labelNames: ['provider', 'chain_id'] as const,
});
registry.registerMetric(providerCostUSD);

export const globalBudgetUtilization = new Gauge({
  name: 'crypto_data_global_budget_utilization_ratio',
  help: 'Global budget utilization ratio (0-1)',
});
registry.registerMetric(globalBudgetUtilization);

// Recording Functions
export const recordHttpRequest = (
  method: string,
  route: string,
  statusCode: number,
  durationMs: number
) => {
  const statusStr = String(statusCode);
  httpDuration.labels(method, route, statusStr).observe(durationMs / 1000);
  httpRequestsTotal.labels(method, route, statusStr).inc();
};

export const recordProviderCall = (
  provider: string,
  chainId: string | number | ChainId,
  operation: string,
  success: boolean,
  durationMs: number,
  errorCode?: string,
  retryAttempts?: number,
  cost?: number
) => {
  const chainIdStr = String(chainId);
  const status = success ? 'success' : 'error';
  const errorLabel = errorCode || 'none';

  providerDuration
    .labels(provider, chainIdStr, operation, status, errorLabel)
    .observe(durationMs / 1000);

  providerRequestsTotal.labels(provider, chainIdStr, operation, status, errorLabel).inc();

  if (!success && errorCode) {
    providerErrorsTotal.labels(provider, chainIdStr, 'request_error', errorCode).inc();
  }

  if (cost && cost > 0) {
    providerCostUSD.labels(provider, chainIdStr).inc(cost);
  }
};

export const recordCacheEvent = (
  hit: boolean,
  source: string = 'redis',
  operation: string = 'get'
) => {
  if (hit) {
    cacheHits.labels(source, operation).inc();
  } else {
    cacheMisses.labels(source, operation).inc();
  }
};

// Stub functions for compatibility
export const recordCacheOperation = (operation: string, durationMs: number, success: boolean) => {
  // Simplified - can be expanded later
};

export const recordWorkerJob = (
  queueName: string,
  workerId: string,
  status: 'completed' | 'failed'
) => {
  // Simplified - can be expanded later
};

export const updateQueueDepth = (queueName: string, waiting: number, active: number) => {
  // Simplified - can be expanded later
};

export const updateWorkerHealth = (workerId: string, queueName: string, healthy: boolean) => {
  // Simplified - can be expanded later
};

export const recordConcurrencyLimitHit = (provider: string, chainId: string | number | ChainId) => {
  // Simplified - can be expanded later
};

export const updateActiveConcurrentRequests = (
  provider: string,
  chainId: string | number | ChainId,
  count: number
) => {
  // Simplified - can be expanded later
};

export const updateProviderBudgetUtilization = (provider: string, utilization: number) => {
  // Simplified - can be expanded later
};

export const updateGlobalBudgetUtilization = (utilization: number) => {
  globalBudgetUtilization.set(utilization);
};

export const updateMonthlyCost = (provider: string, cost: number) => {
  // Simplified - can be expanded later
};

// Summary function
export const getMetricsSummary = () => {
  return {
    registry,
    metrics: {
      http: {
        duration: httpDuration,
        requests: httpRequestsTotal,
      },
      provider: {
        duration: providerDuration,
        requests: providerRequestsTotal,
        errors: providerErrorsTotal,
        cost: providerCostUSD,
      },
      cache: {
        hits: cacheHits,
        misses: cacheMisses,
      },
    },
  };
};