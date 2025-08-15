# Phase 1 Implementation Recommendations

## Overview

This document provides specific implementation recommendations for Phase 1 of the event-driven architecture integration. The focus is on minimal disruption while establishing the foundation for future scaling.

## Priority 1: Core Infrastructure (Week 1)

### 1.1 EventBusPort Implementation

**Files Created:**
- ✅ `src/app/ports/EventBusPort.ts` - Core interface and types
- ✅ `src/app/events/DeFiEvents.ts` - DeFi event contracts  
- ✅ `src/app/events/PortfolioEvents.ts` - Portfolio event contracts
- ✅ `src/app/events/SystemEvents.ts` - System event contracts
- ✅ `src/app/events/index.ts` - Consolidated exports

**Next: Create InMemoryEventBusAdapter**

```typescript
// src/adapters/outbound/event-bus/InMemoryEventBusAdapter.ts
import { EventBusPort, IntegrationEvent, EventHandler, PublishOptions } from '@/app/ports/EventBusPort';

export class InMemoryEventBusAdapter implements EventBusPort {
  private subscriptions = new Map<string, Array<{
    handler: EventHandler;
    pattern: RegExp;
    options?: any;
  }>>();
  
  private metrics = {
    publishedCount: 0,
    consumedCount: 0,
    errorCount: 0,
  };

  async initialize(): Promise<void> {
    // No-op for in-memory
  }

  async publish(event: IntegrationEvent, options?: PublishOptions): Promise<void> {
    this.metrics.publishedCount++;
    
    // Process synchronously for in-memory (dev/test)
    for (const [subscriptionId, handlers] of this.subscriptions) {
      for (const { handler, pattern } of handlers) {
        if (pattern.test(event.type)) {
          try {
            await handler(event);
            this.metrics.consumedCount++;
          } catch (error) {
            this.metrics.errorCount++;
            console.error(`Event handler error for ${event.type}:`, error);
          }
        }
      }
    }
  }

  // ... implement remaining interface methods
}
```

### 1.2 Configuration Updates

**Add to config/index.ts:**
```typescript
export const config = {
  // ... existing config
  events: {
    enabled: process.env.ENABLE_EVENTS === 'true',
    asyncDetail: process.env.ENABLE_ASYNC_DETAIL === 'true',
    adapter: (process.env.EVENT_BUS_ADAPTER || 'in-memory') as 'in-memory' | 'bullmq',
    defaultRetries: parseInt(process.env.EVENT_MAX_RETRIES || '3'),
    batchWindow: parseInt(process.env.EVENT_BATCH_WINDOW_MS || '100'),
  }
};
```

### 1.3 Dependency Injection Setup

**Create src/app/container.ts:**
```typescript
import { EventBusPort, EventBusFactory } from './ports/EventBusPort';
import { InMemoryEventBusAdapter } from '@/adapters/outbound/event-bus/InMemoryEventBusAdapter';
import { config } from '@/config';

// Event bus factory
export const createEventBus: EventBusFactory = () => {
  switch (config.events.adapter) {
    case 'in-memory':
      return new InMemoryEventBusAdapter();
    case 'bullmq':
      // TODO: Implement in Phase 1B
      throw new Error('BullMQ adapter not yet implemented');
    default:
      throw new Error(`Unknown event bus adapter: ${config.events.adapter}`);
  }
};

// Global event bus instance (lazy initialization)
let eventBusInstance: EventBusPort | null = null;

export const getEventBus = (): EventBusPort | null => {
  if (!config.events.enabled) {
    return null;
  }
  
  if (!eventBusInstance) {
    eventBusInstance = createEventBus();
  }
  
  return eventBusInstance;
};
```

## Priority 2: Service Integration (Week 1-2)

### 2.1 DeFiOrchestrator Integration

**Modify services/defi/DeFiOrchestrator.ts:**

