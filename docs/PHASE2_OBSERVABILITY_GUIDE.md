# Phase 2 Observability & Monitoring Guide

**Enterprise-Grade Monitoring for Crypto Data Service**

This guide documents the comprehensive observability stack implemented in Phase 2, providing production-ready monitoring, cost tracking, and precision financial calculations.

## 🎯 Overview

Phase 2 introduces enterprise-grade observability features:

- **15+ Prometheus Metrics** - Comprehensive provider, worker, and cost monitoring
- **Real-time Cost Tracking** - Per-provider budget utilization and alerts
- **Worker Health Monitoring** - BullMQ queue depth and worker status tracking
- **Financial Precision Safety** - Custom MoneyDecimal for accurate monetary calculations
- **Grafana Dashboards** - Production monitoring visualizations
- **Integration & Contract Tests** - Comprehensive testing with stubbed dependencies

## 📊 Metrics Catalog

### Provider Performance Metrics

#### `crypto_data_provider_request_duration_seconds`
**Type:** Histogram  
**Labels:** `provider`, `chain_id`, `operation`, `status`, `error_code`  
**Description:** Duration of provider API requests in seconds
```promql
# P95 response time by provider
histogram_quantile(0.95, rate(crypto_data_provider_request_duration_seconds_bucket[5m]))

# Average response time for Alchemy on Ethereum
rate(crypto_data_provider_request_duration_seconds_sum{provider="Alchemy",chain_id="1"}[5m]) 
/ rate(crypto_data_provider_request_duration_seconds_count{provider="Alchemy",chain_id="1"}[5m])
```

#### `crypto_data_provider_requests_total`
**Type:** Counter  
**Labels:** `provider`, `chain_id`, `operation`, `status`, `error_code`  
**Description:** Total number of provider API requests
```promql
# Request rate by provider
rate(crypto_data_provider_requests_total[5m])

# Success rate for all providers
rate(crypto_data_provider_requests_total{status="success"}[5m]) 
/ rate(crypto_data_provider_requests_total[5m])
```

#### `crypto_data_provider_errors_total`
**Type:** Counter  
**Labels:** `provider`, `chain_id`, `error_type`, `error_code`  
**Description:** Total number of provider errors
```promql
# Error rate by provider
rate(crypto_data_provider_errors_total[5m])

# RATE_LIMITED errors specifically
rate(crypto_data_provider_errors_total{error_code="RATE_LIMITED"}[5m])
```

#### `crypto_data_provider_retry_attempts`
**Type:** Histogram  
**Labels:** `provider`, `chain_id`, `operation`  
**Description:** Number of retry attempts per provider request
```promql
# Average retry attempts
rate(crypto_data_provider_retry_attempts_sum[5m]) 
/ rate(crypto_data_provider_retry_attempts_count[5m])
```

### Cost Tracking Metrics

#### `crypto_data_provider_cost_usd_total`
**Type:** Counter  
**Labels:** `provider`, `chain_id`  
**Description:** Total cost in USD for provider requests
```promql
# Hourly cost by provider
rate(crypto_data_provider_cost_usd_total[1h])

# Daily cost projection
rate(crypto_data_provider_cost_usd_total[1h]) * 24
```

#### `crypto_data_provider_budget_utilization_ratio`
**Type:** Gauge  
**Labels:** `provider`  
**Description:** Provider budget utilization ratio (0-1)
```promql
# Providers over 80% budget utilization
crypto_data_provider_budget_utilization_ratio > 0.8

# Budget utilization ranking
sort_desc(crypto_data_provider_budget_utilization_ratio)
```

#### `crypto_data_global_budget_utilization_ratio`
**Type:** Gauge  
**Description:** Global budget utilization ratio (0-1)
```promql
# Global budget alert threshold
crypto_data_global_budget_utilization_ratio > 0.9
```

#### `crypto_data_monthly_cost_usd`
**Type:** Gauge  
**Labels:** `provider`  
**Description:** Current monthly cost in USD
```promql
# Total monthly cost across all providers
sum(crypto_data_monthly_cost_usd)

# Most expensive provider this month
topk(1, crypto_data_monthly_cost_usd)
```

