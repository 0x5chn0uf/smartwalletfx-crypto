/**
 * Batch Strategy
 * 
 * Handles batching algorithms and item prioritization
 * for efficient batch processing.
 */

import { ChainId } from '@/types/blockchain';

export interface BatchItem<TInput, TOutput> {
  id: string;
  input: TInput;
  chainId?: ChainId;
  provider?: string;
  priority?: number; // Higher = processed first
}

export interface BatchConfig {
  maxConcurrency: number;
  batchSize: number;
  timeoutMs: number;
  retryAttempts: number;
  retryDelayMs: number;
  useCircuitBreaker: boolean;
}

export class BatchStrategy {
  /**
   * Sort items by priority and provider for optimal batching
   */
  static sortItems<TInput, TOutput>(
    items: BatchItem<TInput, TOutput>[]
  ): BatchItem<TInput, TOutput>[] {
    return [...items].sort((a, b) => {
      // Sort by priority (high to low)
      const priorityDiff = (b.priority || 0) - (a.priority || 0);
      if (priorityDiff !== 0) return priorityDiff;
      
      // Group by provider for better circuit breaker efficiency
      const aProvider = a.provider || 'default';
      const bProvider = b.provider || 'default';
      return aProvider.localeCompare(bProvider);
    });
  }

  /**
   * Split array into chunks of specified size
   */
  static createChunks<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Group chunks for concurrent processing
   */
  static groupChunksForConcurrency<T>(
    chunks: T[][],
    maxConcurrency: number
  ): T[][][] {
    const groups: T[][][] = [];
    for (let i = 0; i < chunks.length; i += maxConcurrency) {
      groups.push(chunks.slice(i, i + maxConcurrency));
    }
    return groups;
  }

  /**
   * Calculate optimal batch size based on item count and concurrency
   */
  static calculateOptimalBatchSize(
    itemCount: number,
    maxConcurrency: number,
    targetBatchSize: number
  ): number {
    // For small item counts, use smaller batches
    if (itemCount <= maxConcurrency) {
      return 1;
    }

    // For large item counts, ensure we have enough batches to utilize concurrency
    const minBatches = Math.ceil(maxConcurrency * 1.5); // 1.5x concurrency for efficiency
    const maxOptimalBatchSize = Math.ceil(itemCount / minBatches);

    return Math.min(targetBatchSize, maxOptimalBatchSize);
  }

  /**
   * Estimate processing time based on batch configuration
   */
  static estimateProcessingTime(
    itemCount: number,
    config: BatchConfig
  ): number {
    const optimalBatchSize = this.calculateOptimalBatchSize(
      itemCount,
      config.maxConcurrency,
      config.batchSize
    );
    
    const totalChunks = Math.ceil(itemCount / optimalBatchSize);
    const concurrentGroups = Math.ceil(totalChunks / config.maxConcurrency);
    
    // Estimate: base processing time + retry overhead
    const baseTimePerItem = 100; // 100ms per item estimate
    const retryOverhead = config.retryAttempts * config.retryDelayMs * 0.1; // 10% failure rate assumption
    
    return concurrentGroups * (baseTimePerItem * optimalBatchSize + retryOverhead);
  }
}