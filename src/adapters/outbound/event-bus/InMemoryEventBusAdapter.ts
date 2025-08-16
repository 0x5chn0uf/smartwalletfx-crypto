import { EventEmitter } from 'events';
import { EventBusPort, EventHandler, EventBusConfig, IntegrationEvent, PublishOptions, EventSubscription } from '@/ports/EventBusPort';
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
  private subscriptions: Map<string, any> = new Map();
  private config: EventBusConfig;
  private isShuttingDown = false;
  private eventStats = {
    published: 0,
    processed: 0,
    failed: 0,
    retried: 0,
  };

  constructor(config: Partial<EventBusConfig> = {}) {
    this.config = {
        adapter: 'in-memory',
        ...config,
    };

    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100); // Allow many subscribers

    logger.info('InMemoryEventBusAdapter initialized', {
      config: this.config,
    });
  }

  async initialize(): Promise<void> {
      // Nothing to do for in-memory
  }

  async publish(event: IntegrationEvent, options?: PublishOptions): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Event bus is shutting down');
    }

    try {
      this.eventStats.published++;
      
      logger.debug('Publishing event', {
        eventType: event.type,
        eventId: event.id,
      });

      // Emit the event asynchronously
      process.nextTick(() => {
        this.emitter.emit(event.type, event);
        this.emitter.emit('*', event); // Wildcard for global listeners
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

  async publishBatch(events: IntegrationEvent[], options?: PublishOptions): Promise<void> {
      for(const event of events) {
          await this.publish(event, options);
      }
  }

  async subscribe(
    eventType: string,
    handler: EventHandler,
    options?: EventSubscription['options']
  ): Promise<string> {
    if (this.isShuttingDown) {
      throw new Error('Event bus is shutting down');
    }

    const subscriptionId = uuidv4();

    // Create wrapped handler with retry logic
    const wrappedHandler = async (event: IntegrationEvent) => {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= (options?.maxRetries || 0); attempt++) {
        try {
          await handler(event);
          
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
            maxRetries: options?.maxRetries,
            error: lastError.message,
            subscriptionId,
          });

          // If not the last attempt, wait before retrying
          if (attempt < (options?.maxRetries || 0)) {
            await new Promise(resolve => 
              setTimeout(resolve, (options?.retryDelayMs || 1000) * Math.pow(2, attempt))
            );
          }
        }
      }

      // All retries exhausted
      logger.error('Event processing failed after all retries', {
        eventType: event.type,
        eventId: event.id,
        maxRetries: options?.maxRetries,
        error: lastError?.message,
        subscriptionId,
      });

      // In a real system, this would go to a Dead Letter Queue
      // For in-memory, we just log it
      if (options?.deadLetterQueue) {
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
      options: options,
      subscribedAt: new Date(),
    });

    // Register the handler with the emitter
    this.emitter.on(eventType, wrappedHandler);

    logger.info('Subscription created', {
      subscriptionId,
      eventType,
      options: options,
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

  async getHealth() {
    const isHealthy = !this.isShuttingDown;

    return {
        isHealthy: isHealthy,
        stats: {
            publishedCount: this.eventStats.published,
            consumedCount: this.eventStats.processed,
            errorCount: this.eventStats.failed,
            activeSubscriptions: this.subscriptions.size
        },
        adapter: 'in-memory',
        lastCheckedAt: new Date()
      };
  }

  async getMetrics() {
    return {
      publishedEvents: {},
      consumedEvents: {},
      averageLatencyMs: {},
      errorRate: {},
      throughputPerSecond: 0
    }
}

  async shutdown(): Promise<void> {
    logger.info('Shutting down InMemoryEventBusAdapter...');
    this.isShuttingDown = true;

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
}

/**
 * Factory function to create InMemoryEventBusAdapter
 */
export const createInMemoryEventBus = (config?: Partial<EventBusConfig>): InMemoryEventBusAdapter => {
  return new InMemoryEventBusAdapter(config);
};