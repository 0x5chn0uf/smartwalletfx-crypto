/**
 * Concurrency Limiter - DEPRECATED
 * 
 * This file is deprecated and replaced by the modular concurrency utilities.
 * Use the new structure in ./concurrency/ directory instead.
 * 
 * MIGRATION GUIDE:
 * - Replace ProviderConcurrencyLimiter with ProviderExecutor
 * - Use executeWithProvider() for simple operations
 * - Import from './concurrency' instead of './concurrencyLimiter'
 */

import { 
  ProviderExecutor, 
  executeWithProvider, 
  getGlobalProviderExecutor,
  type ProviderResult 
} from './concurrency';
import { ChainId } from '@/types/blockchain';

// Backward compatibility exports
export { executeWithProvider as executeWithConcurrencyLimit };
export { getGlobalProviderExecutor as getGlobalConcurrencyLimiter };
export type { ProviderResult };

/**
 * @deprecated Use ProviderExecutor from './concurrency' instead
 */
export class ProviderConcurrencyLimiter {
  private executor: ProviderExecutor;

  constructor(
    retryConfig?: any,
    concurrencyConfig?: any
  ) {
    // Map old config format to new format
    this.executor = getGlobalProviderExecutor();
    console.warn('ProviderConcurrencyLimiter is deprecated. Use ProviderExecutor from ./concurrency instead.');
  }

  async execute<T>(
    operation: () => Promise<T>,
    provider: string,
    chainId?: ChainId,
    retryConfig?: any
  ): Promise<ProviderResult<T>> {
    return this.executor.execute(operation, provider, chainId, { retry: retryConfig });
  }

  getStats() {
    return this.executor.getStats();
  }

  clear() {
    this.executor.clear();
  }
}

// Legacy exports for backward compatibility
export { ChainId } from '@/types/blockchain';
export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterFactor: number;
}

export interface ConcurrencyConfig {
  concurrency: number;
  rateLimitPerSecond: number;
  rateLimitPerMinute: number;
  burstAllowance: number;
}