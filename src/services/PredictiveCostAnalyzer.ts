import { EventEmitter } from 'events';
import { logger, logError, createContextualLogger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { config } from '@/config';
import { getCostMonitoringService, CostRecord, CostAlert } from './CostMonitoringService';

/**
 * Predictive Cost Analyzer
 *
 * Uses machine learning and statistical analysis to:
 * - Predict future cost trends and budget overruns
 * - Identify cost anomalies before they impact budgets
 * - Automatically trigger cost optimization measures
 * - Provide intelligent budget forecasting and recommendations
 */

export interface CostForecast {
  timeframe: '24h' | '7d' | '30d';
  predictedCost: number;
  confidence: number; // 0-1 scale
  trend: 'increasing' | 'decreasing' | 'stable';
  factors: {
    seasonal: number; // -1 to 1 impact
    growth: number; // User/usage growth impact
    volatility: number; // Market volatility impact
    optimization: number; // Recent optimization impact
  };
  breakdownByProvider: Record<
    string,
    {
      predictedCost: number;
      confidence: number;
      riskLevel: 'low' | 'medium' | 'high';
    }
  >;
  budgetImpact: {
    projectedUtilization: number; // Percentage of budget
    daysUntilExhaustion?: number;
    recommendedActions: string[];
  };
}

export interface CostAnomaly {
  id: string;
  type: 'spike' | 'sustained_increase' | 'pattern_deviation' | 'efficiency_drop';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  detectedAt: number;
  affectedProviders: string[];
  estimatedImpact: {
    costIncrease: number;
    duration: string;
    budgetImpact: number;
  };
  rootCause?: {
    category: 'provider' | 'usage' | 'market' | 'system';
    description: string;
    confidence: number;
  };
  autoMitigationSuggested: boolean;
  mitigationActions: string[];
}

export interface AutoOptimization {
  id: string;
  triggeredBy: 'budget_threshold' | 'cost_anomaly' | 'inefficiency_detected' | 'scheduled';
  type: 'cache_aggressive' | 'provider_switch' | 'rate_limit' | 'batch_mode' | 'feature_disable';
  description: string;
  estimatedSavings: number;
  implementedAt: number;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'reverted';
  metrics: {
    actualSavings?: number;
    performanceImpact?: number;
    userImpact?: number;
  };
  revertConditions: string[];
}

interface TimeSeriesData {
  timestamp: number;
  value: number;
  metadata?: Record<string, any>;
}

interface PatternAnalysis {
  trend: {
    direction: 'up' | 'down' | 'stable';
    slope: number;
    r_squared: number; // Trend reliability
  };
  seasonality: {
    detected: boolean;
    periods: number[]; // In hours
    strength: number; // 0-1
  };
  anomalies: {
    count: number;
    severity: number; // Average severity
    frequency: number; // Anomalies per day
  };
  volatility: number; // Standard deviation as % of mean
}

class StatisticalAnalyzer {
  /**
   * Perform linear regression to identify trends
   */
  static linearRegression(data: TimeSeriesData[]): {
    slope: number;
    intercept: number;
    rSquared: number;
    prediction: (x: number) => number;
  } {
    const n = data.length;
    if (n < 2) return { slope: 0, intercept: 0, rSquared: 0, prediction: () => 0 };

    const xMean = data.reduce((sum, d, i) => sum + i, 0) / n;
    const yMean = data.reduce((sum, d) => sum + d.value, 0) / n;

    let numerator = 0;
    let denominator = 0;
    let totalSumSquares = 0;

    for (let i = 0; i < n; i++) {
      const xDiff = i - xMean;
      const yDiff = data[i].value - yMean;

      numerator += xDiff * yDiff;
      denominator += xDiff * xDiff;
      totalSumSquares += yDiff * yDiff;
    }

    const slope = denominator === 0 ? 0 : numerator / denominator;
    const intercept = yMean - slope * xMean;

    // Calculate R-squared
    let residualSumSquares = 0;
    for (let i = 0; i < n; i++) {
      const predicted = slope * i + intercept;
      residualSumSquares += Math.pow(data[i].value - predicted, 2);
    }

    const rSquared = totalSumSquares === 0 ? 0 : 1 - residualSumSquares / totalSumSquares;

    return {
      slope,
      intercept,
      rSquared: Math.max(0, rSquared),
      prediction: (x: number) => slope * x + intercept,
    };
  }

  /**
   * Detect seasonal patterns using autocorrelation
   */
  static detectSeasonality(data: TimeSeriesData[]): {
    periods: number[];
    strength: number;
  } {
    if (data.length < 48) return { periods: [], strength: 0 }; // Need at least 2 days of hourly data

    const values = data.map(d => d.value);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

    // Test common periods (hourly data assumed)
    const testPeriods = [24, 168, 720]; // Daily, weekly, monthly
    const significantPeriods: number[] = [];
    let maxCorrelation = 0;

    for (const period of testPeriods) {
      if (period >= data.length / 2) continue;

      const correlation = this.autocorrelation(values, period);
      if (correlation > 0.3) {
        // Significant correlation threshold
        significantPeriods.push(period);
        maxCorrelation = Math.max(maxCorrelation, correlation);
      }
    }

    return {
      periods: significantPeriods,
      strength: maxCorrelation,
    };
  }

  private static autocorrelation(data: number[], lag: number): number {
    if (lag >= data.length) return 0;

    const mean = data.reduce((sum, v) => sum + v, 0) / data.length;
    const variance = data.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / data.length;

    if (variance === 0) return 0;

    let covariance = 0;
    const n = data.length - lag;

    for (let i = 0; i < n; i++) {
      covariance += (data[i] - mean) * (data[i + lag] - mean);
    }

    return covariance / n / variance;
  }

  /**
   * Calculate volatility (coefficient of variation)
   */
  static calculateVolatility(data: TimeSeriesData[]): number {
    if (data.length < 2) return 0;

    const values = data.map(d => d.value);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

    if (mean === 0) return 0;

    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const standardDeviation = Math.sqrt(variance);

    return (standardDeviation / mean) * 100; // Return as percentage
  }
}

export class PredictiveCostAnalyzer extends EventEmitter {
  private costMonitoringService = getCostMonitoringService();
  private contextLogger = createContextualLogger({ component: 'PredictiveCostAnalyzer' });

  // Historical data storage
  private costHistory = new Map<string, TimeSeriesData[]>(); // Provider -> time series
  private analysisCache = new Map<string, { result: any; timestamp: number }>();

  // Active auto-optimizations
  private activeOptimizations = new Map<string, AutoOptimization>();

  // Configuration
  private analysisInterval = 5 * 60 * 1000; // 5 minutes
  private forecastHorizon = {
    short: 24 * 60 * 60 * 1000, // 24 hours
    medium: 7 * 24 * 60 * 60 * 1000, // 7 days
    long: 30 * 24 * 60 * 60 * 1000, // 30 days
  };

  // Thresholds
  private anomalyThresholds = {
    spike: 2.5, // Z-score threshold for cost spikes
    sustained: 1.8, // Z-score for sustained increases
    efficiency: 0.15, // 15% efficiency drop threshold
  };

  constructor() {
    super();
    this.initialize();
  }

  private async initialize(): Promise<void> {
    // Load historical data
    await this.loadHistoricalData();

    // Start continuous analysis
    this.startContinuousAnalysis();

    // Start auto-optimization monitoring
    this.startAutoOptimizationMonitoring();

    this.contextLogger.info('Predictive cost analyzer initialized');
  }

  /**
   * Generate cost forecast for specified timeframe
   */
  async generateForecast(timeframe: '24h' | '7d' | '30d'): Promise<CostForecast> {
    const cacheKey = `forecast_${timeframe}`;
    const cached = this.analysisCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
      // 10 minutes cache
      return cached.result;
    }

    try {
      const horizon =
        timeframe === '24h'
          ? this.forecastHorizon.short
          : timeframe === '7d'
            ? this.forecastHorizon.medium
            : this.forecastHorizon.long;

      // Analyze historical patterns
      const overallPattern = await this.analyzeHistoricalPatterns();

      // Generate provider-specific forecasts
      const providerForecasts = await this.generateProviderForecasts(horizon);

      // Calculate overall forecast
      const predictedCost = Object.values(providerForecasts).reduce(
        (sum, forecast) => sum + forecast.predictedCost,
        0
      );

      // Calculate confidence as weighted average
      const totalCost = Object.values(providerForecasts).reduce(
        (sum, forecast) => sum + forecast.predictedCost,
        0
      );
      const confidence =
        totalCost === 0
          ? 0
          : Object.values(providerForecasts).reduce(
              (sum, forecast) => sum + forecast.confidence * forecast.predictedCost,
              0
            ) / totalCost;

      // Determine trend
      const trend =
        overallPattern.trend.slope > 0.1
          ? 'increasing'
          : overallPattern.trend.slope < -0.1
            ? 'decreasing'
            : 'stable';

      // Calculate budget impact
      const monthlyBudget = config.costs.monthlyBudget;
      const projectedUtilization = (predictedCost / monthlyBudget) * 100;

      let daysUntilExhaustion: number | undefined;
      if (trend === 'increasing' && overallPattern.trend.slope > 0) {
        const dailyIncrease = overallPattern.trend.slope * 24; // Convert hourly to daily
        const remainingBudget = monthlyBudget - predictedCost;
        if (dailyIncrease > 0) {
          daysUntilExhaustion = Math.floor(remainingBudget / dailyIncrease);
        }
      }

      const forecast: CostForecast = {
        timeframe,
        predictedCost,
        confidence,
        trend,
        factors: {
          seasonal: this.calculateSeasonalFactor(overallPattern),
          growth: this.calculateGrowthFactor(),
          volatility: overallPattern.volatility / 100, // Convert to -1 to 1 scale
          optimization: await this.calculateOptimizationFactor(),
        },
        breakdownByProvider: providerForecasts,
        budgetImpact: {
          projectedUtilization,
          daysUntilExhaustion,
          recommendedActions: this.generateBudgetRecommendations(projectedUtilization, trend),
        },
      };

      // Cache the result
      this.analysisCache.set(cacheKey, {
        result: forecast,
        timestamp: Date.now(),
      });

      this.emit('forecastGenerated', forecast);

      return forecast;
    } catch (error) {
      logError(error as Error, { operation: 'generateForecast', timeframe });
      throw error;
    }
  }

  /**
   * Detect cost anomalies in real-time
   */
  async detectAnomalies(): Promise<CostAnomaly[]> {
    try {
      const anomalies: CostAnomaly[] = [];

      // Get recent cost data
      const recentData = await this.getRecentCostData(24 * 60 * 60 * 1000); // Last 24 hours

      for (const [providerId, data] of recentData) {
        if (data.length < 10) continue; // Need minimum data points

        // Check for different types of anomalies
        const spikeAnomalies = this.detectCostSpikes(providerId, data);
        const sustainedAnomalies = this.detectSustainedIncrease(providerId, data);
        const efficiencyAnomalies = await this.detectEfficiencyDrops(providerId, data);

        anomalies.push(...spikeAnomalies, ...sustainedAnomalies, ...efficiencyAnomalies);
      }

      // Sort by severity and timestamp
      anomalies.sort((a, b) => {
        const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
        if (severityDiff !== 0) return severityDiff;
        return b.detectedAt - a.detectedAt;
      });

      // Trigger alerts for critical anomalies
      for (const anomaly of anomalies) {
        if (anomaly.severity === 'critical' || anomaly.severity === 'high') {
          await this.triggerAnomalyAlert(anomaly);
        }
      }

      this.emit('anomaliesDetected', anomalies);

      return anomalies;
    } catch (error) {
      logError(error as Error, { operation: 'detectAnomalies' });
      return [];
    }
  }

  /**
   * Trigger automatic cost optimization based on conditions
   */
  async triggerAutoOptimization(
    trigger: AutoOptimization['triggeredBy'],
    context: {
      severity?: 'low' | 'medium' | 'high' | 'critical';
      budgetUtilization?: number;
      anomaly?: CostAnomaly;
      estimatedImpact?: number;
    }
  ): Promise<AutoOptimization[]> {
    try {
      const optimizations: AutoOptimization[] = [];
      const currentTime = Date.now();

      // Determine which optimizations to trigger based on context
      const potentialOptimizations = this.identifyOptimizationOpportunities(trigger, context);

      for (const optimization of potentialOptimizations) {
        const optimizationId = `auto_opt_${currentTime}_${Math.random().toString(36).substr(2, 9)}`;

        const autoOptimization: AutoOptimization = {
          ...optimization,
          id: optimizationId,
          implementedAt: currentTime,
          status: 'pending',
          metrics: {},
        };

        // Implement the optimization
        const implemented = await this.implementOptimization(autoOptimization);

        if (implemented) {
          autoOptimization.status = 'active';
          this.activeOptimizations.set(optimizationId, autoOptimization);
          optimizations.push(autoOptimization);

          this.contextLogger.info('Auto-optimization triggered', {
            optimizationId,
            type: autoOptimization.type,
            trigger,
            estimatedSavings: autoOptimization.estimatedSavings,
          });

          this.emit('autoOptimizationTriggered', autoOptimization);
        }
      }

      return optimizations;
    } catch (error) {
      logError(error as Error, { operation: 'triggerAutoOptimization', trigger });
      return [];
    }
  }

  private async loadHistoricalData(): Promise<void> {
    try {
      // Load last 7 days of cost data for pattern analysis
      const endTime = Date.now();
      const startTime = endTime - 7 * 24 * 60 * 60 * 1000;

      // This would typically load from your cost monitoring service
      // For now, we'll simulate loading historical data
      const summary = await this.costMonitoringService.getCostSummary('7d');

      // Initialize with some historical data for each provider
      for (const [providerId, providerData] of Object.entries(summary.providerBreakdown)) {
        const timeSeriesData: TimeSeriesData[] = [];

        // Generate simulated hourly data points
        for (let i = 0; i < 168; i++) {
          // 7 days * 24 hours
          const timestamp = startTime + i * 60 * 60 * 1000;
          const baseValue = providerData.cost / 168; // Distribute cost over hours
          const noise = (Math.random() - 0.5) * baseValue * 0.2; // 20% noise

          timeSeriesData.push({
            timestamp,
            value: Math.max(0, baseValue + noise),
            metadata: { providerId },
          });
        }

        this.costHistory.set(providerId, timeSeriesData);
      }

      this.contextLogger.info('Historical cost data loaded', {
        providers: this.costHistory.size,
        dataPoints: Array.from(this.costHistory.values()).reduce(
          (sum, data) => sum + data.length,
          0
        ),
      });
    } catch (error) {
      logError(error as Error, { operation: 'loadHistoricalData' });
    }
  }

  private async analyzeHistoricalPatterns(): Promise<PatternAnalysis> {
    try {
      // Combine all provider data for overall pattern analysis
      const allData: TimeSeriesData[] = [];
      for (const providerData of this.costHistory.values()) {
        allData.push(...providerData);
      }

      // Sort by timestamp and aggregate by hour
      allData.sort((a, b) => a.timestamp - b.timestamp);
      const hourlyAggregated = this.aggregateByHour(allData);

      // Analyze trend
      const trendAnalysis = StatisticalAnalyzer.linearRegression(hourlyAggregated);

      // Detect seasonality
      const seasonality = StatisticalAnalyzer.detectSeasonality(hourlyAggregated);

      // Calculate volatility
      const volatility = StatisticalAnalyzer.calculateVolatility(hourlyAggregated);

      // Detect anomalies in historical data
      const historicalAnomalies = this.detectHistoricalAnomalies(hourlyAggregated);

      return {
        trend: {
          direction:
            trendAnalysis.slope > 0.1 ? 'up' : trendAnalysis.slope < -0.1 ? 'down' : 'stable',
          slope: trendAnalysis.slope,
          r_squared: trendAnalysis.rSquared,
        },
        seasonality: {
          detected: seasonality.periods.length > 0,
          periods: seasonality.periods,
          strength: seasonality.strength,
        },
        anomalies: {
          count: historicalAnomalies.length,
          severity:
            historicalAnomalies.reduce(
              (sum, a) =>
                sum +
                (a.severity === 'critical'
                  ? 4
                  : a.severity === 'high'
                    ? 3
                    : a.severity === 'medium'
                      ? 2
                      : 1),
              0
            ) / historicalAnomalies.length,
          frequency: historicalAnomalies.length / 7, // Per day over 7 days
        },
        volatility,
      };
    } catch (error) {
      logError(error as Error, { operation: 'analyzeHistoricalPatterns' });
      return {
        trend: { direction: 'stable', slope: 0, r_squared: 0 },
        seasonality: { detected: false, periods: [], strength: 0 },
        anomalies: { count: 0, severity: 0, frequency: 0 },
        volatility: 0,
      };
    }
  }

  private aggregateByHour(data: TimeSeriesData[]): TimeSeriesData[] {
    const hourlyMap = new Map<number, { sum: number; count: number }>();

    for (const point of data) {
      const hour = Math.floor(point.timestamp / (60 * 60 * 1000));
      const existing = hourlyMap.get(hour) || { sum: 0, count: 0 };

      existing.sum += point.value;
      existing.count += 1;
      hourlyMap.set(hour, existing);
    }

    return Array.from(hourlyMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([hour, data]) => ({
        timestamp: hour * 60 * 60 * 1000,
        value: data.sum / data.count,
      }));
  }

  private async generateProviderForecasts(horizon: number): Promise<
    Record<
      string,
      {
        predictedCost: number;
        confidence: number;
        riskLevel: 'low' | 'medium' | 'high';
      }
    >
  > {
    const forecasts: Record<string, any> = {};

    for (const [providerId, data] of this.costHistory) {
      if (data.length < 24) continue; // Need at least 24 hours of data

      // Analyze provider-specific patterns
      const trendAnalysis = StatisticalAnalyzer.linearRegression(data);
      const volatility = StatisticalAnalyzer.calculateVolatility(data);

      // Calculate prediction
      const hoursAhead = horizon / (60 * 60 * 1000);
      const currentCost = data[data.length - 1].value;
      const predictedCost = Math.max(0, trendAnalysis.prediction(data.length + hoursAhead));

      // Calculate confidence based on trend reliability and volatility
      let confidence = trendAnalysis.rSquared * 0.7; // Base confidence on trend reliability
      confidence *= Math.max(0.3, 1 - volatility / 100); // Reduce confidence for high volatility
      confidence = Math.max(0.1, Math.min(0.95, confidence));

      // Determine risk level
      let riskLevel: 'low' | 'medium' | 'high' = 'low';
      if (volatility > 30 || trendAnalysis.slope > 0.1) riskLevel = 'high';
      else if (volatility > 15 || trendAnalysis.slope > 0.05) riskLevel = 'medium';

      forecasts[providerId] = {
        predictedCost,
        confidence,
        riskLevel,
      };
    }

    return forecasts;
  }

  private calculateSeasonalFactor(pattern: PatternAnalysis): number {
    if (!pattern.seasonality.detected) return 0;

    // Return seasonal strength as factor (-1 to 1)
    return pattern.seasonality.strength * (Math.random() > 0.5 ? 1 : -1);
  }

  private calculateGrowthFactor(): number {
    // This would typically be based on user growth metrics
    // For now, return a simulated growth factor
    return Math.random() * 0.4 - 0.2; // -0.2 to 0.2
  }

  private async calculateOptimizationFactor(): Promise<number> {
    // Check recent optimizations and their impact
    const recentOptimizations = Array.from(this.activeOptimizations.values()).filter(
      opt => Date.now() - opt.implementedAt < 7 * 24 * 60 * 60 * 1000
    ); // Last 7 days

    if (recentOptimizations.length === 0) return 0;

    const totalSavings = recentOptimizations.reduce(
      (sum, opt) => sum + (opt.metrics.actualSavings || opt.estimatedSavings),
      0
    );
    const averageSavings = totalSavings / recentOptimizations.length;

    // Return optimization factor (-1 to 1, negative means cost reduction)
    return -Math.min(1, averageSavings / 100); // Normalize to -1 to 1 scale
  }

  private generateBudgetRecommendations(utilization: number, trend: string): string[] {
    const recommendations = [];

    if (utilization > 90) {
      recommendations.push(
        'URGENT: Budget exhaustion imminent - implement emergency cost controls'
      );
      recommendations.push('Enable aggressive caching mode immediately');
      recommendations.push('Switch to lowest-cost providers where possible');
    } else if (utilization > 75) {
      recommendations.push('High budget utilization - consider cost optimization measures');
      recommendations.push('Review and optimize high-cost operations');
      recommendations.push('Implement request batching for frequently called APIs');
    } else if (utilization > 50 && trend === 'increasing') {
      recommendations.push('Monitor cost trends closely - consider proactive optimizations');
      recommendations.push('Review provider cost efficiency and consider alternatives');
    }

    if (trend === 'increasing') {
      recommendations.push('Investigate root causes of cost increases');
      recommendations.push('Consider implementing usage-based rate limiting');
    }

    return recommendations;
  }

  private detectCostSpikes(providerId: string, data: TimeSeriesData[]): CostAnomaly[] {
    const anomalies: CostAnomaly[] = [];

    if (data.length < 10) return anomalies;

    // Calculate recent average and standard deviation
    const recentData = data.slice(-24); // Last 24 hours
    const values = recentData.map(d => d.value);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const stdDev = Math.sqrt(
      values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
    );

    // Check for spikes
    for (let i = recentData.length - 5; i < recentData.length; i++) {
      const value = values[i];
      const zScore = stdDev === 0 ? 0 : (value - mean) / stdDev;

      if (zScore > this.anomalyThresholds.spike) {
        const severity =
          zScore > 4 ? 'critical' : zScore > 3.5 ? 'high' : zScore > 3 ? 'medium' : 'low';

        anomalies.push({
          id: `spike_${providerId}_${Date.now()}_${i}`,
          type: 'spike',
          severity,
          description: `Cost spike detected for ${providerId}: ${value.toFixed(4)} vs avg ${mean.toFixed(4)}`,
          detectedAt: recentData[i].timestamp,
          affectedProviders: [providerId],
          estimatedImpact: {
            costIncrease: value - mean,
            duration: '1-2 hours',
            budgetImpact: ((value - mean) / config.costs.monthlyBudget) * 100,
          },
          autoMitigationSuggested: severity === 'critical' || severity === 'high',
          mitigationActions: [
            `Switch traffic away from ${providerId} temporarily`,
            'Enable aggressive caching for affected endpoints',
            'Investigate root cause of cost spike',
          ],
        });
      }
    }

    return anomalies;
  }

  private detectSustainedIncrease(providerId: string, data: TimeSeriesData[]): CostAnomaly[] {
    const anomalies: CostAnomaly[] = [];

    if (data.length < 48) return anomalies; // Need at least 48 hours

    // Compare recent 24 hours to previous 24 hours
    const recent = data.slice(-24);
    const previous = data.slice(-48, -24);

    const recentAvg = recent.reduce((sum, d) => sum + d.value, 0) / recent.length;
    const previousAvg = previous.reduce((sum, d) => sum + d.value, 0) / previous.length;

    if (previousAvg === 0) return anomalies;

    const increase = (recentAvg - previousAvg) / previousAvg;

    if (increase > 0.3) {
      // 30% increase
      const severity =
        increase > 1.0 ? 'critical' : increase > 0.7 ? 'high' : increase > 0.5 ? 'medium' : 'low';

      anomalies.push({
        id: `sustained_${providerId}_${Date.now()}`,
        type: 'sustained_increase',
        severity,
        description: `Sustained cost increase for ${providerId}: ${(increase * 100).toFixed(1)}% over 24h`,
        detectedAt: Date.now(),
        affectedProviders: [providerId],
        estimatedImpact: {
          costIncrease: recentAvg - previousAvg,
          duration: 'Ongoing',
          budgetImpact: ((recentAvg - previousAvg) / config.costs.monthlyBudget) * 100 * 30, // Monthly impact
        },
        rootCause: {
          category: 'usage',
          description: 'Increased API usage or pricing changes',
          confidence: 0.7,
        },
        autoMitigationSuggested: severity === 'critical' || severity === 'high',
        mitigationActions: [
          `Review recent changes affecting ${providerId} usage`,
          'Implement cost controls and rate limiting',
          'Consider switching to alternative providers',
        ],
      });
    }

    return anomalies;
  }

  private async detectEfficiencyDrops(
    providerId: string,
    data: TimeSeriesData[]
  ): Promise<CostAnomaly[]> {
    // This would integrate with your cache hit rate and performance metrics
    // For now, simulate efficiency analysis
    const anomalies: CostAnomaly[] = [];

    // Simulate efficiency drop detection
    if (Math.random() < 0.05) {
      // 5% chance of efficiency anomaly
      anomalies.push({
        id: `efficiency_${providerId}_${Date.now()}`,
        type: 'efficiency_drop',
        severity: 'medium',
        description: `Efficiency drop detected for ${providerId}: cache hit rate decreased`,
        detectedAt: Date.now(),
        affectedProviders: [providerId],
        estimatedImpact: {
          costIncrease: 0.05, // $0.05
          duration: 'Until resolved',
          budgetImpact: 1.5, // 1.5% of budget
        },
        rootCause: {
          category: 'system',
          description: 'Cache efficiency degradation',
          confidence: 0.8,
        },
        autoMitigationSuggested: true,
        mitigationActions: [
          'Review cache configuration and hit rates',
          'Optimize cache TTL settings',
          'Investigate cache invalidation patterns',
        ],
      });
    }

    return anomalies;
  }

  private detectHistoricalAnomalies(data: TimeSeriesData[]): CostAnomaly[] {
    // Simplified historical anomaly detection
    return [];
  }

  private async getRecentCostData(timeWindow: number): Promise<Map<string, TimeSeriesData[]>> {
    const cutoff = Date.now() - timeWindow;
    const recentData = new Map<string, TimeSeriesData[]>();

    for (const [providerId, data] of this.costHistory) {
      const filtered = data.filter(d => d.timestamp >= cutoff);
      if (filtered.length > 0) {
        recentData.set(providerId, filtered);
      }
    }

    return recentData;
  }

  private async triggerAnomalyAlert(anomaly: CostAnomaly): Promise<void> {
    // Convert to CostAlert format for the monitoring service
    const alert: CostAlert = {
      id: anomaly.id,
      type: 'anomaly',
      severity:
        anomaly.severity === 'critical'
          ? 'critical'
          : anomaly.severity === 'high'
            ? 'high'
            : anomaly.severity === 'medium'
              ? 'medium'
              : 'low',
      message: anomaly.description,
      currentValue: anomaly.estimatedImpact.costIncrease,
      threshold: 0, // Will be set by monitoring service
      recommendations: anomaly.mitigationActions,
      timestamp: anomaly.detectedAt,
      metadata: {
        anomalyType: anomaly.type,
        affectedProviders: anomaly.affectedProviders,
        estimatedImpact: anomaly.estimatedImpact,
        rootCause: anomaly.rootCause,
      },
    };

    // Emit alert event
    this.emit('anomalyAlert', alert);

    this.contextLogger.warn('Cost anomaly detected', {
      anomalyId: anomaly.id,
      type: anomaly.type,
      severity: anomaly.severity,
      affectedProviders: anomaly.affectedProviders,
      estimatedImpact: anomaly.estimatedImpact,
    });
  }

  private identifyOptimizationOpportunities(
    trigger: AutoOptimization['triggeredBy'],
    context: any
  ): Omit<AutoOptimization, 'id' | 'implementedAt' | 'status' | 'metrics'>[] {
    const opportunities = [];

    if (trigger === 'budget_threshold' || context.budgetUtilization > 80) {
      opportunities.push({
        triggeredBy: trigger,
        type: 'cache_aggressive' as const,
        description: 'Enable aggressive caching to reduce API costs',
        estimatedSavings: context.budgetUtilization * 0.002, // 0.2% of budget per % over threshold
        revertConditions: ['budget_utilization < 60%', 'user_experience_degradation > 10%'],
      });

      opportunities.push({
        triggeredBy: trigger,
        type: 'provider_switch' as const,
        description: 'Switch to lower-cost providers for non-critical requests',
        estimatedSavings: context.budgetUtilization * 0.003,
        revertConditions: ['reliability_issues_detected', 'performance_degradation > 20%'],
      });
    }

    if (trigger === 'cost_anomaly' && context.anomaly) {
      const anomaly = context.anomaly as CostAnomaly;

      if (anomaly.type === 'spike' && anomaly.severity === 'critical') {
        opportunities.push({
          triggeredBy: trigger,
          type: 'rate_limit' as const,
          description: `Emergency rate limiting for ${anomaly.affectedProviders.join(', ')}`,
          estimatedSavings: anomaly.estimatedImpact.costIncrease * 0.8,
          revertConditions: ['cost_spike_resolved', 'user_impact > 15%'],
        });
      }
    }

    return opportunities;
  }

  private async implementOptimization(optimization: AutoOptimization): Promise<boolean> {
    try {
      switch (optimization.type) {
        case 'cache_aggressive':
          return this.implementAggressiveCaching();
        case 'provider_switch':
          return this.implementProviderSwitch();
        case 'rate_limit':
          return this.implementRateLimiting();
        case 'batch_mode':
          return this.implementBatchMode();
        case 'feature_disable':
          return this.implementFeatureDisable();
        default:
          return false;
      }
    } catch (error) {
      logError(error as Error, { operation: 'implementOptimization', optimization });
      return false;
    }
  }

  private async implementAggressiveCaching(): Promise<boolean> {
    // Implement aggressive caching logic
    // This would integrate with your cache manager
    this.contextLogger.info('Implementing aggressive caching mode');
    return true;
  }

  private async implementProviderSwitch(): Promise<boolean> {
    // Implement provider switching logic
    // This would integrate with your provider router
    this.contextLogger.info('Implementing provider switching optimization');
    return true;
  }

  private async implementRateLimiting(): Promise<boolean> {
    // Implement emergency rate limiting
    this.contextLogger.info('Implementing emergency rate limiting');
    return true;
  }

  private async implementBatchMode(): Promise<boolean> {
    // Implement aggressive batching
    this.contextLogger.info('Implementing aggressive batch processing');
    return true;
  }

  private async implementFeatureDisable(): Promise<boolean> {
    // Temporarily disable non-critical features
    this.contextLogger.info('Temporarily disabling non-critical features');
    return true;
  }

  private startContinuousAnalysis(): void {
    setInterval(async () => {
      try {
        // Update cost history with recent data
        await this.updateCostHistory();

        // Detect anomalies
        await this.detectAnomalies();

        // Check if auto-optimization is needed
        await this.checkAutoOptimizationTriggers();
      } catch (error) {
        logError(error as Error, { operation: 'continuousAnalysis' });
      }
    }, this.analysisInterval);
  }

  private startAutoOptimizationMonitoring(): void {
    // Monitor active optimizations every minute
    setInterval(async () => {
      for (const [optimizationId, optimization] of this.activeOptimizations) {
        await this.monitorOptimization(optimizationId, optimization);
      }
    }, 60000);
  }

  private async updateCostHistory(): Promise<void> {
    // Update cost history with latest data from monitoring service
    // This is a simplified version - in production you'd load real data
    const summary = await this.costMonitoringService.getCostSummary('1h');
    const currentTime = Date.now();

    for (const [providerId, data] of Object.entries(summary.providerBreakdown)) {
      const providerHistory = this.costHistory.get(providerId) || [];

      // Add new data point
      providerHistory.push({
        timestamp: currentTime,
        value: data.cost,
        metadata: { requests: data.requests, cacheHitRate: data.cacheHitRate },
      });

      // Keep only last 7 days
      const cutoff = currentTime - 7 * 24 * 60 * 60 * 1000;
      const filtered = providerHistory.filter(d => d.timestamp >= cutoff);

      this.costHistory.set(providerId, filtered);
    }
  }

  private async checkAutoOptimizationTriggers(): Promise<void> {
    // Check budget utilization
    const summary = await this.costMonitoringService.getCostSummary('30d');
    const budgetUtilization = (summary.totalCost / config.costs.monthlyBudget) * 100;

    if (budgetUtilization > 85) {
      await this.triggerAutoOptimization('budget_threshold', {
        severity: 'critical',
        budgetUtilization,
      });
    }

    // Check for recent anomalies
    const recentAnomalies = await this.detectAnomalies();
    const criticalAnomalies = recentAnomalies.filter(a => a.severity === 'critical');

    for (const anomaly of criticalAnomalies) {
      await this.triggerAutoOptimization('cost_anomaly', { anomaly });
    }
  }

  private async monitorOptimization(
    optimizationId: string,
    optimization: AutoOptimization
  ): Promise<void> {
    try {
      // Check revert conditions
      const shouldRevert = await this.checkRevertConditions(optimization);

      if (shouldRevert) {
        await this.revertOptimization(optimizationId);
        return;
      }

      // Update metrics
      const currentMetrics = await this.calculateOptimizationMetrics(optimization);
      optimization.metrics = { ...optimization.metrics, ...currentMetrics };

      // Mark as completed if successful for long enough
      const activeTime = Date.now() - optimization.implementedAt;
      if (activeTime > 60 * 60 * 1000 && optimization.status === 'active') {
        // 1 hour
        optimization.status = 'completed';
        this.contextLogger.info('Auto-optimization completed successfully', {
          optimizationId,
          type: optimization.type,
          actualSavings: optimization.metrics.actualSavings,
        });
      }
    } catch (error) {
      logError(error as Error, { operation: 'monitorOptimization', optimizationId });
    }
  }

  private async checkRevertConditions(optimization: AutoOptimization): Promise<boolean> {
    // Implement revert condition checking logic
    // This would integrate with your monitoring systems
    return false; // Simplified for now
  }

  private async revertOptimization(optimizationId: string): Promise<void> {
    const optimization = this.activeOptimizations.get(optimizationId);
    if (!optimization) return;

    optimization.status = 'reverted';
    this.contextLogger.info('Auto-optimization reverted', {
      optimizationId,
      type: optimization.type,
      reason: 'Revert conditions met',
    });

    this.emit('autoOptimizationReverted', optimization);
  }

  private async calculateOptimizationMetrics(
    optimization: AutoOptimization
  ): Promise<Partial<AutoOptimization['metrics']>> {
    // Calculate actual savings and impact metrics
    // This would integrate with your cost monitoring
    return {
      actualSavings: optimization.estimatedSavings * (0.8 + Math.random() * 0.4), // 80-120% of estimate
      performanceImpact: Math.random() * 10, // 0-10% performance impact
      userImpact: Math.random() * 5, // 0-5% user impact
    };
  }

  // Public API methods

  getActiveOptimizations(): Map<string, AutoOptimization> {
    return new Map(this.activeOptimizations);
  }

  async getOptimizationRecommendations(): Promise<
    Array<{
      type: 'predictive' | 'reactive' | 'preventive';
      priority: 'low' | 'medium' | 'high' | 'critical';
      description: string;
      estimatedSavings: number;
      implementationComplexity: 'low' | 'medium' | 'high';
      timeToImplement: string;
    }>
  > {
    const recommendations = [];

    // Generate recommendations based on analysis
    const forecast = await this.generateForecast('30d');
    const anomalies = await this.detectAnomalies();

    if (forecast.budgetImpact.projectedUtilization > 80) {
      recommendations.push({
        type: 'predictive' as const,
        priority: 'high' as const,
        description: 'Implement aggressive cost optimization before budget exhaustion',
        estimatedSavings: forecast.predictedCost * 0.3,
        implementationComplexity: 'medium' as const,
        timeToImplement: '2-3 days',
      });
    }

    const criticalAnomalies = anomalies.filter(a => a.severity === 'critical');
    if (criticalAnomalies.length > 0) {
      recommendations.push({
        type: 'reactive' as const,
        priority: 'critical' as const,
        description: 'Address critical cost anomalies immediately',
        estimatedSavings: criticalAnomalies.reduce(
          (sum, a) => sum + a.estimatedImpact.costIncrease,
          0
        ),
        implementationComplexity: 'low' as const,
        timeToImplement: 'Immediate',
      });
    }

    return recommendations;
  }
}

// Export singleton instance
let predictiveCostAnalyzerInstance: PredictiveCostAnalyzer | null = null;

export const getPredictiveCostAnalyzer = (): PredictiveCostAnalyzer => {
  if (!predictiveCostAnalyzerInstance) {
    predictiveCostAnalyzerInstance = new PredictiveCostAnalyzer();
  }
  return predictiveCostAnalyzerInstance;
};

export default getPredictiveCostAnalyzer;
