/**
 * Concurrency Manager
 * 
 * Manages per-provider concurrency limits using p-limit.
 * Handles the creation and management of concurrent execution limiters.
 */

import pLimit from 'p-limit';
import { logger } from '../logger';
import { getChainConfig } from '@/config/chains';
import { ChainId } from '@/types/blockchain';

export interface ConcurrencyConfig {
  concurrency: number;
}

export class ConcurrencyManager {
  private limiters = new Map<string, any>(); // pLimit instances

  constructor(private defaultConfig: ConcurrencyConfig) {}

  /**
   * Get or create limiter for provider/chain combination
   */
  getLimiter(provider: string, chainId?: ChainId): any {
    const key = chainId ? `${provider}:${chainId}` : provider;

    if (!this.limiters.has(key)) {
      const config = this.getConcurrencyConfig(provider, chainId);
      const limiter = pLimit(config.concurrency);
      this.limiters.set(key, limiter);

      logger.debug('Created concurrency limiter', {
        provider,
        chainId,
        concurrency: config.concurrency,
      });
    }

    return this.limiters.get(key);
  }

  /**
   * Execute operation with concurrency limiting
   */
  async execute<T>(
    operation: () => Promise<T>,
    provider: string,
    chainId?: ChainId
  ): Promise<T> {
    const limiter = this.getLimiter(provider, chainId);
    return limiter(operation);
  }

  /**
   * Get concurrency configuration for provider/chain
   */
  private getConcurrencyConfig(provider: string, chainId?: ChainId): ConcurrencyConfig {
    let config = { ...this.defaultConfig };

    // Override with chain-specific configuration if available
    if (chainId) {
      const chainConfig = getChainConfig(chainId);
      if (chainConfig) {
        config.concurrency = Math.min(config.concurrency, chainConfig.rateLimits.requestsPerSecond);
      }
    }

    // Provider-specific overrides
    switch (provider.toLowerCase()) {
      case 'alchemy':
        config.concurrency = Math.min(config.concurrency, 20);
        break;
      case 'infura':
        config.concurrency = Math.min(config.concurrency, 15);
        break;
      case 'quicknode':
        config.concurrency = Math.min(config.concurrency, 25);
        break;
      case 'ankr':
        config.concurrency = Math.min(config.concurrency, 10);
        break;
      case 'helius':
        config.concurrency = Math.min(config.concurrency, 30);
        break;
    }

    return config;
  }

  /**
   * Get limiter statistics
   */
  getStats(): {
    totalLimiters: number;
    activeLimiters: string[];
  } {
    return {
      totalLimiters: this.limiters.size,
      activeLimiters: Array.from(this.limiters.keys()),
    };
  }

  /**
   * Clear all limiters (useful for testing)
   */
  clear(): void {
    this.limiters.clear();
  }
}