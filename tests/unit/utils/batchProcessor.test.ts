/**
 * BatchProcessor Unit Tests
 * 
 * Tests for intelligent batch processing including:
 * - Parallel execution with concurrency control
 * - Priority-based ordering
 * - Circuit breaker integration
 * - Retry logic and error handling
 * - Performance metrics and statistics
 */

import { BatchProcessor, BatchItem, BatchResult, BatchConfig } from '../../../src/utils/batchProcessor';
import { CircuitBreakerFactory } from '../../../src/utils/circuitBreaker';

describe('BatchProcessor', () => {
  let batchProcessor: BatchProcessor<string, string>;
  let mockProcessor: jest.Mock;

  beforeEach(() => {
    mockProcessor = jest.fn();
    
    const config: BatchConfig = {
      maxConcurrency: 3,
      batchSize: 5,
      timeoutMs: 1000,
      retryAttempts: 2,
      retryDelayMs: 100,
      useCircuitBreaker: false // Disable for basic tests
    };

    batchProcessor = new BatchProcessor(mockProcessor, config);
    CircuitBreakerFactory.reset(); // Clean circuit breakers
  });

  afterEach(() => {
    CircuitBreakerFactory.reset();
  });

  describe('Initialization', () => {
    it('should create batch processor with provided config', () => {
      expect(batchProcessor).toBeInstanceOf(BatchProcessor);
    });

    it('should have initial empty statistics', () => {
      const stats = batchProcessor.getStats();
      expect(stats.totalBatches).toBe(0);
      expect(stats.totalItems).toBe(0);
      expect(stats.successfulItems).toBe(0);
      expect(stats.failedItems).toBe(0);
    });
  });

  describe('Basic Batch Processing', () => {
    it('should process a single batch item successfully', async () => {
      mockProcessor.mockResolvedValue('processed-result');
      
      const items: BatchItem<string, string>[] = [{
        id: 'item-1',
        input: 'test-input',
        priority: 1
      }];

      const results = await batchProcessor.processBatch(items);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: 'item-1',
        success: true,
        data: 'processed-result',
        error: undefined,
        metadata: expect.objectContaining({
          processingTimeMs: expect.any(Number),
          retryCount: 0
        })
      });
      expect(mockProcessor).toHaveBeenCalledWith('test-input', expect.any(Object));
    });

    it('should process multiple items in parallel', async () => {
      let processingCount = 0;
      let maxConcurrent = 0;
      
      mockProcessor.mockImplementation(async (input: string) => {
        processingCount++;
        maxConcurrent = Math.max(maxConcurrent, processingCount);
        
        await new Promise(resolve => setTimeout(resolve, 50)); // Simulate work
        
        processingCount--;
        return `processed-${input}`;
      });

      const items: BatchItem<string, string>[] = Array(6).fill(null).map((_, i) => ({
        id: `item-${i}`,
        input: `input-${i}`,
        priority: 1
      }));

      const startTime = Date.now();
      const results = await batchProcessor.processBatch(items);
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(6);
      expect(maxConcurrent).toBeLessThanOrEqual(3); // Respects concurrency limit
      expect(duration).toBeLessThan(200); // Should be much faster than sequential (6 * 50ms = 300ms)
      
      results.forEach((result, i) => {
        expect(result.success).toBe(true);
        expect(result.data).toBe(`processed-input-${i}`);
      });
    });

    it('should handle processing failures gracefully', async () => {
      mockProcessor.mockImplementation(async (input: string) => {
        if (input === 'fail-input') {
          throw new Error('Processing failed');
        }
        return `processed-${input}`;
      });

      const items: BatchItem<string, string>[] = [
        { id: 'success-1', input: 'success-input', priority: 1 },
        { id: 'fail-1', input: 'fail-input', priority: 1 },
        { id: 'success-2', input: 'another-success', priority: 1 }
      ];

      const results = await batchProcessor.processBatch(items);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe('Processing failed');
      expect(results[2].success).toBe(true);
    });
  });

  describe('Priority-Based Processing', () => {
    it('should process higher priority items first', async () => {
      const processingOrder: string[] = [];
      
      mockProcessor.mockImplementation(async (input: string) => {
        processingOrder.push(input);
        await new Promise(resolve => setTimeout(resolve, 10));
        return `processed-${input}`;
      });

      const items: BatchItem<string, string>[] = [
        { id: 'low', input: 'low-priority', priority: 1 },
        { id: 'high', input: 'high-priority', priority: 10 },
        { id: 'medium', input: 'medium-priority', priority: 5 }
      ];

      await batchProcessor.processBatch(items);

      // High priority should be processed first
      expect(processingOrder[0]).toBe('high-priority');
    });

    it('should handle items with same priority in batch order', async () => {
      const processingOrder: string[] = [];
      
      mockProcessor.mockImplementation(async (input: string) => {
        processingOrder.push(input);
        return `processed-${input}`;
      });

      const items: BatchItem<string, string>[] = [
        { id: '1', input: 'first', priority: 5 },
        { id: '2', input: 'second', priority: 5 },
        { id: '3', input: 'third', priority: 5 }
      ];

      await batchProcessor.processBatch(items);

      // Should maintain order for same priority
      expect(processingOrder).toEqual(['first', 'second', 'third']);
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed operations up to configured limit', async () => {
      let attemptCount = 0;
      
      mockProcessor.mockImplementation(async (input: string) => {
        attemptCount++;
        if (attemptCount < 3) { // Fail first 2 attempts
          throw new Error('Temporary failure');
        }
        return 'success-after-retries';
      });

      const items: BatchItem<string, string>[] = [{
        id: 'retry-test',
        input: 'test-input',
        priority: 1
      }];

      const results = await batchProcessor.processBatch(items);

      expect(results[0].success).toBe(true);
      expect(results[0].data).toBe('success-after-retries');
      expect(results[0].metadata.retryCount).toBe(2);
      expect(mockProcessor).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should fail after exhausting retry attempts', async () => {
      mockProcessor.mockRejectedValue(new Error('Persistent failure'));

      const items: BatchItem<string, string>[] = [{
        id: 'retry-fail-test',
        input: 'test-input',
        priority: 1
      }];

      const results = await batchProcessor.processBatch(items);

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('Persistent failure');
      expect(results[0].metadata.retryCount).toBe(2);
      expect(mockProcessor).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });
  });

  describe('Circuit Breaker Integration', () => {
    beforeEach(() => {
      const config: BatchConfig = {
        maxConcurrency: 3,
        batchSize: 5,
        timeoutMs: 1000,
        retryAttempts: 1,
        retryDelayMs: 50,
        useCircuitBreaker: true
      };

      batchProcessor = new BatchProcessor(mockProcessor, config);
    });

    it('should use circuit breaker when enabled', async () => {
      mockProcessor.mockResolvedValue('success');

      const items: BatchItem<string, string>[] = [{
        id: 'cb-test',
        input: 'test-input',
        priority: 1,
        provider: 'test-provider'
      }];

      const results = await batchProcessor.processBatch(items);

      expect(results[0].success).toBe(true);
      expect(results[0].data).toBe('success');
    });

    it('should handle circuit breaker failures', async () => {
      // Trigger circuit breaker to open by causing multiple failures
      mockProcessor.mockRejectedValue(new Error('Service down'));

      const items: BatchItem<string, string>[] = Array(5).fill(null).map((_, i) => ({
        id: `cb-fail-${i}`,
        input: `input-${i}`,
        priority: 1,
        provider: 'failing-provider'
      }));

      const results = await batchProcessor.processBatch(items);

      results.forEach(result => {
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Service down|Circuit breaker/);
      });
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout long-running operations', async () => {
      const config: BatchConfig = {
        maxConcurrency: 1,
        batchSize: 1,
        timeoutMs: 100, // Very short timeout
        retryAttempts: 0,
        retryDelayMs: 50,
        useCircuitBreaker: false
      };

      const timeoutProcessor = new BatchProcessor(
        async () => {
          await new Promise(resolve => setTimeout(resolve, 200)); // Longer than timeout
          return 'should-not-reach';
        },
        config
      );

      const items: BatchItem<string, string>[] = [{
        id: 'timeout-test',
        input: 'test-input',
        priority: 1
      }];

      const results = await timeoutProcessor.processBatch(items);

      expect(results[0].success).toBe(false);
      expect(results[0].error).toMatch(/timeout|aborted/i);
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should track processing statistics', async () => {
      mockProcessor.mockImplementation(async (input: string) => {
        if (input === 'fail') throw new Error('Test failure');
        return 'success';
      });

      const items: BatchItem<string, string>[] = [
        { id: '1', input: 'success1', priority: 1 },
        { id: '2', input: 'fail', priority: 1 },
        { id: '3', input: 'success2', priority: 1 }
      ];

      await batchProcessor.processBatch(items);

      const stats = batchProcessor.getStats();
      expect(stats.totalBatches).toBe(1);
      expect(stats.totalItems).toBe(3);
      expect(stats.successfulItems).toBe(2);
      expect(stats.failedItems).toBe(1);
      expect(stats.averageProcessingTimeMs).toBeGreaterThan(0);
    });

    it('should track multiple batch statistics', async () => {
      mockProcessor.mockResolvedValue('success');

      // Process two separate batches
      const batch1 = [{ id: '1', input: 'test1', priority: 1 }];
      const batch2 = [
        { id: '2', input: 'test2', priority: 1 },
        { id: '3', input: 'test3', priority: 1 }
      ];

      await batchProcessor.processBatch(batch1);
      await batchProcessor.processBatch(batch2);

      const stats = batchProcessor.getStats();
      expect(stats.totalBatches).toBe(2);
      expect(stats.totalItems).toBe(3);
      expect(stats.successfulItems).toBe(3);
      expect(stats.failedItems).toBe(0);
    });
  });

  describe('Batch Splitting', () => {
    it('should split large batches based on batchSize config', async () => {
      let batchCount = 0;
      
      mockProcessor.mockImplementation(async (input: string) => {
        return `processed-${input}`;
      });

      const config: BatchConfig = {
        maxConcurrency: 2,
        batchSize: 2, // Small batch size
        timeoutMs: 1000,
        retryAttempts: 0,
        retryDelayMs: 50,
        useCircuitBreaker: false
      };

      const largeBatchProcessor = new BatchProcessor(mockProcessor, config);

      // 5 items should be split into 3 batches (2+2+1)
      const items: BatchItem<string, string>[] = Array(5).fill(null).map((_, i) => ({
        id: `item-${i}`,
        input: `input-${i}`,
        priority: 1
      }));

      const results = await largeBatchProcessor.processBatch(items);

      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty batch', async () => {
      const results = await batchProcessor.processBatch([]);
      
      expect(results).toEqual([]);
      
      const stats = batchProcessor.getStats();
      expect(stats.totalBatches).toBe(1);
      expect(stats.totalItems).toBe(0);
    });

    it('should handle processor that returns undefined', async () => {
      mockProcessor.mockResolvedValue(undefined);

      const items: BatchItem<string, string>[] = [{
        id: 'undefined-test',
        input: 'test',
        priority: 1
      }];

      const results = await batchProcessor.processBatch(items);

      expect(results[0].success).toBe(true);
      expect(results[0].data).toBeUndefined();
    });

    it('should handle processor that throws non-Error objects', async () => {
      mockProcessor.mockRejectedValue('string error');

      const items: BatchItem<string, string>[] = [{
        id: 'string-error-test',
        input: 'test',
        priority: 1
      }];

      const results = await batchProcessor.processBatch(items);

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('string error');
    });

    it('should handle concurrent batch processing', async () => {
      mockProcessor.mockImplementation(async (input: string) => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
        return `processed-${input}`;
      });

      const batch1 = [{ id: '1a', input: 'test1a', priority: 1 }];
      const batch2 = [{ id: '2a', input: 'test2a', priority: 1 }];

      // Process batches concurrently
      const [results1, results2] = await Promise.all([
        batchProcessor.processBatch(batch1),
        batchProcessor.processBatch(batch2)
      ]);

      expect(results1[0].success).toBe(true);
      expect(results2[0].success).toBe(true);
      
      const stats = batchProcessor.getStats();
      expect(stats.totalBatches).toBe(2);
      expect(stats.totalItems).toBe(2);
    });
  });
});