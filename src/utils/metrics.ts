import { Registry, collectDefaultMetrics, Histogram, Counter } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'crypto_data_' });

export const httpDuration = new Histogram({
  name: 'crypto_data_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5],
});
registry.registerMetric(httpDuration);

export const providerDuration = new Histogram({
  name: 'crypto_data_provider_request_duration_seconds',
  help: 'Duration of provider API requests in seconds',
  labelNames: ['provider', 'chain_id', 'status'] as const,
  buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10],
});
registry.registerMetric(providerDuration);

export const cacheHits = new Counter({
  name: 'crypto_data_cache_hits_total',
  help: 'Number of cache hits',
  labelNames: ['source'] as const,
});
registry.registerMetric(cacheHits);

export const cacheMisses = new Counter({
  name: 'crypto_data_cache_misses_total',
  help: 'Number of cache misses',
  labelNames: ['source'] as const,
});
registry.registerMetric(cacheMisses);

export const recordProviderCall = (
  provider: string,
  chainId: string | number,
  success: boolean,
  ms: number
) => {
  providerDuration
    .labels(provider, String(chainId), success ? 'success' : 'error')
    .observe(ms / 1000);
};

export const recordCacheEvent = (hit: boolean, source: string = 'redis') => {
  if (hit) cacheHits.labels(source).inc();
  else cacheMisses.labels(source).inc();
};
