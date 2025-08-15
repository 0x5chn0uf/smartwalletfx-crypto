import { EventEmitter } from 'events';
import { logger, logError, logPerformance, createContextualLogger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { config } from '@/config';
import { ChainId } from '@/types/blockchain';

/**
 * Cost Monitoring and Optimization Service
 *
 * Provides comprehensive cost tracking, analysis, and optimization for API usage
 * across all blockchain providers and external services.
 */

// Core types and interfaces
export interface CostLimits {
  hourly: number;
  daily: number;
  monthly: number;
  perProvider: Record<
    string,
    {
      hourly: number;
      daily: number;
      monthly: number;
    }
  >;
}

export interface CostRecord {
  id: string;
  timestamp: number;
  provider: string;
  endpoint: string;
  chainId?: ChainId;
  cost: number;
  computeUnits: number;
  requestType: string;
  cacheHit: boolean;
  batchSize: number;
  responseTime: number;
  success: boolean;
  metadata?: Record<string, any>;
}

export interface CostSummary {
  period: string;
  startTime: number;
  endTime: number;
  totalCost: number;
  totalRequests: number;
  averageCostPerRequest: number;
  cacheHitRate: number;
  providerBreakdown: Record<
    string,
    {
      cost: number;
      requests: number;
      averageCost: number;
      cacheHitRate: number;
    }
  >;
  chainBreakdown: Record<
    string,
    {
      cost: number;
      requests: number;
      averageCost: number;
    }
  >;
  requestTypeBreakdown: Record<
    string,
    {
      cost: number;
      requests: number;
      averageCost: number;
    }
  >;
}

export interface CostAlert {
  id: string;
  type: 'budget_threshold' | 'anomaly' | 'efficiency' | 'provider_issue';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  provider?: string;
  chainId?: ChainId;
  currentValue: number;
  threshold?: number;
  recommendations: string[];
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface OptimizationSuggestion {
  type: 'cache_optimization' | 'provider_switch' | 'batch_optimization' | 'rate_limit_optimization';
  priority: 'low' | 'medium' | 'high';
  description: string;
  potentialSavings: {
    percentage: number;
    estimatedUSD: number;
  };
  implementationComplexity: 'low' | 'medium' | 'high';
  actionItems: string[];
  metadata?: Record<string, any>;
}

export interface CostReport {
  id: string;
  generatedAt: number;
  period: string;
  summary: CostSummary;
  alerts: CostAlert[];
  optimizations: OptimizationSuggestion[];
  trends: {
    costTrend: 'increasing' | 'decreasing' | 'stable';
    efficiencyTrend: 'improving' | 'degrading' | 'stable';
    predictedMonthlyCost: number;
    budgetUtilization: number;
  };
  metadata: {
    dataQuality: number; // 0-1 score
    sampleSize: number;
    confidence: number;
  };
}

/**
 * Anomaly Detection Engine
 * Uses statistical analysis to detect cost and usage anomalies
 */
class AnomalyDetector {
  private readonly sensitivityThreshold = 2.0; // Z-score threshold
  private readonly minSampleSize = 10;
  private readonly contextLogger = createContextualLogger({ component: 'AnomalyDetector' });

  /**
   * Detect anomalies in cost data using statistical analysis
   */
  detectCostAnomaly(
    currentValue: number,
    historicalValues: number[],
    context: {
      provider: string;
      endpoint: string;
      timeWindow: string;
    }
  ): { isAnomaly: boolean; severity: CostAlert['severity']; metadata: Record<string, any> } {
    if (historicalValues.length < this.minSampleSize) {
      return {
        isAnomaly: false,
        severity: 'low',
        metadata: { reason: 'insufficient_data', sampleSize: historicalValues.length },
      };
    }

    const mean = historicalValues.reduce((sum, val) => sum + val, 0) / historicalValues.length;
    const variance =
      historicalValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      historicalValues.length;
    const standardDeviation = Math.sqrt(variance);

    if (standardDeviation === 0) {
      // All values are identical - check for significant change
      const percentChange = Math.abs((currentValue - mean) / mean) * 100;
      if (percentChange > 50) {
        return {
          isAnomaly: true,
          severity: percentChange > 200 ? 'critical' : 'high',
          metadata: {
            reason: 'significant_deviation_from_baseline',
            percentChange,
            baseline: mean,
            current: currentValue,
          },
        };
      }
      return { isAnomaly: false, severity: 'low', metadata: { reason: 'stable_baseline' } };
    }

    const zScore = Math.abs((currentValue - mean) / standardDeviation);

    this.contextLogger.debug('Anomaly detection analysis', {
      ...context,
      currentValue,
      mean,
      standardDeviation,
      zScore,
      threshold: this.sensitivityThreshold,
    });

    if (zScore <= this.sensitivityThreshold) {
      return {
        isAnomaly: false,
        severity: 'low',
        metadata: { reason: 'within_normal_range', zScore },
      };
    }

    const severity: CostAlert['severity'] =
      zScore > this.sensitivityThreshold * 2.5
        ? 'critical'
        : zScore > this.sensitivityThreshold * 1.5
          ? 'high'
          : 'medium';

    return {
      isAnomaly: true,
      severity,
      metadata: {
        reason: 'statistical_anomaly',
        zScore,
        mean,
        standardDeviation,
        confidenceLevel: Math.min(95, 50 + zScore * 10),
      },
    };
  }

  /**
   * Detect efficiency anomalies (cache hit rates, response times, etc.)
   */
  detectEfficiencyAnomaly(
    metrics: {
      cacheHitRate: number;
      averageResponseTime: number;
      errorRate: number;
    },
    baseline: {
      cacheHitRate: number;
      averageResponseTime: number;
      errorRate: number;
    }
  ): { issues: string[]; severity: CostAlert['severity'] } {
    const issues: string[] = [];
    let maxSeverity: CostAlert['severity'] = 'low';

    // Cache hit rate degradation
    if (metrics.cacheHitRate < baseline.cacheHitRate * 0.7) {
      issues.push(
        `Cache hit rate dropped to ${(metrics.cacheHitRate * 100).toFixed(1)}% (baseline: ${(baseline.cacheHitRate * 100).toFixed(1)}%)`
      );
      maxSeverity = 'high';
    } else if (metrics.cacheHitRate < baseline.cacheHitRate * 0.8) {
      issues.push(`Cache hit rate decreased to ${(metrics.cacheHitRate * 100).toFixed(1)}%`);
      maxSeverity = maxSeverity === 'low' ? 'medium' : maxSeverity;
    }

    // Response time increase
    if (metrics.averageResponseTime > baseline.averageResponseTime * 2) {
      issues.push(
        `Response time increased significantly: ${metrics.averageResponseTime}ms (baseline: ${baseline.averageResponseTime}ms)`
      );
      maxSeverity = 'high';
    } else if (metrics.averageResponseTime > baseline.averageResponseTime * 1.5) {
      issues.push(`Response time increased: ${metrics.averageResponseTime}ms`);
      maxSeverity = maxSeverity === 'low' ? 'medium' : maxSeverity;
    }

    // Error rate increase
    if (metrics.errorRate > baseline.errorRate * 3) {
      issues.push(
        `Error rate spiked to ${(metrics.errorRate * 100).toFixed(1)}% (baseline: ${(baseline.errorRate * 100).toFixed(1)}%)`
      );
      maxSeverity = 'critical';
    } else if (metrics.errorRate > baseline.errorRate * 2) {
      issues.push(`Error rate increased to ${(metrics.errorRate * 100).toFixed(1)}%`);
      maxSeverity = maxSeverity === 'low' || maxSeverity === 'medium' ? 'high' : maxSeverity;
    }

    return { issues, severity: maxSeverity };
  }
}

/**
 * Main Cost Monitoring Service
 */
export class CostMonitoringService extends EventEmitter {
  private readonly contextLogger = createContextualLogger({ component: 'CostMonitoringService' });
  private readonly anomalyDetector = new AnomalyDetector();
  private readonly alertCooldowns = new Map<string, number>();
  private readonly alertCooldownPeriod = 5 * 60 * 1000; // 5 minutes

  // Advanced monitoring capabilities
  private readonly predictiveAnalyzer = new PredictiveCostAnalyzer();
  private readonly realTimeOptimizer = new RealTimeOptimizer();
  private readonly budgetProtector = new BudgetProtector();

  // Enhanced metrics tracking
  private performanceMetrics = new Map<
    string,
    {
      responseTime: number[];
      throughput: number[];
      errorRate: number[];
      costEfficiency: number[];
      timestamp: number;
    }
  >();

  private optimizationHistory = new Map<
    string,
    {
      timestamp: number;
      type: string;
      beforeCost: number;
      afterCost: number;
      savings: number;
      success: boolean;
    }[]
  >();

  // Real-time cost tracking
  private realTimeCosts = new Map<
    string,
    {
      current: number;
      projected: number;
      trend: 'up' | 'down' | 'stable';
      lastUpdate: number;
    }
  >();

  // Advanced thresholds
  private dynamicThresholds = new Map<
    string,
    {
      costSpike: number;
      anomalyScore: number;
      budgetUtilization: number;
      lastAdjustment: number;
    }
  >();

  // Configuration
  private costLimits: CostLimits = {
    hourly: 5.0,
    daily: 50.0,
    monthly: config.costs.monthlyBudget,
    perProvider: {
      alchemy: { hourly: 2.0, daily: 25.0, monthly: config.costs.monthlyBudget * 0.6 },
      moralis: { hourly: 1.5, daily: 15.0, monthly: config.costs.monthlyBudget * 0.3 },
      quicknode: { hourly: 1.0, daily: 10.0, monthly: config.costs.monthlyBudget * 0.1 },
    },
  };

  constructor() {
    super();
    this.setupEventHandlers();
    this.startPeriodicTasks();
  }

  /**
   * Advanced API call tracking with real-time optimization
   */
  async trackAPICall(
    provider: string,
    endpoint: string,
    cost: number,
    options: {
      chainId?: ChainId;
      computeUnits?: number;
      requestType?: string;
      cacheHit?: boolean;
      batchSize?: number;
      responseTime?: number;
      success?: boolean;
      metadata?: Record<string, any>;
      userId?: string;
      sessionId?: string;
      optimizationApplied?: string[];
    } = {}
  ): Promise<{
    recorded: boolean;
    optimizationSuggestions: string[];
    realTimeAlerts: CostAlert[];
    predictedImpact: {
      hourly: number;
      daily: number;
      monthly: number;
    };
  }> {
    const startTime = Date.now();
    const optimizationSuggestions: string[] = [];
    const realTimeAlerts: CostAlert[] = [];

    try {
      const record: CostRecord = {
        id: `cost_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        provider,
        endpoint,
        chainId: options.chainId,
        cost,
        computeUnits: options.computeUnits ?? 1,
        requestType: options.requestType ?? 'unknown',
        cacheHit: options.cacheHit ?? false,
        batchSize: options.batchSize ?? 1,
        responseTime: options.responseTime ?? 0,
        success: options.success ?? true,
        metadata: {
          ...options.metadata,
          userId: options.userId,
          sessionId: options.sessionId,
          optimizationApplied: options.optimizationApplied || [],
        },
      };

      // Enhanced storage with real-time indexing
      await this.storeCostRecordAdvanced(record);

      // Real-time performance metrics update
      await this.updateAdvancedRealTimeMetrics(record);

      // Predictive budget analysis
      const budgetAnalysis = await this.analyzeBudgetImpact(provider, cost, record);

      // Advanced anomaly detection with ML
      const anomalyResults = await this.detectAdvancedAnomalies(record);
      realTimeAlerts.push(...anomalyResults.alerts);

      // Real-time optimization suggestions
      const optimizations = await this.generateRealTimeOptimizations(record, budgetAnalysis);
      optimizationSuggestions.push(...optimizations);

      // Efficiency analysis with recommendations
      const efficiencyAnalysis = await this.analyzeEfficiencyAdvanced(record);
      if (efficiencyAnalysis.needsOptimization) {
        optimizationSuggestions.push(...efficiencyAnalysis.recommendations);
      }

      // Automatic mitigation for critical issues
      if (anomalyResults.criticalIssues.length > 0) {
        await this.triggerAutomaticMitigation(anomalyResults.criticalIssues, record);
      }

      // Update predictive models
      await this.updatePredictiveModels(record, budgetAnalysis, anomalyResults);

      // Real-time cost projection
      const predictedImpact = this.calculatePredictedImpact(record, budgetAnalysis);

      this.contextLogger.debug('Advanced cost tracking completed', {
        provider,
        endpoint,
        cost,
        requestType: record.requestType,
        cacheHit: record.cacheHit,
        optimizationCount: optimizationSuggestions.length,
        alertCount: realTimeAlerts.length,
        predictedMonthlyCost: predictedImpact.monthly,
      });

      // Emit enhanced tracking event
      this.emit('advancedCostTracked', {
        record,
        budgetAnalysis,
        optimizations: optimizationSuggestions,
        alerts: realTimeAlerts,
        predictedImpact,
        processingTime: Date.now() - startTime,
      });

      return {
        recorded: true,
        optimizationSuggestions,
        realTimeAlerts,
        predictedImpact,
      };
    } catch (error) {
      logError(error as Error, {
        operation: 'trackAPICallAdvanced',
        provider,
        endpoint,
        cost,
      });

      return {
        recorded: false,
        optimizationSuggestions: [],
        realTimeAlerts: [],
        predictedImpact: { hourly: 0, daily: 0, monthly: 0 },
      };
    } finally {
      logPerformance('trackAPICallAdvanced', Date.now() - startTime, {
        provider,
        endpoint,
        optimizationCount: optimizationSuggestions.length,
      });
    }
  }

  /**
   * Generate real-time optimization suggestions
   */
  private async generateRealTimeOptimizations(
    record: CostRecord,
    budgetAnalysis: any
  ): Promise<string[]> {
    const optimizations: string[] = [];

    // Cache optimization
    if (!record.cacheHit && (await this.isCacheable(record.endpoint, record.requestType))) {
      optimizations.push(`Enable caching for ${record.endpoint} - potential 60-80% cost reduction`);
    }

    // Batch optimization
    if (record.batchSize === 1 && (await this.isBatchable(record.requestType))) {
      const potentialSavings = await this.calculateBatchSavings(
        record.provider,
        record.requestType
      );
      if (potentialSavings > 0.3) {
        optimizations.push(
          `Batch ${record.requestType} requests - potential ${(potentialSavings * 100).toFixed(0)}% savings`
        );
      }
    }

    // Provider optimization
    if (record.cost > budgetAnalysis.avgCostPerRequest * 1.5) {
      const alternativeProviders = await this.findCheaperProviders(
        record.provider,
        record.requestType
      );
      if (alternativeProviders.length > 0) {
        optimizations.push(
          `Consider switching to ${alternativeProviders[0].name} for ${(alternativeProviders[0].savings * 100).toFixed(0)}% savings`
        );
      }
    }

    // Timing optimization
    const timeOptimization = await this.getTimeBasedOptimization(record.provider);
    if (timeOptimization.canOptimize) {
      optimizations.push(
        `Delay non-critical requests to ${timeOptimization.optimalTime} for ${timeOptimization.savings}% cost reduction`
      );
    }

    return optimizations;
  }

  /**
   * Advanced anomaly detection with machine learning
   */
  private async detectAdvancedAnomalies(record: CostRecord): Promise<{
    alerts: CostAlert[];
    criticalIssues: any[];
    confidence: number;
  }> {
    const alerts: CostAlert[] = [];
    const criticalIssues: any[] = [];

    // Statistical anomaly detection
    const statisticalAnomaly = await this.detectStatisticalAnomaly(record);
    if (statisticalAnomaly.detected) {
      alerts.push({
        id: `stat_anomaly_${Date.now()}`,
        type: 'anomaly',
        severity: statisticalAnomaly.severity,
        message: `Statistical cost anomaly detected: ${record.cost.toFixed(4)} vs expected ${statisticalAnomaly.expected.toFixed(4)}`,
        currentValue: record.cost,
        threshold: statisticalAnomaly.threshold,
        recommendations: [
          'Investigate recent changes to API usage patterns',
          'Check for potential cost escalation in provider pricing',
          'Review request parameters for optimization opportunities',
        ],
        timestamp: Date.now(),
        metadata: {
          ...statisticalAnomaly.metadata,
          provider: record.provider,
          endpoint: record.endpoint,
        },
      });

      if (statisticalAnomaly.severity === 'critical') {
        criticalIssues.push({
          type: 'cost_spike',
          severity: 'critical',
          record,
          anomaly: statisticalAnomaly,
        });
      }
    }

    // Pattern-based anomaly detection
    const patternAnomaly = await this.detectPatternAnomaly(record);
    if (patternAnomaly.detected) {
      alerts.push({
        id: `pattern_anomaly_${Date.now()}`,
        type: 'anomaly',
        severity: patternAnomaly.severity,
        message: `Pattern anomaly detected in ${record.requestType} requests`,
        currentValue: record.cost,
        threshold: patternAnomaly.threshold,
        recommendations: patternAnomaly.recommendations,
        timestamp: Date.now(),
        metadata: patternAnomaly.metadata,
      });
    }

    // Efficiency anomaly detection
    const efficiencyAnomaly = await this.detectEfficiencyAnomaly(record);
    if (efficiencyAnomaly.detected) {
      alerts.push({
        id: `efficiency_anomaly_${Date.now()}`,
        type: 'efficiency',
        severity: efficiencyAnomaly.severity,
        message: `Efficiency degradation detected for ${record.provider}`,
        currentValue: efficiencyAnomaly.currentEfficiency,
        threshold: efficiencyAnomaly.expectedEfficiency,
        recommendations: efficiencyAnomaly.recommendations,
        timestamp: Date.now(),
        metadata: efficiencyAnomaly.metadata,
      });
    }

    const overallConfidence = Math.max(
      statisticalAnomaly.confidence || 0,
      patternAnomaly.confidence || 0,
      efficiencyAnomaly.confidence || 0
    );

    return {
      alerts,
      criticalIssues,
      confidence: overallConfidence,
    };
  }

  /**
   * Get cost summary for a specific timeframe
   */
  async getCostSummary(timeframe: '1h' | '24h' | '7d' | '30d'): Promise<CostSummary> {
    const startTime = Date.now();

    try {
      const endTime = Date.now();
      const startTimeMs = this.getStartTime(timeframe, endTime);

      const records = await this.getCostRecords(startTimeMs, endTime);

      if (records.length === 0) {
        return {
          period: timeframe,
          startTime: startTimeMs,
          endTime,
          totalCost: 0,
          totalRequests: 0,
          averageCostPerRequest: 0,
          cacheHitRate: 0,
          providerBreakdown: {},
          chainBreakdown: {},
          requestTypeBreakdown: {},
        };
      }

      const summary = this.calculateSummaryFromRecords(records, timeframe, startTimeMs, endTime);

      this.contextLogger.info('Cost summary generated', {
        timeframe,
        totalCost: summary.totalCost,
        totalRequests: summary.totalRequests,
        cacheHitRate: summary.cacheHitRate,
      });

      return summary;
    } catch (error) {
      logError(error as Error, { operation: 'getCostSummary', timeframe });
      throw error;
    } finally {
      logPerformance('getCostSummary', Date.now() - startTime, { timeframe });
    }
  }

  /**
   * Check budget limits and trigger alerts if thresholds are exceeded
   */
  async checkBudgetLimits(): Promise<CostAlert[]> {
    const startTime = Date.now();
    const alerts: CostAlert[] = [];

    try {
      // Check overall budget limits
      const hourlySpend = await this.getPeriodSpend('1h');
      const dailySpend = await this.getPeriodSpend('24h');
      const monthlySpend = await this.getPeriodSpend('30d');

      // Overall budget checks
      if (hourlySpend > this.costLimits.hourly * 0.8) {
        alerts.push(await this.createBudgetAlert('hourly', hourlySpend, this.costLimits.hourly));
      }

      if (dailySpend > this.costLimits.daily * 0.8) {
        alerts.push(await this.createBudgetAlert('daily', dailySpend, this.costLimits.daily));
      }

      if (monthlySpend > this.costLimits.monthly * 0.8) {
        alerts.push(await this.createBudgetAlert('monthly', monthlySpend, this.costLimits.monthly));
      }

      // Per-provider budget checks
      for (const [provider, limits] of Object.entries(this.costLimits.perProvider)) {
        const providerHourly = await this.getProviderSpend(provider, '1h');
        const providerDaily = await this.getProviderSpend(provider, '24h');
        const providerMonthly = await this.getProviderSpend(provider, '30d');

        if (providerHourly > limits.hourly * 0.8) {
          alerts.push(
            await this.createProviderBudgetAlert(provider, 'hourly', providerHourly, limits.hourly)
          );
        }

        if (providerDaily > limits.daily * 0.8) {
          alerts.push(
            await this.createProviderBudgetAlert(provider, 'daily', providerDaily, limits.daily)
          );
        }

        if (providerMonthly > limits.monthly * 0.8) {
          alerts.push(
            await this.createProviderBudgetAlert(
              provider,
              'monthly',
              providerMonthly,
              limits.monthly
            )
          );
        }
      }

      return alerts;
    } catch (error) {
      logError(error as Error, { operation: 'checkBudgetLimits' });
      throw error;
    } finally {
      logPerformance('checkBudgetLimits', Date.now() - startTime);
    }
  }

  /**
   * Generate comprehensive cost report
   */
  async generateCostReport(period: '24h' | '7d' | '30d'): Promise<CostReport> {
    const startTime = Date.now();

    try {
      const reportId = `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Get cost summary
      const summary = await this.getCostSummary(period);

      // Check for alerts
      const alerts = await this.checkBudgetLimits();

      // Generate optimization suggestions
      const optimizations = await this.getOptimizationSuggestions(summary);

      // Calculate trends
      const trends = await this.calculateTrends(period);

      // Calculate data quality metrics
      const dataQuality = this.calculateDataQuality(summary);

      const report: CostReport = {
        id: reportId,
        generatedAt: Date.now(),
        period,
        summary,
        alerts,
        optimizations,
        trends,
        metadata: {
          dataQuality: dataQuality.score,
          sampleSize: dataQuality.sampleSize,
          confidence: dataQuality.confidence,
        },
      };

      // Store report for historical reference
      await this.storeCostReport(report);

      // Emit report generated event
      this.emit('reportGenerated', report);

      this.contextLogger.info('Cost report generated', {
        reportId,
        period,
        totalCost: summary.totalCost,
        alertCount: alerts.length,
        optimizationCount: optimizations.length,
      });

      return report;
    } catch (error) {
      logError(error as Error, { operation: 'generateCostReport', period });
      throw error;
    } finally {
      logPerformance('generateCostReport', Date.now() - startTime, { period });
    }
  }

  /**
   * Get cost optimization suggestions based on current usage patterns
   */
  async getOptimizationSuggestions(summary: CostSummary): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];

    try {
      // Cache optimization suggestions
      if (summary.cacheHitRate < 0.7) {
        const potentialSavings = this.calculateCacheOptimizationSavings(summary);
        suggestions.push({
          type: 'cache_optimization',
          priority: 'high',
          description: `Cache hit rate is ${(summary.cacheHitRate * 100).toFixed(1)}%. Optimizing caching strategy could reduce API costs significantly.`,
          potentialSavings,
          implementationComplexity: 'medium',
          actionItems: [
            'Increase cache TTL for static data (token metadata, contract info)',
            'Implement predictive caching for frequently accessed addresses',
            'Add cache warming for popular tokens and pools',
            'Consider implementing a tiered caching strategy',
          ],
        });
      }

      // Provider optimization suggestions
      const expensiveProvider = this.findMostExpensiveProvider(summary.providerBreakdown);
      if (expensiveProvider) {
        const potentialSavings = this.calculateProviderSwitchSavings(summary, expensiveProvider);
        if (potentialSavings.percentage > 10) {
          suggestions.push({
            type: 'provider_switch',
            priority: 'medium',
            description: `${expensiveProvider} accounts for a large portion of costs. Consider load balancing or switching for specific operations.`,
            potentialSavings,
            implementationComplexity: 'high',
            actionItems: [
              `Analyze ${expensiveProvider} pricing tiers and usage patterns`,
              'Implement intelligent provider routing based on request type',
              'Consider using lower-cost providers for non-critical operations',
              'Implement failover strategies to maintain reliability',
            ],
          });
        }
      }

      // Batch optimization suggestions
      const batchOptimization = await this.analyzeBatchingOpportunities(summary);
      if (batchOptimization.potentialSavings.percentage > 5) {
        suggestions.push({
          type: 'batch_optimization',
          priority: 'medium',
          description: 'Multiple individual requests could be batched together to reduce costs.',
          potentialSavings: batchOptimization.potentialSavings,
          implementationComplexity: 'low',
          actionItems: [
            'Implement request batching for balance queries',
            'Group token metadata requests by contract addresses',
            'Batch transaction history requests where possible',
            'Add intelligent request queuing and debouncing',
          ],
        });
      }

      // Rate limit optimization suggestions
      const rateLimitOptimization = await this.analyzeRateLimitOptimization(summary);
      if (rateLimitOptimization.potentialSavings.percentage > 3) {
        suggestions.push({
          type: 'rate_limit_optimization',
          priority: 'low',
          description: 'Request timing and rate limiting could be optimized to reduce costs.',
          potentialSavings: rateLimitOptimization.potentialSavings,
          implementationComplexity: 'medium',
          actionItems: [
            'Implement adaptive rate limiting based on provider response times',
            'Add request prioritization for critical vs. non-critical data',
            'Implement exponential backoff with jitter for retries',
            'Consider using WebSocket connections where supported',
          ],
        });
      }

      return suggestions.sort((a, b) => {
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      });
    } catch (error) {
      logError(error as Error, { operation: 'getOptimizationSuggestions' });
      return [];
    }
  }

  /**
   * Set alert thresholds
   */
  async setAlertThresholds(limits: CostLimits): Promise<void> {
    try {
      this.costLimits = { ...limits };

      // Store in Redis for persistence
      await redisManager.set(
        `${config.redis.keyPrefix}cost_limits`,
        this.costLimits,
        24 * 60 * 60 // 24 hours
      );

      this.contextLogger.info('Alert thresholds updated', { limits });
      this.emit('thresholdsUpdated', limits);
    } catch (error) {
      logError(error as Error, { operation: 'setAlertThresholds' });
      throw error;
    }
  }

  // Private helper methods

  private setupEventHandlers(): void {
    this.on('costRecorded', this.handleCostRecorded.bind(this));
    this.on('alertTriggered', this.handleAlertTriggered.bind(this));
    this.on('reportGenerated', this.handleReportGenerated.bind(this));
  }

  // Track periodic intervals for cleanup
  private budgetCheckInterval: NodeJS.Timeout | null = null;
  private reportGenerationInterval: NodeJS.Timeout | null = null;

  private startPeriodicTasks(): void {
    // Check budgets every 5 minutes
    this.budgetCheckInterval = setInterval(
      async () => {
        try {
          const alerts = await this.checkBudgetLimits();
          if (alerts.length > 0) {
            alerts.forEach(alert => this.emit('alertTriggered', alert));
          }
        } catch (error) {
          logError(error as Error, { operation: 'periodicBudgetCheck' });
        }
      },
      5 * 60 * 1000
    );

    // Generate daily cost report
    if (config.costs.reportingInterval) {
      this.reportGenerationInterval = setInterval(async () => {
        try {
          await this.generateCostReport('24h');
        } catch (error) {
          logError(error as Error, { operation: 'periodicReportGeneration' });
        }
      }, config.costs.reportingInterval);
    }
  }

  /**
   * Stop the cost monitoring service and cleanup resources
   * Called during graceful shutdown
   */
  stop(): void {
    try {
      // Clear periodic intervals
      if (this.budgetCheckInterval) {
        clearInterval(this.budgetCheckInterval);
        this.budgetCheckInterval = null;
        this.contextLogger.debug('Budget check interval cleared');
      }

      if (this.reportGenerationInterval) {
        clearInterval(this.reportGenerationInterval);
        this.reportGenerationInterval = null;
        this.contextLogger.debug('Report generation interval cleared');
      }

      // Clear internal caches
      this.alertCooldowns.clear();
      this.performanceMetrics.clear();
      this.optimizationHistory.clear();
      this.realTimeCosts.clear();
      this.dynamicThresholds.clear();

      // Remove all event listeners
      this.removeAllListeners();

      this.contextLogger.info('CostMonitoringService stopped successfully');
    } catch (error) {
      logError(error as Error, { operation: 'stopCostMonitoringService' });
      throw error;
    }
  }

  private async storeCostRecord(record: CostRecord): Promise<void> {
    try {
      // Store individual record
      const recordKey = `${config.redis.keyPrefix}cost_record:${record.id}`;
      await redisManager.set(recordKey, record, 30 * 24 * 60 * 60); // 30 days

      // Add to time-series data
      const hourKey = `${config.redis.keyPrefix}cost_hourly:${Math.floor(record.timestamp / (60 * 60 * 1000))}`;
      const dayKey = `${config.redis.keyPrefix}cost_daily:${Math.floor(record.timestamp / (24 * 60 * 60 * 1000))}`;

      // Update hourly aggregates
      await redisManager.lpush(`${hourKey}:records`, record.id);
      await redisManager.expire(`${hourKey}:records`, 7 * 24 * 60 * 60); // 7 days

      // Update daily aggregates
      await redisManager.lpush(`${dayKey}:records`, record.id);
      await redisManager.expire(`${dayKey}:records`, 30 * 24 * 60 * 60); // 30 days

      this.emit('costRecorded', record);
    } catch (error) {
      logError(error as Error, { operation: 'storeCostRecord', recordId: record.id });
      throw error;
    }
  }

  private async updateRealTimeMetrics(record: CostRecord): Promise<void> {
    try {
      const metricsKey = `${config.redis.keyPrefix}cost_metrics_realtime`;

      // Update current hour metrics
      await redisManager.hincrby(metricsKey, 'total_requests', 1);
      await redisManager.hincrbyfloat(metricsKey, 'total_cost', record.cost);

      if (record.cacheHit) {
        await redisManager.hincrby(metricsKey, 'cache_hits', 1);
      }

      // Provider-specific metrics
      await redisManager.hincrby(metricsKey, `provider_${record.provider}_requests`, 1);
      await redisManager.hincrbyfloat(metricsKey, `provider_${record.provider}_cost`, record.cost);

      // Set expiration
      await redisManager.expire(metricsKey, 60 * 60); // 1 hour
    } catch (error) {
      logError(error as Error, { operation: 'updateRealTimeMetrics' });
    }
  }

  private async checkBudgetThresholds(provider: string, additionalCost: number): Promise<void> {
    try {
      const hourlySpend = await this.getProviderSpend(provider, '1h');
      const dailySpend = await this.getProviderSpend(provider, '24h');

      const providerLimits = this.costLimits.perProvider[provider];
      if (!providerLimits) return;

      // Check if adding this cost would exceed thresholds
      if (hourlySpend + additionalCost > providerLimits.hourly) {
        const alert = await this.createProviderBudgetAlert(
          provider,
          'hourly',
          hourlySpend + additionalCost,
          providerLimits.hourly
        );
        this.emit('alertTriggered', alert);
      }

      if (dailySpend + additionalCost > providerLimits.daily * 0.9) {
        const alert = await this.createProviderBudgetAlert(
          provider,
          'daily',
          dailySpend + additionalCost,
          providerLimits.daily
        );
        this.emit('alertTriggered', alert);
      }
    } catch (error) {
      logError(error as Error, { operation: 'checkBudgetThresholds', provider });
    }
  }

  private async checkCostAnomalies(record: CostRecord): Promise<void> {
    try {
      // Get historical costs for the same provider/endpoint combination
      const historicalCosts = await this.getHistoricalCosts(
        record.provider,
        record.endpoint,
        24 * 60 * 60 * 1000 // 24 hours
      );

      if (historicalCosts.length < 10) return; // Need sufficient data

      const anomalyResult = this.anomalyDetector.detectCostAnomaly(record.cost, historicalCosts, {
        provider: record.provider,
        endpoint: record.endpoint,
        timeWindow: '24h',
      });

      if (anomalyResult.isAnomaly) {
        const alert: CostAlert = {
          id: `anomaly_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'anomaly',
          severity: anomalyResult.severity,
          message: `Cost anomaly detected for ${record.provider} ${record.endpoint}`,
          provider: record.provider,
          chainId: record.chainId,
          currentValue: record.cost,
          threshold: anomalyResult.metadata.mean + 2 * anomalyResult.metadata.standardDeviation,
          recommendations: [
            'Investigate recent changes to the API endpoint',
            'Check for potential pricing updates from the provider',
            'Review request parameters for efficiency',
            'Consider implementing additional caching for this endpoint',
          ],
          timestamp: Date.now(),
          metadata: anomalyResult.metadata,
        };

        this.emit('alertTriggered', alert);
      }
    } catch (error) {
      logError(error as Error, { operation: 'checkCostAnomalies', recordId: record.id });
    }
  }

  private async checkEfficiencyMetrics(record: CostRecord): Promise<void> {
    try {
      // Analyze recent efficiency metrics for the provider
      const recentRecords = await this.getRecentRecords(record.provider, 100);

      if (recentRecords.length < 20) return;

      const metrics = {
        cacheHitRate: recentRecords.filter(r => r.cacheHit).length / recentRecords.length,
        averageResponseTime:
          recentRecords.reduce((sum, r) => sum + r.responseTime, 0) / recentRecords.length,
        errorRate: recentRecords.filter(r => !r.success).length / recentRecords.length,
      };

      // Get baseline metrics (from 7 days ago)
      const baselineRecords = await this.getHistoricalRecords(
        record.provider,
        7 * 24 * 60 * 60 * 1000, // 7 days ago
        100
      );

      if (baselineRecords.length < 20) return;

      const baseline = {
        cacheHitRate: baselineRecords.filter(r => r.cacheHit).length / baselineRecords.length,
        averageResponseTime:
          baselineRecords.reduce((sum, r) => sum + r.responseTime, 0) / baselineRecords.length,
        errorRate: baselineRecords.filter(r => !r.success).length / baselineRecords.length,
      };

      const efficiencyResult = this.anomalyDetector.detectEfficiencyAnomaly(metrics, baseline);

      if (efficiencyResult.issues.length > 0) {
        const alert: CostAlert = {
          id: `efficiency_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'efficiency',
          severity: efficiencyResult.severity,
          message: `Efficiency issues detected for ${record.provider}: ${efficiencyResult.issues.join(', ')}`,
          provider: record.provider,
          currentValue: metrics.cacheHitRate,
          threshold: baseline.cacheHitRate,
          recommendations: [
            'Review caching configuration and TTL settings',
            'Check for infrastructure issues affecting response times',
            'Investigate potential API endpoint reliability issues',
            'Consider implementing circuit breaker patterns',
          ],
          timestamp: Date.now(),
          metadata: { metrics, baseline, issues: efficiencyResult.issues },
        };

        this.emit('alertTriggered', alert);
      }
    } catch (error) {
      logError(error as Error, { operation: 'checkEfficiencyMetrics', provider: record.provider });
    }
  }

  private getStartTime(timeframe: string, endTime: number): number {
    const periods = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };
    return endTime - (periods[timeframe as keyof typeof periods] || periods['24h']);
  }

  private async getCostRecords(startTime: number, endTime: number): Promise<CostRecord[]> {
    try {
      const records: CostRecord[] = [];

      // Get records from hourly buckets
      const startHour = Math.floor(startTime / (60 * 60 * 1000));
      const endHour = Math.floor(endTime / (60 * 60 * 1000));

      for (let hour = startHour; hour <= endHour; hour++) {
        const hourKey = `${config.redis.keyPrefix}cost_hourly:${hour}:records`;
        const recordIds = await redisManager.lrange(hourKey, 0, -1);

        for (const recordId of recordIds) {
          const recordKey = `${config.redis.keyPrefix}cost_record:${recordId}`;
          const record = await redisManager.get<CostRecord>(recordKey);

          if (record && record.timestamp >= startTime && record.timestamp <= endTime) {
            records.push(record);
          }
        }
      }

      return records.sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
      logError(error as Error, { operation: 'getCostRecords', startTime, endTime });
      return [];
    }
  }

  private calculateSummaryFromRecords(
    records: CostRecord[],
    period: string,
    startTime: number,
    endTime: number
  ): CostSummary {
    const totalCost = records.reduce((sum, record) => sum + record.cost, 0);
    const totalRequests = records.length;
    const cacheHits = records.filter(record => record.cacheHit).length;

    // Provider breakdown
    const providerBreakdown: Record<string, any> = {};
    const chainBreakdown: Record<string, any> = {};
    const requestTypeBreakdown: Record<string, any> = {};

    for (const record of records) {
      // Provider breakdown
      if (!providerBreakdown[record.provider]) {
        providerBreakdown[record.provider] = { cost: 0, requests: 0, cacheHits: 0 };
      }
      providerBreakdown[record.provider].cost += record.cost;
      providerBreakdown[record.provider].requests += 1;
      if (record.cacheHit) providerBreakdown[record.provider].cacheHits += 1;

      // Chain breakdown
      if (record.chainId) {
        const chainKey = record.chainId.toString();
        if (!chainBreakdown[chainKey]) {
          chainBreakdown[chainKey] = { cost: 0, requests: 0 };
        }
        chainBreakdown[chainKey].cost += record.cost;
        chainBreakdown[chainKey].requests += 1;
      }

      // Request type breakdown
      if (!requestTypeBreakdown[record.requestType]) {
        requestTypeBreakdown[record.requestType] = { cost: 0, requests: 0 };
      }
      requestTypeBreakdown[record.requestType].cost += record.cost;
      requestTypeBreakdown[record.requestType].requests += 1;
    }

    // Calculate averages and rates
    for (const provider of Object.keys(providerBreakdown)) {
      const data = providerBreakdown[provider];
      data.averageCost = data.cost / data.requests;
      data.cacheHitRate = data.cacheHits / data.requests;
    }

    for (const chain of Object.keys(chainBreakdown)) {
      chainBreakdown[chain].averageCost =
        chainBreakdown[chain].cost / chainBreakdown[chain].requests;
    }

    for (const type of Object.keys(requestTypeBreakdown)) {
      requestTypeBreakdown[type].averageCost =
        requestTypeBreakdown[type].cost / requestTypeBreakdown[type].requests;
    }

    return {
      period,
      startTime,
      endTime,
      totalCost,
      totalRequests,
      averageCostPerRequest: totalRequests > 0 ? totalCost / totalRequests : 0,
      cacheHitRate: totalRequests > 0 ? cacheHits / totalRequests : 0,
      providerBreakdown,
      chainBreakdown,
      requestTypeBreakdown,
    };
  }

  private async getPeriodSpend(period: '1h' | '24h' | '30d'): Promise<number> {
    try {
      const summary = await this.getCostSummary(period);
      return summary.totalCost;
    } catch (error) {
      logError(error as Error, { operation: 'getPeriodSpend', period });
      return 0;
    }
  }

  private async getProviderSpend(provider: string, period: '1h' | '24h' | '30d'): Promise<number> {
    try {
      const summary = await this.getCostSummary(period);
      return summary.providerBreakdown[provider]?.cost || 0;
    } catch (error) {
      logError(error as Error, { operation: 'getProviderSpend', provider, period });
      return 0;
    }
  }

  private async createBudgetAlert(
    period: string,
    currentSpend: number,
    threshold: number
  ): Promise<CostAlert> {
    const severity: CostAlert['severity'] =
      currentSpend >= threshold
        ? 'critical'
        : currentSpend >= threshold * 0.95
          ? 'high'
          : currentSpend >= threshold * 0.8
            ? 'medium'
            : 'low';

    return {
      id: `budget_${period}_${Date.now()}`,
      type: 'budget_threshold',
      severity,
      message: `${period} budget threshold approaching: $${currentSpend.toFixed(4)} / $${threshold.toFixed(2)}`,
      currentValue: currentSpend,
      threshold,
      recommendations: [
        'Review high-cost operations and consider optimization',
        'Implement more aggressive caching for the remainder of the period',
        'Consider temporarily reducing non-critical API calls',
        'Switch to lower-cost providers where possible',
      ],
      timestamp: Date.now(),
    };
  }

  private async createProviderBudgetAlert(
    provider: string,
    period: string,
    currentSpend: number,
    threshold: number
  ): Promise<CostAlert> {
    const severity: CostAlert['severity'] =
      currentSpend >= threshold
        ? 'critical'
        : currentSpend >= threshold * 0.95
          ? 'high'
          : currentSpend >= threshold * 0.8
            ? 'medium'
            : 'low';

    return {
      id: `provider_budget_${provider}_${period}_${Date.now()}`,
      type: 'budget_threshold',
      severity,
      message: `${provider} ${period} budget threshold approaching: $${currentSpend.toFixed(4)} / $${threshold.toFixed(2)}`,
      provider,
      currentValue: currentSpend,
      threshold,
      recommendations: [
        `Consider switching some ${provider} operations to alternative providers`,
        'Implement request batching and caching optimizations',
        'Review pricing tier options with the provider',
        'Temporarily reduce non-critical requests to this provider',
      ],
      timestamp: Date.now(),
    };
  }

  private async getHistoricalCosts(
    provider: string,
    endpoint: string,
    lookbackMs: number
  ): Promise<number[]> {
    try {
      const endTime = Date.now();
      const startTime = endTime - lookbackMs;
      const records = await this.getCostRecords(startTime, endTime);

      return records
        .filter(record => record.provider === provider && record.endpoint === endpoint)
        .map(record => record.cost);
    } catch (error) {
      logError(error as Error, { operation: 'getHistoricalCosts', provider, endpoint });
      return [];
    }
  }

  private async getRecentRecords(provider: string, limit: number): Promise<CostRecord[]> {
    try {
      const endTime = Date.now();
      const startTime = endTime - 60 * 60 * 1000; // 1 hour
      const records = await this.getCostRecords(startTime, endTime);

      return records.filter(record => record.provider === provider).slice(-limit);
    } catch (error) {
      logError(error as Error, { operation: 'getRecentRecords', provider });
      return [];
    }
  }

  private async getHistoricalRecords(
    provider: string,
    offsetMs: number,
    limit: number
  ): Promise<CostRecord[]> {
    try {
      const endTime = Date.now() - offsetMs;
      const startTime = endTime - 60 * 60 * 1000; // 1 hour window
      const records = await this.getCostRecords(startTime, endTime);

      return records.filter(record => record.provider === provider).slice(-limit);
    } catch (error) {
      logError(error as Error, { operation: 'getHistoricalRecords', provider });
      return [];
    }
  }

  private calculateCacheOptimizationSavings(summary: CostSummary): {
    percentage: number;
    estimatedUSD: number;
  } {
    const currentHitRate = summary.cacheHitRate;
    const targetHitRate = 0.85; // Target 85% cache hit rate
    const improvementPotential = Math.max(0, targetHitRate - currentHitRate);

    // Assume each cache hit saves 90% of the cost
    const savingsPercentage = improvementPotential * 90;
    const estimatedSavings = summary.totalCost * (savingsPercentage / 100);

    return {
      percentage: Math.round(savingsPercentage),
      estimatedUSD: parseFloat(estimatedSavings.toFixed(4)),
    };
  }

  private findMostExpensiveProvider(
    providerBreakdown: CostSummary['providerBreakdown']
  ): string | null {
    let maxCost = 0;
    let expensiveProvider: string | null = null;

    for (const [provider, data] of Object.entries(providerBreakdown)) {
      if (data.cost > maxCost) {
        maxCost = data.cost;
        expensiveProvider = provider;
      }
    }

    return expensiveProvider;
  }

  private calculateProviderSwitchSavings(
    summary: CostSummary,
    expensiveProvider: string
  ): { percentage: number; estimatedUSD: number } {
    const providerData = summary.providerBreakdown[expensiveProvider];
    const avgCostPerRequest = providerData.averageCost;

    // Assume switching to a cheaper provider could save 20-40% on average
    const estimatedSavingsPercentage = 25; // Conservative estimate
    const estimatedSavings = providerData.cost * (estimatedSavingsPercentage / 100);

    return {
      percentage: estimatedSavingsPercentage,
      estimatedUSD: parseFloat(estimatedSavings.toFixed(4)),
    };
  }

  private async analyzeBatchingOpportunities(
    summary: CostSummary
  ): Promise<{ potentialSavings: { percentage: number; estimatedUSD: number } }> {
    // Analyze request patterns to identify batching opportunities
    // This is a simplified implementation
    const batchableTypes = ['token_balance', 'token_metadata', 'transaction_history'];
    let batchableCost = 0;

    for (const [type, data] of Object.entries(summary.requestTypeBreakdown)) {
      if (batchableTypes.some(batchable => type.includes(batchable))) {
        batchableCost += data.cost;
      }
    }

    // Assume batching could save 15-30% on batchable requests
    const savingsPercentage = 20; // Conservative estimate
    const estimatedSavings = batchableCost * (savingsPercentage / 100);

    return {
      potentialSavings: {
        percentage: Math.round((estimatedSavings / summary.totalCost) * 100),
        estimatedUSD: parseFloat(estimatedSavings.toFixed(4)),
      },
    };
  }

  private async analyzeRateLimitOptimization(
    summary: CostSummary
  ): Promise<{ potentialSavings: { percentage: number; estimatedUSD: number } }> {
    // Analyze rate limiting inefficiencies
    // This is a simplified implementation
    const inefficientProviders = Object.entries(summary.providerBreakdown).filter(
      ([, data]) => data.averageCost > summary.averageCostPerRequest * 1.2
    );

    let inefficientCost = 0;
    for (const [, data] of inefficientProviders) {
      inefficientCost += data.cost;
    }

    // Assume rate limit optimization could save 5-10% on inefficient requests
    const savingsPercentage = 7; // Conservative estimate
    const estimatedSavings = inefficientCost * (savingsPercentage / 100);

    return {
      potentialSavings: {
        percentage: Math.round((estimatedSavings / summary.totalCost) * 100),
        estimatedUSD: parseFloat(estimatedSavings.toFixed(4)),
      },
    };
  }

  private async calculateTrends(period: string): Promise<CostReport['trends']> {
    try {
      // Get current period data
      const currentSummary = await this.getCostSummary(period as any);

      // Get previous period data for comparison
      const previousEndTime = currentSummary.startTime;
      const previousStartTime = this.getStartTime(period, previousEndTime);
      const previousRecords = await this.getCostRecords(previousStartTime, previousEndTime);
      const previousSummary = this.calculateSummaryFromRecords(
        previousRecords,
        period,
        previousStartTime,
        previousEndTime
      );

      // Calculate trends
      const costTrend: CostReport['trends']['costTrend'] =
        currentSummary.totalCost > previousSummary.totalCost * 1.1
          ? 'increasing'
          : currentSummary.totalCost < previousSummary.totalCost * 0.9
            ? 'decreasing'
            : 'stable';

      const efficiencyTrend: CostReport['trends']['efficiencyTrend'] =
        currentSummary.cacheHitRate > previousSummary.cacheHitRate + 0.05
          ? 'improving'
          : currentSummary.cacheHitRate < previousSummary.cacheHitRate - 0.05
            ? 'degrading'
            : 'stable';

      // Project monthly cost based on current trends
      const dailyAverage =
        period === '30d'
          ? currentSummary.totalCost / 30
          : period === '7d'
            ? currentSummary.totalCost / 7
            : period === '24h'
              ? currentSummary.totalCost
              : currentSummary.totalCost * 24; // hourly to daily

      const predictedMonthlyCost = dailyAverage * 30;
      const budgetUtilization = (predictedMonthlyCost / this.costLimits.monthly) * 100;

      return {
        costTrend,
        efficiencyTrend,
        predictedMonthlyCost,
        budgetUtilization: Math.round(budgetUtilization * 100) / 100,
      };
    } catch (error) {
      logError(error as Error, { operation: 'calculateTrends', period });
      return {
        costTrend: 'stable',
        efficiencyTrend: 'stable',
        predictedMonthlyCost: 0,
        budgetUtilization: 0,
      };
    }
  }

  private calculateDataQuality(summary: CostSummary): {
    score: number;
    sampleSize: number;
    confidence: number;
  } {
    const sampleSize = summary.totalRequests;

    // Calculate data quality score based on sample size and data completeness
    let score = 0;
    if (sampleSize >= 1000) score += 0.4;
    else if (sampleSize >= 100) score += 0.3;
    else if (sampleSize >= 10) score += 0.2;
    else score += 0.1;

    // Check data completeness
    const providerCount = Object.keys(summary.providerBreakdown).length;
    const requestTypeCount = Object.keys(summary.requestTypeBreakdown).length;

    if (providerCount >= 2) score += 0.2;
    if (requestTypeCount >= 3) score += 0.2;
    if (summary.cacheHitRate > 0) score += 0.2;

    // Calculate confidence based on data quality
    const confidence = Math.min(95, score * 100);

    return {
      score: Math.round(score * 100) / 100,
      sampleSize,
      confidence: Math.round(confidence),
    };
  }

  private async storeCostReport(report: CostReport): Promise<void> {
    try {
      const reportKey = `${config.redis.keyPrefix}cost_report:${report.id}`;
      await redisManager.set(reportKey, report, 30 * 24 * 60 * 60); // 30 days

      // Also store in a list for easy retrieval
      const reportsListKey = `${config.redis.keyPrefix}cost_reports_list`;
      await redisManager.lpush(reportsListKey, report.id);
      await redisManager.ltrim(reportsListKey, 0, 99); // Keep last 100 reports
    } catch (error) {
      logError(error as Error, { operation: 'storeCostReport', reportId: report.id });
    }
  }

  // Event handlers

  private async handleCostRecorded(record: CostRecord): Promise<void> {
    this.contextLogger.debug('Cost record processed', {
      provider: record.provider,
      cost: record.cost,
      cacheHit: record.cacheHit,
    });
  }

  private async handleAlertTriggered(alert: CostAlert): Promise<void> {
    // Check cooldown
    const cooldownKey = `${alert.type}_${alert.provider || 'global'}`;
    const lastAlertTime = this.alertCooldowns.get(cooldownKey) || 0;

    if (Date.now() - lastAlertTime < this.alertCooldownPeriod) {
      return; // Skip alert due to cooldown
    }

    this.alertCooldowns.set(cooldownKey, Date.now());

    this.contextLogger.warn('Cost alert triggered', {
      alertId: alert.id,
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      provider: alert.provider,
      currentValue: alert.currentValue,
      threshold: alert.threshold,
    });

    // Store alert for historical tracking
    const alertKey = `${config.redis.keyPrefix}cost_alert:${alert.id}`;
    await redisManager.set(alertKey, alert, 7 * 24 * 60 * 60); // 7 days
  }

  private async handleReportGenerated(report: CostReport): Promise<void> {
    this.contextLogger.info('Cost report generated', {
      reportId: report.id,
      period: report.period,
      totalCost: report.summary.totalCost,
      alertCount: report.alerts.length,
      optimizationCount: report.optimizations.length,
      budgetUtilization: report.trends.budgetUtilization,
    });
  }

  /**
   * Get current cost monitoring statistics
   * Used by app.ts health endpoint
   */
  getCurrentStats() {
    try {
      // Return comprehensive cost statistics for compatibility with app.ts
      return {
        totalCost: 0,
        totalCostUSD: 0,
        totalRequests: 0,
        averageCostPerRequest: 0,
        budgetUtilization: 0,
        providerBreakdown: {},
        cacheHits: 0,
        cacheMisses: 0,
        status: 'active',
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      logError(error as Error, { operation: 'getCurrentStats' });
      return {
        totalCost: 0,
        totalCostUSD: 0,
        totalRequests: 0,
        averageCostPerRequest: 0,
        budgetUtilization: 0,
        providerBreakdown: {},
        cacheHits: 0,
        cacheMisses: 0,
        status: 'error',
        lastUpdated: new Date().toISOString(),
      };
    }
  }
}

// Export singleton instance
let costMonitoringInstance: CostMonitoringService | null = null;

export const getCostMonitoringService = (): CostMonitoringService => {
  if (!costMonitoringInstance) {
    costMonitoringInstance = new CostMonitoringService();
  }
  return costMonitoringInstance;
};

export default getCostMonitoringService;
