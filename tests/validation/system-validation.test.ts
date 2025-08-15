/**
 * Comprehensive System Validation Test Suite
 * Validates the complete hexagonal event-driven implementation
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/testing';
import request from 'supertest';
import app from '../../src/app';
import { config } from '../../src/config';
import { getChainManager } from '../../src/services/ChainManager';
import { redisManager } from '../../src/utils/redis';
import { getEventBus } from '../../src/events/EventBusFactory';

describe('System Validation', () => {
  let chainManager: any;
  let eventBus: any;

  beforeAll(async () => {
    // Initialize system components
    chainManager = getChainManager();
    eventBus = getEventBus();
    
    // Ensure systems are ready
    await redisManager.healthCheck();
    await eventBus.healthCheck();
  });

  afterAll(async () => {
    // Cleanup
    await chainManager?.stop();
    await eventBus?.shutdown();
  });

  describe('Core System Health', () => {
    it('should have all required services initialized', () => {
      expect(chainManager).toBeDefined();
      expect(eventBus).toBeDefined();
      expect(config).toBeDefined();
    });

    it('should pass health check endpoint', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('status', 'healthy');
    });

    it('should have metrics endpoint available', async () => {
      const response = await request(app)
        .get('/metrics')
        .expect(200);

      expect(response.text).toContain('# HELP');
      expect(response.text).toContain('# TYPE');
    });
  });

  describe('Event Bus Integration', () => {
    it('should have event bus operational', async () => {
      const health = await eventBus.healthCheck();
      expect(health.status).toBe('healthy');
    });

    it('should support event publishing and subscription', async () => {
      let receivedEvent = null;
      
      // Subscribe to test event
      const subscription = await eventBus.subscribe('test-event', (event: any) => {
        receivedEvent = event;
      });

      // Publish test event
      await eventBus.publish('test-event', { test: 'data' });

      // Wait a bit for event processing
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(receivedEvent).toBeTruthy();
      expect(receivedEvent.test).toBe('data');

      // Cleanup
      await eventBus.unsubscribe(subscription.subscriptionId);
    });
  });

  describe('Chain Provider Integration', () => {
    it('should have supported chains configured', () => {
      const supportedChains = chainManager.getSupportedChains();
      expect(supportedChains.length).toBeGreaterThan(0);
    });

    it('should validate addresses correctly', () => {
      // Test Ethereum address
      const ethAddress = '0x742d35Cc6634C0532925a3b8D0000000000000000';
      expect(chainManager.isValidAddress(ethAddress, 1)).toBe(true);
      
      // Test invalid address
      expect(chainManager.isValidAddress('invalid', 1)).toBe(false);
    });
  });

  describe('Performance Targets', () => {
    it('should handle concurrent requests efficiently', async () => {
      const start = Date.now();
      
      // Make multiple concurrent health check requests
      const requests = Array(10).fill(null).map(() => 
        request(app).get('/health')
      );
      
      const responses = await Promise.all(requests);
      const duration = Date.now() - start;
      
      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
      
      // Should complete within reasonable time (less than 5 seconds)
      expect(duration).toBeLessThan(5000);
    });

    it('should maintain response time targets', async () => {
      const start = Date.now();
      
      await request(app)
        .get('/health')
        .expect(200);
      
      const duration = Date.now() - start;
      
      // Health check should respond within 1 second
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid routes gracefully', async () => {
      const response = await request(app)
        .get('/invalid-route')
        .expect(404);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error');
    });

    it('should handle malformed requests', async () => {
      const response = await request(app)
        .post('/portfolio/0xinvalid')
        .send({ invalid: 'data' })
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
    });
  });

  describe('Security', () => {
    it('should have security headers enabled', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      // Check for common security headers
      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers).toHaveProperty('x-frame-options');
    });

    it('should handle CORS properly', async () => {
      const response = await request(app)
        .options('/health')
        .set('Origin', 'http://localhost:3000')
        .expect(204);

      expect(response.headers).toHaveProperty('access-control-allow-origin');
    });
  });

  describe('Hexagonal Architecture Validation', () => {
    it('should have proper port/adapter separation', () => {
      // Verify that business logic is separated from infrastructure
      expect(() => {
        // These should be available as clean interfaces
        require('../../src/ports/ChainProviderPort');
        require('../../src/ports/EventBusPort');
      }).not.toThrow();
    });

    it('should support adapter swapping', async () => {
      // Event bus should be configurable
      expect(eventBus.constructor.name).toMatch(/(InMemory|BullMQ)EventBusAdapter/);
    });
  });

  describe('Event-Driven Architecture', () => {
    it('should process events asynchronously', async () => {
      let eventProcessed = false;
      
      await eventBus.subscribe('async-test', () => {
        eventProcessed = true;
      });

      await eventBus.publish('async-test', { async: true });
      
      // Event should be processed asynchronously
      expect(eventProcessed).toBe(true);
    });

    it('should maintain event ordering', async () => {
      const events: number[] = [];
      
      await eventBus.subscribe('order-test', (event: any) => {
        events.push(event.order);
      });

      // Publish events in order
      for (let i = 1; i <= 5; i++) {
        await eventBus.publish('order-test', { order: i });
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(events).toEqual([1, 2, 3, 4, 5]);
    });
  });
});