### Worker Health Metrics

#### `crypto_data_queue_depth`
**Type:** Gauge  
**Labels:** `queue_name`, `status`  
**Description:** Current depth of job queues
```promql
# Total pending jobs
sum(crypto_data_queue_depth{status="waiting"})

# Failed jobs that need attention
crypto_data_queue_depth{status="failed"}
```

#### `crypto_data_worker_jobs_processed_total`
**Type:** Counter  
**Labels:** `queue_name`, `worker_id`, `status`  
**Description:** Total number of jobs processed by workers
```promql
# Job processing rate
rate(crypto_data_worker_jobs_processed_total[5m])

# Job success rate
rate(crypto_data_worker_jobs_processed_total{status="completed"}[5m]) 
/ rate(crypto_data_worker_jobs_processed_total[5m])
```

#### `crypto_data_worker_job_duration_seconds`
**Type:** Histogram  
**Labels:** `queue_name`, `job_type`  
**Description:** Duration of worker job processing
```promql
# P95 job processing time
histogram_quantile(0.95, rate(crypto_data_worker_job_duration_seconds_bucket[5m]))
```

#### `crypto_data_worker_health`
**Type:** Gauge  
**Labels:** `worker_id`, `queue_name`  
**Description:** Worker health status (1 = healthy, 0 = unhealthy)
```promql
# Unhealthy workers
crypto_data_worker_health == 0

# Worker health percentage
avg(crypto_data_worker_health)
```

### Concurrency Metrics

#### `crypto_data_concurrency_limit_hits_total`
**Type:** Counter  
**Labels:** `provider`, `chain_id`  
**Description:** Number of times concurrency limits were hit
```promql
# Concurrency limit hit rate
rate(crypto_data_concurrency_limit_hits_total[5m])
```

#### `crypto_data_active_concurrent_requests`
**Type:** Gauge  
**Labels:** `provider`, `chain_id`  
**Description:** Current number of active concurrent requests
```promql
# Current concurrency by provider
crypto_data_active_concurrent_requests

# Peak concurrency
max_over_time(crypto_data_active_concurrent_requests[1h])
```

### Cache Metrics

#### `crypto_data_cache_hits_total` / `crypto_data_cache_misses_total`
**Type:** Counter  
**Labels:** `source`, `operation`  
**Description:** Number of cache hits and misses
```promql
# Cache hit rate
rate(crypto_data_cache_hits_total[5m]) 
/ (rate(crypto_data_cache_hits_total[5m]) + rate(crypto_data_cache_misses_total[5m]))
```

#### `crypto_data_cache_operation_duration_seconds`
**Type:** Histogram  
**Labels:** `operation`, `result`  
**Description:** Duration of cache operations
```promql
# Cache operation latency
histogram_quantile(0.95, rate(crypto_data_cache_operation_duration_seconds_bucket[5m]))
```

### HTTP Metrics

#### `crypto_data_http_requests_total`
**Type:** Counter  
**Labels:** `method`, `route`, `status_code`  
**Description:** Total number of HTTP requests
```promql
# Request rate by endpoint
rate(crypto_data_http_requests_total[5m])

# 4xx/5xx error rate
rate(crypto_data_http_requests_total{status_code=~"4..|5.."}[5m])
```

#### `crypto_data_http_request_duration_seconds`
**Type:** Histogram  
**Labels:** `method`, `route`, `status_code`  
**Description:** Duration of HTTP requests in seconds
```promql
# API response time percentiles
histogram_quantile(0.50, rate(crypto_data_http_request_duration_seconds_bucket[5m]))
histogram_quantile(0.95, rate(crypto_data_http_request_duration_seconds_bucket[5m]))
histogram_quantile(0.99, rate(crypto_data_http_request_duration_seconds_bucket[5m]))
```

## 💰 Cost Monitoring

### Real-time Cost Tracking

The service automatically tracks costs for all provider requests:

