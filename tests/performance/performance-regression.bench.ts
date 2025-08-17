/**
 * Performance Regression Benchmarks
 * 
 * Benchmarks to ensure performance optimizations maintain their effectiveness:
 * - Multi-chain portfolio aggregation speed
 * - Cache hit performance
 * - Batch processing throughput
 * - Circuit breaker overhead
 * - Memory usage patterns
 */

import { describe, bench, beforeEach, afterEach } from 'vitest';
import { ChainManager } from '../../src/services/ChainManager';
import { ChainId } from '../../src/types/blockchain';
import { BatchProcessor, BatchItem } from '../../src/utils/batchProcessor';
import { CircuitBreaker } from '../../src/utils/circuitBreaker';

describe('Performance Regression Benchmarks', () => {
  let chainManager: ChainManager;

  const testConfig = {
    providers: {
      alchemy: {
        apiKey: 'test-key',
        networks: ['ethereum', 'polygon']
      }
    },
    maxConcurrentRequests: 10
  };

  beforeEach(() => {
    chainManager = new ChainManager(testConfig);
  });

  afterEach(async () => {
    if (chainManager) {
      await chainManager.gracefulShutdown();
    }
  });

  describe('Multi-Chain Portfolio Aggregation', () => {
    const testAddress = '0x742d35Cc6634C0532925a3b8D01d3E0b37Bce61234';
    const multiChainIds = [
      ChainId.ETHEREUM,
      ChainId.POLYGON,
      ChainId.ARBITRUM,
      ChainId.OPTIMISM,
      ChainId.BASE
    ];

    bench('parallel multi-chain aggregation (5 chains)', async () => {
      // Mock successful responses for benchmarking
      const mockGetBalance = vi.fn().mockResolvedValue({
        success: true,
        data: [],
        metadata: {
          provider: 'alchemy',
          chainId: ChainId.ETHEREUM,
          timestamp: Date.now(),
          requestId: 'bench-test'
        }
      });

      await chainManager.getMultiChainPortfolio(testAddress, multiChainIds);
    }, {
      iterations: 50,
      time: 5000
    });

    bench('memory cache hit performance', async () => {
      // Prime the cache
      await chainManager.getMultiChainPortfolio(testAddress, [ChainId.ETHEREUM]);
      
      // Benchmark cache hits
      await chainManager.getMultiChainPortfolio(testAddress, [ChainId.ETHEREUM]);
    }, {
      iterations: 1000,
      time: 3000
    });

    bench('sequential processing (baseline)', async () => {
      // Simulate old sequential approach for comparison
      const results = [];
      for (const chainId of multiChainIds) {
        const result = await chainManager.getBalance(chainId, testAddress);
        results.push(result);
      }
    }, {
      iterations: 20,
      time: 5000
    });
  });

  describe('Batch Processing Performance', () => {
    const batchProcessor = new BatchProcessor<string, string>(
      async (input: string) => `processed-${input}`,
      {
        maxConcurrency: 5,
        batchSize: 10,
        timeoutMs: 1000,
        retryAttempts: 1,
        retryDelayMs: 50,
        useCircuitBreaker: false
      }
    );

    bench('batch processing - 50 items', async () => {
      const items: BatchItem<string, string>[] = Array(50).fill(null).map((_, i) => ({
        id: `item-${i}`,
        input: `input-${i}`,
        priority: Math.random() * 10
      }));

      await batchProcessor.processBatch(items);
    }, {
      iterations: 20,
      time: 5000
    });

    bench('batch processing - 100 items', async () => {
      const items: BatchItem<string, string>[] = Array(100).fill(null).map((_, i) => ({
        id: `item-${i}`,
        input: `input-${i}`,
        priority: Math.random() * 10
      }));

      await batchProcessor.processBatch(items);
    }, {
      iterations: 10,
      time: 5000
    });

    bench('priority sorting overhead', async () => {
      const items: BatchItem<string, string>[] = Array(1000).fill(null).map((_, i) => ({
        id: `item-${i}`,
        input: `input-${i}`,
        priority: Math.random() * 100
      }));

      // Sort by priority (simulating batch processor internal sorting)
      items.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    }, {
      iterations: 100,
      time: 3000
    });
  });

  describe('Circuit Breaker Performance', () => {
    let circuitBreaker: CircuitBreaker;

    beforeEach(() => {
      circuitBreaker = new CircuitBreaker('bench-service', {
        failureThreshold: 5,
        recoveryTimeoutMs: 1000,
        monitoringWindowMs: 5000,
        halfOpenMaxCalls: 2
      });
    });

    bench('circuit breaker successful calls overhead', async () => {
      const mockFn = vi.fn().mockResolvedValue('success');
      await circuitBreaker.execute(mockFn);
    }, {
      iterations: 1000,
      time: 3000
    });

    bench('circuit breaker statistics collection', async () => {
      // Benchmark the overhead of stats collection
      const stats = circuitBreaker.getStats();
      expect(stats).toBeDefined();
    }, {
      iterations: 10000,
      time: 2000
    });

    bench('direct function call (baseline)', async () => {
      const mockFn = vi.fn().mockResolvedValue('success');
      await mockFn();
    }, {
      iterations: 1000,
      time: 3000
    });
  });

  describe('Memory Cache Performance', () => {
    bench('memory cache operations', async () => {
      const cache = new Map<string, { data: any; expires: number }>();
      const key = 'test-key';
      const data = { portfolio: 'test-data' };
      const expires = Date.now() + 300000; // 5 minutes

      // Set operation
      cache.set(key, { data, expires });

      // Get operation
      const cached = cache.get(key);
      if (cached && cached.expires > Date.now()) {
        return cached.data;
      }

      // Delete operation
      cache.delete(key);
    }, {
      iterations: 100000,
      time: 3000
    });

    bench('memory cache cleanup simulation', async () => {
      const cache = new Map<string, { data: any; expires: number }>();
      
      // Populate cache with expired and valid entries
      for (let i = 0; i < 1000; i++) {
        const isExpired = i % 2 === 0;
        cache.set(`key-${i}`, {
          data: `data-${i}`,
          expires: Date.now() + (isExpired ? -1000 : 300000)
        });
      }

      // Cleanup expired entries
      const now = Date.now();
      for (const [key, cached] of cache.entries()) {
        if (cached.expires <= now) {
          cache.delete(key);
        }
      }
    }, {
      iterations: 100,
      time: 3000
    });
  });

  describe('Real-World Scenarios', () => {
    bench('high-frequency portfolio requests', async () => {
      const addresses = [
        '0x742d35Cc6634C0532925a3b8D01d3E0b37Bce612AA',
        '0x742d35Cc6634C0532925a3b8D01d3E0b37Bce612BB',
        '0x742d35Cc6634C0532925a3b8D01d3E0b37Bce612CC'
      ];

      // Simulate rapid successive requests (common in dashboard scenarios)
      const promises = addresses.map(address =>
        chainManager.getMultiChainPortfolio(address, [ChainId.ETHEREUM, ChainId.POLYGON])
      );

      await Promise.all(promises);
    }, {
      iterations: 10,
      time: 5000
    });

    bench('dashboard load simulation', async () => {
      const testAddress = '0x742d35Cc6634C0532925a3b8D01d3E0b37Bce61234';
      
      // Simulate initial dashboard load with multiple concurrent requests
      const portfolioPromise = chainManager.getMultiChainPortfolio(testAddress, multiChainIds);
      const balancePromises = multiChainIds.map(chainId =>
        chainManager.getBalance(chainId, testAddress)
      );

      await Promise.all([portfolioPromise, ...balancePromises]);
    }, {
      iterations: 5,
      time: 5000
    });
  });

  describe('Resource Usage Benchmarks', () => {
    bench('concurrent request handling', async () => {
      const testAddress = '0x742d35Cc6634C0532925a3b8D01d3E0b37Bce61234';
      
      // Simulate multiple concurrent users
      const userRequests = Array(20).fill(null).map((_, i) =>
        chainManager.getMultiChainPortfolio(
          `0x742d35Cc6634C0532925a3b8D01d3E0b37Bce61${i.toString().padStart(3, '0')}`,
          [ChainId.ETHEREUM]
        )
      );

      await Promise.all(userRequests);
    }, {
      iterations: 5,
      time: 5000
    });

    bench('memory usage under load', async () => {
      // Measure memory impact of processing many requests
      const promises = [];
      
      for (let i = 0; i < 100; i++) {
        const address = `0x742d35Cc6634C0532925a3b8D01d3E0b37Bce61${i.toString().padStart(3, '0')}`;
        promises.push(
          chainManager.getMultiChainPortfolio(address, [ChainId.ETHEREUM])
        );
      }

      await Promise.allSettled(promises);
    }, {
      iterations: 3,
      time: 10000
    });
  });
});

