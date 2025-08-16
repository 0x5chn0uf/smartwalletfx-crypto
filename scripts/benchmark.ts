#!/usr/bin/env tsx
/**
 * Performance Benchmarking Suite
 * Comprehensive benchmarks for crypto data service components
 */

import { performance } from 'perf_hooks';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { cpus, totalmem, freemem } from 'os';
import fs from 'fs/promises';
import path from 'path';

// Import components to benchmark
import { InMemoryEventBusAdapter } from '../src/adapters/outbound/event-bus/InMemoryEventBusAdapter';
import { EventBusFactory } from '../src/events/EventBusFactory';
import { AsyncPortfolioService } from '../src/services/AsyncPortfolioService';
import { CostOptimizationService } from '../src/services/CostOptimizationService';
import { config } from '../src/config';

interface BenchmarkResult {
  name: string;
  description: string;
  iterations: number;
  totalTimeMs: number;
  avgTimeMs: number;
  minTimeMs: number;
  maxTimeMs: number;
  operationsPerSecond: number;
  memoryUsageBefore: NodeJS.MemoryUsage;
  memoryUsageAfter: NodeJS.MemoryUsage;
  memoryDelta: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
}

interface SystemInfo {
  cpus: number;
  totalMemoryGB: number;
  freeMemoryGB: number;
  nodeVersion: string;
  platform: string;
  arch: string;
}

class Benchmarker {
  private results: BenchmarkResult[] = [];
  private systemInfo: SystemInfo;

  constructor() {
    this.systemInfo = {
      cpus: cpus().length,
      totalMemoryGB: totalmem() / 1024 / 1024 / 1024,
      freeMemoryGB: freemem() / 1024 / 1024 / 1024,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    };
  }

  async benchmark<T>(
    name: string,
    description: string,
    fn: () => Promise<T> | T,
    iterations: number = 1000
  ): Promise<BenchmarkResult> {
    console.log(`📈 Benchmarking: ${name} (${iterations} iterations)`);
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    const memoryBefore = process.memoryUsage();
    const times: number[] = [];
    
    // Warm up
    for (let i = 0; i < Math.min(10, iterations); i++) {
      await fn();
    }
    
    // Run benchmark
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await fn();
      const end = performance.now();
      times.push(end - start);
    }
    
    const memoryAfter = process.memoryUsage();
    
    const totalTime = times.reduce((sum, time) => sum + time, 0);
    const avgTime = totalTime / iterations;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const operationsPerSecond = 1000 / avgTime;
    
    const memoryDelta = {
      rss: memoryAfter.rss - memoryBefore.rss,
      heapUsed: memoryAfter.heapUsed - memoryBefore.heapUsed,
      heapTotal: memoryAfter.heapTotal - memoryBefore.heapTotal,
      external: memoryAfter.external - memoryBefore.external,
    };
    
    const result: BenchmarkResult = {
      name,
      description,
      iterations,
      totalTimeMs: totalTime,
      avgTimeMs: avgTime,
      minTimeMs: minTime,
      maxTimeMs: maxTime,
      operationsPerSecond,
      memoryUsageBefore: memoryBefore,
      memoryUsageAfter: memoryAfter,
      memoryDelta,
    };
    
    this.results.push(result);
    
    console.log(`  ✅ Avg: ${avgTime.toFixed(3)}ms, ${operationsPerSecond.toFixed(0)} ops/sec`);
    
