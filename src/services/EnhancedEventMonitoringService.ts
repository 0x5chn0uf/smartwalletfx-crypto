import { EventEmitter } from 'events';
import { register, Gauge, Counter, Histogram, collectDefaultMetrics } from 'prom-client';
import { logger, logError, createContextualLogger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { config } from '@/config';
import { getEventSystem } from './EventSystem';
import { getCostMonitoringService } from './CostMonitoringService';
import { getPerformanceTrackingSystem } from './PerformanceTrackingSystem';

/**
 * Enhanced Event-Driven Monitoring Service
 *
 * Provides comprehensive monitoring integration with:
 * - Event cost tracking with prom-client metrics
 * - Cache warming performance monitoring
 * - Worker throughput and batch efficiency tracking
 * - Real-time alerting with cost threshold integration
 * - Performance dashboard metrics for observability
 */

// Prometheus metrics
const eventPublishCounter = new Counter({
  name: 'crypto_data_events_published_total',
  help: 'Total number of events published',
  labelNames: ['event_type', 'priority', 'source'],
});

const eventConsumeCounter = new Counter({
  name: 'crypto_data_events_consumed_total',
  help: 'Total number of events consumed',
  labelNames: ['event_type', 'handler_id', 'status'],
});

const eventProcessingLatency = new Histogram({
  name: 'crypto_data_event_processing_duration_seconds',
  help: 'Event processing latency in seconds',
  labelNames: ['event_type', 'handler_id'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

const cacheWarmingMetrics = new Gauge({
  name: 'crypto_data_cache_warming_performance',
  help: 'Cache warming performance metrics',
  labelNames: ['metric_type', 'cache_type', 'chain_id'],
});

const workerThroughputGauge = new Gauge({
  name: 'crypto_data_worker_throughput_per_minute',
  help: 'Worker throughput in computations per minute',
  labelNames: ['worker_type', 'chain_id', 'operation'],
});

const batchEfficiencyGauge = new Gauge({
  name: 'crypto_data_batch_efficiency_percentage',
  help: 'Batch processing efficiency percentage',
  labelNames: ['batch_type', 'provider', 'chain_id'],
});

const costSavingsGauge = new Gauge({
  name: 'crypto_data_cost_savings_usd',
  help: 'Cost savings in USD through optimization',
  labelNames: ['optimization_type', 'time_period'],
});

const alertThresholdGauge = new Gauge({
  name: 'crypto_data_alert_threshold_utilization',
  help: 'Alert threshold utilization percentage',
  labelNames: ['threshold_type', 'provider', 'severity'],
});

interface MonitoringConfiguration {
  eventLatencyThresholds: Record<string, number>; // ms
  cacheHitRateTargets: Record<string, number>; // percentage
  workerThroughputTargets: Record<string, number>; // computations/min
  costThresholds: {
    hourly: number;
    daily: number;
    monthly: number;
    perEvent: number;
  };
  alertingEnabled: boolean;
  metricsRetentionPeriod: number; // hours
}

interface PerformanceSnapshot {
  timestamp: number;
  eventMetrics: {
    publishRate: number; // events/sec
    consumeRate: number; // events/sec
    averageLatency: number; // ms
    errorRate: number; // percentage
    queueDepth: number;
  };
  cacheMetrics: {
    hitRate: number; // percentage
    warmingSuccessRate: number; // percentage
    evictionRate: number; // evictions/min
    totalSize: number; // bytes
  };
  workerMetrics: {
    throughput: number; // computations/min
    utilizationRate: number; // percentage
    averageJobTime: number; // ms
    errorRate: number; // percentage
  };
  costMetrics: {
    hourlySpend: number; // USD
    projectedDaily: number; // USD
    projectedMonthly: number; // USD
    savingsRate: number; // percentage
    costPerEvent: number; // USD
  };
  systemHealth: {
    overallScore: number; // 0-100
    componentScores: Record<string, number>;
    activeAlerts: number;
    criticalIssues: string[];
  };
}

export class EnhancedEventMonitoringService extends EventEmitter {
  private contextLogger = createContextualLogger({ component: 'EnhancedEventMonitoringService' });

  // Service integrations
  private eventSystem = getEventSystem();
  private costMonitoring = getCostMonitoringService();
  private performanceTracking = getPerformanceTrackingSystem();

  // Configuration
  private config: MonitoringConfiguration = {
    eventLatencyThresholds: {
      CacheWarmRequestV1: 100, // 100ms
      CostThresholdExceededV1: 50, // 50ms
      RequestDeduplicationV1: 200, // 200ms
      BatchOptimizationV1: 300, // 300ms
      PerformanceDegradationV1: 100, // 100ms
    },
    cacheHitRateTargets: {
      balance: 80, // 80%
      transaction: 70, // 70%
      token_metadata: 95, // 95%
      price: 60, // 60%
      nft: 85, // 85%
      defi: 75, // 75%
    },
    workerThroughputTargets: {
      portfolio_worker: 100, // 100 computations/min
      price_worker: 200, // 200 computations/min
      defi_worker: 50, // 50 computations/min
    },
    costThresholds: {
      hourly: 5.0, // $5/hour
      daily: 50.0, // $50/day
      monthly: 1000.0, // $1000/month
      perEvent: 0.001, // $0.001/event
    },
    alertingEnabled: true,
    metricsRetentionPeriod: 72, // 3 days
  };

  // State tracking
  private performanceSnapshots: PerformanceSnapshot[] = [];
  private lastMetricsUpdate = 0;
  private monitoringEnabled = true;
  private alertCooldowns = new Map<string, number>();

  // Performance targets for alerting
  private performanceTargets = {
    eventLatencyP95: 100, // 100ms
    cacheHitRate: 75, // 75%
    workerThroughput: 100, // 100 computations/min
    costSavingsRate: 20, // 20%
    errorRate: 1, // 1%
  };

  constructor() {
    super();
    this.initializePrometheusMetrics();
    this.setupEventListeners();
    this.startPerformanceMonitoring();
    this.startCostOptimizationTracking();
    this.startAlertingSystem();
  }

  /**
   * Initialize Prometheus metrics collection
   */
  private initializePrometheusMetrics(): void {
    // Enable default Node.js metrics
    collectDefaultMetrics({ register });

    this.contextLogger.info('Prometheus metrics initialized', {
      metricsRegistered: register.getMetricsAsArray().length,
    });
  }

  /**
   * Setup event listeners for comprehensive monitoring
   */
  private setupEventListeners(): void {
    // Event system monitoring
    this.eventSystem.on('metricRecorded', this.handleEventMetric.bind(this));
    this.eventSystem.on('eventSystemMetrics', this.handleEventSystemMetrics.bind(this));

    // Cache warming event handling
    this.eventSystem.registerHandler(
      'CacheWarmRequestV1',
      async event => {
        await this.handleCacheWarmRequest(event);
      },
      {
        id: 'enhanced-monitoring-cache-warm',
        priority: 6,
        maxRetries: 2,
      }
    );

    // Cost monitoring integration
    this.costMonitoring.on('advancedCostTracked', this.handleCostEvent.bind(this));
    this.costMonitoring.on('alertTriggered', this.handleCostAlert.bind(this));

    // Performance tracking integration
    this.performanceTracking.on('metricRecorded', this.handlePerformanceMetric.bind(this));
    this.performanceTracking.on('alertCreated', this.handlePerformanceAlert.bind(this));

    this.contextLogger.info('Event listeners configured');
  }

  /**
   * Handle cache warm requests with performance tracking
   */
  private async handleCacheWarmRequest(event: any): Promise<void> {
    const startTime = Date.now();

    try {
      // Track cache warming request
      eventConsumeCounter.inc({
        event_type: event.type,
        handler_id: 'enhanced-monitoring-cache-warm',
        status: 'processing',
      });

      this.contextLogger.info('Processing cache warm request', {
        requestId: event.requestId,
        dataType: event.dataType,
        priority: event.priority,
        keyCount: event.keys.length,
        estimatedSavings: event.estimatedSavings,
      });

      // Update cache warming metrics
      cacheWarmingMetrics.set(
        {
          metric_type: 'requests_received',
          cache_type: event.dataType,
          chain_id: event.chainId || 'unknown',
        },
        1
      );

      // Emit cache warming performance metrics
      await this.trackCacheWarmingPerformance(event);

      // Mark as successfully processed
      eventConsumeCounter.inc({
        event_type: event.type,
        handler_id: 'enhanced-monitoring-cache-warm',
        status: 'success',
      });

      const processingTime = Date.now() - startTime;
      eventProcessingLatency.observe(
        {
          event_type: event.type,
          handler_id: 'enhanced-monitoring-cache-warm',
        },
        processingTime / 1000
      );
    } catch (error) {
      // Track processing errors
      eventConsumeCounter.inc({
        event_type: event.type,
        handler_id: 'enhanced-monitoring-cache-warm',
        status: 'error',
      });

      logError(error as Error, {
        operation: 'handleCacheWarmRequest',
        requestId: event.requestId,
        dataType: event.dataType,
      });

      throw error;
    }
  }

  /**
   * Track cache warming performance metrics
   */
  private async trackCacheWarmingPerformance(event: any): Promise<void> {
    try {
      // Update cache type specific metrics
      const cacheKey = `cache_warm_performance:${event.dataType}`;
      const existing = (await redisManager.get(cacheKey)) || {
        requests: 0,
        successes: 0,
        totalLatency: 0,
        lastUpdate: Date.now(),
      };

      existing.requests++;
      existing.lastUpdate = Date.now();

      await redisManager.set(cacheKey, existing, 3600); // 1 hour TTL

      // Update Prometheus metrics
      cacheWarmingMetrics.set(
        {
          metric_type: 'success_rate',
          cache_type: event.dataType,
          chain_id: event.chainId || 'unknown',
        },
        existing.requests > 0 ? (existing.successes / existing.requests) * 100 : 0
      );

      // Track estimated savings
      if (event.estimatedSavings > 0) {
        costSavingsGauge.set(
          {
            optimization_type: 'cache_warming',
            time_period: 'hourly',
          },
          event.estimatedSavings
        );
      }
    } catch (error) {
      logError(error as Error, {
        operation: 'trackCacheWarmingPerformance',
        eventType: event.type,
      });
    }
  }

  /**
   * Handle event system metrics updates
   */
  private handleEventSystemMetrics(data: any): void {
    const { metrics } = data;

    // Update Prometheus metrics with event system data
    eventPublishCounter.inc(
      {
        event_type: 'all',
        priority: 'unknown',
        source: 'event_system',
      },
      metrics.totalEvents - metrics.processedEvents
    );

    // Track queue depth
    cacheWarmingMetrics.set(
      {
        metric_type: 'queue_depth',
        cache_type: 'all',
        chain_id: 'all',
      },
      metrics.queueLength
    );

    this.contextLogger.debug('Event system metrics updated', {
      totalEvents: metrics.totalEvents,
      processedEvents: metrics.processedEvents,
      queueLength: metrics.queueLength,
      eventsPerSecond: metrics.eventsPerSecond,
    });
  }

  /**
   * Handle individual event metrics
   */
  private handleEventMetric(event: any): void {
    // Update event publishing metrics
    eventPublishCounter.inc({
      event_type: event.type || 'unknown',
      priority: event.priority || 'normal',
      source: event.source || 'unknown',
    });

    // Check latency thresholds
    const threshold = this.config.eventLatencyThresholds[event.type];
    if (threshold && event.processingTime > threshold) {
      this.triggerLatencyAlert(event, threshold);
    }
  }

  /**
   * Handle cost-related events
   */
  private handleCostEvent(data: any): void {
    const { record, predictedImpact, optimizations } = data;

    // Update cost metrics
    costSavingsGauge.set(
      {
        optimization_type: 'real_time',
        time_period: 'hourly',
      },
      predictedImpact.hourly
    );

    // Track cost per event
    if (record.cost > 0) {
      const costPerEvent = record.cost;
      costSavingsGauge.set(
        {
          optimization_type: 'cost_per_event',
          time_period: 'current',
        },
        costPerEvent
      );

      // Alert if cost per event exceeds threshold
      if (costPerEvent > this.config.costThresholds.perEvent) {
        this.triggerCostAlert('per_event', costPerEvent, this.config.costThresholds.perEvent);
      }
    }

    this.contextLogger.debug('Cost event processed', {
      provider: record.provider,
      cost: record.cost,
      optimizationCount: optimizations.length,
    });
  }

  /**
   * Handle cost alerts from monitoring service
   */
  private handleCostAlert(alert: any): void {
    // Update alert threshold metrics
    alertThresholdGauge.set(
      {
        threshold_type: alert.type,
        provider: alert.provider || 'unknown',
        severity: alert.severity,
      },
      (alert.currentValue / alert.threshold) * 100
    );

    this.contextLogger.warn('Cost alert received', {
      alertId: alert.id,
      type: alert.type,
      severity: alert.severity,
      currentValue: alert.currentValue,
      threshold: alert.threshold,
    });

    // Emit for downstream processing
    this.emit('costAlertReceived', alert);
  }

  /**
   * Handle performance metrics
   */
  private handlePerformanceMetric(metric: any): void {
    // Update worker throughput metrics based on metric type
    if (metric.name.includes('throughput')) {
      workerThroughputGauge.set(
        {
          worker_type: metric.metadata?.source || 'unknown',
          chain_id: metric.tags?.chainId || 'unknown',
          operation: metric.tags?.operation || 'unknown',
        },
        metric.value
      );
    }

    // Update batch efficiency metrics
    if (metric.name.includes('efficiency')) {
      batchEfficiencyGauge.set(
        {
          batch_type: metric.tags?.batchType || 'unknown',
          provider: metric.tags?.provider || 'unknown',
          chain_id: metric.tags?.chainId || 'unknown',
        },
        metric.value
      );
    }

    // Check performance targets
    this.checkPerformanceTargets(metric);
  }

  /**
   * Handle performance alerts
   */
  private handlePerformanceAlert(alert: any): void {
    this.contextLogger.warn('Performance alert received', {
      alertId: alert.alertId,
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
    });

    // Update alert metrics
    alertThresholdGauge.set(
      {
        threshold_type: alert.type,
        provider: 'system',
        severity: alert.severity,
      },
      100
    ); // 100% indicates alert triggered

    this.emit('performanceAlertReceived', alert);
  }

  /**
   * Start performance monitoring loop
   */
  private startPerformanceMonitoring(): void {
    setInterval(async () => {
      if (!this.monitoringEnabled) return;

      try {
        await this.collectPerformanceSnapshot();
        await this.updateWorkerThroughputMetrics();
        await this.updateCachePerformanceMetrics();
      } catch (error) {
        logError(error as Error, { operation: 'performanceMonitoring' });
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Start cost optimization tracking
   */
  private startCostOptimizationTracking(): void {
    setInterval(async () => {
      if (!this.monitoringEnabled) return;

      try {
        await this.updateCostOptimizationMetrics();
        await this.checkCostThresholds();
      } catch (error) {
        logError(error as Error, { operation: 'costOptimizationTracking' });
      }
    }, 60000); // Every minute
  }

  /**
   * Start alerting system
   */
  private startAlertingSystem(): void {
    if (!this.config.alertingEnabled) return;

    setInterval(async () => {
      try {
        await this.processAlertingRules();
      } catch (error) {
        logError(error as Error, { operation: 'alertingSystem' });
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Collect comprehensive performance snapshot
   */
  private async collectPerformanceSnapshot(): Promise<void> {
    const timestamp = Date.now();

    // Get event system metrics
    const eventMetrics = this.eventSystem.getMetrics();

    // Get cost monitoring data
    const costSummary = await this.costMonitoring.getCostSummary('1h');

    // Get system health
    const systemHealth = await this.performanceTracking.getSystemHealth();

    const snapshot: PerformanceSnapshot = {
      timestamp,
      eventMetrics: {
        publishRate: eventMetrics.eventsPerSecond,
        consumeRate: eventMetrics.processedEvents / 60, // per minute to per second
        averageLatency: eventMetrics.averageProcessingTime,
        errorRate:
          eventMetrics.totalEvents > 0
            ? (eventMetrics.failedEvents / eventMetrics.totalEvents) * 100
            : 0,
        queueDepth: eventMetrics.queueLength,
      },
      cacheMetrics: {
        hitRate: costSummary.cacheHitRate * 100,
        warmingSuccessRate: await this.getCacheWarmingSuccessRate(),
        evictionRate: await this.getCacheEvictionRate(),
        totalSize: await this.getCacheTotalSize(),
      },
      workerMetrics: {
        throughput: await this.getWorkerThroughput(),
        utilizationRate: await this.getWorkerUtilization(),
        averageJobTime: await this.getAverageJobTime(),
        errorRate: await this.getWorkerErrorRate(),
      },
      costMetrics: {
        hourlySpend: costSummary.totalCost,
        projectedDaily: costSummary.totalCost * 24,
        projectedMonthly: costSummary.totalCost * 24 * 30,
        savingsRate: this.calculateSavingsRate(costSummary),
        costPerEvent:
          eventMetrics.totalEvents > 0 ? costSummary.totalCost / eventMetrics.totalEvents : 0,
      },
      systemHealth: {
        overallScore: systemHealth.healthScore,
        componentScores: {
          costOptimization: systemHealth.components.costOptimization.score,
          performance: systemHealth.components.performance.score,
          reliability: systemHealth.components.reliability.score,
        },
        activeAlerts: systemHealth.activeAlerts.total,
        criticalIssues: this.extractCriticalIssues(systemHealth),
      },
    };

    // Store snapshot
    this.performanceSnapshots.push(snapshot);

    // Limit snapshot history
    if (this.performanceSnapshots.length > 1000) {
      this.performanceSnapshots = this.performanceSnapshots.slice(-1000);
    }

    // Emit snapshot for external consumption
    this.emit('performanceSnapshot', snapshot);

    this.contextLogger.debug('Performance snapshot collected', {
      timestamp,
      eventLatency: snapshot.eventMetrics.averageLatency,
      cacheHitRate: snapshot.cacheMetrics.hitRate,
      workerThroughput: snapshot.workerMetrics.throughput,
      costPerEvent: snapshot.costMetrics.costPerEvent,
    });
  }

  /**
   * Update worker throughput metrics
   */
  private async updateWorkerThroughputMetrics(): Promise<void> {
    try {
      // Get worker performance data from Redis
      const workerKeys = await redisManager.keys('worker_metrics:*');

      for (const key of workerKeys) {
        const metrics = await redisManager.get(key);
        if (metrics && metrics.throughput) {
          const workerType = key.split(':')[1];

          workerThroughputGauge.set(
            {
              worker_type: workerType,
              chain_id: metrics.chainId || 'unknown',
              operation: metrics.operation || 'unknown',
            },
            metrics.throughput
          );

          // Check throughput targets
          const target = this.config.workerThroughputTargets[workerType];
          if (target && metrics.throughput < target * 0.8) {
            // 80% of target
            this.triggerThroughputAlert(workerType, metrics.throughput, target);
          }
        }
      }
    } catch (error) {
      logError(error as Error, { operation: 'updateWorkerThroughputMetrics' });
    }
  }

  /**
   * Update cache performance metrics
   */
  private async updateCachePerformanceMetrics(): Promise<void> {
    try {
      for (const [cacheType, target] of Object.entries(this.config.cacheHitRateTargets)) {
        const hitRate = await this.getCacheHitRate(cacheType);

        cacheWarmingMetrics.set(
          {
            metric_type: 'hit_rate',
            cache_type: cacheType,
            chain_id: 'all',
          },
          hitRate
        );

        // Check hit rate targets
        if (hitRate < target) {
          this.triggerCacheAlert(cacheType, hitRate, target);
        }
      }
    } catch (error) {
      logError(error as Error, { operation: 'updateCachePerformanceMetrics' });
    }
  }

  /**
   * Update cost optimization metrics
   */
  private async updateCostOptimizationMetrics(): Promise<void> {
    try {
      const costSummary = await this.costMonitoring.getCostSummary('1h');
      const savingsRate = this.calculateSavingsRate(costSummary);

      costSavingsGauge.set(
        {
          optimization_type: 'overall',
          time_period: 'hourly',
        },
        savingsRate
      );

      // Update cost trends
      const dailyProjection = costSummary.totalCost * 24;
      const monthlyProjection = dailyProjection * 30;

      costSavingsGauge.set(
        {
          optimization_type: 'projected_daily',
          time_period: 'current',
        },
        dailyProjection
      );

      costSavingsGauge.set(
        {
          optimization_type: 'projected_monthly',
          time_period: 'current',
        },
        monthlyProjection
      );
    } catch (error) {
      logError(error as Error, { operation: 'updateCostOptimizationMetrics' });
    }
  }

  /**
   * Check cost thresholds
   */
  private async checkCostThresholds(): Promise<void> {
    try {
      const hourlySummary = await this.costMonitoring.getCostSummary('1h');
      const dailySummary = await this.costMonitoring.getCostSummary('24h');

      // Check hourly threshold
      if (hourlySummary.totalCost > this.config.costThresholds.hourly) {
        this.triggerCostAlert('hourly', hourlySummary.totalCost, this.config.costThresholds.hourly);
      }

      // Check daily threshold
      if (dailySummary.totalCost > this.config.costThresholds.daily) {
        this.triggerCostAlert('daily', dailySummary.totalCost, this.config.costThresholds.daily);
      }

      // Check monthly projection
      const monthlyProjection = dailySummary.totalCost * 30;
      if (monthlyProjection > this.config.costThresholds.monthly) {
        this.triggerCostAlert(
          'monthly_projection',
          monthlyProjection,
          this.config.costThresholds.monthly
        );
      }
    } catch (error) {
      logError(error as Error, { operation: 'checkCostThresholds' });
    }
  }

  /**
   * Process alerting rules
   */
  private async processAlertingRules(): Promise<void> {
    if (this.performanceSnapshots.length === 0) return;

    const latest = this.performanceSnapshots[this.performanceSnapshots.length - 1];

    // Check event latency
    if (latest.eventMetrics.averageLatency > this.performanceTargets.eventLatencyP95) {
      this.triggerLatencyAlert(
        { type: 'system', averageLatency: latest.eventMetrics.averageLatency },
        this.performanceTargets.eventLatencyP95
      );
    }

    // Check cache hit rate
    if (latest.cacheMetrics.hitRate < this.performanceTargets.cacheHitRate) {
      this.triggerCacheAlert(
        'overall',
        latest.cacheMetrics.hitRate,
        this.performanceTargets.cacheHitRate
      );
    }

    // Check worker throughput
    if (latest.workerMetrics.throughput < this.performanceTargets.workerThroughput) {
      this.triggerThroughputAlert(
        'overall',
        latest.workerMetrics.throughput,
        this.performanceTargets.workerThroughput
      );
    }

    // Check error rates
    if (latest.eventMetrics.errorRate > this.performanceTargets.errorRate) {
      this.triggerErrorRateAlert(
        'events',
        latest.eventMetrics.errorRate,
        this.performanceTargets.errorRate
      );
    }
  }

  /**
   * Check performance targets for individual metrics
   */
  private checkPerformanceTargets(metric: any): void {
    // Implementation would check specific metric against targets
    // and trigger alerts if thresholds are exceeded
  }

  /**
   * Alert triggering methods
   */
  private triggerLatencyAlert(event: any, threshold: number): void {
    const alertKey = `latency_alert_${event.type}`;
    if (this.isAlertCoolingDown(alertKey)) return;

    this.contextLogger.warn('Latency threshold exceeded', {
      eventType: event.type,
      latency: event.averageLatency || event.processingTime,
      threshold,
    });

    this.emit('alertTriggered', {
      type: 'latency_threshold',
      severity: 'warning',
      message: `Event ${event.type} latency exceeded threshold`,
      details: { latency: event.averageLatency || event.processingTime, threshold },
    });

    this.setAlertCooldown(alertKey);
  }

  private triggerCostAlert(type: string, current: number, threshold: number): void {
    const alertKey = `cost_alert_${type}`;
    if (this.isAlertCoolingDown(alertKey)) return;

    this.contextLogger.warn('Cost threshold exceeded', {
      type,
      current,
      threshold,
      percentageOver: ((current - threshold) / threshold) * 100,
    });

    this.emit('alertTriggered', {
      type: 'cost_threshold',
      severity: current > threshold * 1.2 ? 'critical' : 'warning',
      message: `${type} cost threshold exceeded`,
      details: { current, threshold, type },
    });

    this.setAlertCooldown(alertKey);
  }

  private triggerThroughputAlert(workerType: string, current: number, target: number): void {
    const alertKey = `throughput_alert_${workerType}`;
    if (this.isAlertCoolingDown(alertKey)) return;

    this.contextLogger.warn('Worker throughput below target', {
      workerType,
      current,
      target,
      percentageBelow: ((target - current) / target) * 100,
    });

    this.emit('alertTriggered', {
      type: 'throughput_low',
      severity: 'warning',
      message: `${workerType} throughput below target`,
      details: { current, target, workerType },
    });

    this.setAlertCooldown(alertKey);
  }

  private triggerCacheAlert(cacheType: string, hitRate: number, target: number): void {
    const alertKey = `cache_alert_${cacheType}`;
    if (this.isAlertCoolingDown(alertKey)) return;

    this.contextLogger.warn('Cache hit rate below target', {
      cacheType,
      hitRate,
      target,
    });

    this.emit('alertTriggered', {
      type: 'cache_hit_rate_low',
      severity: 'warning',
      message: `${cacheType} cache hit rate below target`,
      details: { hitRate, target, cacheType },
    });

    this.setAlertCooldown(alertKey);
  }

  private triggerErrorRateAlert(component: string, errorRate: number, threshold: number): void {
    const alertKey = `error_rate_alert_${component}`;
    if (this.isAlertCoolingDown(alertKey)) return;

    this.contextLogger.error('Error rate threshold exceeded', {
      component,
      errorRate,
      threshold,
    });

    this.emit('alertTriggered', {
      type: 'error_rate_high',
      severity: 'critical',
      message: `${component} error rate exceeded threshold`,
      details: { errorRate, threshold, component },
    });

    this.setAlertCooldown(alertKey);
  }

  /**
   * Alert cooldown management
   */
  private isAlertCoolingDown(alertKey: string): boolean {
    const lastTriggered = this.alertCooldowns.get(alertKey) || 0;
    const cooldownPeriod = 5 * 60 * 1000; // 5 minutes
    return Date.now() - lastTriggered < cooldownPeriod;
  }

  private setAlertCooldown(alertKey: string): void {
    this.alertCooldowns.set(alertKey, Date.now());
  }

  /**
   * Helper methods for metric calculation
   */
  private async getCacheWarmingSuccessRate(): Promise<number> {
    try {
      const keys = await redisManager.keys('cache_warm_performance:*');
      let totalRequests = 0;
      let totalSuccesses = 0;

      for (const key of keys) {
        const data = await redisManager.get(key);
        if (data) {
          totalRequests += data.requests || 0;
          totalSuccesses += data.successes || 0;
        }
      }

      return totalRequests > 0 ? (totalSuccesses / totalRequests) * 100 : 0;
    } catch (error) {
      return 0;
    }
  }

  private async getCacheEvictionRate(): Promise<number> {
    // Implementation would calculate cache eviction rate from Redis stats
    return 0;
  }

  private async getCacheTotalSize(): Promise<number> {
    // Implementation would calculate total cache size from Redis
    return 0;
  }

  private async getWorkerThroughput(): Promise<number> {
    try {
      const keys = await redisManager.keys('worker_metrics:*');
      let totalThroughput = 0;

      for (const key of keys) {
        const metrics = await redisManager.get(key);
        if (metrics?.throughput) {
          totalThroughput += metrics.throughput;
        }
      }

      return totalThroughput;
    } catch (error) {
      return 0;
    }
  }

  private async getWorkerUtilization(): Promise<number> {
    // Implementation would calculate worker utilization
    return 0;
  }

  private async getAverageJobTime(): Promise<number> {
    // Implementation would calculate average job processing time
    return 0;
  }

  private async getWorkerErrorRate(): Promise<number> {
    // Implementation would calculate worker error rate
    return 0;
  }

  private async getCacheHitRate(cacheType: string): Promise<number> {
    try {
      const key = `cache_stats:${cacheType}`;
      const stats = await redisManager.get(key);
      if (stats && stats.hits !== undefined && stats.misses !== undefined) {
        const total = stats.hits + stats.misses;
        return total > 0 ? (stats.hits / total) * 100 : 0;
      }
      return 0;
    } catch (error) {
      return 0;
    }
  }

  private calculateSavingsRate(costSummary: any): number {
    // Implementation would calculate actual savings rate from cost summary
    // For now, return a placeholder
    return 0;
  }

  private extractCriticalIssues(systemHealth: any): string[] {
    const issues: string[] = [];

    if (systemHealth.components.costOptimization.score < 60) {
      issues.push('Cost optimization performance degraded');
    }

    if (systemHealth.components.performance.score < 60) {
      issues.push('System performance below threshold');
    }

    if (systemHealth.components.reliability.score < 80) {
      issues.push('Reliability issues detected');
    }

    return issues;
  }

  // Public API methods

  /**
   * Get current performance snapshot
   */
  getCurrentSnapshot(): PerformanceSnapshot | null {
    return this.performanceSnapshots.length > 0
      ? this.performanceSnapshots[this.performanceSnapshots.length - 1]
      : null;
  }

  /**
   * Get performance snapshots for a time range
   */
  getSnapshotsInRange(startTime: number, endTime: number): PerformanceSnapshot[] {
    return this.performanceSnapshots.filter(
      snapshot => snapshot.timestamp >= startTime && snapshot.timestamp <= endTime
    );
  }

  /**
   * Get Prometheus metrics registry
   */
  getMetricsRegistry() {
    return register;
  }

  /**
   * Configure monitoring parameters
   */
  configure(updates: Partial<MonitoringConfiguration>): void {
    Object.assign(this.config, updates);
    this.contextLogger.info('Monitoring configuration updated', updates);
  }

  /**
   * Enable/disable monitoring
   */
  setEnabled(enabled: boolean): void {
    this.monitoringEnabled = enabled;
    this.contextLogger.info('Monitoring status changed', { enabled });
  }

  /**
   * Force metrics collection
   */
  async forceMetricsUpdate(): Promise<void> {
    await this.collectPerformanceSnapshot();
    await this.updateWorkerThroughputMetrics();
    await this.updateCachePerformanceMetrics();
    await this.updateCostOptimizationMetrics();
  }

  /**
   * Get monitoring health status
   */
  getHealthStatus() {
    const latest = this.getCurrentSnapshot();

    return {
      monitoring: {
        enabled: this.monitoringEnabled,
        snapshotsCollected: this.performanceSnapshots.length,
        lastUpdate: latest?.timestamp || 0,
        alertsActive: this.alertCooldowns.size,
      },
      performance: latest
        ? {
            eventLatency: latest.eventMetrics.averageLatency,
            cacheHitRate: latest.cacheMetrics.hitRate,
            workerThroughput: latest.workerMetrics.throughput,
            errorRate: latest.eventMetrics.errorRate,
            overallHealth: latest.systemHealth.overallScore,
          }
        : null,
    };
  }
}

// Export singleton instance
let enhancedMonitoringInstance: EnhancedEventMonitoringService | null = null;

export const getEnhancedEventMonitoringService = (): EnhancedEventMonitoringService => {
  if (!enhancedMonitoringInstance) {
    enhancedMonitoringInstance = new EnhancedEventMonitoringService();
  }
  return enhancedMonitoringInstance;
};

export default getEnhancedEventMonitoringService;
