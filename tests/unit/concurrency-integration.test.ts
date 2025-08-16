/**
 * Simple integration test for concurrency control functionality
 * 
 * Validates that the concurrency limiter integrates properly with the architecture
 * without extensive timing-based tests.
 */

import { 
  ProviderConcurrencyLimiter, 
  executeWithConcurrencyLimit,
  getGlobalConcurrencyLimiter 
} from '@/utils/concurrencyLimiter';
import { ChainId } from '@/types/blockchain';

// Mock logger
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
  getChainConfig: jest.fn(() => ({
    rateLimits: {
      requestsPerSecond: 10,
      requestsPerMinute: 600,
    },
  })),
}));

describe('Concurrency Control Integration', () => {
  let limiter: ProviderConcurrencyLimiter;

  beforeEach(() => {
    limiter = new ProviderConcurrencyLimiter({
      maxAttempts: 2,
      initialDelayMs: 1, // Very fast for tests
      maxDelayMs: 10,
      backoffMultiplier: 2.0,
      jitterFactor: 0.1,
    }, {
      concurrency: 5,
      rateLimitPerSecond: 100, // High limits to avoid delays
      rateLimitPerMinute: 6000,
      burstAllowance: 10,
    });
  });

  afterEach(() => {
    limiter.clear();
  });

  describe('Basic Functionality', () => {
    it('should execute successful operations', async () => {
      const provider = 'test-provider';
      const operation = jest.fn().mockResolvedValue({ data: 'success' });

      const result = await limiter.execute(operation, provider, ChainId.ETHEREUM);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ data: 'success' });
      expect(result.metadata.provider).toBe(provider);
      expect(result.metadata.chainId).toBe(ChainId.ETHEREUM);
      expect(result.metadata.attempts).toBe(1);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should handle failed operations', async () => {
      const provider = 'test-provider';
      const operation = jest.fn().mockRejectedValue(new Error('Test error'));

      const result = await limiter.execute(operation, provider, ChainId.POLYGON);

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Test error');
      expect(result.metadata.provider).toBe(provider);
      expect(result.metadata.chainId).toBe(ChainId.POLYGON);
      expect(operation).toHaveBeenCalledTimes(1); // Non-retryable error
    });

    it('should retry retryable operations', async () => {
      const provider = 'test-provider';
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce({ data: 'success-after-retry' });

      const result = await limiter.execute(operation, provider, ChainId.ARBITRUM);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ data: 'success-after-retry' });
      expect(result.metadata.attempts).toBe(2);
      expect(operation).toHaveBeenCalledTimes(2);
    });
  });

  describe('Provider Configuration', () => {
    it('should handle different provider configurations', async () => {
      const alchemyResult = await limiter.execute(
        async () => ({ data: 'alchemy' }),
        'alchemy',
        ChainId.ETHEREUM
      );

      const infuraResult = await limiter.execute(
        async () => ({ data: 'infura' }),
        'infura',
        ChainId.POLYGON
      );

      expect(alchemyResult.success).toBe(true);
      expect(infuraResult.success).toBe(true);
      
      const stats = limiter.getStats();
      expect(stats.totalLimiters).toBe(2); // Two provider/chain combinations
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should provide accurate statistics', async () => {
      const provider = 'stats-provider';
      
      await limiter.execute(async () => ({ data: 'test1' }), provider);
      await limiter.execute(async () => ({ data: 'test2' }), provider);
      
      const stats = limiter.getStats();
      
      expect(stats.totalLimiters).toBe(1);
      expect(stats.activeLimiters).toContain(provider);
      expect(stats.rateLimiterStates[provider]).toBeDefined();
      expect(stats.rateLimiterStates[provider].minuteRequests).toBe(2);
    });

    it('should clear state properly', () => {
      const initialStats = limiter.getStats();
      expect(initialStats.totalLimiters).toBe(0);
      
      limiter.clear();
      
      const clearedStats = limiter.getStats();
      expect(clearedStats.totalLimiters).toBe(0);
      expect(clearedStats.activeLimiters).toHaveLength(0);
    });
  });

  describe('Global Instance', () => {
    it('should provide singleton global instance', () => {
      const instance1 = getGlobalConcurrencyLimiter();
      const instance2 = getGlobalConcurrencyLimiter();
      
      expect(instance1).toBe(instance2);
      expect(instance1).toBeInstanceOf(ProviderConcurrencyLimiter);
    });

    it('should work with helper function', async () => {
      const result = await executeWithConcurrencyLimit(
        async () => ({ data: 'helper-test' }),
        'helper-provider',
        ChainId.BASE
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ data: 'helper-test' });
      expect(result.metadata.provider).toBe('helper-provider');
    });
  });

  describe('Error Types', () => {
    it('should classify retryable errors correctly', async () => {
      const retryableErrors = [
        { status: 429 }, // Too Many Requests
        { status: 503 }, // Service Unavailable
        { code: 'ECONNRESET' },
        { code: 'ETIMEDOUT' },
        { message: 'timeout occurred' },
        { message: 'rate limit exceeded' },
      ];

      for (const errorProps of retryableErrors) {
        const operation = jest.fn().mockRejectedValue(Object.assign(new Error('Test'), errorProps));
        
        const result = await limiter.execute(operation, 'test-provider');
        
        // Should attempt retries for retryable errors
        expect(result.metadata.attempts).toBeGreaterThan(1);
        expect(operation).toHaveBeenCalledTimes(2); // Initial + 1 retry (maxAttempts: 2)
        
        // Clear for next iteration
        limiter.clear();
        jest.clearAllMocks();
      }
    });

    it('should not retry non-retryable errors', async () => {
      const nonRetryableErrors = [
        { status: 401 }, // Unauthorized
        { status: 403 }, // Forbidden
        { status: 404 }, // Not Found
        { message: 'Invalid API key' },
      ];

      for (const errorProps of nonRetryableErrors) {
        const operation = jest.fn().mockRejectedValue(Object.assign(new Error('Test'), errorProps));
        
        const result = await limiter.execute(operation, 'test-provider');
        
        // Should not retry non-retryable errors
        expect(result.metadata.attempts).toBe(1);
        expect(operation).toHaveBeenCalledTimes(1);
        
        // Clear for next iteration
        limiter.clear();
        jest.clearAllMocks();
      }
    });
  });

  describe('Metadata Preservation', () => {
    it('should preserve all required metadata fields', async () => {
      const provider = 'metadata-provider';
      const chainId = ChainId.OPTIMISM;
      const startTime = Date.now();

      const result = await limiter.execute(
        async () => ({ data: 'metadata-test' }),
        provider,
        chainId
      );

      expect(result.metadata).toMatchObject({
        attempts: expect.any(Number),
        totalTime: expect.any(Number),
        provider,
        chainId,
      });

      expect(result.metadata.attempts).toBeGreaterThan(0);
      expect(result.metadata.totalTime).toBeGreaterThan(0);
      expect(result.metadata.totalTime).toBeLessThan(Date.now() - startTime + 100); // Reasonable upper bound
    });
  });
});