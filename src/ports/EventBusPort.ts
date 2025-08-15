import { EventMetadata, DomainEvent } from '@/events/types';

/**
 * EventBusPort - Hexagonal Architecture Port Interface
 *
 * Defines the contract for event bus implementations.
 * This port allows the domain layer to publish and subscribe to events
 * without being coupled to specific event bus implementations.
 */
export interface EventBusPort {
  /**
   * Publish a domain event to the event bus
   * @param event - The domain event to publish
   * @param metadata - Optional metadata for the event
   * @returns Promise that resolves when the event is successfully queued
   */
  publish<T extends DomainEvent>(event: T, metadata?: EventMetadata): Promise<void>;

  /**
   * Subscribe to events of a specific type
   * @param eventType - The type of events to subscribe to
   * @param handler - The function to handle events
   * @param options - Optional subscription configuration
   * @returns Promise that resolves with subscription ID
   */
  subscribe<T extends DomainEvent>(
    eventType: string,
    handler: EventHandler<T>,
    options?: SubscriptionOptions
  ): Promise<string>;

  /**
   * Unsubscribe from events
   * @param subscriptionId - The subscription ID to cancel
   * @returns Promise that resolves when unsubscribed
   */
  unsubscribe(subscriptionId: string): Promise<void>;

  /**
   * Health check for the event bus
   * @returns Promise that resolves with health status
   */
  healthCheck(): Promise<EventBusHealth>;

  /**
   * Gracefully shutdown the event bus
   * @returns Promise that resolves when shutdown is complete
   */
  shutdown(): Promise<void>;
}

/**
 * Event handler function type
 */
export type EventHandler<T extends DomainEvent> = (
  event: T,
  metadata: EventMetadata
) => Promise<void> | void;

/**
 * Subscription options
 */
export interface SubscriptionOptions {
  /**
   * Queue/topic name for the subscription
   */
  queue?: string;
  /**
   * Maximum retry attempts for failed events
   */
  maxRetries?: number;
  /**
   * Delay between retry attempts (in milliseconds)
   */
  retryDelay?: number;
  /**
   * Concurrency limit for processing events
   */
  concurrency?: number;
  /**
   * Enable dead letter queue for failed events
   */
  enableDLQ?: boolean;
}

/**
 * Event bus health status
 */
export interface EventBusHealth {
  status: 'healthy' | 'unhealthy' | 'degraded';
  connected: boolean;
  latency?: number;
  queueSizes?: Record<string, number>;
  errors?: string[];
  lastCheckTime: Date;
}

/**
 * Event bus configuration
 */
export interface EventBusConfig {
  /**
   * Default retry policy
   */
  defaultRetries: number;
  /**
   * Default retry delay
   */
  defaultRetryDelay: number;
  /**
   * Default concurrency per queue
   */
  defaultConcurrency: number;
  /**
   * Enable dead letter queue by default
   */
  enableDLQ: boolean;
  /**
   * Health check interval
   */
  healthCheckInterval: number;
}