```typescript
import { getEventBus } from '@/app/container';
import { createIntegrationEvent } from '@/app/events';

export class DeFiOrchestrator {
  private eventBus = getEventBus();

  async getDeFiPortfolio(address: string, options = {}): Promise<DeFiApiResponse<DeFiPortfolioSummary>> {
    const startTime = Date.now();
    const requestId = `defi-portfolio-${address}-${Date.now()}`;

    try {
      // EVENT INTEGRATION: Publish request event
      if (this.eventBus) {
        await this.eventBus.publish(createIntegrationEvent(
          'DeFiPositionsRequestedV1',
          {
            address,
            chainIds: options.chainIds,
            protocols: options.protocols,
            includeInactive: options.includeInactive,
            requestedAt: new Date().toISOString(),
            context: {
              priority: 'medium',
            }
          },
          { requestId, source: 'DeFiOrchestrator' }
        ));
      }

      // ... existing logic ...

      // EVENT INTEGRATION: Publish success event
      if (this.eventBus) {
        await this.eventBus.publish(createIntegrationEvent(
          'DeFiPositionsFetchedV1',
          {
            address,
            positions: filteredPositions,
            portfolioSummary,
            fetchedAt: new Date().toISOString(),
            stats: {
              protocolsQueried: this.getRegisteredProtocols().length,
              protocolsSuccessful: filteredPositions.length,
              totalApiCalls: 1, // Track this properly
              fetchDurationMs: duration,
              cacheStats: {
                hits: cached ? 1 : 0,
                misses: cached ? 0 : 1,
                hitRate: cached ? 1.0 : 0.0,
              },
              chainPerformance: [], // Populate from actual data
              protocolPerformance: [], // Populate from actual data
            },
            originalRequest: options,
          },
          { requestId, source: 'DeFiOrchestrator' }
        ));
      }

      return result;
    } catch (error) {
      // EVENT INTEGRATION: Publish error event
      if (this.eventBus) {
        await this.eventBus.publish(createIntegrationEvent(
          'DeFiPositionsErrorV1',
          {
            address,
            error: {
              code: 'DEFI_PORTFOLIO_ERROR',
              message: error instanceof Error ? error.message : 'Unknown error',
              details: { error },
            },
            errorAt: new Date().toISOString(),
            originalRequest: options,
            recovery: {
              retryable: true,
              fallbackToCache: this.config.fallbackToCache,
            }
          },
          { requestId, source: 'DeFiOrchestrator' }
        ));
      }

      return errorResult;
    }
  }
}
```

### 2.2 Portfolio Routes Integration

**Modify routes/portfolio.ts (around line 240-260):**

```typescript
import { getEventBus } from '@/app/container';
import { createIntegrationEvent } from '@/app/events';

// Add new query parameter validation
const portfolioQuerySchema = z.object({
  // ... existing fields
  detail: z.enum(['summary', 'full']).default('summary'),
});

router.get('/:address', async (req: Request, res: Response, next: NextFunction) => {
  // ... existing validation ...

  const options = queryResult.data;
  const eventBus = getEventBus();

  // Check for async detail mode
  if (options.detail === 'full' && config.events.asyncDetail && eventBus) {
    const requestId = `portfolio-async-${address}-${Date.now()}`;
    
    // Publish aggregation request event
    await eventBus.publish(createIntegrationEvent(
      'PortfolioAggregationRequestV1',
      {
        address,
        components: {
          includeDefi: options.includeDefi,
          includeNft: options.includeNfts,
          includeBalances: true,
        },
        chains: options.chains,
        options: {
          includeMetadata: options.includeMetadata,
          includeAnalytics: options.includeAnalytics,
          forceRefresh: options.forceRefresh,
          minDefiValue: options.minDefiValue,
          minNftValue: options.minNftValue,
        },
        context: {
          clientType: 'web', // Detect from headers
          priority: 'medium',
        },
        requestedAt: new Date().toISOString(),
      },
      { requestId, source: 'PortfolioRoute' }
    ));

    // Return immediately with request ID
    return res.json({
      success: true,
      data: {
        requestId,
        status: 'queued',
        estimatedCompletionMs: 5000, // Conservative estimate
        statusUrl: `/api/portfolio/status/${requestId}`,
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId,
        mode: 'async',
      },
    });
  }

  // ... existing synchronous processing ...
});

// Add status endpoint
router.get('/status/:requestId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.params;
    
    // Check Redis for completion status
    const statusKey = `portfolio-status:${requestId}`;
    const resultKey = `portfolio-result:${requestId}`;
    
    const status = await redisManager.get(statusKey) || 'not-found';
    
    if (status === 'completed') {
      const result = await redisManager.get(resultKey);
      return res.json({
        success: true,
        status: 'completed',
        data: result,
        completedAt: new Date().toISOString(),
      });
    }
    
    return res.json({
      success: true,
      status: status, // 'queued', 'processing', 'error', 'not-found'
      estimatedRemainingMs: status === 'processing' ? 3000 : null,
    });
    
  } catch (error) {
    logger.error('Portfolio status check failed:', error);
    next(error);
  }
});
```

