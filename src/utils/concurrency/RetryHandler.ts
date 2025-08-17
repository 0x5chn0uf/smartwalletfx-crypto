/**
 * Retry Handler
 * 
 * Handles retry logic with exponential backoff and error classification.
 * Determines which errors are retryable and manages retry delays.
 */

import { logger } from '../logger';

export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterFactor: number;
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: any;
  attempts: number;
  totalTime: number;
}

export class RetryHandler {
  constructor(private defaultConfig: RetryConfig) {}

  /**
   * Execute operation with retry logic
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: { provider: string; chainId?: string | number },
    config?: Partial<RetryConfig>
  ): Promise<RetryResult<T>> {
    const effectiveConfig = { ...this.defaultConfig, ...config };
    const startTime = Date.now();
    let lastError: any;

    for (let attempt = 1; attempt <= effectiveConfig.maxAttempts; attempt++) {
      try {
        const result = await operation();

        const totalTime = Date.now() - startTime;

        if (attempt > 1) {
          logger.info('Operation succeeded after retries', {
            provider: context.provider,
            chainId: context.chainId,
            attempts: attempt,
            totalTime,
          });
        }

        return {
          success: true,
          data: result,
          attempts: attempt,
          totalTime,
        };
      } catch (error) {
        lastError = error;

        if (!this.isRetryableError(error) || attempt === effectiveConfig.maxAttempts) {
          logger.error('Operation failed permanently', {
            provider: context.provider,
            chainId: context.chainId,
            attempts: attempt,
            error: error instanceof Error ? error.message : 'Unknown error',
            totalTime: Date.now() - startTime,
          });

          break;
        }

        const delay = this.calculateDelay(attempt, effectiveConfig);

        logger.warn('Operation failed, retrying', {
          provider: context.provider,
          chainId: context.chainId,
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
      error: lastError,
      attempts: effectiveConfig.maxAttempts,
      totalTime: Date.now() - startTime,
    };
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
      const retryableCodes = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'];

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
   * Get error classification for reporting
   */
  getErrorClassification(error: any): {
    code: string;
    retryable: boolean;
    category: 'network' | 'rate_limit' | 'server' | 'client' | 'unknown';
  } {
    if (!error) {
      return { code: 'UNKNOWN_ERROR', retryable: false, category: 'unknown' };
    }

    const message = error.message?.toLowerCase() || '';

    // Network errors
    if (error.code && ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(error.code)) {
      return { code: 'NETWORK_ERROR', retryable: true, category: 'network' };
    }

    // Rate limiting
    if (error.status === 429 || message.includes('rate limit') || message.includes('too many requests')) {
      return { code: 'RATE_LIMIT_ERROR', retryable: true, category: 'rate_limit' };
    }

    // Server errors
    if (error.status && [500, 502, 503, 504].includes(error.status)) {
      return { code: 'SERVER_ERROR', retryable: true, category: 'server' };
    }

    // Client errors
    if (error.status && [400, 401, 403, 404].includes(error.status)) {
      return { code: 'CLIENT_ERROR', retryable: false, category: 'client' };
    }

    // Timeout
    if (message.includes('timeout')) {
      return { code: 'TIMEOUT_ERROR', retryable: true, category: 'network' };
    }

    return { code: 'UNKNOWN_ERROR', retryable: true, category: 'unknown' };
  }
}