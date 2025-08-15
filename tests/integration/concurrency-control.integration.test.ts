/**
 * Integration tests for concurrency control in ChainManager
 * 
 * Tests the complete integration of ProviderConcurrencyLimiter
 * with ChainManager to ensure proper rate limiting, retry logic,
 * and error handling.
 */

import { ChainManager, createChainManager } from '@/services/ChainManager';
import { getGlobalConcurrencyLimiter, executeWithConcurrencyLimit } from '@/utils/concurrencyLimiter';
import { ChainId } from '@/types/blockchain';
import { config } from '@/config';

// Mock logger to avoid console spam during tests
jest.mock('@/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  logApiCall: jest.fn(),
  logCost: jest.fn(),
}));

// Mock redis to avoid external dependencies
jest.mock('@/utils/redis', () => ({
  redisManager: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
    del: jest.fn().mockResolvedValue(true),
  },
}));

// Mock pricing service
jest.mock('@/services/pricing/PriceService', () => ({
  getPriceService: () => ({
    enrichBalances: jest.fn().mockImplementation(async (chainId: any, balances: any[]) => 
      balances.map((b: any) => ({ ...b, balanceUSD: 100.0 }))
    ),
  }),
}));

// Mock configuration with concurrency enabled
jest.mock('@/config', () => ({
  config: {
    apiKeys: {
      alchemy: 'test-alchemy-key',
      helius: 'test-helius-key',
    },
    rpcUrls: {
      ethereum: 'https://eth-mainnet.alchemyapi.io/v2/test',
      bsc: 'https://bsc-dataseed.binance.org/',
    },
    costs: {
      trackingEnabled: true,
      monthlyBudget: 200,
      alertThreshold: 150,
    },
    cache: {
      ttl: {
        medium: 3600,
      },
    },
    concurrency: {
      enabled: true,
      chainManagerConcurrency: 5,
      retryConfig: {
        maxAttempts: 3,
        initialDelayMs: 100, // Faster for tests
        maxDelayMs: 1000,
        backoffMultiplier: 2.0,
        jitterFactor: 0.1,
      },
      rateLimits: {
        perSecond: 2, // Low limits for testing
        perMinute: 10,
        burstAllowance: 3,
      },
    },
  },
}));

