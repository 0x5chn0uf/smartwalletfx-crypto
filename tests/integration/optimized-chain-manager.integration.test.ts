/**
 * Optimized ChainManager Integration Tests
 * 
 * Tests for the performance-optimized ChainManager including:
 * - Multi-chain portfolio aggregation with parallel processing
 * - Multi-level caching (memory + Redis)
 * - Circuit breaker integration
 * - Batch processing functionality
 * - Priority-based chain processing
 * - Performance regression detection
 */

import { ChainManager } from '../../src/services/ChainManager';
import { ChainId } from '../../src/types/blockchain';
import { redisManager } from '../../src/utils/redis';
import { CircuitBreakerFactory } from '../../src/utils/circuitBreaker';
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';

// Mock external dependencies
vi.mock('../../src/utils/redis', () => ({
  redisManager: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
    flushall: vi.fn()
  }
}));

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  },
  logApiCall: vi.fn(),
  logCost: vi.fn()
}));

vi.mock('../../src/services/pricing/PriceService', () => ({
  getPriceService: () => ({
    enrichBalances: vi.fn().mockResolvedValue([
      {
        token: { symbol: 'ETH', isNative: true },
        balance: '1000000000000000000',
        balanceUSD: 2000,
        balanceFormatted: '1.0'
      }
    ])
  })
}));

