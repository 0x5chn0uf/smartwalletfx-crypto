# SmartWalletFX Phase 3 Performance Tuning Guide

> **Comprehensive guide for optimizing SmartWalletFX Crypto Data Service performance with Phase 3 enhancements**

## 🎯 Overview

This guide provides detailed performance tuning recommendations, optimization parameters, and best practices for achieving optimal performance in the SmartWalletFX Crypto Data Service Phase 3 production environment.

## 📋 Table of Contents

1. [Performance Baselines](#performance-baselines)
2. [Configuration Optimization](#configuration-optimization)
3. [Database Tuning](#database-tuning)
4. [Cache Optimization](#cache-optimization)
5. [API Provider Optimization](#api-provider-optimization)
6. [Container and Kubernetes Tuning](#container-and-kubernetes-tuning)
7. [Monitoring and Profiling](#monitoring-and-profiling)
8. [Troubleshooting Performance Issues](#troubleshooting-performance-issues)

## 📋 Performance Baselines

### Phase 3 Target Metrics

| Metric | Target | Measurement |
|--------|--------|-----------|
| Response Time (p95) | < 200ms | Portfolio aggregation |
| Response Time (p99) | < 500ms | Complex DeFi queries |
| Throughput | 2000+ RPS | Sustained load |
| Cache Hit Rate | > 90% | L1/L2/L3 combined |
| Error Rate | < 0.1% | All endpoints |
| Cost per Request | < $0.001 | API provider costs |
| Memory Usage | < 80% | Pod memory limit |
| CPU Usage | < 70% | Pod CPU limit |

### Benchmark Results (Phase 3)

```bash
# Performance benchmark results
Portfolio Endpoint:
  - p50: 45ms
  - p95: 180ms
  - p99: 420ms
  - Max throughput: 2,400 RPS
  
DeFi Positions:
  - p50: 65ms
  - p95: 220ms
  - p99: 480ms
  - Max throughput: 1,800 RPS
  
NFT Collections:
  - p50: 55ms
  - p95: 200ms
  - p99: 450ms
  - Max throughput: 2,000 RPS
```

## ⚙️ Configuration Optimization

### Environment Variables

#### Core Performance Settings
```bash
# Node.js Performance
NODE_ENV=production
NODE_OPTIONS="--max-old-space-size=4096 --optimize-for-size"
UV_THREADPOOL_SIZE=128

# Application Performance
MAX_CONCURRENT_REQUESTS=1000
REQUEST_TIMEOUT=30000
GRACEFUL_SHUTDOWN_TIMEOUT=15000

# Worker Threads
WORKER_THREADS_COUNT=8
WORKER_QUEUE_SIZE=10000
WORKER_BATCH_SIZE=50
```

#### Cache Configuration
```bash
# Multi-level Cache Settings
L1_CACHE_SIZE=256MB
L1_CACHE_TTL=300

L2_CACHE_SIZE=2GB
L2_CACHE_TTL=3600

L3_CACHE_TTL=86400
CACHE_WARM_ENABLED=true
CACHE_WARM_INTERVAL=600

# Redis Performance
REDIS_POOL_SIZE=50
REDIS_CONNECT_TIMEOUT=5000
REDIS_COMMAND_TIMEOUT=3000
REDIS_RETRY_ATTEMPTS=3
```

#### Database Optimization
```bash
# Connection Pool
DB_POOL_MIN=10
DB_POOL_MAX=50
DB_ACQUIRE_TIMEOUT=30000
DB_IDLE_TIMEOUT=600000

# Query Performance
DB_STATEMENT_TIMEOUT=30000
DB_QUERY_TIMEOUT=15000
DB_ENABLE_QUERY_CACHE=true
DB_QUERY_CACHE_SIZE=100MB
```

### Application Configuration

#### Express.js Optimization
```typescript
// config/express.ts
import compression from 'compression';
import { createServer } from 'http';

const app = express();

// Performance middleware
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// Optimize HTTP server
const server = createServer(app);
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.maxRequestsPerSocket = 1000;
server.timeout = 120000;
```

#### Request Processing
```typescript
// Enhanced request batching
class RequestBatchProcessor {
  private batchSize = parseInt(process.env.BATCH_SIZE || '50');
  private batchTimeout = parseInt(process.env.BATCH_TIMEOUT || '100');
  private maxConcurrency = parseInt(process.env.MAX_CONCURRENCY || '20');
  
  async processBatch(requests: Request[]): Promise<Response[]> {
    const batches = this.createOptimalBatches(requests);
    
    return await Promise.all(
      batches.map(batch => 
        this.limiter.schedule(() => this.executeBatch(batch))
      )
    );
  }
  
  private createOptimalBatches(requests: Request[]): Request[][] {
    // Optimize batch sizes based on request types
    const grouped = this.groupByType(requests);
    return grouped.map(group => 
      this.chunkArray(group, this.getOptimalBatchSize(group[0]))
    ).flat();
  }
}
```

## 💾 Database Tuning

### PostgreSQL Configuration

#### Connection and Memory Settings
```sql
-- postgresql.conf optimizations
max_connections = 200
shared_buffers = 2GB
effective_cache_size = 6GB
work_mem = 64MB
maintenance_work_mem = 512MB

-- WAL settings for performance
wal_buffers = 64MB
checkpoint_completion_target = 0.9
checkpoint_timeout = 15min
max_wal_size = 4GB
min_wal_size = 1GB

-- Query optimization
random_page_cost = 1.1
effective_io_concurrency = 200
max_worker_processes = 16
max_parallel_workers = 8
max_parallel_workers_per_gather = 4
```

#### Index Optimization
```sql
-- Performance-critical indexes
CREATE INDEX CONCURRENTLY idx_user_wallets_address_chain 
  ON user_wallets (address, chain_id) 
  WHERE active = true;

CREATE INDEX CONCURRENTLY idx_defi_positions_user_protocol 
  ON defi_positions (user_wallet_id, protocol, updated_at DESC);

CREATE INDEX CONCURRENTLY idx_price_cache_composite 
  ON price_cache (token_address, chain_id, created_at DESC);

-- Partial indexes for frequent queries
CREATE INDEX CONCURRENTLY idx_portfolio_recent 
  ON portfolio_snapshots (user_wallet_id, created_at DESC) 
  WHERE created_at > NOW() - INTERVAL '7 days';
```

#### Query Optimization
```sql
-- Optimized portfolio query
WITH portfolio_summary AS (
  SELECT 
    uw.address,
    SUM(tb.value_usd) as total_value,
    COUNT(DISTINCT tb.token_address) as token_count
  FROM user_wallets uw
  JOIN token_balances tb ON uw.id = tb.user_wallet_id
  WHERE uw.address = $1 
    AND tb.balance > 0
    AND tb.updated_at > NOW() - INTERVAL '1 hour'
  GROUP BY uw.address
)
SELECT * FROM portfolio_summary;

-- Use prepared statements
PREPARE get_portfolio(text) AS
SELECT 
  address,
  total_value_usd,
  last_updated
FROM portfolio_cache 
WHERE address = $1 
  AND last_updated > NOW() - INTERVAL '15 minutes';
```

### Database Monitoring

```sql
-- Performance monitoring queries
-- Slow query analysis
SELECT 
  query,
  calls,
  total_time,
  mean_time,
  rows
FROM pg_stat_statements 
WHERE mean_time > 100 
ORDER BY mean_time DESC 
LIMIT 10;

-- Index usage statistics
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes 
WHERE idx_tup_read > 0 
ORDER BY idx_tup_read DESC;

-- Connection monitoring
SELECT 
  state,
  COUNT(*) as connections,
  AVG(EXTRACT(EPOCH FROM (now() - query_start))) as avg_duration
FROM pg_stat_activity 
WHERE state IS NOT NULL 
GROUP BY state;
```

## 📏 Cache Optimization

### Multi-Level Cache Configuration

#### L1 Cache (Memory)
```typescript
// config/cache.ts
class L1MemoryCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize = parseInt(process.env.L1_CACHE_SIZE || '256') * 1024 * 1024;
  private ttl = parseInt(process.env.L1_CACHE_TTL || '300') * 1000;
  
  constructor() {
    // Implement LRU eviction
    this.setupEviction();
  }
  
  async get(key: string): Promise<any> {
    const entry = this.cache.get(key);
    if (!entry || this.isExpired(entry)) {
      this.cache.delete(key);
      return null;
    }
    
    // Update access time for LRU
    entry.lastAccess = Date.now();
    return entry.value;
  }
  
  private setupEviction() {
    setInterval(() => {
      this.evictExpired();
      this.evictLRU();
    }, 30000); // Every 30 seconds
  }
}
```

#### L2 Cache (Redis)
```typescript
// Enhanced Redis configuration
class OptimizedRedisCache {
  private cluster: Redis.Cluster;
  
  constructor() {
    this.cluster = new Redis.Cluster([
      { host: 'redis-1', port: 6379 },
      { host: 'redis-2', port: 6379 },
      { host: 'redis-3', port: 6379 }
    ], {
      redisOptions: {
        password: process.env.REDIS_PASSWORD,
        connectTimeout: 5000,
        commandTimeout: 3000,
        retryDelayOnFailover: 1000,
        maxRetriesPerRequest: 3,
        enableOfflineQueue: false
      },
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100
    });
  }
  
  async mget(keys: string[]): Promise<(string | null)[]> {
    // Batch multiple gets for efficiency
    const pipeline = this.cluster.pipeline();
    keys.forEach(key => pipeline.get(key));
    const results = await pipeline.exec();
    return results.map(result => result[1] as string | null);
  }
}
```

### Cache Warming Strategy

```typescript
// Predictive cache warming
class PredictiveCacheWarming {
  private patterns = new Map<string, AccessPattern>();
  
  async warmCache(): Promise<void> {
    const predictions = await this.predictHotData();
    
    await Promise.all([
      this.warmPortfolioData(predictions.portfolios),
      this.warmPriceData(predictions.tokens),
      this.warmProtocolData(predictions.protocols)
    ]);
  }
  
  private async predictHotData(): Promise<WarmingPrediction> {
    // Analyze access patterns
    const recentAccess = await this.getRecentAccessPatterns();
    const timePatterns = this.analyzeTimeBasedPatterns(recentAccess);
    const userPatterns = this.analyzeUserBehaviorPatterns(recentAccess);
    
    return this.generatePredictions(timePatterns, userPatterns);
  }
}
```

## 🔌 API Provider Optimization

### Intelligent Provider Routing

```typescript
// Provider optimization configuration
class IntelligentProviderRouter {
  private providers = new Map<string, ProviderConfig>();
  private metrics = new Map<string, ProviderMetrics>();
  
  constructor() {
    this.initializeProviders();
    this.startMetricsCollection();
  }
  
  private initializeProviders() {
    this.providers.set('alchemy', {
      cost: 0.0005,
      rateLimit: 1000,
      reliability: 0.999,
      latency: 150,
      regions: ['us-east', 'us-west', 'eu-west']
    });
    
    this.providers.set('helius', {
      cost: 0.0003,
      rateLimit: 2000,
      reliability: 0.995,
      latency: 200,
      regions: ['us-east', 'us-west']
    });
  }
  
  async route(request: ProviderRequest): Promise<string> {
    const candidates = this.getAvailableProviders(request);
    const scored = candidates.map(provider => ({
      provider,
      score: this.calculateScore(provider, request)
    }));
    
    return scored.sort((a, b) => b.score - a.score)[0].provider;
  }
  
  private calculateScore(provider: string, request: ProviderRequest): number {
    const config = this.providers.get(provider)!;
    const metrics = this.metrics.get(provider)!;
    
    // Weight factors
    const costWeight = 0.3;
    const latencyWeight = 0.3;
    const reliabilityWeight = 0.4;
    
    const costScore = 1 - (config.cost / 0.001); // Normalize to max cost
    const latencyScore = 1 - (metrics.avgLatency / 1000); // Normalize to 1s
    const reliabilityScore = config.reliability;
    
    return (costScore * costWeight) + 
           (latencyScore * latencyWeight) + 
           (reliabilityScore * reliabilityWeight);
  }
}
```

### Request Deduplication

```typescript
// Advanced request deduplication
class RequestDeduplicationService {
  private pendingRequests = new Map<string, Promise<any>>();
  private requestWindow = 5000; // 5 seconds
  
  async deduplicate<T>(key: string, executor: () => Promise<T>): Promise<T> {
    const existing = this.pendingRequests.get(key);
    if (existing) {
      return existing as Promise<T>;
    }
    
    const promise = executor();
    this.pendingRequests.set(key, promise);
    
    // Clean up after completion
    promise.finally(() => {
      setTimeout(() => {
        this.pendingRequests.delete(key);
      }, this.requestWindow);
    });
    
    return promise;
  }
  
  generateKey(request: any): string {
    // Create deterministic key from request parameters
    const normalized = this.normalizeRequest(request);
    return crypto.createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex');
  }
}
```

## 📦 Container and Kubernetes Tuning

### Container Optimization

#### Dockerfile Improvements
```dockerfile
# Multi-stage optimized build
FROM node:20-alpine AS base
RUN apk add --no-cache dumb-init
WORKDIR /app
COPY package*.json ./

FROM base AS dependencies
RUN npm ci --only=production && npm cache clean --force

FROM base AS build
RUN npm ci
COPY . .
RUN npm run build && npm prune --production

FROM node:20-alpine AS runtime
RUN apk add --no-cache dumb-init
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S node -u 1001 -G nodejs

# Copy optimized dependencies and build
COPY --from=dependencies --chown=node:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=node:nodejs /app/dist ./dist
COPY --from=build --chown=node:nodejs /app/package.json ./package.json

USER node
EXPOSE 3000

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
```

### Kubernetes Resource Configuration

#### Pod Specifications
```yaml
# k8s/deployment-optimized.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: crypto-data-api-optimized
spec:
  replicas: 6
  template:
    spec:
      containers:
      - name: app
        image: smartwalletfx/crypto-data:latest
        resources:
          requests:
            memory: "2Gi"
            cpu: "1000m"
          limits:
            memory: "4Gi"
            cpu: "2000m"
        env:
        - name: NODE_OPTIONS
          value: "--max-old-space-size=3584 --optimize-for-size"
        - name: UV_THREADPOOL_SIZE
          value: "128"
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
        livenessProbe:
          httpGet:
            path: /health/live
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
        lifecycle:
          preStop:
            exec:
              command: ["/bin/sh", "-c", "sleep 15"]
      terminationGracePeriodSeconds: 30
```

#### Horizontal Pod Autoscaler
```yaml
# k8s/hpa-optimized.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: crypto-data-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: crypto-data-api-optimized
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  - type: Pods
    pods:
      metric:
        name: requests_per_second
      target:
        type: AverageValue
        averageValue: "1000"
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 100
        periodSeconds: 15
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 10
        periodSeconds: 60
```

## 📊 Monitoring and Profiling

### Performance Monitoring

#### Custom Metrics Collection
```typescript
// Performance monitoring implementation
class PerformanceMonitor {
  private metrics = {
    httpRequestDuration: new promClient.Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5]
    }),
    
    cacheHitRate: new promClient.Gauge({
      name: 'cache_hit_rate',
      help: 'Cache hit rate percentage',
      labelNames: ['cache_level']
    }),
    
    apiCostTotal: new promClient.Counter({
      name: 'api_cost_usd_total',
      help: 'Total API costs in USD',
      labelNames: ['provider', 'endpoint']
    })
  };
  
  recordRequestDuration(method: string, route: string, statusCode: number, duration: number) {
    this.metrics.httpRequestDuration
      .labels(method, route, statusCode.toString())
      .observe(duration / 1000);
  }
  
  recordCacheHit(level: string, hit: boolean) {
    const currentRate = this.getCacheHitRate(level);
    const newRate = hit ? currentRate + 0.1 : currentRate - 0.1;
    this.metrics.cacheHitRate
      .labels(level)
      .set(Math.max(0, Math.min(100, newRate)));
  }
}
```

#### Application Performance Monitoring
```typescript
// APM integration
class ApplicationPerformanceMonitoring {
  private tracer: any;
  
  constructor() {
    this.initializeTracing();
  }
  
  private initializeTracing() {
    // Distributed tracing setup
    this.tracer = require('dd-trace').init({
      service: 'crypto-data-api',
      env: process.env.NODE_ENV,
      version: process.env.APP_VERSION,
      profiling: true,
      runtimeMetrics: true
    });
  }
  
  async traceFunction<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return this.tracer.trace(name, async (span: any) => {
      try {
        const result = await fn();
        span.setTag('success', true);
        return result;
      } catch (error) {
        span.setTag('error', true);
        span.setTag('error.message', error.message);
        throw error;
      }
    });
  }
}
```

### Profiling Tools

#### CPU Profiling
```bash
#!/bin/bash
# cpu-profile.sh

# Start CPU profiling
kubectl exec -it <pod-name> -- node --prof dist/index.js &
PID=$!

# Run load test
npm run test:load:extended

# Stop and analyze
kill $PID
kubectl exec -it <pod-name> -- node --prof-process isolate-*.log > cpu-profile.txt

# Analyze results
echo "Top CPU consumers:"
grep "\[JavaScript\]" cpu-profile.txt | head -20
```

#### Memory Profiling
```bash
#!/bin/bash
# memory-profile.sh

# Generate heap dump
kubectl exec -it <pod-name> -- kill -USR2 <node-pid>

# Download and analyze
kubectl cp <pod-name>:/app/heapdump.* ./heapdump.snapshot
node --inspect-brk analyze-heap.js heapdump.snapshot

# Memory leak detection
echo "Checking for memory leaks..."
node scripts/memory-leak-detector.js
```

## 🔧 Troubleshooting Performance Issues

### Common Performance Problems

#### High Response Times

**Symptoms**:
- p95 response time > 500ms
- Increased request timeouts
- User complaints about slowness

**Investigation Steps**:
```bash
# Check application metrics
prometheus-query 'histogram_quantile(0.95, http_request_duration_seconds_bucket)'

# Identify slow endpoints
prometheus-query 'topk(10, histogram_quantile(0.95, http_request_duration_seconds_bucket) by (route))'

# Check database performance
psql $DATABASE_URL -c "SELECT query, mean_time, calls FROM pg_stat_statements WHERE mean_time > 100 ORDER BY mean_time DESC LIMIT 10;"

# Analyze cache performance
redis-cli info stats | grep -E "hit|miss"
```

**Resolution**:
1. Optimize slow database queries
2. Increase cache TTL for stable data
3. Enable request batching
4. Scale up resources if needed

#### Memory Leaks

**Symptoms**:
- Gradually increasing memory usage
- Pod restarts due to OOM
- Performance degradation over time

**Investigation**:
```bash
# Monitor memory trends
kubectl top pods --sort-by=memory

# Generate heap dump
kubectl exec -it <pod> -- node -e "require('v8').writeHeapSnapshot('./heap.snapshot')"

# Analyze with Chrome DevTools
node --inspect-brk=0.0.0.0:9229 dist/index.js
```

#### High API Costs

**Symptoms**:
- Monthly budget exceeded
- Cost per request increasing
- Provider rate limiting

**Investigation**:
```bash
# Analyze cost trends
prometheus-query 'rate(api_cost_usd_total[24h])'

# Cost by provider
prometheus-query 'sum by (provider) (rate(api_cost_usd_total[24h]))'

# Most expensive endpoints
prometheus-query 'topk(10, sum by (endpoint) (rate(api_cost_usd_total[24h])))'
```

**Resolution**:
1. Increase cache hit rates
2. Implement more aggressive batching
3. Optimize provider routing
4. Enable request deduplication

### Performance Optimization Checklist

#### Application Level
- [ ] Request batching enabled
- [ ] Connection pooling optimized
- [ ] Caching strategy implemented
- [ ] Request deduplication active
- [ ] Provider routing optimized

#### Database Level
- [ ] Indexes optimized for queries
- [ ] Connection pool sized correctly
- [ ] Query performance analyzed
- [ ] Vacuum and analyze scheduled

#### Infrastructure Level
- [ ] Pod resources right-sized
- [ ] Auto-scaling configured
- [ ] Load balancing optimized
- [ ] Network policies efficient

#### Monitoring Level
- [ ] Key metrics tracked
- [ ] Alerts configured
- [ ] Dashboards created
- [ ] SLA monitoring active

---

**Document Version**: 1.0  
**Last Updated**: Phase 3 Release  
**Maintained By**: Performance Engineering Team

*For performance-related questions, contact: performance@smartwalletfx.com*