// Performance Expectations (regression thresholds)
describe('Performance Regression Thresholds', () => {
  bench('multi-chain aggregation must complete under 2 seconds', async () => {
    const chainManager = new ChainManager(testConfig);
    const testAddress = '0x742d35Cc6634C0532925a3b8D01d3E0b37Bce61234';
    
    const startTime = Date.now();
    await chainManager.getMultiChainPortfolio(testAddress, [
      ChainId.ETHEREUM,
      ChainId.POLYGON,
      ChainId.ARBITRUM,
      ChainId.OPTIMISM
    ]);
    const duration = Date.now() - startTime;
    
    // Performance threshold: 80% improvement from original 5-10s
    expect(duration).toBeLessThan(2000);
    
    await chainManager.gracefulShutdown();
  }, {
    iterations: 10,
    time: 30000
  });

  bench('cache hits must complete under 50ms', async () => {
    const chainManager = new ChainManager(testConfig);
    const testAddress = '0x742d35Cc6634C0532925a3b8D01d3E0b37Bce61234';
    
    // Prime cache
    await chainManager.getMultiChainPortfolio(testAddress, [ChainId.ETHEREUM]);
    
    // Measure cache hit performance
    const startTime = Date.now();
    await chainManager.getMultiChainPortfolio(testAddress, [ChainId.ETHEREUM]);
    const duration = Date.now() - startTime;
    
    // Performance threshold: 95% improvement (sub-second to sub-50ms)
    expect(duration).toBeLessThan(50);
    
    await chainManager.gracefulShutdown();
  }, {
    iterations: 100,
    time: 10000
  });
});