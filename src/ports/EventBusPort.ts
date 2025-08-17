/**
 * Base interface for all integration events in the system
 * Following Cloud Events specification for future compatibility
 */
export interface IntegrationEvent {
  /** Unique identifier for this event instance */
  id: string;
  /** Event type identifier (e.g., 'DeFiPositionsRequestedV1') */
  type: string;
  /** Event version for schema evolution */
  version: string;
  /** ISO 8601 timestamp when event was created */
  timestamp: string;
  /** Request ID for correlation across operations */
  requestId: string;
  /** Source service/component that emitted this event */
  source: string;
  /** Event payload data */
  data: Record<string, any>;
  /** Optional metadata for routing, tracing, etc. */
  metadata?: Record<string, any>;
}

/**
 * Event subscription callback function
 */
export type EventHandler<T extends IntegrationEvent = IntegrationEvent> = (
  event: T
) => Promise<void>;

/**
 * Event subscription configuration
 */
export interface EventSubscription {
  /** Unique subscription identifier */
  subscriptionId: string;
  /** Event type pattern to match (supports wildcards) */
  eventType: string;
  /** Handler function to process matched events */
  handler: EventHandler;
  /** Subscription options */
  options?: {
    /** Maximum retry attempts for failed handlers */
    maxRetries?: number;
    /** Retry delay in milliseconds */
    retryDelayMs?: number;
    /** Dead letter queue after max retries */
    deadLetterQueue?: boolean;
    /** Handler timeout in milliseconds */
    timeoutMs?: number;
  };
}

/**
 * Event publishing options
 */
export interface PublishOptions {
  /** Delay publishing by specified milliseconds */
  delayMs?: number;
  /** Message priority (higher = more urgent) */
  priority?: number;
  /** Maximum retry attempts if publishing fails */
  maxRetries?: number;
  /** Idempotency key to prevent duplicate publishing */
  idempotencyKey?: string;
  /** Custom routing key for partitioning */
  routingKey?: string;
}

/**
 * Event Bus Port - Abstract interface for event publishing and subscribing
 *
 * This port abstracts the event bus implementation, allowing different adapters:
 * - InMemoryEventBusAdapter (dev/testing)
 * - BullMQEventBusAdapter (Redis queues)
 * - KafkaEventBusAdapter (future)
 * - NATSEventBusAdapter (future)
 *
 * Follows hexagonal architecture principles - the application core defines
 * this interface, and infrastructure adapters implement it.
 */
export interface EventBusPort {
  /**
   * Initialize the event bus adapter
   * Called during application startup
   */
  initialize(): Promise<void>;

  /**
   * Publish an event to the bus
   * @param event - The event to publish
   * @param options - Publishing options (delay, priority, etc.)
   * @returns Promise that resolves when event is published
   */
  publish(event: IntegrationEvent, options?: PublishOptions): Promise<void>;

  /**
   * Publish multiple events atomically
   * @param events - Array of events to publish
   * @param options - Publishing options applied to all events
   * @returns Promise that resolves when all events are published
   */
  publishBatch(events: IntegrationEvent[], options?: PublishOptions): Promise<void>;

  /**
   * Subscribe to events by type pattern
   * @param eventType - Event type pattern (supports wildcards like 'DeFi*' or 'Portfolio.*')
   * @param handler - Function to handle matching events
   * @param options - Subscription options
   * @returns Subscription identifier for unsubscribing
   */
  subscribe(
    eventType: string,
    handler: EventHandler,
    options?: EventSubscription['options']
  ): Promise<string>;

  /**
   * Unsubscribe from events
   * @param subscriptionId - ID returned from subscribe()
   */
  unsubscribe(subscriptionId: string): Promise<void>;

  /**
   * Get health status of the event bus
   * @returns Health information
   */
  getHealth(): Promise<{
    isHealthy: boolean;
    stats: {
      publishedCount: number;
      consumedCount: number;
      errorCount: number;
      activeSubscriptions: number;
    };
    adapter: string;
    lastCheckedAt: Date;
  }>;

  /**
   * Get metrics for monitoring
   * @returns Event bus metrics
   */
  getMetrics(): Promise<{
    publishedEvents: Record<string, number>; // by event type
    consumedEvents: Record<string, number>; // by event type
    averageLatencyMs: Record<string, number>; // by event type
    errorRate: Record<string, number>; // by event type
    queueDepth?: number; // if supported by adapter
    throughputPerSecond: number;
  }>;

  /**
   * Graceful shutdown - close connections, flush queues
   */
  shutdown(): Promise<void>;
}

/**
 * Factory function type for creating EventBusPort instances
 * Used by dependency injection container
 */
export type EventBusFactory = () => EventBusPort;

/**
 * Event bus configuration interface
 * Used by adapters for initialization
 */
export interface EventBusConfig {
  /** Adapter type identifier */
  adapter: 'in-memory' | 'bullmq' | 'kafka' | 'nats';

  /** Connection configuration (adapter-specific) */
  connection?: {
    redis?: {
      host: string;
      port: number;
      password?: string;
      db?: number;
    };
    kafka?: {
      brokers: string[];
      clientId: string;
    };
    nats?: {
      servers: string[];
    };
  };

  /** Default publishing options */
  defaults?: {
    maxRetries: number;
    retryDelayMs: number;
    timeoutMs: number;
    batchSize: number;
  };

  /** Feature flags */
  features?: {
    enableMetrics: boolean;
    enableTracing: boolean;
    enableDLQ: boolean;
    enableBatching: boolean;
  };
}

/**
 * Utility function to create a properly structured integration event
 */
export function createIntegrationEvent<T = any>(
  type: string,
  data: T,
  options: {
    requestId: string;
    source: string;
    version?: string;
    metadata?: Record<string, any>;
  }
): IntegrationEvent {
  return {
    id: generateEventId(),
    type,
    version: options.version || '1.0.0',
    timestamp: new Date().toISOString(),
    requestId: options.requestId,
    source: options.source,
    data: data as Record<string, any>,
    metadata: options.metadata,
  };
}

/**
 * Generate a unique event ID
 * Uses timestamp + random for ordering and uniqueness
 */
function generateEventId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `evt_${timestamp}_${random}`;
}

/**
 * Type guard to check if an object is an IntegrationEvent
 */
export function isIntegrationEvent(obj: any): obj is IntegrationEvent {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.id === 'string' &&
    typeof obj.type === 'string' &&
    typeof obj.version === 'string' &&
    typeof obj.timestamp === 'string' &&
    typeof obj.requestId === 'string' &&
    typeof obj.source === 'string' &&
    typeof obj.data === 'object'
  );
}

/**
 * Event type patterns for common subscriptions
 */
export const EventPatterns = {
  ALL: '*',
  DEFI: 'DeFi*',
  PORTFOLIO: 'Portfolio*',
  CACHE: 'Cache*',
  PROVIDER: 'Provider*',
  COST: 'Cost*',
} as const;
