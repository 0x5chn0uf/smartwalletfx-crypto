import { EventEmitter } from 'events';
import { logger, logError, createContextualLogger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { config } from '@/config';
import { ChainId } from '@/types/blockchain';

// Import services
import {
  getEventSystem,
  CostThresholdExceededV1,
  PerformanceDegradationV1,
  ProviderFailoverV1,
} from './EventSystem';
import { getRealTimeOptimizer } from './RealTimeOptimizer';
import { getEnhancedBatchingEngine, EnhancedBatchRequest } from './EnhancedBatchingEngine';
import { getDeduplicationService } from './RequestDeduplicationService';
import { getCostMonitoringService } from './CostMonitoringService';

/**
 * Cost Reduction Orchestrator
 *
 * Central coordination system for all cost optimization strategies:
 * - Real-time cost monitoring and threshold management
 * - Intelligent orchestration of optimization services
 * - Performance-based optimization strategy selection
 * - Predictive cost analytics and preventive measures
 * - Cross-service coordination and conflict resolution
 */

export interface OptimizationStrategy {
  id: string;
  name: string;
  type:
    | 'caching'
    | 'batching'
    | 'deduplication'
    | 'provider_routing'
    | 'rate_limiting'
    | 'request_filtering';
  priority: number;
  enabled: boolean;
  conditions: {
    costThreshold?: number;
    latencyThreshold?: number;
    errorRateThreshold?: number;
    queueLengthThreshold?: number;
    timeOfDay?: { start: number; end: number };
    budgetUtilizationThreshold?: number;
  };
  actions: {
    immediate: string[];
    preventive: string[];
    recovery: string[];
  };
  expectedSavings: {
    cost: number; // percentage
    latency: number; // percentage reduction
  };
  riskProfile: {
    userExperienceImpact: 'low' | 'medium' | 'high';
    reliabilityImpact: 'low' | 'medium' | 'high';
    reverseComplexity: 'easy' | 'medium' | 'hard';
  };
  metrics: {
    timesActivated: number;
    totalSavings: number;
    averageEffectiveness: number;
    lastActivated?: number;
    averageActiveDuration: number;
  };
}

export interface CostOptimizationPlan {
  planId: string;
  createdAt: number;
  trigger: 'threshold_exceeded' | 'performance_degradation' | 'predictive' | 'manual' | 'scheduled';
  severity: 'low' | 'medium' | 'high' | 'critical';
  targetSavings: number;
  timeframe: number; // ms
  strategies: OptimizationStrategy[];
  coordinationPlan: {
    executionOrder: string[];
    dependencies: Record<string, string[]>;
    conflictResolution: Record<string, 'override' | 'merge' | 'skip'>;
    rollbackPlan: string[];
  };
  monitoring: {
    kpis: string[];
    checkpoints: number[];
    successCriteria: Record<string, number>;
    failureCriteria: Record<string, number>;
  };
}

export interface SystemState {
  timestamp: number;
  costMetrics: {
    currentHourlyCost: number;
    dailyBudgetUtilization: number;
    monthlyBudgetUtilization: number;
    costTrend: 'increasing' | 'stable' | 'decreasing';
    topCostDrivers: Array<{ component: string; cost: number; percentage: number }>;
  };
  performanceMetrics: {
    averageResponseTime: number;
    cacheHitRate: number;
    errorRate: number;
    throughput: number;
    queueLength: number;
  };
  optimizationMetrics: {
    activeBatches: number;
    deduplicationRate: number;
    providerFailovers: number;
    activeOptimizations: number;
    totalSavingsToday: number;
  };
  systemHealth: {
    overall: 'healthy' | 'warning' | 'critical';
    components: Record<string, 'healthy' | 'warning' | 'critical'>;
    alerts: Array<{ type: string; severity: string; message: string; timestamp: number }>;
  };
}

export interface PredictiveAnalytics {
  costForecast: {
    nextHour: number;
    next6Hours: number;
    nextDay: number;
    confidence: number;
  };
  budgetProjection: {
    dailyUtilization: number;
    monthlyUtilization: number;
    daysUntilExhaustion: number | null;
    projectedOverspend: number;
  };
  optimizationOpportunities: Array<{
    type: string;
    potentialSavings: number;
    implementationComplexity: 'low' | 'medium' | 'high';
    expectedImpact: string;
    confidence: number;
  }>;
  anomalyDetection: {
    costAnomalies: Array<{ timestamp: number; severity: number; description: string }>;
    performanceAnomalies: Array<{ timestamp: number; metric: string; severity: number }>;
    usagePatternChanges: Array<{ pattern: string; change: string; confidence: number }>;
  };
}

/**
 * Central orchestrator for all cost optimization strategies
 */
export class CostReductionOrchestrator extends EventEmitter {
  private contextLogger = createContextualLogger({ component: 'CostReductionOrchestrator' });

  // Service integrations
  private eventSystem = getEventSystem();
  private realTimeOptimizer = getRealTimeOptimizer();
  private batchingEngine = getEnhancedBatchingEngine();
  private deduplicationService = getDeduplicationService();
  private costMonitoringService = getCostMonitoringService();

  // State management
  private currentSystemState: SystemState | null = null;
  private activeOptimizationPlans = new Map<string, CostOptimizationPlan>();
  private optimizationStrategies = new Map<string, OptimizationStrategy>();
  private predictiveAnalytics: PredictiveAnalytics | null = null;

  // Configuration
  private enabled = true;
  private aggressivenessLevel = 0.5; // 0 = conservative, 1 = aggressive
  private coordinationEnabled = true;
  private predictiveEnabled = true;
  private autoOptimizationEnabled = true;

  // Performance tracking
  private orchestratorMetrics = {
    totalPlansCreated: 0,
    totalPlansExecuted: 0,
    totalPlansSucceeded: 0,
    totalSavingsAchieved: 0,
    averagePlanExecutionTime: 0,
    conflictsResolved: 0,
    predictiveActionsTriggered: 0,
    lastAnalysisTime: 0,
    systemStateUpdates: 0,
  };

  // Coordination state
  private activeConflicts = new Map<
    string,
    {
      strategies: string[];
      resolution: 'pending' | 'resolved';
      resolutionMethod?: string;
      timestamp: number;
    }
  >();

  constructor() {
    super();
    this.initializeStrategies();
    this.setupEventListeners();
    this.startSystemMonitoring();
    this.startPredictiveAnalytics();
    this.startOrchestration();
  }

  /**
   * Main orchestration entry point for optimization requests
   */
  async orchestrateOptimization(
    trigger: CostOptimizationPlan['trigger'],
    severity: CostOptimizationPlan['severity'],
    metadata?: Record<string, any>
  ): Promise<CostOptimizationPlan> {
    if (!this.enabled) {
      throw new Error('Cost optimization orchestration is disabled');
    }

    const startTime = Date.now();

    try {
      // Update system state
      await this.updateSystemState();

      // Create optimization plan
      const plan = await this.createOptimizationPlan(trigger, severity, metadata);

      // Execute plan with coordination
      const executionResult = await this.executePlanWithCoordination(plan);

      // Monitor and adjust
      this.monitorPlanExecution(plan);

      this.orchestratorMetrics.totalPlansCreated++;
      this.orchestratorMetrics.totalPlansExecuted++;

      if (executionResult.success) {
        this.orchestratorMetrics.totalPlansSucceeded++;
        this.orchestratorMetrics.totalSavingsAchieved += executionResult.actualSavings;
      }

      const executionTime = Date.now() - startTime;
      this.orchestratorMetrics.averagePlanExecutionTime =
        (this.orchestratorMetrics.averagePlanExecutionTime + executionTime) / 2;

      this.contextLogger.info('Optimization plan orchestrated', {
        planId: plan.planId,
        trigger,
        severity,
        strategiesCount: plan.strategies.length,
        executionTime,
        success: executionResult.success,
        actualSavings: executionResult.actualSavings,
      });

      this.emit('planCompleted', { plan, result: executionResult });

      return plan;
    } catch (error) {
      logError(error as Error, {
        operation: 'orchestrateOptimization',
        trigger,
        severity,
        metadata,
      });
      throw error;
    }
  }

  /**
   * Process enhanced batch requests with orchestrated optimization
   */
  async processOptimizedRequest(request: EnhancedBatchRequest): Promise<void> {
    try {
      // Get current system state for optimization context
      const systemState = this.currentSystemState;
      if (!systemState) {
        await this.updateSystemState();
      }

      // Enhance request with optimization context
      const optimizedRequest = await this.enhanceRequestWithContext(request);

      // Apply dynamic optimization based on current state
      const optimizationDecision = await this.makeRequestOptimizationDecision(optimizedRequest);

      // Route request based on optimization decision
      switch (optimizationDecision.strategy) {
        case 'immediate':
          // High priority or critical requests
          await this.processImmediateRequest(optimizedRequest);
          break;

        case 'deduplication':
          // Check deduplication first, then route
          await this.deduplicationService.deduplicateRequest({
            id: optimizedRequest.id,
            type: optimizedRequest.type,
            params: optimizedRequest.params,
            chainId: optimizedRequest.chainId,
            timestamp: optimizedRequest.timestamp,
            userContext: optimizedRequest.requester,
            priority: optimizedRequest.priority,
            callback: optimizedRequest.callback,
            estimatedCost: optimizedRequest.estimatedCost,
          });
          break;

        case 'enhanced_batching':
          // Route to enhanced batching engine
          await this.batchingEngine.submitEnhancedRequest(optimizedRequest);
          break;

        case 'cost_optimized':
          // Apply cost-aware routing and processing
          await this.processCostOptimizedRequest(optimizedRequest);
          break;

        default:
          // Fallback to enhanced batching
          await this.batchingEngine.submitEnhancedRequest(optimizedRequest);
      }

      // Update metrics
      await this.updateRequestProcessingMetrics(optimizationDecision);
    } catch (error) {
      logError(error as Error, {
        operation: 'processOptimizedRequest',
        requestId: request.id,
        requestType: request.type,
      });

      // Fallback processing
      await this.processImmediateRequest(request);
    }
  }

  /**
   * Get real-time system analysis and recommendations
   */
  async getSystemAnalysis(): Promise<{
    systemState: SystemState;
    predictiveAnalytics: PredictiveAnalytics;
    recommendations: Array<{
      type: string;
      priority: 'low' | 'medium' | 'high' | 'critical';
      description: string;
      expectedImpact: string;
      implementationSteps: string[];
    }>;
    activeOptimizations: Array<{
      planId: string;
      strategy: string;
      status: string;
      savings: number;
      startedAt: number;
    }>;
  }> {
    await this.updateSystemState();
    await this.updatePredictiveAnalytics();

    const recommendations = await this.generateRecommendations();
    const activeOptimizations = this.getActiveOptimizationSummary();

    return {
      systemState: this.currentSystemState!,
      predictiveAnalytics: this.predictiveAnalytics!,
      recommendations,
      activeOptimizations,
    };
  }

  /**
   * Initialize optimization strategies
   */
  private initializeStrategies(): void {
    // Aggressive caching strategy
    this.optimizationStrategies.set('aggressive_caching', {
      id: 'aggressive_caching',
      name: 'Aggressive Cache Optimization',
      type: 'caching',
      priority: 8,
      enabled: true,
      conditions: {
        costThreshold: 0.8, // Trigger when 80% of budget used
        budgetUtilizationThreshold: 0.75,
      },
      actions: {
        immediate: ['extend_cache_ttl', 'enable_preemptive_refresh'],
        preventive: ['identify_cache_candidates', 'optimize_cache_keys'],
        recovery: ['restore_normal_ttl', 'clear_stale_cache'],
      },
      expectedSavings: {
        cost: 40, // 40% cost reduction
        latency: 25, // 25% latency reduction
      },
      riskProfile: {
        userExperienceImpact: 'low',
        reliabilityImpact: 'low',
        reverseComplexity: 'easy',
      },
      metrics: {
        timesActivated: 0,
        totalSavings: 0,
        averageEffectiveness: 0,
        averageActiveDuration: 0,
      },
    });

    // Enhanced batching strategy
    this.optimizationStrategies.set('enhanced_batching', {
      id: 'enhanced_batching',
      name: 'Enhanced Request Batching',
      type: 'batching',
      priority: 7,
      enabled: true,
      conditions: {
        queueLengthThreshold: 50,
        costThreshold: 0.7,
      },
      actions: {
        immediate: ['force_batching_mode', 'reduce_batch_timeouts'],
        preventive: ['optimize_batch_sizes', 'enable_cross_chain_batching'],
        recovery: ['restore_normal_batching', 'clear_batch_queues'],
      },
      expectedSavings: {
        cost: 55, // 55% cost reduction
        latency: -10, // 10% latency increase (acceptable trade-off)
      },
      riskProfile: {
        userExperienceImpact: 'medium',
        reliabilityImpact: 'low',
        reverseComplexity: 'medium',
      },
      metrics: {
        timesActivated: 0,
        totalSavings: 0,
        averageEffectiveness: 0,
        averageActiveDuration: 0,
      },
    });

    // Request deduplication strategy
    this.optimizationStrategies.set('advanced_deduplication', {
      id: 'advanced_deduplication',
      name: 'Advanced Request Deduplication',
      type: 'deduplication',
      priority: 9,
      enabled: true,
      conditions: {
        costThreshold: 0.6,
        queueLengthThreshold: 100,
      },
      actions: {
        immediate: ['enable_semantic_matching', 'extend_temporal_windows'],
        preventive: ['analyze_duplication_patterns', 'optimize_dedup_keys'],
        recovery: ['disable_aggressive_dedup', 'clear_dedup_cache'],
      },
      expectedSavings: {
        cost: 35, // 35% cost reduction
        latency: 60, // 60% latency reduction
      },
      riskProfile: {
        userExperienceImpact: 'low',
        reliabilityImpact: 'low',
        reverseComplexity: 'easy',
      },
      metrics: {
        timesActivated: 0,
        totalSavings: 0,
        averageEffectiveness: 0,
        averageActiveDuration: 0,
      },
    });

    // Provider routing optimization
    this.optimizationStrategies.set('provider_optimization', {
      id: 'provider_optimization',
      name: 'Cost-Optimized Provider Routing',
      type: 'provider_routing',
      priority: 6,
      enabled: true,
      conditions: {
        costThreshold: 0.75,
        errorRateThreshold: 0.05,
      },
      actions: {
        immediate: ['bias_low_cost_providers', 'enable_failover_optimization'],
        preventive: ['analyze_provider_costs', 'optimize_routing_weights'],
        recovery: ['restore_balanced_routing', 'clear_provider_bias'],
      },
      expectedSavings: {
        cost: 25, // 25% cost reduction
        latency: 15, // 15% latency increase
      },
      riskProfile: {
        userExperienceImpact: 'medium',
        reliabilityImpact: 'medium',
        reverseComplexity: 'medium',
      },
      metrics: {
        timesActivated: 0,
        totalSavings: 0,
        averageEffectiveness: 0,
        averageActiveDuration: 0,
      },
    });

    // Emergency rate limiting
    this.optimizationStrategies.set('emergency_rate_limiting', {
      id: 'emergency_rate_limiting',
      name: 'Emergency Rate Limiting',
      type: 'rate_limiting',
      priority: 10,
      enabled: true,
      conditions: {
        budgetUtilizationThreshold: 0.95,
        costThreshold: 0.9,
      },
      actions: {
        immediate: ['enable_strict_rate_limits', 'queue_non_critical'],
        preventive: ['analyze_usage_patterns', 'optimize_rate_configs'],
        recovery: ['remove_rate_limits', 'process_queued_requests'],
      },
      expectedSavings: {
        cost: 70, // 70% cost reduction
        latency: 200, // 200% latency increase (emergency measure)
      },
      riskProfile: {
        userExperienceImpact: 'high',
        reliabilityImpact: 'medium',
        reverseComplexity: 'easy',
      },
      metrics: {
        timesActivated: 0,
        totalSavings: 0,
        averageEffectiveness: 0,
        averageActiveDuration: 0,
      },
    });

    // Request filtering strategy
    this.optimizationStrategies.set('request_filtering', {
      id: 'request_filtering',
      name: 'Non-Essential Request Filtering',
      type: 'request_filtering',
      priority: 5,
      enabled: true,
      conditions: {
        budgetUtilizationThreshold: 0.9,
        costThreshold: 0.85,
      },
      actions: {
        immediate: ['block_non_essential', 'defer_analytics_requests'],
        preventive: ['categorize_request_types', 'optimize_filtering_rules'],
        recovery: ['remove_filters', 'process_deferred_requests'],
      },
      expectedSavings: {
        cost: 45, // 45% cost reduction
        latency: 0, // No latency impact (requests blocked)
      },
      riskProfile: {
        userExperienceImpact: 'medium',
        reliabilityImpact: 'low',
        reverseComplexity: 'easy',
      },
      metrics: {
        timesActivated: 0,
        totalSavings: 0,
        averageEffectiveness: 0,
        averageActiveDuration: 0,
      },
    });
  }

  /**
   * Create optimization plan based on trigger and severity
   */
  private async createOptimizationPlan(
    trigger: CostOptimizationPlan['trigger'],
    severity: CostOptimizationPlan['severity'],
    metadata?: Record<string, any>
  ): Promise<CostOptimizationPlan> {
    const planId = `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Select strategies based on severity and current state
    const selectedStrategies = await this.selectOptimizationStrategies(severity, metadata);

    // Calculate target savings
    const targetSavings = this.calculateTargetSavings(severity, selectedStrategies);

    // Determine timeframe
    const timeframe = this.determineOptimizationTimeframe(severity);

    // Create coordination plan
    const coordinationPlan = await this.createCoordinationPlan(selectedStrategies);

    // Define monitoring plan
    const monitoring = this.createMonitoringPlan(selectedStrategies, severity);

    const plan: CostOptimizationPlan = {
      planId,
      createdAt: Date.now(),
      trigger,
      severity,
      targetSavings,
      timeframe,
      strategies: selectedStrategies,
      coordinationPlan,
      monitoring,
    };

    this.activeOptimizationPlans.set(planId, plan);

    this.contextLogger.info('Optimization plan created', {
      planId,
      trigger,
      severity,
      strategiesCount: selectedStrategies.length,
      targetSavings,
      timeframe,
    });

    return plan;
  }

  /**
   * Execute plan with coordination and conflict resolution
   */
  private async executePlanWithCoordination(plan: CostOptimizationPlan): Promise<{
    success: boolean;
    actualSavings: number;
    executedStrategies: string[];
    conflicts: string[];
    executionTime: number;
  }> {
    const startTime = Date.now();
    const executedStrategies: string[] = [];
    const conflicts: string[] = [];
    let totalSavings = 0;

    try {
      // Check for conflicts with active plans
      const activeConflicts = await this.detectStrategyConflicts(plan);

      if (activeConflicts.length > 0) {
        await this.resolveStrategyConflicts(activeConflicts, plan);
        conflicts.push(...activeConflicts.map(c => c.type));
        this.orchestratorMetrics.conflictsResolved += activeConflicts.length;
      }

      // Execute strategies in coordination order
      for (const strategyId of plan.coordinationPlan.executionOrder) {
        const strategy = plan.strategies.find(s => s.id === strategyId);
        if (!strategy) continue;

        try {
          const executionResult = await this.executeStrategy(strategy, plan);

          if (executionResult.success) {
            executedStrategies.push(strategyId);
            totalSavings += executionResult.savings;
            strategy.metrics.timesActivated++;
            strategy.metrics.totalSavings += executionResult.savings;
          }
        } catch (error) {
          this.contextLogger.error('Strategy execution failed', {
            planId: plan.planId,
            strategyId,
            error: (error as Error).message,
          });

          // Check if this strategy is critical
          const dependencies = plan.coordinationPlan.dependencies[strategyId] || [];
          if (dependencies.length > 0) {
            // Skip dependent strategies
            this.contextLogger.warn('Skipping dependent strategies due to failure', {
              planId: plan.planId,
              failedStrategy: strategyId,
              skippedStrategies: dependencies,
            });
          }
        }
      }

      const success = executedStrategies.length > 0;
      const executionTime = Date.now() - startTime;

      return {
        success,
        actualSavings: totalSavings,
        executedStrategies,
        conflicts,
        executionTime,
      };
    } catch (error) {
      logError(error as Error, {
        operation: 'executePlanWithCoordination',
        planId: plan.planId,
      });

      return {
        success: false,
        actualSavings: 0,
        executedStrategies,
        conflicts,
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute individual strategy
   */
  private async executeStrategy(
    strategy: OptimizationStrategy,
    plan: CostOptimizationPlan
  ): Promise<{ success: boolean; savings: number }> {
    if (!strategy.enabled) {
      return { success: false, savings: 0 };
    }

    const startTime = Date.now();

    try {
      let savings = 0;

      // Execute strategy based on type
      switch (strategy.type) {
        case 'caching':
          savings = await this.executeCachingStrategy(strategy, plan);
          break;

        case 'batching':
          savings = await this.executeBatchingStrategy(strategy, plan);
          break;

        case 'deduplication':
          savings = await this.executeDeduplicationStrategy(strategy, plan);
          break;

        case 'provider_routing':
          savings = await this.executeProviderRoutingStrategy(strategy, plan);
          break;

        case 'rate_limiting':
          savings = await this.executeRateLimitingStrategy(strategy, plan);
          break;

        case 'request_filtering':
          savings = await this.executeRequestFilteringStrategy(strategy, plan);
          break;

        default:
          this.contextLogger.warn('Unknown strategy type', {
            strategyType: strategy.type,
            strategyId: strategy.id,
          });
          return { success: false, savings: 0 };
      }

      const executionTime = Date.now() - startTime;
      strategy.metrics.averageActiveDuration =
        (strategy.metrics.averageActiveDuration + executionTime) / 2;

      this.contextLogger.info('Strategy executed successfully', {
        planId: plan.planId,
        strategyId: strategy.id,
        strategyType: strategy.type,
        savings,
        executionTime,
      });

      return { success: true, savings };
    } catch (error) {
      logError(error as Error, {
        operation: 'executeStrategy',
        strategyId: strategy.id,
        planId: plan.planId,
      });

      return { success: false, savings: 0 };
    }
  }

  /**
   * Strategy execution implementations
   */
  private async executeCachingStrategy(
    strategy: OptimizationStrategy,
    plan: CostOptimizationPlan
  ): Promise<number> {
    // Trigger aggressive caching through RealTimeOptimizer
    const optimization = await this.realTimeOptimizer.forceOptimization(
      'efficiency_drop',
      plan.severity
    );

    // Store strategy state
    await redisManager.set(
      `${config.redis.keyPrefix}strategy_${strategy.id}`,
      {
        planId: plan.planId,
        activatedAt: Date.now(),
        actions: strategy.actions.immediate,
      },
      plan.timeframe
    );

    return strategy.expectedSavings.cost;
  }

  private async executeBatchingStrategy(
    strategy: OptimizationStrategy,
    plan: CostOptimizationPlan
  ): Promise<number> {
    // Configure enhanced batching for aggressive mode
    this.batchingEngine.updateQueueConfig({
      backpressureConfig: {
        enabled: true,
        triggerThreshold: Math.floor(80000 * (1 - this.aggressivenessLevel)),
        shedPercentage: 0.1 + this.aggressivenessLevel * 0.2,
        recoveryThreshold: Math.floor(60000 * (1 - this.aggressivenessLevel)),
      },
    });

    // Force process pending groups
    await this.batchingEngine.forceProcessPendingGroups();

    return strategy.expectedSavings.cost;
  }

  private async executeDeduplicationStrategy(
    strategy: OptimizationStrategy,
    plan: CostOptimizationPlan
  ): Promise<number> {
    // Enable aggressive deduplication features
    this.deduplicationService.setSemanticMatchingEnabled(true);
    this.deduplicationService.setPatternDetectionEnabled(true);

    return strategy.expectedSavings.cost;
  }

  private async executeProviderRoutingStrategy(
    strategy: OptimizationStrategy,
    plan: CostOptimizationPlan
  ): Promise<number> {
    // Set cost optimization bias in provider router
    await redisManager.set(
      `${config.redis.keyPrefix}cost_optimization_bias`,
      {
        enabled: true,
        costWeight: 0.8 + this.aggressivenessLevel * 0.2,
        planId: plan.planId,
        timestamp: Date.now(),
      },
      plan.timeframe
    );

    return strategy.expectedSavings.cost;
  }

  private async executeRateLimitingStrategy(
    strategy: OptimizationStrategy,
    plan: CostOptimizationPlan
  ): Promise<number> {
    // Configure emergency rate limiting
    const rateLimitConfig = {
      enabled: true,
      maxRequestsPerSecond: Math.max(1, Math.floor(10 * (1 - this.aggressivenessLevel))),
      maxRequestsPerMinute: Math.max(10, Math.floor(100 * (1 - this.aggressivenessLevel))),
      planId: plan.planId,
      timestamp: Date.now(),
    };

    await redisManager.set(
      `${config.redis.keyPrefix}emergency_rate_limit`,
      rateLimitConfig,
      plan.timeframe
    );

    return strategy.expectedSavings.cost;
  }

  private async executeRequestFilteringStrategy(
    strategy: OptimizationStrategy,
    plan: CostOptimizationPlan
  ): Promise<number> {
    // Configure request filtering
    const filterConfig = {
      enabled: true,
      blockTypes: ['analytics', 'historical_detailed', 'nft_metadata'],
      allowTypes: ['balance', 'transaction', 'token_basic'],
      planId: plan.planId,
      severity: plan.severity,
      timestamp: Date.now(),
    };

    await redisManager.set(
      `${config.redis.keyPrefix}request_filtering`,
      filterConfig,
      plan.timeframe
    );

    return strategy.expectedSavings.cost;
  }

  /**
   * Helper methods for plan creation
   */
  private async selectOptimizationStrategies(
    severity: CostOptimizationPlan['severity'],
    metadata?: Record<string, any>
  ): Promise<OptimizationStrategy[]> {
    const selectedStrategies: OptimizationStrategy[] = [];
    const systemState = this.currentSystemState;

    if (!systemState) {
      // Fallback to basic strategy selection
      return Array.from(this.optimizationStrategies.values())
        .filter(s => s.enabled)
        .slice(0, severity === 'critical' ? 6 : 3);
    }

    // Strategy selection based on severity and system state
    for (const strategy of this.optimizationStrategies.values()) {
      if (!strategy.enabled) continue;

      let shouldSelect = false;

      // Check conditions
      const conditions = strategy.conditions;

      if (
        conditions.costThreshold &&
        systemState.costMetrics.dailyBudgetUtilization >= conditions.costThreshold
      ) {
        shouldSelect = true;
      }

      if (
        conditions.budgetUtilizationThreshold &&
        systemState.costMetrics.monthlyBudgetUtilization >= conditions.budgetUtilizationThreshold
      ) {
        shouldSelect = true;
      }

      if (
        conditions.latencyThreshold &&
        systemState.performanceMetrics.averageResponseTime >= conditions.latencyThreshold
      ) {
        shouldSelect = true;
      }

      if (
        conditions.errorRateThreshold &&
        systemState.performanceMetrics.errorRate >= conditions.errorRateThreshold
      ) {
        shouldSelect = true;
      }

      if (
        conditions.queueLengthThreshold &&
        systemState.performanceMetrics.queueLength >= conditions.queueLengthThreshold
      ) {
        shouldSelect = true;
      }

      // Severity overrides
      if (severity === 'critical' && strategy.priority >= 8) {
        shouldSelect = true;
      } else if (severity === 'high' && strategy.priority >= 6) {
        shouldSelect = true;
      } else if (severity === 'medium' && strategy.priority >= 4) {
        shouldSelect = true;
      }

      if (shouldSelect) {
        selectedStrategies.push({ ...strategy });
      }
    }

    // Sort by priority (highest first)
    selectedStrategies.sort((a, b) => b.priority - a.priority);

    // Limit strategies based on severity
    const maxStrategies = {
      low: 2,
      medium: 4,
      high: 6,
      critical: 8,
    }[severity];

    return selectedStrategies.slice(0, maxStrategies);
  }

  private calculateTargetSavings(
    severity: CostOptimizationPlan['severity'],
    strategies: OptimizationStrategy[]
  ): number {
    const baseSavings = strategies.reduce(
      (total, strategy) => total + strategy.expectedSavings.cost,
      0
    );

    // Apply severity multipliers
    const severityMultipliers = {
      low: 0.6,
      medium: 0.8,
      high: 0.9,
      critical: 1.0,
    };

    return baseSavings * severityMultipliers[severity];
  }

  private determineOptimizationTimeframe(severity: CostOptimizationPlan['severity']): number {
    const timeframes = {
      low: 4 * 60 * 60 * 1000, // 4 hours
      medium: 2 * 60 * 60 * 1000, // 2 hours
      high: 60 * 60 * 1000, // 1 hour
      critical: 30 * 60 * 1000, // 30 minutes
    };

    return timeframes[severity];
  }

  private async createCoordinationPlan(
    strategies: OptimizationStrategy[]
  ): Promise<CostOptimizationPlan['coordinationPlan']> {
    // Define execution order based on priority and dependencies
    const executionOrder = strategies.sort((a, b) => b.priority - a.priority).map(s => s.id);

    // Define dependencies (simplified)
    const dependencies: Record<string, string[]> = {
      advanced_deduplication: [], // No dependencies
      aggressive_caching: ['advanced_deduplication'],
      enhanced_batching: ['advanced_deduplication'],
      provider_optimization: ['advanced_deduplication', 'aggressive_caching'],
      emergency_rate_limiting: [], // Emergency - no dependencies
      request_filtering: [], // Emergency - no dependencies
    };

    // Define conflict resolution
    const conflictResolution: Record<string, 'override' | 'merge' | 'skip'> = {
      emergency_rate_limiting: 'override', // Emergency strategies override
      request_filtering: 'override',
      provider_optimization: 'merge',
      enhanced_batching: 'merge',
      aggressive_caching: 'merge',
      advanced_deduplication: 'skip', // Skip if conflicts
    };

    // Define rollback plan (reverse order)
    const rollbackPlan = [...executionOrder].reverse();

    return {
      executionOrder,
      dependencies,
      conflictResolution,
      rollbackPlan,
    };
  }

  private createMonitoringPlan(
    strategies: OptimizationStrategy[],
    severity: CostOptimizationPlan['severity']
  ): CostOptimizationPlan['monitoring'] {
    const kpis = [
      'cost_reduction',
      'latency_impact',
      'error_rate',
      'throughput',
      'user_satisfaction',
    ];

    // Checkpoints based on severity (when to check progress)
    const checkpointIntervals = {
      low: [5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000], // 5m, 15m, 30m
      medium: [2 * 60 * 1000, 10 * 60 * 1000, 20 * 60 * 1000], // 2m, 10m, 20m
      high: [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000], // 1m, 5m, 15m
      critical: [30 * 1000, 2 * 60 * 1000, 5 * 60 * 1000], // 30s, 2m, 5m
    };

    const checkpoints = checkpointIntervals[severity].map(interval => Date.now() + interval);

    // Success criteria
    const successCriteria = {
      cost_reduction: Math.max(
        10,
        strategies.reduce((total, s) => total + s.expectedSavings.cost, 0) * 0.7
      ),
      error_rate_increase: 0.02, // Max 2% error rate increase
      latency_increase: 1.5, // Max 50% latency increase
    };

    // Failure criteria
    const failureCriteria = {
      error_rate_spike: 0.1, // 10% error rate = failure
      latency_spike: 3.0, // 300% latency increase = failure
      system_health: 0.3, // Overall health below 30% = failure
    };

    return {
      kpis,
      checkpoints,
      successCriteria,
      failureCriteria,
    };
  }

  /**
   * System monitoring and analytics
   */
  private async updateSystemState(): Promise<void> {
    try {
      const costSummary = await this.costMonitoringService.getCostSummary('1h');
      const dailyCostSummary = await this.costMonitoringService.getCostSummary('24h');

      // Get optimization metrics
      const batchingMetrics = this.batchingEngine.getMetrics();
      const deduplicationMetrics = this.deduplicationService.getMetrics();
      const realTimeOptimizationMetrics = this.realTimeOptimizer.getOptimizationMetrics();

      this.currentSystemState = {
        timestamp: Date.now(),
        costMetrics: {
          currentHourlyCost: costSummary.totalCost,
          dailyBudgetUtilization: dailyCostSummary.totalCost / (config.costs.monthlyBudget / 30),
          monthlyBudgetUtilization: (dailyCostSummary.totalCost * 30) / config.costs.monthlyBudget,
          costTrend: this.analyzeCostTrend(costSummary, dailyCostSummary),
          topCostDrivers: this.identifyTopCostDrivers(costSummary),
        },
        performanceMetrics: {
          averageResponseTime: costSummary.averageResponseTime,
          cacheHitRate: costSummary.cacheHitRate,
          errorRate: costSummary.errorRate,
          throughput: costSummary.requestCount / 3600, // Requests per second
          queueLength:
            batchingMetrics.queueAgeDistribution.under_1s +
            batchingMetrics.queueAgeDistribution._1_to_5s +
            batchingMetrics.queueAgeDistribution._5_to_15s +
            batchingMetrics.queueAgeDistribution.over_15s,
        },
        optimizationMetrics: {
          activeBatches: batchingMetrics.crossChainBatches,
          deduplicationRate: deduplicationMetrics.deduplicationRate,
          providerFailovers: 0, // Would get from provider router
          activeOptimizations: this.activeOptimizationPlans.size,
          totalSavingsToday: batchingMetrics.totalCostSavings + deduplicationMetrics.totalCostSaved,
        },
        systemHealth: {
          overall: this.calculateOverallSystemHealth(),
          components: {
            batching: batchingMetrics.averageBatchEfficiency > 0.7 ? 'healthy' : 'warning',
            deduplication: deduplicationMetrics.deduplicationRate > 15 ? 'healthy' : 'warning',
            caching: costSummary.cacheHitRate > 0.6 ? 'healthy' : 'warning',
            cost:
              this.currentSystemState?.costMetrics.monthlyBudgetUtilization < 0.8
                ? 'healthy'
                : 'warning',
          },
          alerts: this.generateSystemAlerts(),
        },
      };

      this.orchestratorMetrics.systemStateUpdates++;
    } catch (error) {
      logError(error as Error, { operation: 'updateSystemState' });
    }
  }

  private analyzeCostTrend(
    hourlySummary: any,
    dailySummary: any
  ): 'increasing' | 'stable' | 'decreasing' {
    const hourlyRate = hourlySummary.totalCost;
    const dailyRate = dailySummary.totalCost / 24;

    if (hourlyRate > dailyRate * 1.2) return 'increasing';
    if (hourlyRate < dailyRate * 0.8) return 'decreasing';
    return 'stable';
  }

  private identifyTopCostDrivers(
    costSummary: any
  ): Array<{ component: string; cost: number; percentage: number }> {
    // This would analyze cost breakdown by provider, request type, etc.
    // Simplified implementation
    return [
      { component: 'provider_calls', cost: costSummary.totalCost * 0.6, percentage: 60 },
      { component: 'database_ops', cost: costSummary.totalCost * 0.25, percentage: 25 },
      { component: 'cache_misses', cost: costSummary.totalCost * 0.15, percentage: 15 },
    ];
  }

  private calculateOverallSystemHealth(): 'healthy' | 'warning' | 'critical' {
    if (!this.currentSystemState) return 'warning';

    const healthFactors = {
      cost: this.currentSystemState.costMetrics.monthlyBudgetUtilization < 0.8 ? 1 : 0.5,
      performance: this.currentSystemState.performanceMetrics.errorRate < 0.05 ? 1 : 0.5,
      optimization: this.currentSystemState.optimizationMetrics.totalSavingsToday > 0 ? 1 : 0.8,
    };

    const overallScore = Object.values(healthFactors).reduce((sum, score) => sum + score, 0) / 3;

    if (overallScore > 0.8) return 'healthy';
    if (overallScore > 0.6) return 'warning';
    return 'critical';
  }

  private generateSystemAlerts(): Array<{
    type: string;
    severity: string;
    message: string;
    timestamp: number;
  }> {
    const alerts = [];

    if (!this.currentSystemState) return alerts;

    if (this.currentSystemState.costMetrics.monthlyBudgetUtilization > 0.8) {
      alerts.push({
        type: 'budget_utilization',
        severity:
          this.currentSystemState.costMetrics.monthlyBudgetUtilization > 0.9
            ? 'critical'
            : 'warning',
        message: `Monthly budget ${(this.currentSystemState.costMetrics.monthlyBudgetUtilization * 100).toFixed(1)}% utilized`,
        timestamp: Date.now(),
      });
    }

    if (this.currentSystemState.performanceMetrics.errorRate > 0.05) {
      alerts.push({
        type: 'error_rate',
        severity:
          this.currentSystemState.performanceMetrics.errorRate > 0.1 ? 'critical' : 'warning',
        message: `Error rate at ${(this.currentSystemState.performanceMetrics.errorRate * 100).toFixed(2)}%`,
        timestamp: Date.now(),
      });
    }

    if (this.currentSystemState.performanceMetrics.queueLength > 1000) {
      alerts.push({
        type: 'queue_length',
        severity:
          this.currentSystemState.performanceMetrics.queueLength > 5000 ? 'critical' : 'warning',
        message: `Queue length at ${this.currentSystemState.performanceMetrics.queueLength} requests`,
        timestamp: Date.now(),
      });
    }

    return alerts;
  }

  /**
   * Request processing optimization
   */
  private async enhanceRequestWithContext(
    request: EnhancedBatchRequest
  ): Promise<EnhancedBatchRequest> {
    const systemState = this.currentSystemState;
    if (!systemState) return request;

    // Add optimization context
    const enhancedRequest = { ...request };

    // Adjust priority based on system state
    if (systemState.costMetrics.monthlyBudgetUtilization > 0.9 && request.priority !== 'critical') {
      enhancedRequest.priority = request.priority === 'high' ? 'normal' : 'low';
    }

    // Set data freshness based on system load
    if (!request.dataFreshness) {
      if (systemState.performanceMetrics.queueLength > 1000) {
        enhancedRequest.dataFreshness = 'eventual';
      } else if (systemState.performanceMetrics.queueLength > 500) {
        enhancedRequest.dataFreshness = 'near_time';
      } else {
        enhancedRequest.dataFreshness = 'real_time';
      }
    }

    // Enable cross-chain compatibility for cost optimization
    if (!request.crossChainCompatible && request.type in ['balance', 'token_metadata', 'price']) {
      enhancedRequest.crossChainCompatible = true;
    }

    return enhancedRequest;
  }

  private async makeRequestOptimizationDecision(request: EnhancedBatchRequest): Promise<{
    strategy: 'immediate' | 'deduplication' | 'enhanced_batching' | 'cost_optimized';
    reasoning: string;
    confidence: number;
  }> {
    const systemState = this.currentSystemState;

    // Critical requests bypass optimization
    if (request.priority === 'critical') {
      return {
        strategy: 'immediate',
        reasoning: 'critical_priority',
        confidence: 1.0,
      };
    }

    // High cost pressure - use deduplication first
    if (systemState?.costMetrics.monthlyBudgetUtilization > 0.85) {
      return {
        strategy: 'deduplication',
        reasoning: 'high_cost_pressure',
        confidence: 0.9,
      };
    }

    // High queue length - use enhanced batching
    if (systemState?.performanceMetrics.queueLength > 500) {
      return {
        strategy: 'enhanced_batching',
        reasoning: 'high_queue_length',
        confidence: 0.8,
      };
    }

    // Normal conditions - use cost optimized approach
    return {
      strategy: 'cost_optimized',
      reasoning: 'normal_operations',
      confidence: 0.7,
    };
  }

  private async processCostOptimizedRequest(request: EnhancedBatchRequest): Promise<void> {
    // Apply cost-aware processing logic
    const costOptimizationActions = await this.determineCostOptimizationActions(request);

    for (const action of costOptimizationActions) {
      switch (action) {
        case 'check_deduplication':
          const dedupResult = await this.deduplicationService.deduplicateRequest({
            id: request.id,
            type: request.type,
            params: request.params,
            chainId: request.chainId,
            timestamp: request.timestamp,
            userContext: request.requester,
            priority: request.priority,
            callback: request.callback,
            estimatedCost: request.estimatedCost,
          });
          if (dedupResult.isDuplicate) return; // Request handled
          break;

        case 'apply_batching':
          await this.batchingEngine.submitEnhancedRequest(request);
          return;

        case 'route_to_low_cost_provider':
          // Would integrate with provider router
          await this.processWithCostOptimizedProvider(request);
          return;

        default:
          break;
      }
    }

    // Fallback to immediate processing
    await this.processImmediateRequest(request);
  }

  private async determineCostOptimizationActions(request: EnhancedBatchRequest): Promise<string[]> {
    const actions = [];
    const systemState = this.currentSystemState;

    // Always check deduplication first (highest savings)
    actions.push('check_deduplication');

    // Apply batching if beneficial
    if (
      request.type in ['balance', 'token_metadata', 'price'] &&
      systemState?.performanceMetrics.queueLength < 2000
    ) {
      actions.push('apply_batching');
    }

    // Route to low-cost provider if cost pressure is high
    if (systemState?.costMetrics.monthlyBudgetUtilization > 0.75) {
      actions.push('route_to_low_cost_provider');
    }

    return actions;
  }

  private async processWithCostOptimizedProvider(request: EnhancedBatchRequest): Promise<void> {
    // Apply cost-optimized provider routing bias
    const biasKey = `${config.redis.keyPrefix}cost_optimization_bias`;
    await redisManager.set(
      biasKey,
      {
        enabled: true,
        costWeight: 0.9,
        requestId: request.id,
        timestamp: Date.now(),
      },
      300000
    ); // 5 minutes

    // Process the request (would integrate with actual provider system)
    await this.processImmediateRequest(request);
  }

  private async processImmediateRequest(request: EnhancedBatchRequest): Promise<void> {
    // Immediate processing without optimization
    try {
      const result = await this.simulateRequestProcessing(request);
      request.callback(result);
    } catch (error) {
      request.callback(null, error as Error);
    }
  }

  private async simulateRequestProcessing(request: EnhancedBatchRequest): Promise<any> {
    // Simulate processing time
    const processingTime = Math.random() * 500 + 100; // 100-600ms
    await new Promise(resolve => setTimeout(resolve, processingTime));

    return {
      success: true,
      data: `Processed ${request.type} request`,
      processingTime,
    };
  }

  /**
   * Monitoring and analytics
   */
  private monitorPlanExecution(plan: CostOptimizationPlan): void {
    // Set up monitoring checkpoints
    for (let i = 0; i < plan.monitoring.checkpoints.length; i++) {
      const checkpointTime = plan.monitoring.checkpoints[i];
      const delay = checkpointTime - Date.now();

      if (delay > 0) {
        setTimeout(async () => {
          await this.evaluatePlanProgress(plan, i);
        }, delay);
      }
    }

    // Set up final evaluation
    setTimeout(async () => {
      await this.finalizePlanEvaluation(plan);
    }, plan.timeframe);
  }

  private async evaluatePlanProgress(
    plan: CostOptimizationPlan,
    checkpointIndex: number
  ): Promise<void> {
    try {
      await this.updateSystemState();
      const currentState = this.currentSystemState;

      if (!currentState) return;

      // Evaluate against success/failure criteria
      const evaluation = this.evaluateAgainstCriteria(plan, currentState);

      this.contextLogger.info('Plan checkpoint evaluation', {
        planId: plan.planId,
        checkpointIndex,
        evaluation,
      });

      // Take action based on evaluation
      if (evaluation.shouldAdjust) {
        await this.adjustPlanExecution(plan, evaluation);
      }

      if (evaluation.shouldAbort) {
        await this.abortPlan(plan, evaluation.reason);
      }
    } catch (error) {
      logError(error as Error, {
        operation: 'evaluatePlanProgress',
        planId: plan.planId,
        checkpointIndex,
      });
    }
  }

  private evaluateAgainstCriteria(
    plan: CostOptimizationPlan,
    currentState: SystemState
  ): {
    shouldAdjust: boolean;
    shouldAbort: boolean;
    reason?: string;
    adjustments?: string[];
  } {
    const criteria = plan.monitoring;

    // Check failure criteria
    if (currentState.performanceMetrics.errorRate > criteria.failureCriteria.error_rate_spike) {
      return {
        shouldAdjust: false,
        shouldAbort: true,
        reason: `Error rate spike: ${currentState.performanceMetrics.errorRate}`,
      };
    }

    const currentHealth = this.calculateOverallSystemHealth();
    if (currentHealth === 'critical' && criteria.failureCriteria.system_health) {
      return {
        shouldAdjust: false,
        shouldAbort: true,
        reason: 'System health critical',
      };
    }

    // Check for needed adjustments
    const adjustments: string[] = [];

    if (currentState.performanceMetrics.averageResponseTime > 2000) {
      adjustments.push('reduce_batching_timeouts');
    }

    if (currentState.performanceMetrics.queueLength > 5000) {
      adjustments.push('increase_processing_capacity');
    }

    return {
      shouldAdjust: adjustments.length > 0,
      shouldAbort: false,
      adjustments,
    };
  }

  private async adjustPlanExecution(plan: CostOptimizationPlan, evaluation: any): Promise<void> {
    this.contextLogger.info('Adjusting plan execution', {
      planId: plan.planId,
      adjustments: evaluation.adjustments,
    });

    for (const adjustment of evaluation.adjustments || []) {
      switch (adjustment) {
        case 'reduce_batching_timeouts':
          // Reduce batch processing delays
          // Implementation would adjust batching timeouts
          break;

        case 'increase_processing_capacity':
          // Scale up processing if possible
          // Implementation would trigger capacity increases
          break;

        default:
          this.contextLogger.warn('Unknown adjustment type', { adjustment });
      }
    }
  }

  private async abortPlan(plan: CostOptimizationPlan, reason: string): Promise<void> {
    this.contextLogger.error('Aborting optimization plan', {
      planId: plan.planId,
      reason,
    });

    // Execute rollback plan
    for (const strategyId of plan.coordinationPlan.rollbackPlan) {
      try {
        await this.rollbackStrategy(strategyId);
      } catch (error) {
        logError(error as Error, {
          operation: 'rollbackStrategy',
          strategyId,
          planId: plan.planId,
        });
      }
    }

    // Remove from active plans
    this.activeOptimizationPlans.delete(plan.planId);

    this.emit('planAborted', { plan, reason });
  }

  private async rollbackStrategy(strategyId: string): Promise<void> {
    // Remove strategy-specific configurations
    await redisManager.del(`${config.redis.keyPrefix}strategy_${strategyId}`);

    // Strategy-specific rollback logic
    switch (strategyId) {
      case 'aggressive_caching':
        // Restore normal cache TTLs
        // Implementation depends on cache manager
        break;

      case 'enhanced_batching':
        // Restore normal batching configuration
        this.batchingEngine.updateQueueConfig({
          backpressureConfig: {
            enabled: true,
            triggerThreshold: 80000,
            shedPercentage: 0.2,
            recoveryThreshold: 60000,
          },
        });
        break;

      case 'provider_optimization':
        await redisManager.del(`${config.redis.keyPrefix}cost_optimization_bias`);
        break;

      case 'emergency_rate_limiting':
        await redisManager.del(`${config.redis.keyPrefix}emergency_rate_limit`);
        break;

      case 'request_filtering':
        await redisManager.del(`${config.redis.keyPrefix}request_filtering`);
        break;
    }
  }

  private async finalizePlanEvaluation(plan: CostOptimizationPlan): Promise<void> {
    try {
      await this.updateSystemState();

      // Calculate final metrics and effectiveness
      const finalMetrics = await this.calculatePlanEffectiveness(plan);

      // Update strategy metrics
      for (const strategy of plan.strategies) {
        const originalStrategy = this.optimizationStrategies.get(strategy.id);
        if (originalStrategy) {
          originalStrategy.metrics.averageEffectiveness =
            (originalStrategy.metrics.averageEffectiveness + finalMetrics.effectiveness) / 2;
        }
      }

      this.contextLogger.info('Plan finalized', {
        planId: plan.planId,
        finalMetrics,
        duration: Date.now() - plan.createdAt,
      });

      // Clean up
      this.activeOptimizationPlans.delete(plan.planId);

      this.emit('planFinalized', { plan, metrics: finalMetrics });
    } catch (error) {
      logError(error as Error, {
        operation: 'finalizePlanEvaluation',
        planId: plan.planId,
      });
    }
  }

  private async calculatePlanEffectiveness(plan: CostOptimizationPlan): Promise<{
    effectiveness: number;
    actualSavings: number;
    targetAchievement: number;
  }> {
    // Compare before and after metrics
    // This would require storing baseline metrics when plan started

    const actualSavings = plan.strategies.reduce(
      (total, strategy) => total + strategy.metrics.totalSavings,
      0
    );

    const targetAchievement = actualSavings / plan.targetSavings;
    const effectiveness = Math.min(1, targetAchievement);

    return {
      effectiveness,
      actualSavings,
      targetAchievement,
    };
  }

  /**
   * System monitoring and coordination setup
   */
  private setupEventListeners(): void {
    // Listen to cost threshold events
    this.eventSystem.registerHandler<CostThresholdExceededV1>(
      'CostThresholdExceededV1',
      async event => {
        await this.orchestrateOptimization('threshold_exceeded', event.severity as any, {
          provider: event.provider,
          costType: event.costType,
          currentValue: event.currentValue,
          threshold: event.threshold,
        });
      },
      { id: 'orchestrator-cost-threshold', priority: 10 }
    );

    // Listen to performance degradation events
    this.eventSystem.registerHandler<PerformanceDegradationV1>(
      'PerformanceDegradationV1',
      async event => {
        if (event.severity === 'severe') {
          await this.orchestrateOptimization('performance_degradation', 'high', {
            component: event.component,
            metric: event.metric,
            degradationPercentage: event.degradationPercentage,
          });
        }
      },
      { id: 'orchestrator-performance-degradation', priority: 9 }
    );

    // Listen to provider failover events
    this.eventSystem.registerHandler<ProviderFailoverV1>(
      'ProviderFailoverV1',
      async event => {
        if (event.failoverReason === 'cost_optimization') {
          // This was initiated by us, track success
          this.contextLogger.info('Cost optimization failover completed', {
            fromProvider: event.fromProvider,
            toProvider: event.toProvider,
            costImpact: event.costImpact,
          });
        }
      },
      { id: 'orchestrator-provider-failover', priority: 5 }
    );
  }

  private startSystemMonitoring(): void {
    // Update system state every minute
    setInterval(async () => {
      await this.updateSystemState();
    }, 60 * 1000);

    // Check for auto-optimization opportunities every 5 minutes
    setInterval(
      async () => {
        if (this.autoOptimizationEnabled) {
          await this.checkAutoOptimizationOpportunities();
        }
      },
      5 * 60 * 1000
    );
  }

  private async checkAutoOptimizationOpportunities(): Promise<void> {
    try {
      const systemState = this.currentSystemState;
      if (!systemState) return;

      // Auto-trigger based on thresholds
      if (systemState.costMetrics.monthlyBudgetUtilization > 0.8) {
        await this.orchestrateOptimization('predictive', 'medium', {
          trigger_reason: 'budget_utilization_high',
          utilization: systemState.costMetrics.monthlyBudgetUtilization,
        });
      }

      if (systemState.performanceMetrics.queueLength > 2000) {
        await this.orchestrateOptimization('predictive', 'medium', {
          trigger_reason: 'queue_length_high',
          queueLength: systemState.performanceMetrics.queueLength,
        });
      }
    } catch (error) {
      logError(error as Error, { operation: 'checkAutoOptimizationOpportunities' });
    }
  }

  private startPredictiveAnalytics(): void {
    if (!this.predictiveEnabled) return;

    // Update predictive analytics every 10 minutes
    setInterval(
      async () => {
        await this.updatePredictiveAnalytics();
      },
      10 * 60 * 1000
    );
  }

  private async updatePredictiveAnalytics(): Promise<void> {
    try {
      const systemState = this.currentSystemState;
      if (!systemState) return;

      // Simplified predictive analytics
      const currentHourlyCost = systemState.costMetrics.currentHourlyCost;
      const costTrend = systemState.costMetrics.costTrend;

      let trendMultiplier = 1.0;
      switch (costTrend) {
        case 'increasing':
          trendMultiplier = 1.2;
          break;
        case 'decreasing':
          trendMultiplier = 0.8;
          break;
      }

      this.predictiveAnalytics = {
        costForecast: {
          nextHour: currentHourlyCost * trendMultiplier,
          next6Hours: currentHourlyCost * 6 * trendMultiplier,
          nextDay: currentHourlyCost * 24 * trendMultiplier,
          confidence: 0.7,
        },
        budgetProjection: {
          dailyUtilization: systemState.costMetrics.dailyBudgetUtilization,
          monthlyUtilization: systemState.costMetrics.monthlyBudgetUtilization,
          daysUntilExhaustion: this.calculateDaysUntilBudgetExhaustion(systemState),
          projectedOverspend: this.calculateProjectedOverspend(systemState),
        },
        optimizationOpportunities: await this.identifyOptimizationOpportunities(systemState),
        anomalyDetection: {
          costAnomalies: [],
          performanceAnomalies: [],
          usagePatternChanges: [],
        },
      };

      this.orchestratorMetrics.lastAnalysisTime = Date.now();
    } catch (error) {
      logError(error as Error, { operation: 'updatePredictiveAnalytics' });
    }
  }

  private calculateDaysUntilBudgetExhaustion(systemState: SystemState): number | null {
    const dailyCost = systemState.costMetrics.currentHourlyCost * 24;
    const remainingBudget =
      config.costs.monthlyBudget * (1 - systemState.costMetrics.monthlyBudgetUtilization);

    if (dailyCost <= 0) return null;

    return Math.floor(remainingBudget / dailyCost);
  }

  private calculateProjectedOverspend(systemState: SystemState): number {
    const currentUtilization = systemState.costMetrics.monthlyBudgetUtilization;
    const daysInMonth = 30;
    const currentDay = new Date().getDate();
    const projectedUtilization = (currentUtilization / currentDay) * daysInMonth;

    return Math.max(0, projectedUtilization - 1) * config.costs.monthlyBudget;
  }

  private async identifyOptimizationOpportunities(systemState: SystemState): Promise<any[]> {
    const opportunities = [];

    if (systemState.performanceMetrics.cacheHitRate < 0.7) {
      opportunities.push({
        type: 'cache_optimization',
        potentialSavings: (0.7 - systemState.performanceMetrics.cacheHitRate) * 100,
        implementationComplexity: 'low',
        expectedImpact: 'Increase cache hit rate and reduce API calls',
        confidence: 0.8,
      });
    }

    if (systemState.optimizationMetrics.deduplicationRate < 20) {
      opportunities.push({
        type: 'deduplication_enhancement',
        potentialSavings: (20 - systemState.optimizationMetrics.deduplicationRate) * 2,
        implementationComplexity: 'medium',
        expectedImpact: 'Reduce redundant API requests',
        confidence: 0.7,
      });
    }

    return opportunities;
  }

  /**
   * Conflict detection and resolution
   */
  private async detectStrategyConflicts(plan: CostOptimizationPlan): Promise<
    Array<{
      type: string;
      conflictingStrategies: string[];
      severity: 'low' | 'medium' | 'high';
    }>
  > {
    const conflicts = [];

    // Check for conflicts with active plans
    for (const activePlan of this.activeOptimizationPlans.values()) {
      if (activePlan.planId === plan.planId) continue;

      const conflictingStrategies = plan.strategies
        .filter(strategy =>
          activePlan.strategies.some(activeStrategy =>
            this.strategiesConflict(strategy, activeStrategy)
          )
        )
        .map(s => s.id);

      if (conflictingStrategies.length > 0) {
        conflicts.push({
          type: 'active_plan_conflict',
          conflictingStrategies,
          severity: plan.severity === 'critical' ? 'high' : 'medium',
        });
      }
    }

    return conflicts;
  }

  private strategiesConflict(
    strategy1: OptimizationStrategy,
    strategy2: OptimizationStrategy
  ): boolean {
    // Define conflicting strategy pairs
    const conflictPairs = [
      ['emergency_rate_limiting', 'enhanced_batching'], // Rate limiting conflicts with batching
      ['request_filtering', 'aggressive_caching'], // Filtering may prevent cache population
    ];

    return conflictPairs.some(pair => pair.includes(strategy1.id) && pair.includes(strategy2.id));
  }

  private async resolveStrategyConflicts(
    conflicts: Array<{ type: string; conflictingStrategies: string[]; severity: string }>,
    plan: CostOptimizationPlan
  ): Promise<void> {
    for (const conflict of conflicts) {
      const resolutionMethod = this.determineConflictResolution(conflict, plan);

      switch (resolutionMethod) {
        case 'override':
          // New plan overrides existing
          await this.overrideConflictingStrategies(conflict.conflictingStrategies);
          break;

        case 'merge':
          // Attempt to merge strategies
          await this.mergeConflictingStrategies(conflict.conflictingStrategies, plan);
          break;

        case 'skip':
          // Skip conflicting strategies in new plan
          plan.strategies = plan.strategies.filter(
            s => !conflict.conflictingStrategies.includes(s.id)
          );
          break;
      }

      this.activeConflicts.set(conflict.type, {
        strategies: conflict.conflictingStrategies,
        resolution: 'resolved',
        resolutionMethod,
        timestamp: Date.now(),
      });
    }
  }

  private determineConflictResolution(
    conflict: { type: string; severity: string },
    plan: CostOptimizationPlan
  ): 'override' | 'merge' | 'skip' {
    // Critical plans override everything
    if (plan.severity === 'critical') {
      return 'override';
    }

    // High severity conflicts require careful resolution
    if (conflict.severity === 'high') {
      return plan.severity === 'high' ? 'override' : 'skip';
    }

    return 'merge';
  }

  private async overrideConflictingStrategies(conflictingStrategies: string[]): Promise<void> {
    // Remove conflicting strategies from active plans
    for (const activePlan of this.activeOptimizationPlans.values()) {
      activePlan.strategies = activePlan.strategies.filter(
        s => !conflictingStrategies.includes(s.id)
      );
    }
  }

  private async mergeConflictingStrategies(
    conflictingStrategies: string[],
    plan: CostOptimizationPlan
  ): Promise<void> {
    // Attempt to adjust strategy parameters to reduce conflicts
    for (const strategyId of conflictingStrategies) {
      const strategy = plan.strategies.find(s => s.id === strategyId);
      if (strategy) {
        // Reduce aggressiveness to minimize conflicts
        strategy.conditions.costThreshold = (strategy.conditions.costThreshold || 0.8) + 0.1;
        strategy.expectedSavings.cost *= 0.8; // Reduce expected impact
      }
    }
  }

  /**
   * Helper methods
   */
  private async updateRequestProcessingMetrics(decision: any): Promise<void> {
    // Track request processing decisions for optimization
    const key = `${config.redis.keyPrefix}request_decisions`;
    await redisManager.lpush(key, {
      strategy: decision.strategy,
      reasoning: decision.reasoning,
      confidence: decision.confidence,
      timestamp: Date.now(),
    });

    // Keep only last 1000 decisions
    await redisManager.ltrim(key, 0, 999);
  }

  private async generateRecommendations(): Promise<
    Array<{
      type: string;
      priority: 'low' | 'medium' | 'high' | 'critical';
      description: string;
      expectedImpact: string;
      implementationSteps: string[];
    }>
  > {
    const recommendations = [];
    const systemState = this.currentSystemState;

    if (!systemState) return recommendations;

    // Budget utilization recommendations
    if (systemState.costMetrics.monthlyBudgetUtilization > 0.75) {
      recommendations.push({
        type: 'cost_optimization',
        priority: systemState.costMetrics.monthlyBudgetUtilization > 0.9 ? 'critical' : 'high',
        description: 'Monthly budget utilization is high, implement aggressive cost optimization',
        expectedImpact: '20-40% cost reduction possible',
        implementationSteps: [
          'Enable advanced request deduplication',
          'Implement aggressive caching policies',
          'Optimize provider routing for cost',
          'Consider request filtering for non-essential data',
        ],
      });
    }

    // Performance recommendations
    if (systemState.performanceMetrics.cacheHitRate < 0.6) {
      recommendations.push({
        type: 'performance_optimization',
        priority: 'medium',
        description: 'Cache hit rate is below optimal threshold',
        expectedImpact: 'Improve response times by 25-40%',
        implementationSteps: [
          'Analyze cache patterns and optimize TTLs',
          'Implement predictive cache warming',
          'Review cache key strategies',
          'Consider expanding cache storage',
        ],
      });
    }

    return recommendations;
  }

  private getActiveOptimizationSummary(): Array<{
    planId: string;
    strategy: string;
    status: string;
    savings: number;
    startedAt: number;
  }> {
    return Array.from(this.activeOptimizationPlans.values()).map(plan => ({
      planId: plan.planId,
      strategy: plan.strategies.map(s => s.name).join(', '),
      status: 'active',
      savings: plan.strategies.reduce((total, s) => total + s.metrics.totalSavings, 0),
      startedAt: plan.createdAt,
    }));
  }

  private startOrchestration(): void {
    this.contextLogger.info('Cost Reduction Orchestrator initialized', {
      strategiesCount: this.optimizationStrategies.size,
      enabled: this.enabled,
      aggressivenessLevel: this.aggressivenessLevel,
      coordinationEnabled: this.coordinationEnabled,
      predictiveEnabled: this.predictiveEnabled,
      autoOptimizationEnabled: this.autoOptimizationEnabled,
    });
  }

  // Public API methods

  /**
   * Get orchestrator metrics and status
   */
  getOrchestratorStatus(): {
    metrics: typeof this.orchestratorMetrics;
    activeStrategies: number;
    activePlans: number;
    systemHealth: string;
    lastSystemUpdate: number;
  } {
    return {
      metrics: { ...this.orchestratorMetrics },
      activeStrategies: Array.from(this.optimizationStrategies.values()).filter(s => s.enabled)
        .length,
      activePlans: this.activeOptimizationPlans.size,
      systemHealth: this.currentSystemState?.systemHealth.overall || 'unknown',
      lastSystemUpdate: this.currentSystemState?.timestamp || 0,
    };
  }

  /**
   * Configure orchestrator settings
   */
  configure(settings: {
    enabled?: boolean;
    aggressivenessLevel?: number;
    coordinationEnabled?: boolean;
    predictiveEnabled?: boolean;
    autoOptimizationEnabled?: boolean;
  }): void {
    Object.assign(this, settings);
    this.contextLogger.info('Orchestrator configuration updated', settings);
  }

  /**
   * Enable/disable specific strategy
   */
  setStrategyEnabled(strategyId: string, enabled: boolean): void {
    const strategy = this.optimizationStrategies.get(strategyId);
    if (strategy) {
      strategy.enabled = enabled;
      this.contextLogger.info('Strategy enabled/disabled', { strategyId, enabled });
    }
  }

  /**
   * Get strategy performance metrics
   */
  getStrategyMetrics(strategyId?: string): any {
    if (strategyId) {
      return this.optimizationStrategies.get(strategyId)?.metrics;
    }

    const metrics: Record<string, any> = {};
    for (const [id, strategy] of this.optimizationStrategies) {
      metrics[id] = strategy.metrics;
    }
    return metrics;
  }

  /**
   * Force system state update
   */
  async forceSystemUpdate(): Promise<SystemState | null> {
    await this.updateSystemState();
    return this.currentSystemState;
  }
}

// Export singleton instance
let orchestratorInstance: CostReductionOrchestrator | null = null;

export const getCostReductionOrchestrator = (): CostReductionOrchestrator => {
  if (!orchestratorInstance) {
    orchestratorInstance = new CostReductionOrchestrator();
  }
  return orchestratorInstance;
};

export default getCostReductionOrchestrator;
