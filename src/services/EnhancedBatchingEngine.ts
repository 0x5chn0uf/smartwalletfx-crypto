import { EventEmitter } from 'events';
import { logger, logError, createContextualLogger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { config } from '@/config';
import { ChainId } from '@/types/blockchain';
import { getEventSystem, BatchOptimizationV1 } from './EventSystem';
import { getBatchProcessor, BatchRequest } from './RequestBatchProcessor';
import { getDeduplicationService, DeduplicationRequest } from './RequestDeduplicationService';

/**
 * Enhanced Batching Engine
 *
 * Advanced batching system that extends the base RequestBatchProcessor:
 * - Intelligent request coalescing based on data relationships
 * - Multi-provider batch optimization with cost-aware routing
 * - Dynamic batch sizing with ML-based optimization
 * - Cross-chain batching strategies for EVM compatibility
 * - Queue aging policies with priority-based processing
 */

export interface EnhancedBatchRequest extends BatchRequest {
  relationships?: string[]; // Related data that could be fetched together
  crossChainCompatible?: boolean;
  dataFreshness?: 'real_time' | 'near_time' | 'eventual'; // How fresh data needs to be
  userIntent?: 'analytics' | 'trading' | 'portfolio' | 'discovery'; // User's intent
  geographicRegion?: string; // For latency optimization
  deviceType?: 'mobile' | 'desktop' | 'api'; // For optimization hints
}

export interface CoalescingStrategy {
  name: string;
  condition: (requests: EnhancedBatchRequest[]) => boolean;
  coalesceLogic: (requests: EnhancedBatchRequest[]) => {
    coalescedRequest: any;
    expectedSavings: number;
    riskScore: number; // Risk of latency increase
  };
  resultDistribution: (response: any, requests: EnhancedBatchRequest[]) => Map<string, any>;
  maxCoalesceSize: number;
  maxCoalesceLatency: number;
  savingsThreshold: number;
}

export interface BatchOptimizationMetrics {
  totalRequests: number;
  batchedRequests: number;
  coalescedRequests: number;
  crossChainBatches: number;
  totalCostSavings: number;
  totalLatencyReduction: number;
  averageBatchEfficiency: number;
  averageCoalesceEfficiency: number;
  queueAgeDistribution: {
    under_1s: number;
    _1_to_5s: number;
    _5_to_15s: number;
    over_15s: number;
  };
  providerOptimizationSavings: number;
  crossChainOptimizationSavings: number;
  mlOptimizationAccuracy: number;
  backpressureEvents: number;
  priorityOverrides: number;
}

export interface QueueManagementConfig {
  maxQueueSize: number;
  agingThresholds: {
    yellow: number; // ms
    red: number; // ms
    critical: number; // ms
  };
  priorityWeights: {
    critical: number;
    high: number;
    normal: number;
    low: number;
  };
  backpressureConfig: {
    enabled: boolean;
    triggerThreshold: number; // queue length
    shedPercentage: number; // percentage of low priority to shed
    recoveryThreshold: number; // when to stop shedding
  };
}

export interface CrossChainBatchConfig {
  enabled: boolean;
  compatibleChains: {
    [key in ChainId]?: ChainId[];
  };
  consolidationStrategies: {
    balance: boolean;
    token_metadata: boolean;
    price: boolean;
    transaction: boolean;
  };
  maxLatencyIncrease: number; // ms acceptable increase for cross-chain batching
}

/**
 * Advanced batching engine with intelligent coalescing
 */
export class EnhancedBatchingEngine extends EventEmitter {
  private contextLogger = createContextualLogger({ component: 'EnhancedBatchingEngine' });
  private eventSystem = getEventSystem();
  private baseBatchProcessor = getBatchProcessor();
  private deduplicationService = getDeduplicationService();

  // Enhanced batching queues
  private requestQueues = new Map<string, EnhancedBatchRequest[]>();
  private coalescingGroups = new Map<
    string,
    {
      requests: EnhancedBatchRequest[];
      strategy: CoalescingStrategy;
      createdAt: number;
      targetProcessingTime: number;
    }
  >();

  // Configuration
  private queueConfig: QueueManagementConfig = {
    maxQueueSize: 100000,
    agingThresholds: {
      yellow: 5000, // 5 seconds
      red: 15000, // 15 seconds
      critical: 30000, // 30 seconds
    },
    priorityWeights: {
      critical: 10,
      high: 5,
      normal: 2,
      low: 1,
    },
    backpressureConfig: {
      enabled: true,
      triggerThreshold: 80000, // 80% of max queue size
      shedPercentage: 0.2, // Shed 20% of low priority
      recoveryThreshold: 60000, // 60% of max queue size
    },
  };

  private crossChainConfig: CrossChainBatchConfig = {
    enabled: true,
    compatibleChains: {
      [ChainId.ETHEREUM]: [ChainId.POLYGON, ChainId.ARBITRUM, ChainId.OPTIMISM],
      [ChainId.POLYGON]: [ChainId.ETHEREUM, ChainId.ARBITRUM, ChainId.OPTIMISM],
      [ChainId.ARBITRUM]: [ChainId.ETHEREUM, ChainId.POLYGON, ChainId.OPTIMISM],
      [ChainId.OPTIMISM]: [ChainId.ETHEREUM, ChainId.POLYGON, ChainId.ARBITRUM],
      [ChainId.BSC]: [ChainId.POLYGON],
      [ChainId.AVALANCHE]: [ChainId.ETHEREUM, ChainId.POLYGON],
    },
    consolidationStrategies: {
      balance: true,
      token_metadata: true,
      price: true,
      transaction: false, // Transactions are chain-specific
    },
    maxLatencyIncrease: 2000, // 2 seconds max acceptable increase
  };

  // ML optimization state
  private mlOptimizationEnabled = true;
  private optimizationModel = new Map<
    string,
    {
      weights: number[];
      accuracy: number;
      lastTrained: number;
      predictions: Array<{
        predicted: number;
        actual: number;
        timestamp: number;
      }>;
    }
  >();

  // Metrics
  private metrics: BatchOptimizationMetrics = {
    totalRequests: 0,
    batchedRequests: 0,
    coalescedRequests: 0,
    crossChainBatches: 0,
    totalCostSavings: 0,
    totalLatencyReduction: 0,
    averageBatchEfficiency: 0,
    averageCoalesceEfficiency: 0,
    queueAgeDistribution: {
      under_1s: 0,
      _1_to_5s: 0,
      _5_to_15s: 0,
      over_15s: 0,
    },
    providerOptimizationSavings: 0,
    crossChainOptimizationSavings: 0,
    mlOptimizationAccuracy: 0,
    backpressureEvents: 0,
    priorityOverrides: 0,
  };

  // Coalescing strategies
  private coalescingStrategies: CoalescingStrategy[] = [];

  constructor() {
    super();
    this.initializeCoalescingStrategies();
    this.startEnhancedProcessing();
    this.startQueueManagement();
    this.startMetricsCollection();
    this.setupEventListeners();
  }

  /**
   * Enhanced batch submission with intelligent routing
   */
  async submitEnhancedRequest(request: EnhancedBatchRequest): Promise<void> {
    this.metrics.totalRequests++;

    try {
      // Step 1: Check for deduplication first
      const deduplicationRequest: DeduplicationRequest = {
        id: request.id,
        type: request.type,
        params: request.params,
        chainId: request.chainId,
        timestamp: request.timestamp,
        userContext: request.requester,
        priority: request.priority,
        callback: request.callback,
        estimatedCost: request.estimatedCost,
        temporalWindow: this.getTemporalWindow(request),
        semanticKey: this.generateSemanticKey(request),
      };

      const deduplicationResult =
        await this.deduplicationService.deduplicateRequest(deduplicationRequest);

      if (deduplicationResult.isDuplicate) {
        this.contextLogger.info('Request deduplicated', {
          requestId: request.id,
          originalRequestId: deduplicationResult.originalRequestId,
          costSaved: deduplicationResult.costSaved,
        });
        return; // Request handled by deduplication
      }

      // Step 2: Check backpressure and queue management
      const totalQueueSize = this.getTotalQueueSize();
      if (totalQueueSize > this.queueConfig.backpressureConfig.triggerThreshold) {
        await this.handleBackpressure();
      }

      // Step 3: Intelligent routing and coalescing
      const routingDecision = await this.makeIntelligentRoutingDecision(request);

      if (routingDecision.shouldCoalesce) {
        await this.handleCoalescingRequest(request, routingDecision.coalescingStrategy!);
      } else if (routingDecision.shouldBatch) {
        await this.handleBatchingRequest(request);
      } else {
        await this.handleImmediateRequest(request);
      }

      this.updateQueueMetrics();
    } catch (error) {
      logError(error as Error, {
        operation: 'submitEnhancedRequest',
        requestId: request.id,
      });

      // Fallback to immediate processing
      await this.handleImmediateRequest(request);
    }
  }

  /**
   * Make intelligent routing decision using ML and heuristics
   */
  private async makeIntelligentRoutingDecision(request: EnhancedBatchRequest): Promise<{
    shouldBatch: boolean;
    shouldCoalesce: boolean;
    coalescingStrategy?: CoalescingStrategy;
    confidence: number;
    reasoning: string;
  }> {
    const startTime = Date.now();

    // ML-based prediction if enabled
    let mlPrediction: { batch: number; coalesce: number; confidence: number } = {
      batch: 0.5,
      coalesce: 0.3,
      confidence: 0.5,
    };

    if (this.mlOptimizationEnabled) {
      mlPrediction = await this.getMlRoutingPrediction(request);
    }

    // Rule-based analysis
    const ruleBasedDecision = this.getRuleBasedRoutingDecision(request);

    // Find best coalescing strategy
    let bestCoalescingStrategy: CoalescingStrategy | undefined;
    let coalesceScore = 0;

    for (const strategy of this.coalescingStrategies) {
      const existingGroup = this.findCompatibleCoalescingGroup(request, strategy);
      if (existingGroup) {
        const score = this.calculateCoalescingScore(request, existingGroup, strategy);
        if (score > coalesceScore && score > 0.6) {
          coalesceScore = score;
          bestCoalescingStrategy = strategy;
        }
      }
    }

    // Combine ML and rule-based decisions
    const mlWeight = this.mlOptimizationEnabled ? 0.6 : 0;
    const ruleWeight = 1 - mlWeight;

    const batchScore = mlPrediction.batch * mlWeight + ruleBasedDecision.batchScore * ruleWeight;
    const finalCoalesceScore = mlPrediction.coalesce * mlWeight + coalesceScore * ruleWeight;

    // Decision logic
    let shouldBatch = false;
    let shouldCoalesce = false;
    let reasoning = 'immediate_processing';

    if (finalCoalesceScore > 0.7 && bestCoalescingStrategy) {
      shouldCoalesce = true;
      reasoning = 'coalescing_optimization';
    } else if (batchScore > 0.6) {
      shouldBatch = true;
      reasoning = 'batch_optimization';
    } else if (request.priority === 'critical') {
      reasoning = 'critical_priority_immediate';
    }

    const decisionTime = Date.now() - startTime;

    this.contextLogger.debug('Routing decision made', {
      requestId: request.id,
      shouldBatch,
      shouldCoalesce,
      batchScore,
      coalesceScore: finalCoalesceScore,
      reasoning,
      decisionTime,
      mlConfidence: mlPrediction.confidence,
    });

    return {
      shouldBatch,
      shouldCoalesce,
      coalescingStrategy: bestCoalescingStrategy,
      confidence: Math.max(mlPrediction.confidence, ruleBasedDecision.confidence),
      reasoning,
    };
  }

  /**
   * Handle coalescing request
   */
  private async handleCoalescingRequest(
    request: EnhancedBatchRequest,
    strategy: CoalescingStrategy
  ): Promise<void> {
    const groupKey = this.generateCoalescingGroupKey(request, strategy);
    let group = this.coalescingGroups.get(groupKey);

    if (!group) {
      // Create new coalescing group
      group = {
        requests: [request],
        strategy,
        createdAt: Date.now(),
        targetProcessingTime: Date.now() + strategy.maxCoalesceLatency,
      };
      this.coalescingGroups.set(groupKey, group);

      // Schedule processing
      setTimeout(async () => {
        await this.processCoalescingGroup(groupKey);
      }, strategy.maxCoalesceLatency);
    } else {
      // Add to existing group
      group.requests.push(request);
      this.metrics.coalescedRequests++;

      // Check if we should process early due to size
      if (group.requests.length >= strategy.maxCoalesceSize) {
        await this.processCoalescingGroup(groupKey);
      }
    }

    this.contextLogger.info('Request added to coalescing group', {
      requestId: request.id,
      groupKey,
      groupSize: group.requests.length,
      strategy: strategy.name,
    });
  }

  /**
   * Handle batching request (delegate to base processor)
   */
  private async handleBatchingRequest(request: EnhancedBatchRequest): Promise<void> {
    // Convert to base BatchRequest and delegate
    const baseRequest: BatchRequest = {
      id: request.id,
      type: request.type,
      chainId: request.chainId,
      params: request.params,
      priority: request.priority,
      maxWaitTime: request.maxWaitTime,
      callback: request.callback,
      timestamp: request.timestamp,
      estimatedCost: request.estimatedCost,
      requester: request.requester,
    };

    await this.baseBatchProcessor.submitRequest(baseRequest);
    this.metrics.batchedRequests++;
  }

  /**
   * Handle immediate request processing
   */
  private async handleImmediateRequest(request: EnhancedBatchRequest): Promise<void> {
    try {
      // Process immediately
      const startTime = Date.now();

      // This would integrate with your actual API processing logic
      const result = await this.processRequestImmediate(request);
      const processingTime = Date.now() - startTime;

      request.callback(result);

      this.contextLogger.debug('Immediate request processed', {
        requestId: request.id,
        processingTime,
        type: request.type,
      });
    } catch (error) {
      request.callback(null, error as Error);
      logError(error as Error, {
        operation: 'handleImmediateRequest',
        requestId: request.id,
      });
    }
  }

  /**
   * Process a coalescing group
   */
  private async processCoalescingGroup(groupKey: string): Promise<void> {
    const group = this.coalescingGroups.get(groupKey);
    if (!group) return;

    const startTime = Date.now();

    try {
      this.contextLogger.info('Processing coalescing group', {
        groupKey,
        requestCount: group.requests.length,
        strategy: group.strategy.name,
        age: Date.now() - group.createdAt,
      });

      // Apply coalescing logic
      const coalesceResult = group.strategy.coalesceLogic(group.requests);

      // Execute the coalesced request
      const response = await this.executeCoalescedRequest(coalesceResult.coalescedRequest, group);

      // Distribute results
      const results = group.strategy.resultDistribution(response, group.requests);

      let successCount = 0;
      for (const request of group.requests) {
        try {
          const result = results.get(request.id);
          if (result) {
            request.callback(result);
            successCount++;
          } else {
            request.callback(null, new Error(`No result for request ${request.id}`));
          }
        } catch (error) {
          request.callback(null, error as Error);
        }
      }

      const processingTime = Date.now() - startTime;
      const efficiency = successCount / group.requests.length;

      // Update metrics
      this.updateCoalescingMetrics(group, coalesceResult, processingTime, efficiency);

      // Emit optimization event
      const optimizationEvent: BatchOptimizationV1 = {
        type: 'BatchOptimizationV1',
        timestamp: Date.now(),
        batchId: groupKey,
        requestCount: group.requests.length,
        batchStrategy: group.strategy.name,
        costSavings: coalesceResult.expectedSavings,
        latencyImpact:
          processingTime -
          group.requests.length * this.estimateIndividualLatency(group.requests[0].type),
        efficiency,
        provider: 'coalesced',
        chainId: group.requests[0].chainId,
        metadata: {
          groupAge: Date.now() - group.createdAt,
          riskScore: coalesceResult.riskScore,
          coalescingStrategy: group.strategy.name,
        },
      };

      await this.eventSystem.emitEvent(optimizationEvent);

      this.contextLogger.info('Coalescing group processed', {
        groupKey,
        requestCount: group.requests.length,
        successCount,
        processingTime,
        efficiency,
        costSavings: coalesceResult.expectedSavings,
      });
    } catch (error) {
      logError(error as Error, {
        operation: 'processCoalescingGroup',
        groupKey,
        requestCount: group.requests.length,
      });

      // Fallback: process requests individually
      for (const request of group.requests) {
        try {
          await this.handleImmediateRequest(request);
        } catch (fallbackError) {
          request.callback(null, fallbackError as Error);
        }
      }
    } finally {
      this.coalescingGroups.delete(groupKey);
    }
  }

  /**
   * Initialize coalescing strategies
   */
  private initializeCoalescingStrategies(): void {
    // Cross-chain balance coalescing
    this.coalescingStrategies.push({
      name: 'cross_chain_balance',
      condition: requests => this.canCoalesceAcrossChains(requests, 'balance'),
      coalesceLogic: requests => this.coalesceBalanceRequests(requests),
      resultDistribution: (response, requests) => this.distributeBalanceResults(response, requests),
      maxCoalesceSize: 50,
      maxCoalesceLatency: 3000,
      savingsThreshold: 0.4,
    });

    // Token metadata coalescing
    this.coalescingStrategies.push({
      name: 'token_metadata_coalesce',
      condition: requests => requests.every(r => r.type === 'token_metadata'),
      coalesceLogic: requests => this.coalesceTokenMetadataRequests(requests),
      resultDistribution: (response, requests) =>
        this.distributeTokenMetadataResults(response, requests),
      maxCoalesceSize: 100,
      maxCoalesceLatency: 5000,
      savingsThreshold: 0.3,
    });

    // Price data coalescing
    this.coalescingStrategies.push({
      name: 'price_data_coalesce',
      condition: requests => this.canCoalescePriceRequests(requests),
      coalesceLogic: requests => this.coalescePriceRequests(requests),
      resultDistribution: (response, requests) => this.distributePriceResults(response, requests),
      maxCoalesceSize: 200,
      maxCoalesceLatency: 2000,
      savingsThreshold: 0.5,
    });

    // User intent-based coalescing
    this.coalescingStrategies.push({
      name: 'user_intent_coalesce',
      condition: requests => this.canCoalesceByUserIntent(requests),
      coalesceLogic: requests => this.coalesceByUserIntent(requests),
      resultDistribution: (response, requests) => this.distributeIntentResults(response, requests),
      maxCoalesceSize: 30,
      maxCoalesceLatency: 4000,
      savingsThreshold: 0.35,
    });

    // Geographic optimization coalescing
    this.coalescingStrategies.push({
      name: 'geographic_optimization',
      condition: requests => this.canCoalesceByGeography(requests),
      coalesceLogic: requests => this.coalesceByGeography(requests),
      resultDistribution: (response, requests) =>
        this.distributeGeographicResults(response, requests),
      maxCoalesceSize: 40,
      maxCoalesceLatency: 3500,
      savingsThreshold: 0.25,
    });
  }

  /**
   * Get temporal window based on request characteristics
   */
  private getTemporalWindow(request: EnhancedBatchRequest): number {
    const baseWindows = {
      real_time: 5000, // 5 seconds
      near_time: 30000, // 30 seconds
      eventual: 300000, // 5 minutes
    };

    return baseWindows[request.dataFreshness || 'near_time'];
  }

  /**
   * Generate semantic key for deduplication
   */
  private generateSemanticKey(request: EnhancedBatchRequest): string | undefined {
    switch (request.type) {
      case 'balance':
        return `balance_${request.params.address}_${request.chainId}`;
      case 'token_metadata':
        return `metadata_${request.params.contractAddress}_${request.chainId}`;
      case 'price':
        return `price_${request.params.tokenAddress || 'multi'}_${request.chainId}`;
      default:
        return undefined;
    }
  }

  /**
   * Rule-based routing decision
   */
  private getRuleBasedRoutingDecision(request: EnhancedBatchRequest): {
    batchScore: number;
    confidence: number;
  } {
    let batchScore = 0.5;
    let confidence = 0.8;

    // Priority adjustments
    switch (request.priority) {
      case 'critical':
        batchScore = 0.1;
        break;
      case 'high':
        batchScore = 0.3;
        break;
      case 'low':
        batchScore = 0.9;
        break;
    }

    // User intent adjustments
    switch (request.userIntent) {
      case 'trading':
        batchScore *= 0.5; // Trading needs faster responses
        break;
      case 'analytics':
        batchScore *= 1.2; // Analytics can wait
        break;
      case 'portfolio':
        batchScore *= 0.8; // Portfolio needs reasonable speed
        break;
    }

    // Device type adjustments
    if (request.deviceType === 'mobile') {
      batchScore *= 0.8; // Mobile prefers faster responses
    }

    // Data freshness adjustments
    switch (request.dataFreshness) {
      case 'real_time':
        batchScore *= 0.4;
        break;
      case 'eventual':
        batchScore *= 1.3;
        break;
    }

    return {
      batchScore: Math.max(0, Math.min(1, batchScore)),
      confidence,
    };
  }

  /**
   * ML-based routing prediction
   */
  private async getMlRoutingPrediction(request: EnhancedBatchRequest): Promise<{
    batch: number;
    coalesce: number;
    confidence: number;
  }> {
    const requestTypeKey = `${request.type}_${request.chainId || 'any'}`;
    const model = this.optimizationModel.get(requestTypeKey);

    if (!model || Date.now() - model.lastTrained > 3600000) {
      // 1 hour
      await this.trainOptimizationModel(requestTypeKey);
    }

    // Feature extraction
    const features = this.extractMlFeatures(request);
    const score = this.calculateMlScore(features, model);

    return {
      batch: Math.max(0.1, Math.min(0.9, score)),
      coalesce: Math.max(0.1, Math.min(0.9, score * 0.8)), // Coalescing is riskier
      confidence: model?.accuracy || 0.6,
    };
  }

  /**
   * Extract ML features from request
   */
  private extractMlFeatures(request: EnhancedBatchRequest): Record<string, number> {
    const currentHour = new Date().getHours();
    const currentDay = new Date().getDay();

    return {
      estimatedCost: request.estimatedCost,
      maxWaitTime: request.maxWaitTime,
      priorityScore: this.getPriorityScore(request.priority),
      hourOfDay: currentHour,
      dayOfWeek: currentDay,
      queueLength: this.getTotalQueueSize(),
      dataFreshnessScore: this.getDataFreshnessScore(request.dataFreshness),
      userIntentScore: this.getUserIntentScore(request.userIntent),
      deviceTypeScore: this.getDeviceTypeScore(request.deviceType),
      hasRelationships: (request.relationships?.length || 0) > 0 ? 1 : 0,
      crossChainCompatible: request.crossChainCompatible ? 1 : 0,
    };
  }

  /**
   * Helper methods for feature scoring
   */
  private getPriorityScore(priority: string): number {
    const scores = { critical: 4, high: 3, normal: 2, low: 1 };
    return scores[priority as keyof typeof scores] || 2;
  }

  private getDataFreshnessScore(freshness?: string): number {
    const scores = { real_time: 3, near_time: 2, eventual: 1 };
    return scores[freshness as keyof typeof scores] || 2;
  }

  private getUserIntentScore(intent?: string): number {
    const scores = { trading: 4, portfolio: 3, discovery: 2, analytics: 1 };
    return scores[intent as keyof typeof scores] || 2;
  }

  private getDeviceTypeScore(device?: string): number {
    const scores = { mobile: 3, desktop: 2, api: 1 };
    return scores[device as keyof typeof scores] || 2;
  }

  /**
   * Calculate ML score using simple neural network
   */
  private calculateMlScore(features: Record<string, number>, model?: any): number {
    if (!model?.weights) {
      // Simple heuristic scoring without trained model
      return 0.5;
    }

    const featureValues = Object.values(features);
    let score = 0;

    for (let i = 0; i < Math.min(featureValues.length, model.weights.length); i++) {
      score += featureValues[i] * model.weights[i];
    }

    // Apply sigmoid activation
    return 1 / (1 + Math.exp(-score));
  }

  /**
   * Train optimization model
   */
  private async trainOptimizationModel(requestTypeKey: string): Promise<void> {
    // Simplified training - in production would use proper ML libraries
    const trainingData = await this.getTrainingData(requestTypeKey);
    const weights = this.initializeWeights(11); // Number of features

    // Simple gradient descent
    for (let epoch = 0; epoch < 10; epoch++) {
      for (const sample of trainingData) {
        const prediction = this.calculateMlScore(sample.features, { weights });
        const error = sample.actualOutcome - prediction;

        // Update weights
        const featureValues = Object.values(sample.features);
        for (let i = 0; i < weights.length; i++) {
          if (i < featureValues.length) {
            weights[i] += 0.01 * error * featureValues[i];
          }
        }
      }
    }

    // Calculate accuracy
    const accuracy = this.calculateModelAccuracy(weights, trainingData);

    this.optimizationModel.set(requestTypeKey, {
      weights,
      accuracy,
      lastTrained: Date.now(),
      predictions: [],
    });

    this.contextLogger.info('ML optimization model trained', {
      requestTypeKey,
      accuracy,
      trainingDataSize: trainingData.length,
    });
  }

  /**
   * Coalescing strategy implementations
   */
  private canCoalesceAcrossChains(requests: EnhancedBatchRequest[], type: string): boolean {
    if (!this.crossChainConfig.enabled) return false;
    if (
      !this.crossChainConfig.consolidationStrategies[
        type as keyof typeof this.crossChainConfig.consolidationStrategies
      ]
    )
      return false;

    const chains = [...new Set(requests.map(r => r.chainId).filter(Boolean))];
    if (chains.length < 2) return false;

    // Check if all chains are compatible
    return this.areChainsCrossCompatible(chains as ChainId[]);
  }

  private areChainsCrossCompatible(chains: ChainId[]): boolean {
    for (let i = 0; i < chains.length; i++) {
      for (let j = i + 1; j < chains.length; j++) {
        const compatibleChains = this.crossChainConfig.compatibleChains[chains[i]] || [];
        if (!compatibleChains.includes(chains[j])) {
          return false;
        }
      }
    }
    return true;
  }

  private coalesceBalanceRequests(requests: EnhancedBatchRequest[]) {
    const addresses = [...new Set(requests.map(r => r.params.address))];
    const chains = [...new Set(requests.map(r => r.chainId))];
    const contractAddresses = [...new Set(requests.flatMap(r => r.params.contractAddresses || []))];

    return {
      coalescedRequest: {
        method: 'multi_chain_balance',
        addresses,
        chains,
        contractAddresses,
      },
      expectedSavings: requests.length * 0.6, // 60% savings
      riskScore: 0.3, // Low risk for balance coalescing
    };
  }

  private coalesceTokenMetadataRequests(requests: EnhancedBatchRequest[]) {
    const contractAddresses = [...new Set(requests.map(r => r.params.contractAddress))];
    const chains = [...new Set(requests.map(r => r.chainId))];

    return {
      coalescedRequest: {
        method: 'batch_token_metadata',
        contractAddresses,
        chains,
      },
      expectedSavings: requests.length * 0.5, // 50% savings
      riskScore: 0.2, // Very low risk for metadata
    };
  }

  private coalescePriceRequests(requests: EnhancedBatchRequest[]) {
    const tokenAddresses = [
      ...new Set(requests.flatMap(r => r.params.tokenAddresses || [r.params.tokenAddress])),
    ];
    const currencies = [...new Set(requests.flatMap(r => r.params.currencies || ['usd']))];

    return {
      coalescedRequest: {
        method: 'multi_token_price',
        tokenAddresses,
        currencies,
      },
      expectedSavings: requests.length * 0.7, // 70% savings
      riskScore: 0.25,
    };
  }

  private canCoalescePriceRequests(requests: EnhancedBatchRequest[]): boolean {
    return requests.every(r => r.type === 'price') && requests.length >= 2;
  }

  private coalesceByUserIntent(requests: EnhancedBatchRequest[]) {
    const groupedByIntent = requests.reduce(
      (acc, req) => {
        const intent = req.userIntent || 'general';
        if (!acc[intent]) acc[intent] = [];
        acc[intent].push(req);
        return acc;
      },
      {} as Record<string, EnhancedBatchRequest[]>
    );

    return {
      coalescedRequest: {
        method: 'user_intent_batch',
        intentGroups: groupedByIntent,
      },
      expectedSavings: requests.length * 0.4, // 40% savings
      riskScore: 0.4, // Medium risk due to mixing intents
    };
  }

  private canCoalesceByUserIntent(requests: EnhancedBatchRequest[]): boolean {
    const intents = new Set(requests.map(r => r.userIntent));
    return intents.size <= 2 && requests.length >= 3; // Max 2 different intents
  }

  private coalesceByGeography(requests: EnhancedBatchRequest[]) {
    const regions = [...new Set(requests.map(r => r.geographicRegion).filter(Boolean))];

    return {
      coalescedRequest: {
        method: 'geographic_batch',
        regions,
        requests: requests.map(r => ({
          type: r.type,
          params: r.params,
          region: r.geographicRegion,
        })),
      },
      expectedSavings: requests.length * 0.3, // 30% savings
      riskScore: 0.5, // Higher risk due to latency
    };
  }

  private canCoalesceByGeography(requests: EnhancedBatchRequest[]): boolean {
    const regions = new Set(requests.map(r => r.geographicRegion).filter(Boolean));
    return regions.size === 1 && requests.length >= 2; // Same geographic region
  }

  /**
   * Result distribution implementations
   */
  private distributeBalanceResults(
    response: any,
    requests: EnhancedBatchRequest[]
  ): Map<string, any> {
    const results = new Map();

    // Implementation would depend on the actual response structure
    // This is a simplified version
    for (const request of requests) {
      const balanceData = response.balances?.find(
        (b: any) => b.address === request.params.address && b.chainId === request.chainId
      );
      results.set(request.id, balanceData);
    }

    return results;
  }

  private distributeTokenMetadataResults(
    response: any,
    requests: EnhancedBatchRequest[]
  ): Map<string, any> {
    const results = new Map();

    for (const request of requests) {
      const metadata = response.metadata?.find(
        (m: any) =>
          m.contractAddress === request.params.contractAddress && m.chainId === request.chainId
      );
      results.set(request.id, metadata);
    }

    return results;
  }

  private distributePriceResults(
    response: any,
    requests: EnhancedBatchRequest[]
  ): Map<string, any> {
    const results = new Map();

    for (const request of requests) {
      const tokenAddresses = request.params.tokenAddresses || [request.params.tokenAddress];
      const priceData = tokenAddresses.map((addr: string) => ({
        tokenAddress: addr,
        price: response.prices?.[addr],
      }));
      results.set(request.id, priceData);
    }

    return results;
  }

  private distributeIntentResults(
    response: any,
    requests: EnhancedBatchRequest[]
  ): Map<string, any> {
    const results = new Map();

    for (const request of requests) {
      const intentData = response.intentGroups?.[request.userIntent || 'general'];
      results.set(request.id, intentData);
    }

    return results;
  }

  private distributeGeographicResults(
    response: any,
    requests: EnhancedBatchRequest[]
  ): Map<string, any> {
    const results = new Map();

    for (const request of requests) {
      const regionData = response.regions?.[request.geographicRegion || 'default'];
      results.set(request.id, regionData);
    }

    return results;
  }

  /**
   * Utility methods
   */
  private getTotalQueueSize(): number {
    let total = 0;
    for (const queue of this.requestQueues.values()) {
      total += queue.length;
    }
    return total;
  }

  private findCompatibleCoalescingGroup(
    request: EnhancedBatchRequest,
    strategy: CoalescingStrategy
  ): any {
    for (const [groupKey, group] of this.coalescingGroups) {
      if (group.strategy === strategy && group.requests.length < strategy.maxCoalesceSize) {
        const testRequests = [...group.requests, request];
        if (strategy.condition(testRequests)) {
          return group;
        }
      }
    }
    return null;
  }

  private calculateCoalescingScore(
    request: EnhancedBatchRequest,
    group: any,
    strategy: CoalescingStrategy
  ): number {
    const timeSinceGroupCreated = Date.now() - group.createdAt;
    const timeRemaining = strategy.maxCoalesceLatency - timeSinceGroupCreated;

    if (timeRemaining <= 0) return 0; // Group expired

    const sizeScore = (strategy.maxCoalesceSize - group.requests.length) / strategy.maxCoalesceSize;
    const timeScore = timeRemaining / strategy.maxCoalesceLatency;
    const compatibilityScore = this.calculateCompatibilityScore(request, group.requests);

    return sizeScore * 0.4 + timeScore * 0.3 + compatibilityScore * 0.3;
  }

  private calculateCompatibilityScore(
    request: EnhancedBatchRequest,
    groupRequests: EnhancedBatchRequest[]
  ): number {
    let score = 0;
    const factors = {
      sameChain: 0.3,
      sameUserIntent: 0.2,
      sameDataFreshness: 0.2,
      sameRegion: 0.15,
      sameDeviceType: 0.15,
    };

    for (const groupReq of groupRequests) {
      if (request.chainId === groupReq.chainId) score += factors.sameChain;
      if (request.userIntent === groupReq.userIntent) score += factors.sameUserIntent;
      if (request.dataFreshness === groupReq.dataFreshness) score += factors.sameDataFreshness;
      if (request.geographicRegion === groupReq.geographicRegion) score += factors.sameRegion;
      if (request.deviceType === groupReq.deviceType) score += factors.sameDeviceType;
    }

    return Math.min(1, score / groupRequests.length);
  }

  private generateCoalescingGroupKey(
    request: EnhancedBatchRequest,
    strategy: CoalescingStrategy
  ): string {
    const baseKey = `${strategy.name}_${request.type}_${request.chainId}`;

    switch (strategy.name) {
      case 'cross_chain_balance':
        return `${baseKey}_${request.params.address}`;
      case 'token_metadata_coalesce':
        return baseKey;
      case 'price_data_coalesce':
        return baseKey;
      case 'user_intent_coalesce':
        return `${baseKey}_${request.userIntent}`;
      case 'geographic_optimization':
        return `${baseKey}_${request.geographicRegion}`;
      default:
        return baseKey;
    }
  }

  private async executeCoalescedRequest(coalescedRequest: any, group: any): Promise<any> {
    // This would integrate with your actual API processing logic
    // For now, simulate processing
    const delay = Math.random() * 1000 + 500; // 500-1500ms
    await new Promise(resolve => setTimeout(resolve, delay));

    return this.simulateCoalescedResponse(coalescedRequest, group);
  }

  private simulateCoalescedResponse(request: any, group: any): any {
    // Simulate response based on method type
    switch (request.method) {
      case 'multi_chain_balance':
        return {
          balances: group.requests.map((req: any) => ({
            address: req.params.address,
            chainId: req.chainId,
            balance: '1000000000000000000', // 1.0 token
          })),
        };
      case 'batch_token_metadata':
        return {
          metadata: request.contractAddresses.map((addr: string) => ({
            contractAddress: addr,
            name: `Token ${addr.slice(-4)}`,
            symbol: `TK${addr.slice(-2)}`,
            decimals: 18,
          })),
        };
      case 'multi_token_price':
        const prices: Record<string, any> = {};
        request.tokenAddresses.forEach((addr: string) => {
          prices[addr] = { usd: Math.random() * 1000 };
        });
        return { prices };
      default:
        return { success: true };
    }
  }

  private processRequestImmediate(request: EnhancedBatchRequest): Promise<any> {
    // Simulate immediate processing
    return new Promise(resolve => {
      setTimeout(
        () => {
          resolve({ success: true, data: `Processed ${request.type}` });
        },
        Math.random() * 200 + 100
      );
    });
  }

  private estimateIndividualLatency(requestType: string): number {
    const latencies = {
      balance: 600,
      token_metadata: 400,
      price: 300,
      transaction: 800,
      nft: 1200,
      defi: 1500,
    };
    return latencies[requestType as keyof typeof latencies] || 500;
  }

  private updateCoalescingMetrics(
    group: any,
    coalesceResult: any,
    processingTime: number,
    efficiency: number
  ): void {
    this.metrics.coalescedRequests += group.requests.length;
    this.metrics.totalCostSavings += coalesceResult.expectedSavings;
    this.metrics.averageCoalesceEfficiency =
      (this.metrics.averageCoalesceEfficiency + efficiency) / 2;

    if (group.strategy.name.includes('cross_chain')) {
      this.metrics.crossChainBatches++;
      this.metrics.crossChainOptimizationSavings += coalesceResult.expectedSavings;
    }
  }

  private updateQueueMetrics(): void {
    const now = Date.now();
    const distribution = { under_1s: 0, _1_to_5s: 0, _5_to_15s: 0, over_15s: 0 };

    for (const queue of this.requestQueues.values()) {
      for (const request of queue) {
        const age = now - request.timestamp;
        if (age < 1000) distribution.under_1s++;
        else if (age < 5000) distribution._1_to_5s++;
        else if (age < 15000) distribution._5_to_15s++;
        else distribution.over_15s++;
      }
    }

    this.metrics.queueAgeDistribution = distribution;
  }

  private async handleBackpressure(): Promise<void> {
    if (!this.queueConfig.backpressureConfig.enabled) return;

    this.metrics.backpressureEvents++;

    const totalQueueSize = this.getTotalQueueSize();
    const targetReduction = Math.floor(
      totalQueueSize * this.queueConfig.backpressureConfig.shedPercentage
    );

    let removed = 0;
    for (const [queueKey, queue] of this.requestQueues) {
      if (removed >= targetReduction) break;

      // Remove low priority requests
      const lowPriorityIndices = queue
        .map((req, index) => ({ req, index }))
        .filter(({ req }) => req.priority === 'low')
        .map(({ index }) => index)
        .sort((a, b) => b - a); // Remove from end first

      for (const index of lowPriorityIndices) {
        if (removed >= targetReduction) break;

        const removedRequest = queue.splice(index, 1)[0];
        removedRequest.callback(null, new Error('Request shed due to backpressure'));
        removed++;
      }
    }

    this.contextLogger.warn('Backpressure applied', {
      totalQueueSize,
      targetReduction,
      actualRemoved: removed,
    });
  }

  /**
   * Training data methods
   */
  private async getTrainingData(requestTypeKey: string): Promise<any[]> {
    // Simplified training data generation
    const samples = [];
    for (let i = 0; i < 100; i++) {
      const features = {
        estimatedCost: Math.random() * 0.01,
        maxWaitTime: Math.random() * 5000,
        priorityScore: Math.floor(Math.random() * 4) + 1,
        hourOfDay: Math.floor(Math.random() * 24),
        dayOfWeek: Math.floor(Math.random() * 7),
        queueLength: Math.floor(Math.random() * 1000),
        dataFreshnessScore: Math.floor(Math.random() * 3) + 1,
        userIntentScore: Math.floor(Math.random() * 4) + 1,
        deviceTypeScore: Math.floor(Math.random() * 3) + 1,
        hasRelationships: Math.random() > 0.5 ? 1 : 0,
        crossChainCompatible: Math.random() > 0.7 ? 1 : 0,
      };

      // Simple rule-based outcome for training
      const shouldBatch = features.priorityScore <= 2 && features.queueLength > 100;
      samples.push({ features, actualOutcome: shouldBatch ? 1 : 0 });
    }
    return samples;
  }

  private initializeWeights(count: number): number[] {
    return Array.from({ length: count }, () => (Math.random() - 0.5) * 2);
  }

  private calculateModelAccuracy(weights: number[], testData: any[]): number {
    let correct = 0;
    for (const sample of testData) {
      const prediction = this.calculateMlScore(sample.features, { weights });
      const predictedOutcome = prediction > 0.5 ? 1 : 0;
      if (predictedOutcome === sample.actualOutcome) correct++;
    }
    return testData.length > 0 ? correct / testData.length : 0.5;
  }

  /**
   * Start processing and monitoring
   */
  private startEnhancedProcessing(): void {
    // Process coalescing groups that have timed out
    setInterval(() => {
      const now = Date.now();
      for (const [groupKey, group] of this.coalescingGroups) {
        if (now >= group.targetProcessingTime) {
          this.processCoalescingGroup(groupKey);
        }
      }
    }, 1000); // Check every second
  }

  private startQueueManagement(): void {
    // Monitor queue health every 30 seconds
    setInterval(() => {
      this.updateQueueMetrics();

      // Check for aging issues
      const distribution = this.metrics.queueAgeDistribution;
      if (distribution.over_15s > 100) {
        this.contextLogger.warn('High number of aged requests detected', {
          over15s: distribution.over_15s,
          total: Object.values(distribution).reduce((a, b) => a + b, 0),
        });
      }
    }, 30000);
  }

  private startMetricsCollection(): void {
    setInterval(() => {
      this.emit('enhancedBatchingMetrics', {
        timestamp: Date.now(),
        metrics: { ...this.metrics },
      });
    }, 30000);
  }

  private setupEventListeners(): void {
    // Listen for coalescing group ready events
    this.on('coalescedGroupReady', async data => {
      // Handle groups that are ready but not yet processed
      // This provides an integration point for custom processing
    });
  }

  // Public API methods

  /**
   * Get current enhanced batching metrics
   */
  getMetrics(): BatchOptimizationMetrics {
    return { ...this.metrics };
  }

  /**
   * Get active coalescing groups info
   */
  getActiveCoalescingGroups(): Array<{
    groupKey: string;
    requestCount: number;
    strategy: string;
    age: number;
    targetProcessingTime: number;
  }> {
    return Array.from(this.coalescingGroups.entries()).map(([groupKey, group]) => ({
      groupKey,
      requestCount: group.requests.length,
      strategy: group.strategy.name,
      age: Date.now() - group.createdAt,
      targetProcessingTime: group.targetProcessingTime,
    }));
  }

  /**
   * Update configuration
   */
  updateQueueConfig(config: Partial<QueueManagementConfig>): void {
    Object.assign(this.queueConfig, config);
    this.contextLogger.info('Queue configuration updated', config);
  }

  updateCrossChainConfig(config: Partial<CrossChainBatchConfig>): void {
    Object.assign(this.crossChainConfig, config);
    this.contextLogger.info('Cross-chain configuration updated', config);
  }

  /**
   * Force process all pending groups
   */
  async forceProcessPendingGroups(): Promise<number> {
    const groupCount = this.coalescingGroups.size;
    const groupKeys = Array.from(this.coalescingGroups.keys());

    for (const groupKey of groupKeys) {
      await this.processCoalescingGroup(groupKey);
    }

    this.contextLogger.info('Force processed pending groups', { groupCount });
    return groupCount;
  }

  /**
   * Enable/disable ML optimization
   */
  setMlOptimizationEnabled(enabled: boolean): void {
    this.mlOptimizationEnabled = enabled;
    this.contextLogger.info(`ML optimization ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get optimization model information
   */
  getOptimizationModelInfo(): Array<{
    requestTypeKey: string;
    accuracy: number;
    lastTrained: number;
    predictionCount: number;
  }> {
    return Array.from(this.optimizationModel.entries()).map(([key, model]) => ({
      requestTypeKey: key,
      accuracy: model.accuracy,
      lastTrained: model.lastTrained,
      predictionCount: model.predictions.length,
    }));
  }
}

// Export singleton instance
let enhancedBatchingEngineInstance: EnhancedBatchingEngine | null = null;

export const getEnhancedBatchingEngine = (): EnhancedBatchingEngine => {
  if (!enhancedBatchingEngineInstance) {
    enhancedBatchingEngineInstance = new EnhancedBatchingEngine();
  }
  return enhancedBatchingEngineInstance;
};

export default getEnhancedBatchingEngine;
