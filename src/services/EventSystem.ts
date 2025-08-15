import { EventEmitter } from 'events';
import { logger, logError, createContextualLogger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { config } from '@/config';
import { ChainId } from '@/types/blockchain';

/**
 * Event-Driven Cost Optimization System
 *
 * Provides comprehensive event handling for cost reduction and performance optimization:
 * - Cache warm requests and predictive pre-loading
 * - Request deduplication and intelligent coalescing
 * - Real-time cost monitoring and threshold management
 * - Performance optimization triggers
 */

// Event Types for Cost Optimization
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

// Union type for all events
export type CostOptimizationEvent =
  | CacheWarmRequestV1
  | CostThresholdExceededV1
  | RequestDeduplicationV1
  | BatchOptimizationV1
  | PerformanceDegradationV1
  | CacheEvictionV1
  | ProviderFailoverV1;

interface EventHandler<T extends CostOptimizationEvent = CostOptimizationEvent> {
  id: string;
  eventType: T['type'];
  handler: (event: T) => Promise<void>;
  priority: number; // Higher = processed first
  retryConfig: {
    maxRetries: number;
    backoffMs: number;
    exponentialBackoff: boolean;
  };
  enabled: boolean;
}

interface EventProcessingMetrics {
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
    {
      averageTime: number;
      successRate: number;
      totalInvocations: number;
    }
  >;
}

/**
 * High-performance event system for cost optimization
 */
export class EventSystem extends EventEmitter {
  private contextLogger = createContextualLogger({ component: 'EventSystem' });
  private eventHandlers = new Map<string, EventHandler[]>();
  private eventQueue: { event: CostOptimizationEvent; timestamp: number; retryCount: number }[] =
    [];
  private processingQueue = false;
  private metrics: EventProcessingMetrics = {
    totalEvents: 0,
    processedEvents: 0,
    failedEvents: 0,
    averageProcessingTime: 0,
    eventsPerSecond: 0,
    queueLength: 0,
    lastProcessedAt: 0,
    errorsByType: {},
    handlerPerformance: {},
  };

  // Configuration
  private maxQueueSize = 10000;
  private maxConcurrentProcessing = 20;
  private processingIntervalMs = 100;
  private currentlyProcessing = 0;
  private deadLetterQueue: { event: CostOptimizationEvent; error: string; timestamp: number }[] =
    [];

  constructor() {
    super();
    this.startEventProcessor();
    this.setupDefaultHandlers();
    this.startMetricsCollection();
  }

  /**
   * Register an event handler with retry and priority configuration
   */
  registerHandler<T extends CostOptimizationEvent>(
    eventType: T['type'],
    handler: (event: T) => Promise<void>,
    options: {
      id: string;
      priority?: number;
      maxRetries?: number;
      backoffMs?: number;
      exponentialBackoff?: boolean;
      enabled?: boolean;
    }
  ): void {
    const eventHandler: EventHandler<T> = {
      id: options.id,
      eventType,
      handler: handler as any,
      priority: options.priority ?? 5,
      retryConfig: {
        maxRetries: options.maxRetries ?? 3,
        backoffMs: options.backoffMs ?? 1000,
        exponentialBackoff: options.exponentialBackoff ?? true,
      },
      enabled: options.enabled ?? true,
    };

    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }

    const handlers = this.eventHandlers.get(eventType)!;
    handlers.push(eventHandler as any);

    // Sort by priority (higher first)
    handlers.sort((a, b) => b.priority - a.priority);

    this.contextLogger.info('Event handler registered', {
      eventType,
      handlerId: options.id,
      priority: eventHandler.priority,
      maxRetries: eventHandler.retryConfig.maxRetries,
    });
  }

  /**
   * Emit a cost optimization event
   */
  async emitEvent<T extends CostOptimizationEvent>(event: T): Promise<void> {
    if (this.eventQueue.length >= this.maxQueueSize) {
      this.contextLogger.warn('Event queue full, dropping oldest events', {
        queueSize: this.eventQueue.length,
        maxQueueSize: this.maxQueueSize,
      });

      // Remove 10% of oldest events to make room
      const removeCount = Math.floor(this.maxQueueSize * 0.1);
      this.eventQueue.splice(0, removeCount);
    }

    this.eventQueue.push({
      event,
      timestamp: Date.now(),
      retryCount: 0,
    });

    this.metrics.totalEvents++;
    this.metrics.queueLength = this.eventQueue.length;

    // Store event in Redis for persistence and cross-service access
    await this.storeEventPersistent(event);

    this.contextLogger.debug('Event queued for processing', {
      eventType: event.type,
      queueLength: this.eventQueue.length,
      timestamp: event.timestamp,
    });

    // Trigger immediate processing if needed
    if (!this.processingQueue && this.currentlyProcessing < this.maxConcurrentProcessing) {
      setImmediate(() => this.processEventQueue());
    }
  }

  /**
   * Process events from the queue
   */
  private async processEventQueue(): Promise<void> {
    if (this.processingQueue || this.eventQueue.length === 0) {
      return;
    }

    this.processingQueue = true;

    while (this.eventQueue.length > 0 && this.currentlyProcessing < this.maxConcurrentProcessing) {
      const queueItem = this.eventQueue.shift();
      if (!queueItem) break;

      this.currentlyProcessing++;

      // Process event asynchronously
      this.processEvent(queueItem).finally(() => {
        this.currentlyProcessing--;
      });
    }

    this.processingQueue = false;
    this.metrics.queueLength = this.eventQueue.length;
  }

  /**
   * Process a single event
   */
  private async processEvent(queueItem: {
    event: CostOptimizationEvent;
    timestamp: number;
    retryCount: number;
  }): Promise<void> {
    const startTime = Date.now();
    const { event, retryCount } = queueItem;

    try {
      const handlers = this.eventHandlers.get(event.type) || [];
      const enabledHandlers = handlers.filter(h => h.enabled);

      if (enabledHandlers.length === 0) {
        this.contextLogger.debug('No handlers registered for event type', {
          eventType: event.type,
        });
        return;
      }

      // Process handlers in priority order
      const handlerPromises = enabledHandlers.map(handler =>
        this.processEventWithHandler(event, handler, retryCount)
      );

      await Promise.allSettled(handlerPromises);

      this.metrics.processedEvents++;

      const processingTime = Date.now() - startTime;
      this.updateProcessingMetrics(processingTime);

      this.contextLogger.debug('Event processed successfully', {
        eventType: event.type,
        handlerCount: enabledHandlers.length,
        processingTime,
      });
    } catch (error) {
      await this.handleEventProcessingError(queueItem, error as Error, startTime);
    }
  }

  /**
   * Process event with a specific handler
   */
  private async processEventWithHandler(
    event: CostOptimizationEvent,
    handler: EventHandler,
    globalRetryCount: number
  ): Promise<void> {
    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let retry = 0; retry <= handler.retryConfig.maxRetries; retry++) {
      try {
        await handler.handler(event);

        // Success - update metrics
        this.updateHandlerMetrics(handler.id, Date.now() - startTime, true);
        return;
      } catch (error) {
        lastError = error as Error;

        if (retry < handler.retryConfig.maxRetries) {
          const backoffMs = handler.retryConfig.exponentialBackoff
            ? handler.retryConfig.backoffMs * Math.pow(2, retry)
            : handler.retryConfig.backoffMs;

          this.contextLogger.warn('Handler failed, retrying', {
            handlerId: handler.id,
            eventType: event.type,
            retry,
            maxRetries: handler.retryConfig.maxRetries,
            backoffMs,
            error: (error as Error).message,
          });

          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }

    // All retries exhausted
    this.updateHandlerMetrics(handler.id, Date.now() - startTime, false);

    this.contextLogger.error('Handler failed after all retries', {
      handlerId: handler.id,
      eventType: event.type,
      maxRetries: handler.retryConfig.maxRetries,
      error: lastError?.message,
    });

    throw lastError;
  }

  /**
   * Handle event processing errors
   */
  private async handleEventProcessingError(
    queueItem: { event: CostOptimizationEvent; timestamp: number; retryCount: number },
    error: Error,
    startTime: number
  ): Promise<void> {
    const { event, retryCount } = queueItem;

    this.metrics.failedEvents++;

    if (!this.metrics.errorsByType[event.type]) {
      this.metrics.errorsByType[event.type] = 0;
    }
    this.metrics.errorsByType[event.type]++;

    // Global retry logic
    const maxGlobalRetries = 2;
    if (retryCount < maxGlobalRetries) {
      this.contextLogger.warn('Event processing failed, requeueing', {
        eventType: event.type,
        retryCount,
        maxRetries: maxGlobalRetries,
        error: error.message,
      });

      // Requeue with exponential backoff
      setTimeout(
        () => {
          this.eventQueue.push({
            event,
            timestamp: queueItem.timestamp,
            retryCount: retryCount + 1,
          });
        },
        1000 * Math.pow(2, retryCount)
      );
    } else {
      // Send to dead letter queue
      this.deadLetterQueue.push({
        event,
        error: error.message,
        timestamp: Date.now(),
      });

      this.contextLogger.error('Event moved to dead letter queue', {
        eventType: event.type,
        retryCount,
        error: error.message,
      });

      // Store in Redis dead letter queue
      await this.storeDeadLetterEvent(event, error.message);
    }

    const processingTime = Date.now() - startTime;
    this.updateProcessingMetrics(processingTime);
  }

  /**
   * Setup default event handlers
   */
  private setupDefaultHandlers(): void {
    // Cache warm request handler
    this.registerHandler<CacheWarmRequestV1>(
      'CacheWarmRequestV1',
      async event => {
        await this.handleCacheWarmRequest(event);
      },
      {
        id: 'default-cache-warm',
        priority: 8,
      }
    );

    // Cost threshold exceeded handler
    this.registerHandler<CostThresholdExceededV1>(
      'CostThresholdExceededV1',
      async event => {
        await this.handleCostThresholdExceeded(event);
      },
      {
        id: 'default-cost-threshold',
        priority: 10,
      }
    );

    // Request deduplication handler
    this.registerHandler<RequestDeduplicationV1>(
      'RequestDeduplicationV1',
      async event => {
        await this.handleRequestDeduplication(event);
      },
      {
        id: 'default-deduplication',
        priority: 7,
      }
    );

    // Batch optimization handler
    this.registerHandler<BatchOptimizationV1>(
      'BatchOptimizationV1',
      async event => {
        await this.handleBatchOptimization(event);
      },
      {
        id: 'default-batch-optimization',
        priority: 6,
      }
    );

    // Performance degradation handler
    this.registerHandler<PerformanceDegradationV1>(
      'PerformanceDegradationV1',
      async event => {
        await this.handlePerformanceDegradation(event);
      },
      {
        id: 'default-performance-degradation',
        priority: 9,
      }
    );

    // Cache eviction handler
    this.registerHandler<CacheEvictionV1>(
      'CacheEvictionV1',
      async event => {
        await this.handleCacheEviction(event);
      },
      {
        id: 'default-cache-eviction',
        priority: 4,
      }
    );

    // Provider failover handler
    this.registerHandler<ProviderFailoverV1>(
      'ProviderFailoverV1',
      async event => {
        await this.handleProviderFailover(event);
      },
      {
        id: 'default-provider-failover',
        priority: 8,
      }
    );
  }

  /**
   * Default event handlers
   */
  private async handleCacheWarmRequest(event: CacheWarmRequestV1): Promise<void> {
    this.contextLogger.info('Processing cache warm request', {
      requestId: event.requestId,
      dataType: event.dataType,
      keyCount: event.keys.length,
      priority: event.priority,
      estimatedSavings: event.estimatedSavings,
    });

    // Emit to cache manager (would integrate with IntelligentCacheManager)
    this.emit('cacheWarmRequested', event);
  }

  private async handleCostThresholdExceeded(event: CostThresholdExceededV1): Promise<void> {
    this.contextLogger.warn('Cost threshold exceeded', {
      provider: event.provider,
      costType: event.costType,
      currentValue: event.currentValue,
      threshold: event.threshold,
      severity: event.severity,
    });

    // Trigger cost optimization measures
    this.emit('costOptimizationRequired', event);
  }

  private async handleRequestDeduplication(event: RequestDeduplicationV1): Promise<void> {
    this.contextLogger.info('Request deduplication completed', {
      originalRequestId: event.originalRequestId,
      duplicateCount: event.duplicateRequestIds.length,
      deduplicationType: event.deduplicationType,
      costSaved: event.costSaved,
    });

    // Update deduplication metrics
    this.emit('deduplicationMetricsUpdated', event);
  }

  private async handleBatchOptimization(event: BatchOptimizationV1): Promise<void> {
    this.contextLogger.info('Batch optimization completed', {
      batchId: event.batchId,
      requestCount: event.requestCount,
      costSavings: event.costSavings,
      efficiency: event.efficiency,
    });

    // Update batch performance metrics
    this.emit('batchMetricsUpdated', event);
  }

  private async handlePerformanceDegradation(event: PerformanceDegradationV1): Promise<void> {
    this.contextLogger.warn('Performance degradation detected', {
      component: event.component,
      metric: event.metric,
      currentValue: event.currentValue,
      degradationPercentage: event.degradationPercentage,
      severity: event.severity,
    });

    // Trigger performance optimization
    this.emit('performanceOptimizationRequired', event);
  }

  private async handleCacheEviction(event: CacheEvictionV1): Promise<void> {
    this.contextLogger.debug('Cache eviction processed', {
      cacheKey: event.cacheKey,
      cacheLayer: event.cacheLayer,
      evictionReason: event.evictionReason,
      costImplication: event.costImplication,
    });

    // Update cache metrics
    this.emit('cacheMetricsUpdated', event);
  }

  private async handleProviderFailover(event: ProviderFailoverV1): Promise<void> {
    this.contextLogger.warn('Provider failover completed', {
      fromProvider: event.fromProvider,
      toProvider: event.toProvider,
      failoverReason: event.failoverReason,
      costImpact: event.costImpact,
    });

    // Update provider metrics
    this.emit('providerMetricsUpdated', event);
  }

  /**
   * Store event persistently in Redis
   */
  private async storeEventPersistent(event: CostOptimizationEvent): Promise<void> {
    try {
      const key = `${config.redis.keyPrefix}events:${event.type}:${Date.now()}`;
      await redisManager.set(key, event, 24 * 60 * 60); // 24 hour retention

      // Store in time-series for analytics
      const hourKey = `${config.redis.keyPrefix}events_hourly:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
      await redisManager.lpush(hourKey, key);
      await redisManager.expire(hourKey, 7 * 24 * 60 * 60); // 7 days retention
    } catch (error) {
      this.contextLogger.warn('Failed to store event persistently', {
        eventType: event.type,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Store failed event in dead letter queue
   */
  private async storeDeadLetterEvent(
    event: CostOptimizationEvent,
    errorMessage: string
  ): Promise<void> {
    try {
      const key = `${config.redis.keyPrefix}dlq:${Date.now()}_${event.type}`;
      await redisManager.set(
        key,
        {
          event,
          error: errorMessage,
          timestamp: Date.now(),
        },
        7 * 24 * 60 * 60
      ); // 7 day retention
    } catch (error) {
      this.contextLogger.error('Failed to store dead letter event', {
        eventType: event.type,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Update processing metrics
   */
  private updateProcessingMetrics(processingTime: number): void {
    this.metrics.averageProcessingTime = (this.metrics.averageProcessingTime + processingTime) / 2;
    this.metrics.lastProcessedAt = Date.now();

    // Calculate events per second over last minute
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentEvents = this.metrics.processedEvents; // Simplified
    this.metrics.eventsPerSecond = recentEvents / 60;
  }

  /**
   * Update handler-specific metrics
   */
  private updateHandlerMetrics(handlerId: string, processingTime: number, success: boolean): void {
    if (!this.metrics.handlerPerformance[handlerId]) {
      this.metrics.handlerPerformance[handlerId] = {
        averageTime: 0,
        successRate: 0,
        totalInvocations: 0,
      };
    }

    const metrics = this.metrics.handlerPerformance[handlerId];
    metrics.totalInvocations++;
    metrics.averageTime = (metrics.averageTime + processingTime) / 2;

    const successfulInvocations =
      Math.floor(metrics.totalInvocations * metrics.successRate) + (success ? 1 : 0);
    metrics.successRate = successfulInvocations / metrics.totalInvocations;
  }

  /**
   * Start event processor
   */
  private startEventProcessor(): void {
    setInterval(async () => {
      if (this.eventQueue.length > 0) {
        await this.processEventQueue();
      }
    }, this.processingIntervalMs);
  }

  /**
   * Start metrics collection and periodic cleanup
   */
  private startMetricsCollection(): void {
    // Emit metrics every 30 seconds
    setInterval(() => {
      this.emit('eventSystemMetrics', {
        timestamp: Date.now(),
        metrics: { ...this.metrics },
      });
    }, 30000);

    // Clean up dead letter queue every 5 minutes
    setInterval(
      () => {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
        this.deadLetterQueue = this.deadLetterQueue.filter(item => item.timestamp > cutoff);
      },
      5 * 60 * 1000
    );

    this.contextLogger.info('Event system initialized', {
      maxQueueSize: this.maxQueueSize,
      maxConcurrentProcessing: this.maxConcurrentProcessing,
      processingIntervalMs: this.processingIntervalMs,
    });
  }

  // Public API methods

  /**
   * Get current event processing metrics
   */
  getMetrics(): EventProcessingMetrics {
    return { ...this.metrics };
  }

  /**
   * Get dead letter queue items
   */
  getDeadLetterQueue(): { event: CostOptimizationEvent; error: string; timestamp: number }[] {
    return [...this.deadLetterQueue];
  }

  /**
   * Retry dead letter queue items
   */
  async retryDeadLetterQueue(): Promise<number> {
    const itemsToRetry = this.deadLetterQueue.length;

    for (const item of this.deadLetterQueue) {
      await this.emitEvent(item.event);
    }

    this.deadLetterQueue = [];

    this.contextLogger.info('Dead letter queue items requeued', {
      itemsRetried: itemsToRetry,
    });

    return itemsToRetry;
  }

  /**
   * Enable/disable event handler
   */
  setHandlerEnabled(eventType: string, handlerId: string, enabled: boolean): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      const handler = handlers.find(h => h.id === handlerId);
      if (handler) {
        handler.enabled = enabled;
        this.contextLogger.info('Handler enabled/disabled', {
          eventType,
          handlerId,
          enabled,
        });
      }
    }
  }

  /**
   * Get registered handlers for an event type
   */
  getHandlers(eventType: string): { id: string; priority: number; enabled: boolean }[] {
    const handlers = this.eventHandlers.get(eventType) || [];
    return handlers.map(h => ({
      id: h.id,
      priority: h.priority,
      enabled: h.enabled,
    }));
  }

  /**
   * Flush event queue (process all pending events immediately)
   */
  async flushQueue(): Promise<number> {
    const itemsToProcess = this.eventQueue.length;

    while (
      this.eventQueue.length > 0 &&
      this.currentlyProcessing < this.maxConcurrentProcessing * 2
    ) {
      await this.processEventQueue();
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
    }

    this.contextLogger.info('Event queue flushed', {
      itemsProcessed: itemsToProcess - this.eventQueue.length,
      remainingItems: this.eventQueue.length,
    });

    return itemsToProcess - this.eventQueue.length;
  }
}

// Export singleton instance
let eventSystemInstance: EventSystem | null = null;

export const getEventSystem = (): EventSystem => {
  if (!eventSystemInstance) {
    eventSystemInstance = new EventSystem();
  }
  return eventSystemInstance;
};

export default getEventSystem;
