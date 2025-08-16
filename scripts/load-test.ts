#!/usr/bin/env tsx
/**
 * Performance Load Testing Suite
 * Tests the crypto data service under extreme load conditions
 */

import { performance } from 'perf_hooks';
import { Worker } from 'worker_threads';
import { randomUUID } from 'crypto';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

interface LoadTestConfig {
  baseUrl: string;
  concurrentUsers: number;
  requestsPerUser: number;
  rampUpTimeMs: number;
  testDurationMs: number;
  endpoints: TestEndpoint[];
}

interface TestEndpoint {
  path: string;
  method: 'GET' | 'POST';
  weight: number; // 1-10, probability of being selected
  payload?: any;
  headers?: Record<string, string>;
}

interface TestResult {
  endpoint: string;
  method: string;
  startTime: number;
  endTime: number;
  duration: number;
  status: number;
  success: boolean;
  error?: string;
  responseSize: number;
}

interface LoadTestReport {
  config: LoadTestConfig;
  startTime: number;
  endTime: number;
  totalDuration: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  p95Latency: number;
  p99Latency: number;
  requestsPerSecond: number;
  errorRate: number;
  throughputMBps: number;
  results: TestResult[];
  errors: Array<{ error: string; count: number }>;
}

class LoadTester {
  private config: LoadTestConfig;
  private results: TestResult[] = [];
  private workers: Worker[] = [];
  private startTime: number = 0;
  private endTime: number = 0;

  constructor(config: LoadTestConfig) {
    this.config = config;
  }

  async runLoadTest(): Promise<LoadTestReport> {
    console.log('🚀 Starting load test...');
    console.log(`Config: ${this.config.concurrentUsers} users, ${this.config.requestsPerUser} req/user`);
    
    this.startTime = performance.now();
    
    // Create workers for concurrent load
    const workerPromises: Promise<TestResult[]>[] = [];
    
    for (let i = 0; i < this.config.concurrentUsers; i++) {
      const workerPromise = this.createWorkerLoad(i);
      workerPromises.push(workerPromise);
      
      // Ramp up delay
      if (this.config.rampUpTimeMs > 0) {
        const delay = (this.config.rampUpTimeMs / this.config.concurrentUsers) * i;
        await this.sleep(delay);
      }
    }
    
    // Wait for all workers to complete
    const allResults = await Promise.all(workerPromises);
    this.results = allResults.flat();
    
    this.endTime = performance.now();
    
    return this.generateReport();
  }

  private async createWorkerLoad(workerId: number): Promise<TestResult[]> {
    const results: TestResult[] = [];
    
    for (let i = 0; i < this.config.requestsPerUser; i++) {
      const endpoint = this.selectRandomEndpoint();
      const result = await this.makeRequest(endpoint, workerId, i);
      results.push(result);
      
      // Small delay between requests to simulate realistic usage
      await this.sleep(Math.random() * 100);
    }
    
    return results;
  }

  private selectRandomEndpoint(): TestEndpoint {
    const totalWeight = this.config.endpoints.reduce((sum, ep) => sum + ep.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const endpoint of this.config.endpoints) {
      random -= endpoint.weight;
      if (random <= 0) {
        return endpoint;
      }
    }
    
    return this.config.endpoints[0]; // Fallback
  }