    return result;
  }

  async runAllBenchmarks(): Promise<void> {
    console.log('🚀 Starting comprehensive benchmarks...');
    console.log('System Info:', this.systemInfo);
    console.log('');

    // Event Bus Benchmarks
    await this.benchmarkEventBus();
    
    // Portfolio Service Benchmarks
    await this.benchmarkPortfolioService();
    
    // Cost Optimization Benchmarks
    await this.benchmarkCostOptimization();
    
    // Memory and GC Benchmarks
    await this.benchmarkMemoryOperations();
    
    // Concurrent Operations Benchmarks
    await this.benchmarkConcurrentOperations();
    
    await this.generateReport();
  }

  private async benchmarkEventBus(): Promise<void> {
    console.log('
📨 Event Bus Benchmarks');
    
    const eventBus = new InMemoryEventBusAdapter();
    
    // Simple event publish
    await this.benchmark(
      'EventBus: Simple Publish',
      'Publishing simple events to in-memory event bus',
      () => {
        return eventBus.publish('TestEvent', { id: randomUUID(), data: 'test' });
      },
      10000
    );
    
    // Event with large payload
    const largePayload = {
      id: randomUUID(),
      data: 'x'.repeat(10000), // 10KB payload
      metadata: {
        timestamp: Date.now(),
        user: 'test-user',
        additionalData: new Array(100).fill(0).map((_, i) => ({ index: i, value: Math.random() })),
      },
    };
    
    await this.benchmark(
      'EventBus: Large Payload',
      'Publishing events with 10KB+ payloads',
      () => {
        return eventBus.publish('LargeEvent', largePayload);
      },
      1000
    );
    
    // Subscribe and publish with handlers
    let handlerCallCount = 0;
    await eventBus.subscribe('BenchmarkEvent', async (data) => {
      handlerCallCount++;
      // Simulate some processing
      await new Promise(resolve => setImmediate(resolve));
    });
    
    await this.benchmark(
      'EventBus: Publish with Handler',
      'Publishing events with active subscribers',
      () => {
        return eventBus.publish('BenchmarkEvent', { id: randomUUID() });
      },
      5000
    );
    
    console.log(`  Handler calls: ${handlerCallCount}`);
  }

  private async benchmarkPortfolioService(): Promise<void> {
    console.log('\n💼 Portfolio Service Benchmarks');
    
    const eventBus = EventBusFactory.create('memory', config.eventBus);
    const portfolioService = new AsyncPortfolioService(eventBus);
    
    // Portfolio analysis request
    await this.benchmark(
      'Portfolio: Analysis Request',
      'Creating portfolio analysis requests',
      () => {
        return portfolioService.analyzePortfolioAsync({
          address: '0x742d35Cc6643C0532925a3b8D50C20c6AF4e0b57',
          chain: 'ethereum',
          includePositions: true,
        });
      },
      1000
    );
    
    // Batch portfolio requests
    const addresses = new Array(10).fill(0).map(() => 
      '0x' + randomUUID().replace(/-/g, '').substring(0, 40)
    );
    
    await this.benchmark(
      'Portfolio: Batch Analysis',
      'Batch processing multiple portfolio requests',
      async () => {
        const promises = addresses.map(address => 
          portfolioService.analyzePortfolioAsync({
            address,
            chain: 'ethereum',
            includePositions: false,
          })
        );
        await Promise.all(promises);
      },
      100
    );
  }

  private async benchmarkCostOptimization(): Promise<void> {
    console.log('\n💰 Cost Optimization Benchmarks');
    
    const costService = new CostOptimizationService();
    
    // Provider selection
    await this.benchmark(
      'Cost: Provider Selection',
      'Selecting optimal provider for requests',
      () => {
        return costService.selectOptimalProvider({
          chain: 'ethereum',
          operation: 'getBalance',
          priority: 'cost',
        });
      },
      10000
    );
    
    // Batch optimization
    const requests = new Array(100).fill(0).map((_, i) => ({
      id: `req-${i}`,
      chain: 'ethereum',
      operation: 'getBalance',
      address: '0x' + randomUUID().replace(/-/g, '').substring(0, 40),
    }));
    
    await this.benchmark(
      'Cost: Batch Optimization',
      'Optimizing batch requests for cost efficiency',
      () => {
        return costService.optimizeBatch(requests);
      },
      100
    );
  }

  private async benchmarkMemoryOperations(): Promise<void> {
    console.log('\n🧠 Memory Operation Benchmarks');
    
    // Object creation and destruction
    await this.benchmark(
      'Memory: Object Creation',
      'Creating and destroying large objects',
      () => {
        const obj = {
          id: randomUUID(),
          data: new Array(1000).fill(0).map((_, i) => ({ index: i, value: Math.random() })),
          metadata: {
            timestamp: Date.now(),
            hash: randomUUID(),
          },
        };
        return obj;
      },
      10000
    );
    
    // Array operations
    await this.benchmark(
      'Memory: Array Operations',
      'Large array manipulation operations',
      () => {
        const arr = new Array(10000).fill(0).map(() => Math.random());
        arr.sort();
        arr.filter(x => x > 0.5);
        arr.map(x => x * 2);
        return arr.length;
      },
      1000
    );
    
    // JSON serialization/deserialization
    const largeObject = {
      users: new Array(1000).fill(0).map((_, i) => ({
        id: i,
        name: `User ${i}`,
        email: `user${i}@example.com`,
        profile: {
          age: Math.floor(Math.random() * 50) + 18,
          interests: new Array(5).fill(0).map(() => randomUUID()),
        },
      })),
    };
    
    await this.benchmark(
      'Memory: JSON Serialization',
      'JSON stringify/parse of large objects',
      () => {
        const serialized = JSON.stringify(largeObject);
        const deserialized = JSON.parse(serialized);
        return deserialized.users.length;
      },
      1000
    );
  }

  private async benchmarkConcurrentOperations(): Promise<void> {
    console.log('\n⚙️ Concurrent Operation Benchmarks');
    
    // Promise.all vs sequential
    const asyncOperation = () => new Promise(resolve => setTimeout(resolve, 1));
    
    await this.benchmark(
      'Concurrency: Promise.all (10)',
      'Running 10 async operations concurrently',
      async () => {
        const promises = new Array(10).fill(0).map(() => asyncOperation());
        await Promise.all(promises);
      },
      1000
    );
    
    await this.benchmark(
      'Concurrency: Promise.all (100)',
      'Running 100 async operations concurrently',
      async () => {
        const promises = new Array(100).fill(0).map(() => asyncOperation());
        await Promise.all(promises);
      },
      100
    );
    
    // EventEmitter performance
    const emitter = new EventEmitter();
    emitter.setMaxListeners(1000);
    
    // Add many listeners
    for (let i = 0; i < 100; i++) {
      emitter.on('test', () => {});
    }
    
    await this.benchmark(
      'Concurrency: EventEmitter (100 listeners)',
      'Emitting events with 100 listeners',
      () => {
        emitter.emit('test', { data: 'benchmark' });
      },
      10000
    );
  }

  private async generateReport(): Promise<void> {
    console.log('\n📊 Generating Benchmark Report...');
    
    const reportDir = path.join(process.cwd(), 'benchmark-reports');
    await fs.mkdir(reportDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFile = path.join(reportDir, `benchmark-${timestamp}.json`);
    
    const report = {
      timestamp: new Date().toISOString(),
      systemInfo: this.systemInfo,
      results: this.results,
      summary: {
        totalBenchmarks: this.results.length,
        fastestOperation: this.results.reduce((fastest, current) => 
          current.avgTimeMs < fastest.avgTimeMs ? current : fastest
        ),
        slowestOperation: this.results.reduce((slowest, current) => 
          current.avgTimeMs > slowest.avgTimeMs ? current : slowest
        ),
        highestThroughput: this.results.reduce((highest, current) => 
          current.operationsPerSecond > highest.operationsPerSecond ? current : highest
        ),
        totalMemoryAllocated: this.results.reduce((total, result) => 
          total + Math.max(0, result.memoryDelta.heapUsed), 0
        ),
      },
    };
    
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
    
    // Print summary table
    console.log('\n📈 Benchmark Results Summary:');
    console.log('─'.repeat(120));
    console.log(
      'Operation'.padEnd(35) +
      'Avg Time (ms)'.padEnd(15) +
      'Ops/sec'.padEnd(12) +
      'Min/Max (ms)'.padEnd(20) +
      'Memory Delta (MB)'.padEnd(18) +
      'Iterations'
    );
    console.log('─'.repeat(120));
    
    this.results.forEach(result => {
      const memoryDeltaMB = (result.memoryDelta.heapUsed / 1024 / 1024).toFixed(2);
      const minMax = `${result.minTimeMs.toFixed(2)}/${result.maxTimeMs.toFixed(2)}`;
      
      console.log(
        result.name.padEnd(35) +
        result.avgTimeMs.toFixed(3).padEnd(15) +
        result.operationsPerSecond.toFixed(0).padEnd(12) +
        minMax.padEnd(20) +
        memoryDeltaMB.padEnd(18) +
        result.iterations.toString()
      );
    });
    
    console.log('─'.repeat(120));
    console.log(`\n📄 Full report saved to: ${reportFile}`);
    
    // Performance warnings
    console.log('\n⚠️ Performance Warnings:');
    
    this.results.forEach(result => {
      if (result.avgTimeMs > 100) {
        console.log(`  • ${result.name}: Average time ${result.avgTimeMs.toFixed(2)}ms is high`);
      }
      
      if (result.operationsPerSecond < 100) {
        console.log(`  • ${result.name}: Throughput ${result.operationsPerSecond.toFixed(0)} ops/sec is low`);
      }
      
      if (result.memoryDelta.heapUsed > 10 * 1024 * 1024) { // 10MB
        const memoryMB = (result.memoryDelta.heapUsed / 1024 / 1024).toFixed(2);
        console.log(`  • ${result.name}: High memory usage ${memoryMB}MB`);
      }
    });
    
    if (this.results.every(r => r.avgTimeMs <= 100 && r.operationsPerSecond >= 100)) {
      console.log('  ✅ All benchmarks passed performance thresholds!');
    }
  }
}

async function runBenchmarks(): Promise<void> {
  console.log('🏁 Crypto Data Service Performance Benchmarks');
  console.log('=' .repeat(60));
  
  // Enable garbage collection for accurate memory measurements
  if (!global.gc) {
    console.log('⚠️ Warning: Run with --expose-gc for accurate memory measurements');
  }
  
  const benchmarker = new Benchmarker();
  await benchmarker.runAllBenchmarks();
  
  console.log('\n✅ Benchmarks completed successfully!');
}

// CLI interface
if (require.main === module) {
  runBenchmarks().catch(error => {
    console.error('Benchmark failed:', error);
    process.exit(1);
  });
}

export { Benchmarker, BenchmarkResult };
