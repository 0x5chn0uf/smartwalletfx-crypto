/**
 * Batch Processing Utilities Index
 * 
 * Exports the refactored batch processing classes.
 * This provides a cleaner, more maintainable alternative to the original batchProcessor.ts
 */

export { ErrorClassifier, type ErrorClassification } from './ErrorClassifier';
export { 
  BatchStrategy, 
  type BatchItem, 
  type BatchConfig 
} from './BatchStrategy';
export { 
  SimpleBatchProcessor, 
  type BatchResult 
} from './SimpleBatchProcessor';

// Re-export types for convenience
export type { ChainId } from '@/types/blockchain';