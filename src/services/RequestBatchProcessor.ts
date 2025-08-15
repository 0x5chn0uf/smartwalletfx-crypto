import { EventEmitter } from 'events';
import { logger, logError, createContextualLogger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { config } from '@/config';
import { ChainId } from '@/types/blockchain';

/**
 * Advanced Request Batching System
 *
 * Intelligently batches API requests to minimize costs while maintaining performance:
 * - Smart request consolidation based on data type and provider capabilities
 * - Adaptive batching strategies based on load and cost constraints
 * - Priority-aware request queuing and processing
 * - Automatic batch optimization and monitoring
 */

export interface BatchRequest {
  id: string;
  type: 'balance' | 'transaction' | 'token_metadata' | 'price' | 'nft' | 'defi';
  chainId?: ChainId;
  params: Record<string, any>;
  priority: 'low' | 'normal' | 'high' | 'critical';
  maxWaitTime: number; // Maximum time to wait for batching (ms)
  callback: (result: any, error?: Error) => void;
  timestamp: number;
  estimatedCost: number;
  requester?: string; // User/session identifier
}

export interface BatchGroup {
  id: string;
  type: string;
  chainId?: ChainId;
  provider: string;
  requests: BatchRequest[];
  totalCost: number;
  estimatedSavings: number;
  createdAt: number;
  maxWaitTime: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
}

export interface BatchingStrategy {
  name: string;
  condition: (request: BatchRequest) => boolean;
  maxBatchSize: number;
  maxWaitTime: number;
  costSavingsThreshold: number; // Minimum savings % to justify batching
  consolidationLogic: (requests: BatchRequest[]) => any;
  responseDistribution: (batchResponse: any, requests: BatchRequest[]) => Map<string, any>;
}

class BatchingStrategies {
  static readonly BALANCE_MULTI: BatchingStrategy = {
    name: 'balance_multi',
    condition: request => request.type === 'balance',
    maxBatchSize: 100,
    maxWaitTime: 500, // 500ms max wait for balance queries
    costSavingsThreshold: 30, // 30% savings threshold
    consolidationLogic: requests => ({
      method: 'alchemy_getTokenBalances',
      addresses: [...new Set(requests.map(r => r.params.address))],
      contractAddresses: [...new Set(requests.flatMap(r => r.params.contractAddresses || []))],
    }),
    responseDistribution: (batchResponse, requests) => {
      const results = new Map<string, any>();
      batchResponse.tokenBalances?.forEach((balance: any, index: number) => {
        const request = requests.find(r => r.params.address === balance.address);
        if (request) {
          results.set(request.id, balance);
        }
      });
      return results;
    },
  };

  static readonly TOKEN_METADATA: BatchingStrategy = {
    name: 'token_metadata',
    condition: request => request.type === 'token_metadata',
    maxBatchSize: 50,
    maxWaitTime: 2000, // 2s wait for metadata (less time-sensitive)
    costSavingsThreshold: 25,
    consolidationLogic: requests => ({
      method: 'getTokensMetadata',
      contractAddresses: [...new Set(requests.map(r => r.params.contractAddress))],
    }),
    responseDistribution: (batchResponse, requests) => {
      const results = new Map<string, any>();
      batchResponse.forEach((metadata: any) => {
        const request = requests.find(r => r.params.contractAddress === metadata.contractAddress);
        if (request) {
          results.set(request.id, metadata);
        }
      });
      return results;
    },
  };

  static readonly PRICE_BATCH: BatchingStrategy = {
    name: 'price_batch',
    condition: request => request.type === 'price',
    maxBatchSize: 200,
    maxWaitTime: 1000, // 1s wait for prices
    costSavingsThreshold: 40,
    consolidationLogic: requests => ({
      method: 'getMultipleTokenPrices',
      tokenAddresses: [...new Set(requests.map(r => r.params.tokenAddress))],
      currencies: [...new Set(requests.flatMap(r => r.params.currencies || ['usd']))],
    }),
    responseDistribution: (batchResponse, requests) => {
      const results = new Map<string, any>();
      Object.entries(batchResponse).forEach(([tokenAddress, prices]) => {
        const request = requests.find(r => r.params.tokenAddress === tokenAddress);
        if (request) {
          results.set(request.id, prices);
        }
      });
      return results;
    },
  };

  static readonly TRANSACTION_HISTORY: BatchingStrategy = {
    name: 'transaction_history',
    condition: request => request.type === 'transaction' && request.params.batchable === true,
    maxBatchSize: 20,
    maxWaitTime: 1500,
    costSavingsThreshold: 20,
    consolidationLogic: requests => ({
      method: 'getAssetTransfers',
      params: {
        addresses: [...new Set(requests.map(r => r.params.address))],
        maxCount: Math.max(...requests.map(r => r.params.maxCount || 10)),
      },
    }),
    responseDistribution: (batchResponse, requests) => {
      const results = new Map<string, any>();
      batchResponse.transfers?.forEach((transfer: any) => {
        const matchingRequests = requests.filter(
          r => transfer.from === r.params.address || transfer.to === r.params.address
        );
        matchingRequests.forEach(request => {
          if (!results.has(request.id)) {
            results.set(request.id, []);
          }
          results.get(request.id).push(transfer);
        });
      });
      return results;
    },
  };

  static getAll(): BatchingStrategy[] {
    return [this.BALANCE_MULTI, this.TOKEN_METADATA, this.PRICE_BATCH, this.TRANSACTION_HISTORY];
  }
}

interface BatchingMetrics {
  totalRequests: number;
  batchedRequests: number;
  batchingRate: number;
  averageBatchSize: number;
  totalCostSavings: number;
  averageWaitTime: number;
  batchSuccessRate: number;
  providerBreakdown: Record<
    string,
    {
      batches: number;
      requests: number;
      savings: number;
    }
  >;
}

export class RequestBatchProcessor extends EventEmitter {
  private requestQueue = new Map<string, BatchRequest[]>(); // Keyed by batch type
  private activeBatches = new Map<string, BatchGroup>();
  private batchingStrategies: BatchingStrategy[];
  private contextLogger = createContextualLogger({ component: 'RequestBatchProcessor' });

  // Configuration
  private enabled = true;
  private maxConcurrentBatches = 10;
  private defaultMaxWaitTime = 1000; // 1 second
  private minBatchSize = 2;
  private adaptiveThresholds = true;

  // Metrics
  private metrics: BatchingMetrics = {
    totalRequests: 0,
    batchedRequests: 0,
    batchingRate: 0,
    averageBatchSize: 0,
    totalCostSavings: 0,
    averageWaitTime: 0,
    batchSuccessRate: 0,
    providerBreakdown: {},
  };

  // Advanced adaptive parameters
  private currentLoad = 0;
  private costPressure = 0; // 0-1 scale based on budget utilization
  private averageResponseTime = new Map<string, number>(); // Per provider
  private smartBatchingEnabled = true;
  private mlOptimizationEnabled = true;
  private predictiveBatching = true;

  // Machine learning parameters
  private batchPredictionModel = new Map<
    string,
    {
      weights: number[];
      accuracy: number;
      lastTrained: number;
      sampleCount: number;
    }
  >();

  // Advanced metrics
  private realTimeSavings = 0;
  private costEfficiencyTrend = 1.0;
  private batchOptimizationHistory = new Map<
    string,
    {
      timestamp: number;
      batchSize: number;
      actualSavings: number;
      latencyImpact: number;
    }[]
  >();

  constructor() {
    super();
    this.batchingStrategies = BatchingStrategies.getAll();
    this.startBatchProcessing();
    this.startMetricsCollection();
    this.loadConfiguration();
  }

  /**
   * Submit a request for intelligent batching with ML optimization
   */
  async submitRequest(request: Omit<BatchRequest, 'id' | 'timestamp'>): Promise<void> {
    const batchRequest: BatchRequest = {
      ...request,
      id: `batch_req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };

    this.metrics.totalRequests++;

    try {
      // Advanced batching decision with ML prediction
      const batchingDecision = await this.makeIntelligentBatchingDecision(batchRequest);

      if (!batchingDecision.shouldBatch) {
        // Process immediately with reason logging
        await this.processImmediateRequestAdvanced(batchRequest, batchingDecision.reason);
        return;
      }

      // Find optimal batching strategy with ML enhancement
      const strategy = await this.findOptimalBatchingStrategy(batchRequest, batchingDecision);
      if (!strategy) {
        await this.processImmediateRequestAdvanced(batchRequest, 'no_suitable_strategy');
        return;
      }

      // Smart queue assignment with predictive routing
      const queueAssignment = await this.getSmartQueueAssignment(
        batchRequest,
        strategy,
        batchingDecision
      );

      if (!this.requestQueue.has(queueAssignment.queueKey)) {
        this.requestQueue.set(queueAssignment.queueKey, []);
      }

      const queue = this.requestQueue.get(queueAssignment.queueKey)!;
      queue.push(batchRequest);

      // Intelligent batch processing decision with predictive modeling
      const processingDecision = await this.shouldProcessBatchIntelligent(
        queue,
        strategy,
        queueAssignment,
        batchingDecision
      );

      if (processingDecision.processNow) {
        await this.processBatchAdvanced(queueAssignment.queueKey, strategy, processingDecision);
      } else {
        // Dynamic timeout based on cost/latency optimization
        const dynamicTimeout = this.calculateDynamicTimeout(
          batchRequest,
          strategy,
          processingDecision
        );

        setTimeout(async () => {
          if (
            this.requestQueue.has(queueAssignment.queueKey) &&
            this.requestQueue.get(queueAssignment.queueKey)!.length > 0
          ) {
            await this.processBatchAdvanced(queueAssignment.queueKey, strategy, {
              processNow: true,
              reason: 'timeout_reached',
              optimization: 'time_based',
            });
          }
        }, dynamicTimeout);
      }

      // Update ML models with batching decision
      await this.updateBatchingModel(batchRequest, batchingDecision, queueAssignment);

      this.contextLogger.debug('Smart request queued for batching', {
        requestId: batchRequest.id,
        type: batchRequest.type,
        queueKey: queueAssignment.queueKey,
        queueSize: queue.length,
        strategy: strategy.name,
        mlConfidence: batchingDecision.confidence,
        predictedSavings: batchingDecision.predictedSavings,
        dynamicTimeout: processingDecision.processNow
          ? 0
          : this.calculateDynamicTimeout(batchRequest, strategy, processingDecision),
      });
    } catch (error) {
      logError(error as Error, {
        operation: 'submitRequest',
        requestId: batchRequest.id,
      });

      // Enhanced fallback with error analysis
      await this.processImmediateRequestAdvanced(batchRequest, 'error_fallback');
      await this.analyzeAndLearnFromError(error, batchRequest);
    }
  }

  /**
   * Intelligent batching decision using ML and predictive analytics
   */
  private async makeIntelligentBatchingDecision(request: BatchRequest): Promise<{
    shouldBatch: boolean;
    confidence: number;
    predictedSavings: number;
    reason: string;
    optimization: 'cost' | 'latency' | 'balanced';
  }> {
    const startTime = Date.now();

    // ML-based batching prediction
    const mlPrediction = await this.getMlBatchingPrediction(request);

    // Rule-based validation
    const ruleBasedDecision = this.getRuleBasedBatchingDecision(request);

    // Combine ML and rule-based decisions with weighted scoring
    const mlWeight = this.mlOptimizationEnabled ? 0.7 : 0;
    const ruleWeight = 1 - mlWeight;

    const combinedScore = mlPrediction.score * mlWeight + ruleBasedDecision.score * ruleWeight;
    const shouldBatch = combinedScore > 0.6; // Threshold for batching

    // Determine optimization strategy
    let optimization: 'cost' | 'latency' | 'balanced' = 'balanced';
    if (this.costPressure > 0.8) {
      optimization = 'cost';
    } else if (request.priority === 'high' || request.priority === 'critical') {
      optimization = 'latency';
    }

    // Calculate predicted savings
    const predictedSavings = shouldBatch
      ? this.calculatePredictedBatchSavings(request, mlPrediction, ruleBasedDecision)
      : 0;

    // Generate reason
    const reason = shouldBatch
      ? `ML: ${mlPrediction.confidence.toFixed(2)}, Rules: ${ruleBasedDecision.confidence.toFixed(2)}, Cost pressure: ${this.costPressure.toFixed(2)}`
      : ruleBasedDecision.reason;

    const decisionTime = Date.now() - startTime;

    this.contextLogger.debug('Intelligent batching decision', {
      requestId: request.id,
      shouldBatch,
      confidence: Math.max(mlPrediction.confidence, ruleBasedDecision.confidence),
      predictedSavings,
      optimization,
      decisionTime,
      mlScore: mlPrediction.score,
      ruleScore: ruleBasedDecision.score,
    });

    return {
      shouldBatch,
      confidence: Math.max(mlPrediction.confidence, ruleBasedDecision.confidence),
      predictedSavings,
      reason,
      optimization,
    };
  }

  /**
   * Machine Learning prediction for batching effectiveness
   */
  private async getMlBatchingPrediction(request: BatchRequest): Promise<{
    score: number;
    confidence: number;
    factors: Record<string, number>;
  }> {
    const requestTypeKey = `${request.type}_${request.chainId || 'any'}`;
    const model = this.batchPredictionModel.get(requestTypeKey);

    if (!model || Date.now() - model.lastTrained > 24 * 60 * 60 * 1000) {
      // Train or retrain model
      await this.trainBatchingModel(requestTypeKey);
    }

    // Feature extraction for ML prediction
    const features = {
      requestAge: Date.now() - request.timestamp,
      costPressure: this.costPressure,
      currentLoad: this.currentLoad,
      requestPriority: this.getPriorityScore(request.priority),
      timeOfDay: new Date().getHours(),
      dayOfWeek: new Date().getDay(),
      estimatedCost: request.estimatedCost,
      maxWaitTime: request.maxWaitTime,
      queueLength: this.getCurrentQueueLength(request.type),
      avgResponseTime: this.averageResponseTime.get(request.type) || 1000,
      recentBatchSuccessRate: this.getRecentBatchSuccessRate(request.type),
    };

    // Simple ML prediction (in production, use more sophisticated models)
    const score = this.calculateMlScore(features, model);
    const confidence = model ? model.accuracy : 0.5;

    return {
      score: Math.max(0, Math.min(1, score)),
      confidence,
      factors: features,
    };
  }

  /**
   * Enhanced batch processing with advanced optimization
   */
  private async processBatchAdvanced(
    queueKey: string,
    strategy: BatchingStrategy,
    processingDecision: any
  ): Promise<void> {
    const queue = this.requestQueue.get(queueKey);
    if (!queue || queue.length === 0) return;

    // Advanced batch size optimization
    const optimalBatchSize = await this.calculateOptimalBatchSize(
      queue,
      strategy,
      processingDecision
    );
    const requests = queue.splice(0, optimalBatchSize);

    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Enhanced cost calculation with dynamic optimization
    const costAnalysis = await this.calculateEnhancedBatchCost(requests, strategy);

    const batchGroup: BatchGroup = {
      id: batchId,
      type: strategy.name,
      chainId: requests[0].chainId,
      provider: 'auto-select', // Will be optimized by provider router
      requests,
      totalCost: costAnalysis.optimizedCost,
      estimatedSavings: costAnalysis.totalSavings,
      createdAt: Date.now(),
      maxWaitTime: Math.max(...requests.map(r => r.maxWaitTime)),
      status: 'queued',
    };

    this.activeBatches.set(batchId, batchGroup);

    try {
      await this.executeBatchAdvanced(batchGroup, strategy, costAnalysis);
    } catch (error) {
      logError(error as Error, { operation: 'processBatchAdvanced', batchId });

      // Advanced fallback with intelligent error handling
      await this.fallbackProcessingAdvanced(requests, error);

      batchGroup.status = 'failed';
      this.activeBatches.delete(batchId);

      // Learn from batch failure
      await this.learnFromBatchFailure(batchGroup, error, strategy);
    }
  }

  private shouldBatchRequest(request: BatchRequest): boolean {
    // Don't batch critical priority requests
    if (request.priority === 'critical') {
      return false;
    }

    // Don't batch if batching is disabled
    if (!this.enabled) {
      return false;
    }

    // Don't batch if max wait time is too short
    if (request.maxWaitTime < 100) {
      return false;
    }

    // Under high cost pressure, be more aggressive with batching
    if (this.costPressure > 0.8) {
      return request.priority !== 'high';
    }

    // Under high load, batch more aggressively
    if (this.currentLoad > 0.7) {
      return request.priority === 'low' || request.priority === 'normal';
    }

    return true;
  }

  private findBatchingStrategy(request: BatchRequest): BatchingStrategy | null {
    return this.batchingStrategies.find(strategy => strategy.condition(request)) || null;
  }

  private getQueueKey(request: BatchRequest, strategy: BatchingStrategy): string {
    // Create queue key based on request type, chain, and strategy
    const chainPart = request.chainId ? `_${request.chainId}` : '';
    return `${strategy.name}${chainPart}`;
  }

  private shouldProcessBatch(queue: BatchRequest[], strategy: BatchingStrategy): boolean {
    // Process if we've reached max batch size
    if (queue.length >= strategy.maxBatchSize) {
      return true;
    }

    // Process if we have minimum batch size and oldest request is near max wait time
    if (queue.length >= this.minBatchSize) {
      const oldestRequest = queue[0];
      const waitTime = Date.now() - oldestRequest.timestamp;
      const maxWaitTime = Math.min(oldestRequest.maxWaitTime, strategy.maxWaitTime);

      if (waitTime >= maxWaitTime * 0.8) {
        // 80% of max wait time
        return true;
      }
    }

    // Under cost pressure, batch smaller groups
    if (this.costPressure > 0.6 && queue.length >= Math.max(2, this.minBatchSize * 0.5)) {
      return true;
    }

    // Under high load, process smaller batches more frequently
    if (this.currentLoad > 0.8 && queue.length >= 2) {
      return true;
    }

    return false;
  }

  private async processBatch(queueKey: string, strategy: BatchingStrategy): Promise<void> {
    const queue = this.requestQueue.get(queueKey);
    if (!queue || queue.length === 0) return;

    // Remove requests from queue
    const requests = queue.splice(0, strategy.maxBatchSize);

    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const totalCost = requests.reduce((sum, req) => sum + req.estimatedCost, 0);
    const individualCost = totalCost; // Cost if processed individually
    const batchCost = totalCost * 0.3; // Assume 70% savings from batching
    const estimatedSavings = individualCost - batchCost;

    const batchGroup: BatchGroup = {
      id: batchId,
      type: strategy.name,
      chainId: requests[0].chainId,
      provider: 'auto-select', // Will be determined by provider router
      requests,
      totalCost: batchCost,
      estimatedSavings,
      createdAt: Date.now(),
      maxWaitTime: Math.max(...requests.map(r => r.maxWaitTime)),
      status: 'queued',
    };

    this.activeBatches.set(batchId, batchGroup);

    try {
      await this.executeBatch(batchGroup, strategy);
    } catch (error) {
      logError(error as Error, { operation: 'processBatch', batchId });

      // Fallback: process requests individually
      await this.fallbackProcessing(requests);

      batchGroup.status = 'failed';
      this.activeBatches.delete(batchId);
    }
  }

  private async executeBatch(batchGroup: BatchGroup, strategy: BatchingStrategy): Promise<void> {
    const startTime = Date.now();
    batchGroup.status = 'processing';

    try {
      // Consolidate requests using strategy logic
      const consolidatedRequest = strategy.consolidationLogic(batchGroup.requests);

      this.contextLogger.info('Executing batch', {
        batchId: batchGroup.id,
        requestCount: batchGroup.requests.length,
        strategy: strategy.name,
        estimatedSavings: batchGroup.estimatedSavings,
        consolidatedRequest,
      });

      // Execute the batch request (this would integrate with your provider router)
      const batchResponse = await this.executeBatchRequest(consolidatedRequest, batchGroup);

      // Distribute results back to individual request callbacks
      const results = strategy.responseDistribution(batchResponse, batchGroup.requests);

      let successCount = 0;
      for (const request of batchGroup.requests) {
        try {
          const result = results.get(request.id);
          if (result) {
            request.callback(result);
            successCount++;
          } else {
            request.callback(null, new Error(`No result found for request ${request.id}`));
          }
        } catch (error) {
          request.callback(null, error as Error);
        }
      }

      const processingTime = Date.now() - startTime;
      const actualWaitTime = startTime - Math.min(...batchGroup.requests.map(r => r.timestamp));

      // Update metrics
      this.updateBatchMetrics(batchGroup, processingTime, actualWaitTime, successCount);

      batchGroup.status = 'completed';

      this.emit('batchCompleted', {
        batchId: batchGroup.id,
        requestCount: batchGroup.requests.length,
        successCount,
        processingTime,
        waitTime: actualWaitTime,
        costSavings: batchGroup.estimatedSavings,
      });

      this.contextLogger.info('Batch completed successfully', {
        batchId: batchGroup.id,
        requestCount: batchGroup.requests.length,
        successCount,
        processingTime: `${processingTime}ms`,
        waitTime: `${actualWaitTime}ms`,
        costSavings: `$${batchGroup.estimatedSavings.toFixed(4)}`,
      });
    } catch (error) {
      logError(error as Error, { operation: 'executeBatch', batchId: batchGroup.id });
      throw error;
    } finally {
      this.activeBatches.delete(batchGroup.id);
    }
  }

  private async executeBatchRequest(
    consolidatedRequest: any,
    batchGroup: BatchGroup
  ): Promise<any> {
    // This would integrate with your actual provider router and API clients
    // For now, simulate batch execution

    const delay = Math.random() * 500 + 200; // 200-700ms simulated response time
    await new Promise(resolve => setTimeout(resolve, delay));

    // Simulate successful batch response
    return this.simulateBatchResponse(consolidatedRequest, batchGroup);
  }

  private simulateBatchResponse(request: any, batchGroup: BatchGroup): any {
    // Simulate different response types based on batch strategy
    switch (batchGroup.type) {
      case 'balance_multi':
        return {
          tokenBalances: batchGroup.requests.map(req => ({
            address: req.params.address,
            tokenBalances:
              req.params.contractAddresses?.map((addr: string) => ({
                contractAddress: addr,
                tokenBalance: '1000000000000000000', // 1.0 token
                error: null,
              })) || [],
          })),
        };

      case 'token_metadata':
        return batchGroup.requests.map(req => ({
          contractAddress: req.params.contractAddress,
          name: `Token ${req.params.contractAddress.slice(-4)}`,
          symbol: `TK${req.params.contractAddress.slice(-2)}`,
          decimals: 18,
          logo: null,
        }));

      case 'price_batch':
        const priceData: any = {};
        batchGroup.requests.forEach(req => {
          priceData[req.params.tokenAddress] = {
            usd: Math.random() * 1000 + 1, // Random price $1-$1000
            usd_24h_change: (Math.random() - 0.5) * 20, // -10% to +10%
          };
        });
        return priceData;

      default:
        return { success: true, data: [] };
    }
  }

  private async fallbackProcessing(requests: BatchRequest[]): Promise<void> {
    // Process each request individually as fallback
    for (const request of requests) {
      try {
        await this.processImmediateRequest(request);
      } catch (error) {
        request.callback(null, error as Error);
      }
    }
  }

  private async processImmediateRequest(request: BatchRequest): Promise<void> {
    // Process request immediately without batching
    try {
      // This would integrate with your actual API processing logic
      // For now, simulate immediate processing
      const delay = Math.random() * 200 + 50; // 50-250ms
      await new Promise(resolve => setTimeout(resolve, delay));

      const result = this.simulateIndividualResponse(request);
      request.callback(result);
    } catch (error) {
      request.callback(null, error as Error);
    }
  }

  private simulateIndividualResponse(request: BatchRequest): any {
    // Simulate individual request response
    switch (request.type) {
      case 'balance':
        return { balance: '1000000000000000000' }; // 1.0 token
      case 'token_metadata':
        return {
          name: `Individual Token ${request.params.contractAddress?.slice(-4)}`,
          symbol: 'ITK',
          decimals: 18,
        };
      case 'price':
        return { usd: Math.random() * 1000 + 1 };
      default:
        return { success: true };
    }
  }

  private updateBatchMetrics(
    batchGroup: BatchGroup,
    processingTime: number,
    waitTime: number,
    successCount: number
  ): void {
    this.metrics.batchedRequests += batchGroup.requests.length;
    this.metrics.batchingRate = (this.metrics.batchedRequests / this.metrics.totalRequests) * 100;

    const totalBatches = Object.keys(this.metrics.providerBreakdown).length + 1;
    this.metrics.averageBatchSize =
      (this.metrics.averageBatchSize * (totalBatches - 1) + batchGroup.requests.length) /
      totalBatches;

    this.metrics.totalCostSavings += batchGroup.estimatedSavings;

    this.metrics.averageWaitTime =
      (this.metrics.averageWaitTime * (totalBatches - 1) + waitTime) / totalBatches;

    const batchSuccessRate = successCount / batchGroup.requests.length;
    this.metrics.batchSuccessRate =
      (this.metrics.batchSuccessRate * (totalBatches - 1) + batchSuccessRate) / totalBatches;

    // Update provider-specific metrics
    if (!this.metrics.providerBreakdown[batchGroup.provider]) {
      this.metrics.providerBreakdown[batchGroup.provider] = {
        batches: 0,
        requests: 0,
        savings: 0,
      };
    }

    const providerMetrics = this.metrics.providerBreakdown[batchGroup.provider];
    providerMetrics.batches++;
    providerMetrics.requests += batchGroup.requests.length;
    providerMetrics.savings += batchGroup.estimatedSavings;
  }

  private startBatchProcessing(): void {
    // Process queued batches every 100ms
    setInterval(async () => {
      for (const [queueKey, queue] of this.requestQueue) {
        if (queue.length === 0) continue;

        // Find strategy for this queue
        const strategyName = queueKey.split('_')[0];
        const strategy = this.batchingStrategies.find(s => s.name === strategyName);

        if (!strategy) continue;

        // Check if any requests have exceeded their max wait time
        const now = Date.now();
        const expiredRequests = queue.filter(req => {
          const waitTime = now - req.timestamp;
          return waitTime >= Math.min(req.maxWaitTime, strategy.maxWaitTime);
        });

        if (expiredRequests.length > 0) {
          await this.processBatch(queueKey, strategy);
        }
      }
    }, 100);

    // Adaptive threshold adjustment every 30 seconds
    if (this.adaptiveThresholds) {
      setInterval(() => {
        this.adjustAdaptiveThresholds();
      }, 30000);
    }
  }

  private adjustAdaptiveThresholds(): void {
    // Adjust batching behavior based on current metrics and load

    // Update cost pressure based on budget utilization
    // This would integrate with your cost monitoring service
    this.costPressure = Math.min(1, Math.random() * 0.8); // Simulated for now

    // Update current load based on system metrics
    this.currentLoad = Math.min(1, this.activeBatches.size / this.maxConcurrentBatches);

    // Adjust strategies based on performance
    if (this.metrics.batchSuccessRate < 0.9 && this.metrics.totalRequests > 100) {
      // Reduce batch sizes if success rate is low
      this.batchingStrategies.forEach(strategy => {
        strategy.maxBatchSize = Math.max(2, Math.floor(strategy.maxBatchSize * 0.8));
      });

      this.contextLogger.info('Reduced batch sizes due to low success rate', {
        batchSuccessRate: this.metrics.batchSuccessRate,
      });
    }

    if (this.metrics.averageWaitTime > 2000) {
      // Reduce wait times if batching is causing too much delay
      this.batchingStrategies.forEach(strategy => {
        strategy.maxWaitTime = Math.max(100, Math.floor(strategy.maxWaitTime * 0.9));
      });

      this.contextLogger.info('Reduced wait times due to high latency', {
        averageWaitTime: this.metrics.averageWaitTime,
      });
    }
  }

  private startMetricsCollection(): void {
    // Emit metrics every 30 seconds
    setInterval(() => {
      this.emit('metricsUpdate', {
        timestamp: Date.now(),
        metrics: { ...this.metrics },
        activeQueues: Array.from(this.requestQueue.entries()).map(([key, queue]) => ({
          queueKey: key,
          queueSize: queue.length,
          oldestRequestAge: queue.length > 0 ? Date.now() - queue[0].timestamp : 0,
        })),
        activeBatches: Array.from(this.activeBatches.values()).map(batch => ({
          batchId: batch.id,
          type: batch.type,
          requestCount: batch.requests.length,
          status: batch.status,
          age: Date.now() - batch.createdAt,
        })),
      });
    }, 30000);

    // Reset daily metrics
    setInterval(
      () => {
        // Reset daily counters while preserving running averages
        this.metrics.totalRequests = 0;
        this.metrics.batchedRequests = 0;
        this.contextLogger.info('Daily metrics reset', {
          totalSavings: this.metrics.totalCostSavings,
        });
      },
      24 * 60 * 60 * 1000
    );
  }

  private loadConfiguration(): void {
    // Load configuration from Redis or config files
    // For now, using default configuration

    this.contextLogger.info('Batch processor initialized', {
      enabled: this.enabled,
      maxConcurrentBatches: this.maxConcurrentBatches,
      defaultMaxWaitTime: this.defaultMaxWaitTime,
      minBatchSize: this.minBatchSize,
      strategiesCount: this.batchingStrategies.length,
      adaptiveThresholds: this.adaptiveThresholds,
    });
  }

  // Public API methods

  /**
   * Get current batching metrics
   */
  getMetrics(): BatchingMetrics {
    return { ...this.metrics };
  }

  /**
   * Get batch optimization recommendations
   */
  getOptimizationRecommendations(): Array<{
    type: 'performance' | 'cost' | 'reliability';
    severity: 'low' | 'medium' | 'high';
    description: string;
    actionRequired: string;
    estimatedImpact: string;
  }> {
    const recommendations = [];

    // Low batching rate recommendation
    if (this.metrics.batchingRate < 20 && this.metrics.totalRequests > 100) {
      recommendations.push({
        type: 'cost' as const,
        severity: 'high' as const,
        description: `Batching rate is low (${this.metrics.batchingRate.toFixed(1)}%)`,
        actionRequired: 'Review request patterns and adjust batching strategies',
        estimatedImpact: 'Potential 30-50% cost reduction through improved batching',
      });
    }

    // High wait time recommendation
    if (this.metrics.averageWaitTime > 1500) {
      recommendations.push({
        type: 'performance' as const,
        severity: 'medium' as const,
        description: `Average wait time is high (${this.metrics.averageWaitTime}ms)`,
        actionRequired: 'Consider reducing batch wait times or processing smaller batches',
        estimatedImpact: 'Improved user experience and response times',
      });
    }

    // Low success rate recommendation
    if (this.metrics.batchSuccessRate < 0.95) {
      recommendations.push({
        type: 'reliability' as const,
        severity: 'high' as const,
        description: `Batch success rate is low (${(this.metrics.batchSuccessRate * 100).toFixed(1)}%)`,
        actionRequired: 'Review batch processing logic and provider reliability',
        estimatedImpact: 'Improved request success rates and reduced errors',
      });
    }

    return recommendations;
  }

  /**
   * Update batching configuration
   */
  updateConfiguration(
    config: Partial<{
      enabled: boolean;
      maxConcurrentBatches: number;
      defaultMaxWaitTime: number;
      minBatchSize: number;
      adaptiveThresholds: boolean;
    }>
  ): void {
    Object.assign(this, config);
    this.contextLogger.info('Configuration updated', config);
    this.emit('configurationUpdated', config);
  }

  /**
   * Get smart queue assignment for a request
   */
  private async getSmartQueueAssignment(
    request: BatchRequest,
    strategy: BatchingStrategy,
    batchingDecision: any
  ): Promise<{
    queueKey: string;
    priority: number;
    routingScore: number;
  }> {
    const baseQueueKey = this.getQueueKey(request, strategy);

    // Calculate routing score based on various factors
    const routingScore =
      batchingDecision.confidence * 0.4 +
      (1 - this.currentLoad) * 0.3 +
      (request.priority === 'high' ? 0.2 : request.priority === 'critical' ? 0.3 : 0.1) * 0.3;

    return {
      queueKey: baseQueueKey,
      priority: this.getPriorityScore(request.priority),
      routingScore,
    };
  }

  /**
   * Determine if batch should be processed intelligently
   */
  private async shouldProcessBatchIntelligent(
    queue: BatchRequest[],
    strategy: BatchingStrategy,
    queueAssignment: any,
    batchingDecision: any
  ): Promise<{
    processNow: boolean;
    reason: string;
    optimization: string;
    confidence: number;
  }> {
    const queueLength = queue.length;
    const oldestRequest = queue[0];
    const waitTime = Date.now() - oldestRequest.timestamp;
    const maxWaitTime = Math.min(oldestRequest.maxWaitTime, strategy.maxWaitTime);

    // ML-based processing decision
    const mlScore = this.calculateMlScore({
      queueLength,
      waitTime,
      maxWaitTime,
      costPressure: this.costPressure,
      currentLoad: this.currentLoad,
      batchingConfidence: batchingDecision.confidence,
    });

    let processNow = false;
    let reason = 'waiting_for_optimization';
    let optimization = 'balanced';

    // Critical decision factors
    if (queueLength >= strategy.maxBatchSize) {
      processNow = true;
      reason = 'max_batch_size_reached';
    } else if (waitTime >= maxWaitTime * 0.9) {
      processNow = true;
      reason = 'timeout_approaching';
      optimization = 'latency';
    } else if (this.costPressure > 0.8 && queueLength >= 2) {
      processNow = true;
      reason = 'cost_pressure_high';
      optimization = 'cost';
    } else if (mlScore > 0.8 && queueLength >= this.minBatchSize) {
      processNow = true;
      reason = 'ml_optimization_trigger';
    }

    return {
      processNow,
      reason,
      optimization,
      confidence: mlScore,
    };
  }

  /**
   * Process request immediately with advanced handling
   */
  private async processImmediateRequestAdvanced(
    request: BatchRequest,
    reason: string
  ): Promise<void> {
    const startTime = Date.now();

    try {
      this.contextLogger.debug('Processing immediate request', {
        requestId: request.id,
        reason,
        priority: request.priority,
        estimatedCost: request.estimatedCost,
      });

      // Use existing immediate processing logic
      await this.processImmediateRequest(request);

      const processingTime = Date.now() - startTime;

      // Update metrics for immediate processing
      this.updateImmediateProcessingMetrics(request, processingTime, reason);
    } catch (error) {
      logError(error as Error, {
        operation: 'processImmediateRequestAdvanced',
        requestId: request.id,
        reason,
      });
      request.callback(null, error as Error);
    }
  }

  /**
   * Analyze and learn from processing errors
   */
  private async analyzeAndLearnFromError(error: unknown, request: BatchRequest): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorType = this.categorizeError(errorMessage);

    // Store error pattern for learning
    const errorPattern = {
      timestamp: Date.now(),
      requestType: request.type,
      chainId: request.chainId,
      priority: request.priority,
      errorType,
      errorMessage,
      estimatedCost: request.estimatedCost,
      currentLoad: this.currentLoad,
      costPressure: this.costPressure,
    };

    // Update error patterns in memory for ML
    await this.storeErrorPattern(errorPattern);

    this.contextLogger.warn('Error pattern analyzed', {
      requestId: request.id,
      errorType,
      learning: true,
    });
  }

  /**
   * Get rule-based batching decision
   */
  private getRuleBasedBatchingDecision(request: BatchRequest): {
    score: number;
    confidence: number;
    reason: string;
  } {
    let score = 0.5;
    let confidence = 0.8;
    let reason = 'default';

    // Priority-based scoring
    if (request.priority === 'critical') {
      score = 0.1;
      reason = 'critical_priority';
    } else if (request.priority === 'high') {
      score = 0.3;
      reason = 'high_priority';
    } else if (request.priority === 'low') {
      score = 0.9;
      reason = 'low_priority_batchable';
    }

    // Cost-based adjustments
    if (this.costPressure > 0.7) {
      score += 0.2;
      reason += '_cost_pressure';
    }

    // Load-based adjustments
    if (this.currentLoad > 0.8) {
      score += 0.15;
      reason += '_high_load';
    }

    // Wait time considerations
    if (request.maxWaitTime < 200) {
      score -= 0.3;
      reason += '_time_sensitive';
    }

    return {
      score: Math.max(0, Math.min(1, score)),
      confidence,
      reason,
    };
  }

  /**
   * Calculate predicted batch savings
   */
  private calculatePredictedBatchSavings(
    request: BatchRequest,
    mlPrediction: any,
    ruleBasedDecision: any
  ): number {
    const baseCost = request.estimatedCost;
    const batchingEfficiency = (mlPrediction.score + ruleBasedDecision.score) / 2;

    // Calculate savings based on request type and efficiency
    let savingsMultiplier = 0.3; // 30% base savings

    switch (request.type) {
      case 'balance':
        savingsMultiplier = 0.6; // Balance queries benefit most from batching
        break;
      case 'price':
        savingsMultiplier = 0.5;
        break;
      case 'token_metadata':
        savingsMultiplier = 0.4;
        break;
      case 'transaction':
        savingsMultiplier = 0.25;
        break;
    }

    const predictedSavings = baseCost * savingsMultiplier * batchingEfficiency;

    return Math.max(0, predictedSavings);
  }

  /**
   * Train ML batching model
   */
  private async trainBatchingModel(requestTypeKey: string): Promise<void> {
    // Simple neural network training simulation
    // In production, this would use actual ML libraries

    const trainingData = await this.getTrainingData(requestTypeKey);
    const weights = this.initializeWeights();

    // Simple gradient descent simulation
    for (let epoch = 0; epoch < 10; epoch++) {
      for (const sample of trainingData) {
        const prediction = this.calculateMlScore(sample.features, {
          weights,
          accuracy: 0.5,
          lastTrained: Date.now(),
          sampleCount: trainingData.length,
        });
        const error = sample.actualOutcome - prediction;

        // Update weights (simplified)
        for (let i = 0; i < weights.length; i++) {
          weights[i] +=
            0.01 *
            error *
            (sample.features as any)[
              Object.keys(sample.features)[i % Object.keys(sample.features).length]
            ];
        }
      }
    }

    // Calculate accuracy on validation set
    const accuracy = this.calculateModelAccuracy(weights, trainingData);

    // Store updated model
    this.batchPredictionModel.set(requestTypeKey, {
      weights,
      accuracy,
      lastTrained: Date.now(),
      sampleCount: trainingData.length,
    });

    this.contextLogger.info('ML model trained', {
      requestTypeKey,
      accuracy,
      sampleCount: trainingData.length,
    });
  }

  /**
   * Get priority score from priority string
   */
  private getPriorityScore(priority: string): number {
    switch (priority) {
      case 'critical':
        return 4;
      case 'high':
        return 3;
      case 'normal':
        return 2;
      case 'low':
        return 1;
      default:
        return 2;
    }
  }

  /**
   * Get current queue length for a request type
   */
  private getCurrentQueueLength(requestType: string): number {
    let totalLength = 0;
    for (const [queueKey, queue] of this.requestQueue) {
      if (queueKey.includes(requestType)) {
        totalLength += queue.length;
      }
    }
    return totalLength;
  }

  /**
   * Get recent batch success rate for request type
   */
  private getRecentBatchSuccessRate(requestType: string): number {
    // In production, this would query recent batch history
    // For now, return a baseline success rate adjusted by current metrics
    const baseSuccessRate = this.metrics.batchSuccessRate || 0.9;

    // Adjust based on current load and cost pressure
    const loadAdjustment = this.currentLoad > 0.8 ? -0.1 : 0;
    const costAdjustment = this.costPressure > 0.8 ? -0.05 : 0;

    return Math.max(0.5, Math.min(1, baseSuccessRate + loadAdjustment + costAdjustment));
  }

  /**
   * Calculate ML score using features and model
   */
  private calculateMlScore(features: any, model?: any): number {
    if (!model || !model.weights) {
      // Fallback calculation without trained model
      const { costPressure = 0, currentLoad = 0, requestPriority = 2, queueLength = 0 } = features;

      // Simple heuristic scoring
      let score = 0.5;
      score += costPressure * 0.3;
      score += (1 - currentLoad) * 0.2;
      score -= (requestPriority - 2) * 0.1;
      score += Math.min(queueLength / 10, 0.2);

      return Math.max(0, Math.min(1, score));
    }

    // Use trained model weights for prediction
    const featureValues = Object.values(features) as number[];
    let score = 0;

    for (let i = 0; i < Math.min(featureValues.length, model.weights.length); i++) {
      score += featureValues[i] * model.weights[i];
    }

    // Apply sigmoid activation
    return 1 / (1 + Math.exp(-score));
  }

  /**
   * Calculate optimal batch size
   */
  private async calculateOptimalBatchSize(
    queue: BatchRequest[],
    strategy: BatchingStrategy,
    processingDecision: any
  ): Promise<number> {
    const maxBatchSize = strategy.maxBatchSize;
    const queueLength = queue.length;

    let optimalSize = Math.min(queueLength, maxBatchSize);

    // Adjust based on optimization strategy
    if (processingDecision.optimization === 'latency') {
      // Prefer smaller batches for lower latency
      optimalSize = Math.min(optimalSize, Math.ceil(maxBatchSize * 0.6));
    } else if (processingDecision.optimization === 'cost') {
      // Prefer larger batches for cost savings
      optimalSize = Math.max(this.minBatchSize, optimalSize);
    }

    // Adjust based on current load
    if (this.currentLoad > 0.8) {
      optimalSize = Math.max(2, Math.ceil(optimalSize * 0.7));
    }

    // Ensure minimum batch size
    return Math.max(this.minBatchSize, Math.min(maxBatchSize, optimalSize));
  }

  /**
   * Calculate enhanced batch cost with optimization
   */
  private async calculateEnhancedBatchCost(
    requests: BatchRequest[],
    strategy: BatchingStrategy
  ): Promise<{
    originalCost: number;
    optimizedCost: number;
    totalSavings: number;
    efficiencyScore: number;
  }> {
    const originalCost = requests.reduce((sum, req) => sum + req.estimatedCost, 0);

    // Calculate batch efficiency based on strategy and current conditions
    let efficiencyScore = 0.7; // Base efficiency

    // Strategy-specific efficiency
    switch (strategy.name) {
      case 'balance_multi':
        efficiencyScore = 0.8;
        break;
      case 'price_batch':
        efficiencyScore = 0.75;
        break;
      case 'token_metadata':
        efficiencyScore = 0.65;
        break;
      default:
        efficiencyScore = 0.6;
    }

    // Adjust for batch size (larger batches are more efficient)
    const batchSizeMultiplier = Math.min(
      1.2,
      0.8 + (requests.length / strategy.maxBatchSize) * 0.4
    );
    efficiencyScore *= batchSizeMultiplier;

    // Adjust for system load (higher load reduces efficiency)
    const loadPenalty = this.currentLoad * 0.2;
    efficiencyScore = Math.max(0.4, efficiencyScore - loadPenalty);

    const optimizedCost = originalCost * (1 - efficiencyScore);
    const totalSavings = originalCost - optimizedCost;

    return {
      originalCost,
      optimizedCost,
      totalSavings,
      efficiencyScore,
    };
  }

  /**
   * Execute batch with advanced processing
   */
  private async executeBatchAdvanced(
    batchGroup: BatchGroup,
    strategy: BatchingStrategy,
    costAnalysis: any
  ): Promise<void> {
    const startTime = Date.now();
    batchGroup.status = 'processing';

    try {
      // Enhanced consolidation with optimization
      const consolidatedRequest = this.createAdvancedConsolidatedRequest(batchGroup, strategy);

      this.contextLogger.info('Executing advanced batch', {
        batchId: batchGroup.id,
        requestCount: batchGroup.requests.length,
        strategy: strategy.name,
        estimatedSavings: batchGroup.estimatedSavings,
        efficiencyScore: costAnalysis.efficiencyScore,
        consolidatedRequest,
      });

      // Execute with provider optimization
      const batchResponse = await this.executeOptimizedBatchRequest(
        consolidatedRequest,
        batchGroup
      );

      // Advanced result distribution
      const results = await this.distributeAdvancedResults(batchResponse, batchGroup, strategy);

      let successCount = 0;
      for (const request of batchGroup.requests) {
        try {
          const result = results.get(request.id);
          if (result && !result.error) {
            request.callback(result.data);
            successCount++;
          } else {
            request.callback(
              null,
              result?.error || new Error(`No result found for request ${request.id}`)
            );
          }
        } catch (error) {
          request.callback(null, error as Error);
        }
      }

      const processingTime = Date.now() - startTime;
      const actualWaitTime = startTime - Math.min(...batchGroup.requests.map(r => r.timestamp));

      // Enhanced metrics update
      this.updateAdvancedBatchMetrics(
        batchGroup,
        processingTime,
        actualWaitTime,
        successCount,
        costAnalysis
      );

      batchGroup.status = 'completed';

      this.emit('batchCompleted', {
        batchId: batchGroup.id,
        requestCount: batchGroup.requests.length,
        successCount,
        processingTime,
        waitTime: actualWaitTime,
        costSavings: batchGroup.estimatedSavings,
        efficiencyScore: costAnalysis.efficiencyScore,
      });

      this.contextLogger.info('Advanced batch completed successfully', {
        batchId: batchGroup.id,
        requestCount: batchGroup.requests.length,
        successCount,
        processingTime: `${processingTime}ms`,
        waitTime: `${actualWaitTime}ms`,
        costSavings: `$${batchGroup.estimatedSavings.toFixed(4)}`,
        efficiencyScore: costAnalysis.efficiencyScore.toFixed(3),
      });
    } catch (error) {
      logError(error as Error, { operation: 'executeBatchAdvanced', batchId: batchGroup.id });
      throw error;
    } finally {
      this.activeBatches.delete(batchGroup.id);
    }
  }

  /**
   * Advanced fallback processing with error handling
   */
  private async fallbackProcessingAdvanced(
    requests: BatchRequest[],
    error: unknown
  ): Promise<void> {
    const errorType = this.categorizeError(error instanceof Error ? error.message : String(error));

    this.contextLogger.warn('Advanced fallback processing initiated', {
      requestCount: requests.length,
      errorType,
      fallbackStrategy: 'individual_processing',
    });

    // Process each request individually with enhanced error handling
    const promises = requests.map(async (request, index) => {
      try {
        // Add exponential backoff delay for retries
        const delay = Math.min(1000, 100 * Math.pow(2, index % 4));
        await new Promise(resolve => setTimeout(resolve, delay));

        await this.processImmediateRequestAdvanced(request, `fallback_${errorType}`);
      } catch (fallbackError) {
        logError(fallbackError as Error, {
          operation: 'fallbackProcessingAdvanced',
          requestId: request.id,
        });
        request.callback(null, fallbackError as Error);
      }
    });

    await Promise.allSettled(promises);

    // Learn from fallback patterns
    await this.learnFromFallbackPattern(requests, error, errorType);
  }

  /**
   * Learn from batch failure for future optimization
   */
  private async learnFromBatchFailure(
    batchGroup: BatchGroup,
    error: unknown,
    strategy: BatchingStrategy
  ): Promise<void> {
    const failurePattern = {
      timestamp: Date.now(),
      batchId: batchGroup.id,
      strategyName: strategy.name,
      requestCount: batchGroup.requests.length,
      errorType: this.categorizeError(error instanceof Error ? error.message : String(error)),
      batchSize: batchGroup.requests.length,
      totalCost: batchGroup.totalCost,
      currentLoad: this.currentLoad,
      costPressure: this.costPressure,
      chainId: batchGroup.chainId,
    };

    // Store failure pattern for ML learning
    await this.storeFailurePattern(failurePattern);

    // Adjust strategy parameters based on failure
    if (failurePattern.errorType === 'timeout' || failurePattern.errorType === 'overload') {
      // Reduce batch sizes for this strategy temporarily
      strategy.maxBatchSize = Math.max(2, Math.floor(strategy.maxBatchSize * 0.8));
      strategy.maxWaitTime = Math.max(100, Math.floor(strategy.maxWaitTime * 0.9));

      this.contextLogger.warn('Strategy parameters adjusted after failure', {
        strategy: strategy.name,
        newMaxBatchSize: strategy.maxBatchSize,
        newMaxWaitTime: strategy.maxWaitTime,
      });
    }
  }

  /**
   * Find optimal batching strategy with ML enhancement
   */
  private async findOptimalBatchingStrategy(
    request: BatchRequest,
    batchingDecision: any
  ): Promise<BatchingStrategy | null> {
    // First find matching strategies
    const matchingStrategies = this.batchingStrategies.filter(strategy =>
      strategy.condition(request)
    );

    if (matchingStrategies.length === 0) {
      return null;
    }

    if (matchingStrategies.length === 1) {
      return matchingStrategies[0];
    }

    // Multiple strategies available - choose optimal one
    let bestStrategy = matchingStrategies[0];
    let bestScore = 0;

    for (const strategy of matchingStrategies) {
      const score = await this.calculateStrategyScore(strategy, request, batchingDecision);
      if (score > bestScore) {
        bestScore = score;
        bestStrategy = strategy;
      }
    }

    return bestStrategy;
  }

  /**
   * Calculate dynamic timeout based on optimization goals
   */
  private calculateDynamicTimeout(
    request: BatchRequest,
    strategy: BatchingStrategy,
    processingDecision: any
  ): number {
    let baseTimeout = strategy.maxWaitTime;

    // Adjust based on optimization strategy
    if (processingDecision.optimization === 'latency') {
      baseTimeout *= 0.6; // Reduce timeout for latency optimization
    } else if (processingDecision.optimization === 'cost') {
      baseTimeout *= 1.2; // Increase timeout for cost optimization
    }

    // Adjust based on request priority
    switch (request.priority) {
      case 'critical':
        baseTimeout *= 0.3;
        break;
      case 'high':
        baseTimeout *= 0.6;
        break;
      case 'low':
        baseTimeout *= 1.5;
        break;
    }

    // Adjust based on system load
    if (this.currentLoad > 0.8) {
      baseTimeout *= 0.7; // Process faster under high load
    }

    // Adjust based on cost pressure
    if (this.costPressure > 0.8) {
      baseTimeout *= 1.3; // Wait longer for better batching under cost pressure
    }

    // Ensure within reasonable bounds
    return Math.max(50, Math.min(request.maxWaitTime, baseTimeout));
  }

  /**
   * Update batching model with new data
   */
  private async updateBatchingModel(
    request: BatchRequest,
    batchingDecision: any,
    queueAssignment: any
  ): Promise<void> {
    const requestTypeKey = `${request.type}_${request.chainId || 'any'}`;

    // Create training sample from this decision
    const trainingSample = {
      features: {
        requestAge: Date.now() - request.timestamp,
        costPressure: this.costPressure,
        currentLoad: this.currentLoad,
        requestPriority: this.getPriorityScore(request.priority),
        timeOfDay: new Date().getHours(),
        dayOfWeek: new Date().getDay(),
        estimatedCost: request.estimatedCost,
        maxWaitTime: request.maxWaitTime,
        queueLength: this.getCurrentQueueLength(request.type),
      },
      decision: batchingDecision.shouldBatch ? 1 : 0,
      confidence: batchingDecision.confidence,
      timestamp: Date.now(),
    };

    // Store training sample for later model updates
    await this.storeTrainingSample(requestTypeKey, trainingSample);

    // Update model if we have enough samples
    const model = this.batchPredictionModel.get(requestTypeKey);
    if (!model || Date.now() - model.lastTrained > 60000) {
      // Update every minute
      // Trigger model update in background
      setImmediate(() => this.trainBatchingModel(requestTypeKey));
    }
  }

  /**
   * Helper methods for advanced processing
   */
  private categorizeError(errorMessage: string): string {
    if (errorMessage.includes('timeout') || errorMessage.includes('TIMEOUT')) {
      return 'timeout';
    } else if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
      return 'rate_limit';
    } else if (errorMessage.includes('network') || errorMessage.includes('connection')) {
      return 'network';
    } else if (errorMessage.includes('overload') || errorMessage.includes('busy')) {
      return 'overload';
    } else if (errorMessage.includes('auth') || errorMessage.includes('401')) {
      return 'authentication';
    } else {
      return 'unknown';
    }
  }

  private async storeErrorPattern(errorPattern: any): Promise<void> {
    // Store error pattern in memory for ML analysis
    try {
      const key = `error_patterns:${errorPattern.requestType}:${errorPattern.errorType}`;
      await redisManager.set(key, errorPattern, 86400); // 24 hours
    } catch (error) {
      this.contextLogger.warn('Failed to store error pattern', { error: (error as Error).message });
    }
  }

  private async storeFailurePattern(failurePattern: any): Promise<void> {
    try {
      const key = `failure_patterns:${failurePattern.strategyName}:${failurePattern.errorType}`;
      await redisManager.set(key, failurePattern, 86400); // 24 hours
    } catch (error) {
      this.contextLogger.warn('Failed to store failure pattern', {
        error: (error as Error).message,
      });
    }
  }

  private async storeTrainingSample(requestTypeKey: string, sample: any): Promise<void> {
    try {
      const key = `training_samples:${requestTypeKey}`;
      const existingSamples = await redisManager.get<any[]>(key);
      const samples = existingSamples || [];

      samples.push(sample);

      // Keep only last 1000 samples to prevent memory bloat
      if (samples.length > 1000) {
        samples.shift();
      }

      await redisManager.set(key, samples, 86400);
    } catch (error) {
      this.contextLogger.warn('Failed to store training sample', {
        error: (error as Error).message,
      });
    }
  }

  private async getTrainingData(requestTypeKey: string): Promise<any[]> {
    try {
      const key = `training_samples:${requestTypeKey}`;
      const samplesData = await redisManager.get<any[]>(key);
      return samplesData || this.generateSyntheticTrainingData(requestTypeKey);
    } catch (error) {
      this.contextLogger.warn('Failed to get training data', { error: (error as Error).message });
      return this.generateSyntheticTrainingData(requestTypeKey);
    }
  }

  private generateSyntheticTrainingData(requestTypeKey: string): any[] {
    // Generate synthetic training data for initial model training
    const samples = [];

    for (let i = 0; i < 100; i++) {
      const features = {
        requestAge: Math.random() * 5000,
        costPressure: Math.random(),
        currentLoad: Math.random(),
        requestPriority: Math.floor(Math.random() * 4) + 1,
        timeOfDay: Math.floor(Math.random() * 24),
        dayOfWeek: Math.floor(Math.random() * 7),
        estimatedCost: Math.random() * 0.01,
        maxWaitTime: Math.random() * 3000 + 100,
        queueLength: Math.floor(Math.random() * 20),
      };

      // Simple rule-based outcome for synthetic data
      const shouldBatch =
        features.costPressure > 0.5 && features.requestPriority <= 2 && features.maxWaitTime > 500;

      samples.push({
        features,
        actualOutcome: shouldBatch ? 1 : 0,
      });
    }

    return samples;
  }

  private initializeWeights(): number[] {
    // Initialize random weights for simple neural network
    const weightCount = 9; // Number of features
    return Array.from({ length: weightCount }, () => (Math.random() - 0.5) * 2);
  }

  private calculateModelAccuracy(weights: number[], testData: any[]): number {
    let correct = 0;

    for (const sample of testData) {
      const prediction = this.calculateMlScore(sample.features, {
        weights,
        accuracy: 0.5,
        lastTrained: Date.now(),
        sampleCount: testData.length,
      });
      const predictedOutcome = prediction > 0.5 ? 1 : 0;

      if (predictedOutcome === sample.actualOutcome) {
        correct++;
      }
    }

    return testData.length > 0 ? correct / testData.length : 0.5;
  }

  private updateImmediateProcessingMetrics(
    request: BatchRequest,
    processingTime: number,
    reason: string
  ): void {
    // Update metrics for immediate processing
    this.contextLogger.debug('Immediate processing completed', {
      requestId: request.id,
      processingTime,
      reason,
      type: request.type,
    });
  }

  private createAdvancedConsolidatedRequest(
    batchGroup: BatchGroup,
    strategy: BatchingStrategy
  ): any {
    // Enhanced consolidation with optimization
    const baseRequest = strategy.consolidationLogic(batchGroup.requests);

    // Add optimization parameters
    return {
      ...baseRequest,
      optimization: {
        batchId: batchGroup.id,
        totalCost: batchGroup.totalCost,
        expectedSavings: batchGroup.estimatedSavings,
        priority: Math.max(...batchGroup.requests.map(r => this.getPriorityScore(r.priority))),
        timeout: batchGroup.maxWaitTime,
      },
    };
  }

  private async executeOptimizedBatchRequest(
    consolidatedRequest: any,
    batchGroup: BatchGroup
  ): Promise<any> {
    // Enhanced batch request execution with provider optimization
    const delay = Math.random() * 400 + 150; // 150-550ms simulated response time
    await new Promise(resolve => setTimeout(resolve, delay));

    // Simulate optimized batch response with better success rates
    return this.simulateOptimizedBatchResponse(consolidatedRequest, batchGroup);
  }

  private simulateOptimizedBatchResponse(request: any, batchGroup: BatchGroup): any {
    // Enhanced simulation with better error handling
    const baseResponse = this.simulateBatchResponse(request, batchGroup);

    // Add optimization metadata
    return {
      ...baseResponse,
      optimization: {
        batchId: batchGroup.id,
        actualCost: batchGroup.totalCost * 0.95, // Slight optimization
        processingTime: Date.now(),
        successRate: 0.98, // High success rate for optimized processing
      },
    };
  }

  private async distributeAdvancedResults(
    batchResponse: any,
    batchGroup: BatchGroup,
    strategy: BatchingStrategy
  ): Promise<Map<string, { data: any; error?: Error }>> {
    // Enhanced result distribution with error handling
    const results = new Map<string, { data: any; error?: Error }>();

    try {
      const baseResults = strategy.responseDistribution(batchResponse, batchGroup.requests);

      // Convert to enhanced format
      for (const [requestId, data] of baseResults) {
        results.set(requestId, { data });
      }

      // Handle any requests that didn't get results
      for (const request of batchGroup.requests) {
        if (!results.has(request.id)) {
          results.set(request.id, {
            data: null,
            error: new Error(`No result found for request ${request.id}`),
          });
        }
      }
    } catch (error) {
      // Fallback: create error results for all requests
      for (const request of batchGroup.requests) {
        results.set(request.id, {
          data: null,
          error: error as Error,
        });
      }
    }

    return results;
  }

  private updateAdvancedBatchMetrics(
    batchGroup: BatchGroup,
    processingTime: number,
    waitTime: number,
    successCount: number,
    costAnalysis: any
  ): void {
    // Enhanced metrics update with additional tracking
    this.updateBatchMetrics(batchGroup, processingTime, waitTime, successCount);

    // Update advanced metrics
    this.realTimeSavings += costAnalysis.totalSavings;

    const efficiencyTrend = costAnalysis.efficiencyScore;
    this.costEfficiencyTrend = this.costEfficiencyTrend * 0.9 + efficiencyTrend * 0.1;

    // Store optimization history
    const historyKey = batchGroup.type;
    if (!this.batchOptimizationHistory.has(historyKey)) {
      this.batchOptimizationHistory.set(historyKey, []);
    }

    const history = this.batchOptimizationHistory.get(historyKey)!;
    history.push({
      timestamp: Date.now(),
      batchSize: batchGroup.requests.length,
      actualSavings: costAnalysis.totalSavings,
      latencyImpact: waitTime,
    });

    // Keep only last 100 entries
    if (history.length > 100) {
      history.shift();
    }
  }

  private async learnFromFallbackPattern(
    requests: BatchRequest[],
    error: unknown,
    errorType: string
  ): Promise<void> {
    const pattern = {
      timestamp: Date.now(),
      requestCount: requests.length,
      requestTypes: [...new Set(requests.map(r => r.type))],
      errorType,
      avgWaitTime:
        requests.length > 0
          ? (Date.now() - Math.min(...requests.map(r => r.timestamp))) / requests.length
          : 0,
      currentLoad: this.currentLoad,
      costPressure: this.costPressure,
    };

    await this.storeErrorPattern(pattern);

    this.contextLogger.info('Fallback pattern learned', {
      errorType,
      requestCount: requests.length,
      learning: true,
    });
  }

  private async calculateStrategyScore(
    strategy: BatchingStrategy,
    request: BatchRequest,
    batchingDecision: any
  ): Promise<number> {
    let score = 0.5;

    // Base score from strategy efficiency
    score += strategy.costSavingsThreshold / 100; // Convert percentage to decimal

    // Adjust for current queue length
    const queueLength = this.getCurrentQueueLength(request.type);
    score += Math.min(0.2, (queueLength / strategy.maxBatchSize) * 0.2);

    // Adjust for wait time compatibility
    const waitTimeCompatibility =
      Math.min(request.maxWaitTime, strategy.maxWaitTime) / strategy.maxWaitTime;
    score += waitTimeCompatibility * 0.2;

    // Adjust for ML confidence
    score += batchingDecision.confidence * 0.1;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Force process all queued requests
   */
  async flushQueues(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [queueKey, queue] of this.requestQueue) {
      if (queue.length === 0) continue;

      const strategyName = queueKey.split('_')[0];
      const strategy = this.batchingStrategies.find(s => s.name === strategyName);

      if (strategy) {
        promises.push(this.processBatch(queueKey, strategy));
      }
    }

    await Promise.allSettled(promises);
    this.contextLogger.info('All queues flushed');
  }
}

// Export singleton instance
let batchProcessorInstance: RequestBatchProcessor | null = null;

export const getBatchProcessor = (): RequestBatchProcessor => {
  if (!batchProcessorInstance) {
    batchProcessorInstance = new RequestBatchProcessor();
  }
  return batchProcessorInstance;
};

export default getBatchProcessor;
