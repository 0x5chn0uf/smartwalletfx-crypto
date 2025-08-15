import { EventEmitter } from 'events';
import { logger, logError, createContextualLogger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { config } from '@/config';
import { ChainId } from '@/types/blockchain';

/**
 * Intelligent Provider Router
 *
 * Routes API requests to optimal providers based on:
 * - Cost efficiency
 * - Performance metrics
 * - Reliability scores
 * - Current load and quotas
 * - Request type optimization
 */

export interface ProviderMetrics {
  providerId: string;
  cost: {
    perRequest: number;
    perComputeUnit: number;
    monthlySpend: number;
    efficiency: number; // Cost per successful request
  };
  performance: {
    averageResponseTime: number;
    p95ResponseTime: number;
    throughput: number; // requests per second
    errorRate: number;
  };
  reliability: {
    uptime: number; // percentage
    successRate: number;
    consecutiveFailures: number;
    lastFailureTime?: number;
  };
  quotas: {
    requestsPerSecond: number;
    requestsPerDay: number;
    currentUsage: {
      secondly: number;
      daily: number;
    };
  };
  features: {
    supportedChains: ChainId[];
    supportedMethods: string[];
    batchingSupported: boolean;
    websocketSupported: boolean;
  };
}

export interface RouteRequest {
  method: string;
  chainId?: ChainId;
  priority: 'low' | 'normal' | 'high' | 'critical';
  dataType: 'balance' | 'transaction' | 'price' | 'metadata' | 'defi' | 'nft';
  batchable?: boolean;
  maxCost?: number;
  maxLatency?: number;
  requiresFreshData?: boolean;
}

export interface RouteResult {
  providerId: string;
  estimatedCost: number;
  estimatedLatency: number;
  confidence: number; // 0-1 scale
  reasoning: string[];
  fallbacks: string[];
}

interface ProviderConfig {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  costModel: {
    baseRate: number;
    perRequestCost: number;
    computeUnitCost: number;
    premiumMultiplier?: number;
  };
  limits: {
    requestsPerSecond: number;
    requestsPerDay: number;
    maxBatchSize?: number;
  };
  capabilities: {
    chains: ChainId[];
    methods: string[];
    features: ('batching' | 'websocket' | 'historical' | 'realtime')[];
  };
  reliability: {
    slaUptime: number;
    expectedErrorRate: number;
  };
}

class ProviderHealthMonitor {
  private healthChecks = new Map<
    string,
    {
      lastCheck: number;
      status: 'healthy' | 'degraded' | 'unhealthy';
      responseTime: number;
      errorCount: number;
    }
  >();

  private contextLogger = createContextualLogger({ component: 'ProviderHealthMonitor' });

  async checkProviderHealth(
    providerId: string,
    config: ProviderConfig
  ): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    responseTime: number;
    details: Record<string, any>;
  }> {
    const startTime = Date.now();

    try {
      // Perform lightweight health check (e.g., chain ID request)
      const healthResult = await this.performHealthCheck(providerId, config);
      const responseTime = Date.now() - startTime;

      // Determine health status
      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      if (responseTime > 2000 || healthResult.errorRate > 0.05) {
        status = 'degraded';
      }
      if (responseTime > 5000 || healthResult.errorRate > 0.15 || !healthResult.success) {
        status = 'unhealthy';
      }

      // Update health cache
      this.healthChecks.set(providerId, {
        lastCheck: Date.now(),
        status,
        responseTime,
        errorCount: healthResult.errorRate * 100,
      });

      return {
        status,
        responseTime,
        details: healthResult,
      };
    } catch (error) {
      this.contextLogger.error(`Health check failed for provider ${providerId}`, error);

      this.healthChecks.set(providerId, {
        lastCheck: Date.now(),
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        errorCount: 100,
      });

      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        details: { error: error.message },
      };
    }
  }

  private async performHealthCheck(
    providerId: string,
    config: ProviderConfig
  ): Promise<{
    success: boolean;
    errorRate: number;
    [key: string]: any;
  }> {
    // Implementation would depend on provider-specific health endpoints
    // For now, return mock data based on provider configuration
    return {
      success: Math.random() > 0.05, // 95% success rate
      errorRate: Math.random() * 0.1, // 0-10% error rate
      timestamp: Date.now(),
    };
  }

  getProviderHealth(providerId: string) {
    return this.healthChecks.get(providerId);
  }

  isHealthy(providerId: string, maxAge = 300000): boolean {
    // 5 minutes max age
    const health = this.healthChecks.get(providerId);
    if (!health) return false;

    const age = Date.now() - health.lastCheck;
    if (age > maxAge) return false;

    return health.status === 'healthy';
  }
}

export class IntelligentProviderRouter extends EventEmitter {
  private providers = new Map<string, ProviderConfig>();
  private metrics = new Map<string, ProviderMetrics>();
  private healthMonitor = new ProviderHealthMonitor();
  private contextLogger = createContextualLogger({ component: 'IntelligentProviderRouter' });

  // Circuit breaker state
  private circuitBreakers = new Map<
    string,
    {
      failures: number;
      lastFailure: number;
      state: 'closed' | 'open' | 'half-open';
    }
  >();