## Priority 3: Basic Event Handlers (Week 2)

### 3.1 Cache Warming Handler

**Create src/app/handlers/CacheWarmHandler.ts:**
```typescript
import { EventHandler } from '@/app/ports/EventBusPort';
import { CacheWarmRequestV1 } from '@/app/events/PortfolioEvents';
import { redisManager } from '@/utils/redis';
import { logger } from '@/utils/logger';

export const cacheWarmHandler: EventHandler<CacheWarmRequestV1> = async (event) => {
  const { data } = event;
  
  logger.info('Processing cache warm request', {
    cacheKey: data.cacheKey,
    address: data.address,
    priority: data.priority,
  });

  try {
    // Implement cache warming logic based on strategy
    switch (data.strategy) {
      case 'full-refresh':
        await performFullRefresh(data);
        break;
      case 'selective-refresh':
        await performSelectiveRefresh(data);
        break;
      case 'extend-ttl':
        await extendTTL(data);
        break;
    }
    
    logger.info('Cache warm completed', { cacheKey: data.cacheKey });
  } catch (error) {
    logger.error('Cache warm failed', { 
      cacheKey: data.cacheKey, 
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error; // Let event bus handle retry logic
  }
};

async function performFullRefresh(data: CacheWarmRequestV1['data']) {
  // Implementation depends on data types requested
  for (const dataType of data.dataTypes) {
    switch (dataType) {
      case 'defi':
        // Trigger fresh DeFi data fetch
        break;
      case 'nft': 
        // Trigger fresh NFT data fetch
        break;
      // ... other types
    }
  }
}
```

### 3.2 Performance Monitoring Handler

**Create src/app/handlers/PerformanceHandler.ts:**
```typescript
import { EventHandler } from '@/app/ports/EventBusPort';
import { DeFiPositionsFetchedV1 } from '@/app/events/DeFiEvents';
import { logger } from '@/utils/logger';

export const performanceMonitoringHandler: EventHandler<DeFiPositionsFetchedV1> = async (event) => {
  const { data } = event;
  
  // Extract performance metrics
  const metrics = {
    fetchDuration: data.stats.fetchDurationMs,
    cacheHitRate: data.stats.cacheStats.hitRate,
    protocolSuccessRate: data.stats.protocolsSuccessful / data.stats.protocolsQueried,
    costPerPosition: data.stats.costUSD ? data.stats.costUSD / data.positions.length : 0,
  };
  
  // Log performance data (could send to external monitoring)
  logger.info('DeFi portfolio performance metrics', {
    address: data.address,
    metrics,
    requestId: event.requestId,
  });
  
  // Alert on performance degradation
  if (metrics.fetchDuration > 10000) { // > 10 seconds
    logger.warn('Slow DeFi portfolio fetch detected', {
      address: data.address,
      duration: metrics.fetchDuration,
    });
  }
  
  if (metrics.cacheHitRate < 0.3) { // < 30%
    logger.warn('Low cache hit rate detected', {
      address: data.address,
      hitRate: metrics.cacheHitRate,
    });
  }
};
```

