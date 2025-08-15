import { EventEmitter } from 'events';
import { logger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { config } from '@/config';

export interface CostAlert {
  id: string;
  type: 'BUDGET_THRESHOLD' | 'ANOMALY_DETECTION' | 'PROVIDER_COST_SPIKE' | 'FREE_TIER_EXHAUSTION';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  currentValue: number;
  threshold: number;
  recommendations: string[];
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface CostRecord {
  timestamp: number;
  providerId: string;
  requestType: string;
  cost: number;
  computeUnits: number;
  cacheHit: boolean;
  batchSize: number;
  responseTime: number;
  success: boolean;
  userContext?: string;
}

export interface CostAnalytics {
  timeframe: string;
  totalCost: number;
  totalRequests: number;
  averageCostPerRequest: number;
  cacheHitRate: number;
  providerBreakdown: Record<
    string,
    {
      cost: number;
      requests: number;
      efficiency: number;
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
  trends: {
    costTrend: 'increasing' | 'decreasing' | 'stable';
    requestTrend: 'increasing' | 'decreasing' | 'stable';
    efficiencyTrend: 'improving' | 'degrading' | 'stable';
  };
  projections: {
    dailyCost: number;
    monthlyCost: number;
    budgetUtilization: number;
  };
}

export interface OptimizationRecommendation {
  id: string;
  type: 'CACHE_OPTIMIZATION' | 'PROVIDER_SWITCH' | 'BATCHING_OPTIMIZATION' | 'TTL_ADJUSTMENT';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  estimatedSavings: number;
  implementationComplexity: 'LOW' | 'MEDIUM' | 'HIGH';
  actionRequired: string;
  metadata: Record<string, any>;
  validUntil: number;
}

class AnomalyDetector {
  private sensitivityThreshold: number = 2.0; // Standard deviations

  detectCostAnomaly(
    currentCost: number,
    historicalCosts: number[],
    context: Record<string, any> = {}
  ): {
    isAnomaly: boolean;
    severity: CostAlert['severity'];
    confidence: number;
    metadata: Record<string, any>;
  } {
    if (historicalCosts.length < 5) {
      return {
        isAnomaly: false,
        severity: 'LOW',
        confidence: 0,
        metadata: { reason: 'insufficient_data' },
      };
    }

    const mean = historicalCosts.reduce((sum, cost) => sum + cost, 0) / historicalCosts.length;
    const variance =
      historicalCosts.reduce((sum, cost) => sum + Math.pow(cost - mean, 2), 0) /
      historicalCosts.length;
    const standardDeviation = Math.sqrt(variance);

    if (standardDeviation === 0) {
      // All historical values are the same
      const percentChange = Math.abs((currentCost - mean) / mean);
      if (percentChange > 0.5) {
        // 50% change
        return {
          isAnomaly: true,
          severity: percentChange > 1.0 ? 'CRITICAL' : 'HIGH',
          confidence: 0.9,
          metadata: {
            reason: 'significant_deviation_from_stable_baseline',
            percentChange: percentChange * 100,
            expected: mean,
            actual: currentCost,
          },
        };
      }
      return {
        isAnomaly: false,
        severity: 'LOW',
        confidence: 1,
        metadata: { reason: 'stable_baseline' },
      };
    }

    const zScore = Math.abs((currentCost - mean) / standardDeviation);
    let severity: CostAlert['severity'] = 'LOW';
    let isAnomaly = false;

    if (zScore > this.sensitivityThreshold * 2) {
      isAnomaly = true;
      severity = 'CRITICAL';
    } else if (zScore > this.sensitivityThreshold * 1.5) {
      isAnomaly = true;
      severity = 'HIGH';
    } else if (zScore > this.sensitivityThreshold) {
      isAnomaly = true;
      severity = 'MEDIUM';
    }

    const confidence = Math.min(1.0, zScore / (this.sensitivityThreshold * 2));

    return {
      isAnomaly,
      severity,
      confidence,
      metadata: {
        reason: 'statistical_anomaly',
        zScore,
        mean,
        standardDeviation,
        threshold: mean + this.sensitivityThreshold * standardDeviation,
        actual: currentCost,
      },
    };
  }
}

class BudgetTracker {
  private budgets: Map<string, { hourly: number; daily: number; monthly: number }> = new Map();
  private usage: Map<
    string,
    { hourly: number; daily: number; monthly: number; lastReset: number }
  > = new Map();

  constructor() {
    this.initializeBudgets();
    this.startPeriodicReset();
  }

  private initializeBudgets() {
    // Default budgets - can be configured per provider
    this.budgets.set('default', {
      hourly: 2.0,
      daily: 25.0,
      monthly: 500.0,
    });

    this.budgets.set('alchemy', {
      hourly: 1.5,
      daily: 20.0,
      monthly: 300.0,
    });

    this.budgets.set('moralis', {
      hourly: 0.8,
      daily: 10.0,
      monthly: 150.0,
    });
  }

  private startPeriodicReset() {
    // Reset usage counters periodically
    setInterval(() => {
      const now = Date.now();
      const currentHour = Math.floor(now / (60 * 60 * 1000));
      const currentDay = Math.floor(now / (24 * 60 * 60 * 1000));
      const currentMonth = new Date().getMonth();

      for (const [providerId, usage] of this.usage) {
        const lastResetHour = Math.floor(usage.lastReset / (60 * 60 * 1000));
        const lastResetDay = Math.floor(usage.lastReset / (24 * 60 * 60 * 1000));
        const lastResetMonth = new Date(usage.lastReset).getMonth();

        if (currentHour > lastResetHour) {
          usage.hourly = 0;
        }
        if (currentDay > lastResetDay) {
          usage.daily = 0;
        }
        if (currentMonth !== lastResetMonth) {
          usage.monthly = 0;
        }

        usage.lastReset = now;
      }
    }, 60000); // Check every minute
  }

  updateUsage(
    providerId: string,
    cost: number
  ): {
    overBudget: boolean;
    severity: CostAlert['severity'];
    utilizationRate: number;
    budget: string;
  } {
    const budget = this.budgets.get(providerId) || this.budgets.get('default')!;

    if (!this.usage.has(providerId)) {
      this.usage.set(providerId, {
        hourly: 0,
        daily: 0,
        monthly: 0,
        lastReset: Date.now(),
      });
    }

    const usage = this.usage.get(providerId)!;
    usage.hourly += cost;
    usage.daily += cost;
    usage.monthly += cost;

    // Check which budget threshold is exceeded
    let overBudget = false;
    let severity: CostAlert['severity'] = 'LOW';
    let budgetType = '';
    let utilizationRate = 0;

    // Check monthly budget first (most critical)
    const monthlyUtilization = usage.monthly / budget.monthly;
    if (monthlyUtilization > 1.0) {
      overBudget = true;
      severity = 'CRITICAL';
      budgetType = 'monthly';
      utilizationRate = monthlyUtilization;
    } else if (monthlyUtilization > 0.9) {
      overBudget = true;
      severity = 'HIGH';
      budgetType = 'monthly';
      utilizationRate = monthlyUtilization;
    }

    // Check daily budget
    const dailyUtilization = usage.daily / budget.daily;
    if (!overBudget && dailyUtilization > 1.0) {
      overBudget = true;
      severity = 'HIGH';
      budgetType = 'daily';
      utilizationRate = dailyUtilization;
    } else if (!overBudget && dailyUtilization > 0.85) {
      overBudget = true;
      severity = 'MEDIUM';
      budgetType = 'daily';
      utilizationRate = dailyUtilization;
    }

    // Check hourly budget
    const hourlyUtilization = usage.hourly / budget.hourly;
    if (!overBudget && hourlyUtilization > 1.0) {
      overBudget = true;
      severity = 'MEDIUM';
      budgetType = 'hourly';
      utilizationRate = hourlyUtilization;
    } else if (!overBudget && hourlyUtilization > 0.8) {
      overBudget = true;
      severity = 'LOW';
      budgetType = 'hourly';
      utilizationRate = hourlyUtilization;
    }

    return {
      overBudget,
      severity,
      utilizationRate,
      budget: budgetType,
    };
  }

  getBudgetStatus(providerId: string): {
    hourly: { used: number; budget: number; utilization: number };
    daily: { used: number; budget: number; utilization: number };
    monthly: { used: number; budget: number; utilization: number };
  } {
    const budget = this.budgets.get(providerId) || this.budgets.get('default')!;
    const usage = this.usage.get(providerId) || {
      hourly: 0,
      daily: 0,
      monthly: 0,
      lastReset: Date.now(),
    };

    return {
      hourly: {
        used: usage.hourly,
        budget: budget.hourly,
        utilization: usage.hourly / budget.hourly,
      },
      daily: {
        used: usage.daily,
        budget: budget.daily,
        utilization: usage.daily / budget.daily,
      },
      monthly: {
        used: usage.monthly,
        budget: budget.monthly,
        utilization: usage.monthly / budget.monthly,
      },
    };
  }
}

export class CostOptimizationManager extends EventEmitter {
  private anomalyDetector: AnomalyDetector;
  private budgetTracker: BudgetTracker;
  private costHistory: Map<string, CostRecord[]> = new Map();
  private alertHandlers: ((alert: CostAlert) => Promise<void>)[] = [];
  private optimizationEnabled: boolean;

  constructor() {
    super();
    this.anomalyDetector = new AnomalyDetector();
    this.budgetTracker = new BudgetTracker();
    this.optimizationEnabled = config.costs.trackingEnabled;

    if (this.optimizationEnabled) {
      this.startBackgroundOptimization();
    }
  }

  /**
   * Track a single API call cost and trigger optimization checks
   */
  async trackCost(costRecord: CostRecord): Promise<void> {
    if (!this.optimizationEnabled) return;

    try {
      // Store cost record
      await this.storeCostRecord(costRecord);

      // Update budget tracking
      const budgetStatus = this.budgetTracker.updateUsage(costRecord.providerId, costRecord.cost);

      // Check for budget alerts
      if (budgetStatus.overBudget) {
        await this.triggerBudgetAlert(costRecord, budgetStatus);
      }

      // Check for cost anomalies
      await this.checkCostAnomalies(costRecord);

      // Emit cost tracking event
      this.emit('costTracked', {
        costRecord,
        budgetStatus,
        timestamp: Date.now(),
      });
    } catch (error) {
      logger.error('Failed to track cost:', { error, costRecord });
    }
  }

  /**
   * Generate comprehensive cost analytics for a given timeframe
   */
  async generateCostAnalytics(timeframe: string = '24h'): Promise<CostAnalytics> {
    const endTime = Date.now();
    const startTime = this.calculateStartTime(endTime, timeframe);

    // Get cost records for the timeframe
    const records = await this.getCostRecords(startTime, endTime);

    if (records.length === 0) {
      return this.getEmptyAnalytics(timeframe);
    }

    // Calculate basic metrics
    const totalCost = records.reduce((sum, record) => sum + record.cost, 0);
    const totalRequests = records.length;
    const averageCostPerRequest = totalCost / totalRequests;
    const cacheHits = records.filter(r => r.cacheHit).length;
    const cacheHitRate = cacheHits / totalRequests;

    // Group by provider
    const providerBreakdown = this.groupByProvider(records);

    // Group by request type
    const requestTypeBreakdown = this.groupByRequestType(records);

    // Calculate trends
    const trends = await this.calculateTrends(records, timeframe);

    // Calculate projections
    const projections = this.calculateProjections(records, timeframe);

    return {
      timeframe,
      totalCost,
      totalRequests,
      averageCostPerRequest,
      cacheHitRate,
      providerBreakdown,
      requestTypeBreakdown,
      trends,
      projections,
    };
  }

  /**
   * Generate optimization recommendations based on current usage patterns
   */
  async generateOptimizationRecommendations(): Promise<OptimizationRecommendation[]> {
    const recommendations: OptimizationRecommendation[] = [];
    const analytics = await this.generateCostAnalytics('24h');

    // Cache optimization recommendations
    if (analytics.cacheHitRate < 0.7) {
      recommendations.push({
        id: `cache_opt_${Date.now()}`,
        type: 'CACHE_OPTIMIZATION',
        priority: 'HIGH',
        description: `Cache hit rate is ${(analytics.cacheHitRate * 100).toFixed(1)}%, below optimal 70%`,
        estimatedSavings: this.estimateCacheOptimizationSavings(analytics),
        implementationComplexity: 'MEDIUM',
        actionRequired: 'Increase cache TTL and implement predictive caching',
        metadata: {
          currentHitRate: analytics.cacheHitRate,
          targetHitRate: 0.75,
          potentialRequestReduction: (0.75 - analytics.cacheHitRate) * analytics.totalRequests,
        },
        validUntil: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      });
    }

    // Provider optimization recommendations
    const expensiveProviders = Object.entries(analytics.providerBreakdown)
      .filter(([_, data]) => data.efficiency < 0.6)
      .sort((a, b) => b[1].cost - a[1].cost);

    for (const [providerId, data] of expensiveProviders.slice(0, 3)) {
      recommendations.push({
        id: `provider_opt_${providerId}_${Date.now()}`,
        type: 'PROVIDER_SWITCH',
        priority: 'MEDIUM',
        description: `${providerId} shows low efficiency (${(data.efficiency * 100).toFixed(1)}%)`,
        estimatedSavings: data.cost * 0.3, // Assume 30% savings
        implementationComplexity: 'LOW',
        actionRequired: `Consider switching some requests from ${providerId} to lower-cost alternatives`,
        metadata: {
          currentProvider: providerId,
          currentCost: data.cost,
          currentRequests: data.requests,
          efficiency: data.efficiency,
        },
        validUntil: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
      });
    }

    // Request batching recommendations
    const batchableRequests = Object.entries(analytics.requestTypeBreakdown)
      .filter(([type, data]) => this.isBatchable(type) && data.requests > 50)
      .sort((a, b) => b[1].cost - a[1].cost);

    for (const [requestType, data] of batchableRequests.slice(0, 2)) {
      recommendations.push({
        id: `batch_opt_${requestType}_${Date.now()}`,
        type: 'BATCHING_OPTIMIZATION',
        priority: 'MEDIUM',
        description: `${requestType} requests could benefit from batching (${data.requests} individual requests)`,
        estimatedSavings: data.cost * 0.5, // Assume 50% savings from batching
        implementationComplexity: 'HIGH',
        actionRequired: `Implement request batching for ${requestType}`,
        metadata: {
          requestType,
          currentRequests: data.requests,
          currentCost: data.cost,
          estimatedBatchSize: Math.min(20, Math.ceil(data.requests / 10)),
        },
        validUntil: Date.now() + 14 * 24 * 60 * 60 * 1000, // 14 days
      });
    }

    return recommendations.sort((a, b) => {
      // Sort by priority first, then by estimated savings
      const priorityOrder = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
      const aPriority = priorityOrder[a.priority];
      const bPriority = priorityOrder[b.priority];

      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }

      return b.estimatedSavings - a.estimatedSavings;
    });
  }

  /**
   * Add a cost alert handler
   */
  addAlertHandler(handler: (alert: CostAlert) => Promise<void>): void {
    this.alertHandlers.push(handler);
  }

  /**
   * Get current budget status for all providers
   */
  getBudgetStatus(): Record<string, any> {
    const providers = ['default', 'alchemy', 'moralis'];
    const status: Record<string, any> = {};

    for (const providerId of providers) {
      status[providerId] = this.budgetTracker.getBudgetStatus(providerId);
    }

    return status;
  }

  private async storeCostRecord(record: CostRecord): Promise<void> {
    // Store in memory for quick access
    const key = `${record.providerId}_${record.requestType}`;
    if (!this.costHistory.has(key)) {
      this.costHistory.set(key, []);
    }

    const history = this.costHistory.get(key)!;
    history.push(record);

    // Keep only last 1000 records per key
    if (history.length > 1000) {
      history.splice(0, history.length - 500);
    }

    // Store in Redis for persistence
    const redisKey = `cost_records:${record.timestamp}`;
    await redisManager.set(redisKey, record, 7 * 24 * 60 * 60); // 7 days TTL

    // Update aggregated metrics in Redis
    await this.updateAggregatedMetrics(record);
  }

  private async updateAggregatedMetrics(record: CostRecord): Promise<void> {
    const currentHour = Math.floor(record.timestamp / (60 * 60 * 1000));
    const currentDay = Math.floor(record.timestamp / (24 * 60 * 60 * 1000));

    const hourlyKey = `cost_hourly:${currentHour}:${record.providerId}`;
    const dailyKey = `cost_daily:${currentDay}:${record.providerId}`;

    // Update hourly metrics
    const hourlyMetrics = (await redisManager.get(hourlyKey)) || {
      cost: 0,
      requests: 0,
      cacheHits: 0,
      totalResponseTime: 0,
      errors: 0,
    };

    hourlyMetrics.cost += record.cost;
    hourlyMetrics.requests += 1;
    if (record.cacheHit) hourlyMetrics.cacheHits += 1;
    hourlyMetrics.totalResponseTime += record.responseTime;
    if (!record.success) hourlyMetrics.errors += 1;

    await redisManager.set(hourlyKey, hourlyMetrics, 7 * 24 * 60 * 60); // 7 days

    // Update daily metrics
    const dailyMetrics = (await redisManager.get(dailyKey)) || {
      cost: 0,
      requests: 0,
      cacheHits: 0,
      totalResponseTime: 0,
      errors: 0,
    };

    dailyMetrics.cost += record.cost;
    dailyMetrics.requests += 1;
    if (record.cacheHit) dailyMetrics.cacheHits += 1;
    dailyMetrics.totalResponseTime += record.responseTime;
    if (!record.success) dailyMetrics.errors += 1;

    await redisManager.set(dailyKey, dailyMetrics, 30 * 24 * 60 * 60); // 30 days
  }

  private async triggerBudgetAlert(costRecord: CostRecord, budgetStatus: any): Promise<void> {
    const alert: CostAlert = {
      id: `budget_alert_${costRecord.providerId}_${Date.now()}`,
      type: 'BUDGET_THRESHOLD',
      severity: budgetStatus.severity,
      message: `${budgetStatus.budget} budget threshold exceeded for ${costRecord.providerId}`,
      currentValue: budgetStatus.utilizationRate,
      threshold: budgetStatus.overBudget ? 1.0 : 0.8,
      recommendations: this.getBudgetRecommendations(costRecord.providerId, budgetStatus),
      timestamp: Date.now(),
      metadata: {
        providerId: costRecord.providerId,
        budgetType: budgetStatus.budget,
        utilizationRate: budgetStatus.utilizationRate,
        costRecord,
      },
    };

    await this.processAlert(alert);
  }

  private async checkCostAnomalies(costRecord: CostRecord): Promise<void> {
    const key = `${costRecord.providerId}_${costRecord.requestType}`;
    const history = this.costHistory.get(key) || [];

    if (history.length < 10) return; // Need enough historical data

    const historicalCosts = history.slice(-50).map(r => r.cost); // Last 50 records
    const anomaly = this.anomalyDetector.detectCostAnomaly(costRecord.cost, historicalCosts);

    if (anomaly.isAnomaly) {
      const alert: CostAlert = {
        id: `anomaly_alert_${costRecord.providerId}_${costRecord.requestType}_${Date.now()}`,
        type: 'ANOMALY_DETECTION',
        severity: anomaly.severity,
        message: `Cost anomaly detected for ${costRecord.requestType} on ${costRecord.providerId}`,
        currentValue: costRecord.cost,
        threshold: anomaly.metadata.threshold,
        recommendations: [
          'Investigate request parameters for efficiency issues',
          'Check for potential API misuse or loops',
          'Verify provider pricing changes',
          'Review recent code changes affecting API usage',
        ],
        timestamp: Date.now(),
        metadata: {
          ...anomaly.metadata,
          providerId: costRecord.providerId,
          requestType: costRecord.requestType,
          confidence: anomaly.confidence,
        },
      };

      await this.processAlert(alert);
    }
  }

  private async processAlert(alert: CostAlert): Promise<void> {
    // Log the alert
    logger.warn('Cost optimization alert:', {
      id: alert.id,
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      currentValue: alert.currentValue,
      threshold: alert.threshold,
    });

    // Call all alert handlers
    await Promise.allSettled(this.alertHandlers.map(handler => handler(alert)));

    // Emit alert event
    this.emit('alert', alert);

    // Store alert for dashboard
    const alertKey = `cost_alerts:${alert.id}`;
    await redisManager.set(alertKey, alert, 24 * 60 * 60); // 24 hours TTL
  }

  private getBudgetRecommendations(providerId: string, budgetStatus: any): string[] {
    const recommendations = [];

    if (budgetStatus.severity === 'CRITICAL') {
      recommendations.push('Consider switching to a lower-cost provider immediately');
      recommendations.push('Enable emergency caching mode to reduce API calls');
      recommendations.push('Temporarily disable non-critical features');
    } else if (budgetStatus.severity === 'HIGH') {
      recommendations.push('Scale down non-critical requests');
      recommendations.push('Increase cache TTL to reduce API frequency');
      recommendations.push('Review request batching opportunities');
    } else {
      recommendations.push('Monitor usage closely');
      recommendations.push('Consider optimizing cache configuration');
      recommendations.push('Review request patterns for efficiency gains');
    }

    return recommendations;
  }

  private async getCostRecords(startTime: number, endTime: number): Promise<CostRecord[]> {
    const records: CostRecord[] = [];

    // Get from memory cache first
    for (const history of this.costHistory.values()) {
      const filtered = history.filter(r => r.timestamp >= startTime && r.timestamp <= endTime);
      records.push(...filtered);
    }

    // If we need more data, query Redis (simplified for this implementation)
    // In a production system, you'd implement proper time-series querying

    return records.sort((a, b) => a.timestamp - b.timestamp);
  }

  private groupByProvider(
    records: CostRecord[]
  ): Record<string, { cost: number; requests: number; efficiency: number }> {
    const groups: Record<
      string,
      { cost: number; requests: number; cacheHits: number; responseTime: number; errors: number }
    > = {};

    for (const record of records) {
      if (!groups[record.providerId]) {
        groups[record.providerId] = {
          cost: 0,
          requests: 0,
          cacheHits: 0,
          responseTime: 0,
          errors: 0,
        };
      }

      const group = groups[record.providerId];
      group.cost += record.cost;
      group.requests += 1;
      if (record.cacheHit) group.cacheHits += 1;
      group.responseTime += record.responseTime;
      if (!record.success) group.errors += 1;
    }

    // Calculate efficiency scores
    const result: Record<string, { cost: number; requests: number; efficiency: number }> = {};
    for (const [providerId, data] of Object.entries(groups)) {
      const cacheHitRate = data.cacheHits / data.requests;
      const avgResponseTime = data.responseTime / data.requests;
      const errorRate = data.errors / data.requests;
      const costPerRequest = data.cost / data.requests;

      // Efficiency score combines multiple factors (0-1 scale)
      const efficiency =
        cacheHitRate * 0.4 +
        (1 - Math.min(avgResponseTime / 2000, 1)) * 0.3 +
        (1 - errorRate) * 0.3;

      result[providerId] = {
        cost: data.cost,
        requests: data.requests,
        efficiency: Math.max(0, Math.min(1, efficiency)),
      };
    }

    return result;
  }

  private groupByRequestType(
    records: CostRecord[]
  ): Record<string, { cost: number; requests: number; averageCost: number }> {
    const groups: Record<string, { cost: number; requests: number }> = {};

    for (const record of records) {
      if (!groups[record.requestType]) {
        groups[record.requestType] = { cost: 0, requests: 0 };
      }

      groups[record.requestType].cost += record.cost;
      groups[record.requestType].requests += 1;
    }

    const result: Record<string, { cost: number; requests: number; averageCost: number }> = {};
    for (const [requestType, data] of Object.entries(groups)) {
      result[requestType] = {
        ...data,
        averageCost: data.cost / data.requests,
      };
    }

    return result;
  }

  private async calculateTrends(
    records: CostRecord[],
    timeframe: string
  ): Promise<CostAnalytics['trends']> {
    // Simplified trend calculation - in production, you'd use more sophisticated analysis
    const midPoint = Math.floor(records.length / 2);
    const firstHalf = records.slice(0, midPoint);
    const secondHalf = records.slice(midPoint);

    if (firstHalf.length === 0 || secondHalf.length === 0) {
      return { costTrend: 'stable', requestTrend: 'stable', efficiencyTrend: 'stable' };
    }

    const firstHalfCost = firstHalf.reduce((sum, r) => sum + r.cost, 0) / firstHalf.length;
    const secondHalfCost = secondHalf.reduce((sum, r) => sum + r.cost, 0) / secondHalf.length;
    const costChange = (secondHalfCost - firstHalfCost) / firstHalfCost;

    const firstHalfCacheRate = firstHalf.filter(r => r.cacheHit).length / firstHalf.length;
    const secondHalfCacheRate = secondHalf.filter(r => r.cacheHit).length / secondHalf.length;
    const efficiencyChange = secondHalfCacheRate - firstHalfCacheRate;

    return {
      costTrend: costChange > 0.1 ? 'increasing' : costChange < -0.1 ? 'decreasing' : 'stable',
      requestTrend:
        secondHalf.length > firstHalf.length
          ? 'increasing'
          : secondHalf.length < firstHalf.length
            ? 'decreasing'
            : 'stable',
      efficiencyTrend:
        efficiencyChange > 0.05 ? 'improving' : efficiencyChange < -0.05 ? 'degrading' : 'stable',
    };
  }

  private calculateProjections(
    records: CostRecord[],
    timeframe: string
  ): CostAnalytics['projections'] {
    if (records.length === 0) {
      return { dailyCost: 0, monthlyCost: 0, budgetUtilization: 0 };
    }

    const totalCost = records.reduce((sum, r) => sum + r.cost, 0);
    const timeframeDuration = this.getTimeframeDurationMs(timeframe);
    const costPerMs = totalCost / timeframeDuration;

    const dailyCost = costPerMs * (24 * 60 * 60 * 1000);
    const monthlyCost = costPerMs * (30 * 24 * 60 * 60 * 1000);
    const monthlyBudget = 500; // Default monthly budget
    const budgetUtilization = monthlyCost / monthlyBudget;

    return {
      dailyCost,
      monthlyCost,
      budgetUtilization,
    };
  }

  private calculateStartTime(endTime: number, timeframe: string): number {
    const durations: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };

    return endTime - (durations[timeframe] || durations['24h']);
  }

  private getTimeframeDurationMs(timeframe: string): number {
    const durations: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };

    return durations[timeframe] || durations['24h'];
  }

  private getEmptyAnalytics(timeframe: string): CostAnalytics {
    return {
      timeframe,
      totalCost: 0,
      totalRequests: 0,
      averageCostPerRequest: 0,
      cacheHitRate: 0,
      providerBreakdown: {},
      requestTypeBreakdown: {},
      trends: { costTrend: 'stable', requestTrend: 'stable', efficiencyTrend: 'stable' },
      projections: { dailyCost: 0, monthlyCost: 0, budgetUtilization: 0 },
    };
  }

  private estimateCacheOptimizationSavings(analytics: CostAnalytics): number {
    const potentialHitRateImprovement = 0.75 - analytics.cacheHitRate;
    const requestsReduced = potentialHitRateImprovement * analytics.totalRequests;
    return requestsReduced * analytics.averageCostPerRequest;
  }

  private isBatchable(requestType: string): boolean {
    const batchableTypes = [
      'token_balances',
      'token_prices',
      'token_metadata',
      'transaction_history',
    ];
    return batchableTypes.includes(requestType);
  }

  private startBackgroundOptimization(): void {
    // Run optimization analysis every 5 minutes
    setInterval(
      async () => {
        try {
          await this.performBackgroundOptimization();
        } catch (error) {
          logger.error('Background optimization failed:', error);
        }
      },
      5 * 60 * 1000
    ); // 5 minutes
  }

  private async performBackgroundOptimization(): Promise<void> {
    const analytics = await this.generateCostAnalytics('1h'); // Last hour

    // Check if we should trigger any automatic optimizations
    if (analytics.cacheHitRate < 0.5 && analytics.totalRequests > 100) {
      this.emit('optimizationSuggestion', {
        type: 'CACHE_EMERGENCY',
        message: 'Cache hit rate critically low, consider immediate optimization',
        analytics,
      });
    }

    if (analytics.projections.budgetUtilization > 1.2) {
      this.emit('optimizationSuggestion', {
        type: 'BUDGET_EMERGENCY',
        message: 'Projected to exceed monthly budget, immediate action required',
        analytics,
      });
    }
  }
}