  // Load balancing state
  private requestCounts = new Map<string, number>();
  private lastRotation = 0;

  constructor() {
    super();
    this.initializeProviders();
    this.startMetricsCollection();
    this.startHealthMonitoring();
  }

  private initializeProviders() {
    const providerConfigs: ProviderConfig[] = [
      {
        id: 'alchemy',
        name: 'Alchemy',
        apiKey: config.apiKeys.alchemy!,
        baseUrl: 'https://eth-mainnet.g.alchemy.com/v2',
        costModel: {
          baseRate: 0.02,
          perRequestCost: 0.005,
          computeUnitCost: 0.000001,
        },
        limits: {
          requestsPerSecond: 25,
          requestsPerDay: 100000,
          maxBatchSize: 100,
        },
        capabilities: {
          chains: [1, 137, 42161, 10, 8453],
          methods: ['balance', 'transaction', 'token', 'nft', 'defi'],
          features: ['batching', 'websocket', 'historical', 'realtime'],
        },
        reliability: {
          slaUptime: 99.9,
          expectedErrorRate: 0.01,
        },
      },
      {
        id: 'moralis',
        name: 'Moralis',
        apiKey: config.apiKeys.moralis!,
        baseUrl: 'https://deep-index.moralis.io/api/v2',
        costModel: {
          baseRate: 0.015,
          perRequestCost: 0.004,
          computeUnitCost: 0.0000008,
        },
        limits: {
          requestsPerSecond: 15,
          requestsPerDay: 75000,
          maxBatchSize: 50,
        },
        capabilities: {
          chains: [1, 137, 56, 43114, 250],
          methods: ['balance', 'transaction', 'token', 'nft'],
          features: ['historical', 'realtime'],
        },
        reliability: {
          slaUptime: 99.5,
          expectedErrorRate: 0.02,
        },
      },
      {
        id: 'quicknode',
        name: 'QuickNode',
        apiKey: config.apiKeys.quicknode!,
        baseUrl: 'https://api.quicknode.com',
        costModel: {
          baseRate: 0.025,
          perRequestCost: 0.006,
          computeUnitCost: 0.000001,
        },
        limits: {
          requestsPerSecond: 30,
          requestsPerDay: 120000,
          maxBatchSize: 200,
        },
        capabilities: {
          chains: [1, 137, 42161, 10, 8453, 56],
          methods: ['balance', 'transaction', 'token', 'defi'],
          features: ['batching', 'websocket', 'historical'],
        },
        reliability: {
          slaUptime: 99.95,
          expectedErrorRate: 0.005,
        },
      },
    ].filter(config => config.apiKey); // Only include providers with API keys

    providerConfigs.forEach(config => {
      this.providers.set(config.id, config);
      this.initializeProviderMetrics(config.id);
    });

    this.contextLogger.info('Provider router initialized', {
      providerCount: this.providers.size,
      providers: Array.from(this.providers.keys()),
    });
  }

  private initializeProviderMetrics(providerId: string) {
    const config = this.providers.get(providerId)!;

    this.metrics.set(providerId, {
      providerId,
      cost: {
        perRequest: config.costModel.perRequestCost,
        perComputeUnit: config.costModel.computeUnitCost,
        monthlySpend: 0,
        efficiency: config.costModel.perRequestCost,
      },
      performance: {
        averageResponseTime: 500, // Default estimate
        p95ResponseTime: 1000,
        throughput: config.limits.requestsPerSecond * 0.8, // Conservative estimate
        errorRate: config.reliability.expectedErrorRate,
      },
      reliability: {
        uptime: config.reliability.slaUptime / 100,
        successRate: 1 - config.reliability.expectedErrorRate,
        consecutiveFailures: 0,
      },
      quotas: {
        requestsPerSecond: config.limits.requestsPerSecond,
        requestsPerDay: config.limits.requestsPerDay,
        currentUsage: {
          secondly: 0,
          daily: 0,
        },
      },
      features: {
        supportedChains: config.capabilities.chains,
        supportedMethods: config.capabilities.methods,
        batchingSupported: config.capabilities.features.includes('batching'),
        websocketSupported: config.capabilities.features.includes('websocket'),
      },
    });

    // Initialize circuit breaker
    this.circuitBreakers.set(providerId, {
      failures: 0,
      lastFailure: 0,
      state: 'closed',
    });
  }