  private async makeRequest(endpoint: TestEndpoint, workerId: number, requestId: number): Promise<TestResult> {
    const startTime = performance.now();
    const url = `${this.config.baseUrl}${endpoint.path}`;
    
    try {
      const requestOptions: any = {
        method: endpoint.method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `LoadTester-Worker-${workerId}-${requestId}`,
          ...endpoint.headers,
        },
        timeout: 30000,
      };
      
      if (endpoint.payload && endpoint.method === 'POST') {
        requestOptions.body = JSON.stringify(endpoint.payload);
      }
      
      const response = await fetch(url, requestOptions);
      const responseText = await response.text();
      const endTime = performance.now();
      
      return {
        endpoint: endpoint.path,
        method: endpoint.method,
        startTime,
        endTime,
        duration: endTime - startTime,
        status: response.status,
        success: response.ok,
        responseSize: responseText.length,
      };
    } catch (error) {
      const endTime = performance.now();
      return {
        endpoint: endpoint.path,
        method: endpoint.method,
        startTime,
        endTime,
        duration: endTime - startTime,
        status: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        responseSize: 0,
      };
    }
  }

  private generateReport(): LoadTestReport {
    const totalDuration = this.endTime - this.startTime;
    const successfulRequests = this.results.filter(r => r.success).length;
    const failedRequests = this.results.length - successfulRequests;
    
    const latencies = this.results.map(r => r.duration).sort((a, b) => a - b);
    const averageLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
    const p95Index = Math.floor(latencies.length * 0.95);
    const p99Index = Math.floor(latencies.length * 0.99);
    
    const totalResponseSize = this.results.reduce((sum, r) => sum + r.responseSize, 0);
    const throughputMBps = (totalResponseSize / 1024 / 1024) / (totalDuration / 1000);
    
    // Group errors
    const errorMap = new Map<string, number>();
    this.results.filter(r => !r.success).forEach(r => {
      const error = r.error || `HTTP ${r.status}`;
      errorMap.set(error, (errorMap.get(error) || 0) + 1);
    });
    
    const errors = Array.from(errorMap.entries()).map(([error, count]) => ({ error, count }));
    
    return {
      config: this.config,
      startTime: this.startTime,
      endTime: this.endTime,
      totalDuration,
      totalRequests: this.results.length,
      successfulRequests,
      failedRequests,
      averageLatency,
      p95Latency: latencies[p95Index] || 0,
      p99Latency: latencies[p99Index] || 0,
      requestsPerSecond: this.results.length / (totalDuration / 1000),
      errorRate: (failedRequests / this.results.length) * 100,
      throughputMBps,
      results: this.results,
      errors,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

async function runStressTest(): Promise<void> {
  const config: LoadTestConfig = {
    baseUrl: process.env.TEST_BASE_URL || 'http://localhost:3000',
    concurrentUsers: parseInt(process.env.CONCURRENT_USERS || '50'),
    requestsPerUser: parseInt(process.env.REQUESTS_PER_USER || '100'),
    rampUpTimeMs: parseInt(process.env.RAMP_UP_MS || '5000'),
    testDurationMs: parseInt(process.env.TEST_DURATION_MS || '60000'),
    endpoints: [
      {
        path: '/api/health',
        method: 'GET',
        weight: 2,
      },
      {
        path: '/api/portfolio/analyze',
        method: 'POST',
        weight: 8,
        payload: {
          address: '0x742d35Cc6643C0532925a3b8D50C20c6AF4e0b57',
          chain: 'ethereum',
        },
      },
      {
        path: '/api/portfolio/async',
        method: 'POST',
        weight: 6,
        payload: {
          address: '0x742d35Cc6643C0532925a3b8D50C20c6AF4e0b57',
          chain: 'ethereum',
          includePositions: true,
        },
      },
      {
        path: '/api/analytics/portfolio-summary',
        method: 'POST',
        weight: 5,
        payload: {
          addresses: ['0x742d35Cc6643C0532925a3b8D50C20c6AF4e0b57'],
          chain: 'ethereum',
        },
      },
      {
        path: '/api/defi/positions',
        method: 'POST',
        weight: 7,
        payload: {
          address: '0x742d35Cc6643C0532925a3b8D50C20c6AF4e0b57',
          chain: 'ethereum',
        },
      },
      {
        path: '/api/nft/collections',
        method: 'POST',
        weight: 4,
        payload: {
          address: '0x742d35Cc6643C0532925a3b8D50C20c6AF4e0b57',
          chain: 'ethereum',
        },
      },
    ],
  };

  const loadTester = new LoadTester(config);
  
  try {
    const report = await loadTester.runLoadTest();
    
    // Save report to file
    const reportPath = path.join(process.cwd(), 'load-test-reports');
    await fs.mkdir(reportPath, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFile = path.join(reportPath, `load-test-${timestamp}.json`);
    
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
    
    // Print summary
    console.log('\n📊 Load Test Results:');
    console.log(`Total Requests: ${report.totalRequests}`);
    console.log(`Successful: ${report.successfulRequests} (${((report.successfulRequests / report.totalRequests) * 100).toFixed(2)}%)`);
    console.log(`Failed: ${report.failedRequests} (${report.errorRate.toFixed(2)}%)`);
    console.log(`Duration: ${(report.totalDuration / 1000).toFixed(2)}s`);
    console.log(`Requests/sec: ${report.requestsPerSecond.toFixed(2)}`);
    console.log(`Average Latency: ${report.averageLatency.toFixed(2)}ms`);
    console.log(`P95 Latency: ${report.p95Latency.toFixed(2)}ms`);
    console.log(`P99 Latency: ${report.p99Latency.toFixed(2)}ms`);
    console.log(`Throughput: ${report.throughputMBps.toFixed(2)} MB/s`);
    
    if (report.errors.length > 0) {
      console.log('\n❌ Errors:');
      report.errors.forEach(({ error, count }) => {
        console.log(`  ${error}: ${count} occurrences`);
      });
    }
    
    console.log(`\n📄 Full report saved to: ${reportFile}`);
    
    // Performance thresholds
    const thresholds = {
      errorRate: 5, // 5%
      p95Latency: 5000, // 5 seconds
      minRequestsPerSecond: 10,
    };
    
    console.log('\n🎯 Performance Assessment:');
    
    if (report.errorRate > thresholds.errorRate) {
      console.log(`❌ Error rate ${report.errorRate.toFixed(2)}% exceeds threshold of ${thresholds.errorRate}%`);
    } else {
      console.log(`✅ Error rate ${report.errorRate.toFixed(2)}% within acceptable range`);
    }
    
    if (report.p95Latency > thresholds.p95Latency) {
      console.log(`❌ P95 latency ${report.p95Latency.toFixed(2)}ms exceeds threshold of ${thresholds.p95Latency}ms`);
    } else {
      console.log(`✅ P95 latency ${report.p95Latency.toFixed(2)}ms within acceptable range`);
    }
    
    if (report.requestsPerSecond < thresholds.minRequestsPerSecond) {
      console.log(`❌ Requests per second ${report.requestsPerSecond.toFixed(2)} below minimum of ${thresholds.minRequestsPerSecond}`);
    } else {
      console.log(`✅ Requests per second ${report.requestsPerSecond.toFixed(2)} meets performance requirements`);
    }
    
  } catch (error) {
    console.error('Load test failed:', error);
    process.exit(1);
  }
}

async function runMemoryStressTest(): Promise<void> {
  console.log('🧠 Starting memory stress test...');
  
  const config: LoadTestConfig = {
    baseUrl: process.env.TEST_BASE_URL || 'http://localhost:3000',
    concurrentUsers: 100,
    requestsPerUser: 1000,
    rampUpTimeMs: 1000,
    testDurationMs: 300000, // 5 minutes
    endpoints: [
      {
        path: '/api/portfolio/analyze',
        method: 'POST',
        weight: 10,
        payload: {
          address: '0x742d35Cc6643C0532925a3b8D50C20c6AF4e0b57',
          chain: 'ethereum',
          deep: true, // Force deep analysis
        },
      },
    ],
  };
  
  const loadTester = new LoadTester(config);
  await loadTester.runLoadTest();
}

async function runSpikeTest(): Promise<void> {
  console.log('⚡ Starting spike test...');
  
  const config: LoadTestConfig = {
    baseUrl: process.env.TEST_BASE_URL || 'http://localhost:3000',
    concurrentUsers: 500, // Sudden spike
    requestsPerUser: 10,
    rampUpTimeMs: 0, // No ramp up - immediate spike
    testDurationMs: 30000,
    endpoints: [
      {
        path: '/api/health',
        method: 'GET',
        weight: 5,
      },
      {
        path: '/api/portfolio/analyze',
        method: 'POST',
        weight: 5,
        payload: {
          address: '0x742d35Cc6643C0532925a3b8D50C20c6AF4e0b57',
          chain: 'ethereum',
        },
      },
    ],
  };
  
  const loadTester = new LoadTester(config);
  await loadTester.runLoadTest();
}

// CLI interface
if (require.main === module) {
  const testType = process.argv[2] || 'stress';
  
  switch (testType) {
    case 'stress':
      runStressTest();
      break;
    case 'memory':
      runMemoryStressTest();
      break;
    case 'spike':
      runSpikeTest();
      break;
    default:
      console.log('Usage: tsx scripts/load-test.ts [stress|memory|spike]');
      process.exit(1);
  }
}

export { LoadTester, LoadTestConfig, LoadTestReport };
