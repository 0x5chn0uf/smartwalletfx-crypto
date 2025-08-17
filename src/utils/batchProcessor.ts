/**
 * Batch Processor - REFACTORED
 * 
 * This file now uses the simplified batch processing utilities
 * with proper separation of concerns.
 * 
 * For new code, use the modular components in ./batch/ instead.
 */

import { 
  SimpleBatchProcessor,
  BatchStrategy,
  ErrorClassifier,
  type BatchItem,
  type BatchConfig,
  type BatchResult
} from './batch';
import { ChainId } from '@/types/blockchain';

// Re-export the main classes and types for backward compatibility
export { SimpleBatchProcessor as BatchProcessor };
export { BatchStrategy, ErrorClassifier };
export type { BatchItem, BatchConfig, BatchResult };

/**
 * Convenience function for quick batch processing
 */
export function createBatchProcessor<TInput, TOutput>(
  processFn: (item: TInput, context: { chainId?: ChainId; provider?: string }) => Promise<TOutput>,
  config?: Partial<BatchConfig>
): SimpleBatchProcessor<TInput, TOutput> {
  const defaultConfig: BatchConfig = {
    maxConcurrency: 5,
    batchSize: 10,
    timeoutMs: 30000,
    retryAttempts: 3,
    retryDelayMs: 1000,
    useCircuitBreaker: true,
  };

  const finalConfig = { ...defaultConfig, ...config };
  return new SimpleBatchProcessor(processFn, finalConfig);
}

/**
 * Helper function for processing arrays with batch optimization
 */
export async function processBatchOptimized<TInput, TOutput>(
  items: Array<{
    id: string;
    input: TInput;
    chainId?: ChainId;
    provider?: string;
    priority?: number;
  }>,
  processFn: (item: TInput, context: { chainId?: ChainId; provider?: string }) => Promise<TOutput>,
  config?: Partial<BatchConfig>
): Promise<BatchResult<TOutput>[]> {
  const processor = createBatchProcessor(processFn, config);
  return processor.processBatch(items);
}

// Legacy export for backward compatibility
export class BatchProcessor<TInput, TOutput> extends SimpleBatchProcessor<TInput, TOutput> {
  constructor(
    processFn: (item: TInput, context: { chainId?: ChainId; provider?: string }) => Promise<TOutput>,
    config: BatchConfig
  ) {
    super(processFn, config);
    console.warn('BatchProcessor is deprecated. Use SimpleBatchProcessor from ./batch instead.');
  }
}