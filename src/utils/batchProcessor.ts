/**
 * Batch Processor for Multi-Chain Operations
 * 
 * Optimizes multi-chain queries with parallel processing,
 * intelligent batching, and failure handling.
 */

import { logger } from './logger';
import { CircuitBreaker, CircuitBreakerFactory } from './circuitBreaker';
import { ChainId } from '@/types/blockchain';

export interface BatchConfig {
  maxConcurrency: number;
  batchSize: number;
  timeoutMs: number;
  retryAttempts: number;
  retryDelayMs: number;
  useCircuitBreaker: boolean;
}

export interface BatchItem<TInput, TOutput> {
  id: string;
  input: TInput;
  chainId?: ChainId;
  provider?: string;
  priority?: number; // Higher = processed first
}

export interface BatchResult<TOutput> {
  id: string;
  success: boolean;
  data?: TOutput;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  metadata: {
    attempts: number;
    duration: number;
    chainId?: ChainId;
    provider?: string;
  };
}

export class BatchProcessor<TInput, TOutput> {
  private readonly circuitBreakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly processFn: (item: TInput, context: { chainId?: ChainId; provider?: string }) => Promise<TOutput>,
    private readonly config: BatchConfig
  ) {}

  /**
   * Process multiple items in optimized batches
   */
  async processBatch(items: BatchItem<TInput, TOutput>[]): Promise<BatchResult<TOutput>[]> {
    if (items.length === 0) {
      return [];
    }

    const startTime = Date.now();
    logger.info(`Starting batch processing`, {
      itemCount: items.length,
      maxConcurrency: this.config.maxConcurrency,
      batchSize: this.config.batchSize
    });

    // Sort by priority (high to low), then by provider to optimize batching
    const sortedItems = [...items].sort((a, b) => {
      const priorityDiff = (b.priority || 0) - (a.priority || 0);
      if (priorityDiff !== 0) return priorityDiff;
      
      // Group by provider for better circuit breaker efficiency
      const aProvider = a.provider || 'default';
      const bProvider = b.provider || 'default';
      return aProvider.localeCompare(bProvider);
    });

    const results: BatchResult<TOutput>[] = [];
    const chunks = this.chunkArray(sortedItems, this.config.batchSize);

    // Process chunks with concurrency control
    for (let i = 0; i < chunks.length; i += this.config.maxConcurrency) {
      const currentChunks = chunks.slice(i, i + this.config.maxConcurrency);
      
      const chunkPromises = currentChunks.map(chunk => 
        this.processChunk(chunk)
      );

      const chunkResults = await Promise.allSettled(chunkPromises);
      
      for (const result of chunkResults) {
        if (result.status === 'fulfilled') {
          results.push(...result.value);
        } else {
          logger.error('Chunk processing failed', { error: result.reason });
          // Add failure results for items in failed chunk
          // This would need the chunk items to create proper error results
        }
      }
    }

    const duration = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;
    
    logger.info(`Batch processing completed`, {
      total: items.length,
      successful: successCount,
      failed: items.length - successCount,
      duration,
      avgPerItem: Math.round(duration / items.length)
    });

    return results;
  }

  /**
   * Process a single chunk of items in parallel
   */
  private async processChunk(chunk: BatchItem<TInput, TOutput>[]): Promise<BatchResult<TOutput>[]> {
    const promises = chunk.map(item => this.processItem(item));
    const results = await Promise.allSettled(promises);
    
    return results.map((result, index) => {
      const item = chunk[index];
      
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          id: item.id,
          success: false,
          error: {
            code: 'CHUNK_PROCESSING_ERROR',
            message: result.reason?.message || 'Unknown chunk processing error',
            retryable: true
          },
          metadata: {
            attempts: 1,
            duration: 0,
            chainId: item.chainId,
            provider: item.provider
          }
        };
      }
    });
  }

  /**
   * Process a single item with retry logic and circuit breaker
   */
  private async processItem(item: BatchItem<TInput, TOutput>): Promise<BatchResult<TOutput>> {
    const startTime = Date.now();
    let lastError: Error | undefined;
    
    const providerKey = `${item.provider || 'default'}-${item.chainId || 'global'}`;
    const circuitBreaker = this.getCircuitBreaker(providerKey);

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const result = this.config.useCircuitBreaker
          ? await circuitBreaker.execute(() => this.processFn(item.input, {
              chainId: item.chainId,
              provider: item.provider
            }))
          : await this.processFn(item.input, {
              chainId: item.chainId,
              provider: item.provider
            });

        return {
          id: item.id,
          success: true,
          data: result,
          metadata: {
            attempts: attempt,
            duration: Date.now() - startTime,
            chainId: item.chainId,
            provider: item.provider
          }
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        logger.debug(`Item processing attempt ${attempt} failed`, {
          itemId: item.id,
          provider: item.provider,
          chainId: item.chainId,
          error: lastError.message,
          willRetry: attempt < this.config.retryAttempts
        });

        // Wait before retry (except on last attempt)
        if (attempt < this.config.retryAttempts) {
          await this.delay(this.config.retryDelayMs * attempt); // Exponential backoff
        }
      }
    }

    return {
      id: item.id,
      success: false,
      error: {
        code: this.getErrorCode(lastError),
        message: lastError?.message || 'Unknown error',
        retryable: this.isRetryableError(lastError)
      },
      metadata: {
        attempts: this.config.retryAttempts,
        duration: Date.now() - startTime,
        chainId: item.chainId,
        provider: item.provider
      }
    };
  }

  /**
   * Get or create circuit breaker for provider
   */
  private getCircuitBreaker(providerKey: string): CircuitBreaker {
    if (!this.circuitBreakers.has(providerKey)) {
      const breaker = CircuitBreakerFactory.create(`batch-${providerKey}`, {
        timeout: this.config.timeoutMs,
        failureThreshold: 3,
        recoveryTimeout: 30000
      });
      this.circuitBreakers.set(providerKey, breaker);
    }
    return this.circuitBreakers.get(providerKey)!;
  }

  /**
   * Split array into chunks
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Determine error code from error instance
   */
  private getErrorCode(error?: Error): string {
    if (!error) return 'UNKNOWN_ERROR';
    
    const message = error.message.toLowerCase();
    
    if (message.includes('timeout')) return 'TIMEOUT_ERROR';
    if (message.includes('network')) return 'NETWORK_ERROR';
    if (message.includes('rate limit')) return 'RATE_LIMIT_ERROR';
    if (message.includes('circuit breaker')) return 'CIRCUIT_BREAKER_ERROR';
    if (message.includes('unauthorized') || message.includes('forbidden')) return 'AUTH_ERROR';
    
    return 'PROCESSING_ERROR';
  }

  /**
   * Determine if error is retryable
   */
  private isRetryableError(error?: Error): boolean {
    if (!error) return false;
    
    const message = error.message.toLowerCase();
    
    // Non-retryable errors
    if (message.includes('unauthorized') || message.includes('forbidden')) return false;
    if (message.includes('invalid') || message.includes('malformed')) return false;
    
    // Retryable errors
    if (message.includes('timeout')) return true;
    if (message.includes('network')) return true;
    if (message.includes('rate limit')) return true;
    if (message.includes('circuit breaker')) return true;
    if (message.includes('temporary')) return true;
    
    return true; // Default to retryable for unknown errors
  }

  /**
   * Get processing statistics
   */
  getStats(): {
    circuitBreakers: Record<string, any>;
    config: BatchConfig;
  } {
    const circuitBreakerStats: Record<string, any> = {};
    Array.from(this.circuitBreakers.entries()).forEach(([key, breaker]) => {
      circuitBreakerStats[key] = breaker.getStats();
    });

    return {
      circuitBreakers: circuitBreakerStats,
      config: this.config
    };
  }
}