#!/usr/bin/env tsx
/**
 * Performance Profiler
 * Advanced performance profiling for production deployment
 */

import { performance, PerformanceObserver } from 'perf_hooks';
import { cpus, totalmem, freemem, loadavg } from 'os';
import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';

interface ProfileData {
  timestamp: number;
  cpuUsage: NodeJS.CpuUsage;
  memoryUsage: NodeJS.MemoryUsage;
  systemLoad: number[];
  freeMemoryGB: number;
  totalMemoryGB: number;
  eventLoopDelay: number;
  httpMetrics?: {
    activeConnections: number;
    requestsPerSecond: number;
    averageResponseTime: number;
  };
  customMetrics: Record<string, number>;
}

interface PerformanceReport {
  startTime: number;
  endTime: number;
  duration: number;
  profiles: ProfileData[];
  summary: {
    avgCpuUsage: number;
    maxMemoryUsage: number;
    avgEventLoopDelay: number;
    performanceIssues: string[];
    recommendations: string[];
  };
  alerts: Array<{
    timestamp: number;
    severity: 'info' | 'warning' | 'critical';
    message: string;
    metric: string;
    value: number;
    threshold: number;
  }>;
}

class PerformanceProfiler extends EventEmitter {
  private profiles: ProfileData[] = [];
  private startTime: number = 0;
  private intervalId?: NodeJS.Timeout;
  private performanceObserver?: PerformanceObserver;
  private customMetrics: Record<string, number> = {};
  private alerts: PerformanceReport['alerts'] = [];
  
  // Performance thresholds
  private thresholds = {
    cpuUsage: 80, // %
    memoryUsage: 85, // %
    eventLoopDelay: 100, // ms
    systemLoad: cpus().length * 0.8,
    freeMemoryMB: 500,
  };

  constructor() {
    super();
    this.setupPerformanceObserver();
  }

