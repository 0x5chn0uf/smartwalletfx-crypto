import { InMemoryEventBusAdapter } from '@/adapters/outbound/event-bus/InMemoryEventBusAdapter';
import { createEvent, EventTypes } from '@/events/types';
import { logger } from '@/utils/logger';

// Mock logger to avoid noise in tests
jest.mock('@/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('InMemoryEventBusAdapter', () => {
  let eventBus: InMemoryEventBusAdapter;

  beforeEach(() => {
    eventBus = new InMemoryEventBusAdapter({
      defaultRetries: 2,
      defaultRetryDelay: 100,
      defaultConcurrency: 5,
      enableDLQ: false,
      healthCheckInterval: 1000,
    });
  });

  afterEach(async () => {
    await eventBus.shutdown();
  });

  describe('publish', () => {
    it('should publish events successfully', async () => {
      const event = createEvent.deFiPositionsRequested('0x123', {
        chainIds: [1],
        protocols: ['aave'],
      });

      await expect(eventBus.publish(event)).resolves.toBeUndefined();
    });

    it('should publish events with custom metadata', async () => {
      const event = createEvent.deFiPositionsRequested('0x123');
      const metadata = {
        correlationId: 'test-123',
        priority: 'high' as const,
        source: 'test',
      };

      await expect(eventBus.publish(event, metadata)).resolves.toBeUndefined();
    });

    it('should throw error when shutting down', async () => {
      await eventBus.shutdown();

      const event = createEvent.deFiPositionsRequested('0x123');
      await expect(eventBus.publish(event)).rejects.toThrow('Event bus is shutting down');
    });
  });

  describe('subscribe', () => {
    it('should subscribe to events and receive them', async () => {
      const handler = jest.fn();
      const subscriptionId = await eventBus.subscribe(
        EventTypes.DEFI_POSITIONS_REQUESTED_V1,
        handler
      );

      expect(subscriptionId).toBeDefined();
      expect(typeof subscriptionId).toBe('string');

      const event = createEvent.deFiPositionsRequested('0x123');
      await eventBus.publish(event);

      // Wait for async event processing
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(handler).toHaveBeenCalledWith(event, expect.any(Object));
    });

    it('should handle subscription options', async () => {
      const handler = jest.fn();
      const subscriptionId = await eventBus.subscribe(
        EventTypes.DEFI_POSITIONS_REQUESTED_V1,
        handler,
        {
          maxRetries: 1,
          retryDelay: 50,
          queue: 'test-queue',
        }
      );

      expect(subscriptionId).toBeDefined();
    });

    it('should throw error when shutting down', async () => {
      await eventBus.shutdown();

      const handler = jest.fn();
      await expect(
        eventBus.subscribe(EventTypes.DEFI_POSITIONS_REQUESTED_V1, handler)
      ).rejects.toThrow('Event bus is shutting down');
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe from events', async () => {
      const handler = jest.fn();
      const subscriptionId = await eventBus.subscribe(
        EventTypes.DEFI_POSITIONS_REQUESTED_V1,
        handler
      );

      await eventBus.unsubscribe(subscriptionId);

      const event = createEvent.deFiPositionsRequested('0x123');
      await eventBus.publish(event);

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle non-existent subscription gracefully', async () => {
      await expect(eventBus.unsubscribe('non-existent')).resolves.toBeUndefined();
    });
  });

  describe('retry logic', () => {
    it('should retry failed event handlers', async () => {
      let attempts = 0;
      const handler = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Test error');
        }
      });

      await eventBus.subscribe(
        EventTypes.DEFI_POSITIONS_REQUESTED_V1,
        handler,
        { maxRetries: 3, retryDelay: 10 }
      );

      const event = createEvent.deFiPositionsRequested('0x123');
      await eventBus.publish(event);

      // Wait for retries
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalledTimes(3);
      expect(attempts).toBe(3);
    });

    it('should give up after max retries', async () => {
      const handler = jest.fn().mockImplementation(() => {
        throw new Error('Persistent error');
      });

      await eventBus.subscribe(
        EventTypes.DEFI_POSITIONS_REQUESTED_V1,
        handler,
        { maxRetries: 2, retryDelay: 10 }
      );

      const event = createEvent.deFiPositionsRequested('0x123');
      await eventBus.publish(event);

      // Wait for all retries
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });
  });

  describe('health check', () => {
    it('should return healthy status when running', async () => {
      const health = await eventBus.healthCheck();

      expect(health).toEqual({
        status: 'healthy',
        connected: true,
        queueSizes: expect.any(Object),
        lastCheckTime: expect.any(Date),
      });
    });

    it('should return unhealthy status when shut down', async () => {
      await eventBus.shutdown();
      const health = await eventBus.healthCheck();

      expect(health.status).toBe('unhealthy');
    });
  });

  describe('stats', () => {
    it('should track event statistics', async () => {
      const handler = jest.fn();
      await eventBus.subscribe(EventTypes.DEFI_POSITIONS_REQUESTED_V1, handler);

      const event = createEvent.deFiPositionsRequested('0x123');
      await eventBus.publish(event);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = eventBus.getStats();
      expect(stats.published).toBe(1);
      expect(stats.processed).toBe(1);
      expect(stats.failed).toBe(0);
      expect(stats.activeSubscriptions).toBe(1);
    });
  });

  describe('shutdown', () => {
    it('should shutdown gracefully', async () => {
      const handler = jest.fn();
      await eventBus.subscribe(EventTypes.DEFI_POSITIONS_REQUESTED_V1, handler);

      await eventBus.shutdown();

      const stats = eventBus.getStats();
      expect(stats.activeSubscriptions).toBe(0);
    });

    it('should handle multiple shutdowns gracefully', async () => {
      await eventBus.shutdown();
      await expect(eventBus.shutdown()).resolves.toBeUndefined();
    });
  });
});
