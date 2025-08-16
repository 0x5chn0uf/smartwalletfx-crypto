/**
 * Per-Provider Concurrency Limiter with Exponential Backoff
 * 
 * Implements rate limiting and retry logic for external providers
 * as specified in PRD section 6 - Concurrency & Retries.
 */

import pLimit from 'p-limit';
import { logger } from './logger';
import { getChainConfig } from '@/config/chains';
import { ChainId } from '@/types/blockchain';

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterFactor: number;
}

/**
 * Concurrency limiter configuration
 */
export interface ConcurrencyConfig {
  concurrency: number;
  rateLimitPerSecond: number;
  rateLimitPerMinute: number;
  burstAllowance: number;
}

/**
 * Provider operation result
 */
export interface ProviderResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    provider: string;
    chainId?: ChainId;
  };
  metadata: {
    attempts: number;
    totalTime: number;
    provider: string;
    chainId?: ChainId;
  };
}

/**
 * Rate limiter state
 */
interface RateLimiterState {
  requests: number[];
  lastMinuteRequests: number[];
}

/**
 * Provider concurrency limiter with rate limiting and retry logic
 */
export class ProviderConcurrencyLimiter {
  private limiters = new Map<string, any>(); // pLimit instances
  private rateLimiters = new Map<string, RateLimiterState>();
  private readonly defaultRetryConfig: RetryConfig;
  private readonly defaultConcurrencyConfig: ConcurrencyConfig;

  constructor(
    defaultRetryConfig?: Partial<RetryConfig>,
    defaultConcurrencyConfig?: Partial<ConcurrencyConfig>
  ) {
    this.defaultRetryConfig = {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2.0,
      jitterFactor: 0.1,
      ...defaultRetryConfig,
    };

    this.defaultConcurrencyConfig = {
      concurrency: 10,
      rateLimitPerSecond: 10,
      rateLimitPerMinute: 600,
      burstAllowance: 5,
      ...defaultConcurrencyConfig,
    };

    // Clean up rate limiter state periodically
    setInterval(() => this.cleanupRateLimiters(), 60000); // Every minute
  }

