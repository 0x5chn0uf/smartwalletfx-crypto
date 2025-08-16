#!/usr/bin/env tsx
/**
 * Enhanced Load Testing Suite for Phase 3
 * Comprehensive testing for portfolio, DeFi, and NFT endpoints
 * Tests performance under various load patterns with provider resilience testing
 */

import { performance } from 'perf_hooks';
import { Worker } from 'worker_threads';
import { randomUUID } from 'crypto';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';

interface LoadTestConfig {
  baseUrl: string;
  scenarios: LoadTestScenario[];
  globalSettings: {
    maxConcurrentUsers: number;
    testDurationMs: number;
    rampUpTimeMs: number;
    cooldownTimeMs: number;
  };
  thresholds: PerformanceThresholds;
  memoryMonitoring: boolean;
  providerFailureSimulation: boolean;
}

interface LoadTestScenario {
  name: string;
  description: string;
  weight: number; // Probability of selection (1-10)
  endpoints: TestEndpoint[];
  userBehavior: {
    thinkTimeMs: number;
    requestsPerSession: number;
    sessionDurationMs: number;
  };
  concurrentUsers: number;
}

interface TestEndpoint {
  path: string;
  method: 'GET' | 'POST';
  weight: number;
  payload?: any;
  headers?: Record<string, string>;
  expectedStatusCodes: number[];
  timeout: number;
  category: 'portfolio' | 'defi' | 'nft' | 'health' | 'analytics';
}

interface PerformanceThresholds {
  errorRate: number; // Max percentage
  p95Latency: number; // Max milliseconds
  p99Latency: number; // Max milliseconds
  avgLatency: number; // Max milliseconds
  minRequestsPerSecond: number;
  maxMemoryUsageMB: number;
  maxCpuUsagePercent: number;
}

interface TestResult {
  endpoint: string;
  method: string;
  category: string;
  scenario: string;
  startTime: number;
  endTime: number;
  duration: number;
  status: number;
  success: boolean;
  error?: string;
  responseSize: number;
  userId: string;
  sessionId: string;
}

interface SystemMetrics {
  timestamp: number;
  cpuUsage: NodeJS.CpuUsage;
  memoryUsage: NodeJS.MemoryUsage;
  memoryUsageMB: number;
  activeConnections: number;
  eventLoopDelay?: number;
}

interface LoadTestReport {
  config: LoadTestConfig;
  startTime: number;
  endTime: number;
  totalDuration: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  metrics: {
    overall: PerformanceMetrics;
    byCategory: Record<string, PerformanceMetrics>;
    byScenario: Record<string, PerformanceMetrics>;
    byEndpoint: Record<string, PerformanceMetrics>;
  };
  systemMetrics: SystemMetrics[];
  thresholdViolations: ThresholdViolation[];
  recommendations: string[];
  results: TestResult[];
}

interface PerformanceMetrics {
  requestCount: number;
  errorRate: number;
  avgLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  maxLatency: number;
  minLatency: number;
  requestsPerSecond: number;
  throughputMBps: number;
}

interface ThresholdViolation {
  metric: string;
  actual: number;
  threshold: number;
  severity: 'warning' | 'critical';
  timestamp: number;
}

class EnhancedLoadTester extends EventEmitter {
  private config: LoadTestConfig;
  private results: TestResult[] = [];
  private systemMetrics: SystemMetrics[] = [];
  private startTime: number = 0;
  private endTime: number = 0;
  private monitoringInterval?: NodeJS.Timeout;
  private activeUsers = new Map<string, { sessionId: string; scenario: string; requestCount: number }>();

  constructor(config: LoadTestConfig) {
    super();
    this.config = config;
  }

