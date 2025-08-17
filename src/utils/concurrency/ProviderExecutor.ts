/**
 * Provider Executor
 * 
 * Orchestrates rate limiting, concurrency control, and retry logic
 * for provider operations. This is the main entry point that combines
 * all the separated concerns.
 */

import { ChainId } from '@/types/blockchain';
import { RateLimiter, RateLimitConfig } from './RateLimiter';
import { ConcurrencyManager, ConcurrencyConfig } from './ConcurrencyManager';
import { RetryHandler, RetryConfig, RetryResult } from './RetryHandler';
import { logger } from '../logger';

export interface ProviderExecutorConfig {
  retry: RetryConfig;
  rateLimit: RateLimitConfig;
  concurrency: ConcurrencyConfig;
}

export interface ProviderResult<T> extends RetryResult<T> {
  provider: string;
  chainId?: ChainId;
  cost?: number;
}

export class ProviderExecutor {
  private rateLimiter: RateLimiter;
  private concurrencyManager: ConcurrencyManager;
  private retryHandler: RetryHandler;

  constructor(private config: ProviderExecutorConfig) {
    this.rateLimiter = new RateLimiter(config.rateLimit);
    this.concurrencyManager = new ConcurrencyManager(config.concurrency);
    this.retryHandler = new RetryHandler(config.retry);

    // Clean up rate limiters periodically
    setInterval(() => this.rateLimiter.cleanup(), 60000); // Every minute
  }

  /**
   * Execute operation with full provider protection
   */
  async execute<T>(
    operation: () => Promise<T>,
    provider: string,
    chainId?: ChainId,
    overrides?: {
      retry?: Partial<RetryConfig>;
      rateLimit?: Partial<RateLimitConfig>;
    }
  ): Promise<ProviderResult<T>> {
    const startTime = Date.now();

    // Create the wrapped operation that includes rate limiting and concurrency control
    const wrappedOperation = async (): Promise<T> => {
      // Check rate limiting before attempting
      if (this.rateLimiter.isRateLimited(provider, chainId, overrides?.rateLimit)) {
        throw new Error(`Rate limited for provider ${provider}`);
      }

      // Record the request
      this.rateLimiter.recordRequest(provider, chainId);

      // Execute with concurrency limiting
      return this.concurrencyManager.execute(operation, provider, chainId);
    };

    // Execute with retry logic
    const result = await this.retryHandler.executeWithRetry(
      wrappedOperation,
      { provider, chainId },
      overrides?.retry
    );

    return {
      ...result,
      provider,
      chainId,
    };
  }

  /**
   * Execute multiple operations in parallel with proper limiting
   */
  async executeAll<T>(
    operations: Array<{
      operation: () => Promise<T>;
      provider: string;
      chainId?: ChainId;
      id: string;
    }>,
    overrides?: {
      retry?: Partial<RetryConfig>;
      rateLimit?: Partial<RateLimitConfig>;
    }
  ): Promise<Array<ProviderResult<T> & { id: string }>> {
    const promises = operations.map(async ({ operation, provider, chainId, id }) => {
      const result = await this.execute(operation, provider, chainId, overrides);
      return { ...result, id };
    });

    return Promise.all(promises);
  }

  /**
   * Get comprehensive statistics
   */
  getStats(): {
    rateLimiter: Record<string, { recentRequests: number; minuteRequests: number }>;
    concurrency: { totalLimiters: number; activeLimiters: string[] };
  } {
    return {
      rateLimiter: this.rateLimiter.getStats(),
      concurrency: this.concurrencyManager.getStats(),
    };
  }

  /**
   * Clear all internal state (useful for testing)
   */
  clear(): void {
    this.rateLimiter.clear();
    this.concurrencyManager.clear();
  }
}

// Default configuration
const DEFAULT_CONFIG: ProviderExecutorConfig = {
  retry: {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2.0,
    jitterFactor: 0.1,
  },
  rateLimit: {
    rateLimitPerSecond: 10,
    rateLimitPerMinute: 600,
    burstAllowance: 5,
  },
  concurrency: {
    concurrency: 10,
  },
};

// Global instance
let globalExecutor: ProviderExecutor | null = null;

/**
 * Get global provider executor instance
 */
export function getGlobalProviderExecutor(): ProviderExecutor {
  if (!globalExecutor) {
    globalExecutor = new ProviderExecutor(DEFAULT_CONFIG);
  }
  return globalExecutor;
}

/**
 * Helper function for simple provider operations
 */
export async function executeWithProvider<T>(
  operation: () => Promise<T>,
  provider: string,
  chainId?: ChainId,
  overrides?: {
    retry?: Partial<RetryConfig>;
    rateLimit?: Partial<RateLimitConfig>;
  }
): Promise<ProviderResult<T>> {
  const executor = getGlobalProviderExecutor();
  return executor.execute(operation, provider, chainId, overrides);
}