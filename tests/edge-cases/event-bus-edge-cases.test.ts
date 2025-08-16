/**
 * Edge Case Tests for Event Bus System
 * Testing boundary conditions, error scenarios, and extreme load
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { EventBusFactory } from '@/events/EventBusFactory';
import { InMemoryEventBusAdapter } from '@/adapters/outbound/event-bus/InMemoryEventBusAdapter';
import { BullMQEventBusAdapter } from '@/adapters/outbound/event-bus/BullMQEventBusAdapter';
import { PortfolioAggregationRequestV1 } from '@/app/events/PortfolioEvents';

describe('Event Bus Edge Cases', () => {
  let eventBus: any;

  beforeEach(() => {
    eventBus = EventBusFactory.create('memory');
  });

  afterEach(async () => {
    if (eventBus && typeof eventBus.disconnect === 'function') {
      await eventBus.disconnect();
    }
  });

  describe('Memory Exhaustion Protection', () => {
    test('should handle extremely large payloads gracefully', async () => {
      const largePayload = {
        type: 'PortfolioAggregationRequestV1' as const,
        payload: {
          requestId: 'test-large',
          address: '0x' + 'a'.repeat(40),
          options: {
            data: 'x'.repeat(10 * 1024 * 1024), // 10MB string
          },
        },
        metadata: {
          version: '1.0.0',
          timestamp: Date.now(),
          correlationId: 'test-correlation',
        },
      };

      const handler = jest.fn();
      await eventBus.subscribe('PortfolioAggregationRequestV1', handler);
      
      // Should not crash or hang
      await expect(eventBus.publish(largePayload)).resolves.not.toThrow();
      
      // Give time for processing
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('should handle rapid event publishing without memory leaks', async () => {
      const handler = jest.fn();
      await eventBus.subscribe('PortfolioAggregationRequestV1', handler);
      
      const promises = [];
      for (let i = 0; i < 1000; i++) {
        const event = {
          type: 'PortfolioAggregationRequestV1' as const,
          payload: {
            requestId: `test-${i}`,
            address: '0x1234567890123456789012345678901234567890',
            options: {},
          },
          metadata: {
            version: '1.0.0',
            timestamp: Date.now() + i,
            correlationId: `correlation-${i}`,
          },
        };
        promises.push(eventBus.publish(event));
      }

      await Promise.all(promises);
      
      // Give time for processing
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(handler).toHaveBeenCalledTimes(1000);
    });
  });

  describe('Error Handling Edge Cases', () => {
    test('should handle handler exceptions without stopping event processing', async () => {
      const faultyHandler = jest.fn().mockImplementation(() => {
        throw new Error('Handler intentionally failed');
      });
      const goodHandler = jest.fn();

      await eventBus.subscribe('PortfolioAggregationRequestV1', faultyHandler);
      await eventBus.subscribe('PortfolioAggregationRequestV1', goodHandler);

      const event = {
        type: 'PortfolioAggregationRequestV1' as const,
        payload: {
          requestId: 'test-error',
          address: '0x1234567890123456789012345678901234567890',
          options: {},
        },
        metadata: {
          version: '1.0.0',
          timestamp: Date.now(),
          correlationId: 'error-test',
        },
      };

      await eventBus.publish(event);
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(faultyHandler).toHaveBeenCalledTimes(1);
      expect(goodHandler).toHaveBeenCalledTimes(1);
    });

    test('should handle malformed events gracefully', async () => {
      const handler = jest.fn();
      await eventBus.subscribe('PortfolioAggregationRequestV1', handler);

      const malformedEvents = [
        null,
        undefined,
        {},
        { type: null },
        { type: '', payload: null },
        { type: 'InvalidType', payload: {} },
      ];

      for (const malformedEvent of malformedEvents) {
        await expect(eventBus.publish(malformedEvent as any)).resolves.not.toThrow();
      }

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Concurrency Edge Cases', () => {
    test('should handle simultaneous subscribe/unsubscribe operations', async () => {
      const promises = [];
      const handlers = Array.from({ length: 100 }, () => jest.fn());

      // Rapid subscribe/unsubscribe
      for (let i = 0; i < 100; i++) {
        promises.push(eventBus.subscribe('PortfolioAggregationRequestV1', handlers[i]));
        if (i % 2 === 0) {
          promises.push(
            eventBus.subscribe('PortfolioAggregationRequestV1', handlers[i])
              .then(() => eventBus.unsubscribe('PortfolioAggregationRequestV1', handlers[i]))
          );
        }
      }

      await Promise.all(promises);

      const event = {
        type: 'PortfolioAggregationRequestV1' as const,
        payload: {
          requestId: 'concurrency-test',
          address: '0x1234567890123456789012345678901234567890',
          options: {},
        },
        metadata: {
          version: '1.0.0',
          timestamp: Date.now(),
          correlationId: 'concurrency-correlation',
        },
      };

      await eventBus.publish(event);
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should not throw or crash
      expect(true).toBe(true);
    });
  });

  describe('Resource Cleanup Edge Cases', () => {
    test('should properly cleanup resources on disconnect', async () => {
      const handler = jest.fn();
      await eventBus.subscribe('PortfolioAggregationRequestV1', handler);

      // Publish event before disconnect
      const event = {
        type: 'PortfolioAggregationRequestV1' as const,
        payload: {
          requestId: 'cleanup-test',
          address: '0x1234567890123456789012345678901234567890',
          options: {},
        },
        metadata: {
          version: '1.0.0',
          timestamp: Date.now(),
          correlationId: 'cleanup-correlation',
        },
      };

      await eventBus.publish(event);
      
      // Disconnect should not hang or throw
      if (typeof eventBus.disconnect === 'function') {
        await expect(eventBus.disconnect()).resolves.not.toThrow();
      }

      // Publishing after disconnect should fail gracefully
      await expect(eventBus.publish(event)).resolves.not.toThrow();
    });
  });

  describe('Event Ordering Edge Cases', () => {
    test('should maintain event order under high load', async () => {
      const receivedEvents: number[] = [];
      const handler = jest.fn().mockImplementation((event) => {
        receivedEvents.push(event.metadata.timestamp);
      });

      await eventBus.subscribe('PortfolioAggregationRequestV1', handler);

      // Publish events with sequential timestamps
      const publishPromises = [];
      for (let i = 0; i < 100; i++) {
        const event = {
          type: 'PortfolioAggregationRequestV1' as const,
          payload: {
            requestId: `order-test-${i}`,
            address: '0x1234567890123456789012345678901234567890',
            options: {},
          },
          metadata: {
            version: '1.0.0',
            timestamp: Date.now() + i, // Sequential timestamps
            correlationId: `order-${i}`,
          },
        };
        publishPromises.push(eventBus.publish(event));
      }

      await Promise.all(publishPromises);
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(receivedEvents).toHaveLength(100);
      
      // For in-memory adapter, order should be maintained
      if (eventBus instanceof InMemoryEventBusAdapter) {
        for (let i = 1; i < receivedEvents.length; i++) {
          expect(receivedEvents[i]).toBeGreaterThanOrEqual(receivedEvents[i - 1]);
        }
      }
    });
  });
});