import { EventEmitter } from 'events';
import { logger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { config } from '@/config';
import { ChainId } from '@/types/blockchain';

export interface CostRecord {
  id: string;
  timestamp: number;
  provider: string;
  endpoint: string;
  chainId?: ChainId;
  cost: number;
  requestType: string;
  cacheHit: boolean;
  success: boolean;
}

export interface CostSummary {
  period: string;
  totalCost: number;
  totalRequests: number;
  averageCostPerRequest: number;
  cacheHitRate: number;
  providerBreakdown: Record<string, {
    cost: number;
    requests: number;
    averageCost: number;
  }>;
}

export interface CostAlert {
  id: string;
  type: 'budget_threshold' | 'anomaly';
  severity: 'warning' | 'critical';
  message: string;
  provider?: string;
  currentValue: number;
  threshold?: number;
  timestamp: number;
}

export interface CostLimits {
  hourly: number;
  daily: number;
  monthly: number;
  perProvider: Record<string, {
    hourly: number;
    daily: number;
    monthly: number;
  }>;
}

/**
 * Simplified Cost Tracking Service
 * 
 * Focuses on essential cost tracking without over-engineering:
 * - Basic cost recording and aggregation
 * - Simple budget alerts
 * - Provider-level cost breakdown
 */
export class CostTracker extends EventEmitter {
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

  private alertCooldowns = new Map<string, number>();
  private readonly alertCooldownPeriod = 5 * 60 * 1000; // 5 minutes

  constructor() {
    super();
    this.startPeriodicBudgetCheck();
  }

  /**
   * Track an API call cost
   */
  async trackCost(
    provider: string,
    endpoint: string,
    cost: number,
    options: {
      chainId?: ChainId;
      requestType?: string;
      cacheHit?: boolean;
      success?: boolean;
    } = {}
  ): Promise<void> {
    const record: CostRecord = {
      id: `cost_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      provider,
      endpoint,
      chainId: options.chainId,
      cost,
      requestType: options.requestType ?? 'unknown',
      cacheHit: options.cacheHit ?? false,
      success: options.success ?? true,
    };

    try {
      // Store the cost record
      await this.storeCostRecord(record);

      // Update real-time metrics
      await this.updateRealTimeMetrics(record);

      // Check budget thresholds
      await this.checkBudgetThresholds(provider, cost);

      this.emit('costTracked', record);

      logger.debug('Cost tracked', {
        provider,
        endpoint,
        cost,
        requestType: record.requestType,
        cacheHit: record.cacheHit,
      });
    } catch (error) {
      logger.error('Failed to track cost:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        provider,
        endpoint,
        cost,
      });
    }
  }

  /**
   * Get cost summary for a timeframe
   */
  async getCostSummary(timeframe: '1h' | '24h' | '7d' | '30d'): Promise<CostSummary> {
    try {
      const endTime = Date.now();
      const startTime = this.getStartTime(timeframe, endTime);
      const records = await this.getCostRecords(startTime, endTime);

      if (records.length === 0) {
        return {
          period: timeframe,
          totalCost: 0,
          totalRequests: 0,
          averageCostPerRequest: 0,
          cacheHitRate: 0,
          providerBreakdown: {},
        };
      }

      const totalCost = records.reduce((sum, record) => sum + record.cost, 0);
      const totalRequests = records.length;
      const cacheHits = records.filter(record => record.cacheHit).length;

      // Provider breakdown
      const providerBreakdown: Record<string, any> = {};
      for (const record of records) {
        if (!providerBreakdown[record.provider]) {
          providerBreakdown[record.provider] = { cost: 0, requests: 0 };
        }
        providerBreakdown[record.provider].cost += record.cost;
        providerBreakdown[record.provider].requests += 1;
      }

      // Calculate averages
      for (const provider of Object.keys(providerBreakdown)) {
        const data = providerBreakdown[provider];
        data.averageCost = data.cost / data.requests;
      }

      return {
        period: timeframe,
        totalCost,
        totalRequests,
        averageCostPerRequest: totalCost / totalRequests,
        cacheHitRate: cacheHits / totalRequests,
        providerBreakdown,
      };
    } catch (error) {
      logger.error('Failed to get cost summary:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        timeframe,
      });
      throw error;
    }
  }

  /**
   * Check budget limits and trigger alerts
   */
  async checkBudgetLimits(): Promise<CostAlert[]> {
    const alerts: CostAlert[] = [];

    try {
      // Check overall budget limits
      const hourlySpend = await this.getPeriodSpend('1h');
      const dailySpend = await this.getPeriodSpend('24h');
      const monthlySpend = await this.getPeriodSpend('30d');

      if (hourlySpend > this.costLimits.hourly * 0.8) {
        alerts.push(this.createBudgetAlert('hourly', hourlySpend, this.costLimits.hourly));
      }

      if (dailySpend > this.costLimits.daily * 0.8) {
        alerts.push(this.createBudgetAlert('daily', dailySpend, this.costLimits.daily));
      }

      if (monthlySpend > this.costLimits.monthly * 0.8) {
        alerts.push(this.createBudgetAlert('monthly', monthlySpend, this.costLimits.monthly));
      }

      // Check per-provider limits
      for (const [provider, limits] of Object.entries(this.costLimits.perProvider)) {
        const providerHourly = await this.getProviderSpend(provider, '1h');
        const providerDaily = await this.getProviderSpend(provider, '24h');
        const providerMonthly = await this.getProviderSpend(provider, '30d');

        if (providerHourly > limits.hourly * 0.8) {
          alerts.push(this.createProviderBudgetAlert(provider, 'hourly', providerHourly, limits.hourly));
        }

        if (providerDaily > limits.daily * 0.8) {
          alerts.push(this.createProviderBudgetAlert(provider, 'daily', providerDaily, limits.daily));
        }

        if (providerMonthly > limits.monthly * 0.8) {
          alerts.push(this.createProviderBudgetAlert(provider, 'monthly', providerMonthly, limits.monthly));
        }
      }

      return alerts;
    } catch (error) {
      logger.error('Failed to check budget limits:', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Set cost limits
   */
  setCostLimits(limits: CostLimits): void {
    this.costLimits = { ...limits };
    logger.info('Cost limits updated', { limits });
    this.emit('limitsUpdated', limits);
  }

  /**
   * Get current statistics for health checks
   */
  getCurrentStats() {
    return {
      totalCost: 0, // Simplified - would calculate from recent records
      totalRequests: 0,
      averageCostPerRequest: 0,
      budgetUtilization: 0,
      providerBreakdown: {},
      status: 'active',
      lastUpdated: new Date().toISOString(),
    };
  }

  // Private helper methods

  private async storeCostRecord(record: CostRecord): Promise<void> {
    try {
      // Store individual record
      const recordKey = `${config.redis.keyPrefix}cost_record:${record.id}`;
      await redisManager.set(recordKey, record, 30 * 24 * 60 * 60); // 30 days

      // Add to time-series data
      const hourKey = `${config.redis.keyPrefix}cost_hourly:${Math.floor(record.timestamp / (60 * 60 * 1000))}`;
      await redisManager.lpush(`${hourKey}:records`, record.id);
      await redisManager.expire(`${hourKey}:records`, 7 * 24 * 60 * 60); // 7 days
    } catch (error) {
      logger.error('Failed to store cost record:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        recordId: record.id,
      });
    }
  }

  private async updateRealTimeMetrics(record: CostRecord): Promise<void> {
    try {
      const metricsKey = `${config.redis.keyPrefix}cost_metrics_realtime`;
      await redisManager.hincrby(metricsKey, 'total_requests', 1);
      await redisManager.hincrbyfloat(metricsKey, 'total_cost', record.cost);

      if (record.cacheHit) {
        await redisManager.hincrby(metricsKey, 'cache_hits', 1);
      }

      await redisManager.hincrby(metricsKey, `provider_${record.provider}_requests`, 1);
      await redisManager.hincrbyfloat(metricsKey, `provider_${record.provider}_cost`, record.cost);

      await redisManager.expire(metricsKey, 60 * 60); // 1 hour
    } catch (error) {
      logger.error('Failed to update real-time metrics:', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async checkBudgetThresholds(provider: string, additionalCost: number): Promise<void> {
    try {
      const hourlySpend = await this.getProviderSpend(provider, '1h');
      const providerLimits = this.costLimits.perProvider[provider];
      
      if (!providerLimits) return;

      if (hourlySpend + additionalCost > providerLimits.hourly) {
        const alert = this.createProviderBudgetAlert(
          provider,
          'hourly',
          hourlySpend + additionalCost,
          providerLimits.hourly
        );
        this.emitAlert(alert);
      }
    } catch (error) {
      logger.error('Failed to check budget thresholds:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        provider,
      });
    }
  }

  private emitAlert(alert: CostAlert): void {
    const cooldownKey = `${alert.type}_${alert.provider || 'global'}`;
    const lastAlertTime = this.alertCooldowns.get(cooldownKey) || 0;

    if (Date.now() - lastAlertTime < this.alertCooldownPeriod) {
      return; // Skip alert due to cooldown
    }

    this.alertCooldowns.set(cooldownKey, Date.now());
    this.emit('alert', alert);

    logger.warn('Cost alert triggered', {
      alertId: alert.id,
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      provider: alert.provider,
      currentValue: alert.currentValue,
      threshold: alert.threshold,
    });
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
      logger.error('Failed to get cost records:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        startTime,
        endTime,
      });
      return [];
    }
  }

  private async getPeriodSpend(period: '1h' | '24h' | '30d'): Promise<number> {
    try {
      const summary = await this.getCostSummary(period);
      return summary.totalCost;
    } catch (error) {
      return 0;
    }
  }

  private async getProviderSpend(provider: string, period: '1h' | '24h' | '30d'): Promise<number> {
    try {
      const summary = await this.getCostSummary(period);
      return summary.providerBreakdown[provider]?.cost || 0;
    } catch (error) {
      return 0;
    }
  }

  private createBudgetAlert(period: string, currentSpend: number, threshold: number): CostAlert {
    const severity: CostAlert['severity'] = currentSpend >= threshold ? 'critical' : 'warning';

    return {
      id: `budget_${period}_${Date.now()}`,
      type: 'budget_threshold',
      severity,
      message: `${period} budget threshold approaching: $${currentSpend.toFixed(4)} / $${threshold.toFixed(2)}`,
      currentValue: currentSpend,
      threshold,
      timestamp: Date.now(),
    };
  }

  private createProviderBudgetAlert(
    provider: string,
    period: string,
    currentSpend: number,
    threshold: number
  ): CostAlert {
    const severity: CostAlert['severity'] = currentSpend >= threshold ? 'critical' : 'warning';

    return {
      id: `provider_budget_${provider}_${period}_${Date.now()}`,
      type: 'budget_threshold',
      severity,
      message: `${provider} ${period} budget threshold approaching: $${currentSpend.toFixed(4)} / $${threshold.toFixed(2)}`,
      provider,
      currentValue: currentSpend,
      threshold,
      timestamp: Date.now(),
    };
  }

  private startPeriodicBudgetCheck(): void {
    // Check budgets every 5 minutes
    setInterval(async () => {
      try {
        const alerts = await this.checkBudgetLimits();
        alerts.forEach(alert => this.emitAlert(alert));
      } catch (error) {
        logger.error('Periodic budget check failed:', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }, 5 * 60 * 1000);
  }
}

// Export singleton instance
let costTrackerInstance: CostTracker | null = null;

export const getCostTracker = (): CostTracker => {
  if (!costTrackerInstance) {
    costTrackerInstance = new CostTracker();
  }
  return costTrackerInstance;
};

export default getCostTracker;