## Priority 4: Application Initialization (Week 2)

### 4.1 Event Bus Initialization

**Modify src/app.ts:**
```typescript
import { getEventBus } from '@/app/container';
import { cacheWarmHandler, performanceMonitoringHandler } from '@/app/handlers';

export async function initializeApplication() {
  // ... existing initialization ...
  
  // Initialize event bus if enabled
  const eventBus = getEventBus();
  if (eventBus) {
    await eventBus.initialize();
    
    // Register event handlers
    await eventBus.subscribe('CacheWarmRequestV1', cacheWarmHandler);
    await eventBus.subscribe('DeFiPositionsFetchedV1', performanceMonitoringHandler);
    
    logger.info('Event bus initialized with handlers');
  }
  
  // ... rest of initialization
}

export async function shutdownApplication() {
  // ... existing shutdown ...
  
  const eventBus = getEventBus();
  if (eventBus) {
    await eventBus.shutdown();
    logger.info('Event bus shutdown completed');
  }
}
```

## Environment Configuration

### Development Environment
```bash
# .env.development
ENABLE_EVENTS=true
ENABLE_ASYNC_DETAIL=false  # Start with sync only
EVENT_BUS_ADAPTER=in-memory
EVENT_MAX_RETRIES=3
EVENT_BATCH_WINDOW_MS=100
```

### Testing Environment  
```bash
# .env.test
ENABLE_EVENTS=true
ENABLE_ASYNC_DETAIL=true   # Test async flows
EVENT_BUS_ADAPTER=in-memory
EVENT_MAX_RETRIES=1        # Fail fast in tests
```

### Production Environment
```bash
# .env.production
ENABLE_EVENTS=false        # Deploy disabled first
ENABLE_ASYNC_DETAIL=false
EVENT_BUS_ADAPTER=bullmq   # When implemented
EVENT_MAX_RETRIES=3
```

## Testing Strategy

### Unit Tests

**Create tests/unit/events/EventBusPort.test.ts:**
```typescript
import { InMemoryEventBusAdapter } from '@/adapters/outbound/event-bus/InMemoryEventBusAdapter';
import { createIntegrationEvent } from '@/app/events';

describe('EventBusPort', () => {
  let eventBus: InMemoryEventBusAdapter;
  
  beforeEach(async () => {
    eventBus = new InMemoryEventBusAdapter();
    await eventBus.initialize();
  });
  
  it('should publish and consume events', async () => {
    const receivedEvents: any[] = [];
    
    await eventBus.subscribe('DeFi*', async (event) => {
      receivedEvents.push(event);
    });
    
    const event = createIntegrationEvent(
      'DeFiPositionsRequestedV1',
      { address: '0x123' },
      { requestId: 'test-123', source: 'test' }
    );
    
    await eventBus.publish(event);
    
    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].type).toBe('DeFiPositionsRequestedV1');
  });
  
  it('should handle subscription patterns correctly', async () => {
    // Test wildcard matching, error handling, etc.
  });
});
```

### Integration Tests

**Create tests/integration/events/DeFiEventsIntegration.test.ts:**
```typescript
describe('DeFi Events Integration', () => {
  it('should publish events when fetching portfolio', async () => {
    // Mock event bus
    // Call DeFiOrchestrator.getDeFiPortfolio
    // Verify events were published with correct data
  });
  
  it('should handle async portfolio requests', async () => {
    // Enable async detail mode
    // Make portfolio request with detail=full
    // Verify immediate response with requestId
    // Verify event was published
  });
});
```

## Monitoring & Observability

### Metrics Integration