  private setupPerformanceObserver(): void {
    this.performanceObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach(entry => {
        if (entry.entryType === 'measure') {
          this.customMetrics[entry.name] = entry.duration;
        }
      });
    });
    
    this.performanceObserver.observe({ entryTypes: ['measure', 'navigation', 'resource'] });
  }

  startProfiling(intervalMs: number = 1000): void {
    console.log('🔍 Starting performance profiling...');
    this.startTime = Date.now();
    this.profiles = [];
    this.alerts = [];
    
    // Take initial baseline
    this.collectProfile();
    
    // Set up periodic profiling
    this.intervalId = setInterval(() => {
      this.collectProfile();
    }, intervalMs);
    
    this.emit('profilingStarted', { startTime: this.startTime });
  }

  stopProfiling(): PerformanceReport {
    console.log('🔴 Stopping performance profiling...');
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    
    if (this.performanceObserver) {
      this.performanceObserver.disconnect();
    }
    
    const endTime = Date.now();
    const report = this.generateReport(endTime);
    
    this.emit('profilingStopped', report);
    
    return report;
  }

  addCustomMetric(name: string, value: number): void {
    this.customMetrics[name] = value;
  }

  markStart(name: string): void {
    performance.mark(`${name}-start`);
  }

  markEnd(name: string): void {
    performance.mark(`${name}-end`);
    performance.measure(name, `${name}-start`, `${name}-end`);
  }

  private collectProfile(): void {
    const now = Date.now();
    const cpuUsage = process.cpuUsage();
    const memoryUsage = process.memoryUsage();
    const systemLoad = loadavg();
    const freeMemoryGB = freemem() / 1024 / 1024 / 1024;
    const totalMemoryGB = totalmem() / 1024 / 1024 / 1024;
    
    // Measure event loop delay
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const end = process.hrtime.bigint();
      const eventLoopDelay = Number(end - start) / 1_000_000; // Convert to ms
      
      const profile: ProfileData = {
        timestamp: now,
        cpuUsage,
        memoryUsage,
        systemLoad,
        freeMemoryGB,
        totalMemoryGB,
        eventLoopDelay,
        customMetrics: { ...this.customMetrics },
      };
      
      this.profiles.push(profile);
      this.checkThresholds(profile);
      this.emit('profileCollected', profile);
      
      // Reset custom metrics after collection
      this.customMetrics = {};
    });
  }

  private checkThresholds(profile: ProfileData): void {
    const memoryUsagePercent = (profile.memoryUsage.heapUsed / profile.memoryUsage.heapTotal) * 100;
    const cpuUsagePercent = ((profile.cpuUsage.user + profile.cpuUsage.system) / 1000000) * 100;
    const freeMemoryMB = profile.freeMemoryGB * 1024;
    
    // Memory usage alert
    if (memoryUsagePercent > this.thresholds.memoryUsage) {
      this.addAlert('critical', 'High memory usage detected', 'memoryUsage', memoryUsagePercent, this.thresholds.memoryUsage);
    }
    
    // Event loop delay alert
    if (profile.eventLoopDelay > this.thresholds.eventLoopDelay) {
      this.addAlert('warning', 'High event loop delay detected', 'eventLoopDelay', profile.eventLoopDelay, this.thresholds.eventLoopDelay);
    }
    
    // System load alert
    const currentLoad = profile.systemLoad[0];
    if (currentLoad > this.thresholds.systemLoad) {
      this.addAlert('warning', 'High system load detected', 'systemLoad', currentLoad, this.thresholds.systemLoad);
    }
    
    // Free memory alert
    if (freeMemoryMB < this.thresholds.freeMemoryMB) {
      this.addAlert('critical', 'Low free memory detected', 'freeMemory', freeMemoryMB, this.thresholds.freeMemoryMB);
    }
  }

  private addAlert(
    severity: 'info' | 'warning' | 'critical',
    message: string,
    metric: string,
    value: number,
    threshold: number
  ): void {
    const alert = {
      timestamp: Date.now(),
      severity,
      message,
      metric,
      value,
      threshold,
    };
    
    this.alerts.push(alert);
    this.emit('alert', alert);
    
    const emoji = severity === 'critical' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️';
    console.log(`${emoji} ${severity.toUpperCase()}: ${message} (${value.toFixed(2)} > ${threshold})`);
  }

  private generateReport(endTime: number): PerformanceReport {
    const duration = endTime - this.startTime;
    
    // Calculate summary statistics
    const avgCpuUsage = this.profiles.reduce((sum, p) => {
      return sum + ((p.cpuUsage.user + p.cpuUsage.system) / 1000000);
    }, 0) / this.profiles.length;
    
    const maxMemoryUsage = Math.max(...this.profiles.map(p => p.memoryUsage.heapUsed));
    
    const avgEventLoopDelay = this.profiles.reduce((sum, p) => sum + p.eventLoopDelay, 0) / this.profiles.length;
    
    // Analyze performance issues
    const performanceIssues: string[] = [];
    const recommendations: string[] = [];
    
    if (avgCpuUsage > 50) {
      performanceIssues.push(`High average CPU usage: ${avgCpuUsage.toFixed(2)}%`);
      recommendations.push('Consider optimizing CPU-intensive operations or scaling horizontally');
    }
    
    if (maxMemoryUsage > 0.8 * totalmem()) {
      performanceIssues.push(`High memory usage: ${(maxMemoryUsage / 1024 / 1024).toFixed(2)}MB`);
      recommendations.push('Investigate memory leaks and optimize memory usage patterns');
    }
    
    if (avgEventLoopDelay > 50) {
      performanceIssues.push(`High event loop delay: ${avgEventLoopDelay.toFixed(2)}ms`);
      recommendations.push('Reduce blocking operations and use asynchronous alternatives');
    }
    
    const criticalAlerts = this.alerts.filter(a => a.severity === 'critical').length;
    if (criticalAlerts > 0) {
      performanceIssues.push(`${criticalAlerts} critical performance alerts`);
      recommendations.push('Address critical alerts immediately to prevent service degradation');
    }
    
    return {
      startTime: this.startTime,
      endTime,
      duration,
      profiles: this.profiles,
      summary: {
        avgCpuUsage,
        maxMemoryUsage,
        avgEventLoopDelay,
        performanceIssues,
        recommendations,
      },
      alerts: this.alerts,
    };
  }

  async saveReport(report: PerformanceReport, fileName?: string): Promise<string> {
    const reportsDir = path.join(process.cwd(), 'performance-reports');
    await fs.mkdir(reportsDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = fileName || `performance-${timestamp}.json`;
    const filePath = path.join(reportsDir, filename);
    
    await fs.writeFile(filePath, JSON.stringify(report, null, 2));
    
    return filePath;
  }

  printSummary(report: PerformanceReport): void {
    console.log('\n📈 Performance Profile Summary');
    console.log('='.repeat(50));
    console.log(`Duration: ${(report.duration / 1000).toFixed(2)} seconds`);
    console.log(`Profiles collected: ${report.profiles.length}`);
    console.log(`Average CPU usage: ${report.summary.avgCpuUsage.toFixed(2)}%`);
    console.log(`Max memory usage: ${(report.summary.maxMemoryUsage / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Average event loop delay: ${report.summary.avgEventLoopDelay.toFixed(2)} ms`);
    
    if (report.alerts.length > 0) {
      console.log('\n🚨 Alerts:');
      const alertCounts = {
        critical: report.alerts.filter(a => a.severity === 'critical').length,
        warning: report.alerts.filter(a => a.severity === 'warning').length,
        info: report.alerts.filter(a => a.severity === 'info').length,
      };
      
      console.log(`  Critical: ${alertCounts.critical}`);
      console.log(`  Warning: ${alertCounts.warning}`);
      console.log(`  Info: ${alertCounts.info}`);
    }
    
    if (report.summary.performanceIssues.length > 0) {
      console.log('\n⚠️ Performance Issues:');
      report.summary.performanceIssues.forEach(issue => {
        console.log(`  • ${issue}`);
      });
    }
    
    if (report.summary.recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      report.summary.recommendations.forEach(rec => {
        console.log(`  • ${rec}`);
      });
    }
  }
}

