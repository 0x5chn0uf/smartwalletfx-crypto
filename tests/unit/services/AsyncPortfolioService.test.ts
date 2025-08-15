import { AsyncPortfolioService, getAsyncPortfolioService } from '@/services/AsyncPortfolioService';
import { EventBusFactory } from '@/events/EventBusFactory';
import { redisManager } from '@/utils/redis';
import { ChainId } from '@/types/blockchain';

// Mock dependencies
jest.mock('@/utils/redis');
jest.mock('@/utils/logger');
jest.mock('@/config', () => ({
  config: {
    features: {
      asyncPortfolio: true,
      asyncPortfolioMaxRequests: 10,
    },
  },
}));

const mockRedisManager = redisManager as jest.Mocked<typeof redisManager>;

describe('AsyncPortfolioService', () => {
  let eventBus: any;
  let asyncPortfolioService: AsyncPortfolioService;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock event bus
    eventBus = {
      publish: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockResolvedValue('subscription-id'),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
      getHealth: jest.fn().mockResolvedValue({ isHealthy: true }),
      getMetrics: jest.fn().mockResolvedValue({}),
      shutdown: jest.fn().mockResolvedValue(undefined),
    };

    asyncPortfolioService = new AsyncPortfolioService(eventBus);
  });

  describe('submitPortfolioRequest', () => {
    const mockRequestData = {
      address: '0x1234567890123456789012345678901234567890',
      options: {
        chains: [ChainId.ETHEREUM],
        includeDefi: true,
        includeNfts: true,
        includeMetadata: true,
        includeAnalytics: false,
        forceRefresh: false,
      },
      context: {
        clientType: 'web' as const,
        priority: 'medium' as const,
      },
      requestId: 'test-request-id',
    };

    it('should submit a portfolio request successfully', async () => {
      mockRedisManager.get.mockResolvedValue(null); // No existing request
      mockRedisManager.set.mockResolvedValue(true);

      const result = await asyncPortfolioService.submitPortfolioRequest(
        mockRequestData.address,
        mockRequestData.options,
        mockRequestData.context,
        mockRequestData.requestId
      );

      expect(result).toEqual({
        requestId: mockRequestData.requestId,
        status: 'queued',
        submittedAt: expect.any(String),
        estimatedCompletionTime: expect.any(String),
      });

      expect(eventBus.publish).toHaveBeenCalledTimes(1);
      expect(mockRedisManager.set).toHaveBeenCalled();
    });

    it('should return existing request if duplicate', async () => {
      const existingStatus = {
        requestId: mockRequestData.requestId,
        status: 'processing',
        submittedAt: new Date().toISOString(),
        estimatedCompletionTime: new Date(Date.now() + 10000).toISOString(),
      };

      mockRedisManager.get.mockResolvedValue(existingStatus);

      const result = await asyncPortfolioService.submitPortfolioRequest(
        mockRequestData.address,
        mockRequestData.options,
        mockRequestData.context,
        mockRequestData.requestId
      );

      expect(result).toEqual({
        requestId: mockRequestData.requestId,
        status: 'processing',
        submittedAt: existingStatus.submittedAt,
        estimatedCompletionTime: existingStatus.estimatedCompletionTime,
      });

      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('should reject when max concurrent requests exceeded', async () => {
      // Fill up the service with maximum requests
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          asyncPortfolioService.submitPortfolioRequest(
            mockRequestData.address,
            mockRequestData.options,
            mockRequestData.context,
            `request-${i}`
          )
        );
      }
      await Promise.all(promises);

      // This should fail
      await expect(
        asyncPortfolioService.submitPortfolioRequest(
          mockRequestData.address,
          mockRequestData.options,
          mockRequestData.context,
          'overflow-request'
        )
      ).rejects.toThrow('Maximum concurrent async requests exceeded');
    });

    it('should handle event bus publish failure', async () => {
      mockRedisManager.get.mockResolvedValue(null);
      mockRedisManager.set.mockResolvedValue(true);
      mockRedisManager.del.mockResolvedValue(true);
      eventBus.publish.mockRejectedValue(new Error('Event bus error'));

      await expect(
        asyncPortfolioService.submitPortfolioRequest(
          mockRequestData.address,
          mockRequestData.options,
          mockRequestData.context,
          mockRequestData.requestId
        )
      ).rejects.toThrow('Failed to submit async portfolio request');

      expect(mockRedisManager.del).toHaveBeenCalled(); // Cleanup
    });
  });

  describe('getRequestStatus', () => {
    it('should return status from in-memory cache', async () => {
      const requestId = 'test-request-id';
      
      // First submit a request to populate in-memory cache
      await asyncPortfolioService.submitPortfolioRequest(
        '0x1234567890123456789012345678901234567890',
        { includeDefi: true, includeNfts: true },
        { clientType: 'web' },
        requestId
      );

      const status = await asyncPortfolioService.getRequestStatus(requestId);

      expect(status).toEqual({
        requestId,
        status: 'queued',
        submittedAt: expect.any(String),
        estimatedCompletionTime: expect.any(String),
        progress: 0,
      });
    });

    it('should return status from Redis cache', async () => {
      const requestId = 'test-request-id';
      const cachedStatus = {
        requestId,
        status: 'completed',
        submittedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };

      mockRedisManager.get.mockResolvedValue(cachedStatus);

      const status = await asyncPortfolioService.getRequestStatus(requestId);

      expect(status).toEqual(cachedStatus);
    });

    it('should return null for non-existent request', async () => {
      mockRedisManager.get.mockResolvedValue(null);

      const status = await asyncPortfolioService.getRequestStatus('non-existent');

      expect(status).toBeNull();
    });
  });

  describe('getRequestResult', () => {
    it('should return result from Redis', async () => {
      const requestId = 'test-request-id';
      const mockResult = {
        requestId,
        data: { address: '0x123', totalValueUSD: 1000 },
        completedAt: new Date().toISOString(),
        metadata: {
          processingTime: 5000,
          cacheHitRate: 80,
          dataQuality: 95,
        },
      };

      mockRedisManager.get.mockResolvedValue(mockResult);

      const result = await asyncPortfolioService.getRequestResult(requestId);

      expect(result).toEqual(mockResult);
    });

    it('should return null for non-existent result', async () => {
      mockRedisManager.get.mockResolvedValue(null);

      const result = await asyncPortfolioService.getRequestResult('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('updateRequestStatus', () => {
    it('should update status for active request', async () => {
      const requestId = 'test-request-id';
      
      // First submit a request
      await asyncPortfolioService.submitPortfolioRequest(
        '0x1234567890123456789012345678901234567890',
        { includeDefi: true, includeNfts: true },
        { clientType: 'web' },
        requestId
      );

      await asyncPortfolioService.updateRequestStatus(requestId, 'processing');

      const status = await asyncPortfolioService.getRequestStatus(requestId);
      expect(status?.status).toBe('processing');
    });

    it('should archive completed request', async () => {
      const requestId = 'test-request-id';
      const mockResult = { data: 'test-data' };
      
      // First submit a request
      await asyncPortfolioService.submitPortfolioRequest(
        '0x1234567890123456789012345678901234567890',
        { includeDefi: true, includeNfts: true },
        { clientType: 'web' },
        requestId
      );

      mockRedisManager.set.mockResolvedValue(true);
      mockRedisManager.del.mockResolvedValue(true);

      await asyncPortfolioService.updateRequestStatus(requestId, 'completed', mockResult);

      expect(mockRedisManager.set).toHaveBeenCalledWith(
        `async-portfolio:status:${requestId}`,
        expect.objectContaining({
          requestId,
          status: 'completed',
        }),
        3600
      );

      expect(mockRedisManager.set).toHaveBeenCalledWith(
        `async-portfolio:result:${requestId}`,
        mockResult,
        3600
      );
    });
  });

  describe('getRequestStats', () => {
    it('should return current statistics', async () => {
      const stats = asyncPortfolioService.getRequestStats();

      expect(stats).toEqual({
        activeRequests: 0,
        maxConcurrentRequests: 10,
        queuedRequests: 0,
        processingRequests: 0,
        utilizationPercent: 0,
      });
    });

    it('should reflect active requests in stats', async () => {
      // Submit a request
      await asyncPortfolioService.submitPortfolioRequest(
        '0x1234567890123456789012345678901234567890',
        { includeDefi: true, includeNfts: true },
        { clientType: 'web' },
        'test-request-id'
      );

      const stats = asyncPortfolioService.getRequestStats();

      expect(stats).toEqual({
        activeRequests: 1,
        maxConcurrentRequests: 10,
        queuedRequests: 1,
        processingRequests: 0,
        utilizationPercent: 10,
      });
    });
  });

  describe('cleanup', () => {
    it('should clean up expired requests', async () => {
      const requestId = 'test-request-id';
      
      // Submit a request
      await asyncPortfolioService.submitPortfolioRequest(
        '0x1234567890123456789012345678901234567890',
        { includeDefi: true, includeNfts: true },
        { clientType: 'web' },
        requestId
      );

      // Mock time to make request appear expired
      const originalNow = Date.now;
      Date.now = jest.fn(() => originalNow() + 31 * 60 * 1000); // 31 minutes later

      mockRedisManager.set.mockResolvedValue(true);
      mockRedisManager.del.mockResolvedValue(true);

      await asyncPortfolioService.cleanup();

      // Restore Date.now
      Date.now = originalNow;

      const status = await asyncPortfolioService.getRequestStatus(requestId);
      expect(status).toBeNull(); // Should be cleaned up
    });
  });

  describe('singleton pattern', () => {
    it('should return the same instance when called multiple times', () => {
      const instance1 = getAsyncPortfolioService(eventBus);
      const instance2 = getAsyncPortfolioService(eventBus);

      expect(instance1).toBe(instance2);
    });
  });
});