# Performance Testing and Profiling Guide

This guide covers comprehensive performance testing and profiling for the crypto data service.

## 🚀 Quick Start

### Load Testing

```bash
# Basic stress test (50 users, 100 requests each)
npm run load-test:stress

# Memory stress test (100 users, 1000 requests each)
npm run load-test:memory

# Spike test (500 users, immediate spike)
npm run load-test:spike
```

### Benchmarking

```bash
# Run comprehensive benchmarks
npm run benchmark

# With garbage collection for accurate memory measurements
node --expose-gc node_modules/.bin/tsx scripts/benchmark.ts
```

### Performance Profiling

```bash
# Profile for 60 seconds
npm run profile

# Profile during load testing
npm run profile:load

# Memory leak detection
npm run profile:memory
```

## 📊 Load Testing

### Test Types

#### Stress Testing
- **Purpose**: Test normal load capacity
- **Config**: 50 concurrent users, 100 requests each
- **Duration**: ~5 minutes with ramp-up
- **Endpoints**: Weighted distribution across all API endpoints

#### Memory Testing
- **Purpose**: Test memory usage under sustained load
- **Config**: 100 concurrent users, 1000 requests each
- **Duration**: 5 minutes continuous load
- **Focus**: Deep portfolio analysis with memory-intensive operations

#### Spike Testing
- **Purpose**: Test sudden traffic spikes
- **Config**: 500 concurrent users, immediate spike
- **Duration**: 30 seconds high intensity
- **Focus**: Health checks and basic portfolio analysis

### Configuration

Customize load tests via environment variables:

```bash
export TEST_BASE_URL="http://localhost:3000"
export CONCURRENT_USERS=100
export REQUESTS_PER_USER=50
export RAMP_UP_MS=10000
export TEST_DURATION_MS=120000

npm run load-test:stress
```

### Test Endpoints

| Endpoint | Weight | Purpose |
|----------|--------|---------|
| `/api/health` | 2 | Basic health check |
| `/api/portfolio/analyze` | 8 | Core portfolio analysis |
| `/api/portfolio/async` | 6 | Async portfolio processing |
| `/api/analytics/portfolio-summary` | 5 | Portfolio summaries |
| `/api/defi/positions` | 7 | DeFi position data |
| `/api/nft/collections` | 4 | NFT collection data |

### Performance Thresholds

- **Error Rate**: < 5%
- **P95 Latency**: < 5 seconds
- **Min RPS**: > 10 requests/second

## 🔬 Benchmarking

### Benchmark Categories

#### Event Bus Performance
- Simple event publishing (10,000 iterations)
- Large payload events (1,000 iterations)
- Events with active subscribers (5,000 iterations)

#### Portfolio Service Performance
- Portfolio analysis requests (1,000 iterations)
- Batch portfolio processing (100 iterations)

#### Cost Optimization Performance
- Provider selection (10,000 iterations)
- Batch optimization (100 iterations)

#### Memory Operations
- Object creation/destruction (10,000 iterations)
- Array manipulations (1,000 iterations)
- JSON serialization (1,000 iterations)

#### Concurrent Operations
- Promise.all with 10 operations (1,000 iterations)
- Promise.all with 100 operations (100 iterations)
- EventEmitter with 100 listeners (10,000 iterations)

### Benchmark Results

Benchmark reports include:
- Average, min, max execution times
- Operations per second
- Memory usage deltas
- Performance warnings and recommendations

## 📈 Performance Profiling

### Real-time Profiling

The performance profiler monitors:
- CPU usage
- Memory consumption
- Event loop delay
- System load
- Custom metrics

### Alert Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Memory Usage | 85% | 90% |
| Event Loop Delay | 50ms | 100ms |
| CPU Usage | 70% | 80% |
| Free Memory | 1GB | 500MB |
| System Load | 80% of CPU count | 90% of CPU count |

### Profile Reports

Performance reports include:
- System information
- Timeline of metrics
- Alert summary
- Performance issue analysis
- Optimization recommendations

### Memory Leak Detection

The memory leak detector:
- Takes baseline measurements
- Monitors memory growth patterns
- Detects consistent memory increases
- Provides leak analysis

## 🎯 Performance Optimization

### Event Bus Optimization

#### In-Memory Event Bus
- **Strength**: Ultra-fast for development/testing
- **Weakness**: No persistence, single-process only
- **Optimization**: Use for high-frequency, non-critical events

#### BullMQ Event Bus
- **Strength**: Persistent, distributed, retry logic
- **Weakness**: Redis dependency, network overhead
- **Optimization**: Use for critical events requiring persistence