  /**
   * Route a request to the optimal provider with advanced optimization
   */
  async route(request: RouteRequest): Promise<RouteResult> {
    const startTime = Date.now();

    try {
      // Get eligible providers with advanced filtering
      const eligibleProviders = await this.getEligibleProvidersAdvanced(request);

      if (eligibleProviders.length === 0) {
        // Try emergency fallback providers with relaxed constraints
        const emergencyProviders = await this.getEmergencyFallbackProviders(request);
        if (emergencyProviders.length === 0) {
          throw new Error(`No available providers for request: ${JSON.stringify(request)}`);
        }
        this.contextLogger.warn('Using emergency fallback providers', { request });
        return this.routeWithEmergencyProviders(emergencyProviders, request);
      }

      // Advanced scoring with ML-based cost prediction
      const scoredProviders = await this.scoreProvidersAdvanced(eligibleProviders, request);

      // Multi-objective optimization: cost, latency, reliability
      const optimizedSelection = this.optimizeProviderSelection(scoredProviders, request);

      const result: RouteResult = {
        providerId: optimizedSelection.primary.providerId,
        estimatedCost: optimizedSelection.primary.estimatedCost,
        estimatedLatency: optimizedSelection.primary.estimatedLatency,
        confidence: optimizedSelection.primary.confidence,
        reasoning: [
          ...optimizedSelection.primary.reasoning,
          `Cost optimization: ${optimizedSelection.costSavings.toFixed(2)}%`,
          `Latency optimization: ${optimizedSelection.latencyOptimization.toFixed(1)}ms saved`,
        ],
        fallbacks: optimizedSelection.fallbacks.map(p => p.providerId),
      };

      // Advanced usage tracking with predictive analytics
      await this.updateUsageTrackingAdvanced(
        optimizedSelection.primary.providerId,
        request,
        result
      );

      // Learn from routing decisions for future optimization
      await this.recordRoutingDecision(request, result, scoredProviders);

      this.contextLogger.debug('Advanced route completed', {
        request: request,
        selectedProvider: result.providerId,
        estimatedCost: result.estimatedCost,
        estimatedLatency: result.estimatedLatency,
        confidence: result.confidence,
        costSavings: optimizedSelection.costSavings,
        fallbackCount: result.fallbacks.length,
        routingTime: Date.now() - startTime,
      });

      this.emit('routeCompleted', {
        request,
        result,
        optimizations: optimizedSelection,
        routingTime: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      logError(error as Error, { operation: 'route', request });
      throw error;
    }
  }

  /**
   * Advanced provider eligibility with dynamic constraints
   */
  private async getEligibleProvidersAdvanced(request: RouteRequest): Promise<string[]> {
    const eligible: string[] = [];
    const currentTime = Date.now();

    for (const [providerId, metrics] of this.metrics) {
      const config = this.providers.get(providerId)!;
      const circuitBreaker = this.circuitBreakers.get(providerId)!;
      const healthStatus = this.healthMonitor.getProviderHealth(providerId);

      // Advanced circuit breaker with adaptive recovery
      if (circuitBreaker.state === 'open') {
        const timeSinceLastFailure = currentTime - circuitBreaker.lastFailure;
        const recoveryTime = this.calculateAdaptiveRecoveryTime(
          providerId,
          circuitBreaker.failures
        );

        if (timeSinceLastFailure < recoveryTime) {
          continue;
        } else {
          circuitBreaker.state = 'half-open';
          this.contextLogger.info(`Circuit breaker transitioning to half-open`, { providerId });
        }
      }

      // Dynamic health checking with weighted scoring
      if (healthStatus) {
        const healthAge = currentTime - healthStatus.lastCheck;
        if (healthAge > 300000) {
          // 5 minutes stale
          await this.healthMonitor.checkProviderHealth(providerId, config);
        }

        // Exclude unhealthy providers unless critical priority
        if (healthStatus.status === 'unhealthy' && request.priority !== 'critical') {
          continue;
        }
      }

      // Enhanced capability matching
      if (!this.isCapabilityMatch(request, metrics, config)) {
        continue;
      }

      // Dynamic quota management with burst allowance
      const quotaStatus = this.getAdvancedQuotaStatus(providerId, request.priority);
      if (!quotaStatus.available) {
        continue;
      }

      // Cost constraints with priority adjustments
      const adjustedMaxCost = this.adjustCostConstraint(request.maxCost, request.priority, metrics);
      if (adjustedMaxCost && metrics.cost.perRequest > adjustedMaxCost) {
        continue;
      }

      // Predictive performance filtering
      const predictedLatency = await this.predictRequestLatency(providerId, request);
      if (request.maxLatency && predictedLatency > request.maxLatency * 1.2) {
        // 20% buffer
        continue;
      }

      eligible.push(providerId);
    }

    return eligible;
  }

  /**
   * Emergency fallback when no providers meet normal criteria
   */
  private async getEmergencyFallbackProviders(request: RouteRequest): Promise<string[]> {
    const fallbacks: string[] = [];

    for (const [providerId, metrics] of this.metrics) {
      const circuitBreaker = this.circuitBreakers.get(providerId)!;

      // Allow degraded providers in emergency
      if (circuitBreaker.state !== 'open' || circuitBreaker.failures < 10) {
        // Basic capability check only
        if (metrics.features.supportedMethods.includes(request.dataType)) {
          if (!request.chainId || metrics.features.supportedChains.includes(request.chainId)) {
            fallbacks.push(providerId);
          }
        }
      }
    }

    return fallbacks;
  }

  /**
   * Advanced provider scoring with ML-based predictions
   */
  private async scoreProvidersAdvanced(
    providerIds: string[],
    request: RouteRequest
  ): Promise<
    Array<{
      providerId: string;
      score: number;
      estimatedCost: number;
      estimatedLatency: number;
      confidence: number;
      reasoning: string[];
      mlPredictions: {
        costAccuracy: number;
        latencyAccuracy: number;
        reliabilityScore: number;
      };
    }>
  > {
    const scoredProviders = [];

    for (const providerId of providerIds) {
      const metrics = this.metrics.get(providerId)!;
      const config = this.providers.get(providerId)!;

      let score = 0;
      let confidence = 0.8;
      const reasoning: string[] = [];

      // Enhanced cost scoring with predictive modeling
      const costAnalysis = await this.calculateAdvancedCostScore(metrics, request, providerId);
      score += costAnalysis.score * 0.35; // Increased weight for cost optimization
      reasoning.push(
        `Cost: ${costAnalysis.score.toFixed(2)}/10 (${costAnalysis.prediction}% saving)`
      );

      // Performance scoring with latency prediction
      const performanceAnalysis = await this.calculateAdvancedPerformanceScore(
        metrics,
        request,
        providerId
      );
      score += performanceAnalysis.score * 0.3;
      reasoning.push(
        `Performance: ${performanceAnalysis.score.toFixed(2)}/10 (${performanceAnalysis.predictedLatency}ms)`
      );

      // Reliability scoring with historical patterns
      const reliabilityAnalysis = await this.calculateAdvancedReliabilityScore(metrics, providerId);
      score += reliabilityAnalysis.score * 0.25;
      reasoning.push(
        `Reliability: ${reliabilityAnalysis.score.toFixed(2)}/10 (${reliabilityAnalysis.uptime}% uptime)`
      );

      // Smart load balancing with predictive distribution
      const loadAnalysis = this.calculateSmartLoadScore(providerId, request);
      score += loadAnalysis.score * 0.1;
      reasoning.push(
        `Load: ${loadAnalysis.score.toFixed(2)}/10 (${loadAnalysis.utilization}% util)`
      );

      // ML-based predictions for accuracy
      const mlPredictions = await this.getMlPredictions(providerId, request);
      confidence *= mlPredictions.overallAccuracy;

      // Priority-based adjustments with intelligent weighting
      const priorityAdjustments = this.calculatePriorityAdjustments(
        request,
        metrics,
        reliabilityAnalysis
      );
      score += priorityAdjustments.bonus;
      if (priorityAdjustments.reasoning.length > 0) {
        reasoning.push(...priorityAdjustments.reasoning);
      }

      // Calculate enhanced estimates
      const estimatedCost = await this.calculatePredictiveCost(metrics, request, mlPredictions);
      const estimatedLatency = await this.calculatePredictiveLatency(
        metrics,
        request,
        mlPredictions
      );

      scoredProviders.push({
        providerId,
        score: Math.min(10, Math.max(0, score)),
        estimatedCost,
        estimatedLatency,
        confidence,
        reasoning,
        mlPredictions,
      });
    }

    return scoredProviders.sort((a, b) => {
      // Multi-criteria sorting: score first, then confidence, then cost
      if (Math.abs(a.score - b.score) > 0.5) {
        return b.score - a.score;
      }
      if (Math.abs(a.confidence - b.confidence) > 0.1) {
        return b.confidence - a.confidence;
      }
      return a.estimatedCost - b.estimatedCost;
    });
  }

  /**
   * Multi-objective optimization for provider selection
   */
  private optimizeProviderSelection(
    scoredProviders: any[],
    request: RouteRequest
  ): {
    primary: any;
    fallbacks: any[];
    costSavings: number;
    latencyOptimization: number;
    optimizationStrategy: string;
  } {
    const primary = scoredProviders[0];
    const fallbacks = scoredProviders.slice(1, 4);

    // Calculate optimization metrics
    const baselineCost = Math.max(...scoredProviders.map(p => p.estimatedCost));
    const costSavings = ((baselineCost - primary.estimatedCost) / baselineCost) * 100;

    const baselineLatency = Math.max(...scoredProviders.map(p => p.estimatedLatency));
    const latencyOptimization = baselineLatency - primary.estimatedLatency;

    // Determine optimization strategy
    let strategy = 'balanced';
    if (request.priority === 'critical') {
      strategy = 'reliability-first';
    } else if (request.maxCost && request.maxCost < primary.estimatedCost * 1.5) {
      strategy = 'cost-optimized';
    } else if (request.maxLatency && request.maxLatency < 1000) {
      strategy = 'latency-optimized';
    }

    return {
      primary,
      fallbacks,
      costSavings,
      latencyOptimization,
      optimizationStrategy: strategy,
    };
  }

  private getEligibleProviders(request: RouteRequest): string[] {
    const eligible: string[] = [];

    for (const [providerId, metrics] of this.metrics) {
      const config = this.providers.get(providerId)!;
      const circuitBreaker = this.circuitBreakers.get(providerId)!;

      // Check circuit breaker
      if (circuitBreaker.state === 'open') {
        const timeSinceLastFailure = Date.now() - circuitBreaker.lastFailure;
        if (timeSinceLastFailure < 30000) {
          // 30 second timeout
          continue;
        } else {
          // Move to half-open state
          circuitBreaker.state = 'half-open';
        }
      }

      // Check chain support
      if (request.chainId && !metrics.features.supportedChains.includes(request.chainId)) {
        continue;
      }

      // Check method support
      if (!metrics.features.supportedMethods.includes(request.dataType)) {
        continue;
      }

      // Check quota availability
      if (metrics.quotas.currentUsage.secondly >= metrics.quotas.requestsPerSecond * 0.9) {
        continue;
      }

      // Check cost constraints
      if (request.maxCost && metrics.cost.perRequest > request.maxCost) {
        continue;
      }

      // Check health
      if (!this.healthMonitor.isHealthy(providerId)) {
        continue;
      }

      eligible.push(providerId);
    }

    return eligible;
  }

  private async scoreProviders(
    providerIds: string[],
    request: RouteRequest
  ): Promise<
    Array<{
      providerId: string;
      score: number;
      estimatedCost: number;
      estimatedLatency: number;
      confidence: number;
      reasoning: string[];
    }>
  > {
    const scoredProviders = [];

    for (const providerId of providerIds) {
      const metrics = this.metrics.get(providerId)!;
      const config = this.providers.get(providerId)!;

      let score = 0;
      let confidence = 0.8; // Base confidence
      const reasoning: string[] = [];

      // Cost scoring (40% weight)
      const costScore = this.calculateCostScore(metrics, request);
      score += costScore * 0.4;
      reasoning.push(`Cost efficiency: ${costScore.toFixed(2)}/10`);

      // Performance scoring (30% weight)
      const performanceScore = this.calculatePerformanceScore(metrics, request);
      score += performanceScore * 0.3;
      reasoning.push(`Performance: ${performanceScore.toFixed(2)}/10`);

      // Reliability scoring (20% weight)
      const reliabilityScore = this.calculateReliabilityScore(metrics);
      score += reliabilityScore * 0.2;
      reasoning.push(`Reliability: ${reliabilityScore.toFixed(2)}/10`);

      // Load balancing adjustment (10% weight)
      const loadScore = this.calculateLoadScore(providerId);
      score += loadScore * 0.1;
      reasoning.push(`Load balance: ${loadScore.toFixed(2)}/10`);

      // Priority adjustments
      if (request.priority === 'critical') {
        if (reliabilityScore > 8.0) {
          score += 1.0;
          reasoning.push('Critical priority reliability bonus');
        }
      } else if (request.priority === 'low') {
        if (costScore > 8.0) {
          score += 0.5;
          reasoning.push('Low priority cost optimization bonus');
        }
      }

      // Calculate estimates
      const estimatedCost = this.estimateRequestCost(metrics, request);
      const estimatedLatency = this.estimateRequestLatency(metrics, request);

      // Adjust confidence based on historical accuracy
      const historicalAccuracy = await this.getHistoricalAccuracy(providerId);
      confidence *= historicalAccuracy;

      scoredProviders.push({
        providerId,
        score: Math.min(10, Math.max(0, score)),
        estimatedCost,
        estimatedLatency,
        confidence,
        reasoning,
      });
    }

    return scoredProviders.sort((a, b) => b.score - a.score);
  }

  /**
   * Advanced cost scoring with predictive modeling and ML insights
   */
  private async calculateAdvancedCostScore(
    metrics: ProviderMetrics,
    request: RouteRequest,
    providerId: string
  ): Promise<{
    score: number;
    prediction: number;
    factors: Record<string, number>;
    reasoning: string[];
  }> {
    let score = 10;
    const factors: Record<string, number> = {};
    const reasoning: string[] = [];

    // Enhanced base cost analysis with market rates
    const marketRate = await this.getMarketAverageRate(request.dataType);
    const costEfficiencyRatio = marketRate > 0 ? metrics.cost.perRequest / marketRate : 1;
    factors.costEfficiency = costEfficiencyRatio;

    if (costEfficiencyRatio > 1.5) {
      score -= 4;
      reasoning.push('Above market rate');
    } else if (costEfficiencyRatio > 1.2) {
      score -= 2;
      reasoning.push('Slightly above market');
    } else if (costEfficiencyRatio < 0.8) {
      score += 2;
      reasoning.push('Below market rate');
    }

    // Predictive cost modeling based on request patterns
    const costTrend = await this.analyzeCostTrend(providerId, request.dataType, 7); // 7 days
    factors.costTrend = costTrend;

    if (costTrend > 0.15) {
      // 15% increase trend
      score -= 2;
      reasoning.push('Rising cost trend');
    } else if (costTrend < -0.1) {
      // 10% decrease trend
      score += 1;
      reasoning.push('Declining cost trend');
    }

    // Volume-based cost optimization
    const volumeDiscount = this.calculateVolumeDiscount(
      providerId,
      metrics.quotas.currentUsage.daily
    );
    factors.volumeDiscount = volumeDiscount;

    if (volumeDiscount > 0.2) {
      score += 1.5;
      reasoning.push('Volume discount available');
    }

    // Budget pressure adjustment
    const budgetPressure = metrics.cost.monthlySpend / config.costs.monthlyBudget;
    factors.budgetPressure = budgetPressure;

    if (budgetPressure > 0.9) {
      score -= 3;
      reasoning.push('Critical budget pressure');
    } else if (budgetPressure > 0.75) {
      score -= 1.5;
      reasoning.push('High budget utilization');
    } else if (budgetPressure < 0.5) {
      score += 0.5;
      reasoning.push('Low budget utilization');
    }

    // Batch processing cost efficiency
    if (request.batchable && metrics.features.batchingSupported) {
      const batchEfficiency = await this.getBatchCostEfficiency(providerId, request.dataType);
      factors.batchEfficiency = batchEfficiency;

      if (batchEfficiency > 0.4) {
        // 40%+ savings
        score += 2;
        reasoning.push('Excellent batch savings');
      } else if (batchEfficiency > 0.2) {
        score += 1;
        reasoning.push('Good batch efficiency');
      }
    }

    // Time-based cost optimization (off-peak pricing)
    const timeOptimization = this.getTimeBasedCostMultiplier();
    factors.timeOptimization = timeOptimization;

    if (timeOptimization < 0.9) {
      score += 1;
      reasoning.push('Off-peak pricing');
    }

    const finalScore = Math.max(0, Math.min(10, score));
    const savingsPrediction = ((10 - finalScore) / 10) * 50; // Convert to percentage

    return {
      score: finalScore,
      prediction: Math.max(0, savingsPrediction),
      factors,
      reasoning,
    };
  }

  /**
   * Advanced performance scoring with predictive latency modeling
   */
  private async calculateAdvancedPerformanceScore(
    metrics: ProviderMetrics,
    request: RouteRequest,
    providerId: string
  ): Promise<{
    score: number;
    predictedLatency: number;
    factors: Record<string, number>;
    reasoning: string[];
  }> {
    let score = 10;
    const factors: Record<string, number> = {};
    const reasoning: string[] = [];

    // ML-based latency prediction
    const predictedLatency = await this.predictRequestLatency(providerId, request);
    factors.predictedLatency = predictedLatency;

    // Performance scoring based on predicted latency
    if (predictedLatency > 2000) {
      score -= 4;
      reasoning.push('High predicted latency');
    } else if (predictedLatency > 1000) {
      score -= 2;
      reasoning.push('Moderate predicted latency');
    } else if (predictedLatency < 500) {
      score += 1;
      reasoning.push('Low predicted latency');
    }

    // Geographic optimization
    const geoLatencyBonus = await this.calculateGeographicLatencyBonus(providerId);
    factors.geoOptimization = geoLatencyBonus;

    if (geoLatencyBonus > 0.2) {
      score += 1.5;
      reasoning.push('Geographic optimization');
    }

    // Network congestion analysis
    const congestionFactor = await this.getNetworkCongestionFactor(providerId);
    factors.networkCongestion = congestionFactor;

    if (congestionFactor > 1.5) {
      score -= 2;
      reasoning.push('Network congestion detected');
    } else if (congestionFactor < 0.8) {
      score += 1;
      reasoning.push('Low network congestion');
    }

    // Cache optimization potential
    const cacheOptimization = await this.getCacheOptimizationPotential(
      providerId,
      request.dataType
    );
    factors.cacheOptimization = cacheOptimization;

    if (cacheOptimization > 0.7) {
      score += 1.5;
      reasoning.push('High cache optimization');
    }

    return {
      score: Math.max(0, Math.min(10, score)),
      predictedLatency,
      factors,
      reasoning,
    };
  }

  /**
   * Advanced reliability scoring with pattern recognition
   */
  private async calculateAdvancedReliabilityScore(
    metrics: ProviderMetrics,
    providerId: string
  ): Promise<{
    score: number;
    uptime: number;
    factors: Record<string, number>;
    reasoning: string[];
  }> {
    let score = 10;
    const factors: Record<string, number> = {};
    const reasoning: string[] = [];

    // Recent reliability analysis
    const recentUptime = await this.calculateRecentUptime(providerId, 24 * 60 * 60 * 1000); // 24h
    factors.recentUptime = recentUptime;

    if (recentUptime < 0.95) {
      score -= 5;
      reasoning.push('Poor recent uptime');
    } else if (recentUptime < 0.98) {
      score -= 2;
      reasoning.push('Below target uptime');
    } else if (recentUptime > 0.999) {
      score += 1.5;
      reasoning.push('Excellent uptime');
    }

    // Error pattern analysis
    const errorPatterns = await this.analyzeErrorPatterns(providerId);
    factors.errorStability = errorPatterns.stability;

    if (errorPatterns.hasPatterns) {
      score -= 2;
      reasoning.push('Recurring error patterns');
    } else if (errorPatterns.stability > 0.95) {
      score += 1;
      reasoning.push('Stable error profile');
    }

    // Recovery time analysis
    const avgRecoveryTime = await this.getAverageRecoveryTime(providerId);
    factors.recoveryTime = avgRecoveryTime;

    if (avgRecoveryTime > 300000) {
      // 5 minutes
      score -= 1.5;
      reasoning.push('Slow failure recovery');
    } else if (avgRecoveryTime < 60000) {
      // 1 minute
      score += 1;
      reasoning.push('Fast failure recovery');
    }

    return {
      score: Math.max(0, Math.min(10, score)),
      uptime: recentUptime,
      factors,
      reasoning,
    };
  }

  private calculatePerformanceScore(metrics: ProviderMetrics, request: RouteRequest): number {
    let score = 10;

    // Response time scoring
    if (metrics.performance.averageResponseTime > 1000) score -= 3;
    else if (metrics.performance.averageResponseTime > 500) score -= 2;
    else if (metrics.performance.averageResponseTime < 200) score += 1;

    // P95 response time
    if (metrics.performance.p95ResponseTime > 2000) score -= 2;
    else if (metrics.performance.p95ResponseTime < 800) score += 1;

    // Error rate impact
    if (metrics.performance.errorRate > 0.05) score -= 3;
    else if (metrics.performance.errorRate > 0.02) score -= 1;
    else if (metrics.performance.errorRate < 0.01) score += 1;

    // Latency requirement check
    if (request.maxLatency) {
      if (metrics.performance.averageResponseTime > request.maxLatency) {
        score -= 5; // Heavy penalty for exceeding requirements
      }
    }

    return Math.max(0, Math.min(10, score));
  }

  private calculateReliabilityScore(metrics: ProviderMetrics): number {
    let score = 10;

    // Uptime scoring
    if (metrics.reliability.uptime < 0.99) score -= 4;
    else if (metrics.reliability.uptime < 0.995) score -= 2;
    else if (metrics.reliability.uptime > 0.999) score += 1;

    // Success rate
    if (metrics.reliability.successRate < 0.95) score -= 3;
    else if (metrics.reliability.successRate < 0.98) score -= 1;
    else if (metrics.reliability.successRate > 0.995) score += 1;

    // Recent failures
    if (metrics.reliability.consecutiveFailures > 3) score -= 3;
    else if (metrics.reliability.consecutiveFailures > 1) score -= 1;

    return Math.max(0, Math.min(10, score));
  }

  private calculateLoadScore(providerId: string): number {
    const currentRequests = this.requestCounts.get(providerId) || 0;
    const metrics = this.metrics.get(providerId)!;

    const utilizationRate = currentRequests / metrics.quotas.requestsPerSecond;

    if (utilizationRate > 0.9) return 2;
    if (utilizationRate > 0.7) return 5;
    if (utilizationRate > 0.5) return 7;
    return 10;
  }

  private estimateRequestCost(metrics: ProviderMetrics, request: RouteRequest): number {
    let cost = metrics.cost.perRequest;

    // Adjust for request complexity
    if (request.dataType === 'defi' || request.dataType === 'nft') {
      cost *= 1.5; // More complex requests
    }

    // Batch discount
    if (request.batchable && metrics.features.batchingSupported) {
      cost *= 0.7; // 30% discount for batching
    }

    return cost;
  }

  private estimateRequestLatency(metrics: ProviderMetrics, request: RouteRequest): number {
    let latency = metrics.performance.averageResponseTime;

    // Adjust for request complexity
    if (request.dataType === 'defi' || request.dataType === 'transaction') {
      latency *= 1.3;
    }

    // Priority adjustment
    if (request.priority === 'critical') {
      latency *= 0.9; // Assume faster processing for critical requests
    }

    return latency;
  }

  private async getHistoricalAccuracy(providerId: string): Promise<number> {
    try {
      const accuracyKey = `${config.redis.keyPrefix}provider_accuracy:${providerId}`;
      const accuracy = await redisManager.get<number>(accuracyKey);
      return accuracy || 0.8; // Default 80% accuracy
    } catch (error) {
      return 0.8;
    }
  }

  private async updateUsageTracking(providerId: string, request: RouteRequest): Promise<void> {
    try {
      // Update request counts
      const currentCount = this.requestCounts.get(providerId) || 0;
      this.requestCounts.set(providerId, currentCount + 1);

      // Update quota usage in metrics
      const metrics = this.metrics.get(providerId);
      if (metrics) {
        metrics.quotas.currentUsage.secondly += 1;
        metrics.quotas.currentUsage.daily += 1;
      }

      // Store in Redis for persistence
      const usageKey = `${config.redis.keyPrefix}provider_usage:${providerId}:${Date.now()}`;
      await redisManager.set(usageKey, { request, timestamp: Date.now() }, 3600); // 1 hour TTL
    } catch (error) {
      logError(error as Error, { operation: 'updateUsageTracking', providerId });
    }
  }

  /**
   * Record the result of a provider request for learning
   */
  async recordRequestResult(
    providerId: string,
    result: {
      success: boolean;
      responseTime: number;
      cost?: number;
      error?: string;
    }
  ): Promise<void> {
    try {
      const metrics = this.metrics.get(providerId);
      const circuitBreaker = this.circuitBreakers.get(providerId);

      if (!metrics || !circuitBreaker) return;

      // Update performance metrics
      metrics.performance.averageResponseTime =
        metrics.performance.averageResponseTime * 0.9 + result.responseTime * 0.1;

      if (result.success) {
        // Reset consecutive failures
        metrics.reliability.consecutiveFailures = 0;
        circuitBreaker.failures = 0;

        // Update success rate
        metrics.reliability.successRate = Math.min(
          1.0,
          metrics.reliability.successRate * 0.99 + 0.01
        );

        // Close circuit breaker if it was half-open
        if (circuitBreaker.state === 'half-open') {
          circuitBreaker.state = 'closed';
        }
      } else {
        // Update failure metrics
        metrics.reliability.consecutiveFailures += 1;
        circuitBreaker.failures += 1;
        circuitBreaker.lastFailure = Date.now();

        // Update error rate
        metrics.performance.errorRate = Math.min(1.0, metrics.performance.errorRate * 0.95 + 0.05);

        // Trip circuit breaker if too many failures
        if (circuitBreaker.failures >= 5) {
          circuitBreaker.state = 'open';
          this.contextLogger.warn(`Circuit breaker opened for provider ${providerId}`, {
            consecutiveFailures: circuitBreaker.failures,
            lastError: result.error,
          });
        }
      }

      // Update cost efficiency if cost provided
      if (result.cost !== undefined) {
        metrics.cost.efficiency = result.success ? result.cost : result.cost * 1.5;
        metrics.cost.monthlySpend += result.cost;
      }

      this.emit('requestResultRecorded', {
        providerId,
        result,
        updatedMetrics: metrics,
      });
    } catch (error) {
      logError(error as Error, { operation: 'recordRequestResult', providerId });
    }
  }

  /**
   * Get provider recommendations for optimization
   */
  async getOptimizationRecommendations(): Promise<
    Array<{
      type: 'cost' | 'performance' | 'reliability';
      providerId?: string;
      severity: 'low' | 'medium' | 'high';
      description: string;
      actionRequired: string;
      estimatedImpact: string;
    }>
  > {
    const recommendations = [];

    for (const [providerId, metrics] of this.metrics) {
      // Cost optimization recommendations
      if (metrics.cost.efficiency > 0.008) {
        recommendations.push({
          type: 'cost' as const,
          providerId,
          severity: 'high' as const,
          description: `Provider ${providerId} has high cost per request ($${metrics.cost.efficiency.toFixed(4)})`,
          actionRequired: 'Consider reducing usage or switching to lower-cost alternatives',
          estimatedImpact: `Potential 30-50% cost reduction on ${providerId} requests`,
        });
      }

      // Performance recommendations
      if (metrics.performance.averageResponseTime > 1000) {
        recommendations.push({
          type: 'performance' as const,
          providerId,
          severity: metrics.performance.averageResponseTime > 2000 ? 'high' : 'medium',
          description: `Provider ${providerId} has slow response times (${metrics.performance.averageResponseTime}ms avg)`,
          actionRequired: 'Consider switching to faster providers for latency-sensitive requests',
          estimatedImpact: `Potential 40-60% latency improvement`,
        });
      }

      // Reliability recommendations
      if (metrics.reliability.successRate < 0.95) {
        recommendations.push({
          type: 'reliability' as const,
          providerId,
          severity: metrics.reliability.successRate < 0.9 ? 'high' : 'medium',
          description: `Provider ${providerId} has low success rate (${(metrics.reliability.successRate * 100).toFixed(1)}%)`,
          actionRequired: 'Implement additional fallback providers or reduce usage',
          estimatedImpact: `Improved request success rate and user experience`,
        });
      }
    }

    // System-wide recommendations
    const totalCostEfficiency =
      Array.from(this.metrics.values()).reduce((sum, m) => sum + m.cost.efficiency, 0) /
      this.metrics.size;

    if (totalCostEfficiency > 0.006) {
      recommendations.push({
        type: 'cost' as const,
        severity: 'high' as const,
        description: `Overall API cost efficiency is suboptimal ($${totalCostEfficiency.toFixed(4)} avg per request)`,
        actionRequired: 'Implement aggressive caching and request batching strategies',
        estimatedImpact: 'Potential 40-70% overall cost reduction',
      });
    }

    return recommendations.sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });
  }