  async runLoadTest(): Promise<LoadTestReport> {
    console.log('🚀 Starting Enhanced Load Test for Phase 3...');
    console.log(`Scenarios: ${this.config.scenarios.length}`);
    console.log(`Max Concurrent Users: ${this.config.globalSettings.maxConcurrentUsers}`);
    console.log(`Test Duration: ${this.config.globalSettings.testDurationMs / 1000}s`);
    
    this.startTime = performance.now();
    this.startSystemMonitoring();
    
    // Start baseline measurement
    await this.measureBaseline();
    
    // Execute test scenarios
    const scenarioPromises: Promise<void>[] = [];
    
    for (const scenario of this.config.scenarios) {
      const promise = this.executeScenario(scenario);
      scenarioPromises.push(promise);
      
      // Stagger scenario starts
      await this.sleep(this.config.globalSettings.rampUpTimeMs / this.config.scenarios.length);
    }
    
    // Wait for all scenarios to complete or timeout
    await Promise.race([
      Promise.all(scenarioPromises),
      this.sleep(this.config.globalSettings.testDurationMs)
    ]);
    
    // Cooldown period
    console.log('💤 Cooldown period...');
    await this.sleep(this.config.globalSettings.cooldownTimeMs);
    
    this.stopSystemMonitoring();
    this.endTime = performance.now();
    
    return this.generateReport();
  }

  private async measureBaseline(): Promise<void> {
    console.log('📊 Measuring baseline performance...');
    
    // Single request to each endpoint category to establish baseline
    const baselineEndpoints = [
      { path: '/api/health', method: 'GET' as const, category: 'health' as const },
      { path: '/api/portfolio/0x742d35Cc6643C0532925a3b8D50C20c6AF4e0b57', method: 'GET' as const, category: 'portfolio' as const },
    ];
    
    for (const endpoint of baselineEndpoints) {
      try {
        const start = performance.now();
        const response = await fetch(`${this.config.baseUrl}${endpoint.path}`, {
          method: endpoint.method,
          timeout: 30000
        });
        const end = performance.now();
        
        console.log(`  ${endpoint.category}: ${(end - start).toFixed(2)}ms (${response.status})`);
      } catch (error) {
        console.warn(`  ${endpoint.category}: Failed - ${error}`);
      }
    }
  }

  private async executeScenario(scenario: LoadTestScenario): Promise<void> {
    console.log(`🎭 Starting scenario: ${scenario.name}`);
    
    const userPromises: Promise<void>[] = [];
    
    for (let i = 0; i < scenario.concurrentUsers; i++) {
      const userId = `${scenario.name}-user-${i}`;
      const sessionId = randomUUID();
      
      this.activeUsers.set(userId, {
        sessionId,
        scenario: scenario.name,
        requestCount: 0
      });
      
      const userPromise = this.simulateUser(userId, sessionId, scenario);
      userPromises.push(userPromise);
      
      // Ramp up users gradually
      if (i > 0 && i % 10 === 0) {
        await this.sleep(100);
      }
    }
    
    await Promise.all(userPromises);
    console.log(`✅ Scenario completed: ${scenario.name}`);
  }

  private async simulateUser(userId: string, sessionId: string, scenario: LoadTestScenario): Promise<void> {
    const sessionStart = performance.now();
    const userState = this.activeUsers.get(userId)!;
    
    while (
      performance.now() - sessionStart < scenario.userBehavior.sessionDurationMs &&
      userState.requestCount < scenario.userBehavior.requestsPerSession
    ) {
      const endpoint = this.selectRandomEndpoint(scenario.endpoints);
      const result = await this.makeRequest(endpoint, userId, sessionId, scenario.name);
      
      this.results.push(result);
      userState.requestCount++;
      
      // Provider failure simulation
      if (this.config.providerFailureSimulation && Math.random() < 0.02) {
        await this.simulateProviderDelay();
      }
      
      // Think time between requests
      await this.sleep(scenario.userBehavior.thinkTimeMs + Math.random() * 200);
    }
    
    this.activeUsers.delete(userId);
  }

  private selectRandomEndpoint(endpoints: TestEndpoint[]): TestEndpoint {
    const totalWeight = endpoints.reduce((sum, ep) => sum + ep.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const endpoint of endpoints) {
      random -= endpoint.weight;
      if (random <= 0) {
        return endpoint;
      }
    }
    
    return endpoints[0];
  }