### Portfolio Processing Optimization

#### Async Processing
- **Benefit**: Non-blocking operations
- **Cost**: Complexity in status tracking
- **Optimization**: Use for heavy computational tasks

#### Request Batching
- **Benefit**: Reduced API calls and costs
- **Cost**: Increased latency for individual requests
- **Optimization**: Batch size tuning based on load patterns

#### Caching Strategy
- **L1 Cache**: In-memory for ultra-fast access
- **L2 Cache**: Redis for shared cache across instances
- **TTL Strategy**: Different TTLs based on data volatility

### Cost Optimization

#### Provider Selection
- **Strategy**: Dynamic provider routing based on cost and performance
- **Metrics**: Cost per request, response time, error rate
- **Optimization**: Machine learning for optimal provider selection

#### Request Deduplication
- **Benefit**: Eliminate redundant API calls
- **Implementation**: Hash-based request fingerprinting
- **Window**: Configurable deduplication time window

## 📋 Performance Monitoring in Production

### Metrics Collection

#### Prometheus Metrics
```prometheus
# Event processing
event_latency_ms_bucket
events_published_total
events_consumed_total

# Portfolio processing
worker_job_duration_ms_bucket
async_portfolio_requests_total

# Cost optimization
provider_cost_usd_total
cache_hits_total
cache_misses_total

# System health
http_requests_total
nodejs_heap_size_used_bytes
nodejs_heap_size_total_bytes
```

#### Custom Application Metrics
```typescript
// Mark performance-critical operations
profiler.markStart('portfolio-analysis');
// ... operation ...
profiler.markEnd('portfolio-analysis');

// Add custom metrics
profiler.addCustomMetric('cache-hit-rate', hitRate);
profiler.addCustomMetric('provider-selection-time', selectionTime);
```

### Grafana Dashboards

The monitoring dashboard includes:
- Event bus performance metrics
- Portfolio processing statistics
- Cost optimization efficiency
- System health indicators
- Alert status and history

### Alerting Rules

Prometheus alerts monitor:
- High event processing latency
- Growing event backlogs
- Excessive API spending
- Low cache hit rates
- High worker job duration
- System resource exhaustion

## 🔧 Troubleshooting Performance Issues

### High Latency

1. **Check Event Loop Delay**
   ```bash
   npm run profile
   # Look for event loop delay > 50ms
   ```

2. **Analyze Slow Operations**
   ```bash
   npm run benchmark
   # Identify operations with high avg time
   ```

3. **Monitor Database Queries**
   - Check for missing indexes
   - Optimize complex queries
   - Implement query caching

### High Memory Usage

1. **Memory Leak Detection**
   ```bash
   npm run profile:memory
   # Run for extended period (30+ minutes)
   ```

2. **Object Pool Analysis**
   - Monitor object creation patterns
   - Implement object pooling for frequent allocations
   - Use memory profilers for detailed analysis

3. **Cache Size Optimization**
   - Monitor cache memory usage
   - Implement LRU eviction policies
   - Tune cache size limits

### High CPU Usage

1. **CPU Profiling**
   ```bash
   node --prof src/index.js
   node --prof-process isolate-*.log > cpu-profile.txt
   ```

2. **Concurrent Processing**
   - Implement worker threads for CPU-intensive tasks
   - Use async/await properly to avoid blocking
   - Optimize algorithmic complexity

### Poor Throughput

1. **Load Testing Analysis**
   ```bash
   npm run load-test:stress
   # Analyze requests/second and error rates
   ```

2. **Bottleneck Identification**
   - Database connection pool size
   - Redis connection limits
   - External API rate limits
   - Network bandwidth constraints

3. **Scaling Strategies**
   - Horizontal scaling with load balancers
   - Database read replicas
   - CDN for static content
   - Microservice decomposition

## 📚 Additional Resources

### Documentation
- [Event-Driven Architecture Guide](./architecture.md)
- [Monitoring Setup Guide](../monitoring/README.md)
- [Deployment Guide](./deployment.md)

### Tools
- [Grafana Dashboard](../monitoring/grafana-dashboard.json)
- [Prometheus Alerts](../monitoring/alerts.yml)
- [Kubernetes Monitoring](../monitoring/setup-monitoring.sh)

### Performance Testing Tools
- Load testing: Custom TypeScript implementation
- Benchmarking: Native Node.js performance APIs
- Profiling: Built-in performance observers
- Memory analysis: V8 heap snapshots and GC monitoring