  /**
   * Get or create limiter for provider/chain combination
   */
  private getLimiter(provider: string, chainId?: ChainId): any {
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
   * Get or create rate limiter state
   */
  private getRateLimiter(provider: string, chainId?: ChainId): RateLimiterState {
    const key = chainId ? `${provider}:${chainId}` : provider;
    
    if (!this.rateLimiters.has(key)) {
      this.rateLimiters.set(key, {
        requests: [],
        lastMinuteRequests: [],
      });
    }
    
    return this.rateLimiters.get(key)!;
  }

  /**
   * Get concurrency configuration for provider/chain
   */
  private getConcurrencyConfig(provider: string, chainId?: ChainId): ConcurrencyConfig {
    let config = { ...this.defaultConcurrencyConfig };
    
    // Override with chain-specific configuration if available
    if (chainId) {
      const chainConfig = getChainConfig(chainId);
      if (chainConfig) {
        config.rateLimitPerSecond = chainConfig.rateLimits.requestsPerSecond;
        config.rateLimitPerMinute = chainConfig.rateLimits.requestsPerMinute;
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
   * Check if request should be rate limited
   */
  private isRateLimited(provider: string, chainId?: ChainId): boolean {
    const rateLimiter = this.getRateLimiter(provider, chainId);
    const config = this.getConcurrencyConfig(provider, chainId);
    const now = Date.now();
    
    // Clean old requests (older than 1 second)
    rateLimiter.requests = rateLimiter.requests.filter(
      timestamp => now - timestamp < 1000
    );
    
    // Clean old minute requests (older than 1 minute)
    rateLimiter.lastMinuteRequests = rateLimiter.lastMinuteRequests.filter(
      timestamp => now - timestamp < 60000
    );
    
    // Check per-second limit
    if (rateLimiter.requests.length >= config.rateLimitPerSecond) {
      return true;
    }
    
    // Check per-minute limit
    if (rateLimiter.lastMinuteRequests.length >= config.rateLimitPerMinute) {
      return true;
    }
    
    return false;
  }

  /**
   * Record a request
   */
  private recordRequest(provider: string, chainId?: ChainId): void {
    const rateLimiter = this.getRateLimiter(provider, chainId);
    const now = Date.now();
    
    rateLimiter.requests.push(now);
    rateLimiter.lastMinuteRequests.push(now);
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  private calculateDelay(attempt: number, config: RetryConfig): number {
    const baseDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
    const cappedDelay = Math.min(baseDelay, config.maxDelayMs);
    
    // Add jitter to prevent thundering herd
    const jitter = cappedDelay * config.jitterFactor * (Math.random() * 2 - 1);
    const finalDelay = Math.max(0, cappedDelay + jitter);
    
    return Math.round(finalDelay);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Determine if error is retryable
   */
  private isRetryableError(error: any): boolean {
    if (!error) return false;
    
    // HTTP status codes that are retryable
    const retryableStatusCodes = [408, 429, 502, 503, 504];
    
    if (error.status && retryableStatusCodes.includes(error.status)) {
      return true;
    }
    
    if (error.code) {
      // Network errors
      const retryableCodes = [
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ENOTFOUND',
        'EAI_AGAIN',
      ];
      
      return retryableCodes.includes(error.code);
    }
    
    // Message-based detection
    const message = error.message?.toLowerCase() || '';
    const retryableMessages = [
      'timeout',
      'connection reset',
      'rate limit',
      'too many requests',
      'service unavailable',
      'bad gateway',
      'gateway timeout',
    ];
    
    return retryableMessages.some(msg => message.includes(msg));
  }

  /**
   * Execute operation with concurrency limiting and retry logic
   */
  async execute<T>(
    operation: () => Promise<T>,
    provider: string,
    chainId?: ChainId,
    retryConfig?: Partial<RetryConfig>
  ): Promise<ProviderResult<T>> {
    const config = { ...this.defaultRetryConfig, ...retryConfig };
    const limiter = this.getLimiter(provider, chainId);
    const startTime = Date.now();
    
    let lastError: any;
    
    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        // Check rate limiting before attempting
        if (this.isRateLimited(provider, chainId)) {
          const delay = this.calculateDelay(attempt, config);
          
          logger.warn('Rate limited, waiting before retry', {
            provider,
            chainId,
            attempt,
            delay,
          });
          
          await this.sleep(delay);
        }
        
        // Record the request
        this.recordRequest(provider, chainId);
        
        // Execute with concurrency limiting
        const result = await limiter(operation);
        
        const totalTime = Date.now() - startTime;
        
        if (attempt > 1) {
          logger.info('Operation succeeded after retries', {
            provider,
            chainId,
            attempts: attempt,
            totalTime,
          });
        }
        
        return {
          success: true,
          data: result,
          metadata: {
            attempts: attempt,
            totalTime,
            provider,
            chainId,
          },
        };
        
      } catch (error) {
        lastError = error;
        
        if (!this.isRetryableError(error) || attempt === config.maxAttempts) {
          logger.error('Operation failed permanently', {
            provider,
            chainId,
            attempts: attempt,
            error: error instanceof Error ? error.message : 'Unknown error',
            totalTime: Date.now() - startTime,
          });
          
          break;
        }
        
        const delay = this.calculateDelay(attempt, config);
        
        logger.warn('Operation failed, retrying', {
          provider,
          chainId,
          attempt,
          error: error instanceof Error ? error.message : 'Unknown error',
          nextRetryIn: delay,
        });
        
        await this.sleep(delay);
      }
    }
    
    // Return error result
    return {
      success: false,
      error: {
        code: lastError?.code || 'PROVIDER_ERROR',
        message: lastError?.message || 'Provider operation failed',
        retryable: this.isRetryableError(lastError),
        provider,
        chainId,
      },
      metadata: {
        attempts: config.maxAttempts,
        totalTime: Date.now() - startTime,
        provider,
        chainId,
      },
    };
  }

  /**
   * Get limiter statistics
   */
  getStats(): {
    totalLimiters: number;
    activeLimiters: string[];
    rateLimiterStates: Record<string, { recentRequests: number; minuteRequests: number }>;
  } {
    const rateLimiterStates: Record<string, { recentRequests: number; minuteRequests: number }> = {};
    
    for (const [key, state] of this.rateLimiters.entries()) {
      const now = Date.now();
      const recentRequests = state.requests.filter(timestamp => now - timestamp < 1000).length;
      const minuteRequests = state.lastMinuteRequests.filter(timestamp => now - timestamp < 60000).length;
      
      rateLimiterStates[key] = {
        recentRequests,
        minuteRequests,
      };
    }
    
    return {
      totalLimiters: this.limiters.size,
      activeLimiters: Array.from(this.limiters.keys()),
      rateLimiterStates,
    };
  }

  /**
   * Clean up old rate limiter state
   */
  private cleanupRateLimiters(): void {
    const now = Date.now();
    
    for (const [key, state] of this.rateLimiters.entries()) {
      // Remove requests older than 1 minute
      state.requests = state.requests.filter(timestamp => now - timestamp < 60000);
      state.lastMinuteRequests = state.lastMinuteRequests.filter(timestamp => now - timestamp < 60000);
      
      // Remove empty rate limiters
      if (state.requests.length === 0 && state.lastMinuteRequests.length === 0) {
        this.rateLimiters.delete(key);
      }
    }
  }

  /**
   * Clear all limiters (useful for testing)
   */
  clear(): void {
    this.limiters.clear();
    this.rateLimiters.clear();
  }
}

// Global instance
let globalLimiter: ProviderConcurrencyLimiter | null = null;

/**
 * Get global concurrency limiter instance
 */
export function getGlobalConcurrencyLimiter(): ProviderConcurrencyLimiter {
  if (!globalLimiter) {
    globalLimiter = new ProviderConcurrencyLimiter();
  }
  return globalLimiter;
}

/**
 * Helper function for provider operations
 */
export async function executeWithConcurrencyLimit<T>(
  operation: () => Promise<T>,
  provider: string,
  chainId?: ChainId,
  retryConfig?: Partial<RetryConfig>
): Promise<ProviderResult<T>> {
  const limiter = getGlobalConcurrencyLimiter();
  return limiter.execute(operation, provider, chainId, retryConfig);
}