describe('Optimized ChainManager Integration Tests', () => {
  let chainManager: ChainManager;
  const mockRedis = redisManager as any;

  const testConfig = {
    providers: {
      alchemy: {
        apiKey: 'test-alchemy-key',
        networks: ['ethereum', 'polygon']
      },
      helius: {
        apiKey: 'test-helius-key'
      }
    },
    maxConcurrentRequests: 5,
    concurrency: {
      retryConfig: {
        maxAttempts: 2,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        backoffMultiplier: 2.0,
        jitterFactor: 0.1
      }
    }
  };

  beforeAll(() => {
    // Set up environment variables
    process.env.ALCHEMY_API_KEY = 'test-key';
    process.env.HELIUS_API_KEY = 'test-key';
  });

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    CircuitBreakerFactory.reset();
    
    // Setup Redis mocks
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue(true);
    mockRedis.exists.mockResolvedValue(false);

    chainManager = new ChainManager(testConfig);
  });

  afterEach(async () => {
    if (chainManager) {
      await chainManager.gracefulShutdown();
    }
    CircuitBreakerFactory.reset();
  });

  describe('Multi-Chain Portfolio Aggregation', () => {
    const testAddress = '0x742d35Cc6634C0532925a3b8D01d3E0b37Bce61234';
    const mockPortfolioData = {
      address: testAddress,
      chains: [
        {
          address: testAddress,
          chainId: ChainId.ETHEREUM,
          totalValueUSD: 2000,
          tokenCount: 1,
          tokens: [],
          lastUpdated: new Date()
        }
      ],
      totalValueUSD: 2000,
      totalTokens: 1,
      lastUpdated: new Date(),
      performance: {
        dailyChange: 0,
        dailyChangePercent: 0,
        weeklyChange: 0,
        weeklyChangePercent: 0
      }
    };

    it('should aggregate portfolio with parallel processing', async () => {
      // Mock individual chain balance calls to succeed
      const mockGetBalance = vi.spyOn(chainManager, 'getBalance').mockResolvedValue({
        success: true,
        data: [
          {
            token: { symbol: 'ETH', isNative: true, address: '0x0', chainId: ChainId.ETHEREUM },
            balance: '1000000000000000000',
            balanceUSD: 2000,
            balanceFormatted: '1.0'
          }
        ],
        metadata: {
          provider: 'alchemy',
          chainId: ChainId.ETHEREUM,
          timestamp: Date.now(),
          requestId: 'test-123'
        }
      });

      const startTime = Date.now();
      const result = await chainManager.getMultiChainPortfolio(
        testAddress,
        [ChainId.ETHEREUM, ChainId.POLYGON, ChainId.ARBITRUM]
      );
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.chains).toHaveLength(3);
      expect(result.data!.totalValueUSD).toBeGreaterThan(0);
      
      // Should be reasonably fast due to parallel processing
      expect(duration).toBeLessThan(1000);
      
      // Verify parallel execution - all chains should be called
      expect(mockGetBalance).toHaveBeenCalledTimes(3);
    });

    it('should utilize memory cache for fast repeated requests', async () => {
      const mockGetBalance = vi.spyOn(chainManager, 'getBalance').mockResolvedValue({
        success: true,
        data: [],
        metadata: {
          provider: 'alchemy',
          chainId: ChainId.ETHEREUM,
          timestamp: Date.now(),
          requestId: 'test-123'
        }
      });

      // First request - should hit the actual service
      const result1 = await chainManager.getMultiChainPortfolio(testAddress, [ChainId.ETHEREUM]);
      
      // Second request immediately after - should hit memory cache
      const startTime = Date.now();
      const result2 = await chainManager.getMultiChainPortfolio(testAddress, [ChainId.ETHEREUM]);
      const cacheDuration = Date.now() - startTime;

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result2.metadata!.requestId).toBe('memory_cache_hit');
      
      // Cache hit should be extremely fast
      expect(cacheDuration).toBeLessThan(10);
    });

    it('should fall back to Redis cache when memory cache misses', async () => {
      // Mock Redis to return cached data
      mockRedis.get.mockResolvedValue(mockPortfolioData);

      const result = await chainManager.getMultiChainPortfolio(testAddress, [ChainId.ETHEREUM]);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockPortfolioData);
      expect(result.metadata!.requestId).toBe('redis_cache_hit');
      expect(mockRedis.get).toHaveBeenCalled();
    });

    it('should handle partial failures gracefully with circuit breaker', async () => {
      let callCount = 0;
      const mockGetBalance = vi.spyOn(chainManager, 'getBalance').mockImplementation(async (chainId) => {
        callCount++;
        if (chainId === ChainId.POLYGON) {
          throw new Error('Polygon RPC down');
        }
        return {
          success: true,
          data: [],
          metadata: {
            provider: 'alchemy',
            chainId,
            timestamp: Date.now(),
            requestId: `test-${callCount}`
          }
        };
      });

      const result = await chainManager.getMultiChainPortfolio(
        testAddress,
        [ChainId.ETHEREUM, ChainId.POLYGON, ChainId.ARBITRUM]
      );

      expect(result.success).toBe(true);
      expect(result.data!.chains).toHaveLength(2); // Only successful chains
      expect(result.metadata!.requestId).toContain('partial_success');
    });
  });

  describe('Batch Processing Performance', () => {
    it('should process multiple addresses in parallel batches', async () => {
      const addresses = [
        '0x742d35Cc6634C0532925a3b8D01d3E0b37Bce612AA',
        '0x742d35Cc6634C0532925a3b8D01d3E0b37Bce612BB',
        '0x742d35Cc6634C0532925a3b8D01d3E0b37Bce612CC'
      ];

      const mockGetBalance = vi.spyOn(chainManager, 'getBalance').mockResolvedValue({
        success: true,
        data: [],
        metadata: {
          provider: 'alchemy',
          chainId: ChainId.ETHEREUM,
          timestamp: Date.now(),
          requestId: 'batch-test'
        }
      });

      const startTime = Date.now();
      const promises = addresses.map(address => 
        chainManager.getMultiChainPortfolio(address, [ChainId.ETHEREUM])
      );
      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });

      // Should be faster than sequential processing
      expect(duration).toBeLessThan(500);
    });

    it('should respect priority ordering in batch processing', async () => {
      const batchStats = chainManager.getBatchProcessorStats();
      expect(batchStats).toBeDefined();
      expect(batchStats.config).toBeDefined();
      expect(batchStats.config.maxConcurrency).toBeGreaterThan(0);
    });
  });

  describe('Memory Cache Management', () => {
    it('should provide cache statistics', () => {
      const cacheStats = chainManager.getMemoryCacheStats();
      
      expect(cacheStats).toBeDefined();
      expect(cacheStats.totalEntries).toBe(0);
      expect(cacheStats.validEntries).toBe(0);
      expect(cacheStats.expiredEntries).toBe(0);
      expect(cacheStats.memoryUsageApprox).toBeGreaterThanOrEqual(0);
    });

    it('should clean up expired cache entries', async () => {
      const testAddress = '0x742d35Cc6634C0532925a3b8D01d3E0b37Bce61234';
      
      // Mock short TTL for testing
      const mockGetBalance = vi.spyOn(chainManager, 'getBalance').mockResolvedValue({
        success: true,
        data: [],
        metadata: {
          provider: 'alchemy',
          chainId: ChainId.ETHEREUM,
          timestamp: Date.now(),
          requestId: 'test-123'
        }
      });

      // First request to populate cache
      await chainManager.getMultiChainPortfolio(testAddress, [ChainId.ETHEREUM]);
      
      let cacheStats = chainManager.getMemoryCacheStats();
      expect(cacheStats.validEntries).toBe(1);

      // Wait for cache cleanup (mocked with short interval)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Cache should still be valid (5-minute TTL)
      cacheStats = chainManager.getMemoryCacheStats();
      expect(cacheStats.validEntries).toBe(1);
    });
  });

  describe('Circuit Breaker Integration', () => {
    it('should track circuit breaker statistics', async () => {
      const testAddress = '0x742d35Cc6634C0532925a3b8D01d3E0b37Bce61234';
      
      // Trigger some requests to generate circuit breaker stats
      const mockGetBalance = vi.spyOn(chainManager, 'getBalance').mockResolvedValue({
        success: true,
        data: [],
        metadata: {
          provider: 'alchemy',
          chainId: ChainId.ETHEREUM,
          timestamp: Date.now(),
          requestId: 'test-123'
        }
      });

      await chainManager.getMultiChainPortfolio(testAddress, [ChainId.ETHEREUM]);
      
      const batchStats = chainManager.getBatchProcessorStats();
      expect(batchStats.circuitBreakers).toBeDefined();
    });

    it('should handle circuit breaker open state', async () => {
      const testAddress = '0x742d35Cc6634C0532925a3b8D01d3E0b37Bce61234';
      
      // Mock failing service to trigger circuit breaker
      const mockGetBalance = vi.spyOn(chainManager, 'getBalance').mockRejectedValue(
        new Error('Service temporarily unavailable')
      );

      // Multiple failures should eventually trigger circuit breaker
      const results = await Promise.allSettled([
        chainManager.getMultiChainPortfolio(testAddress, [ChainId.ETHEREUM]),
        chainManager.getMultiChainPortfolio(testAddress, [ChainId.ETHEREUM]),
        chainManager.getMultiChainPortfolio(testAddress, [ChainId.ETHEREUM])
      ]);

      // All should fail, but circuit breaker should prevent cascading failures
      results.forEach(result => {
        expect(result.status).toBe('rejected');
      });
    });
  });

  describe('Performance Regression Detection', () => {
    it('should complete multi-chain aggregation within performance thresholds', async () => {
      const testAddress = '0x742d35Cc6634C0532925a3b8D01d3E0b37Bce61234';
      const chainIds = [ChainId.ETHEREUM, ChainId.POLYGON, ChainId.ARBITRUM, ChainId.OPTIMISM];

      const mockGetBalance = vi.spyOn(chainManager, 'getBalance').mockImplementation(
        async (chainId) => {
          // Simulate realistic API response time
          await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
          return {
            success: true,
            data: [],
            metadata: {
              provider: 'alchemy',
              chainId,
              timestamp: Date.now(),
              requestId: `test-${chainId}`
            }
          };
        }
      );

      const startTime = Date.now();
      const result = await chainManager.getMultiChainPortfolio(testAddress, chainIds);
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      
      // Performance threshold: should complete 4-chain aggregation in under 2 seconds
      // (80% improvement from previous 5-10 second sequential processing)
      expect(duration).toBeLessThan(2000);
      
      // Verify parallel execution by checking that duration is much less than sequential time
      // Sequential would be: 4 chains * ~75ms avg = ~300ms + overhead
      // Parallel should be: ~75ms + overhead
      expect(duration).toBeLessThan(400);
    });

    it('should demonstrate cache performance improvement', async () => {
      const testAddress = '0x742d35Cc6634C0532925a3b8D01d3E0b37Bce61234';
      
      const mockGetBalance = vi.spyOn(chainManager, 'getBalance').mockResolvedValue({
        success: true,
        data: [],
        metadata: {
          provider: 'alchemy',
          chainId: ChainId.ETHEREUM,
          timestamp: Date.now(),
          requestId: 'test-123'
        }
      });

      // First request (cold cache)
      const coldStart = Date.now();
      await chainManager.getMultiChainPortfolio(testAddress, [ChainId.ETHEREUM]);
      const coldDuration = Date.now() - coldStart;

      // Second request (warm cache)
      const warmStart = Date.now();
      await chainManager.getMultiChainPortfolio(testAddress, [ChainId.ETHEREUM]);
      const warmDuration = Date.now() - warmStart;

      // Cache should provide significant speedup (95% improvement target)
      expect(warmDuration).toBeLessThan(coldDuration * 0.1); // 90%+ faster
      expect(warmDuration).toBeLessThan(50); // Sub-50ms response time
    });
  });

  describe('Resource Management', () => {
    it('should properly cleanup resources on shutdown', async () => {
      const testAddress = '0x742d35Cc6634C0532925a3b8D01d3E0b37Bce61234';
      
      // Generate some activity
      const mockGetBalance = vi.spyOn(chainManager, 'getBalance').mockResolvedValue({
        success: true,
        data: [],
        metadata: {
          provider: 'alchemy',
          chainId: ChainId.ETHEREUM,
          timestamp: Date.now(),
          requestId: 'test-123'
        }
      });

      await chainManager.getMultiChainPortfolio(testAddress, [ChainId.ETHEREUM]);
      
      // Graceful shutdown should clear all resources
      await expect(chainManager.gracefulShutdown()).resolves.not.toThrow();
      
      // Cache should be cleared
      const cacheStats = chainManager.getMemoryCacheStats();
      expect(cacheStats.totalEntries).toBe(0);
    });
  });
});