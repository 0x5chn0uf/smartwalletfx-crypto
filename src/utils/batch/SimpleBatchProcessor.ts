/**
 * Simple Batch Processor
 * 
 * Simplified batch processor with clean separation of concerns.
 * Uses the extracted error classifier and batch strategy.
 */

import { logger } from '../logger';
import { CircuitBreaker, CircuitBreakerFactory } from '../circuitBreaker';
import { ChainId } from '@/types/blockchain';
import { BatchItem, BatchConfig, BatchStrategy } from './BatchStrategy';
import { ErrorClassifier } from './ErrorClassifier';

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

export class SimpleBatchProcessor<TInput, TOutput> {
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

    // Use strategy to sort and chunk items
    const sortedItems = BatchStrategy.sortItems(items);
    const optimalBatchSize = BatchStrategy.calculateOptimalBatchSize(
      items.length,
      this.config.maxConcurrency,
      this.config.batchSize
    );
    const chunks = BatchStrategy.createChunks(sortedItems, optimalBatchSize);
    const chunkGroups = BatchStrategy.groupChunksForConcurrency(chunks, this.config.maxConcurrency);

    const results: BatchResult<TOutput>[] = [];

    // Process chunk groups sequentially, chunks within groups concurrently
    for (const chunkGroup of chunkGroups) {
      const chunkPromises = chunkGroup.map(chunk => this.processChunk(chunk));
      const chunkResults = await Promise.allSettled(chunkPromises);
      
      for (const result of chunkResults) {
        if (result.status === 'fulfilled') {
          results.push(...result.value);
        } else {
          logger.error('Chunk processing failed', { error: result.reason });
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
        const classification = ErrorClassifier.classify(result.reason);
        return {
          id: item.id,
          success: false,
          error: {
            code: classification.code,
            message: result.reason?.message || 'Unknown chunk processing error',
            retryable: classification.retryable
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
   * Process a single item with retry logic
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

        // Check if error is retryable before continuing
        if (!ErrorClassifier.isRetryable(lastError)) {
          logger.debug(`Non-retryable error, stopping attempts`, {
            itemId: item.id,
            error: lastError.message
          });
          break;
        }

        // Wait before retry (except on last attempt)
        if (attempt < this.config.retryAttempts) {
          await this.delay(this.config.retryDelayMs * attempt); // Exponential backoff
        }
      }
    }

    const classification = ErrorClassifier.classify(lastError);
    return {
      id: item.id,
      success: false,
      error: {
        code: classification.code,
        message: lastError?.message || 'Unknown error',
        retryable: classification.retryable
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
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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