// CLI utilities
async function profileApplication(durationSeconds: number = 60): Promise<void> {
  console.log(`🎯 Profiling application for ${durationSeconds} seconds...`);
  
  const profiler = new PerformanceProfiler();
  
  // Set up event listeners
  profiler.on('alert', (alert) => {
    console.log(`Alert: ${alert.message}`);
  });
  
  profiler.startProfiling(1000); // Profile every second
  
  // Wait for specified duration
  await new Promise(resolve => setTimeout(resolve, durationSeconds * 1000));
  
  const report = profiler.stopProfiling();
  
  profiler.printSummary(report);
  
  const reportPath = await profiler.saveReport(report);
  console.log(`\n📄 Report saved to: ${reportPath}`);
}

async function profileWithLoadTesting(): Promise<void> {
  console.log('💪 Profiling during load testing...');
  
  const profiler = new PerformanceProfiler();
  
  // Start profiling
  profiler.startProfiling(500); // More frequent during load test
  
  try {
    // Import and run load test (assumes load-test script exists)
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    console.log('Starting load test...');
    await execAsync('tsx scripts/load-test.ts stress');
    
  } catch (error) {
    console.log('⚠️ Load test script not available, continuing with basic profiling');
    await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds
  }
  
  const report = profiler.stopProfiling();
  
  profiler.printSummary(report);
  
  const reportPath = await profiler.saveReport(report, 'performance-under-load.json');
  console.log(`\n📄 Load test performance report saved to: ${reportPath}`);
}

// Memory leak detection
class MemoryLeakDetector {
  private baselineMemory: NodeJS.MemoryUsage;
  private measurements: Array<{ timestamp: number; memory: NodeJS.MemoryUsage }> = [];
  
  constructor() {
    // Force garbage collection for baseline
    if (global.gc) global.gc();
    this.baselineMemory = process.memoryUsage();
  }
  
  takeMeasurement(): void {
    if (global.gc) global.gc();
    
    this.measurements.push({
      timestamp: Date.now(),
      memory: process.memoryUsage(),
    });
  }
  
  detectLeaks(): { hasLeak: boolean; analysis: string } {
    if (this.measurements.length < 5) {
      return { hasLeak: false, analysis: 'Not enough measurements for leak detection' };
    }
    
    // Check if memory usage is consistently growing
    const recentMeasurements = this.measurements.slice(-5);
    const memoryGrowth = recentMeasurements.map((m, i) => {
      if (i === 0) return 0;
      return m.memory.heapUsed - recentMeasurements[i - 1].memory.heapUsed;
    }).slice(1);
    
    const avgGrowth = memoryGrowth.reduce((sum, growth) => sum + growth, 0) / memoryGrowth.length;
    const consistentGrowth = memoryGrowth.every(growth => growth > 0);
    
    const hasLeak = consistentGrowth && avgGrowth > 1024 * 1024; // 1MB average growth
    
    let analysis = '';
    if (hasLeak) {
      analysis = `Potential memory leak detected. Average growth: ${(avgGrowth / 1024 / 1024).toFixed(2)}MB per measurement`;
    } else {
      analysis = 'No significant memory leak detected';
    }
    
    return { hasLeak, analysis };
  }
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2] || 'profile';
  const duration = parseInt(process.argv[3] || '60');
  
  switch (command) {
    case 'profile':
      profileApplication(duration);
      break;
    case 'load':
      profileWithLoadTesting();
      break;
    case 'memory':
      console.log('🧠 Starting memory leak detection...');
      const detector = new MemoryLeakDetector();
      
      setInterval(() => {
        detector.takeMeasurement();
        const result = detector.detectLeaks();
        console.log(result.analysis);
      }, 10000); // Check every 10 seconds
      
      break;
    default:
      console.log('Usage: tsx scripts/performance-profiler.ts [profile|load|memory] [duration]');
      process.exit(1);
  }
}

export { PerformanceProfiler, MemoryLeakDetector, ProfileData, PerformanceReport };