  private startMetricsCollection(): void {
    // Reset request counts every second
    setInterval(() => {
      for (const providerId of this.requestCounts.keys()) {
        this.requestCounts.set(providerId, 0);

        // Reset quota usage counters
        const metrics = this.metrics.get(providerId);
        if (metrics) {
          metrics.quotas.currentUsage.secondly = 0;
        }
      }
    }, 1000);

    // Reset daily counters every day
    setInterval(
      () => {
        for (const [providerId, metrics] of this.metrics) {
          metrics.quotas.currentUsage.daily = 0;
        }
      },
      24 * 60 * 60 * 1000
    );

    // Emit metrics every 30 seconds
    setInterval(() => {
      this.emit('metricsUpdate', {
        timestamp: Date.now(),
        providers: Array.from(this.metrics.entries()).map(([id, metrics]) => ({
          providerId: id,
          metrics,
        })),
      });
    }, 30000);
  }

  private startHealthMonitoring(): void {
    // Health check every 5 minutes
    setInterval(
      async () => {
        for (const [providerId, config] of this.providers) {
          try {
            await this.healthMonitor.checkProviderHealth(providerId, config);
          } catch (error) {
            this.contextLogger.error(`Health check failed for ${providerId}`, error);
          }
        }
      },
      5 * 60 * 1000
    );
  }

  // Getters for external access
  getProviderMetrics(providerId: string): ProviderMetrics | undefined {
    return this.metrics.get(providerId);
  }

  getAllProviderMetrics(): Map<string, ProviderMetrics> {
    return new Map(this.metrics);
  }

  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}

// Export singleton instance
let providerRouterInstance: IntelligentProviderRouter | null = null;

export const getProviderRouter = (): IntelligentProviderRouter => {
  if (!providerRouterInstance) {
    providerRouterInstance = new IntelligentProviderRouter();
  }
  return providerRouterInstance;
};

export default getProviderRouter;
