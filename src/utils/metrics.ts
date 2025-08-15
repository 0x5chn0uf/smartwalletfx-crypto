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

// Provider Metrics (Enhanced for Phase 2)
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

export const providerRetryAttempts = new Histogram({
  name: 'crypto_data_provider_retry_attempts',
  help: 'Number of retry attempts per provider request',
  labelNames: ['provider', 'chain_id', 'operation'] as const,
  buckets: [1, 2, 3, 4, 5, 10],
});
registry.registerMetric(providerRetryAttempts);

// Cost Tracking Metrics (Phase 2)
export const providerCostUSD = new Counter({
  name: 'crypto_data_provider_cost_usd_total',
  help: 'Total cost in USD for provider requests',
  labelNames: ['provider', 'chain_id'] as const,
});
registry.registerMetric(providerCostUSD);

export const providerBudgetUtilization = new Gauge({
  name: 'crypto_data_provider_budget_utilization_ratio',
  help: 'Provider budget utilization ratio (0-1)',
  labelNames: ['provider'] as const,
});
registry.registerMetric(providerBudgetUtilization);

export const globalBudgetUtilization = new Gauge({
  name: 'crypto_data_global_budget_utilization_ratio',
  help: 'Global budget utilization ratio (0-1)',
});
registry.registerMetric(globalBudgetUtilization);

export const monthlyCostGauge = new Gauge({
  name: 'crypto_data_monthly_cost_usd',
  help: 'Current monthly cost in USD',
  labelNames: ['provider'] as const,
});
registry.registerMetric(monthlyCostGauge);

// BullMQ Worker Metrics (Phase 2)
export const queueDepth = new Gauge({
  name: 'crypto_data_queue_depth',
  help: 'Current depth of job queues',
  labelNames: ['queue_name', 'status'] as const,
});
registry.registerMetric(queueDepth);

export const workerJobsProcessed = new Counter({
  name: 'crypto_data_worker_jobs_processed_total',
  help: 'Total number of jobs processed by workers',
  labelNames: ['queue_name', 'worker_id', 'status'] as const,
});
registry.registerMetric(workerJobsProcessed);

export const workerJobDuration = new Histogram({
  name: 'crypto_data_worker_job_duration_seconds',
  help: 'Duration of worker job processing',
  labelNames: ['queue_name', 'job_type'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
});
registry.registerMetric(workerJobDuration);

export const workerHealth = new Gauge({
  name: 'crypto_data_worker_health',
  help: 'Worker health status (1 = healthy, 0 = unhealthy)',
  labelNames: ['worker_id', 'queue_name'] as const,
});
registry.registerMetric(workerHealth);

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

export const cacheOperationDuration = new Histogram({
  name: 'crypto_data_cache_operation_duration_seconds',
  help: 'Duration of cache operations',
  labelNames: ['operation', 'result'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
});
registry.registerMetric(cacheOperationDuration);

// Concurrency Metrics
export const concurrencyLimitHits = new Counter({
  name: 'crypto_data_concurrency_limit_hits_total',
  help: 'Number of times concurrency limits were hit',
  labelNames: ['provider', 'chain_id'] as const,
});
registry.registerMetric(concurrencyLimitHits);

export const activeConcurrentRequests = new Gauge({
  name: 'crypto_data_active_concurrent_requests',
  help: 'Current number of active concurrent requests',
  labelNames: ['provider', 'chain_id'] as const,
});
registry.registerMetric(activeConcurrentRequests);

// Enhanced Provider Recording Functions
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
  
  // Record duration
  providerDuration
    .labels(provider, chainIdStr, operation, status, errorLabel)
    .observe(durationMs / 1000);
  
  // Record request count
  providerRequestsTotal
    .labels(provider, chainIdStr, operation, status, errorLabel)
    .inc();
  
  // Record error if failed
  if (!success && errorCode) {
    providerErrorsTotal
      .labels(provider, chainIdStr, 'request_error', errorCode)
      .inc();
  }
  
  // Record retry attempts
  if (retryAttempts && retryAttempts > 1) {
    providerRetryAttempts
      .labels(provider, chainIdStr, operation)
      .observe(retryAttempts);
  }
  
  // Record cost
  if (cost && cost > 0) {
    providerCostUSD
      .labels(provider, chainIdStr)
      .inc(cost);
  }
};

export const recordCacheEvent = (hit: boolean, source: string = 'redis', operation: string = 'get') => {
  if (hit) {
    cacheHits.labels(source, operation).inc();
  } else {
    cacheMisses.labels(source, operation).inc();
  }
};

export const recordCacheOperation = (operation: string, durationMs: number, success: boolean) => {
  const result = success ? 'success' : 'error';
  cacheOperationDuration
    .labels(operation, result)
    .observe(durationMs / 1000);
};

// Cost Tracking Functions
export const updateProviderBudgetUtilization = (provider: string, utilization: number) => {
  providerBudgetUtilization.labels(provider).set(utilization);
};

export const updateGlobalBudgetUtilization = (utilization: number) => {
  globalBudgetUtilization.set(utilization);
};

export const updateMonthlyCost = (provider: string, cost: number) => {
  monthlyCostGauge.labels(provider).set(cost);
};

// Worker Metrics Functions
export const recordWorkerJob = (
  queueName: string,
  workerId: string,
  status: 'completed' | 'failed',
  durationMs?: number,
  jobType?: string
) => {
  workerJobsProcessed.labels(queueName, workerId, status).inc();
  
  if (durationMs && jobType) {
    workerJobDuration.labels(queueName, jobType).observe(durationMs / 1000);
  }
};

export const updateQueueDepth = (queueName: string, waiting: number, active: number, completed: number, failed: number) => {
  queueDepth.labels(queueName, 'waiting').set(waiting);
  queueDepth.labels(queueName, 'active').set(active);
  queueDepth.labels(queueName, 'completed').set(completed);
  queueDepth.labels(queueName, 'failed').set(failed);
};

export const updateWorkerHealth = (workerId: string, queueName: string, healthy: boolean) => {
  workerHealth.labels(workerId, queueName).set(healthy ? 1 : 0);
};

// Concurrency Metrics Functions
export const recordConcurrencyLimitHit = (provider: string, chainId: string | number | ChainId) => {
  concurrencyLimitHits.labels(provider, String(chainId)).inc();
};

export const updateActiveConcurrentRequests = (provider: string, chainId: string | number | ChainId, count: number) => {
  activeConcurrentRequests.labels(provider, String(chainId)).set(count);
};

// HTTP Metrics Functions
export const recordHttpRequest = (method: string, route: string, statusCode: number, durationMs: number) => {
  const statusStr = String(statusCode);
  
  httpDuration
    .labels(method, route, statusStr)
    .observe(durationMs / 1000);
  
  httpRequestsTotal
    .labels(method, route, statusStr)
    .inc();
};

// Metrics aggregation for dashboards
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
        retries: providerRetryAttempts,
        cost: providerCostUSD,
        budgetUtilization: providerBudgetUtilization,
      },
      cache: {
        hits: cacheHits,
        misses: cacheMisses,
        duration: cacheOperationDuration,
      },
      workers: {
        queueDepth,
        jobsProcessed: workerJobsProcessed,
        jobDuration: workerJobDuration,
        health: workerHealth,
      },
      concurrency: {
        limitHits: concurrencyLimitHits,
        activeRequests: activeConcurrentRequests,
      },
      budget: {
        global: globalBudgetUtilization,
        monthly: monthlyCostGauge,
      },
    },
  };
};