  private async makeRequest(
    endpoint: TestEndpoint,
    userId: string,
    sessionId: string,
    scenario: string
  ): Promise<TestResult> {
    const startTime = performance.now();
    const url = `${this.config.baseUrl}${endpoint.path}`;
    
    try {
      const requestOptions: any = {
        method: endpoint.method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `EnhancedLoadTester/${userId}`,
          'X-Session-ID': sessionId,
          'X-Scenario': scenario,
          ...endpoint.headers,
        },
        timeout: endpoint.timeout,
      };
      
      if (endpoint.payload && endpoint.method === 'POST') {
        requestOptions.body = JSON.stringify(endpoint.payload);
      }
      
      const response = await fetch(url, requestOptions);
      const responseText = await response.text();
      const endTime = performance.now();
      
      const success = endpoint.expectedStatusCodes.includes(response.status);
      
      return {
        endpoint: endpoint.path,
        method: endpoint.method,
        category: endpoint.category,
        scenario,
        startTime,
        endTime,
        duration: endTime - startTime,
        status: response.status,
        success,
        responseSize: responseText.length,
        userId,
        sessionId,
      };
    } catch (error) {
      const endTime = performance.now();
      return {
        endpoint: endpoint.path,
        method: endpoint.method,
        category: endpoint.category,
        scenario,
        startTime,
        endTime,
        duration: endTime - startTime,
        status: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        responseSize: 0,
        userId,
        sessionId,
      };
    }
  }

  private async simulateProviderDelay(): Promise<void> {
    // Simulate external provider delays/failures
    const delayMs = 1000 + Math.random() * 4000; // 1-5 second delay
    await this.sleep(delayMs);
  }

  private startSystemMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      const metrics: SystemMetrics = {
        timestamp: performance.now(),
        cpuUsage: process.cpuUsage(),
        memoryUsage: process.memoryUsage(),
        memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        activeConnections: this.activeUsers.size,
      };
      
      this.systemMetrics.push(metrics);
      
      // Real-time threshold checking
      this.checkThresholds(metrics);
    }, 1000);
  }

  private stopSystemMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
  }

  private checkThresholds(metrics: SystemMetrics): void {
    const thresholds = this.config.thresholds;
    
    if (metrics.memoryUsageMB > thresholds.maxMemoryUsageMB) {
      this.emit('threshold-violation', {
        metric: 'memoryUsage',
        actual: metrics.memoryUsageMB,
        threshold: thresholds.maxMemoryUsageMB,
        severity: 'warning',
        timestamp: metrics.timestamp,
      });
    }
  }

  private calculateMetrics(results: TestResult[]): PerformanceMetrics {
    if (results.length === 0) {
      return {
        requestCount: 0,
        errorRate: 0,
        avgLatency: 0,
        p50Latency: 0,
        p95Latency: 0,
        p99Latency: 0,
        maxLatency: 0,
        minLatency: 0,
        requestsPerSecond: 0,
        throughputMBps: 0,
      };
    }
    
    const successfulResults = results.filter(r => r.success);
    const latencies = results.map(r => r.duration).sort((a, b) => a - b);
    const totalDuration = this.endTime - this.startTime;
    
    const p50Index = Math.floor(latencies.length * 0.5);
    const p95Index = Math.floor(latencies.length * 0.95);
    const p99Index = Math.floor(latencies.length * 0.99);
    
    const totalResponseSize = results.reduce((sum, r) => sum + r.responseSize, 0);
    
    return {
      requestCount: results.length,
      errorRate: ((results.length - successfulResults.length) / results.length) * 100,
      avgLatency: latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length,
      p50Latency: latencies[p50Index] || 0,
      p95Latency: latencies[p95Index] || 0,
      p99Latency: latencies[p99Index] || 0,
      maxLatency: Math.max(...latencies),
      minLatency: Math.min(...latencies),
      requestsPerSecond: results.length / (totalDuration / 1000),
      throughputMBps: (totalResponseSize / 1024 / 1024) / (totalDuration / 1000),
    };
  }

  private generateReport(): LoadTestReport {
    const totalDuration = this.endTime - this.startTime;
    const overallMetrics = this.calculateMetrics(this.results);
    
    // Calculate metrics by category
    const categories = ['portfolio', 'defi', 'nft', 'health', 'analytics'];
    const byCategory: Record<string, PerformanceMetrics> = {};
    categories.forEach(category => {
      const categoryResults = this.results.filter(r => r.category === category);
      byCategory[category] = this.calculateMetrics(categoryResults);
    });
    
    // Calculate metrics by scenario
    const scenarios = [...new Set(this.results.map(r => r.scenario))];
    const byScenario: Record<string, PerformanceMetrics> = {};
    scenarios.forEach(scenario => {
      const scenarioResults = this.results.filter(r => r.scenario === scenario);
      byScenario[scenario] = this.calculateMetrics(scenarioResults);
    });
    
    // Calculate metrics by endpoint
    const endpoints = [...new Set(this.results.map(r => r.endpoint))];
    const byEndpoint: Record<string, PerformanceMetrics> = {};
    endpoints.forEach(endpoint => {
      const endpointResults = this.results.filter(r => r.endpoint === endpoint);
      byEndpoint[endpoint] = this.calculateMetrics(endpointResults);
    });
    
    // Check threshold violations
    const thresholdViolations = this.checkFinalThresholds(overallMetrics);
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(overallMetrics, byCategory);
    
    return {
      config: this.config,
      startTime: this.startTime,
      endTime: this.endTime,
      totalDuration,
      totalRequests: this.results.length,
      successfulRequests: this.results.filter(r => r.success).length,
      failedRequests: this.results.filter(r => !r.success).length,
      metrics: {
        overall: overallMetrics,
        byCategory,
        byScenario,
        byEndpoint,
      },
      systemMetrics: this.systemMetrics,
      thresholdViolations,
      recommendations,
      results: this.results,
    };
  }

  private checkFinalThresholds(metrics: PerformanceMetrics): ThresholdViolation[] {
    const violations: ThresholdViolation[] = [];
    const thresholds = this.config.thresholds;
    const timestamp = performance.now();
    
    if (metrics.errorRate > thresholds.errorRate) {
      violations.push({
        metric: 'errorRate',
        actual: metrics.errorRate,
        threshold: thresholds.errorRate,
        severity: 'critical',
        timestamp,
      });
    }
    
    if (metrics.p95Latency > thresholds.p95Latency) {
      violations.push({
        metric: 'p95Latency',
        actual: metrics.p95Latency,
        threshold: thresholds.p95Latency,
        severity: 'critical',
        timestamp,
      });
    }
    
    if (metrics.requestsPerSecond < thresholds.minRequestsPerSecond) {
      violations.push({
        metric: 'requestsPerSecond',
        actual: metrics.requestsPerSecond,
        threshold: thresholds.minRequestsPerSecond,
        severity: 'warning',
        timestamp,
      });
    }
    
    return violations;
  }

  private generateRecommendations(overall: PerformanceMetrics, byCategory: Record<string, PerformanceMetrics>): string[] {
    const recommendations: string[] = [];
    
    if (overall.errorRate > 1) {
      recommendations.push('High error rate detected. Check error logs and provider connectivity.');
    }
    
    if (overall.p95Latency > 5000) {
      recommendations.push('High P95 latency. Consider optimizing slow endpoints or adding caching.');
    }
    
    if (byCategory.portfolio?.p95Latency > 3000) {
      recommendations.push('Portfolio endpoints are slow. Consider implementing async processing.');
    }
    
    if (byCategory.defi?.errorRate > 5) {
      recommendations.push('DeFi endpoints have high error rates. Check provider integrations.');
    }
    
    if (overall.requestsPerSecond < 50) {
      recommendations.push('Low throughput detected. Consider scaling horizontally or optimizing database queries.');
    }
    
    const maxMemoryUsage = Math.max(...this.systemMetrics.map(m => m.memoryUsageMB));
    if (maxMemoryUsage > 512) {
      recommendations.push('High memory usage detected. Check for memory leaks and optimize memory allocation.');
    }
    
    return recommendations;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Phase 3 Load Test Configurations
const PHASE_3_SCENARIOS: LoadTestScenario[] = [
  {
    name: 'NormalTraffic',
    description: 'Typical user behavior with mixed endpoint usage',
    weight: 6,
    endpoints: [
      {
        path: '/api/health',
        method: 'GET',
        weight: 2,
        expectedStatusCodes: [200],
        timeout: 5000,
        category: 'health',
      },
      {
        path: '/api/portfolio/0x742d35Cc6643C0532925a3b8D50C20c6AF4e0b57',
        method: 'GET',
        weight: 5,
        expectedStatusCodes: [200],
        timeout: 30000,
        category: 'portfolio',
      },
      {
        path: '/api/defi/0x742d35Cc6643C0532925a3b8D50C20c6AF4e0b57',
        method: 'GET',
        weight: 4,
        expectedStatusCodes: [200],
        timeout: 25000,
        category: 'defi',
      },
      {
        path: '/api/nft/0x742d35Cc6643C0532925a3b8D50C20c6AF4e0b57',
        method: 'GET',
        weight: 3,
        expectedStatusCodes: [200],
        timeout: 20000,
        category: 'nft',
      },
    ],
    userBehavior: {
      thinkTimeMs: 2000,
      requestsPerSession: 15,
      sessionDurationMs: 120000, // 2 minutes
    },
    concurrentUsers: 50,
  },
  {
    name: 'BurstTraffic',
    description: 'High-intensity burst traffic simulating viral growth',
    weight: 3,
    endpoints: [
      {
        path: '/api/portfolio/0x742d35Cc6643C0532925a3b8D50C20c6AF4e0b57',
        method: 'GET',
        weight: 8,
        expectedStatusCodes: [200],
        timeout: 30000,
        category: 'portfolio',
      },
      {
        path: '/api/portfolio/0x742d35Cc6643C0532925a3b8D50C20c6AF4e0b57/summary',
        method: 'GET',
        weight: 5,
        expectedStatusCodes: [200],
        timeout: 15000,
        category: 'portfolio',
      },
    ],
    userBehavior: {
      thinkTimeMs: 500,
      requestsPerSession: 25,
      sessionDurationMs: 60000, // 1 minute
    },
    concurrentUsers: 200,
  },
  {
    name: 'SustainedLoad',
    description: 'Long-duration sustained load testing',
    weight: 4,
    endpoints: [
      {
        path: '/api/portfolio/0x742d35Cc6643C0532925a3b8D50C20c6AF4e0b57',
        method: 'GET',
        weight: 4,
        expectedStatusCodes: [200],
        timeout: 30000,
        category: 'portfolio',
      },
      {
        path: '/api/defi/0x742d35Cc6643C0532925a3b8D50C20c6AF4e0b57',
        method: 'GET',
        weight: 4,
        expectedStatusCodes: [200],
        timeout: 25000,
        category: 'defi',
      },
      {
        path: '/api/nft/0x742d35Cc6643C0532925a3b8D50C20c6AF4e0b57',
        method: 'GET',
        weight: 3,
        expectedStatusCodes: [200],
        timeout: 20000,
        category: 'nft',
      },
      {
        path: '/api/health',
        method: 'GET',
        weight: 1,
        expectedStatusCodes: [200],
        timeout: 5000,
        category: 'health',
      },
    ],
    userBehavior: {
      thinkTimeMs: 3000,
      requestsPerSession: 50,
      sessionDurationMs: 300000, // 5 minutes
    },
    concurrentUsers: 100,
  },
];

const DEFAULT_CONFIG: LoadTestConfig = {
  baseUrl: process.env.TEST_BASE_URL || 'http://localhost:3000',
  scenarios: PHASE_3_SCENARIOS,
  globalSettings: {
    maxConcurrentUsers: 500,
    testDurationMs: 300000, // 5 minutes
    rampUpTimeMs: 30000, // 30 seconds
    cooldownTimeMs: 10000, // 10 seconds
  },
  thresholds: {
    errorRate: 5, // 5%
    p95Latency: 5000, // 5 seconds
    p99Latency: 10000, // 10 seconds
    avgLatency: 2000, // 2 seconds
    minRequestsPerSecond: 20,
    maxMemoryUsageMB: 512,
    maxCpuUsagePercent: 80,
  },
  memoryMonitoring: true,
  providerFailureSimulation: true,
};

// CLI Functions
async function runPhase3LoadTest(): Promise<void> {
  const config = { ...DEFAULT_CONFIG };
  
  // Override with environment variables
  if (process.env.CONCURRENT_USERS) {
    config.globalSettings.maxConcurrentUsers = parseInt(process.env.CONCURRENT_USERS);
  }
  
  if (process.env.TEST_DURATION_MS) {
    config.globalSettings.testDurationMs = parseInt(process.env.TEST_DURATION_MS);
  }
  
  if (process.env.P95_THRESHOLD_MS) {
    config.thresholds.p95Latency = parseInt(process.env.P95_THRESHOLD_MS);
  }
  
  const loadTester = new EnhancedLoadTester(config);
  
  // Set up event listeners
  loadTester.on('threshold-violation', (violation) => {
    console.warn(`⚠️  Threshold violation: ${violation.metric} = ${violation.actual} (threshold: ${violation.threshold})`);
  });
  
  try {
    const report = await loadTester.runLoadTest();
    
    // Save detailed report
    const reportPath = path.join(process.cwd(), 'scripts', 'load-test-reports');
    await fs.mkdir(reportPath, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFile = path.join(reportPath, `phase3-load-test-${timestamp}.json`);
    
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
    
    // Print executive summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 PHASE 3 LOAD TEST RESULTS');
    console.log('='.repeat(80));
    
    console.log(`\n🎯 Overall Performance:`);
    console.log(`   Total Requests: ${report.totalRequests.toLocaleString()}`);
    console.log(`   Success Rate: ${((report.successfulRequests / report.totalRequests) * 100).toFixed(2)}%`);
    console.log(`   Error Rate: ${report.metrics.overall.errorRate.toFixed(2)}%`);
    console.log(`   Duration: ${(report.totalDuration / 1000).toFixed(2)}s`);
    console.log(`   Throughput: ${report.metrics.overall.requestsPerSecond.toFixed(2)} RPS`);
    
    console.log(`\n⏱️  Latency Metrics:`);
    console.log(`   Average: ${report.metrics.overall.avgLatency.toFixed(2)}ms`);
    console.log(`   P95: ${report.metrics.overall.p95Latency.toFixed(2)}ms`);
    console.log(`   P99: ${report.metrics.overall.p99Latency.toFixed(2)}ms`);
    console.log(`   Max: ${report.metrics.overall.maxLatency.toFixed(2)}ms`);
    
    console.log(`\n📈 Performance by Category:`);
    Object.entries(report.metrics.byCategory).forEach(([category, metrics]) => {
      if (metrics.requestCount > 0) {
        console.log(`   ${category.toUpperCase()}: ${metrics.requestCount} req, ${metrics.p95Latency.toFixed(2)}ms P95, ${metrics.errorRate.toFixed(2)}% errors`);
      }
    });
    
    console.log(`\n🔧 System Metrics:`);
    const maxMemory = Math.max(...report.systemMetrics.map(m => m.memoryUsageMB));
    const avgMemory = report.systemMetrics.reduce((sum, m) => sum + m.memoryUsageMB, 0) / report.systemMetrics.length;
    console.log(`   Peak Memory: ${maxMemory}MB`);
    console.log(`   Avg Memory: ${avgMemory.toFixed(2)}MB`);
    
    // Threshold violations
    if (report.thresholdViolations.length > 0) {
      console.log(`\n❌ Threshold Violations:`);
      report.thresholdViolations.forEach(violation => {
        console.log(`   ${violation.metric}: ${violation.actual} > ${violation.threshold} (${violation.severity})`);
      });
    } else {
      console.log(`\n✅ All thresholds met!`);
    }
    
    // Recommendations
    if (report.recommendations.length > 0) {
      console.log(`\n💡 Recommendations:`);
      report.recommendations.forEach((rec, i) => {
        console.log(`   ${i + 1}. ${rec}`);
      });
    }
    
    // PRD Compliance Check
    console.log(`\n🎯 PRD Compliance Check:`);
    const p95Regression = (report.metrics.overall.p95Latency / config.thresholds.p95Latency) * 100;
    if (p95Regression <= 110) { // Within 10% regression tolerance
      console.log(`   ✅ P95 latency regression: ${p95Regression.toFixed(1)}% (within 10% tolerance)`);
    } else {
      console.log(`   ❌ P95 latency regression: ${p95Regression.toFixed(1)}% (exceeds 10% tolerance)`);
    }
    
    console.log(`\n📄 Full report saved to: ${reportFile}`);
    console.log('='.repeat(80));
    
    // Exit with appropriate code
    if (report.thresholdViolations.some(v => v.severity === 'critical')) {
      console.log('\n❌ Load test failed due to critical threshold violations');
      process.exit(1);
    } else if (report.thresholdViolations.length > 0) {
      console.log('\n⚠️  Load test completed with warnings');
      process.exit(2);
    } else {
      console.log('\n✅ Load test passed all thresholds');
      process.exit(0);
    }
    
  } catch (error) {
    console.error('❌ Load test failed:', error);
    process.exit(1);
  }
}

// CLI interface
if (require.main === module) {
  runPhase3LoadTest();
}

export { EnhancedLoadTester, LoadTestConfig, LoadTestReport };