```typescript
import { recordProviderCall } from '@/utils/metrics';

// Automatically record cost with each provider call
recordProviderCall(
  'Alchemy',           // provider
  ChainId.ETHEREUM,    // chainId
  'getBalance',        // operation
  true,                // success
  150,                 // durationMs
  undefined,           // errorCode
  1,                   // retryAttempts
  0.001               // cost in USD
);
```

### Budget Utilization Alerts

Set up alerts for budget thresholds:

```yaml
# Prometheus Alert Rules
groups:
- name: crypto-data-cost-alerts
  rules:
  - alert: HighBudgetUtilization
    expr: crypto_data_provider_budget_utilization_ratio > 0.8
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "Provider {{$labels.provider}} budget utilization is high"
      
  - alert: CriticalBudgetUtilization
    expr: crypto_data_provider_budget_utilization_ratio > 0.9
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: "Provider {{$labels.provider}} budget utilization is critical"
```

## 🔢 Financial Precision Safety

### MoneyDecimal Usage

Use the MoneyDecimal class for all monetary calculations:

```typescript
import { MoneyUtils, MoneyDecimal } from '@/utils/money';

// Create USD amounts
const price = MoneyUtils.usd('2000.50');
const balance = MoneyUtils.crypto('1.5');

// Precise calculations
const totalValue = balance.multiply(price);
console.log(totalValue.toCurrencyString()); // "$3,000.75"

// Portfolio calculations
const tokenValues = [
  MoneyUtils.usd('1000.00'),
  MoneyUtils.usd('2500.50'),
  MoneyUtils.usd('750.25')
];

const portfolioTotal = MoneyUtils.sum(tokenValues);
console.log(portfolioTotal.toString()); // "4250.75"

// Safe division with zero check
const avgValue = MoneyUtils.safeDivide(
  portfolioTotal,
  MoneyUtils.usd('3'),
  MoneyUtils.usd('0') // fallback for division by zero
);
```

### Configuration Options

```typescript
// USD precision (2 decimal places)
const usdConfig: DecimalConfig = {
  precision: 2,
  rounding: 'half-up'
};

// Crypto precision (18 decimal places)
const cryptoConfig: DecimalConfig = {
  precision: 18,
  rounding: 'half-even' // Banker's rounding
};
```

## 🏥 Health Monitoring

### Worker Health Checks

Workers automatically report health status:

```typescript
import { updateWorkerHealth, updateQueueDepth } from '@/utils/metrics';

// Update worker health
updateWorkerHealth('portfolio-worker', 'default', true);

// Update queue metrics
updateQueueDepth('portfolio', 5, 2, 100, 1); // waiting, active, completed, failed
```

### Endpoint Health Checks

Access comprehensive health information:

```bash
# Basic health check
curl /api/health

# Detailed performance dashboard
curl /api/metrics/dashboard?timeRange=1h&detailed=true

# Cost metrics
curl /api/metrics/cost?period=24h&detailed=true

# Worker health
curl /api/metrics/workers
```

## 📈 Grafana Dashboard

### Installation

1. Import the dashboard:
```bash
# Import the Phase 2 dashboard
curl -X POST \
  http://localhost:3000/api/dashboards/db \
  -H 'Content-Type: application/json' \
  -d @monitoring/crypto-data-dashboard.json
```

2. Configure data source:
```yaml
# Prometheus data source
url: http://prometheus:9090
access: proxy
```

### Key Panels

- **Service Overview** - Request volume, budget utilization, error rates
- **Provider Performance** - Response times, error rates by provider/chain
- **Cost Tracking** - Real-time spending, budget utilization alerts
- **Worker Health** - Queue depth, processing rates, health status
- **Concurrency Monitoring** - Active requests, limit hits
- **Cache Performance** - Hit rates, operation latency

## 🧪 Testing

### Integration Tests

Run comprehensive integration tests:

```bash
# Run all integration tests
npm run test:integration

# Run specific test suites
npm test tests/integration/routeFactory.integration.test.ts
npm test tests/integration/adapterContract.test.ts
```

### Contract Tests

Validate provider compliance:

