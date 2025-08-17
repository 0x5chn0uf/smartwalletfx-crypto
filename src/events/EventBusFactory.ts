import { EventBusPort, EventBusConfig } from '@/ports/EventBusPort';
import { InMemoryEventBusAdapter } from '@/adapters/outbound/event-bus/InMemoryEventBusAdapter';
import { BullMQEventBusAdapter } from '@/adapters/outbound/event-bus/BullMQEventBusAdapter';
import type { Config } from '@/config';
import { logger } from '@/utils/logger';

/**
 * Event Bus Factory
 *
 * Factory for creating appropriate event bus implementations based on environment
 * and configuration. Provides a clean abstraction layer for event bus creation.
 */
export class EventBusFactory {
  /**
   * Create an event bus instance based on environment and configuration
   */
  static create(eventBusType?: string, eventBusConfig?: Partial<EventBusConfig>): EventBusPort {
    const environment = process.env.NODE_ENV || 'development';
    const busType = eventBusType || process.env.EVENT_BUS_TYPE || 'auto';

    // Determine which event bus to use
    const useInMemory = EventBusFactory.shouldUseInMemory(environment, busType);

    if (useInMemory) {
      logger.info('Creating InMemoryEventBusAdapter for development/testing');
      return new InMemoryEventBusAdapter(eventBusConfig);
    } else {
      logger.info('Creating BullMQEventBusAdapter for production');
      return new BullMQEventBusAdapter(eventBusConfig);
    }
  }

  /**
   * Create an in-memory event bus (for testing/development)
   */
  static createInMemory(eventBusConfig?: Partial<EventBusConfig>): EventBusPort {
    logger.info('Creating InMemoryEventBusAdapter');
    return new InMemoryEventBusAdapter(eventBusConfig);
  }

  /**
   * Create a BullMQ event bus (for production)
   */
  static createBullMQ(eventBusConfig?: Partial<EventBusConfig>): EventBusPort {
    logger.info('Creating BullMQEventBusAdapter');
    return new BullMQEventBusAdapter(eventBusConfig);
  }

  /**
   * Get default configuration for event bus
   */
  static getDefaultConfig(): EventBusConfig {
    return {
      adapter: 'in-memory',
    };
  }

  /**
   * Create event bus with default production configuration
   */
  static createWithProductionDefaults(): EventBusPort {
    const productionConfig: EventBusConfig = {
      adapter: 'bullmq',
    };

    return EventBusFactory.createBullMQ(productionConfig);
  }

  /**
   * Create event bus with default development configuration
   */
  static createWithDevelopmentDefaults(): EventBusPort {
    const developmentConfig: EventBusConfig = {
      adapter: 'in-memory',
    };

    return EventBusFactory.createInMemory(developmentConfig);
  }

  /**
   * Determine if in-memory event bus should be used
   */
  private static shouldUseInMemory(environment: string, eventBusType: string): boolean {
    // Explicit configuration takes precedence
    if (eventBusType === 'memory' || eventBusType === 'inmemory') {
      return true;
    }

    if (eventBusType === 'bullmq' || eventBusType === 'redis') {
      return false;
    }

    // Auto-detection based on environment
    if (eventBusType === 'auto') {
      // Use in-memory for test and development environments
      return environment === 'test' || environment === 'development';
    }

    // Default to BullMQ for unknown configurations
    return false;
  }
}

/**
 * Singleton event bus instance
 */
let eventBusInstance: EventBusPort | null = null;

/**
 * Get or create singleton event bus instance
 */
export const getEventBus = (): EventBusPort => {
  if (!eventBusInstance) {
    const defaultConfig = EventBusFactory.getDefaultConfig();
    eventBusInstance = EventBusFactory.create('auto', defaultConfig);

    logger.info('Event bus singleton created', {
      type: eventBusInstance.constructor.name,
      config: defaultConfig,
    });
  }

  return eventBusInstance;
};

/**
 * Reset singleton (mainly for testing)
 */
export const resetEventBus = (): void => {
  if (eventBusInstance) {
    logger.info('Resetting event bus singleton');
    eventBusInstance = null;
  }
};

/**
 * Initialize event bus singleton with specific instance
 */
export const initializeEventBus = (instance: EventBusPort): void => {
  if (eventBusInstance) {
    logger.warn('Event bus singleton already initialized, replacing...');
  }

  eventBusInstance = instance;
  logger.info('Event bus singleton initialized', {
    type: instance.constructor.name,
  });
};
