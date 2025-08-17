/**
 * Error Classifier
 * 
 * Handles error classification and determines retry behavior
 * for batch processing operations.
 */

export interface ErrorClassification {
  code: string;
  retryable: boolean;
  category: 'network' | 'rate_limit' | 'server' | 'client' | 'provider' | 'unknown';
}

export class ErrorClassifier {
  /**
   * Classify an error and determine if it's retryable
   */
  static classify(error?: Error | any): ErrorClassification {
    if (!error) {
      return { code: 'UNKNOWN_ERROR', retryable: false, category: 'unknown' };
    }

    const message = error.message?.toLowerCase() || '';

    // Network errors - always retryable
    if (message.includes('timeout')) {
      return { code: 'TIMEOUT_ERROR', retryable: true, category: 'network' };
    }

    if (message.includes('network')) {
      return { code: 'NETWORK_ERROR', retryable: true, category: 'network' };
    }

    // Rate limiting - retryable with backoff
    if (message.includes('rate limit')) {
      return { code: 'RATE_LIMIT_ERROR', retryable: true, category: 'rate_limit' };
    }

    // Circuit breaker - retryable after cooldown
    if (message.includes('circuit breaker')) {
      return { code: 'CIRCUIT_BREAKER_ERROR', retryable: true, category: 'provider' };
    }

    // Server errors - retryable
    if (message.includes('temporary')) {
      return { code: 'TEMPORARY_ERROR', retryable: true, category: 'server' };
    }

    // Client errors - not retryable
    if (message.includes('unauthorized') || message.includes('forbidden')) {
      return { code: 'AUTH_ERROR', retryable: false, category: 'client' };
    }

    if (message.includes('invalid') || message.includes('malformed')) {
      return { code: 'VALIDATION_ERROR', retryable: false, category: 'client' };
    }

    // Default to retryable for unknown errors
    return { code: 'PROCESSING_ERROR', retryable: true, category: 'unknown' };
  }

  /**
   * Determine error code from error instance
   */
  static getErrorCode(error?: Error | any): string {
    return this.classify(error).code;
  }

  /**
   * Determine if error is retryable
   */
  static isRetryable(error?: Error | any): boolean {
    return this.classify(error).retryable;
  }
}