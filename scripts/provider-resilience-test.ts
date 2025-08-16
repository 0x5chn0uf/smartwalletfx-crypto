#!/usr/bin/env tsx
/**
 * Provider Resilience Testing Suite
 * Tests API behavior when external providers fail or are slow
 */

import { performance } from 'perf_hooks';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

interface ProviderFailureScenario {
  name: string;
  description: string;
  duration: number; // Test duration in ms
  failurePattern: 'timeout' | 'error' | 'slowResponse' | 'rateLimited' | 'intermittent';
  severity: 'low' | 'medium' | 'high';
  expectedBehavior: string;
}

interface ResilienceTestConfig {
  baseUrl: string;
  testEndpoints: Array<{
    path: string;
    method: 'GET' | 'POST';
    payload?: any;
    category: string;
    timeout: number;
  }>;
  scenarios: ProviderFailureScenario[];
  concurrent: number;
  requestsPerSecond: number;
}

interface ResilienceTestResult {
  scenario: string;
  endpoint: string;
  startTime: number;
  endTime: number;
  duration: number;
  status: number;
  success: boolean;
  error?: string;
  responseTime: number;
  cacheHit?: boolean;
  fallbackUsed?: boolean;
}

interface ResilienceReport {
  config: ResilienceTestConfig;
  testStartTime: number;
  testEndTime: number;
  totalDuration: number;
  results: ResilienceTestResult[];
  summary: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageResponseTime: number;
    cacheHitRate: number;
    fallbackUsageRate: number;
    resilienceScore: number; // 0-100
  };
  scenarioAnalysis: Record<string, {
    requestCount: number;
    successRate: number;
    averageResponseTime: number;
    degradationFactor: number;
    recommendation: string;
  }>;
}

class ProviderResilienceTester {
  private config: ResilienceTestConfig;
  private results: ResilienceTestResult[] = [];
  private baselineMetrics = new Map<string, number>();

  constructor(config: ResilienceTestConfig) {
    this.config = config;
  }

  async runResilienceTest(): Promise<ResilienceReport> {
    console.log('🛡️ Starting Provider Resilience Test...');
    
    // Establish baseline performance
    await this.measureBaseline();
    
    const testStartTime = performance.now();
    
    // Run each failure scenario
    for (const scenario of this.config.scenarios) {
      console.log(`🔥 Testing scenario: ${scenario.name}`);
      await this.runFailureScenario(scenario);
      
      // Recovery period between scenarios
      console.log('⏳ Recovery period...');
      await this.sleep(5000);
    }
    
    const testEndTime = performance.now();
    
    return this.generateResilienceReport(testStartTime, testEndTime);
  }

