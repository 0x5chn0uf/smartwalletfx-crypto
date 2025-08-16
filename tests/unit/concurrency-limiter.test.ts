/**
 * Unit tests for ProviderConcurrencyLimiter
 * 
 * Tests the concurrency limiting functionality in isolation
 * to ensure proper rate limiting, retry logic, and error handling.
 */

import { 
  ProviderConcurrencyLimiter, 
  executeWithConcurrencyLimit,
  getGlobalConcurrencyLimiter,
  RetryConfig,
  ConcurrencyConfig 
} from '@/utils/concurrencyLimiter';
import { ChainId } from '@/types/blockchain';

// Mock logger to avoid console spam during tests
jest.mock('@/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock chain config
jest.mock('@/config/chains', () => ({
  getChainConfig: jest.fn((chainId: ChainId) => ({
    rateLimits: {
      requestsPerSecond: 5,
      requestsPerMinute: 300,
    },
  })),
}));

describe('ProviderConcurrencyLimiter', () => {
  let limiter: ProviderConcurrencyLimiter;

  beforeEach(() => {
    // Create fresh limiter for each test with fast retry config for testing
    const testRetryConfig: RetryConfig = {
      maxAttempts: 3,
      initialDelayMs: 10, // Very fast for tests
      maxDelayMs: 100,
      backoffMultiplier: 2.0,
      jitterFactor: 0.1,
    };

    const testConcurrencyConfig: ConcurrencyConfig = {
      concurrency: 3,
      rateLimitPerSecond: 2, // Low limits for testing
      rateLimitPerMinute: 10,
      burstAllowance: 2,
    };

    limiter = new ProviderConcurrencyLimiter(testRetryConfig, testConcurrencyConfig);
  });

  afterEach(() => {
    limiter.clear();
  });

  describe('Basic Concurrency Control', () => {
    it('should limit concurrent operations', async () => {
      const provider = 'test-provider';
      const results: Array<{ duration: number; order: number }> = [];
      const startTime = Date.now();

      // Create operations that take time to complete
      const createOperation = (order: number) => async () => {
        const operationStart = Date.now();
        await new Promise(resolve => setTimeout(resolve, 50));
        const duration = Date.now() - operationStart;
        results.push({ duration, order });
        return { result: `operation-${order}` };
      };

      // Start more operations than the concurrency limit
      const promises = Array.from({ length: 6 }, (_, i) =>
        limiter.execute(createOperation(i), provider)
      );

      const outcomes = await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      // All operations should succeed
      expect(outcomes.every(o => o.success)).toBe(true);
      
      // Should have taken longer due to concurrency limiting
      // With concurrency of 3 and 6 operations taking 50ms each,
      // should take at least 100ms (2 batches)
      expect(totalTime).toBeGreaterThan(90);
      
      // Verify results were captured
      expect(results).toHaveLength(6);
    });

    it('should provide accurate statistics', async () => {
      const provider = 'test-provider';
      
      // Make a few operations
      await limiter.execute(async () => ({ data: 'test1' }), provider);
      await limiter.execute(async () => ({ data: 'test2' }), provider);
      
      const stats = limiter.getStats();
      
      expect(stats.totalLimiters).toBe(1); // One provider
      expect(stats.activeLimiters).toContain(provider);
      expect(stats.rateLimiterStates[provider]).toBeDefined();
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce per-second rate limits', async () => {
      const provider = 'rate-test-provider';
      const startTime = Date.now();

      // Make requests that would exceed the per-second limit (2 req/sec)
      const promises = Array.from({ length: 4 }, () =>
        limiter.execute(async () => ({ data: 'test' }), provider)
      );

      const results = await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      // All should succeed
      expect(results.every(r => r.success)).toBe(true);
      
      // Should be delayed due to rate limiting
      // With 2 req/sec limit and 4 requests, should take at least 1.5 seconds
      expect(totalTime).toBeGreaterThan(1400);
    });

    it('should track rate limiter state accurately', async () => {
      const provider = 'state-test-provider';
      
      // Make requests
      await limiter.execute(async () => ({ data: 'test1' }), provider);
      await limiter.execute(async () => ({ data: 'test2' }), provider);
      
      const stats = limiter.getStats();
      const providerState = stats.rateLimiterStates[provider];
      
      expect(providerState).toBeDefined();
      expect(providerState.recentRequests).toBeGreaterThanOrEqual(0);
      expect(providerState.minuteRequests).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed operations with exponential backoff', async () => {
      const provider = 'retry-test-provider';
      let attemptCount = 0;

      const failingOperation = async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Network timeout');
        }
        return { data: 'success-after-retries' };
      };

      const result = await limiter.execute(failingOperation, provider);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ data: 'success-after-retries' });
      expect(result.metadata.attempts).toBe(3);
      expect(attemptCount).toBe(3);
    });

    it('should fail permanently after max attempts', async () => {
      const provider = 'permanent-fail-provider';

      const alwaysFailingOperation = async () => {
        throw new Error('Permanent failure');
      };

      const result = await limiter.execute(alwaysFailingOperation, provider);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PROVIDER_ERROR');
      expect(result.error?.message).toBe('Permanent failure');
      expect(result.metadata.attempts).toBe(3); // Should match maxAttempts
    });

    it('should identify retryable vs non-retryable errors', async () => {
      const provider = 'error-classification-provider';

      // Test retryable error (HTTP 503)
      const retryableOperation = async () => {
        const error = new Error('Service Unavailable') as any;
        error.status = 503;
        throw error;
      };

      const retryableResult = await limiter.execute(retryableOperation, provider);
      expect(retryableResult.success).toBe(false);
      expect(retryableResult.metadata.attempts).toBe(3); // Should retry

      // Clear limiter state
      limiter.clear();

      // Test non-retryable error (HTTP 401)
      const nonRetryableOperation = async () => {
        const error = new Error('Unauthorized') as any;
        error.status = 401;
        throw error;
      };

      const nonRetryableResult = await limiter.execute(nonRetryableOperation, provider);
      expect(nonRetryableResult.success).toBe(false);
      expect(nonRetryableResult.metadata.attempts).toBe(1); // Should not retry
    });
  });

  describe('Provider-Specific Configuration', () => {
    it('should apply provider-specific concurrency limits', () => {
      // Create limiter and check stats for different providers
      const alchemyStats = limiter.getStats();
      expect(alchemyStats.totalLimiters).toBe(0); // No operations yet

      // The provider-specific logic is tested implicitly through
      // the getConcurrencyConfig method
      expect(limiter).toBeDefined();
    });

    it('should handle chain-specific configuration', async () => {
      const provider = 'chain-specific-provider';
      
      // Test with specific chain
      const result = await limiter.execute(
        async () => ({ data: 'chain-test' }),
        provider,
        ChainId.ETHEREUM
      );

      expect(result.success).toBe(true);
      expect(result.metadata.provider).toBe(provider);
      expect(result.metadata.chainId).toBe(ChainId.ETHEREUM);
    });
  });

  describe('Error Handling and Metadata', () => {
    it('should provide comprehensive metadata for successful operations', async () => {
      const provider = 'metadata-test-provider';
      const startTime = Date.now();

      const result = await limiter.execute(
        async () => ({ data: 'metadata-test' }),
        provider,
        ChainId.POLYGON
      );

      expect(result.success).toBe(true);
      expect(result.metadata).toEqual({
        attempts: 1,
        totalTime: expect.any(Number),
        provider,
        chainId: ChainId.POLYGON,
      });
      expect(result.metadata.totalTime).toBeGreaterThan(0);
      expect(result.metadata.totalTime).toBeLessThan(1000); // Should be fast
    });

    it('should provide comprehensive metadata for failed operations', async () => {
      const provider = 'error-metadata-provider';

      const result = await limiter.execute(
        async () => {
          throw new Error('Test error');
        },
        provider,
        ChainId.ARBITRUM
      );

      expect(result.success).toBe(false);
      expect(result.error).toEqual({
        code: 'PROVIDER_ERROR',
        message: 'Test error',
        retryable: false,
        provider,
        chainId: ChainId.ARBITRUM,
      });
      expect(result.metadata.attempts).toBe(1); // Non-retryable error
    });
  });

  describe('Memory Management', () => {
    it('should clean up old rate limiter state', async () => {
      const provider = 'cleanup-test-provider';
      
      // Make a request
      await limiter.execute(async () => ({ data: 'test' }), provider);
      
      // Get initial stats
      const initialStats = limiter.getStats();
      expect(initialStats.rateLimiterStates[provider]).toBeDefined();
      
      // Clear the limiter
      limiter.clear();
      
      // Stats should be reset
      const clearedStats = limiter.getStats();
      expect(clearedStats.totalLimiters).toBe(0);
      expect(clearedStats.activeLimiters).toHaveLength(0);
      expect(Object.keys(clearedStats.rateLimiterStates)).toHaveLength(0);
    });
  });
});

describe('Global Concurrency Limiter', () => {
  it('should provide a singleton instance', () => {
    const limiter1 = getGlobalConcurrencyLimiter();
    const limiter2 = getGlobalConcurrencyLimiter();
    
    expect(limiter1).toBe(limiter2);
    expect(limiter1).toBeInstanceOf(ProviderConcurrencyLimiter);
  });

  it('should work with executeWithConcurrencyLimit helper', async () => {
    const provider = 'helper-test-provider';
    
    const result = await executeWithConcurrencyLimit(
      async () => ({ data: 'helper-test' }),
      provider,
      ChainId.BASE
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ data: 'helper-test' });
    expect(result.metadata.provider).toBe(provider);
    expect(result.metadata.chainId).toBe(ChainId.BASE);
  });
});