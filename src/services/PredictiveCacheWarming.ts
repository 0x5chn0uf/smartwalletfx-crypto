import { EventEmitter } from 'events';
import { logger, logError, createContextualLogger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { config } from '@/config';
import { ChainId } from '@/types/blockchain';
import { getEventSystem, CacheWarmRequestV1, CacheEvictionV1 } from './EventSystem';

/**
 * Predictive Cache Warming System
 *
 * Advanced cache pre-loading system that anticipates data needs:
 * - User behavior pattern analysis for proactive caching
 * - Time-based predictive warming (market hours, user schedules)
 * - Chain-specific optimization (gas price patterns, activity cycles)
 * - Cost-aware warming prioritization
 * - ML-based prediction models for cache hit optimization
 */

export interface UserBehaviorPattern {
  userId: string;
  sessionId?: string;
  patterns: {
    frequentAssets: Array<{
      address: string;
      chainId: ChainId;
      frequency: number;
      lastAccessed: number;
    }>;
    dailyActiveHours: number[]; // Hours when user is typically active
    weeklyPattern: Array<{ day: number; probability: number }>; // 0=Sunday
    requestSequences: Array<{
      sequence: string[];
      probability: number;
      avgTimeBetween: number;
    }>;
    geographicRegion?: string;
    devicePreferences: Record<string, number>; // device type -> usage frequency
  };
  confidence: number;
  lastUpdated: number;
  sampleSize: number;
}

export interface TimeBasedPattern {
  patternId: string;
  type: 'market_hours' | 'daily_cycle' | 'weekly_cycle' | 'seasonal' | 'event_based';
  description: string;
  timeRanges: Array<{
    start: number; // Hour of day or day of week
    end: number;
    timezone: string;
    intensity: number; // 0-1, how strong the pattern is
  }>;
  chainSpecific?: {
    [key in ChainId]?: {
      gasOptimalHours: number[];
      activityMultipliers: Record<number, number>;
    };
  };
  dataTypes: string[]; // What types of data to warm during these periods
  priority: number;
  enabled: boolean;
}

export interface ChainOptimizationStrategy {
  chainId: ChainId;
  characteristics: {
    avgBlockTime: number;
    gasPatterns: Array<{ hour: number; avgGasPrice: number; volatility: number }>;
    peakActivityHours: number[];
    userActivityPattern: 'global' | 'regional' | 'specialized';
    dataFreshnessRequirements: Record<string, number>; // data type -> freshness in ms
  };
  warmingStrategies: {
    priceData: {
      frequency: number; // How often to refresh (ms)
      batchSize: number; // How many tokens to fetch together
      priorityTokens: string[]; // High-priority token addresses
    };
    balanceData: {
      refreshThreshold: number; // When to proactively refresh
      multiChainOptimization: boolean;
    };
    transactionData: {
      preloadDepth: number; // How many recent transactions to keep cached
      indexingDelay: number; // Delay to allow for blockchain indexing
    };
  };
  costOptimization: {
    lowCostWindows: Array<{ start: number; end: number }>; // Hours when API calls are cheaper
    batchingThresholds: Record<string, number>; // Request type -> min batch size
  };
}

export interface WarmingPrediction {
  predictionId: string;
  targetData: {
    type: 'balance' | 'transaction' | 'token_metadata' | 'price' | 'nft' | 'defi';
    keys: string[];
    chainId?: ChainId;
    userContext?: string;
  };
  confidence: number;
  expectedAccessTime: number; // When we predict this data will be accessed
  priority: 'low' | 'normal' | 'high' | 'critical';
  predictionSource: 'user_pattern' | 'time_pattern' | 'chain_optimization' | 'ml_model' | 'manual';
  costBenefit: {
    estimatedWarmingCost: number;
    estimatedSavings: number; // From cache hit instead of fresh fetch
    netBenefit: number;
  };
  metadata: {
    basedOnPattern?: string;
    userBehaviorScore?: number;
    timeRelevanceScore?: number;
    chainOptimizationScore?: number;
    mlModelVersion?: string;
  };
}

export interface CacheWarmingMetrics {
  totalPredictions: number;
  warmedItems: number;
  cacheHits: number;
  cacheMisses: number;
  predictionAccuracy: number;
  costSavings: number;
  totalWarmingCost: number;
  netBenefit: number;
  averagePredictionConfidence: number;
  patternMatchAccuracy: Record<string, number>; // Pattern type -> accuracy
  chainOptimizationEffectiveness: Record<ChainId, number>;
  timeBasedPredictionAccuracy: number;
  mlModelPerformance: {
    version: string;
    accuracy: number;
    precision: number;
    recall: number;
    f1Score: number;
  };
  userPatternEffectiveness: Record<string, number>; // User ID -> effectiveness
}

/**
 * Intelligent cache warming system with predictive capabilities
 */
export class PredictiveCacheWarming extends EventEmitter {
  private contextLogger = createContextualLogger({ component: 'PredictiveCacheWarming' });
  private eventSystem = getEventSystem();

  // Pattern storage and analysis
  private userBehaviorPatterns = new Map<string, UserBehaviorPattern>();
  private timeBasedPatterns = new Map<string, TimeBasedPattern>();
  private chainOptimizationStrategies = new Map<ChainId, ChainOptimizationStrategy>();

  // Prediction and warming state
  private activePredictions = new Map<string, WarmingPrediction>();
  private warmingQueue: WarmingPrediction[] = [];
  private currentlyWarming = new Set<string>();

  // ML model state
  private mlModel = new Map<
    string,
    {
      modelType: 'linear' | 'neural' | 'ensemble';
      weights: number[];
      features: string[];
      accuracy: number;
      lastTrained: number;
      trainingDataSize: number;
    }
  >();

  // Configuration
  private enabled = true;
  private maxConcurrentWarming = 10;
  private maxQueueSize = 1000;
  private userPatternEnabled = true;
  private timePatternEnabled = true;
  private chainOptimizationEnabled = true;
  private mlPredictionEnabled = true;
  private costAwareWarming = true;

  // Performance tuning
  private warmingIntervalMs = 30000; // 30 seconds
  private patternAnalysisIntervalMs = 5 * 60 * 1000; // 5 minutes
  private mlRetrainingIntervalMs = 60 * 60 * 1000; // 1 hour
  private maxPredictionLookahead = 2 * 60 * 60 * 1000; // 2 hours ahead

  // Metrics
  private metrics: CacheWarmingMetrics = {
    totalPredictions: 0,
    warmedItems: 0,
    cacheHits: 0,
    cacheMisses: 0,
    predictionAccuracy: 0,
    costSavings: 0,
    totalWarmingCost: 0,
    netBenefit: 0,
    averagePredictionConfidence: 0,
    patternMatchAccuracy: {},
    chainOptimizationEffectiveness: {},
    timeBasedPredictionAccuracy: 0,
    mlModelPerformance: {
      version: '1.0.0',
      accuracy: 0,
      precision: 0,
      recall: 0,
      f1Score: 0,
    },
    userPatternEffectiveness: {},
  };

  constructor() {
    super();
    this.initializeDefaultPatterns();
    this.initializeChainStrategies();
    this.setupEventListeners();
    this.startPredictiveWarming();
    this.startPatternAnalysis();
    this.startMlTraining();
  }

  /**
   * Analyze user access patterns to update behavior models
   */
  async analyzeUserAccess(
    userId: string,
    accessType: string,
    params: Record<string, any>,
    chainId?: ChainId,
    sessionId?: string
  ): Promise<void> {
    try {
      let pattern = this.userBehaviorPatterns.get(userId);

      if (!pattern) {
        pattern = {
          userId,
          sessionId,
          patterns: {
            frequentAssets: [],
            dailyActiveHours: [],
            weeklyPattern: [],
            requestSequences: [],
            devicePreferences: {},
          },
          confidence: 0.1,
          lastUpdated: Date.now(),
          sampleSize: 0,
        };
        this.userBehaviorPatterns.set(userId, pattern);
      }

      // Update pattern data
      await this.updateFrequentAssets(pattern, accessType, params, chainId);
      await this.updateTimePatterns(pattern);
      await this.updateRequestSequences(pattern, accessType);
      await this.updateDevicePreferences(pattern, params);

      pattern.sampleSize++;
      pattern.lastUpdated = Date.now();
      pattern.confidence = Math.min(0.95, 0.1 + pattern.sampleSize * 0.01);

      // Store updated pattern
      await this.storeUserPattern(pattern);

      // Generate predictive warming based on updated pattern
      if (pattern.sampleSize > 10) {
        // Minimum sample size for predictions
        await this.generateUserBasedPredictions(pattern);
      }

      this.contextLogger.debug('User pattern updated', {
        userId,
        accessType,
        sampleSize: pattern.sampleSize,
        confidence: pattern.confidence,
      });
    } catch (error) {
      logError(error as Error, {
        operation: 'analyzeUserAccess',
        userId,
        accessType,
      });
    }
  }

  /**
   * Generate warming predictions based on multiple sources
   */
  async generatePredictions(): Promise<WarmingPrediction[]> {
    const predictions: WarmingPrediction[] = [];

    try {
      // User behavior-based predictions
      if (this.userPatternEnabled) {
        const userPredictions = await this.generateUserBasedPredictions();
        predictions.push(...userPredictions);
      }

      // Time-based predictions
      if (this.timePatternEnabled) {
        const timePredictions = await this.generateTimeBasedPredictions();
        predictions.push(...timePredictions);
      }

      // Chain optimization predictions
      if (this.chainOptimizationEnabled) {
        const chainPredictions = await this.generateChainOptimizedPredictions();
        predictions.push(...chainPredictions);
      }

      // ML model predictions
      if (this.mlPredictionEnabled) {
        const mlPredictions = await this.generateMlBasedPredictions();
        predictions.push(...mlPredictions);
      }

      // Deduplicate and prioritize
      const dedupedPredictions = await this.deduplicateAndPrioritizePredictions(predictions);

      // Filter by cost-benefit if enabled
      if (this.costAwareWarming) {
        return dedupedPredictions.filter(p => p.costBenefit.netBenefit > 0);
      }

      return dedupedPredictions;
    } catch (error) {
      logError(error as Error, { operation: 'generatePredictions' });
      return [];
    }
  }

  /**
   * Execute cache warming for predictions
   */
  async executeWarming(predictions: WarmingPrediction[]): Promise<void> {
    // Sort by priority and expected access time
    const sortedPredictions = predictions.sort((a, b) => {
      const priorityScore = this.getPriorityScore(b.priority) - this.getPriorityScore(a.priority);
      if (priorityScore !== 0) return priorityScore;

      return a.expectedAccessTime - b.expectedAccessTime; // Earlier first
    });

    // Add to warming queue
    for (const prediction of sortedPredictions) {
      if (this.warmingQueue.length >= this.maxQueueSize) {
        this.contextLogger.warn('Warming queue full, dropping predictions');
        break;
      }

      this.warmingQueue.push(prediction);
      this.activePredictions.set(prediction.predictionId, prediction);
    }

    // Process warming queue
    await this.processWarmingQueue();

    this.contextLogger.info('Cache warming executed', {
      predictionsAdded: sortedPredictions.length,
      queueLength: this.warmingQueue.length,
      currentlyWarming: this.currentlyWarming.size,
    });
  }

  /**
   * Process warming queue with concurrency control
   */
  private async processWarmingQueue(): Promise<void> {
    while (this.warmingQueue.length > 0 && this.currentlyWarming.size < this.maxConcurrentWarming) {
      const prediction = this.warmingQueue.shift();
      if (!prediction) break;

      // Skip if too far in the future
      if (prediction.expectedAccessTime > Date.now() + this.maxPredictionLookahead) {
        continue;
      }

      this.currentlyWarming.add(prediction.predictionId);

      // Execute warming asynchronously
      this.executeSingleWarming(prediction).finally(() => {
        this.currentlyWarming.delete(prediction.predictionId);
      });
    }
  }

  /**
   * Execute warming for a single prediction
   */
  private async executeSingleWarming(prediction: WarmingPrediction): Promise<void> {
    const startTime = Date.now();

    try {
      // Emit cache warm request event
      const warmEvent: CacheWarmRequestV1 = {
        type: 'CacheWarmRequestV1',
        timestamp: Date.now(),
        requestId: prediction.predictionId,
        priority: prediction.priority,
        dataType: prediction.targetData.type,
        keys: prediction.targetData.keys,
        chainId: prediction.targetData.chainId,
        userContext: prediction.targetData.userContext,
        preloadReason: prediction.predictionSource,
        estimatedSavings: prediction.costBenefit.estimatedSavings,
        metadata: {
          ...prediction.metadata,
          confidence: prediction.confidence,
          expectedAccessTime: prediction.expectedAccessTime,
        },
      };

      await this.eventSystem.emitEvent(warmEvent);

      // Track warming cost
      this.metrics.totalWarmingCost += prediction.costBenefit.estimatedWarmingCost;
      this.metrics.warmedItems++;

      // Store warming record for accuracy tracking
      await this.storeWarmingRecord(prediction, startTime);

      this.contextLogger.debug('Cache warming executed', {
        predictionId: prediction.predictionId,
        dataType: prediction.targetData.type,
        keysCount: prediction.targetData.keys.length,
        confidence: prediction.confidence,
        cost: prediction.costBenefit.estimatedWarmingCost,
      });
    } catch (error) {
      logError(error as Error, {
        operation: 'executeSingleWarming',
        predictionId: prediction.predictionId,
      });
    }
  }

  /**
   * User behavior-based prediction generation
   */
  private async generateUserBasedPredictions(
    specificPattern?: UserBehaviorPattern
  ): Promise<WarmingPrediction[]> {
    const predictions: WarmingPrediction[] = [];
    const patterns = specificPattern
      ? [specificPattern]
      : Array.from(this.userBehaviorPatterns.values());

    for (const pattern of patterns) {
      if (pattern.confidence < 0.3) continue; // Skip low-confidence patterns

      // Predict based on frequent assets
      for (const asset of pattern.patterns.frequentAssets) {
        if (Date.now() - asset.lastAccessed > 60 * 60 * 1000) {
          // Not accessed in last hour
          const prediction = await this.createAssetPrediction(pattern, asset, 'user_pattern');
          if (prediction) predictions.push(prediction);
        }
      }

      // Predict based on request sequences
      for (const sequence of pattern.patterns.requestSequences) {
        if (sequence.probability > 0.6) {
          const sequencePredictions = await this.createSequencePredictions(pattern, sequence);
          predictions.push(...sequencePredictions);
        }
      }

      // Predict based on time patterns
      const currentHour = new Date().getHours();
      if (pattern.patterns.dailyActiveHours.includes(currentHour)) {
        const timePredictions = await this.createTimeBasedUserPredictions(pattern, currentHour);
        predictions.push(...timePredictions);
      }
    }

    return predictions;
  }

  /**
   * Time-based prediction generation
   */
  private async generateTimeBasedPredictions(): Promise<WarmingPrediction[]> {
    const predictions: WarmingPrediction[] = [];
    const currentTime = new Date();
    const currentHour = currentTime.getHours();
    const currentDay = currentTime.getDay();

    for (const pattern of this.timeBasedPatterns.values()) {
      if (!pattern.enabled) continue;

      for (const timeRange of pattern.timeRanges) {
        if (this.isTimeInRange(currentHour, currentDay, timeRange)) {
          const timePredictions = await this.createTimePatternPredictions(pattern, timeRange);
          predictions.push(...timePredictions);
        }
      }
    }

    return predictions;
  }

  /**
   * Chain optimization-based predictions
   */
  private async generateChainOptimizedPredictions(): Promise<WarmingPrediction[]> {
    const predictions: WarmingPrediction[] = [];
    const currentHour = new Date().getHours();

    for (const [chainId, strategy] of this.chainOptimizationStrategies) {
      // Check if current time is optimal for this chain
      if (strategy.characteristics.peakActivityHours.includes(currentHour)) {
        const chainPredictions = await this.createChainOptimizedPredictions(chainId, strategy);
        predictions.push(...chainPredictions);
      }

      // Check low-cost windows for expensive operations
      for (const window of strategy.costOptimization.lowCostWindows) {
        if (currentHour >= window.start && currentHour <= window.end) {
          const costOptimizedPredictions = await this.createCostOptimizedPredictions(
            chainId,
            strategy
          );
          predictions.push(...costOptimizedPredictions);
        }
      }
    }

    return predictions;
  }

  /**
   * ML model-based predictions
   */
  private async generateMlBasedPredictions(): Promise<WarmingPrediction[]> {
    const predictions: WarmingPrediction[] = [];

    for (const [modelKey, model] of this.mlModel) {
      if (Date.now() - model.lastTrained > 24 * 60 * 60 * 1000) continue; // Skip stale models

      const features = await this.extractCurrentFeatures();
      const predictionScore = this.calculateMlScore(features, model);

      if (predictionScore > 0.7) {
        const mlPrediction = await this.createMlBasedPrediction(
          modelKey,
          predictionScore,
          features
        );
        if (mlPrediction) predictions.push(mlPrediction);
      }
    }

    return predictions;
  }

  /**
   * Helper methods for prediction creation
   */
  private async createAssetPrediction(
    pattern: UserBehaviorPattern,
    asset: any,
    source: string
  ): Promise<WarmingPrediction | null> {
    const predictionId = `asset_${asset.address}_${asset.chainId}_${Date.now()}`;

    // Calculate expected access time based on user patterns
    const expectedAccessTime = this.calculateExpectedAccessTime(pattern, asset);
    const confidence = Math.min(0.9, pattern.confidence * (asset.frequency / 100));

    if (confidence < 0.4) return null;

    // Calculate cost-benefit
    const warmingCost = this.estimateWarmingCost('balance', 1, asset.chainId);
    const savings = this.estimateCacheHitSavings('balance', asset.chainId);
    const netBenefit = savings - warmingCost;

    if (netBenefit <= 0) return null;

    return {
      predictionId,
      targetData: {
        type: 'balance',
        keys: [asset.address],
        chainId: asset.chainId,
        userContext: pattern.userId,
      },
      confidence,
      expectedAccessTime,
      priority: confidence > 0.8 ? 'high' : 'normal',
      predictionSource: source as any,
      costBenefit: {
        estimatedWarmingCost: warmingCost,
        estimatedSavings: savings,
        netBenefit,
      },
      metadata: {
        basedOnPattern: 'frequent_assets',
        userBehaviorScore: confidence,
        assetFrequency: asset.frequency,
      },
    };
  }

  private async createSequencePredictions(
    pattern: UserBehaviorPattern,
    sequence: any
  ): Promise<WarmingPrediction[]> {
    const predictions: WarmingPrediction[] = [];

    // Predict the next items in the sequence
    for (let i = 1; i < sequence.sequence.length; i++) {
      const predictionId = `sequence_${pattern.userId}_${i}_${Date.now()}`;
      const dataType = this.parseDataTypeFromSequence(sequence.sequence[i]);
      const keys = this.parseKeysFromSequence(sequence.sequence[i]);

      if (!dataType || !keys.length) continue;

      const expectedAccessTime = Date.now() + sequence.avgTimeBetween * i;
      const confidence = sequence.probability * (1 - i * 0.1); // Decrease confidence for later items

      if (confidence < 0.4) continue;

      const warmingCost = this.estimateWarmingCost(dataType, keys.length);
      const savings = this.estimateCacheHitSavings(dataType);
      const netBenefit = savings - warmingCost;

      if (netBenefit > 0) {
        predictions.push({
          predictionId,
          targetData: {
            type: dataType as any,
            keys,
            userContext: pattern.userId,
          },
          confidence,
          expectedAccessTime,
          priority: confidence > 0.7 ? 'high' : 'normal',
          predictionSource: 'user_pattern',
          costBenefit: {
            estimatedWarmingCost: warmingCost,
            estimatedSavings: savings,
            netBenefit,
          },
          metadata: {
            basedOnPattern: 'request_sequence',
            sequencePosition: i,
            sequenceProbability: sequence.probability,
          },
        });
      }
    }

    return predictions;
  }

  private async createTimePatternPredictions(
    pattern: TimeBasedPattern,
    timeRange: any
  ): Promise<WarmingPrediction[]> {
    const predictions: WarmingPrediction[] = [];

    for (const dataType of pattern.dataTypes) {
      const predictionId = `time_${pattern.patternId}_${dataType}_${Date.now()}`;

      // Get commonly accessed keys for this data type during this time
      const keys = await this.getTimeBasedKeys(dataType, pattern.type);
      if (!keys.length) continue;

      const confidence = timeRange.intensity * 0.8; // Time patterns generally less certain
      if (confidence < 0.3) continue;

      const expectedAccessTime = Date.now() + 30 * 60 * 1000; // Expect access in 30 minutes
      const warmingCost = this.estimateWarmingCost(dataType, keys.length);
      const savings = this.estimateCacheHitSavings(dataType) * timeRange.intensity;
      const netBenefit = savings - warmingCost;

      if (netBenefit > 0) {
        predictions.push({
          predictionId,
          targetData: {
            type: dataType as any,
            keys,
          },
          confidence,
          expectedAccessTime,
          priority: timeRange.intensity > 0.8 ? 'high' : 'normal',
          predictionSource: 'time_pattern',
          costBenefit: {
            estimatedWarmingCost: warmingCost,
            estimatedSavings: savings,
            netBenefit,
          },
          metadata: {
            basedOnPattern: pattern.patternId,
            timeIntensity: timeRange.intensity,
            patternType: pattern.type,
          },
        });
      }
    }

    return predictions;
  }

  /**
   * Utility methods
   */
  private calculateExpectedAccessTime(pattern: UserBehaviorPattern, asset: any): number {
    const timeSinceLastAccess = Date.now() - asset.lastAccessed;
    const avgAccessInterval = (24 * 60 * 60 * 1000) / asset.frequency; // Average interval between accesses

    // Predict next access based on frequency and pattern
    return Date.now() + Math.max(0, avgAccessInterval - timeSinceLastAccess);
  }

  private estimateWarmingCost(dataType: string, keyCount: number, chainId?: ChainId): number {
    const baseCosts = {
      balance: 0.001,
      transaction: 0.002,
      token_metadata: 0.0005,
      price: 0.0003,
      nft: 0.003,
      defi: 0.004,
    };

    const baseCost = baseCosts[dataType as keyof typeof baseCosts] || 0.001;

    // Chain-specific multipliers
    const chainMultipliers = {
      [ChainId.ETHEREUM]: 1.2,
      [ChainId.POLYGON]: 0.8,
      [ChainId.BSC]: 0.7,
      [ChainId.ARBITRUM]: 1.0,
      [ChainId.OPTIMISM]: 1.0,
      [ChainId.AVALANCHE]: 1.1,
      [ChainId.SOLANA]: 0.9,
    };

    const chainMultiplier = chainId ? chainMultipliers[chainId] || 1.0 : 1.0;
    const batchDiscount = Math.max(0.5, 1 - keyCount * 0.1); // Discount for multiple keys

    return baseCost * chainMultiplier * batchDiscount * keyCount;
  }

  private estimateCacheHitSavings(dataType: string, chainId?: ChainId): number {
    // Savings from avoiding a fresh API call
    return this.estimateWarmingCost(dataType, 1, chainId) * 0.8; // 80% of the cost
  }

  private getPriorityScore(priority: string): number {
    const scores = { critical: 4, high: 3, normal: 2, low: 1 };
    return scores[priority as keyof typeof scores] || 2;
  }

  private isTimeInRange(currentHour: number, currentDay: number, timeRange: any): boolean {
    // Simplified time range checking
    if (timeRange.start <= timeRange.end) {
      return currentHour >= timeRange.start && currentHour <= timeRange.end;
    } else {
      // Range crosses midnight
      return currentHour >= timeRange.start || currentHour <= timeRange.end;
    }
  }

  /**
   * Pattern analysis and updates
   */
  private async updateFrequentAssets(
    pattern: UserBehaviorPattern,
    accessType: string,
    params: Record<string, any>,
    chainId?: ChainId
  ): Promise<void> {
    if (accessType === 'balance' && params.address && chainId) {
      let asset = pattern.patterns.frequentAssets.find(
        a => a.address === params.address && a.chainId === chainId
      );

      if (asset) {
        asset.frequency++;
        asset.lastAccessed = Date.now();
      } else {
        pattern.patterns.frequentAssets.push({
          address: params.address,
          chainId,
          frequency: 1,
          lastAccessed: Date.now(),
        });
      }

      // Keep only top 50 most frequent assets
      pattern.patterns.frequentAssets = pattern.patterns.frequentAssets
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 50);
    }
  }

  private async updateTimePatterns(pattern: UserBehaviorPattern): Promise<void> {
    const currentHour = new Date().getHours();

    if (!pattern.patterns.dailyActiveHours.includes(currentHour)) {
      pattern.patterns.dailyActiveHours.push(currentHour);
    }

    // Update weekly pattern
    const currentDay = new Date().getDay();
    let dayPattern = pattern.patterns.weeklyPattern.find(p => p.day === currentDay);

    if (dayPattern) {
      dayPattern.probability = Math.min(1.0, dayPattern.probability + 0.01);
    } else {
      pattern.patterns.weeklyPattern.push({ day: currentDay, probability: 0.1 });
    }
  }

  private async updateRequestSequences(
    pattern: UserBehaviorPattern,
    accessType: string
  ): Promise<void> {
    // Store last few request types to identify sequences
    const key = `${config.redis.keyPrefix}user_sequences:${pattern.userId}`;
    await redisManager.lpush(key, { type: accessType, timestamp: Date.now() });
    await redisManager.ltrim(key, 0, 9); // Keep last 10 requests
    await redisManager.expire(key, 24 * 60 * 60); // 24 hours
  }

  private async updateDevicePreferences(
    pattern: UserBehaviorPattern,
    params: Record<string, any>
  ): Promise<void> {
    const deviceType = params.deviceType || 'unknown';
    pattern.patterns.devicePreferences[deviceType] =
      (pattern.patterns.devicePreferences[deviceType] || 0) + 1;
  }

  /**
   * Initialization methods
   */
  private initializeDefaultPatterns(): void {
    // Market hours pattern
    this.timeBasedPatterns.set('market_hours_us', {
      patternId: 'market_hours_us',
      type: 'market_hours',
      description: 'US market hours increased activity',
      timeRanges: [
        {
          start: 9, // 9 AM
          end: 16, // 4 PM
          timezone: 'America/New_York',
          intensity: 0.8,
        },
      ],
      dataTypes: ['price', 'balance', 'defi'],
      priority: 8,
      enabled: true,
    });

    // European market hours
    this.timeBasedPatterns.set('market_hours_eu', {
      patternId: 'market_hours_eu',
      type: 'market_hours',
      description: 'European market hours activity',
      timeRanges: [
        {
          start: 8, // 8 AM
          end: 17, // 5 PM
          timezone: 'Europe/London',
          intensity: 0.7,
        },
      ],
      dataTypes: ['price', 'balance', 'defi'],
      priority: 7,
      enabled: true,
    });

    // Asian market hours
    this.timeBasedPatterns.set('market_hours_asia', {
      patternId: 'market_hours_asia',
      type: 'market_hours',
      description: 'Asian market hours activity',
      timeRanges: [
        {
          start: 9, // 9 AM
          end: 15, // 3 PM
          timezone: 'Asia/Tokyo',
          intensity: 0.6,
        },
      ],
      dataTypes: ['price', 'balance'],
      priority: 6,
      enabled: true,
    });

    // Weekend pattern
    this.timeBasedPatterns.set('weekend_activity', {
      patternId: 'weekend_activity',
      type: 'weekly_cycle',
      description: 'Weekend cryptocurrency activity',
      timeRanges: [
        { start: 10, end: 22, timezone: 'UTC', intensity: 0.5 }, // 10 AM to 10 PM UTC
      ],
      dataTypes: ['price', 'nft', 'defi'],
      priority: 4,
      enabled: true,
    });
  }

  private initializeChainStrategies(): void {
    // Ethereum strategy
    this.chainOptimizationStrategies.set(ChainId.ETHEREUM, {
      chainId: ChainId.ETHEREUM,
      characteristics: {
        avgBlockTime: 12000,
        gasPatterns: [
          { hour: 9, avgGasPrice: 50, volatility: 0.3 },
          { hour: 14, avgGasPrice: 35, volatility: 0.2 },
          { hour: 20, avgGasPrice: 45, volatility: 0.25 },
        ],
        peakActivityHours: [9, 10, 14, 15, 20, 21],
        userActivityPattern: 'global',
        dataFreshnessRequirements: {
          price: 30000, // 30 seconds
          balance: 60000, // 1 minute
          transaction: 120000, // 2 minutes
        },
      },
      warmingStrategies: {
        priceData: {
          frequency: 30000,
          batchSize: 50,
          priorityTokens: ['0xA0b86a33E6417c69e5e7B0f6d1d2f08B0f7fd1B8'], // Example addresses
        },
        balanceData: {
          refreshThreshold: 300000, // 5 minutes
          multiChainOptimization: true,
        },
        transactionData: {
          preloadDepth: 100,
          indexingDelay: 30000,
        },
      },
      costOptimization: {
        lowCostWindows: [
          { start: 2, end: 6 }, // 2 AM - 6 AM UTC
          { start: 23, end: 1 }, // 11 PM - 1 AM UTC
        ],
        batchingThresholds: {
          price: 10,
          balance: 5,
          transaction: 3,
        },
      },
    });

    // Polygon strategy
    this.chainOptimizationStrategies.set(ChainId.POLYGON, {
      chainId: ChainId.POLYGON,
      characteristics: {
        avgBlockTime: 2000,
        gasPatterns: [
          { hour: 12, avgGasPrice: 30, volatility: 0.4 },
          { hour: 18, avgGasPrice: 40, volatility: 0.5 },
        ],
        peakActivityHours: [12, 13, 18, 19],
        userActivityPattern: 'regional',
        dataFreshnessRequirements: {
          price: 15000, // 15 seconds
          balance: 30000, // 30 seconds
          transaction: 60000, // 1 minute
        },
      },
      warmingStrategies: {
        priceData: {
          frequency: 15000,
          batchSize: 100,
          priorityTokens: [],
        },
        balanceData: {
          refreshThreshold: 120000, // 2 minutes
          multiChainOptimization: true,
        },
        transactionData: {
          preloadDepth: 50,
          indexingDelay: 10000,
        },
      },
      costOptimization: {
        lowCostWindows: [{ start: 3, end: 7 }],
        batchingThresholds: {
          price: 20,
          balance: 10,
          transaction: 5,
        },
      },
    });
  }

  /**
   * Event listeners and system integration
   */
  private setupEventListeners(): void {
    // Listen for cache evictions to update predictions
    this.eventSystem.registerHandler<CacheEvictionV1>(
      'CacheEvictionV1',
      async event => {
        await this.handleCacheEviction(event);
      },
      { id: 'predictive-cache-eviction', priority: 6 }
    );

    // Listen for successful cache warm events
    this.eventSystem.on('cacheWarmCompleted', event => {
      this.handleWarmingComplete(event);
    });
  }

  private async handleCacheEviction(event: CacheEvictionV1): Promise<void> {
    // When cache items are evicted, we might need to re-warm them
    if (event.evictionReason === 'ttl_expired' && event.accessCount > 5) {
      // This was a frequently accessed item, consider re-warming
      const prediction: WarmingPrediction = {
        predictionId: `eviction_${event.cacheKey}_${Date.now()}`,
        targetData: {
          type: this.inferDataTypeFromCacheKey(event.cacheKey),
          keys: [event.cacheKey],
        },
        confidence: Math.min(0.8, event.accessCount / 10),
        expectedAccessTime: Date.now() + 300000, // 5 minutes from now
        priority: event.accessCount > 20 ? 'high' : 'normal',
        predictionSource: 'manual', // Eviction-triggered
        costBenefit: {
          estimatedWarmingCost: event.costImplication,
          estimatedSavings: event.costImplication * 1.2,
          netBenefit: event.costImplication * 0.2,
        },
        metadata: {
          evictionReason: event.evictionReason,
          previousAccessCount: event.accessCount,
        },
      };

      if (prediction.costBenefit.netBenefit > 0) {
        this.warmingQueue.unshift(prediction); // Add to front of queue
        await this.processWarmingQueue();
      }
    }
  }

  private handleWarmingComplete(event: any): void {
    const prediction = this.activePredictions.get(event.requestId);
    if (prediction) {
      // Update metrics
      this.metrics.totalPredictions++;

      // Track the warming for accuracy measurement
      this.storeWarmingResult(prediction, true);

      this.contextLogger.debug('Cache warming completed', {
        predictionId: prediction.predictionId,
        dataType: prediction.targetData.type,
        confidence: prediction.confidence,
      });
    }
  }

  /**
   * ML model training and prediction
   */
  private async trainPredictionModel(modelKey: string): Promise<void> {
    try {
      const trainingData = await this.getTrainingData(modelKey);
      if (trainingData.length < 100) return; // Need minimum data

      const features = this.extractFeatureNames();
      const weights = this.initializeWeights(features.length);

      // Simple gradient descent training
      for (let epoch = 0; epoch < 50; epoch++) {
        for (const sample of trainingData) {
          const prediction = this.calculateMlScore(sample.features, { weights, features } as any);
          const error = sample.actualOutcome - prediction;

          // Update weights
          for (let i = 0; i < weights.length; i++) {
            weights[i] += 0.001 * error * sample.features[features[i]];
          }
        }
      }

      // Calculate accuracy
      const accuracy = this.calculateModelAccuracy(weights, trainingData, features);

      this.mlModel.set(modelKey, {
        modelType: 'linear',
        weights,
        features,
        accuracy,
        lastTrained: Date.now(),
        trainingDataSize: trainingData.length,
      });

      this.contextLogger.info('ML model trained', {
        modelKey,
        accuracy,
        trainingDataSize: trainingData.length,
        featuresCount: features.length,
      });
    } catch (error) {
      logError(error as Error, {
        operation: 'trainPredictionModel',
        modelKey,
      });
    }
  }

  /**
   * System lifecycle methods
   */
  private startPredictiveWarming(): void {
    // Main warming cycle
    setInterval(async () => {
      if (!this.enabled) return;

      try {
        const predictions = await this.generatePredictions();
        await this.executeWarming(predictions);

        this.contextLogger.debug('Predictive warming cycle completed', {
          predictionsGenerated: predictions.length,
          queueLength: this.warmingQueue.length,
        });
      } catch (error) {
        logError(error as Error, { operation: 'predictiveWarmingCycle' });
      }
    }, this.warmingIntervalMs);

    // Process warming queue more frequently
    setInterval(async () => {
      await this.processWarmingQueue();
    }, 10000); // Every 10 seconds
  }

  private startPatternAnalysis(): void {
    setInterval(async () => {
      await this.analyzeAndUpdatePatterns();
    }, this.patternAnalysisIntervalMs);
  }

  private startMlTraining(): void {
    setInterval(async () => {
      for (const modelKey of this.mlModel.keys()) {
        await this.trainPredictionModel(modelKey);
      }
    }, this.mlRetrainingIntervalMs);
  }

  /**
   * Storage and persistence methods
   */
  private async storeUserPattern(pattern: UserBehaviorPattern): Promise<void> {
    try {
      const key = `${config.redis.keyPrefix}user_pattern:${pattern.userId}`;
      await redisManager.set(key, pattern, 30 * 24 * 60 * 60); // 30 days
    } catch (error) {
      logError(error as Error, {
        operation: 'storeUserPattern',
        userId: pattern.userId,
      });
    }
  }

  private async storeWarmingRecord(
    prediction: WarmingPrediction,
    startTime: number
  ): Promise<void> {
    try {
      const record = {
        ...prediction,
        warmingStartTime: startTime,
        warmingEndTime: Date.now(),
      };

      const key = `${config.redis.keyPrefix}warming_record:${prediction.predictionId}`;
      await redisManager.set(key, record, 7 * 24 * 60 * 60); // 7 days
    } catch (error) {
      logError(error as Error, {
        operation: 'storeWarmingRecord',
        predictionId: prediction.predictionId,
      });
    }
  }

  /**
   * Helper methods
   */
  private inferDataTypeFromCacheKey(cacheKey: string): any {
    if (cacheKey.includes('balance')) return 'balance';
    if (cacheKey.includes('transaction')) return 'transaction';
    if (cacheKey.includes('price')) return 'price';
    if (cacheKey.includes('token')) return 'token_metadata';
    if (cacheKey.includes('nft')) return 'nft';
    if (cacheKey.includes('defi')) return 'defi';
    return 'balance'; // Default
  }

  private parseDataTypeFromSequence(sequenceItem: string): string | null {
    // Parse sequence item to extract data type
    // Implementation depends on how sequences are formatted
    return 'balance'; // Simplified
  }

  private parseKeysFromSequence(sequenceItem: string): string[] {
    // Parse sequence item to extract keys
    // Implementation depends on sequence format
    return []; // Simplified
  }

  private async getTimeBasedKeys(dataType: string, patternType: string): Promise<string[]> {
    // Get commonly accessed keys for this data type and time pattern
    // This would query historical access patterns
    return []; // Simplified
  }

  private calculateMlScore(features: Record<string, number>, model: any): number {
    if (!model.weights || !model.features) return 0.5;

    let score = 0;
    for (let i = 0; i < model.features.length; i++) {
      const featureValue = features[model.features[i]] || 0;
      score += featureValue * (model.weights[i] || 0);
    }

    // Apply sigmoid activation
    return 1 / (1 + Math.exp(-score));
  }

  private async extractCurrentFeatures(): Promise<Record<string, number>> {
    const currentTime = new Date();
    return {
      hourOfDay: currentTime.getHours(),
      dayOfWeek: currentTime.getDay(),
      activeUserCount: this.userBehaviorPatterns.size,
      queueLength: this.warmingQueue.length,
      cacheHitRate:
        this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses + 1),
      systemLoad: this.currentlyWarming.size / this.maxConcurrentWarming,
      costPressure: 0.5, // Would be calculated from actual cost metrics
    };
  }

  private extractFeatureNames(): string[] {
    return [
      'hourOfDay',
      'dayOfWeek',
      'activeUserCount',
      'queueLength',
      'cacheHitRate',
      'systemLoad',
      'costPressure',
    ];
  }

  private initializeWeights(count: number): number[] {
    return Array.from({ length: count }, () => (Math.random() - 0.5) * 0.1);
  }

  private async getTrainingData(modelKey: string): Promise<any[]> {
    // Get historical warming data for training
    // This would query stored warming records and outcomes
    return []; // Simplified
  }

  private calculateModelAccuracy(weights: number[], testData: any[], features: string[]): number {
    let correct = 0;
    for (const sample of testData) {
      const prediction = this.calculateMlScore(sample.features, { weights, features });
      const predictedOutcome = prediction > 0.5 ? 1 : 0;
      if (predictedOutcome === sample.actualOutcome) correct++;
    }
    return testData.length > 0 ? correct / testData.length : 0.5;
  }

  private storeWarmingResult(prediction: WarmingPrediction, success: boolean): void {
    // Store result for accuracy tracking
    this.metrics.totalPredictions++;
    if (success) {
      this.metrics.cacheHits++;
    } else {
      this.metrics.cacheMisses++;
    }

    // Update prediction accuracy
    this.metrics.predictionAccuracy = this.metrics.cacheHits / this.metrics.totalPredictions;
  }

  private async deduplicateAndPrioritizePredictions(
    predictions: WarmingPrediction[]
  ): Promise<WarmingPrediction[]> {
    const dedupedMap = new Map<string, WarmingPrediction>();

    for (const prediction of predictions) {
      const key = `${prediction.targetData.type}_${prediction.targetData.keys.join(',')}_${prediction.targetData.chainId}`;
      const existing = dedupedMap.get(key);

      if (!existing || prediction.confidence > existing.confidence) {
        dedupedMap.set(key, prediction);
      }
    }

    return Array.from(dedupedMap.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 100); // Limit to top 100 predictions
  }

  private async analyzeAndUpdatePatterns(): Promise<void> {
    // Analyze stored patterns and update effectiveness metrics
    // This would be a comprehensive analysis of pattern performance
    this.contextLogger.debug('Pattern analysis completed');
  }

  // Placeholder methods for chain-specific predictions
  private async createChainOptimizedPredictions(
    chainId: ChainId,
    strategy: ChainOptimizationStrategy
  ): Promise<WarmingPrediction[]> {
    // Implementation would create predictions based on chain characteristics
    return [];
  }

  private async createCostOptimizedPredictions(
    chainId: ChainId,
    strategy: ChainOptimizationStrategy
  ): Promise<WarmingPrediction[]> {
    // Implementation would create predictions optimized for cost windows
    return [];
  }

  private async createTimeBasedUserPredictions(
    pattern: UserBehaviorPattern,
    currentHour: number
  ): Promise<WarmingPrediction[]> {
    // Implementation would create predictions based on user time patterns
    return [];
  }

  private async createMlBasedPrediction(
    modelKey: string,
    score: number,
    features: Record<string, number>
  ): Promise<WarmingPrediction | null> {
    // Implementation would create ML-based predictions
    return null;
  }

  // Public API methods

  /**
   * Get current warming metrics
   */
  getMetrics(): CacheWarmingMetrics {
    return { ...this.metrics };
  }

  /**
   * Get active predictions
   */
  getActivePredictions(): WarmingPrediction[] {
    return Array.from(this.activePredictions.values());
  }

  /**
   * Configure warming system
   */
  configure(settings: {
    enabled?: boolean;
    maxConcurrentWarming?: number;
    userPatternEnabled?: boolean;
    timePatternEnabled?: boolean;
    chainOptimizationEnabled?: boolean;
    mlPredictionEnabled?: boolean;
    costAwareWarming?: boolean;
  }): void {
    Object.assign(this, settings);
    this.contextLogger.info('Predictive cache warming configured', settings);
  }

  /**
   * Force pattern analysis for specific user
   */
  async analyzeUserPatternNow(userId: string): Promise<UserBehaviorPattern | null> {
    const pattern = this.userBehaviorPatterns.get(userId);
    if (pattern) {
      await this.generateUserBasedPredictions(pattern);
    }
    return pattern || null;
  }

  /**
   * Add custom time pattern
   */
  addTimePattern(pattern: TimeBasedPattern): void {
    this.timeBasedPatterns.set(pattern.patternId, pattern);
    this.contextLogger.info('Time pattern added', { patternId: pattern.patternId });
  }

  /**
   * Update chain optimization strategy
   */
  updateChainStrategy(chainId: ChainId, strategy: Partial<ChainOptimizationStrategy>): void {
    const existing = this.chainOptimizationStrategies.get(chainId);
    if (existing) {
      Object.assign(existing, strategy);
      this.contextLogger.info('Chain strategy updated', { chainId });
    }
  }
}

// Export singleton instance
let predictiveCacheWarmingInstance: PredictiveCacheWarming | null = null;

export const getPredictiveCacheWarming = (): PredictiveCacheWarming => {
  if (!predictiveCacheWarmingInstance) {
    predictiveCacheWarmingInstance = new PredictiveCacheWarming();
  }
  return predictiveCacheWarmingInstance;
};

export default getPredictiveCacheWarming;