```typescript
import { testBlockchainProviderContract } from '@/tests/integration/adapterContract.test';

// Test your provider against the standard contract
testBlockchainProviderContract(
  () => new MyCustomProvider(),
  ChainId.ETHEREUM,
  testFixtures.ethereum
);
```

## 🚀 Production Deployment

### Metrics Export

Expose metrics endpoint:

```typescript
// Add to your Express app
import { registry } from '@/utils/metrics';

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});
```

### Environment Variables

Configure monitoring in production:

```bash
# Cost tracking
COST_TRACKING_ENABLED=true
MONTHLY_BUDGET=1000
ALERT_THRESHOLD=800

# Concurrency limits
CONCURRENCY_ENABLED=true
CHAIN_MANAGER_CONCURRENCY=10
RATE_LIMIT_PER_SECOND=10

# Worker monitoring
WORKER_HEALTH_CHECK_INTERVAL=30000
```

### Docker Configuration

```dockerfile
# Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Expose metrics port
EXPOSE 3000
```

## 🔧 Troubleshooting

### Common Issues

#### High Cost Alerts
```promql
# Check which operations are most expensive
topk(10, rate(crypto_data_provider_cost_usd_total[1h]))

# Identify high-cost chains
sum by (chain_id) (rate(crypto_data_provider_cost_usd_total[1h]))
```

#### Worker Health Issues
```promql
# Find unhealthy workers
crypto_data_worker_health == 0

# Check queue backlog
crypto_data_queue_depth{status="waiting"} > 100
```

#### Provider Performance
```promql
# Slow providers
histogram_quantile(0.95, rate(crypto_data_provider_request_duration_seconds_bucket[5m])) > 5

# High error rate providers
rate(crypto_data_provider_errors_total[5m]) / rate(crypto_data_provider_requests_total[5m]) > 0.1
```

### Debug Endpoints

```bash
# Force metrics update
curl -X POST /api/metrics/force-update \
  -H "x-admin-key: $ADMIN_KEY"

# Get detailed system status
curl /api/health?detailed=true

# Check specific worker status
curl "/api/metrics/workers?workerId=portfolio-worker"
```

## 📚 Reference

### Configuration Schema

```typescript
interface ObservabilityConfig {
  metrics: {
    enabled: boolean;
    endpoint: string;
    updateInterval: number;
  };
  costs: {
    trackingEnabled: boolean;
    monthlyBudget: number;
    alertThreshold: number;
  };
  workers: {
    healthCheckInterval: number;
    autoRestart: boolean;
  };
  precision: {
    usdDecimals: number;
    cryptoDecimals: number;
    rounding: 'up' | 'down' | 'half-up' | 'half-down' | 'half-even';
  };
}
```

### Metric Recording Functions

```typescript
// Provider metrics
recordProviderCall(provider, chainId, operation, success, duration, errorCode, retries, cost)

// Cost tracking
updateProviderBudgetUtilization(provider, utilization)
updateGlobalBudgetUtilization(utilization)
updateMonthlyCost(provider, cost)

// Worker metrics
recordWorkerJob(queueName, workerId, status, duration, jobType)
updateQueueDepth(queueName, waiting, active, completed, failed)
updateWorkerHealth(workerId, queueName, healthy)

// Cache metrics
recordCacheEvent(hit, source, operation)
recordCacheOperation(operation, duration, success)

// HTTP metrics
recordHttpRequest(method, route, statusCode, duration)
```

---

## 🎉 Summary

Phase 2 provides enterprise-grade observability with:

✅ **15+ Prometheus metrics** for comprehensive monitoring  
✅ **Real-time cost tracking** with budget alerts  
✅ **Worker health monitoring** with auto-restart  
✅ **Financial precision safety** with MoneyDecimal  
✅ **Production dashboards** for operational visibility  
✅ **Comprehensive testing** with integration and contract tests  

The crypto-data service now has production-ready monitoring, cost optimization, and precision financial calculations suitable for enterprise deployment.

For support, see the troubleshooting section or check the metrics endpoints for real-time system status.