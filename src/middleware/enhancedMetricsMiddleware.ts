import { Request, Response, NextFunction } from 'express';
import { register } from 'prom-client';
import { logger, logError, createContextualLogger } from '@/utils/logger';
import { getEnhancedEventMonitoringService } from '@/services/EnhancedEventMonitoringService';
import { getCacheWarmingIntegrationService } from '@/services/CacheWarmingIntegrationService';
import { getCostMonitoringService } from '@/services/CostMonitoringService';
import { getPerformanceTrackingSystem } from '@/services/PerformanceTrackingSystem';
import type { HealthCheckResult } from '@/middleware/interfaces';

/**
 * Enhanced Metrics Middleware
 *
 * Provides comprehensive metrics endpoints for monitoring and observability:
 * - Prometheus metrics export
 * - Real-time performance dashboards
 * - Cost optimization metrics
 * - Event system health monitoring
 * - Cache warming performance tracking
 */

export class EnhancedMetricsMiddleware {
  private contextLogger = createContextualLogger({ component: 'EnhancedMetricsMiddleware' });

  // Service integrations
  private eventMonitoring = getEnhancedEventMonitoringService();
  private cacheWarming = getCacheWarmingIntegrationService();
  private costMonitoring = getCostMonitoringService();
  private performanceTracking = getPerformanceTrackingSystem();

  // Metrics tracking
  private requestCount = 0;
  private errorCount = 0;
  private startTime = Date.now();
  private lastRequestTimes: number[] = [];

  constructor() {
    this.setupHealthEndpoints();
  }

  /**
   * Prometheus metrics endpoint
   */
  async prometheusMetrics(req: Request, res: Response): Promise<void> {
    try {
      const metrics = await register.metrics();
      res.set('Content-Type', register.contentType);
      res.end(metrics);
    } catch (error) {
      logError(error as Error, { operation: 'prometheusMetrics' });
      res.status(500).json({ error: 'Failed to generate metrics' });
    }
  }

  /**
   * Enhanced health check endpoint
   */
  async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      const healthResult = await this.generateHealthCheck();

      // Set appropriate HTTP status based on health
      let statusCode = 200;
      switch (healthResult.status) {
        case 'warning':
          statusCode = 200; // Still OK but with warnings
          break;
        case 'critical':
          statusCode = 503; // Service Unavailable
          break;
        case 'emergency':
          statusCode = 503; // Service Unavailable
          break;
      }