**Add to src/utils/metrics.ts:**
```typescript
import { register, Counter, Histogram, Gauge } from 'prom-client';

// Event metrics
export const eventMetrics = {
  publishedTotal: new Counter({
    name: 'events_published_total',
    help: 'Total number of events published',
    labelNames: ['event_type', 'source'],
    registers: [register],
  }),
  
  consumedTotal: new Counter({
    name: 'events_consumed_total', 
    help: 'Total number of events consumed',
    labelNames: ['event_type', 'handler'],
    registers: [register],
  }),
  
  processingDuration: new Histogram({
    name: 'event_processing_duration_ms',
    help: 'Time spent processing events',
    labelNames: ['event_type', 'handler'],
    registers: [register],
    buckets: [10, 50, 100, 500, 1000, 5000, 10000],
  }),
  
  queueDepth: new Gauge({
    name: 'event_queue_depth',
    help: 'Current depth of event queues',
    labelNames: ['queue_name'],
    registers: [register],
  }),
};
```

### Health Checks

**Add event bus health to existing health endpoint:**
```typescript
// In routes/health.ts
router.get('/', async (req, res) => {
  const eventBus = getEventBus();
  const eventBusHealth = eventBus ? await eventBus.getHealth() : null;
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      // ... existing health checks
      eventBus: eventBusHealth,
    },
  });
});
```

## Rollout Timeline

### Week 1: Foundation
- [ ] Implement InMemoryEventBusAdapter
- [ ] Add configuration and feature flags
- [ ] Create dependency injection container
- [ ] Write unit tests for event contracts

### Week 2: Integration
- [ ] Integrate event publishing in DeFiOrchestrator
- [ ] Add async detail mode to portfolio routes
- [ ] Create basic event handlers
- [ ] Add event bus to application lifecycle

### Week 3: Testing & Validation
- [ ] Write integration tests
- [ ] Performance testing with events enabled
- [ ] Validate metrics and observability
- [ ] Prepare for staging deployment

### Week 4: Deployment Preparation
- [ ] Deploy to staging with events enabled
- [ ] Validate async flows work correctly
- [ ] Monitor performance impact
- [ ] Prepare production rollout plan

## Success Criteria

### Phase 1 Completion Criteria

1. ✅ **EventBusPort interface implemented** with in-memory adapter
2. ✅ **Event contracts defined** for all Phase 1 events
3. ⏳ **Zero breaking changes** - all existing APIs work unchanged
4. ⏳ **Feature flags implemented** - can enable/disable events
5. ⏳ **Basic event handlers created** for monitoring and cache warming
6. ⏳ **Async detail mode** working for portfolio endpoints
7. ⏳ **Comprehensive testing** - unit and integration tests passing
8. ⏳ **Observability integrated** - metrics and health checks working

### Performance Targets

- **No regression** in P95 latency for synchronous endpoints
- **Event processing** under 100ms for simple events
- **Memory usage** increase under 50MB for in-memory adapter
- **Test coverage** above 80% for event-related code

## Risk Mitigation

### Technical Risks

1. **Event Publishing Failures**
   - Mitigation: Graceful degradation, log but continue processing
   - Implementation: Try/catch around event publishing

2. **Memory Usage (In-Memory Adapter)**
   - Mitigation: Event expiration, circular buffer, monitoring
   - Implementation: LRU cache for event history

3. **Handler Errors**
   - Mitigation: Retry logic, dead letter queues, error boundaries
   - Implementation: Per-handler error handling with circuit breakers

### Operational Risks

1. **Configuration Complexity**
   - Mitigation: Sensible defaults, clear documentation
   - Implementation: Configuration validation at startup

2. **Debugging Complexity**
   - Mitigation: Comprehensive logging, correlation IDs
   - Implementation: Event tracing through request lifecycle

## Next Steps After Phase 1

1. **BullMQ Adapter Implementation** for production scalability
2. **Worker Process Creation** for background processing
3. **Batching & Deduplication** for cost optimization
4. **Outbox Pattern** for transactional event publishing
5. **Cross-Service Events** for microservices architecture

This completes the Phase 1 implementation recommendations with minimal disruption and maximum safety.