  private async measureBaseline(): Promise<void> {
    console.log('📊 Measuring baseline performance...');
    
    for (const endpoint of this.config.testEndpoints) {
      const times: number[] = [];
      
      // Take 5 baseline measurements
      for (let i = 0; i < 5; i++) {
        try {
          const start = performance.now();
          const response = await this.makeRequest(endpoint, 'baseline');
          const end = performance.now();
          
          if (response.success) {
            times.push(end - start);
          }
          
          await this.sleep(500); // Brief pause between baseline requests
        } catch (error) {
          console.warn(`Baseline measurement failed for ${endpoint.path}:`, error);
        }
      }
      
      if (times.length > 0) {
        const avgTime = times.reduce((sum, time) => sum + time, 0) / times.length;
        this.baselineMetrics.set(endpoint.path, avgTime);
        console.log(`  ${endpoint.path}: ${avgTime.toFixed(2)}ms baseline`);\n      } else {\n        console.warn(`  ${endpoint.path}: No successful baseline measurements`);\n      }\n    }\n  }\n\n  private async runFailureScenario(scenario: ProviderFailureScenario): Promise<void> {\n    const scenarioStart = performance.now();\n    const scenarioEnd = scenarioStart + scenario.duration;\n    \n    const requests: Promise<void>[] = [];\n    \n    // Start concurrent requests according to configured RPS\n    const requestInterval = 1000 / this.config.requestsPerSecond;\n    \n    while (performance.now() < scenarioEnd) {\n      for (let i = 0; i < this.config.concurrent && performance.now() < scenarioEnd; i++) {\n        const endpoint = this.selectRandomEndpoint();\n        const requestPromise = this.makeFailureAwareRequest(endpoint, scenario);\n        requests.push(requestPromise);\n      }\n      \n      await this.sleep(requestInterval);\n    }\n    \n    // Wait for all requests to complete\n    await Promise.allSettled(requests);\n    \n    console.log(`  Completed ${requests.length} requests in scenario: ${scenario.name}`);\n  }\n\n  private selectRandomEndpoint() {\n    const randomIndex = Math.floor(Math.random() * this.config.testEndpoints.length);\n    return this.config.testEndpoints[randomIndex];\n  }\n\n  private async makeFailureAwareRequest(\n    endpoint: any,\n    scenario: ProviderFailureScenario\n  ): Promise<void> {\n    try {\n      const result = await this.makeRequest(endpoint, scenario.name);\n      this.results.push(result);\n    } catch (error) {\n      // Handle request failures gracefully\n      this.results.push({\n        scenario: scenario.name,\n        endpoint: endpoint.path,\n        startTime: performance.now(),\n        endTime: performance.now(),\n        duration: 0,\n        status: 0,\n        success: false,\n        error: error instanceof Error ? error.message : String(error),\n        responseTime: 0,\n      });\n    }\n  }\n\n  private async makeRequest(\n    endpoint: any,\n    scenario: string\n  ): Promise<ResilienceTestResult> {\n    const startTime = performance.now();\n    \n    try {\n      const requestOptions: any = {\n        method: endpoint.method,\n        headers: {\n          'Content-Type': 'application/json',\n          'User-Agent': `ResilienceTester/${scenario}`,\n          'X-Test-Scenario': scenario,\n        },\n        timeout: endpoint.timeout,\n      };\n      \n      if (endpoint.payload && endpoint.method === 'POST') {\n        requestOptions.body = JSON.stringify(endpoint.payload);\n      }\n      \n      const response = await fetch(`${this.config.baseUrl}${endpoint.path}`, requestOptions);\n      const responseText = await response.text();\n      const endTime = performance.now();\n      \n      // Parse response headers for cache and fallback information\n      const cacheHit = response.headers.get('X-Cache-Status') === 'HIT';\n      const fallbackUsed = response.headers.get('X-Fallback-Used') === 'true';\n      \n      return {\n        scenario,\n        endpoint: endpoint.path,\n        startTime,\n        endTime,\n        duration: endTime - startTime,\n        status: response.status,\n        success: response.ok,\n        responseTime: endTime - startTime,\n        cacheHit,\n        fallbackUsed,\n      };\n    } catch (error) {\n      const endTime = performance.now();\n      return {\n        scenario,\n        endpoint: endpoint.path,\n        startTime,\n        endTime,\n        duration: endTime - startTime,\n        status: 0,\n        success: false,\n        error: error instanceof Error ? error.message : String(error),\n        responseTime: endTime - startTime,\n      };\n    }\n  }\n\n  private generateResilienceReport(\n    testStartTime: number,\n    testEndTime: number\n  ): ResilienceReport {\n    const totalDuration = testEndTime - testStartTime;\n    const totalRequests = this.results.length;\n    const successfulRequests = this.results.filter(r => r.success).length;\n    const failedRequests = totalRequests - successfulRequests;\n    \n    const responseTimes = this.results.filter(r => r.success).map(r => r.responseTime);\n    const averageResponseTime = responseTimes.length > 0 \n      ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length \n      : 0;\n    \n    const cacheHits = this.results.filter(r => r.cacheHit).length;\n    const cacheHitRate = totalRequests > 0 ? (cacheHits / totalRequests) * 100 : 0;\n    \n    const fallbackUsage = this.results.filter(r => r.fallbackUsed).length;\n    const fallbackUsageRate = totalRequests > 0 ? (fallbackUsage / totalRequests) * 100 : 0;\n    \n    // Calculate resilience score (0-100)\n    const resilienceScore = this.calculateResilienceScore(\n      successfulRequests / totalRequests,\n      averageResponseTime,\n      cacheHitRate,\n      fallbackUsageRate\n    );\n    \n    // Analyze each scenario\n    const scenarioAnalysis: Record<string, any> = {};\n    const scenarios = [...new Set(this.results.map(r => r.scenario))];\n    \n    scenarios.forEach(scenario => {\n      const scenarioResults = this.results.filter(r => r.scenario === scenario);\n      const scenarioSuccessRate = scenarioResults.filter(r => r.success).length / scenarioResults.length;\n      const scenarioAvgResponseTime = scenarioResults\n        .filter(r => r.success)\n        .reduce((sum, r) => sum + r.responseTime, 0) / scenarioResults.filter(r => r.success).length || 0;\n      \n      // Calculate degradation factor compared to baseline\n      const endpointBaselines = [...new Set(scenarioResults.map(r => r.endpoint))]\n        .map(endpoint => this.baselineMetrics.get(endpoint) || 0)\n        .filter(baseline => baseline > 0);\n      \n      const avgBaseline = endpointBaselines.length > 0 \n        ? endpointBaselines.reduce((sum, baseline) => sum + baseline, 0) / endpointBaselines.length\n        : 1;\n      \n      const degradationFactor = scenarioAvgResponseTime / avgBaseline;\n      \n      scenarioAnalysis[scenario] = {\n        requestCount: scenarioResults.length,\n        successRate: scenarioSuccessRate * 100,\n        averageResponseTime: scenarioAvgResponseTime,\n        degradationFactor,\n        recommendation: this.generateScenarioRecommendation(scenario, scenarioSuccessRate, degradationFactor),\n      };\n    });\n    \n    return {\n      config: this.config,\n      testStartTime,\n      testEndTime,\n      totalDuration,\n      results: this.results,\n      summary: {\n        totalRequests,\n        successfulRequests,\n        failedRequests,\n        averageResponseTime,\n        cacheHitRate,\n        fallbackUsageRate,\n        resilienceScore,\n      },\n      scenarioAnalysis,\n    };\n  }\n\n  private calculateResilienceScore(\n    successRate: number,\n    avgResponseTime: number,\n    cacheHitRate: number,\n    fallbackUsageRate: number\n  ): number {\n    // Weighted scoring algorithm\n    const successWeight = 40; // 40% weight on success rate\n    const performanceWeight = 30; // 30% weight on performance (inverse of response time)\n    const cacheWeight = 15; // 15% weight on cache effectiveness\n    const fallbackWeight = 15; // 15% weight on fallback usage\n    \n    const successScore = successRate * successWeight;\n    \n    // Performance score (inverse relationship with response time)\n    const performanceScore = Math.max(0, (5000 - avgResponseTime) / 5000) * performanceWeight;\n    \n    const cacheScore = (cacheHitRate / 100) * cacheWeight;\n    const fallbackScore = (fallbackUsageRate / 100) * fallbackWeight;\n    \n    return Math.min(100, successScore + performanceScore + cacheScore + fallbackScore);\n  }\n\n  private generateScenarioRecommendation(\n    scenario: string,\n    successRate: number,\n    degradationFactor: number\n  ): string {\n    if (successRate < 0.5) {\n      return `Critical: ${scenario} causes severe failures. Implement circuit breakers and better error handling.`;\n    }\n    \n    if (degradationFactor > 5) {\n      return `High: ${scenario} causes significant performance degradation. Consider request timeouts and caching improvements.`;\n    }\n    \n    if (degradationFactor > 2) {\n      return `Medium: ${scenario} impacts performance. Monitor provider health and implement retry logic.`;\n    }\n    \n    return `Low: ${scenario} is handled well. Current resilience measures are adequate.`;\n  }\n\n  private sleep(ms: number): Promise<void> {\n    return new Promise(resolve => setTimeout(resolve, ms));\n  }\n}\n\n// Test configuration for Phase 3\nconst RESILIENCE_TEST_CONFIG: ResilienceTestConfig = {\n  baseUrl: process.env.TEST_BASE_URL || 'http://localhost:3000',\n  testEndpoints: [\n    {\n      path: '/api/portfolio/0x742d35Cc6643C0532925a3b8D50C20c6AF4e0b57',\n      method: 'GET',\n      category: 'portfolio',\n      timeout: 30000,\n    },\n    {\n      path: '/api/defi/0x742d35Cc6643C0532925a3b8D50C20c6AF4e0b57',\n      method: 'GET',\n      category: 'defi',\n      timeout: 25000,\n    },\n    {\n      path: '/api/nft/0x742d35Cc6643C0532925a3b8D50C20c6AF4e0b57',\n      method: 'GET',\n      category: 'nft',\n      timeout: 20000,\n    },\n    {\n      path: '/api/health',\n      method: 'GET',\n      category: 'health',\n      timeout: 5000,\n    },\n  ],\n  scenarios: [\n    {\n      name: 'provider_timeout',\n      description: 'External provider timeouts (5-10 second delays)',\n      duration: 60000, // 1 minute\n      failurePattern: 'timeout',\n      severity: 'high',\n      expectedBehavior: 'Graceful degradation with caching and fallbacks',\n    },\n    {\n      name: 'provider_errors',\n      description: 'External provider returns errors (500, 503)',\n      duration: 45000, // 45 seconds\n      failurePattern: 'error',\n      severity: 'high',\n      expectedBehavior: 'Retry logic and fallback to alternative providers',\n    },\n    {\n      name: 'slow_responses',\n      description: 'External provider slow responses (2-5 second delays)',\n      duration: 90000, // 1.5 minutes\n      failurePattern: 'slowResponse',\n      severity: 'medium',\n      expectedBehavior: 'Request queuing and timeout handling',\n    },\n    {\n      name: 'rate_limited',\n      description: 'External provider rate limiting (429 responses)',\n      duration: 60000, // 1 minute\n      failurePattern: 'rateLimited',\n      severity: 'medium',\n      expectedBehavior: 'Backoff strategies and request distribution',\n    },\n    {\n      name: 'intermittent_failures',\n      description: 'Intermittent provider failures (30% failure rate)',\n      duration: 120000, // 2 minutes\n      failurePattern: 'intermittent',\n      severity: 'low',\n      expectedBehavior: 'Robust retry logic and circuit breakers',\n    },\n  ],\n  concurrent: 10,\n  requestsPerSecond: 5,\n};\n\nasync function runProviderResilienceTest(): Promise<void> {\n  const tester = new ProviderResilienceTester(RESILIENCE_TEST_CONFIG);\n  \n  try {\n    const report = await tester.runResilienceTest();\n    \n    // Save report\n    const reportPath = path.join(process.cwd(), 'scripts', 'load-test-reports');\n    await fs.mkdir(reportPath, { recursive: true });\n    \n    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');\n    const reportFile = path.join(reportPath, `provider-resilience-${timestamp}.json`);\n    \n    await fs.writeFile(reportFile, JSON.stringify(report, null, 2));\n    \n    // Print results\n    console.log('\\n' + '='.repeat(80));\n    console.log('🛡️ PROVIDER RESILIENCE TEST RESULTS');\n    console.log('='.repeat(80));\n    \n    console.log(`\\n📊 Summary:`);\n    console.log(`   Total Requests: ${report.summary.totalRequests}`);\n    console.log(`   Success Rate: ${((report.summary.successfulRequests / report.summary.totalRequests) * 100).toFixed(2)}%`);\n    console.log(`   Average Response Time: ${report.summary.averageResponseTime.toFixed(2)}ms`);\n    console.log(`   Cache Hit Rate: ${report.summary.cacheHitRate.toFixed(2)}%`);\n    console.log(`   Fallback Usage Rate: ${report.summary.fallbackUsageRate.toFixed(2)}%`);\n    console.log(`   Resilience Score: ${report.summary.resilienceScore.toFixed(1)}/100`);\n    \n    console.log(`\\n🔥 Scenario Analysis:`);\n    Object.entries(report.scenarioAnalysis).forEach(([scenario, analysis]) => {\n      console.log(`\\n   ${scenario.toUpperCase()}:`);\n      console.log(`     Requests: ${analysis.requestCount}`);\n      console.log(`     Success Rate: ${analysis.successRate.toFixed(2)}%`);\n      console.log(`     Avg Response Time: ${analysis.averageResponseTime.toFixed(2)}ms`);\n      console.log(`     Degradation Factor: ${analysis.degradationFactor.toFixed(2)}x`);\n      console.log(`     Recommendation: ${analysis.recommendation}`);\n    });\n    \n    // Resilience assessment\n    console.log(`\\n🎯 Resilience Assessment:`);\n    if (report.summary.resilienceScore >= 80) {\n      console.log(`   ✅ Excellent resilience (${report.summary.resilienceScore.toFixed(1)}/100)`);\n    } else if (report.summary.resilienceScore >= 60) {\n      console.log(`   ⚠️  Good resilience with room for improvement (${report.summary.resilienceScore.toFixed(1)}/100)`);\n    } else if (report.summary.resilienceScore >= 40) {\n      console.log(`   ❌ Poor resilience, significant improvements needed (${report.summary.resilienceScore.toFixed(1)}/100)`);\n    } else {\n      console.log(`   🚨 Critical resilience issues (${report.summary.resilienceScore.toFixed(1)}/100)`);\n    }\n    \n    console.log(`\\n📄 Full report saved to: ${reportFile}`);\n    console.log('='.repeat(80));\n    \n    // Exit with appropriate code based on resilience score\n    if (report.summary.resilienceScore < 40) {\n      process.exit(1);\n    } else if (report.summary.resilienceScore < 60) {\n      process.exit(2);\n    } else {\n      process.exit(0);\n    }\n    \n  } catch (error) {\n    console.error('❌ Provider resilience test failed:', error);\n    process.exit(1);\n  }\n}\n\n// CLI interface\nif (require.main === module) {\n  runProviderResilienceTest();\n}\n\nexport { ProviderResilienceTester, ResilienceTestConfig, ResilienceReport };"