      res.status(statusCode).json(healthResult);
    } catch (error) {
      logError(error as Error, { operation: 'healthCheck' });
      res.status(500).json({
        status: 'critical',
        error: 'Health check failed',
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Real-time performance dashboard endpoint
   */
  async performanceDashboard(req: Request, res: Response): Promise<void> {
    try {
      const timeRange = (req.query.timeRange as string) || '1h';
      const detailed = req.query.detailed === 'true';

      const dashboard = await this.generatePerformanceDashboard(timeRange, detailed);
      res.json(dashboard);
    } catch (error) {
      logError(error as Error, { operation: 'performanceDashboard' });
      res.status(500).json({ error: 'Failed to generate dashboard' });
    }
  }

  /**
   * Cost optimization metrics endpoint
   */
  async costMetrics(req: Request, res: Response): Promise<void> {
    try {
      const period = (req.query.period as string) || '24h';
      const detailed = req.query.detailed === 'true';

      const costData = await this.generateCostMetrics(period, detailed);
      res.json(costData);
    } catch (error) {
      logError(error as Error, { operation: 'costMetrics' });
      res.status(500).json({ error: 'Failed to generate cost metrics' });
    }
  }

  /**
   * Event system metrics endpoint
   */
  async eventMetrics(req: Request, res: Response): Promise<void> {
    try {
      const eventMetrics = this.eventMonitoring
        .getMetricsRegistry()
        .getMetricsAsArray()
        .filter(metric => metric.name.startsWith('crypto_data_events'));

      const eventSystemMetrics = {
        timestamp: Date.now(),
        prometheus: eventMetrics,
        internal: {
          monitoring: this.eventMonitoring.getHealthStatus(),
          cacheWarming: this.cacheWarming.getHealthStatus(),
        },
      };

      res.json(eventSystemMetrics);
    } catch (error) {
      logError(error as Error, { operation: 'eventMetrics' });
      res.status(500).json({ error: 'Failed to generate event metrics' });
    }
  }

  /**
   * Cache warming performance endpoint
   */
  async cacheWarmingMetrics(req: Request, res: Response): Promise<void> {
    try {
      const metrics = this.cacheWarming.getMetrics();
      const strategy = this.cacheWarming.getStrategy();
      const recentDecisions = this.cacheWarming.getRecentDecisions(100);
      const health = this.cacheWarming.getHealthStatus();

      const cacheWarmingData = {
        timestamp: Date.now(),
        metrics,
        strategy: {
          enabled: strategy.enabled,
          costBudget: strategy.costBudget,
          successRateThreshold: strategy.successRateThreshold,
          strategies: Object.keys(strategy.strategies).filter(
            key => strategy.strategies[key as keyof typeof strategy.strategies].enabled
          ),
        },
        recentDecisions: recentDecisions.slice(-20), // Last 20 decisions
        health,
        performance: {
          successRate:
            metrics.totalRequests > 0 ? metrics.successfulWarmings / metrics.totalRequests : 0,
          costEfficiency:
            metrics.totalCostSpent > 0 ? metrics.totalSavingsAchieved / metrics.totalCostSpent : 0,
          averageTime: metrics.averageWarmingTime,
          dataTypeBreakdown: metrics.byDataType,
          strategyBreakdown: metrics.byStrategy,
        },
      };

      res.json(cacheWarmingData);
    } catch (error) {
      logError(error as Error, { operation: 'cacheWarmingMetrics' });
      res.status(500).json({ error: 'Failed to generate cache warming metrics' });
    }
  }

  /**
   * System alerts endpoint
   */
  async systemAlerts(req: Request, res: Response): Promise<void> {
    try {
      const severity = req.query.severity as string;
      const limit = parseInt(req.query.limit as string) || 50;

      // Get alerts from performance tracking system
      const performanceAlerts = this.performanceTracking.getActiveAlerts();

      // Get cost alerts from cost monitoring
      const costAlerts = await this.costMonitoring.checkBudgetLimits();

      // Combine and filter alerts
      let allAlerts = [
        ...performanceAlerts.map(alert => ({ ...alert, source: 'performance' })),
        ...costAlerts.map(alert => ({ ...alert, source: 'cost' })),
      ];

      if (severity) {
        allAlerts = allAlerts.filter(alert => alert.severity === severity);
      }

      // Sort by timestamp (newest first) and limit
      allAlerts = allAlerts.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);

      const alertsData = {
        timestamp: Date.now(),
        total: allAlerts.length,
        critical: allAlerts.filter(a => a.severity === 'critical').length,
        warning: allAlerts.filter(a => a.severity === 'warning').length,
        info: allAlerts.filter(a => a.severity === 'info').length,
        alerts: allAlerts,
      };

      res.json(alertsData);
    } catch (error) {
      logError(error as Error, { operation: 'systemAlerts' });
      res.status(500).json({ error: 'Failed to get system alerts' });
    }
  }

  /**
   * Force metrics update endpoint
   */
  async forceMetricsUpdate(req: Request, res: Response): Promise<void> {
    try {
      const adminKey = req.headers['x-admin-key'] as string;

      // Simple admin key check (in production, use proper auth)
      if (adminKey !== process.env.ADMIN_KEY) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Force metrics updates across all services
      await Promise.all([
        this.eventMonitoring.forceMetricsUpdate(),
        this.performanceTracking.forceHealthUpdate(),
        this.costMonitoring.generateCostReport('24h'),
      ]);

      res.json({
        status: 'success',
        message: 'Metrics update forced across all services',
        timestamp: Date.now(),
      });
    } catch (error) {
      logError(error as Error, { operation: 'forceMetricsUpdate' });
      res.status(500).json({ error: 'Failed to force metrics update' });
    }
  }

  /**
   * Request tracking middleware
   */
  trackRequest(req: Request, res: Response, next: NextFunction): void {
    const startTime = Date.now();
    this.requestCount++;

    // Track request times for rate calculation
    this.lastRequestTimes.push(startTime);

    // Keep only last minute of request times
    const oneMinuteAgo = startTime - 60000;
    this.lastRequestTimes = this.lastRequestTimes.filter(time => time > oneMinuteAgo);

    // Override res.end to capture response
    const originalEnd = res.end;
    res.end = function (this: any, chunk?: any, encoding?: any) {
      const responseTime = Date.now() - startTime;

      // Track errors
      if (res.statusCode >= 400) {
        (this as any).errorCount++;
      }

      // Log performance metrics for monitoring
      logger.debug('Request completed', {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        responseTime,
        userAgent: req.get('User-Agent'),
      });

      return (originalEnd as any).call(this, chunk, encoding);
    }.bind(this);

    next();
  }

  /**
   * Setup health check endpoints
   */
  private setupHealthEndpoints(): void {
    this.contextLogger.info('Enhanced metrics middleware initialized');
  }

  /**
   * Generate comprehensive health check
   */
  private async generateHealthCheck(): Promise<HealthCheckResult> {
    const timestamp = Date.now();
    const uptime = timestamp - this.startTime;

    // Get service health statuses
    const [eventMonitoringHealth, cacheWarmingHealth, costMonitoringStats, systemHealth] =
      await Promise.all([
        this.eventMonitoring.getHealthStatus(),
        this.cacheWarming.getHealthStatus(),
        this.costMonitoring.getCurrentStats(),
        this.performanceTracking.getSystemHealth(),
      ]);

    // Calculate request metrics
    const requestsPerSecond = this.lastRequestTimes.length / 60; // Requests in last minute / 60
    const errorRate = this.requestCount > 0 ? (this.errorCount / this.requestCount) * 100 : 0;

    // Get memory usage
    const memoryUsage = process.memoryUsage();
    const memoryUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;

    // Determine overall health status
    const overallHealth = this.determineOverallHealth(
      systemHealth.overallHealth,
      eventMonitoringHealth,
      cacheWarmingHealth,
      errorRate,
      memoryUsagePercent
    );

    return {
      status: overallHealth,
      timestamp,
      version: process.env.npm_package_version || '1.0.0',
      uptime,
      environment: process.env.NODE_ENV || 'development',
      services: {
        eventMonitoring: eventMonitoringHealth,
        cacheWarming: cacheWarmingHealth,
        costMonitoring: {
          status: costMonitoringStats.status,
          totalCost: costMonitoringStats.totalCost,
          budgetUtilization: costMonitoringStats.budgetUtilization,
        },
        performanceTracking: {
          status: systemHealth.overallHealth,
          score: systemHealth.healthScore,
          activeAlerts: systemHealth.activeAlerts.total,
        },
      },
      metrics: {
        requests: {
          total: this.requestCount,
          perSecond: requestsPerSecond,
          errorRate,
        },
        performance: {
          responseTimeP95: systemHealth.components.performance.metrics.averageResponseTime,
          memoryUsage: memoryUsagePercent,
          cpuUsage: systemHealth.resourceUtilization.cpu,
        },
        cost: {
          hourlySpend: costMonitoringStats.totalCost,
          projectedDaily: costMonitoringStats.totalCost * 24,
          savingsRate: 0, // Would be calculated from cost monitoring
          budgetUtilization: costMonitoringStats.budgetUtilization,
        },
        events: {
          publishRate: eventMonitoringHealth.monitoring?.snapshotsCollected || 0,
          consumeRate: 0, // Would be calculated from event metrics
          queueDepth: 0, // Would be calculated from event metrics
          errorRate: 0, // Would be calculated from event metrics
        },
        cache: {
          hitRate: cacheWarmingHealth.successRate * 100,
          warmingSuccessRate: cacheWarmingHealth.successRate * 100,
          evictionRate: 0, // Would be calculated from cache metrics
        },
      },
      alerts: {
        critical: systemHealth.activeAlerts.critical,
        warning: systemHealth.activeAlerts.warning,
        total: systemHealth.activeAlerts.total,
        recent: systemHealth.activeAlerts.recentAlerts.slice(0, 5),
      },
    };
  }

  /**
   * Generate performance dashboard data
   */
  private async generatePerformanceDashboard(timeRange: string, detailed: boolean): Promise<any> {
    const currentSnapshot = this.eventMonitoring.getCurrentSnapshot();
    const systemHealth = await this.performanceTracking.getSystemHealth();

    const dashboard = {
      timestamp: Date.now(),
      timeRange,
      overview: {
        systemHealth: systemHealth.overallHealth,
        healthScore: systemHealth.healthScore,
        activeAlerts: systemHealth.activeAlerts.total,
        uptime: Date.now() - this.startTime,
      },
      performance: currentSnapshot
        ? {
            eventLatency: currentSnapshot.eventMetrics.averageLatency,
            cacheHitRate: currentSnapshot.cacheMetrics.hitRate,
            workerThroughput: currentSnapshot.workerMetrics.throughput,
            errorRate: currentSnapshot.eventMetrics.errorRate,
            queueDepth: currentSnapshot.eventMetrics.queueDepth,
          }
        : null,
      resources: systemHealth.resourceUtilization,
      components: systemHealth.components,
    };

    if (detailed) {
      // Add detailed metrics
      const endTime = Date.now();
      const startTime = this.getStartTimeFromRange(timeRange, endTime);

      (dashboard as any).detailed = {
        snapshots: this.eventMonitoring.getSnapshotsInRange(startTime, endTime),
        costAttribution: await this.performanceTracking.getCostAttribution(startTime, endTime),
        recentAlerts: systemHealth.activeAlerts.recentAlerts,
      };
    }

    return dashboard;
  }

  /**
   * Generate cost metrics data
   */
  private async generateCostMetrics(period: string, detailed: boolean): Promise<any> {
    const costSummary = await this.costMonitoring.getCostSummary(period as any);
    const cacheWarmingMetrics = this.cacheWarming.getMetrics();

    const costData = {
      timestamp: Date.now(),
      period,
      summary: costSummary,
      optimization: {
        cacheWarming: {
          totalSpent: cacheWarmingMetrics.totalCostSpent,
          totalSaved: cacheWarmingMetrics.totalSavingsAchieved,
          efficiency:
            cacheWarmingMetrics.totalCostSpent > 0
              ? cacheWarmingMetrics.totalSavingsAchieved / cacheWarmingMetrics.totalCostSpent
              : 0,
          successRate:
            cacheWarmingMetrics.totalRequests > 0
              ? cacheWarmingMetrics.successfulWarmings / cacheWarmingMetrics.totalRequests
              : 0,
        },
      },
    };

    if (detailed) {
      (costData as any).detailed = {
        byProvider: costSummary.providerBreakdown,
        byChain: costSummary.chainBreakdown,
        byRequestType: costSummary.requestTypeBreakdown,
        cacheWarmingByDataType: cacheWarmingMetrics.byDataType,
        recentOptimizations: cacheWarmingMetrics.recentPerformance.slice(-20),
      };
    }

    return costData;
  }

  /**
   * Helper methods
   */
  private determineOverallHealth(
    systemHealth: string,
    eventMonitoringHealth: any,
    cacheWarmingHealth: any,
    errorRate: number,
    memoryUsage: number
  ): 'healthy' | 'warning' | 'critical' | 'emergency' {
    // Emergency conditions
    if (errorRate > 50 || memoryUsage > 95) {
      return 'emergency';
    }

    // Critical conditions
    if (
      systemHealth === 'critical' ||
      errorRate > 20 ||
      memoryUsage > 85 ||
      !eventMonitoringHealth.monitoring?.enabled ||
      !cacheWarmingHealth.enabled
    ) {
      return 'critical';
    }

    // Warning conditions
    if (
      systemHealth === 'warning' ||
      errorRate > 5 ||
      memoryUsage > 70 ||
      cacheWarmingHealth.successRate < 0.7
    ) {
      return 'warning';
    }

    return 'healthy';
  }

  private getStartTimeFromRange(timeRange: string, endTime: number): number {
    const ranges: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };

    const duration = ranges[timeRange] || ranges['24h'];
    return endTime - duration;
  }

  // Express route handlers (to be used in routes)

  /**
   * Get route handlers for Express
   */
  getRouteHandlers() {
    return {
      // Middleware
      trackRequest: this.trackRequest.bind(this),

      // Endpoints
      health: this.healthCheck.bind(this),
      metrics: this.prometheusMetrics.bind(this),
      dashboard: this.performanceDashboard.bind(this),
      cost: this.costMetrics.bind(this),
      events: this.eventMetrics.bind(this),
      cacheWarming: this.cacheWarmingMetrics.bind(this),
      alerts: this.systemAlerts.bind(this),
      forceUpdate: this.forceMetricsUpdate.bind(this),
    };
  }
}

// Export singleton instance
let metricsMiddlewareInstance: EnhancedMetricsMiddleware | null = null;

export const getEnhancedMetricsMiddleware = (): EnhancedMetricsMiddleware => {
  if (!metricsMiddlewareInstance) {
    metricsMiddlewareInstance = new EnhancedMetricsMiddleware();
  }
  return metricsMiddlewareInstance;
};

export default getEnhancedMetricsMiddleware;
