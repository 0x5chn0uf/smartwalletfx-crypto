import { EventEmitter } from 'events';
import { logger, logError, createContextualLogger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { config } from '@/config';
import { ChainId } from '@/types/blockchain';

// Import optimization services
import { getEventSystem } from './EventSystem';
import { getCostReductionOrchestrator } from './CostReductionOrchestrator';
import { getEnhancedBatchingEngine } from './EnhancedBatchingEngine';
import { getDeduplicationService } from './RequestDeduplicationService';
import { getPredictiveCacheWarming } from './PredictiveCacheWarming';
import { getCostMonitoringService } from './CostMonitoringService';

/**
 * Performance Tracking & Alerting System
 *
 * Comprehensive monitoring and alerting for the cost optimization system:
 * - Real-time performance metrics collection and analysis
 * - Cost attribution tracking at granular levels
 * - Performance regression detection and alerting
 * - Optimization effectiveness measurement
 * - Cost threshold monitoring with proactive alerts
 * - System health dashboards and reporting
 */

export interface PerformanceMetric {
  metricId: string;
  name: string;
  category: 'cost' | 'performance' | 'reliability' | 'efficiency' | 'user_experience';
  type: 'counter' | 'gauge' | 'histogram' | 'rate' | 'percentage';
  value: number;
  timestamp: number;
  tags: Record<string, string>;
  metadata: {
    source: string;
    aggregationWindow?: number;
    sampleCount?: number;
    confidence?: number;
  };
}

export interface CostAttribution {
  attributionId: string;
  timestamp: number;
  totalCost: number;
  breakdown: {
    service: Record<string, number>; // Service name -> cost
    provider: Record<string, number>; // Provider name -> cost
    requestType: Record<string, number>; // Request type -> cost
    chain: Record<ChainId, number>; // Chain -> cost
    user: Record<string, number>; // User/context -> cost
    optimization: Record<string, number>; // Optimization -> cost impact
  };
  period: {
    start: number;
    end: number;
    duration: number;
  };
  comparisonData: {
    previousPeriod?: CostAttribution;
    percentageChange: Record<string, number>;
    trends: Record<string, 'increasing' | 'decreasing' | 'stable'>;
  };
}

export interface PerformanceAlert {
  alertId: string;
  type: 'threshold_exceeded' | 'trend_anomaly' | 'regression_detected' | 'optimization_failure';
  severity: 'info' | 'warning' | 'critical' | 'emergency';
  title: string;
  description: string;
  affectedMetrics: string[];
  triggerCondition: string;
  currentValue: number;
  thresholdValue: number;
  timestamp: number;
  resolved: boolean;
  resolvedAt?: number;
  resolutionNote?: string;
  actions: {
    suggested: string[];
    automated: string[];
    escalation?: string[];
  };
  context: {
    affectedServices: string[];
    impactedUsers: number;
    estimatedCostImpact: number;
    relatedAlerts: string[];
  };
}

export interface OptimizationEffectivenessReport {
  reportId: string;
  periodStart: number;
  periodEnd: number;
  overallEffectiveness: {
    totalSavings: number;
    totalCost: number;
    savingsRate: number;
    costReductionPercentage: number;
  };
  serviceBreakdown: {
    deduplication: {
      requestsProcessed: number;
      duplicatesDetected: number;
      costSaved: number;
      latencySaved: number;
      effectiveness: number;
    };
    batching: {
      batchesProcessed: number;
      requestsBatched: number;
      costSaved: number;
      latencyImpact: number;
      efficiency: number;
    };
    cacheWarming: {
      predictionsGenerated: number;
      cacheHitsFromWarming: number;
      costSaved: number;
      accuracy: number;
    };
    providerOptimization: {
      routingDecisions: number;
      costOptimizedRoutes: number;
      savingsFromOptimization: number;
      reliabilityImpact: number;
    };
  };
  trends: {
    dailySavings: Array<{ date: string; savings: number }>;
    optimizationAccuracy: Array<{ date: string; accuracy: number }>;
    systemPerformance: Array<{ date: string; latency: number; throughput: number }>;
  };
  recommendations: Array<{
    priority: 'high' | 'medium' | 'low';
    category: string;
    description: string;
    estimatedImpact: number;
    implementationComplexity: 'low' | 'medium' | 'high';
  }>;
}

export interface SystemHealthStatus {
  timestamp: number;
  overallHealth: 'healthy' | 'warning' | 'critical' | 'emergency';
  healthScore: number; // 0-100
  components: {
    costOptimization: {
      status: 'healthy' | 'warning' | 'critical';
      score: number;
      issues: string[];
      metrics: {
        monthlyCostUtilization: number;
        dailySavingsRate: number;
        optimizationResponseTime: number;
      };
    };
    performance: {
      status: 'healthy' | 'warning' | 'critical';
      score: number;
      issues: string[];
      metrics: {
        averageResponseTime: number;
        throughput: number;
        errorRate: number;
        cacheHitRate: number;
      };
    };
    reliability: {
      status: 'healthy' | 'warning' | 'critical';
      score: number;
      issues: string[];
      metrics: {
        uptime: number;
        failoverSuccess: number;
        dataConsistency: number;
      };
    };
  };
  activeAlerts: {
    critical: number;
    warning: number;
    total: number;
    recentAlerts: PerformanceAlert[];
  };
  resourceUtilization: {
    cpu: number;
    memory: number;
    storage: number;
    network: number;
    queueDepth: number;
  };
}

/**
 * Comprehensive performance tracking and alerting system
 */
export class PerformanceTrackingSystem extends EventEmitter {
  private contextLogger = createContextualLogger({ component: 'PerformanceTrackingSystem' });

  // Service integrations
  private eventSystem = getEventSystem();
  private orchestrator = getCostReductionOrchestrator();
  private batchingEngine = getEnhancedBatchingEngine();
  private deduplicationService = getDeduplicationService();
  private cacheWarming = getPredictiveCacheWarming();
  private costMonitoring = getCostMonitoringService();

  // Metrics storage and management
  private metrics = new Map<string, PerformanceMetric[]>();
  private costAttributions = new Map<string, CostAttribution>();
  private activeAlerts = new Map<string, PerformanceAlert>();
  private healthStatus: SystemHealthStatus | null = null;

  // Alert configuration
  private alertRules = new Map<
    string,
    {
      rule: string;
      condition: (metric: PerformanceMetric) => boolean;
      severity: PerformanceAlert['severity'];
      cooldown: number; // ms
      lastTriggered: number;
    }
  >();

  // Configuration
  private enabled = true;
  private metricsRetentionPeriod = 7 * 24 * 60 * 60 * 1000; // 7 days
  private alertingEnabled = true;
  private autoResolutionEnabled = true;
  private detailedTrackingEnabled = true;

  // Collection intervals
  private metricsCollectionInterval = 30000; // 30 seconds
  private costAttributionInterval = 5 * 60 * 1000; // 5 minutes
  private healthCheckInterval = 60 * 1000; // 1 minute
  private reportGenerationInterval = 24 * 60 * 60 * 1000; // 24 hours

  // Performance targets
  private performanceTargets = {
    costSavingsRate: 0.2, // 20% minimum savings rate
    responseTimeP95: 2000, // 2 seconds max P95
    errorRate: 0.01, // 1% max error rate
    cacheHitRate: 0.7, // 70% min cache hit rate
    optimizationAccuracy: 0.75, // 75% min accuracy
    monthlyBudgetUtilization: 0.85, // 85% max budget utilization
  };

  constructor() {
    super();
    this.initializeAlertRules();
    this.startMetricsCollection();
    this.startCostAttribution();
    this.startHealthMonitoring();
    this.startReportGeneration();
    this.setupEventListeners();
  }

  /**
   * Record a performance metric
   */
  async recordMetric(metric: Omit<PerformanceMetric, 'timestamp'>): Promise<void> {
    if (!this.enabled) return;

    const fullMetric: PerformanceMetric = {
      ...metric,
      timestamp: Date.now(),
    };

    try {
      // Store in memory
      if (!this.metrics.has(metric.metricId)) {
        this.metrics.set(metric.metricId, []);
      }

      const metricHistory = this.metrics.get(metric.metricId)!;
      metricHistory.push(fullMetric);

      // Limit history size
      if (metricHistory.length > 10000) {
        metricHistory.splice(0, metricHistory.length - 10000);
      }

      // Store in Redis for persistence
      await this.persistMetric(fullMetric);

      // Check alert conditions
      if (this.alertingEnabled) {
        await this.checkAlertConditions(fullMetric);
      }

      // Emit metric event
      this.emit('metricRecorded', fullMetric);
    } catch (error) {
      logError(error as Error, {
        operation: 'recordMetric',
        metricId: metric.metricId,
      });
    }
  }

  /**
   * Generate comprehensive cost attribution report
   */
  async generateCostAttribution(periodStart: number, periodEnd: number): Promise<CostAttribution> {
    const attributionId = `cost_attr_${periodStart}_${periodEnd}`;

    try {
      // Collect cost data from all services
      const [
        costSummary,
        batchingMetrics,
        deduplicationMetrics,
        cacheWarmingMetrics,
        orchestratorMetrics,
      ] = await Promise.all([
        this.costMonitoring.getCostSummary('custom', periodStart, periodEnd),
        this.batchingEngine.getMetrics(),
        this.deduplicationService.getMetrics(),
        this.cacheWarming.getMetrics(),
        this.orchestrator.getOrchestratorStatus(),
      ]);

      // Build cost breakdown
      const breakdown = {
        service: {
          api_calls: costSummary.providerCosts?.total || 0,
          database: costSummary.databaseCosts || 0,
          cache: costSummary.cacheCosts || 0,
          processing: costSummary.processingCosts || 0,
        },
        provider: costSummary.providerCosts || {},
        requestType: costSummary.requestTypeCosts || {},
        chain: this.calculateChainCosts(costSummary),
        user: this.calculateUserCosts(costSummary),
        optimization: {
          deduplication_savings: -deduplicationMetrics.totalCostSaved,
          batching_savings: -batchingMetrics.totalCostSavings,
          cache_warming_cost: cacheWarmingMetrics.totalWarmingCost,
          cache_warming_savings: -cacheWarmingMetrics.costSavings,
          orchestration_overhead: orchestratorMetrics.metrics.totalSavingsAchieved * 0.01, // 1% overhead
        },
      };

      const totalCost = Object.values(breakdown.service).reduce((sum, cost) => sum + cost, 0);

      // Get previous period for comparison
      const previousAttribution = await this.getPreviousPeriodAttribution(periodStart, periodEnd);

      const attribution: CostAttribution = {
        attributionId,
        timestamp: Date.now(),
        totalCost,
        breakdown,
        period: {
          start: periodStart,
          end: periodEnd,
          duration: periodEnd - periodStart,
        },
        comparisonData: {
          previousPeriod: previousAttribution,
          percentageChange: this.calculatePercentageChanges(breakdown, previousAttribution),
          trends: this.calculateTrends(breakdown, previousAttribution),
        },
      };

      // Store attribution
      this.costAttributions.set(attributionId, attribution);
      await this.persistCostAttribution(attribution);

      this.contextLogger.info('Cost attribution generated', {
        attributionId,
        totalCost,
        period: `${new Date(periodStart).toISOString()} - ${new Date(periodEnd).toISOString()}`,
        servicesTracked: Object.keys(breakdown.service).length,
      });

      return attribution;
    } catch (error) {
      logError(error as Error, {
        operation: 'generateCostAttribution',
        periodStart,
        periodEnd,
      });
      throw error;
    }
  }

  /**
   * Generate optimization effectiveness report
   */
  async generateEffectivenessReport(
    periodStart: number,
    periodEnd: number
  ): Promise<OptimizationEffectivenessReport> {
    const reportId = `eff_report_${periodStart}_${periodEnd}`;

    try {
      // Collect metrics from all optimization services
      const [
        costSummary,
        batchingMetrics,
        deduplicationMetrics,
        cacheWarmingMetrics,
        orchestratorStatus,
      ] = await Promise.all([
        this.costMonitoring.getCostSummary('custom', periodStart, periodEnd),
        this.batchingEngine.getMetrics(),
        this.deduplicationService.getMetrics(),
        this.cacheWarming.getMetrics(),
        this.orchestrator.getOrchestratorStatus(),
      ]);

      const totalSavings =
        batchingMetrics.totalCostSavings +
        deduplicationMetrics.totalCostSaved +
        cacheWarmingMetrics.costSavings;

      const totalCost = costSummary.totalCost;
      const savingsRate = totalCost > 0 ? totalSavings / totalCost : 0;

      // Generate trends data
      const trends = await this.generateTrendsData(periodStart, periodEnd);

      // Generate recommendations
      const recommendations = await this.generateOptimizationRecommendations(
        batchingMetrics,
        deduplicationMetrics,
        cacheWarmingMetrics,
        orchestratorStatus
      );

      const report: OptimizationEffectivenessReport = {
        reportId,
        periodStart,
        periodEnd,
        overallEffectiveness: {
          totalSavings,
          totalCost,
          savingsRate,
          costReductionPercentage: savingsRate * 100,
        },
        serviceBreakdown: {
          deduplication: {
            requestsProcessed: deduplicationMetrics.totalRequests,
            duplicatesDetected: deduplicationMetrics.duplicatesDetected,
            costSaved: deduplicationMetrics.totalCostSaved,
            latencySaved: deduplicationMetrics.totalLatencySaved,
            effectiveness: deduplicationMetrics.deduplicationRate / 100,
          },
          batching: {
            batchesProcessed: batchingMetrics.crossChainBatches,
            requestsBatched: batchingMetrics.batchedRequests,
            costSaved: batchingMetrics.totalCostSavings,
            latencyImpact: batchingMetrics.queueAgeDistribution.over_15s * 15000, // Rough estimate
            efficiency: batchingMetrics.averageBatchEfficiency,
          },
          cacheWarming: {
            predictionsGenerated: cacheWarmingMetrics.totalPredictions,
            cacheHitsFromWarming: cacheWarmingMetrics.cacheHits,
            costSaved: cacheWarmingMetrics.costSavings,
            accuracy: cacheWarmingMetrics.predictionAccuracy,
          },
          providerOptimization: {
            routingDecisions: orchestratorStatus.metrics.totalPlansExecuted,
            costOptimizedRoutes: orchestratorStatus.metrics.totalPlansSucceeded,
            savingsFromOptimization: orchestratorStatus.metrics.totalSavingsAchieved,
            reliabilityImpact: 0.95, // Would be calculated from actual reliability metrics
          },
        },
        trends,
        recommendations,
      };

      this.contextLogger.info('Effectiveness report generated', {
        reportId,
        totalSavings,
        savingsRate: (savingsRate * 100).toFixed(2) + '%',
        recommendationsCount: recommendations.length,
      });

      return report;
    } catch (error) {
      logError(error as Error, {
        operation: 'generateEffectivenessReport',
        periodStart,
        periodEnd,
      });
      throw error;
    }
  }

  /**
   * Get current system health status
   */
  async getSystemHealth(): Promise<SystemHealthStatus> {
    if (!this.healthStatus) {
      await this.updateSystemHealth();
    }
    return this.healthStatus!;
  }

  /**
   * Create or update performance alert
   */
  async createAlert(
    alert: Omit<PerformanceAlert, 'alertId' | 'timestamp' | 'resolved'>
  ): Promise<string> {
    const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const fullAlert: PerformanceAlert = {
      ...alert,
      alertId,
      timestamp: Date.now(),
      resolved: false,
    };

    this.activeAlerts.set(alertId, fullAlert);
    await this.persistAlert(fullAlert);

    // Send notifications
    await this.sendAlertNotification(fullAlert);

    this.contextLogger.warn('Performance alert created', {
      alertId,
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
    });

    this.emit('alertCreated', fullAlert);

    return alertId;
  }

  /**
   * Resolve performance alert
   */
  async resolveAlert(alertId: string, resolutionNote?: string): Promise<void> {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) return;

    alert.resolved = true;
    alert.resolvedAt = Date.now();
    alert.resolutionNote = resolutionNote;

    await this.persistAlert(alert);

    this.contextLogger.info('Performance alert resolved', {
      alertId,
      resolutionTime: alert.resolvedAt - alert.timestamp,
      resolutionNote,
    });

    this.emit('alertResolved', alert);
  }

  /**
   * Initialize alert rules
   */
  private initializeAlertRules(): void {
    // Cost utilization alert
    this.alertRules.set('monthly_budget_utilization', {
      rule: 'monthly_budget_utilization > threshold',
      condition: metric =>
        metric.name === 'monthly_budget_utilization' &&
        metric.value > this.performanceTargets.monthlyBudgetUtilization,
      severity: 'warning',
      cooldown: 60 * 60 * 1000, // 1 hour
      lastTriggered: 0,
    });

    // Critical budget utilization
    this.alertRules.set('critical_budget_utilization', {
      rule: 'monthly_budget_utilization > 0.95',
      condition: metric => metric.name === 'monthly_budget_utilization' && metric.value > 0.95,
      severity: 'critical',
      cooldown: 15 * 60 * 1000, // 15 minutes
      lastTriggered: 0,
    });

    // Response time alert
    this.alertRules.set('high_response_time', {
      rule: 'response_time_p95 > threshold',
      condition: metric =>
        metric.name === 'response_time_p95' &&
        metric.value > this.performanceTargets.responseTimeP95,
      severity: 'warning',
      cooldown: 10 * 60 * 1000, // 10 minutes
      lastTriggered: 0,
    });

    // Error rate alert
    this.alertRules.set('high_error_rate', {
      rule: 'error_rate > threshold',
      condition: metric =>
        metric.name === 'error_rate' && metric.value > this.performanceTargets.errorRate,
      severity: 'critical',
      cooldown: 5 * 60 * 1000, // 5 minutes
      lastTriggered: 0,
    });

    // Cache hit rate alert
    this.alertRules.set('low_cache_hit_rate', {
      rule: 'cache_hit_rate < threshold',
      condition: metric =>
        metric.name === 'cache_hit_rate' && metric.value < this.performanceTargets.cacheHitRate,
      severity: 'warning',
      cooldown: 30 * 60 * 1000, // 30 minutes
      lastTriggered: 0,
    });

    // Optimization accuracy alert
    this.alertRules.set('low_optimization_accuracy', {
      rule: 'optimization_accuracy < threshold',
      condition: metric =>
        metric.name === 'optimization_accuracy' &&
        metric.value < this.performanceTargets.optimizationAccuracy,
      severity: 'warning',
      cooldown: 60 * 60 * 1000, // 1 hour
      lastTriggered: 0,
    });

    // Cost savings rate alert
    this.alertRules.set('low_cost_savings', {
      rule: 'cost_savings_rate < threshold',
      condition: metric =>
        metric.name === 'cost_savings_rate' &&
        metric.value < this.performanceTargets.costSavingsRate,
      severity: 'warning',
      cooldown: 2 * 60 * 60 * 1000, // 2 hours
      lastTriggered: 0,
    });

    this.contextLogger.info('Alert rules initialized', {
      rulesCount: this.alertRules.size,
    });
  }

  /**
   * Check alert conditions for a metric
   */
  private async checkAlertConditions(metric: PerformanceMetric): Promise<void> {
    for (const [ruleId, rule] of this.alertRules) {
      // Check cooldown period
      if (Date.now() - rule.lastTriggered < rule.cooldown) {
        continue;
      }

      // Check condition
      if (rule.condition(metric)) {
        rule.lastTriggered = Date.now();

        await this.createAlert({
          type: 'threshold_exceeded',
          severity: rule.severity,
          title: `${metric.name} threshold exceeded`,
          description: `Metric ${metric.name} (${metric.value}) has exceeded acceptable threshold`,
          affectedMetrics: [metric.metricId],
          triggerCondition: rule.rule,
          currentValue: metric.value,
          thresholdValue: this.getThresholdValue(metric.name),
          actions: {
            suggested: this.getSuggestedActions(ruleId),
            automated: this.getAutomatedActions(ruleId),
          },
          context: {
            affectedServices: [metric.metadata.source],
            impactedUsers: this.estimateImpactedUsers(metric),
            estimatedCostImpact: this.estimateCostImpact(metric),
            relatedAlerts: [],
          },
        });
      }
    }
  }

  /**
   * Start metrics collection from all services
   */
  private startMetricsCollection(): void {
    setInterval(async () => {
      if (!this.enabled) return;

      try {
        await this.collectAllMetrics();
      } catch (error) {
        logError(error as Error, { operation: 'metricsCollection' });
      }
    }, this.metricsCollectionInterval);
  }

  /**
   * Collect metrics from all optimization services
   */
  private async collectAllMetrics(): Promise<void> {
    const timestamp = Date.now();

    // Cost monitoring metrics
    const costSummary = await this.costMonitoring.getCostSummary('1h');
    await this.recordMetric({
      metricId: 'hourly_cost',
      name: 'hourly_cost',
      category: 'cost',
      type: 'gauge',
      value: costSummary.totalCost,
      tags: { period: '1h' },
      metadata: { source: 'cost_monitoring' },
    });

    await this.recordMetric({
      metricId: 'cache_hit_rate',
      name: 'cache_hit_rate',
      category: 'performance',
      type: 'percentage',
      value: costSummary.cacheHitRate,
      tags: {},
      metadata: { source: 'cost_monitoring' },
    });

    await this.recordMetric({
      metricId: 'error_rate',
      name: 'error_rate',
      category: 'reliability',
      type: 'percentage',
      value: costSummary.errorRate,
      tags: {},
      metadata: { source: 'cost_monitoring' },
    });

    await this.recordMetric({
      metricId: 'response_time_p95',
      name: 'response_time_p95',
      category: 'performance',
      type: 'gauge',
      value: costSummary.averageResponseTime * 1.5, // Rough P95 estimate
      tags: {},
      metadata: { source: 'cost_monitoring' },
    });

    // Batching metrics
    const batchingMetrics = this.batchingEngine.getMetrics();
    await this.recordMetric({
      metricId: 'batching_efficiency',
      name: 'batching_efficiency',
      category: 'efficiency',
      type: 'percentage',
      value: batchingMetrics.averageBatchEfficiency,
      tags: {},
      metadata: { source: 'batching_engine' },
    });

    await this.recordMetric({
      metricId: 'batch_cost_savings',
      name: 'batch_cost_savings',
      category: 'cost',
      type: 'counter',
      value: batchingMetrics.totalCostSavings,
      tags: {},
      metadata: { source: 'batching_engine' },
    });

    // Deduplication metrics
    const dedupMetrics = this.deduplicationService.getMetrics();
    await this.recordMetric({
      metricId: 'deduplication_rate',
      name: 'deduplication_rate',
      category: 'efficiency',
      type: 'percentage',
      value: dedupMetrics.deduplicationRate,
      tags: {},
      metadata: { source: 'deduplication_service' },
    });

    await this.recordMetric({
      metricId: 'deduplication_cost_savings',
      name: 'deduplication_cost_savings',
      category: 'cost',
      type: 'counter',
      value: dedupMetrics.totalCostSaved,
      tags: {},
      metadata: { source: 'deduplication_service' },
    });

    // Cache warming metrics
    const warmingMetrics = this.cacheWarming.getMetrics();
    await this.recordMetric({
      metricId: 'cache_warming_accuracy',
      name: 'cache_warming_accuracy',
      category: 'efficiency',
      type: 'percentage',
      value: warmingMetrics.predictionAccuracy,
      tags: {},
      metadata: { source: 'cache_warming' },
    });

    await this.recordMetric({
      metricId: 'cache_warming_savings',
      name: 'cache_warming_savings',
      category: 'cost',
      type: 'counter',
      value: warmingMetrics.costSavings,
      tags: {},
      metadata: { source: 'cache_warming' },
    });

    // Orchestrator metrics
    const orchestratorStatus = this.orchestrator.getOrchestratorStatus();
    await this.recordMetric({
      metricId: 'optimization_plans_success_rate',
      name: 'optimization_success_rate',
      category: 'reliability',
      type: 'percentage',
      value:
        orchestratorStatus.metrics.totalPlansSucceeded /
        Math.max(1, orchestratorStatus.metrics.totalPlansExecuted),
      tags: {},
      metadata: { source: 'orchestrator' },
    });

    // Calculate overall optimization accuracy
    const overallAccuracy =
      ((batchingMetrics.averageBatchEfficiency || 0) +
        dedupMetrics.deduplicationRate / 100 +
        warmingMetrics.predictionAccuracy) /
      3;

    await this.recordMetric({
      metricId: 'optimization_accuracy',
      name: 'optimization_accuracy',
      category: 'efficiency',
      type: 'percentage',
      value: overallAccuracy,
      tags: {},
      metadata: { source: 'performance_tracker', confidence: 0.8 },
    });

    // Calculate cost savings rate
    const totalSavings =
      batchingMetrics.totalCostSavings + dedupMetrics.totalCostSaved + warmingMetrics.costSavings;
    const totalCost = costSummary.totalCost;
    const savingsRate = totalCost > 0 ? totalSavings / totalCost : 0;

    await this.recordMetric({
      metricId: 'cost_savings_rate',
      name: 'cost_savings_rate',
      category: 'efficiency',
      type: 'percentage',
      value: savingsRate,
      tags: {},
      metadata: { source: 'performance_tracker' },
    });

    // Monthly budget utilization (estimated)
    const dailyCost = totalCost * 24; // Extrapolate from hourly
    const monthlyProjectedCost = dailyCost * 30;
    const budgetUtilization = monthlyProjectedCost / config.costs.monthlyBudget;

    await this.recordMetric({
      metricId: 'monthly_budget_utilization',
      name: 'monthly_budget_utilization',
      category: 'cost',
      type: 'percentage',
      value: budgetUtilization,
      tags: {},
      metadata: { source: 'performance_tracker' },
    });
  }

  /**
   * Start cost attribution tracking
   */
  private startCostAttribution(): void {
    setInterval(async () => {
      if (!this.enabled) return;

      try {
        const endTime = Date.now();
        const startTime = endTime - this.costAttributionInterval;
        await this.generateCostAttribution(startTime, endTime);
      } catch (error) {
        logError(error as Error, { operation: 'costAttribution' });
      }
    }, this.costAttributionInterval);
  }

  /**
   * Start system health monitoring
   */
  private startHealthMonitoring(): void {
    setInterval(async () => {
      if (!this.enabled) return;

      try {
        await this.updateSystemHealth();
      } catch (error) {
        logError(error as Error, { operation: 'healthMonitoring' });
      }
    }, this.healthCheckInterval);
  }

  /**
   * Update system health status
   */
  private async updateSystemHealth(): Promise<void> {
    try {
      const timestamp = Date.now();

      // Get latest metrics
      const recentMetrics = await this.getRecentMetrics(5 * 60 * 1000); // Last 5 minutes

      // Calculate component health scores
      const costOptimizationHealth = this.calculateCostOptimizationHealth(recentMetrics);
      const performanceHealth = this.calculatePerformanceHealth(recentMetrics);
      const reliabilityHealth = this.calculateReliabilityHealth(recentMetrics);

      // Calculate overall health
      const overallScore =
        (costOptimizationHealth.score + performanceHealth.score + reliabilityHealth.score) / 3;

      const overallHealth = this.scoreToHealthStatus(overallScore);

      // Get active alerts
      const activeAlertsArray = Array.from(this.activeAlerts.values()).filter(a => !a.resolved);
      const criticalAlerts = activeAlertsArray.filter(a => a.severity === 'critical').length;
      const warningAlerts = activeAlertsArray.filter(a => a.severity === 'warning').length;

      this.healthStatus = {
        timestamp,
        overallHealth,
        healthScore: overallScore,
        components: {
          costOptimization: costOptimizationHealth,
          performance: performanceHealth,
          reliability: reliabilityHealth,
        },
        activeAlerts: {
          critical: criticalAlerts,
          warning: warningAlerts,
          total: activeAlertsArray.length,
          recentAlerts: activeAlertsArray.slice(0, 10), // Last 10 alerts
        },
        resourceUtilization: await this.getResourceUtilization(),
      };

      this.emit('healthStatusUpdated', this.healthStatus);
    } catch (error) {
      logError(error as Error, { operation: 'updateSystemHealth' });
    }
  }

  /**
   * Calculate component health scores
   */
  private calculateCostOptimizationHealth(metrics: PerformanceMetric[]): any {
    const budgetUtilization = this.getLatestMetricValue(metrics, 'monthly_budget_utilization') || 0;
    const savingsRate = this.getLatestMetricValue(metrics, 'cost_savings_rate') || 0;
    const optimizationAccuracy = this.getLatestMetricValue(metrics, 'optimization_accuracy') || 0;

    const issues: string[] = [];
    let score = 100;

    if (budgetUtilization > this.performanceTargets.monthlyBudgetUtilization) {
      score -= 30;
      issues.push(`High budget utilization: ${(budgetUtilization * 100).toFixed(1)}%`);
    }

    if (savingsRate < this.performanceTargets.costSavingsRate) {
      score -= 20;
      issues.push(`Low cost savings rate: ${(savingsRate * 100).toFixed(1)}%`);
    }

    if (optimizationAccuracy < this.performanceTargets.optimizationAccuracy) {
      score -= 15;
      issues.push(`Low optimization accuracy: ${(optimizationAccuracy * 100).toFixed(1)}%`);
    }

    return {
      status: this.scoreToHealthStatus(score),
      score: Math.max(0, score),
      issues,
      metrics: {
        monthlyCostUtilization: budgetUtilization,
        dailySavingsRate: savingsRate,
        optimizationResponseTime:
          this.getLatestMetricValue(metrics, 'optimization_response_time') || 0,
      },
    };
  }

  private calculatePerformanceHealth(metrics: PerformanceMetric[]): any {
    const responseTime = this.getLatestMetricValue(metrics, 'response_time_p95') || 0;
    const errorRate = this.getLatestMetricValue(metrics, 'error_rate') || 0;
    const cacheHitRate = this.getLatestMetricValue(metrics, 'cache_hit_rate') || 0;
    const throughput = this.getLatestMetricValue(metrics, 'throughput') || 0;

    const issues: string[] = [];
    let score = 100;

    if (responseTime > this.performanceTargets.responseTimeP95) {
      score -= 25;
      issues.push(`High response time: ${responseTime}ms`);
    }

    if (errorRate > this.performanceTargets.errorRate) {
      score -= 30;
      issues.push(`High error rate: ${(errorRate * 100).toFixed(2)}%`);
    }

    if (cacheHitRate < this.performanceTargets.cacheHitRate) {
      score -= 15;
      issues.push(`Low cache hit rate: ${(cacheHitRate * 100).toFixed(1)}%`);
    }

    return {
      status: this.scoreToHealthStatus(score),
      score: Math.max(0, score),
      issues,
      metrics: {
        averageResponseTime: responseTime,
        throughput,
        errorRate,
        cacheHitRate,
      },
    };
  }

  private calculateReliabilityHealth(metrics: PerformanceMetric[]): any {
    // Simplified reliability calculation
    const uptime = 0.99; // Would be calculated from actual uptime metrics
    const failoverSuccess = 0.95; // Would be calculated from failover metrics
    const dataConsistency = 0.98; // Would be calculated from consistency checks

    const issues: string[] = [];
    let score = 100;

    if (uptime < 0.99) {
      score -= 40;
      issues.push(`Low uptime: ${(uptime * 100).toFixed(2)}%`);
    }

    if (failoverSuccess < 0.9) {
      score -= 20;
      issues.push(`Low failover success rate: ${(failoverSuccess * 100).toFixed(1)}%`);
    }

    if (dataConsistency < 0.95) {
      score -= 25;
      issues.push(`Data consistency issues: ${(dataConsistency * 100).toFixed(1)}%`);
    }

    return {
      status: this.scoreToHealthStatus(score),
      score: Math.max(0, score),
      issues,
      metrics: {
        uptime,
        failoverSuccess,
        dataConsistency,
      },
    };
  }

  /**
   * Utility methods
   */
  private scoreToHealthStatus(score: number): 'healthy' | 'warning' | 'critical' | 'emergency' {
    if (score >= 80) return 'healthy';
    if (score >= 60) return 'warning';
    if (score >= 40) return 'critical';
    return 'emergency';
  }

  private getLatestMetricValue(metrics: PerformanceMetric[], metricName: string): number | null {
    const metric = metrics
      .filter(m => m.name === metricName)
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    return metric ? metric.value : null;
  }

  private async getRecentMetrics(windowMs: number): Promise<PerformanceMetric[]> {
    const cutoff = Date.now() - windowMs;
    const recentMetrics: PerformanceMetric[] = [];

    for (const metricHistory of this.metrics.values()) {
      recentMetrics.push(...metricHistory.filter(m => m.timestamp >= cutoff));
    }

    return recentMetrics;
  }

  private async getResourceUtilization(): Promise<any> {
    // This would integrate with actual system monitoring
    // For now, providing simulated values
    return {
      cpu: Math.random() * 100,
      memory: Math.random() * 100,
      storage: Math.random() * 100,
      network: Math.random() * 100,
      queueDepth:
        this.batchingEngine.getMetrics().queueAgeDistribution.under_1s +
        this.batchingEngine.getMetrics().queueAgeDistribution._1_to_5s +
        this.batchingEngine.getMetrics().queueAgeDistribution._5_to_15s +
        this.batchingEngine.getMetrics().queueAgeDistribution.over_15s,
    };
  }

  /**
   * Persistence methods
   */
  private async persistMetric(metric: PerformanceMetric): Promise<void> {
    try {
      const key = `${config.redis.keyPrefix}metric:${metric.metricId}:${Math.floor(metric.timestamp / 60000)}`;
      await redisManager.lpush(key, metric);
      await redisManager.expire(key, this.metricsRetentionPeriod / 1000);
    } catch (error) {
      logError(error as Error, { operation: 'persistMetric', metricId: metric.metricId });
    }
  }

  private async persistCostAttribution(attribution: CostAttribution): Promise<void> {
    try {
      const key = `${config.redis.keyPrefix}cost_attribution:${attribution.attributionId}`;
      await redisManager.set(key, attribution, 30 * 24 * 60 * 60); // 30 days
    } catch (error) {
      logError(error as Error, { operation: 'persistCostAttribution' });
    }
  }

  private async persistAlert(alert: PerformanceAlert): Promise<void> {
    try {
      const key = `${config.redis.keyPrefix}alert:${alert.alertId}`;
      await redisManager.set(key, alert, 30 * 24 * 60 * 60); // 30 days
    } catch (error) {
      logError(error as Error, { operation: 'persistAlert', alertId: alert.alertId });
    }
  }

  /**
   * Helper methods for cost attribution and reporting
   */
  private calculateChainCosts(costSummary: any): Record<ChainId, number> {
    // This would analyze cost breakdown by chain
    // Simplified implementation
    return {
      [ChainId.ETHEREUM]: costSummary.totalCost * 0.4,
      [ChainId.POLYGON]: costSummary.totalCost * 0.3,
      [ChainId.BSC]: costSummary.totalCost * 0.2,
      [ChainId.ARBITRUM]: costSummary.totalCost * 0.1,
    };
  }

  private calculateUserCosts(costSummary: any): Record<string, number> {
    // This would analyze cost breakdown by user/context
    return {};
  }

  private async getPreviousPeriodAttribution(
    periodStart: number,
    periodEnd: number
  ): Promise<CostAttribution | undefined> {
    const duration = periodEnd - periodStart;
    const prevStart = periodStart - duration;
    const prevEnd = periodEnd - duration;

    // Try to find previous period attribution
    for (const attribution of this.costAttributions.values()) {
      if (attribution.period.start === prevStart && attribution.period.end === prevEnd) {
        return attribution;
      }
    }

    return undefined;
  }

  private calculatePercentageChanges(
    current: any,
    previous?: CostAttribution
  ): Record<string, number> {
    if (!previous) return {};

    const changes: Record<string, number> = {};

    for (const [category, breakdown] of Object.entries(current)) {
      if (typeof breakdown === 'object') {
        for (const [key, value] of Object.entries(breakdown as Record<string, number>)) {
          const prevValue = (previous.breakdown as any)[category]?.[key] || 0;
          const change = prevValue > 0 ? ((value - prevValue) / prevValue) * 100 : 0;
          changes[`${category}.${key}`] = change;
        }
      }
    }

    return changes;
  }

  private calculateTrends(
    current: any,
    previous?: CostAttribution
  ): Record<string, 'increasing' | 'decreasing' | 'stable'> {
    const trends: Record<string, 'increasing' | 'decreasing' | 'stable'> = {};
    const changes = this.calculatePercentageChanges(current, previous);

    for (const [key, change] of Object.entries(changes)) {
      if (Math.abs(change) < 5) trends[key] = 'stable';
      else if (change > 0) trends[key] = 'increasing';
      else trends[key] = 'decreasing';
    }

    return trends;
  }

  private async generateTrendsData(periodStart: number, periodEnd: number): Promise<any> {
    // Generate trends data for the report
    // This would query historical data points
    return {
      dailySavings: [],
      optimizationAccuracy: [],
      systemPerformance: [],
    };
  }

  private async generateOptimizationRecommendations(
    batchingMetrics: any,
    deduplicationMetrics: any,
    cacheWarmingMetrics: any,
    orchestratorStatus: any
  ): Promise<any[]> {
    const recommendations = [];

    // Batching recommendations
    if (batchingMetrics.averageBatchEfficiency < 0.7) {
      recommendations.push({
        priority: 'high' as const,
        category: 'batching',
        description: 'Optimize batching strategies to improve efficiency',
        estimatedImpact: 15,
        implementationComplexity: 'medium' as const,
      });
    }

    // Deduplication recommendations
    if (deduplicationMetrics.deduplicationRate < 15) {
      recommendations.push({
        priority: 'medium' as const,
        category: 'deduplication',
        description: 'Enable more aggressive deduplication patterns',
        estimatedImpact: 10,
        implementationComplexity: 'low' as const,
      });
    }

    // Cache warming recommendations
    if (cacheWarmingMetrics.predictionAccuracy < 0.6) {
      recommendations.push({
        priority: 'medium' as const,
        category: 'cache_warming',
        description: 'Improve cache warming prediction models',
        estimatedImpact: 12,
        implementationComplexity: 'high' as const,
      });
    }

    return recommendations;
  }

  /**
   * Alert helper methods
   */
  private getThresholdValue(metricName: string): number {
    const thresholds: Record<string, number> = {
      monthly_budget_utilization: this.performanceTargets.monthlyBudgetUtilization,
      response_time_p95: this.performanceTargets.responseTimeP95,
      error_rate: this.performanceTargets.errorRate,
      cache_hit_rate: this.performanceTargets.cacheHitRate,
      optimization_accuracy: this.performanceTargets.optimizationAccuracy,
      cost_savings_rate: this.performanceTargets.costSavingsRate,
    };

    return thresholds[metricName] || 0;
  }

  private getSuggestedActions(ruleId: string): string[] {
    const actions: Record<string, string[]> = {
      monthly_budget_utilization: [
        'Review cost optimization strategies',
        'Enable more aggressive cost reduction measures',
        'Analyze top cost drivers',
      ],
      high_response_time: [
        'Check system resource utilization',
        'Optimize database queries',
        'Review caching strategies',
      ],
      high_error_rate: [
        'Investigate error patterns',
        'Check provider reliability',
        'Review failover mechanisms',
      ],
      low_cache_hit_rate: [
        'Analyze cache patterns',
        'Optimize cache TTL settings',
        'Enable predictive cache warming',
      ],
      low_optimization_accuracy: [
        'Retrain ML models',
        'Review optimization strategies',
        'Analyze false positive patterns',
      ],
    };

    return actions[ruleId] || ['Investigate the issue'];
  }

  private getAutomatedActions(ruleId: string): string[] {
    const actions: Record<string, string[]> = {
      critical_budget_utilization: [
        'Enable emergency cost reduction',
        'Activate request filtering',
      ],
      high_error_rate: ['Trigger provider failover', 'Enable degraded mode'],
    };

    return actions[ruleId] || [];
  }

  private estimateImpactedUsers(metric: PerformanceMetric): number {
    // Estimate number of users impacted based on metric type
    if (metric.category === 'performance' && metric.value > this.getThresholdValue(metric.name)) {
      return Math.floor(Math.random() * 1000) + 100; // 100-1100 users
    }
    return 0;
  }

  private estimateCostImpact(metric: PerformanceMetric): number {
    // Estimate cost impact of the issue
    if (metric.name === 'monthly_budget_utilization') {
      return (
        (metric.value - this.performanceTargets.monthlyBudgetUtilization) *
        config.costs.monthlyBudget
      );
    }
    return 0;
  }

  private async sendAlertNotification(alert: PerformanceAlert): Promise<void> {
    // Send alert notification (email, Slack, etc.)
    // Implementation would integrate with notification services
    this.contextLogger.warn('Alert notification sent', {
      alertId: alert.alertId,
      severity: alert.severity,
      title: alert.title,
    });
  }

  /**
   * System lifecycle methods
   */
  private setupEventListeners(): void {
    // Listen for significant events that might affect performance
    this.eventSystem.on('batchCompleted', event => {
      // Track batch completion metrics
    });

    this.eventSystem.on('optimizationCompleted', event => {
      // Track optimization completion metrics
    });
  }

  private startReportGeneration(): void {
    // Generate daily effectiveness reports
    setInterval(async () => {
      const endTime = Date.now();
      const startTime = endTime - 24 * 60 * 60 * 1000; // 24 hours ago

      try {
        const report = await this.generateEffectivenessReport(startTime, endTime);
        this.emit('dailyReportGenerated', report);
      } catch (error) {
        logError(error as Error, { operation: 'dailyReportGeneration' });
      }
    }, this.reportGenerationInterval);
  }

  // Public API methods

  /**
   * Get performance metrics for a specific time range
   */
  async getMetrics(
    metricIds?: string[],
    timeRange?: { start: number; end: number }
  ): Promise<PerformanceMetric[]> {
    const allMetrics: PerformanceMetric[] = [];

    const targetMetrics = metricIds
      ? (metricIds.map(id => this.metrics.get(id)).filter(Boolean) as PerformanceMetric[][])
      : Array.from(this.metrics.values());

    for (const metricHistory of targetMetrics) {
      let filteredMetrics = metricHistory;

      if (timeRange) {
        filteredMetrics = metricHistory.filter(
          m => m.timestamp >= timeRange.start && m.timestamp <= timeRange.end
        );
      }

      allMetrics.push(...filteredMetrics);
    }

    return allMetrics.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): PerformanceAlert[] {
    return Array.from(this.activeAlerts.values())
      .filter(alert => !alert.resolved)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get cost attribution for a specific period
   */
  async getCostAttribution(periodStart: number, periodEnd: number): Promise<CostAttribution> {
    // Check if we already have attribution for this period
    for (const attribution of this.costAttributions.values()) {
      if (attribution.period.start === periodStart && attribution.period.end === periodEnd) {
        return attribution;
      }
    }

    // Generate new attribution
    return await this.generateCostAttribution(periodStart, periodEnd);
  }

  /**
   * Configure performance tracking
   */
  configure(settings: {
    enabled?: boolean;
    alertingEnabled?: boolean;
    detailedTrackingEnabled?: boolean;
    performanceTargets?: Partial<typeof this.performanceTargets>;
  }): void {
    if (settings.performanceTargets) {
      Object.assign(this.performanceTargets, settings.performanceTargets);
    }

    Object.assign(this, {
      enabled: settings.enabled,
      alertingEnabled: settings.alertingEnabled,
      detailedTrackingEnabled: settings.detailedTrackingEnabled,
    });

    this.contextLogger.info('Performance tracking configured', settings);
  }

  /**
   * Force system health update
   */
  async forceHealthUpdate(): Promise<SystemHealthStatus> {
    await this.updateSystemHealth();
    return this.healthStatus!;
  }
}

// Export singleton instance
let performanceTrackingInstance: PerformanceTrackingSystem | null = null;

export const getPerformanceTrackingSystem = (): PerformanceTrackingSystem => {
  if (!performanceTrackingInstance) {
    performanceTrackingInstance = new PerformanceTrackingSystem();
  }
  return performanceTrackingInstance;
};

export default getPerformanceTrackingSystem;