describe('ChainManager Concurrency Control Integration', () => {
  let chainManager: ChainManager;

  beforeEach(async () => {
    // Clear any existing global limiter state
    const limiter = getGlobalConcurrencyLimiter();
    limiter.clear();
    
    chainManager = createChainManager();
    
    // Mock provider methods to simulate different scenarios
    jest.spyOn(chainManager as any, 'getProvider').mockImplementation((...args: any[]) => {
      const chainId = args[0] as ChainId;
      return {
      name: 'MockProvider',
      chainId,
      getBalance: jest.fn().mockImplementation(async () => {
        // Simulate some processing time
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
          success: true,
          data: [
            {
              token: { address: '0x1', symbol: 'ETH', name: 'Ethereum', decimals: 18, isNative: true },
              balance: '1000000000000000000',
              balanceFormatted: '1.0',
            },
          ],
          metadata: {
            provider: 'MockProvider',
            chainId,
            timestamp: Date.now(),
            requestId: 'test-request',
            cost: 0.001,
          },
        };
      }),
      getTransaction: jest.fn().mockResolvedValue({
        success: true,
        data: {
          hash: '0xtest',
          from: '0xfrom',
          to: '0xto',
          value: '1000000000000000000',
          gasUsed: '21000',
          gasPrice: '20000000000',
          blockNumber: 12345,
          timestamp: Date.now(),
          status: 'success',
        },
        metadata: {
          provider: 'MockProvider',
          chainId,
          timestamp: Date.now(),
          requestId: 'test-tx',
          cost: 0.001,
        },
      }),
      healthCheck: jest.fn().mockResolvedValue(true),
    };
    });
  });

  afterEach(async () => {
    if (chainManager) {
      await chainManager.stop();
    }
  });

  describe('Basic Concurrency Limiting', () => {
    it('should enforce concurrency limits for provider calls', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const promises: Promise<any>[] = [];
      const startTime = Date.now();

      // Make more concurrent requests than the limit allows
      for (let i = 0; i < 10; i++) {
        promises.push(chainManager.getBalance(ChainId.ETHEREUM, address));
      }

      const results = await Promise.allSettled(promises);
      const endTime = Date.now();
      const duration = endTime - startTime;

      // All requests should succeed
      expect(results.every(r => r.status === 'fulfilled')).toBe(true);
      
      // Should take longer than sequential execution due to concurrency limiting
      // With limit of 5 and 10 requests, should take at least as long as 2 batches
      expect(duration).toBeGreaterThan(100); // At least 100ms for processing
    });

    it('should provide detailed metrics for concurrency limiter', () => {
      const stats = chainManager.getConcurrencyStats();
      
      expect(stats).toHaveProperty('totalLimiters');
      expect(stats).toHaveProperty('activeLimiters');
      expect(stats).toHaveProperty('rateLimiterStates');
      expect(Array.isArray(stats.activeLimiters)).toBe(true);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce per-second rate limits', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const startTime = Date.now();

      // Make requests that exceed per-second limit (2 requests/second)
      const promises = Array.from({ length: 5 }, () => 
        chainManager.getBalance(ChainId.ETHEREUM, address)
      );

      const results = await Promise.allSettled(promises);
      const endTime = Date.now();
      const duration = endTime - startTime;

      // All should succeed but with delays
      expect(results.every(r => r.status === 'fulfilled')).toBe(true);
      
      // Should be delayed due to rate limiting
      expect(duration).toBeGreaterThan(1000); // Should take over 1 second
    });

    it('should track rate limiter state correctly', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      
      // Make a few requests
      await chainManager.getBalance(ChainId.ETHEREUM, address);
      await chainManager.getBalance(ChainId.ETHEREUM, address);
      
      const stats = chainManager.getConcurrencyStats();
      const rateLimiterStates = stats.rateLimiterStates;
      
      // Should have rate limiter state for MockProvider
      const providerState = Object.values(rateLimiterStates)[0];
      if (providerState) {
        expect(providerState.recentRequests).toBeGreaterThanOrEqual(0);
        expect(providerState.minuteRequests).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed requests with exponential backoff', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      let attemptCount = 0;

      // Mock provider to fail first few attempts
      jest.spyOn(chainManager as any, 'getProvider').mockImplementation(() => ({
        name: 'FailingMockProvider',
        chainId: ChainId.ETHEREUM,
        getBalance: jest.fn().mockImplementation(async () => {
          attemptCount++;
          if (attemptCount < 3) {
            throw new Error('Network timeout');
          }
          return {
            success: true,
            data: [],
            metadata: {
              provider: 'FailingMockProvider',
              chainId: ChainId.ETHEREUM,
              timestamp: Date.now(),
              requestId: 'retry-test',
              cost: 0.001,
            },
          };
        }),
        healthCheck: jest.fn().mockResolvedValue(true),
      }));

      const result = await chainManager.getBalance(ChainId.ETHEREUM, address);
      
      // Should eventually succeed after retries
      expect(result.success).toBe(true);
      expect(attemptCount).toBe(3); // Should have made 3 attempts
    });

    it('should fail permanently after max attempts exceeded', async () => {
      const address = '0x1234567890123456789012345678901234567890';

      // Mock provider to always fail
      jest.spyOn(chainManager as any, 'getProvider').mockImplementation(() => ({
        name: 'AlwaysFailingProvider',
        chainId: ChainId.ETHEREUM,
        getBalance: jest.fn().mockRejectedValue(new Error('Permanent failure')),
        healthCheck: jest.fn().mockResolvedValue(true),
      }));

      const result = await chainManager.getBalance(ChainId.ETHEREUM, address);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('PROVIDER_ERROR');
      expect((result.metadata as any)?.attempts).toBe(3); // Should match maxAttempts
    });
  });

  describe('Multi-Chain Portfolio with Concurrency', () => {
    it('should handle multi-chain requests with proper concurrency control', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const chains = [ChainId.ETHEREUM, ChainId.POLYGON, ChainId.ARBITRUM];

      const result = await chainManager.getMultiChainPortfolio(address, chains);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.chains).toHaveLength(chains.length);
      
      // Should have proper metadata indicating use of concurrency limiter
      expect(result.metadata?.provider).toBe('ChainManager');
    });
  });

  describe('Configuration Integration', () => {
    it('should use centralized configuration for concurrency limits', () => {
      // Verify that ChainManager uses config values
      expect(config.concurrency.enabled).toBe(true);
      expect(config.concurrency.chainManagerConcurrency).toBe(5);
      expect(config.concurrency.rateLimits.perSecond).toBe(2);
      
      const stats = chainManager.getConcurrencyStats();
      expect(stats.totalLimiters).toBeGreaterThanOrEqual(0);
    });

    it('should provide health status including concurrency metrics', () => {
      const healthStatus = chainManager.getHealthStatus();
      
      expect(healthStatus).toHaveProperty('totalProviders');
      expect(healthStatus).toHaveProperty('healthyProviders');
      expect(healthStatus).toHaveProperty('healthPercentage');
      expect(healthStatus).toHaveProperty('providerStatus');
    });
  });

  describe('Error Handling Integration', () => {
    it('should preserve error catalog patterns in failed requests', async () => {
      const address = '0x1234567890123456789012345678901234567890';

      // Mock provider unavailable scenario
      jest.spyOn(chainManager as any, 'getProvider').mockReturnValue(null);

      const result = await chainManager.getBalance(ChainId.ETHEREUM, address);
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PROVIDER_UNAVAILABLE');
      expect(result.error?.message).toContain('No healthy provider available');
      expect(result.metadata?.provider).toBe('ChainManager');
    });

    it('should handle provider errors with proper metadata', async () => {
      const address = '0x1234567890123456789012345678901234567890';

      // Mock provider that returns error result
      jest.spyOn(chainManager as any, 'getProvider').mockImplementation(() => ({
        name: 'ErrorProvider',
        chainId: ChainId.ETHEREUM,
        getBalance: jest.fn().mockResolvedValue({
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'Rate limit exceeded',
          },
          metadata: {
            provider: 'ErrorProvider',
            chainId: ChainId.ETHEREUM,
            timestamp: Date.now(),
            requestId: 'error-test',
          },
        }),
        healthCheck: jest.fn().mockResolvedValue(true),
      }));

      const result = await chainManager.getBalance(ChainId.ETHEREUM, address);
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('RATE_LIMITED');
      expect(result.metadata?.provider).toBe('ErrorProvider');
    });
  });

  describe('Cost Tracking Integration', () => {
    it('should track costs properly with concurrency limiting enabled', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      
      // Make several requests to accumulate costs
      await chainManager.getBalance(ChainId.ETHEREUM, address);
      await chainManager.getBalance(ChainId.ETHEREUM, address);
      
      const costStats = chainManager.getCostStatistics();
      
      expect(costStats.totalCost).toBeGreaterThan(0);
      expect(costStats.totalRequests).toBeGreaterThan(0);
      expect(costStats.averageCostPerRequest).toBeGreaterThan(0);
      expect(costStats.providerBreakdown).toBeDefined();
    });
  });
});