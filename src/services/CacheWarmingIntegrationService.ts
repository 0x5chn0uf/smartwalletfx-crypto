import { EventEmitter } from 'events';
import { logger, logError, createContextualLogger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { config } from '@/config';
import { ChainId } from '@/types/blockchain';
import { getEventSystem, CacheWarmRequestV1 } from './EventSystem';
import { getEnhancedEventMonitoringService } from './EnhancedEventMonitoringService';
import { getIntelligentCacheManager } from './IntelligentCacheManager';

/**
 * Cache Warming Integration Service
 *
 * Handles CacheWarmRequestV1 events with intelligent preloading:
 * - Pattern-based cache warming based on user behavior
 * - Time-based preloading for predictable access patterns
 * - Cost optimization through strategic cache warming
 * - Performance monitoring and metrics collection
 */

interface CacheWarmingStrategy {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  costBudget: number; // USD per hour
  successRateThreshold: number; // minimum success rate to continue
  strategies: {
    userPattern: {
      enabled: boolean;
      lookbackHours: number;
      minAccessFrequency: number;
      confidenceThreshold: number;
    };
    timePattern: {
      enabled: boolean;
      patternTypes: ('hourly' | 'daily' | 'weekly')[];
      minSampleSize: number;
      confidenceThreshold: number;
    };
    costOptimization: {
      enabled: boolean;
      maxCostPerPreload: number;
      savingsMultiplier: number; // minimum savings multiplier to justify preload
    };
    manual: {
      enabled: boolean;
      allowedSources: string[];
      requireApproval: boolean;
    };
  };
}

interface CacheWarmingMetrics {
  totalRequests: number;
  successfulWarmings: number;
  failedWarmings: number;
  totalCostSpent: number;
  totalSavingsAchieved: number;
  averageWarmingTime: number;
  hitRateImprovement: number;
  byDataType: Record<
    string,
    {
      requests: number;
      successes: number;
      cost: number;
      savings: number;
      averageTime: number;
    }
  >;
  byStrategy: Record<
    string,
    {
      requests: number;
      successes: number;
      cost: number;
      savings: number;
      accuracy: number;
    }
  >;
  recentPerformance: Array<{
    timestamp: number;
    successRate: number;
    costEfficiency: number;
    hitRateImprovement: number;
  }>;
}

interface WarmingDecision {
  shouldWarm: boolean;
  reason: string;
  estimatedCost: number;
  estimatedSavings: number;
  confidence: number;
  strategy: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
}

export class CacheWarmingIntegrationService extends EventEmitter {
  private contextLogger = createContextualLogger({ component: 'CacheWarmingIntegrationService' });

  // Service integrations
  private eventSystem = getEventSystem();
  private monitoring = getEnhancedEventMonitoringService();
  private cacheManager = getIntelligentCacheManager();

  // Configuration
  private strategy: CacheWarmingStrategy = {
    id: 'default_strategy',
    name: 'Default Cache Warming Strategy',
    enabled: true,
    priority: 5,
    costBudget: 10.0, // $10/hour
    successRateThreshold: 0.7, // 70%
    strategies: {
      userPattern: {
        enabled: true,
        lookbackHours: 24,
        minAccessFrequency: 3,
        confidenceThreshold: 0.6,
      },
      timePattern: {
        enabled: true,
        patternTypes: ['hourly', 'daily'],
        minSampleSize: 10,
        confidenceThreshold: 0.7,
      },
      costOptimization: {
        enabled: true,
        maxCostPerPreload: 0.01, // $0.01 per preload
        savingsMultiplier: 3.0, // 3x savings minimum
      },
      manual: {
        enabled: true,
        allowedSources: ['admin', 'cost_optimizer', 'performance_monitor'],
        requireApproval: false,
      },
    },
  };

  // State tracking
  private metrics: CacheWarmingMetrics = {
    totalRequests: 0,
    successfulWarmings: 0,
    failedWarmings: 0,
    totalCostSpent: 0,
    totalSavingsAchieved: 0,
    averageWarmingTime: 0,
    hitRateImprovement: 0,
    byDataType: {},
    byStrategy: {},
    recentPerformance: [],
  };

  private currentHourCostSpent = 0;
  private warmingQueue = new Map<string, CacheWarmRequestV1[]>();
  private processingRequests = new Set<string>();

  // Performance tracking
  private recentDecisions: WarmingDecision[] = [];
  private patternLearning = new Map<string, any>();
  private userBehaviorPatterns = new Map<string, any>();

  constructor() {
    super();
    this.setupEventHandlers();
    this.startCostBudgetTracking();
    this.startPerformanceTracking();
    this.startPatternLearning();
  }

  /**
   * Setup event handlers for cache warming integration
   */
  private setupEventHandlers(): void {
    // Register primary cache warming handler
    this.eventSystem.registerHandler<CacheWarmRequestV1>(
      'CacheWarmRequestV1',
      async event => {
        await this.handleCacheWarmRequest(event);
      },
      {
        id: 'cache-warming-integration',
        priority: 8,
        maxRetries: 3,
        backoffMs: 2000,
        exponentialBackoff: true,
      }
    );

    // Listen to monitoring events
    this.monitoring.on('performanceSnapshot', this.updatePerformanceMetrics.bind(this));
    this.monitoring.on('alertTriggered', this.handlePerformanceAlert.bind(this));

    // Listen to cache manager events
    this.cacheManager.on('cacheHit', this.trackCacheHit.bind(this));
    this.cacheManager.on('cacheMiss', this.trackCacheMiss.bind(this));
    this.cacheManager.on('cacheEviction', this.trackCacheEviction.bind(this));

    this.contextLogger.info('Cache warming event handlers configured');
  }

  /**
   * Main cache warm request handler
   */
  private async handleCacheWarmRequest(event: CacheWarmRequestV1): Promise<void> {
    const startTime = Date.now();
    const requestId = event.requestId;

    try {
      this.contextLogger.info('Processing cache warm request', {
        requestId,
        dataType: event.dataType,
        priority: event.priority,
        keyCount: event.keys.length,
        preloadReason: event.preloadReason,
      });

      // Validate request
      if (!this.isValidWarmingRequest(event)) {
        this.contextLogger.warn('Invalid cache warming request', { requestId });
        return;
      }

      // Check if already processing
      if (this.processingRequests.has(requestId)) {
        this.contextLogger.debug('Request already being processed', { requestId });
        return;
      }

      this.processingRequests.add(requestId);
      this.metrics.totalRequests++;

      try {
        // Make warming decision
        const decision = await this.makeWarmingDecision(event);
        this.recentDecisions.push(decision);

        // Limit decision history
        if (this.recentDecisions.length > 1000) {
          this.recentDecisions = this.recentDecisions.slice(-1000);
        }

        if (!decision.shouldWarm) {
          this.contextLogger.debug('Cache warming declined', {
            requestId,
            reason: decision.reason,
            confidence: decision.confidence,
          });

          await this.updateDecisionMetrics(event, decision, false);
          return;
        }

        // Check cost budget
        if (!this.checkCostBudget(decision.estimatedCost)) {
          this.contextLogger.warn('Cache warming declined due to cost budget', {
            requestId,
            estimatedCost: decision.estimatedCost,
            remainingBudget: this.strategy.costBudget - this.currentHourCostSpent,
          });
          return;
        }

        // Execute cache warming
        const warmingResult = await this.executeCacheWarming(event, decision);

        // Update metrics
        await this.updateWarmingMetrics(event, decision, warmingResult);

        // Update pattern learning
        await this.updatePatternLearning(event, decision, warmingResult);

        this.contextLogger.info('Cache warming completed', {
          requestId,
          success: warmingResult.success,
          keysWarmed: warmingResult.keysWarmed,
          actualCost: warmingResult.actualCost,
          timeTaken: warmingResult.timeTaken,
        });
      } finally {
        this.processingRequests.delete(requestId);
      }
    } catch (error) {
      this.metrics.failedWarmings++;

      logError(error as Error, {
        operation: 'handleCacheWarmRequest',
        requestId,
        dataType: event.dataType,
      });

      // Update error metrics
      await this.updateErrorMetrics(event, error as Error);
    } finally {
      const processingTime = Date.now() - startTime;
      this.updateProcessingTimeMetrics(processingTime);
    }
  }

  /**
   * Validate cache warming request
   */
  private isValidWarmingRequest(event: CacheWarmRequestV1): boolean {
    // Check if strategy is enabled
    if (!this.strategy.enabled) {
      return false;
    }

    // Check if specific warming reason is enabled
    switch (event.preloadReason) {
      case 'user_pattern':
        return this.strategy.strategies.userPattern.enabled;
      case 'time_pattern':
        return this.strategy.strategies.timePattern.enabled;
      case 'cost_optimization':
        return this.strategy.strategies.costOptimization.enabled;
      case 'manual':
        return this.strategy.strategies.manual.enabled;
      default:
        return false;
    }
  }

  /**
   * Make intelligent warming decision
   */
  private async makeWarmingDecision(event: CacheWarmRequestV1): Promise<WarmingDecision> {
    const analysis = await this.analyzeWarmingValue(event);

    // Base decision factors
    let score = 0;
    let reasons: string[] = [];

    // Factor 1: Estimated savings vs cost
    const savingsRatio = analysis.estimatedSavings / Math.max(analysis.estimatedCost, 0.001);
    if (savingsRatio >= this.strategy.strategies.costOptimization.savingsMultiplier) {
      score += 40;
      reasons.push(`High savings ratio: ${savingsRatio.toFixed(2)}x`);
    } else if (savingsRatio >= 2.0) {
      score += 20;
      reasons.push(`Moderate savings ratio: ${savingsRatio.toFixed(2)}x`);
    } else {
      score -= 20;
      reasons.push(`Low savings ratio: ${savingsRatio.toFixed(2)}x`);
    }

    // Factor 2: Historical pattern confidence
    score += analysis.patternConfidence * 30;
    if (analysis.patternConfidence > 0.7) {
      reasons.push(`High pattern confidence: ${(analysis.patternConfidence * 100).toFixed(1)}%`);
    }

    // Factor 3: Priority boost
    switch (event.priority) {
      case 'critical':
        score += 30;
        reasons.push('Critical priority');
        break;
      case 'high':
        score += 20;
        reasons.push('High priority');
        break;
      case 'normal':
        score += 10;
        break;
      case 'low':
        score += 0;
        break;
    }

    // Factor 4: Data type specific factors
    const dataTypeBonus = this.getDataTypeScore(event.dataType);
    score += dataTypeBonus;
    if (dataTypeBonus > 0) {
      reasons.push(`Data type optimization: +${dataTypeBonus}`);
    }

    // Factor 5: Recent performance
    const recentSuccess = this.getRecentSuccessRate(event.dataType);
    score += recentSuccess * 20;
    if (recentSuccess > 0.8) {
      reasons.push(`High recent success rate: ${(recentSuccess * 100).toFixed(1)}%`);
    }

    // Factor 6: Cost budget availability
    const budgetUtilization = this.currentHourCostSpent / this.strategy.costBudget;
    if (budgetUtilization < 0.5) {
      score += 10;
      reasons.push('Ample budget available');
    } else if (budgetUtilization < 0.8) {
      score += 5;
      reasons.push('Moderate budget available');
    } else {
      score -= 15;
      reasons.push('Limited budget remaining');
    }

    // Final decision
    const shouldWarm = score >= 50; // Threshold for warming
    const confidence = Math.min(Math.max(score / 100, 0), 1);
    const priority = this.determinePriority(score, event.priority);

    return {
      shouldWarm,
      reason: shouldWarm
        ? `Warming approved: ${reasons.join(', ')}`
        : `Warming declined: ${reasons.join(', ')}`,
      estimatedCost: analysis.estimatedCost,
      estimatedSavings: analysis.estimatedSavings,
      confidence,
      strategy: this.determineStrategy(event.preloadReason),
      priority,
    };
  }

  /**
   * Analyze warming value proposition
   */
  private async analyzeWarmingValue(event: CacheWarmRequestV1): Promise<{
    estimatedCost: number;
    estimatedSavings: number;
    patternConfidence: number;
    accessProbability: number;
  }> {
    // Estimate cost based on data type and key count
    const baseCostPerKey = this.getBaseCostPerKey(event.dataType);
    const estimatedCost = baseCostPerKey * event.keys.length;

    // Get pattern analysis
    const patternAnalysis = await this.analyzeAccessPatterns(event);

    // Calculate expected savings
    const accessProbability = patternAnalysis.accessProbability;
    const avgCostPerAccess = this.getAverageCostPerAccess(event.dataType);
    const estimatedSavings = accessProbability * avgCostPerAccess * event.keys.length;

    return {
      estimatedCost,
      estimatedSavings,
      patternConfidence: patternAnalysis.confidence,
      accessProbability,
    };
  }

  /**
   * Analyze access patterns for prediction
   */
  private async analyzeAccessPatterns(event: CacheWarmRequestV1): Promise<{
    accessProbability: number;
    confidence: number;
    patterns: string[];
  }> {
    const patterns: string[] = [];
    let totalProbability = 0;
    let confidenceSum = 0;
    let patternCount = 0;

    // User pattern analysis
    if (event.userContext && this.strategy.strategies.userPattern.enabled) {
      const userPattern = await this.analyzeUserPattern(
        event.userContext,
        event.dataType,
        event.keys
      );
      if (userPattern.confidence >= this.strategy.strategies.userPattern.confidenceThreshold) {
        totalProbability += userPattern.accessProbability * 0.4;
        confidenceSum += userPattern.confidence * 0.4;
        patternCount++;
        patterns.push(`user_pattern(${(userPattern.confidence * 100).toFixed(1)}%)`);
      }
    }

    // Time pattern analysis
    if (this.strategy.strategies.timePattern.enabled) {
      const timePattern = await this.analyzeTimePattern(event.dataType, event.keys);
      if (timePattern.confidence >= this.strategy.strategies.timePattern.confidenceThreshold) {
        totalProbability += timePattern.accessProbability * 0.4;
        confidenceSum += timePattern.confidence * 0.4;
        patternCount++;
        patterns.push(`time_pattern(${(timePattern.confidence * 100).toFixed(1)}%)`);
      }
    }

    // Global frequency analysis
    const frequencyPattern = await this.analyzeFrequencyPattern(event.dataType, event.keys);
    totalProbability += frequencyPattern.accessProbability * 0.2;
    confidenceSum += frequencyPattern.confidence * 0.2;
    patternCount++;
    patterns.push(`frequency(${(frequencyPattern.confidence * 100).toFixed(1)}%)`);

    return {
      accessProbability: Math.min(totalProbability, 1.0),
      confidence: patternCount > 0 ? confidenceSum : 0,
      patterns,
    };
  }

  /**
   * Execute cache warming
   */
  private async executeCacheWarming(
    event: CacheWarmRequestV1,
    decision: WarmingDecision
  ): Promise<{
    success: boolean;
    keysWarmed: number;
    actualCost: number;
    timeTaken: number;
    errors: string[];
  }> {
    const startTime = Date.now();
    let keysWarmed = 0;
    let actualCost = 0;
    const errors: string[] = [];

    try {
      // Process keys in batches to avoid overwhelming the system
      const batchSize = this.getBatchSize(event.dataType);
      const batches = this.chunkArray(event.keys, batchSize);

      for (const batch of batches) {
        try {
          const batchResult = await this.warmBatch(event.dataType, batch, event.chainId);
          keysWarmed += batchResult.keysWarmed;
          actualCost += batchResult.cost;

          // Track cost spending
          this.currentHourCostSpent += batchResult.cost;

          // Check if we've exceeded our cost budget
          if (this.currentHourCostSpent >= this.strategy.costBudget) {
            this.contextLogger.warn('Cost budget exceeded during warming', {
              currentSpent: this.currentHourCostSpent,
              budget: this.strategy.costBudget,
            });
            break;
          }
        } catch (error) {
          errors.push(`Batch error: ${(error as Error).message}`);
          logError(error as Error, {
            operation: 'warmBatch',
            dataType: event.dataType,
            batchSize: batch.length,
          });
        }
      }

      const success = keysWarmed > 0 && errors.length < batches.length;
      const timeTaken = Date.now() - startTime;

      // Update success/failure metrics
      if (success) {
        this.metrics.successfulWarmings++;
      } else {
        this.metrics.failedWarmings++;
      }

      return {
        success,
        keysWarmed,
        actualCost,
        timeTaken,
        errors,
      };
    } catch (error) {
      const timeTaken = Date.now() - startTime;
      errors.push(`Execution error: ${(error as Error).message}`);

      return {
        success: false,
        keysWarmed,
        actualCost,
        timeTaken,
        errors,
      };
    }
  }

  /**
   * Warm a batch of cache keys
   */
  private async warmBatch(
    dataType: string,
    keys: string[],
    chainId?: ChainId
  ): Promise<{ keysWarmed: number; cost: number }> {
    let keysWarmed = 0;
    let cost = 0;

    for (const key of keys) {
      try {
        // Check if key is already cached
        const cached = await this.cacheManager.get(key);
        if (cached) {
          continue; // Skip already cached items
        }

        // Warm the cache by fetching data
        const result = await this.fetchDataForCaching(dataType, key, chainId);
        if (result.success) {
          await this.cacheManager.set(key, result.data, this.getTTL(dataType));
          keysWarmed++;
          cost += result.cost;
        }
      } catch (error) {
        logError(error as Error, {
          operation: 'warmCacheKey',
          dataType,
          key: key.substring(0, 50), // Truncate for logging
        });
      }
    }

    return { keysWarmed, cost };
  }

  /**
   * Fetch data for caching based on data type
   */
  private async fetchDataForCaching(
    dataType: string,
    key: string,
    chainId?: ChainId
  ): Promise<{ success: boolean; data?: any; cost: number }> {
    // This would integrate with the actual data fetching services
    // For now, return a simulated result

    const baseCost = this.getBaseCostPerKey(dataType);

    // Simulate network call delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));

    // Simulate 90% success rate
    const success = Math.random() > 0.1;

    if (success) {
      return {
        success: true,
        data: { key, dataType, fetchedAt: Date.now() },
        cost: baseCost,
      };
    } else {
      return {
        success: false,
        cost: baseCost * 0.5, // Partial cost for failed request
      };
    }
  }

  /**
   * Pattern analysis methods
   */
  private async analyzeUserPattern(
    userContext: string,
    dataType: string,
    keys: string[]
  ): Promise<{ accessProbability: number; confidence: number }> {
    try {
      const userPatternKey = `user_pattern:${userContext}:${dataType}`;
      const pattern = await redisManager.get(userPatternKey);

      if (!pattern) {
        return { accessProbability: 0.3, confidence: 0.2 }; // Low confidence for new users
      }

      // Analyze access frequency and timing
      const recentAccesses = pattern.accesses?.slice(-100) || [];
      const relevantAccesses = recentAccesses.filter((access: any) =>
        keys.some(key => access.key === key)
      );

      const accessFrequency = relevantAccesses.length / recentAccesses.length;
      const confidence = Math.min(recentAccesses.length / 50, 1); // More data = higher confidence

      return {
        accessProbability: Math.min(accessFrequency * 2, 1), // Boost probability
        confidence,
      };
    } catch (error) {
      return { accessProbability: 0.3, confidence: 0.1 };
    }
  }

  private async analyzeTimePattern(
    dataType: string,
    keys: string[]
  ): Promise<{ accessProbability: number; confidence: number }> {
    try {
      const timePatternKey = `time_pattern:${dataType}`;
      const pattern = await redisManager.get(timePatternKey);

      if (!pattern) {
        return { accessProbability: 0.2, confidence: 0.1 };
      }

      const currentHour = new Date().getHours();
      const currentDay = new Date().getDay();

      // Check hourly patterns
      const hourlyAccess = pattern.hourly?.[currentHour] || 0;
      const dailyAccess = pattern.daily?.[currentDay] || 0;

      const hourlyProbability = Math.min(hourlyAccess / 100, 1);
      const dailyProbability = Math.min(dailyAccess / 100, 1);

      const accessProbability = (hourlyProbability + dailyProbability) / 2;
      const confidence = Math.min(pattern.sampleSize / 100, 1);

      return { accessProbability, confidence };
    } catch (error) {
      return { accessProbability: 0.2, confidence: 0.1 };
    }
  }

  private async analyzeFrequencyPattern(
    dataType: string,
    keys: string[]
  ): Promise<{ accessProbability: number; confidence: number }> {
    try {
      let totalAccesses = 0;
      let totalSamples = 0;

      for (const key of keys.slice(0, 10)) {
        // Sample up to 10 keys
        const frequencyKey = `frequency:${dataType}:${key}`;
        const frequency = await redisManager.get(frequencyKey);

        if (frequency) {
          totalAccesses += frequency.accesses || 0;
          totalSamples += frequency.samples || 1;
        }
      }

      if (totalSamples === 0) {
        return { accessProbability: 0.1, confidence: 0.1 };
      }

      const averageFrequency = totalAccesses / totalSamples;
      const accessProbability = Math.min(averageFrequency / 10, 1); // Normalize to 0-1
      const confidence = Math.min(totalSamples / 50, 1);

      return { accessProbability, confidence };
    } catch (error) {
      return { accessProbability: 0.1, confidence: 0.1 };
    }
  }

  /**
   * Helper methods for decision making
   */
  private getDataTypeScore(dataType: string): number {
    const scores: Record<string, number> = {
      token_metadata: 15, // High value, low change frequency
      balance: 5, // Medium value, high change frequency
      transaction: 10, // High value, immutable
      price: 0, // Low value, very high change frequency
      nft: 12, // High value, low change frequency
      defi: 8, // Medium-high value, medium change frequency
    };

    return scores[dataType] || 0;
  }

  private getRecentSuccessRate(dataType: string): number {
    const typeMetrics = this.metrics.byDataType[dataType];
    if (!typeMetrics || typeMetrics.requests === 0) {
      return 0.5; // Default assumption
    }

    return typeMetrics.successes / typeMetrics.requests;
  }

  private determinePriority(
    score: number,
    originalPriority: string
  ): 'low' | 'normal' | 'high' | 'critical' {
    if (score >= 80) return 'critical';
    if (score >= 65) return 'high';
    if (score >= 40) return 'normal';
    return 'low';
  }

  private determineStrategy(preloadReason: string): string {
    return preloadReason || 'unknown';
  }

  private getBaseCostPerKey(dataType: string): number {
    const costs: Record<string, number> = {
      balance: 0.001,
      transaction: 0.002,
      token_metadata: 0.0005,
      price: 0.0002,
      nft: 0.003,
      defi: 0.004,
    };

    return costs[dataType] || 0.001;
  }

  private getAverageCostPerAccess(dataType: string): number {
    // This would be calculated from historical data
    return this.getBaseCostPerKey(dataType) * 1.5;
  }

  private getBatchSize(dataType: string): number {
    const sizes: Record<string, number> = {
      balance: 50,
      transaction: 20,
      token_metadata: 100,
      price: 200,
      nft: 10,
      defi: 15,
    };

    return sizes[dataType] || 25;
  }

  private getTTL(dataType: string): number {
    const ttls: Record<string, number> = {
      token_metadata: 24 * 60 * 60, // 24 hours
      balance: 5 * 60, // 5 minutes
      transaction: 60 * 60, // 1 hour
      price: 60, // 1 minute
      nft: 12 * 60 * 60, // 12 hours
      defi: 10 * 60, // 10 minutes
    };

    return ttls[dataType] || 300; // 5 minutes default
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Budget and performance tracking
   */
  private checkCostBudget(estimatedCost: number): boolean {
    return this.currentHourCostSpent + estimatedCost <= this.strategy.costBudget;
  }

  private startCostBudgetTracking(): void {
    // Reset cost budget every hour
    setInterval(
      () => {
        this.currentHourCostSpent = 0;
        this.contextLogger.debug('Hourly cost budget reset', {
          budget: this.strategy.costBudget,
        });
      },
      60 * 60 * 1000
    );
  }

  private startPerformanceTracking(): void {
    setInterval(async () => {
      await this.updatePerformanceSnapshot();
    }, 60000); // Every minute
  }

  private startPatternLearning(): void {
    setInterval(
      async () => {
        await this.updatePatternLearning();
      },
      5 * 60 * 1000
    ); // Every 5 minutes
  }

  /**
   * Event handlers for tracking
   */
  private trackCacheHit(data: any): void {
    // Update cache hit statistics for pattern learning
  }

  private trackCacheMiss(data: any): void {
    // Update cache miss statistics for pattern learning
  }

  private trackCacheEviction(data: any): void {
    // Track cache evictions to optimize warming strategies
  }

  private updatePerformanceMetrics(snapshot: any): void {
    // Update internal metrics based on performance snapshot
    const recentPerf = {
      timestamp: Date.now(),
      successRate:
        this.metrics.totalRequests > 0
          ? this.metrics.successfulWarmings / this.metrics.totalRequests
          : 0,
      costEfficiency:
        this.metrics.totalCostSpent > 0
          ? this.metrics.totalSavingsAchieved / this.metrics.totalCostSpent
          : 0,
      hitRateImprovement: snapshot.cacheMetrics?.hitRate || 0,
    };

    this.metrics.recentPerformance.push(recentPerf);

    // Limit history
    if (this.metrics.recentPerformance.length > 100) {
      this.metrics.recentPerformance = this.metrics.recentPerformance.slice(-100);
    }
  }

  private handlePerformanceAlert(alert: any): void {
    if (alert.type === 'cache_hit_rate_low') {
      // Increase cache warming aggressiveness
      this.contextLogger.info('Increasing cache warming due to low hit rate', {
        currentHitRate: alert.details?.hitRate,
      });
    }
  }

  /**
   * Metrics update methods
   */
  private async updateWarmingMetrics(
    event: CacheWarmRequestV1,
    decision: WarmingDecision,
    result: any
  ): Promise<void> {
    // Update total metrics
    this.metrics.totalCostSpent += result.actualCost;
    this.metrics.totalSavingsAchieved += decision.estimatedSavings;

    // Update data type metrics
    if (!this.metrics.byDataType[event.dataType]) {
      this.metrics.byDataType[event.dataType] = {
        requests: 0,
        successes: 0,
        cost: 0,
        savings: 0,
        averageTime: 0,
      };
    }

    const typeMetrics = this.metrics.byDataType[event.dataType];
    typeMetrics.requests++;
    if (result.success) typeMetrics.successes++;
    typeMetrics.cost += result.actualCost;
    typeMetrics.savings += decision.estimatedSavings;
    typeMetrics.averageTime = (typeMetrics.averageTime + result.timeTaken) / 2;

    // Update strategy metrics
    if (!this.metrics.byStrategy[decision.strategy]) {
      this.metrics.byStrategy[decision.strategy] = {
        requests: 0,
        successes: 0,
        cost: 0,
        savings: 0,
        accuracy: 0,
      };
    }

    const strategyMetrics = this.metrics.byStrategy[decision.strategy];
    strategyMetrics.requests++;
    if (result.success) strategyMetrics.successes++;
    strategyMetrics.cost += result.actualCost;
    strategyMetrics.savings += decision.estimatedSavings;
    strategyMetrics.accuracy =
      strategyMetrics.requests > 0 ? strategyMetrics.successes / strategyMetrics.requests : 0;
  }

  private async updateDecisionMetrics(
    event: CacheWarmRequestV1,
    decision: WarmingDecision,
    executed: boolean
  ): Promise<void> {
    // Track decision accuracy for learning
    const decisionKey = `decision_tracking:${event.dataType}:${decision.strategy}`;
    const tracking = (await redisManager.get(decisionKey)) || {
      totalDecisions: 0,
      correctDecisions: 0,
      averageConfidence: 0,
    };

    tracking.totalDecisions++;
    tracking.averageConfidence = (tracking.averageConfidence + decision.confidence) / 2;

    // We'll need to track actual outcomes to determine if decisions were correct
    // For now, assume executed decisions were correct if they succeeded

    await redisManager.set(decisionKey, tracking, 7 * 24 * 60 * 60); // 7 days
  }

  private async updateErrorMetrics(event: CacheWarmRequestV1, error: Error): Promise<void> {
    const errorKey = `warming_errors:${event.dataType}`;
    const errors = (await redisManager.get(errorKey)) || [];

    errors.push({
      timestamp: Date.now(),
      error: error.message,
      eventData: {
        dataType: event.dataType,
        priority: event.priority,
        keyCount: event.keys.length,
      },
    });

    // Keep last 100 errors
    if (errors.length > 100) {
      errors.splice(0, errors.length - 100);
    }

    await redisManager.set(errorKey, errors, 24 * 60 * 60); // 24 hours
  }

  private updateProcessingTimeMetrics(processingTime: number): void {
    this.metrics.averageWarmingTime = (this.metrics.averageWarmingTime + processingTime) / 2;
  }

  private async updatePerformanceSnapshot(): Promise<void> {
    // Store current metrics snapshot
    const snapshot = {
      timestamp: Date.now(),
      metrics: { ...this.metrics },
      strategy: { ...this.strategy },
      currentHourCostSpent: this.currentHourCostSpent,
      queueSizes: Array.from(this.warmingQueue.values()).map(q => q.length),
    };

    await redisManager.set(
      `cache_warming_snapshot:${Date.now()}`,
      snapshot,
      24 * 60 * 60 // 24 hours
    );
  }

  private async updatePatternLearning(
    event?: CacheWarmRequestV1,
    decision?: WarmingDecision,
    result?: any
  ): Promise<void> {
    // Update pattern learning models based on outcomes
    // This would involve machine learning model updates
    // For now, store data for future analysis

    if (event && decision && result) {
      const learningData = {
        timestamp: Date.now(),
        event: {
          dataType: event.dataType,
          priority: event.priority,
          keyCount: event.keys.length,
          preloadReason: event.preloadReason,
        },
        decision: {
          shouldWarm: decision.shouldWarm,
          confidence: decision.confidence,
          estimatedSavings: decision.estimatedSavings,
        },
        result: {
          success: result.success,
          actualCost: result.actualCost,
          keysWarmed: result.keysWarmed,
        },
      };

      await redisManager.lpush('cache_warming_learning_data', learningData);

      // Keep last 1000 entries
      await redisManager.ltrim('cache_warming_learning_data', 0, 999);
    }
  }

  // Public API methods

  /**
   * Get current cache warming metrics
   */
  getMetrics(): CacheWarmingMetrics {
    return { ...this.metrics };
  }

  /**
   * Get current strategy configuration
   */
  getStrategy(): CacheWarmingStrategy {
    return { ...this.strategy };
  }

  /**
   * Update strategy configuration
   */
  updateStrategy(updates: Partial<CacheWarmingStrategy>): void {
    Object.assign(this.strategy, updates);
    this.contextLogger.info('Cache warming strategy updated', updates);
  }

  /**
   * Get recent warming decisions
   */
  getRecentDecisions(limit: number = 50): WarmingDecision[] {
    return this.recentDecisions.slice(-limit);
  }

  /**
   * Manual cache warming trigger
   */
  async triggerManualWarming(
    dataType: string,
    keys: string[],
    options: {
      priority?: 'low' | 'normal' | 'high' | 'critical';
      chainId?: ChainId;
      userContext?: string;
      estimatedSavings?: number;
    } = {}
  ): Promise<string> {
    const requestId = `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const event: CacheWarmRequestV1 = {
      type: 'CacheWarmRequestV1',
      timestamp: Date.now(),
      requestId,
      priority: options.priority || 'normal',
      dataType,
      keys,
      chainId: options.chainId,
      userContext: options.userContext,
      preloadReason: 'manual',
      estimatedSavings: options.estimatedSavings || 0,
      metadata: {
        source: 'manual_trigger',
        triggeredAt: Date.now(),
      },
    };

    await this.eventSystem.emitEvent(event);

    this.contextLogger.info('Manual cache warming triggered', {
      requestId,
      dataType,
      keyCount: keys.length,
      priority: options.priority,
    });

    return requestId;
  }

  /**
   * Get service health status
   */
  getHealthStatus() {
    const successRate =
      this.metrics.totalRequests > 0
        ? this.metrics.successfulWarmings / this.metrics.totalRequests
        : 0;

    const costEfficiency =
      this.metrics.totalCostSpent > 0
        ? this.metrics.totalSavingsAchieved / this.metrics.totalCostSpent
        : 0;

    return {
      enabled: this.strategy.enabled,
      successRate,
      costEfficiency,
      currentHourSpent: this.currentHourCostSpent,
      budgetUtilization: this.currentHourCostSpent / this.strategy.costBudget,
      queueLength: Array.from(this.warmingQueue.values()).reduce((sum, q) => sum + q.length, 0),
      processingRequests: this.processingRequests.size,
      recentDecisions: this.recentDecisions.length,
      lastActivity: Math.max(...this.metrics.recentPerformance.map(p => p.timestamp), 0),
    };
  }
}

// Export singleton instance
let cacheWarmingInstance: CacheWarmingIntegrationService | null = null;

export const getCacheWarmingIntegrationService = (): CacheWarmingIntegrationService => {
  if (!cacheWarmingInstance) {
    cacheWarmingInstance = new CacheWarmingIntegrationService();
  }
  return cacheWarmingInstance;
};

export default getCacheWarmingIntegrationService;
