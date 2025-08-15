import { EventEmitter } from 'events';
import { EventBusPort, EventHandler, SubscriptionOptions, EventBusHealth, EventBusConfig } from '@/ports/EventBusPort';
import { DomainEvent, EventMetadata } from '@/events/types';
import { logger } from '@/utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * In-Memory Event Bus Adapter
 * 
 * Simple implementation using Node.js EventEmitter for development and testing.
 * This adapter provides immediate event delivery with basic retry logic.
 * Not suitable for production use as events are not persisted.
 */
export class InMemoryEventBusAdapter implements EventBusPort {
  private emitter: EventEmitter;
  private subscriptions: Map<string, SubscriptionInfo> = new Map();
  private config: EventBusConfig;
  private healthCheckInterval?: NodeJS.Timer;
  private isShuttingDown = false;
  private eventStats = {
    published: 0,
    processed: 0,
    failed: 0,
    retried: 0,
  };

  constructor(config: Partial<EventBusConfig> = {}) {
    this.config = {
      defaultRetries: 3,
      defaultRetryDelay: 1000,
      defaultConcurrency: 10,
      enableDLQ: false, // In-memory adapter doesn't support DLQ
      healthCheckInterval: 30000,
      ...config,
    };

    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100); // Allow many subscribers
    this.startHealthChecking();

    logger.info('InMemoryEventBusAdapter initialized', {
      config: this.config,
    });
  }

  async publish<T extends DomainEvent>(event: T, metadata?: EventMetadata): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Event bus is shutting down');
    }

    const eventMetadata: EventMetadata = {
      source: 'InMemoryEventBus',
      correlationId: uuidv4(),
      priority: 'medium',
      retryCount: 0,
      ...metadata,
    };

    try {
      this.eventStats.published++;
      
      logger.debug('Publishing event', {
        eventType: event.type,
        eventId: event.id,
        aggregateId: event.aggregateId,
        metadata: eventMetadata,
      });

      // Emit the event asynchronously
      process.nextTick(() => {
        this.emitter.emit(event.type, event, eventMetadata);
        this.emitter.emit('*', event, eventMetadata); // Wildcard for global listeners
      });

    } catch (error) {
      this.eventStats.failed++;
      logger.error('Failed to publish event', {
        eventType: event.type,
        eventId: event.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async subscribe<T extends DomainEvent>(
    eventType: string,
    handler: EventHandler<T>,
    options: SubscriptionOptions = {}
  ): Promise<string> {
    if (this.isShuttingDown) {
      throw new Error('Event bus is shutting down');
    }

    const subscriptionId = uuidv4();
    const subscriptionOptions = {
      maxRetries: this.config.defaultRetries,
      retryDelay: this.config.defaultRetryDelay,
      concurrency: this.config.defaultConcurrency,
      queue: `queue-${eventType}`,
      ...options,
    };

    // Create wrapped handler with retry logic
    const wrappedHandler = async (event: T, metadata: EventMetadata) => {
      const processingMetadata = { ...metadata };
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= subscriptionOptions.maxRetries!; attempt++) {
        try {
          processingMetadata.retryCount = attempt;
          
          await handler(event, processingMetadata);
          
          this.eventStats.processed++;
          
          if (attempt > 0) {
            this.eventStats.retried++;
            logger.info('Event processing succeeded after retry', {
              eventType: event.type,
              eventId: event.id,
              attempt,
              subscriptionId,
            });
          }
          
          return; // Success, exit retry loop
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          this.eventStats.failed++;
          
          logger.warn('Event processing failed', {
            eventType: event.type,
            eventId: event.id,
            attempt,
            maxRetries: subscriptionOptions.maxRetries,
            error: lastError.message,
            subscriptionId,
          });

          // If not the last attempt, wait before retrying
          if (attempt < subscriptionOptions.maxRetries!) {
            await new Promise(resolve => 
              setTimeout(resolve, subscriptionOptions.retryDelay! * Math.pow(2, attempt))
            );
          }
        }
      }

      // All retries exhausted
      logger.error('Event processing failed after all retries', {
        eventType: event.type,
        eventId: event.id,
        maxRetries: subscriptionOptions.maxRetries,
        error: lastError?.message,
        subscriptionId,
      });

      // In a real system, this would go to a Dead Letter Queue
      // For in-memory, we just log it
      if (subscriptionOptions.enableDLQ) {
        logger.warn('Event would be sent to DLQ (not implemented in InMemoryAdapter)', {
          eventType: event.type,
          eventId: event.id,
          subscriptionId,
        });
      }
    };

    // Store subscription info
    this.subscriptions.set(subscriptionId, {
      eventType,
      handler: wrappedHandler,
      options: subscriptionOptions,
      subscribedAt: new Date(),
    });

    // Register the handler with the emitter
    this.emitter.on(eventType, wrappedHandler);

    logger.info('Subscription created', {
      subscriptionId,
      eventType,
      options: subscriptionOptions,
    });

    return subscriptionId;
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      logger.warn('Attempted to unsubscribe from non-existent subscription', {
        subscriptionId,
      });
      return;
    }

    // Remove from emitter
    this.emitter.removeListener(subscription.eventType, subscription.handler as (...args: any[]) => void);
    
    // Remove from our tracking
    this.subscriptions.delete(subscriptionId);

    logger.info('Subscription removed', {
      subscriptionId,
      eventType: subscription.eventType,
    });
  }

  async healthCheck(): Promise<EventBusHealth> {
    const isHealthy = !this.isShuttingDown;
    const queueSizes = this.getQueueSizes();

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      connected: true, // Always connected for in-memory
      queueSizes,
      lastCheckTime: new Date(),
    };
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down InMemoryEventBusAdapter...');
    this.isShuttingDown = true;

    // Clear health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval as NodeJS.Timeout);
      this.healthCheckInterval = undefined;
    }

    // Remove all listeners
    this.emitter.removeAllListeners();
    
    // Clear subscriptions
    this.subscriptions.clear();

    logger.info('InMemoryEventBusAdapter shutdown complete', {
      finalStats: this.eventStats,
    });
  }

  /**
   * Get current event processing statistics
   */
  getStats() {
    return {
      ...this.eventStats,
      activeSubscriptions: this.subscriptions.size,
      eventTypes: Array.from(new Set(Array.from(this.subscriptions.values()).map(s => s.eventType))),
    };
  }

  /**
   * Get queue sizes (simulated for in-memory adapter)
   */
  private getQueueSizes(): Record<string, number> {
    const queueSizes: Record<string, number> = {};
    
    // For in-memory, we can only report active listeners
    for (const [_, subscription] of this.subscriptions) {
      const queueName = subscription.options.queue || `queue-${subscription.eventType}`;
      queueSizes[queueName] = this.emitter.listenerCount(subscription.eventType);
    }
    
    return queueSizes;
  }

  /**
   * Start periodic health checking
   */
  private startHealthChecking(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.healthCheck();
        
        if (health.status !== 'healthy') {
          logger.warn('InMemoryEventBusAdapter health check failed', { health });
        }
      } catch (error) {
        logger.error('Health check failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }, this.config.healthCheckInterval);
  }
}

/**
 * Subscription information for tracking
 */
interface SubscriptionInfo {
  eventType: string;
  handler: Function;
  options: SubscriptionOptions;
  subscribedAt: Date;
}

/**
 * Factory function to create InMemoryEventBusAdapter
 */
export const createInMemoryEventBus = (config?: Partial<EventBusConfig>): InMemoryEventBusAdapter => {
  return new InMemoryEventBusAdapter(config);
};
