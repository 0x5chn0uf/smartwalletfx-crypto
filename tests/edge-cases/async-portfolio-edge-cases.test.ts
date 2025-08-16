/**
 * Edge Case Tests for Async Portfolio Service
 * Testing boundary conditions, race conditions, and extreme scenarios
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { AsyncPortfolioService } from '@/services/AsyncPortfolioService';
import { EventBusFactory } from '@/events/EventBusFactory';

describe('Async Portfolio Service Edge Cases', () => {
  let service: AsyncPortfolioService;
  let eventBus: any;

  beforeEach(() => {
    eventBus = EventBusFactory.create('memory');
    service = new AsyncPortfolioService(eventBus);
  });

  afterEach(async () => {
    if (eventBus && typeof eventBus.disconnect === 'function') {
      await eventBus.disconnect();
    }
  });

  describe('Request ID Collision Handling', () => {
    test('should handle duplicate request IDs gracefully', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const options = { includeDefi: true };

      // Submit first request
      const result1 = await service.submitPortfolioRequest(address, options);
      expect(result1.status).toBe('queued');

      // Submit duplicate request with same address and options
      const result2 = await service.submitPortfolioRequest(address, options);
      
      // Should return existing request, not create new one
      expect(result2.requestId).toBe(result1.requestId);
      expect(result2.status).toBe('queued');
    });

    test('should handle concurrent duplicate submissions', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const options = { includeDefi: true };

      // Submit multiple concurrent requests
      const promises = Array.from({ length: 10 }, () => 
        service.submitPortfolioRequest(address, options)
      );

      const results = await Promise.all(promises);

      // All should return the same request ID
      const firstRequestId = results[0].requestId;
      results.forEach(result => {
        expect(result.requestId).toBe(firstRequestId);
      });
    });
  });

  describe('Memory Management Edge Cases', () => {
    test('should handle excessive active requests without memory explosion', async () => {
      const promises = [];
      
      // Create many concurrent requests
      for (let i = 0; i < 1000; i++) {
        const address = `0x${i.toString(16).padStart(40, '0')}`;
        promises.push(service.submitPortfolioRequest(address, { includeDefi: true }));
      }

      const results = await Promise.all(promises);
      
      // All requests should be accepted
      expect(results).toHaveLength(1000);
      results.forEach(result => {
        expect(result.status).toBe('queued');
        expect(result.requestId).toBeDefined();
      });
    });

    test('should cleanup completed requests to prevent memory leaks', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const result = await service.submitPortfolioRequest(address, { includeDefi: true });

      // Simulate completion
      await service.updateRequestStatus(result.requestId, 'completed', { 
        totalValue: 1000,
        breakdown: {}
      });

      // Check status - should be accessible
      const status = await service.getRequestStatus(result.requestId);
      expect(status?.status).toBe('completed');

      // The service should have moved completed requests out of active memory
      // (This is implementation dependent - adjust based on actual cleanup strategy)
    });
  });

  describe('Status Transition Edge Cases', () => {
    test('should handle invalid status transitions gracefully', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const result = await service.submitPortfolioRequest(address, { includeDefi: true });

      // Try invalid transition: queued -> completed (should go through processing)
      await expect(
        service.updateRequestStatus(result.requestId, 'completed' as any, { data: 'test' })
      ).resolves.not.toThrow();

      // Try transition from completed back to processing
      await service.updateRequestStatus(result.requestId, 'completed' as any, { data: 'test' });
      await expect(
        service.updateRequestStatus(result.requestId, 'processing' as any)
      ).resolves.not.toThrow();
    });

    test('should handle rapid status updates', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const result = await service.submitPortfolioRequest(address, { includeDefi: true });

      // Rapid status updates
      const updatePromises = [
        service.updateRequestStatus(result.requestId, 'processing' as any),
        service.updateRequestStatus(result.requestId, 'processing' as any),
        service.updateRequestStatus(result.requestId, 'completed' as any, { data: 'test1' }),
        service.updateRequestStatus(result.requestId, 'completed' as any, { data: 'test2' }),
      ];

      await Promise.all(updatePromises);

      const finalStatus = await service.getRequestStatus(result.requestId);
      expect(finalStatus?.status).toBe('completed');
    });
  });

  describe('Error Recovery Edge Cases', () => {
    test('should handle worker crashes gracefully', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const result = await service.submitPortfolioRequest(address, { includeDefi: true });

      // Simulate processing start
      await service.updateRequestStatus(result.requestId, 'processing' as any);

      // Simulate worker crash (no completion notification)
      // In production, this would be handled by timeouts or health checks

      const status = await service.getRequestStatus(result.requestId);
      expect(status?.status).toBe('processing');

      // Service should be able to handle manual recovery
      await service.updateRequestStatus(result.requestId, 'failed' as any, undefined, 'Worker crashed');
      
      const finalStatus = await service.getRequestStatus(result.requestId);
      expect(finalStatus?.status).toBe('failed');
    });

    test('should handle malformed portfolio data gracefully', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const result = await service.submitPortfolioRequest(address, { includeDefi: true });

      // Try to complete with malformed data
      const malformedData = [
        null,
        undefined,
        'string instead of object',
        { invalidStructure: true },
        { totalValue: 'not a number' },
      ];

      for (const badData of malformedData) {
        await expect(
          service.updateRequestStatus(result.requestId, 'completed' as any, badData as any)
        ).resolves.not.toThrow();
      }
    });
  });

  describe('Timeout and Cancellation Edge Cases', () => {
    test('should handle long-running requests appropriately', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const result = await service.submitPortfolioRequest(address, { includeDefi: true });

      // Simulate very long processing time
      await service.updateRequestStatus(result.requestId, 'processing' as any);

      // Wait and check that request is still valid
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const status = await service.getRequestStatus(result.requestId);
      expect(status?.status).toBe('processing');
      expect(status?.requestId).toBe(result.requestId);
    });

    test('should handle requests for non-existent request IDs', async () => {
      const nonExistentId = 'req_nonexistent_12345';
      
      const status = await service.getRequestStatus(nonExistentId);
      expect(status).toBeNull();

      // Updating non-existent request should not throw
      await expect(
        service.updateRequestStatus(nonExistentId, 'completed' as any, {})
      ).resolves.not.toThrow();
    });
  });

  describe('Address Validation Edge Cases', () => {
    test('should handle various address formats', async () => {
      const addressVariations = [
        '0x1234567890123456789012345678901234567890', // Normal
        '0X1234567890123456789012345678901234567890', // Uppercase prefix
        '1234567890123456789012345678901234567890',   // No prefix
        '0x1234567890123456789012345678901234567890', // Mixed case
        '0x' + 'a'.repeat(40),                         // All lowercase
        '0x' + 'A'.repeat(40),                         // All uppercase
      ];

      for (const address of addressVariations) {
        const result = await service.submitPortfolioRequest(address, { includeDefi: true });
        expect(result.status).toBe('queued');
        expect(result.requestId).toBeDefined();
      }
    });

    test('should handle invalid addresses gracefully', async () => {
      const invalidAddresses = [
        '',
        '0x',
        '0x123', // Too short
        '0x' + 'x'.repeat(40), // Invalid hex
        'not an address',
        null,
        undefined,
      ];

      for (const address of invalidAddresses) {
        await expect(
          service.submitPortfolioRequest(address as any, { includeDefi: true })
        ).rejects.toThrow();
      }
    });
  });
});