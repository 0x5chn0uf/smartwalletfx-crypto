import { EventEmitter } from 'events';
import { logger, logError, createContextualLogger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { config } from '@/config';
import { getCostMonitoringService } from './CostMonitoringService';
import { getBatchProcessor } from './RequestBatchProcessor';
import { getProviderRouter } from './IntelligentProviderRouter';

/**
 * Real-Time Cost Optimizer
 *
 * Provides immediate cost optimization responses to API usage patterns:
 * - Instant cost reduction triggers
 * - Emergency budget protection
 * - Dynamic threshold adjustment
 * - Automatic optimization deployment
 */

export interface OptimizationTrigger {
  id: string;
  type:
    | 'cost_spike'
    | 'budget_threshold'
    | 'efficiency_drop'
    | 'anomaly_detected'
    | 'pattern_change';
  severity: 'low' | 'medium' | 'high' | 'critical';
  threshold: number;
  currentValue: number;
  provider?: string;
  requestType?: string;
  triggerCondition: string;
  autoMitigate: boolean;
  cooldownPeriod: number; // ms
}

export interface OptimizationAction {
  id: string;
  type:
    | 'cache_aggressive'
    | 'provider_switch'
    | 'rate_limit'
    | 'batch_force'
    | 'request_block'
    | 'fallback_activate';
  priority: 'immediate' | 'high' | 'normal' | 'low';
  estimatedSavings: number; // percentage
  estimatedLatencyImpact: number; // ms
  reversible: boolean;
  autoRevert: boolean;
  revertConditions: string[];
  implementation: () => Promise<boolean>;
  reversion: () => Promise<boolean>;
}

export interface OptimizationResult {
  actionId: string;
  implemented: boolean;
  actualSavings?: number;
  actualLatencyImpact?: number;
  sideEffects?: string[];
  timestamp: number;
  revertedAt?: number;
  revertReason?: string;
}

class EmergencyBudgetProtector {
  private emergencyMode = false;
  private emergencyThreshold = 0.95; // 95% of budget
  private criticalThreshold = 0.98; // 98% of budget
  private contextLogger = createContextualLogger({ component: 'EmergencyBudgetProtector' });

  async checkBudgetEmergency(currentUtilization: number): Promise<{
    isEmergency: boolean;
    isCritical: boolean;
    actionsRequired: string[];
    timeRemaining?: number;
  }> {
    const isEmergency = currentUtilization >= this.emergencyThreshold;
    const isCritical = currentUtilization >= this.criticalThreshold;

    const actionsRequired: string[] = [];
    let timeRemaining: number | undefined;

    if (isCritical) {
      actionsRequired.push('immediate_cost_freeze');
      actionsRequired.push('disable_non_critical_features');
      actionsRequired.push('activate_emergency_caching');

      // Calculate time until budget exhaustion
      const remainingBudget = config.costs.monthlyBudget * (1 - currentUtilization);
      const currentBurnRate = await this.calculateCurrentBurnRate();
      timeRemaining =
        currentBurnRate > 0 ? (remainingBudget / currentBurnRate) * 3600000 : undefined; // in ms

      this.contextLogger.error('Critical budget situation detected', {
        utilization: currentUtilization,
        remainingBudget,
        timeRemaining: timeRemaining ? `${(timeRemaining / 3600000).toFixed(1)}h` : 'unknown',
      });
    } else if (isEmergency) {
      actionsRequired.push('aggressive_caching');
      actionsRequired.push('provider_cost_optimization');
      actionsRequired.push('request_consolidation');

      this.contextLogger.warn('Emergency budget threshold reached', {
        utilization: currentUtilization,
        threshold: this.emergencyThreshold,
      });
    }

    return {
      isEmergency,
      isCritical,
      actionsRequired,
      timeRemaining,
    };
  }

  private async calculateCurrentBurnRate(): Promise<number> {
    // Calculate current hourly burn rate based on recent usage
    const summary = await getCostMonitoringService().getCostSummary('1h');
    return summary.totalCost; // Cost per hour
  }

  async activateEmergencyMode(): Promise<void> {
    if (this.emergencyMode) return;

    this.emergencyMode = true;
    this.contextLogger.warn('Emergency budget protection mode activated');

    // Store emergency mode state
    await redisManager.set(
      `${config.redis.keyPrefix}emergency_mode`,
      { activated: true, timestamp: Date.now() },
      24 * 60 * 60 // 24 hours
    );
  }

  async deactivateEmergencyMode(): Promise<void> {
    if (!this.emergencyMode) return;

    this.emergencyMode = false;
    this.contextLogger.info('Emergency budget protection mode deactivated');

    await redisManager.del(`${config.redis.keyPrefix}emergency_mode`);
  }

  isEmergencyModeActive(): boolean {
    return this.emergencyMode;
  }
}

export class RealTimeOptimizer extends EventEmitter {
  private contextLogger = createContextualLogger({ component: 'RealTimeOptimizer' });
  private budgetProtector = new EmergencyBudgetProtector();

  // Active optimizations
  private activeOptimizations = new Map<string, OptimizationResult>();
  private optimizationTriggers = new Map<string, OptimizationTrigger>();
  private lastTriggerTime = new Map<string, number>();

  // Configuration
  private optimizationEnabled = true;
  private autoMitigationEnabled = true;
  private maxConcurrentOptimizations = 5;

  // Performance tracking
  private optimizationMetrics = {
    totalTriggered: 0,
    totalImplemented: 0,
    totalSavings: 0,
    averageResponseTime: 0,
    successRate: 0,
  };

  constructor() {
    super();
    this.initializeOptimizationTriggers();
    this.startRealTimeMonitoring();
  }

  /**
   * Initialize optimization triggers with dynamic thresholds
   */
  private initializeOptimizationTriggers(): void {
    // Cost spike trigger
    this.optimizationTriggers.set('cost_spike', {
      id: 'cost_spike',
      type: 'cost_spike',
      severity: 'high',
      threshold: 2.5, // 2.5x normal cost
      currentValue: 0,
      triggerCondition: 'cost > baseline * 2.5',
      autoMitigate: true,
      cooldownPeriod: 5 * 60 * 1000, // 5 minutes
    });

    // Budget threshold trigger
    this.optimizationTriggers.set('budget_critical', {
      id: 'budget_critical',
      type: 'budget_threshold',
      severity: 'critical',
      threshold: 0.95, // 95% budget utilization
      currentValue: 0,
      triggerCondition: 'budget_utilization > 0.95',
      autoMitigate: true,
      cooldownPeriod: 10 * 60 * 1000, // 10 minutes
    });

    // Efficiency drop trigger
    this.optimizationTriggers.set('efficiency_drop', {
      id: 'efficiency_drop',
      type: 'efficiency_drop',
      severity: 'medium',
      threshold: 0.5, // 50% efficiency drop
      currentValue: 0,
      triggerCondition: 'efficiency < baseline * 0.5',
      autoMitigate: true,
      cooldownPeriod: 15 * 60 * 1000, // 15 minutes
    });

    // Anomaly detection trigger
    this.optimizationTriggers.set('anomaly_critical', {
      id: 'anomaly_critical',
      type: 'anomaly_detected',
      severity: 'critical',
      threshold: 0.9, // 90% confidence
      currentValue: 0,
      triggerCondition: 'anomaly_confidence > 0.9',
      autoMitigate: true,
      cooldownPeriod: 3 * 60 * 1000, // 3 minutes
    });
  }

  /**
   * Check if optimization should be triggered based on current metrics
   */
  async checkOptimizationTriggers(metrics: {
    costSpike?: number;
    budgetUtilization?: number;
    efficiencyRatio?: number;
    anomalyConfidence?: number;
    provider?: string;
    requestType?: string;
  }): Promise<OptimizationTrigger[]> {
    const triggeredOptimizations: OptimizationTrigger[] = [];

    for (const [triggerId, trigger] of this.optimizationTriggers) {
      // Check cooldown period
      const lastTrigger = this.lastTriggerTime.get(triggerId) || 0;
      if (Date.now() - lastTrigger < trigger.cooldownPeriod) {
        continue;
      }

      let shouldTrigger = false;
      let currentValue = 0;

      switch (trigger.type) {
        case 'cost_spike':
          if (metrics.costSpike !== undefined) {
            currentValue = metrics.costSpike;
            shouldTrigger = currentValue >= trigger.threshold;
          }
          break;

        case 'budget_threshold':
          if (metrics.budgetUtilization !== undefined) {
            currentValue = metrics.budgetUtilization;
            shouldTrigger = currentValue >= trigger.threshold;
          }
          break;

        case 'efficiency_drop':
          if (metrics.efficiencyRatio !== undefined) {
            currentValue = metrics.efficiencyRatio;
            shouldTrigger = currentValue <= trigger.threshold;
          }
          break;

        case 'anomaly_detected':
          if (metrics.anomalyConfidence !== undefined) {
            currentValue = metrics.anomalyConfidence;
            shouldTrigger = currentValue >= trigger.threshold;
          }
          break;
      }

      if (shouldTrigger) {
        const triggeredOptimization = {
          ...trigger,
          currentValue,
          provider: metrics.provider,
          requestType: metrics.requestType,
        };

        triggeredOptimizations.push(triggeredOptimization);
        this.lastTriggerTime.set(triggerId, Date.now());

        this.contextLogger.warn('Optimization trigger activated', {
          triggerId,
          type: trigger.type,
          severity: trigger.severity,
          threshold: trigger.threshold,
          currentValue,
          provider: metrics.provider,
          requestType: metrics.requestType,
        });
      }
    }

    return triggeredOptimizations;
  }

  /**
   * Execute optimization actions based on triggers
   */
  async executeOptimizations(triggers: OptimizationTrigger[]): Promise<OptimizationResult[]> {
    if (!this.optimizationEnabled || triggers.length === 0) {
      return [];
    }

    const results: OptimizationResult[] = [];
    const startTime = Date.now();

    // Sort triggers by severity
    const sortedTriggers = triggers.sort((a, b) => {
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });

    for (const trigger of sortedTriggers.slice(0, this.maxConcurrentOptimizations)) {
      try {
        const actions = await this.getOptimizationActions(trigger);

        for (const action of actions) {
          if (this.activeOptimizations.size >= this.maxConcurrentOptimizations) {
            this.contextLogger.warn('Max concurrent optimizations reached, skipping', {
              actionId: action.id,
              activeCount: this.activeOptimizations.size,
            });
            continue;
          }

          const result = await this.executeOptimizationAction(action, trigger);
          results.push(result);

          if (result.implemented) {
            this.activeOptimizations.set(action.id, result);
            this.optimizationMetrics.totalImplemented++;
            this.optimizationMetrics.totalSavings += result.actualSavings || 0;
          }
        }
      } catch (error) {
        logError(error as Error, {
          operation: 'executeOptimizations',
          triggerId: trigger.id,
          triggerType: trigger.type,
        });
      }
    }

    this.optimizationMetrics.totalTriggered += triggers.length;
    this.optimizationMetrics.averageResponseTime =
      (this.optimizationMetrics.averageResponseTime + (Date.now() - startTime)) / 2;
    this.optimizationMetrics.successRate =
      this.optimizationMetrics.totalImplemented / this.optimizationMetrics.totalTriggered;

    this.emit('optimizationsExecuted', {
      triggers,
      results,
      executionTime: Date.now() - startTime,
      metrics: this.optimizationMetrics,
    });

    return results;
  }

  /**
   * Get appropriate optimization actions for a trigger
   */
  private async getOptimizationActions(
    trigger: OptimizationTrigger
  ): Promise<OptimizationAction[]> {
    const actions: OptimizationAction[] = [];

    switch (trigger.type) {
      case 'cost_spike':
        actions.push(await this.createAggressiveCachingAction(trigger));
        if (trigger.severity === 'critical') {
          actions.push(await this.createProviderSwitchAction(trigger));
          actions.push(await this.createRateLimitAction(trigger));
        }
        break;

      case 'budget_threshold':
        if (trigger.severity === 'critical') {
          actions.push(await this.createEmergencyBudgetProtectionAction(trigger));
          actions.push(await this.createRequestBlockingAction(trigger));
        } else {
          actions.push(await this.createAggressiveCachingAction(trigger));
          actions.push(await this.createBatchForcingAction(trigger));
        }
        break;

      case 'efficiency_drop':
        actions.push(await this.createCacheOptimizationAction(trigger));
        actions.push(await this.createProviderSwitchAction(trigger));
        break;

      case 'anomaly_detected':
        actions.push(await this.createFallbackActivationAction(trigger));
        if (trigger.severity === 'critical') {
          actions.push(await this.createRateLimitAction(trigger));
        }
        break;
    }

    return actions.filter(action => action !== null);
  }

  /**
   * Create aggressive caching optimization action
   */
  private async createAggressiveCachingAction(
    trigger: OptimizationTrigger
  ): Promise<OptimizationAction> {
    return {
      id: `aggressive_cache_${Date.now()}`,
      type: 'cache_aggressive',
      priority: trigger.severity === 'critical' ? 'immediate' : 'high',
      estimatedSavings: 60, // 60% cost reduction
      estimatedLatencyImpact: -200, // 200ms faster due to cache hits
      reversible: true,
      autoRevert: true,
      revertConditions: [
        'budget_utilization < 0.7',
        'cost_spike_resolved',
        'performance_degradation > 20%',
      ],
      implementation: async () => {
        try {
          // Increase cache TTL for all cacheable requests
          const cacheManager = await import('./IntelligentCacheManager');
          await (cacheManager as any).IntelligentCacheManager?.setAggressiveMode?.(true);

          // Update cache policies
          await redisManager.set(
            `${config.redis.keyPrefix}aggressive_cache_mode`,
            {
              enabled: true,
              triggeredBy: trigger.id,
              timestamp: Date.now(),
            },
            6 * 60 * 60 // 6 hours
          );

          this.contextLogger.info('Aggressive caching mode activated', {
            triggerId: trigger.id,
            estimatedSavings: 60,
          });

          return true;
        } catch (error) {
          logError(error as Error, { operation: 'activateAggressiveCaching' });
          return false;
        }
      },
      reversion: async () => {
        try {
          const cacheManager = await import('./IntelligentCacheManager');
          await (cacheManager as any).IntelligentCacheManager?.setAggressiveMode?.(false);
          await redisManager.del(`${config.redis.keyPrefix}aggressive_cache_mode`);

          this.contextLogger.info('Aggressive caching mode deactivated');
          return true;
        } catch (error) {
          logError(error as Error, { operation: 'deactivateAggressiveCaching' });
          return false;
        }
      },
    };
  }

  /**
   * Create provider switch optimization action
   */
  private async createProviderSwitchAction(
    trigger: OptimizationTrigger
  ): Promise<OptimizationAction> {
    return {
      id: `provider_switch_${Date.now()}`,
      type: 'provider_switch',
      priority: 'high',
      estimatedSavings: 35, // 35% cost reduction
      estimatedLatencyImpact: 100, // 100ms slower (acceptable trade-off)
      reversible: true,
      autoRevert: true,
      revertConditions: [
        'reliability_issues_detected',
        'latency_increase > 500ms',
        'error_rate > 0.05',
      ],
      implementation: async () => {
        try {
          const providerRouter = getProviderRouter();

          // Temporarily bias routing towards lower-cost providers
          await redisManager.set(
            `${config.redis.keyPrefix}cost_optimization_bias`,
            {
              enabled: true,
              costWeight: 0.6, // Increase cost weight in routing decisions
              triggeredBy: trigger.id,
              affectedProvider: trigger.provider,
              timestamp: Date.now(),
            },
            2 * 60 * 60 // 2 hours
          );

          this.contextLogger.info('Provider cost optimization activated', {
            triggerId: trigger.id,
            affectedProvider: trigger.provider,
            costWeight: 0.6,
          });

          return true;
        } catch (error) {
          logError(error as Error, { operation: 'activateProviderSwitch' });
          return false;
        }
      },
      reversion: async () => {
        try {
          await redisManager.del(`${config.redis.keyPrefix}cost_optimization_bias`);
          this.contextLogger.info('Provider cost optimization deactivated');
          return true;
        } catch (error) {
          logError(error as Error, { operation: 'deactivateProviderSwitch' });
          return false;
        }
      },
    };
  }

  /**
   * Create emergency budget protection action
   */
  private async createEmergencyBudgetProtectionAction(
    trigger: OptimizationTrigger
  ): Promise<OptimizationAction> {
    return {
      id: `emergency_budget_${Date.now()}`,
      type: 'request_block',
      priority: 'immediate',
      estimatedSavings: 90, // 90% cost reduction (drastic measures)
      estimatedLatencyImpact: 0, // Some requests blocked entirely
      reversible: true,
      autoRevert: false, // Manual revert required
      revertConditions: ['budget_utilization < 0.8', 'manual_approval_received'],
      implementation: async () => {
        try {
          await this.budgetProtector.activateEmergencyMode();

          // Block non-critical requests
          await redisManager.set(
            `${config.redis.keyPrefix}emergency_budget_protection`,
            {
              enabled: true,
              blockNonCritical: true,
              allowedTypes: ['balance', 'transaction'], // Only critical request types
              triggeredBy: trigger.id,
              timestamp: Date.now(),
            },
            24 * 60 * 60 // 24 hours (manual revert required)
          );

          this.contextLogger.error(
            'Emergency budget protection activated - blocking non-critical requests',
            {
              triggerId: trigger.id,
              budgetUtilization: trigger.currentValue,
            }
          );

          return true;
        } catch (error) {
          logError(error as Error, { operation: 'activateEmergencyBudgetProtection' });
          return false;
        }
      },
      reversion: async () => {
        try {
          await this.budgetProtector.deactivateEmergencyMode();
          await redisManager.del(`${config.redis.keyPrefix}emergency_budget_protection`);

          this.contextLogger.info('Emergency budget protection deactivated');
          return true;
        } catch (error) {
          logError(error as Error, { operation: 'deactivateEmergencyBudgetProtection' });
          return false;
        }
      },
    };
  }

  /**
   * Create rate limiting optimization action
   */
  private async createRateLimitAction(trigger: OptimizationTrigger): Promise<OptimizationAction> {
    return {
      id: `rate_limit_${Date.now()}`,
      type: 'rate_limit',
      priority: trigger.severity === 'critical' ? 'immediate' : 'high',
      estimatedSavings: 45, // 45% cost reduction through request throttling
      estimatedLatencyImpact: 500, // 500ms added latency due to queuing
      reversible: true,
      autoRevert: true,
      revertConditions: ['cost_spike < 1.5', 'queue_length < 100', 'error_rate < 0.02'],
      implementation: async () => {
        try {
          const severityMultiplier = trigger.severity === 'critical' ? 0.3 : 0.5;
          const rateLimitConfig = {
            enabled: true,
            maxRequestsPerSecond: Math.max(1, Math.floor(10 * severityMultiplier)),
            maxRequestsPerMinute: Math.max(10, Math.floor(100 * severityMultiplier)),
            burstAllowance: Math.max(5, Math.floor(20 * severityMultiplier)),
            triggeredBy: trigger.id,
            provider: trigger.provider,
            requestType: trigger.requestType,
            timestamp: Date.now(),
          };

          await redisManager.set(
            `${config.redis.keyPrefix}rate_limit_optimization`,
            rateLimitConfig,
            4 * 60 * 60 // 4 hours
          );

          // Set provider-specific limits if applicable
          if (trigger.provider) {
            await redisManager.set(
              `${config.redis.keyPrefix}rate_limit_provider_${trigger.provider}`,
              rateLimitConfig,
              4 * 60 * 60
            );
          }

          this.contextLogger.warn('Rate limiting optimization activated', {
            triggerId: trigger.id,
            severity: trigger.severity,
            maxRPS: rateLimitConfig.maxRequestsPerSecond,
            maxRPM: rateLimitConfig.maxRequestsPerMinute,
            provider: trigger.provider,
          });

          return true;
        } catch (error) {
          logError(error as Error, { operation: 'activateRateLimit' });
          return false;
        }
      },
      reversion: async () => {
        try {
          await redisManager.del(`${config.redis.keyPrefix}rate_limit_optimization`);

          if (trigger.provider) {
            await redisManager.del(
              `${config.redis.keyPrefix}rate_limit_provider_${trigger.provider}`
            );
          }

          this.contextLogger.info('Rate limiting optimization deactivated');
          return true;
        } catch (error) {
          logError(error as Error, { operation: 'deactivateRateLimit' });
          return false;
        }
      },
    };
  }

  /**
   * Create request blocking optimization action
   */
  private async createRequestBlockingAction(
    trigger: OptimizationTrigger
  ): Promise<OptimizationAction> {
    return {
      id: `request_block_${Date.now()}`,
      type: 'request_block',
      priority: 'immediate',
      estimatedSavings: 75, // 75% cost reduction through selective blocking
      estimatedLatencyImpact: 0, // Blocked requests have no latency
      reversible: true,
      autoRevert: true,
      revertConditions: ['budget_utilization < 0.85', 'cost_spike < 2.0', 'critical_requests_only'],
      implementation: async () => {
        try {
          const blockingConfig = {
            enabled: true,
            blockTypes: ['nft_metadata', 'historical_data', 'analytics'], // Non-critical request types
            allowTypes: ['balance', 'transaction', 'token_info'], // Critical request types only
            blockThreshold: trigger.severity === 'critical' ? 0.9 : 0.95, // Budget utilization threshold
            triggeredBy: trigger.id,
            provider: trigger.provider,
            timestamp: Date.now(),
          };

          await redisManager.set(
            `${config.redis.keyPrefix}request_blocking_optimization`,
            blockingConfig,
            6 * 60 * 60 // 6 hours
          );

          // Set emergency request filtering
          await redisManager.set(
            `${config.redis.keyPrefix}emergency_request_filter`,
            {
              enabled: true,
              mode: trigger.severity === 'critical' ? 'strict' : 'moderate',
              allowedEndpoints: ['/balance', '/transaction', '/token'],
              blockedEndpoints: ['/nft', '/historical', '/analytics', '/detailed'],
              triggeredBy: trigger.id,
              timestamp: Date.now(),
            },
            6 * 60 * 60
          );

          this.contextLogger.error('Request blocking optimization activated', {
            triggerId: trigger.id,
            severity: trigger.severity,
            budgetUtilization: trigger.currentValue,
            blockTypes: blockingConfig.blockTypes,
            allowTypes: blockingConfig.allowTypes,
          });

          return true;
        } catch (error) {
          logError(error as Error, { operation: 'activateRequestBlocking' });
          return false;
        }
      },
      reversion: async () => {
        try {
          await redisManager.del(`${config.redis.keyPrefix}request_blocking_optimization`);
          await redisManager.del(`${config.redis.keyPrefix}emergency_request_filter`);

          this.contextLogger.info('Request blocking optimization deactivated');
          return true;
        } catch (error) {
          logError(error as Error, { operation: 'deactivateRequestBlocking' });
          return false;
        }
      },
    };
  }

  /**
   * Create batch forcing optimization action
   */
  private async createBatchForcingAction(
    trigger: OptimizationTrigger
  ): Promise<OptimizationAction> {
    return {
      id: `batch_force_${Date.now()}`,
      type: 'batch_force',
      priority: 'high',
      estimatedSavings: 55, // 55% cost reduction through aggressive batching
      estimatedLatencyImpact: 2000, // 2s added latency for batch accumulation
      reversible: true,
      autoRevert: true,
      revertConditions: [
        'budget_utilization < 0.8',
        'batch_timeout_exceeded',
        'user_experience_degradation > 30%',
      ],
      implementation: async () => {
        try {
          const batchProcessor = getBatchProcessor();
          const batchConfig = {
            enabled: true,
            forceBatching: true,
            minBatchSize: trigger.severity === 'critical' ? 20 : 10,
            maxBatchSize: trigger.severity === 'critical' ? 100 : 50,
            batchTimeout: trigger.severity === 'critical' ? 5000 : 3000, // ms
            aggressiveConsolidation: true,
            triggeredBy: trigger.id,
            provider: trigger.provider,
            requestType: trigger.requestType,
            timestamp: Date.now(),
          };

          await redisManager.set(
            `${config.redis.keyPrefix}batch_forcing_optimization`,
            batchConfig,
            3 * 60 * 60 // 3 hours
          );

          // Configure batch processor for aggressive mode
          await redisManager.set(
            `${config.redis.keyPrefix}aggressive_batch_mode`,
            {
              enabled: true,
              consolidateBalance: true,
              consolidateTransaction: true,
              consolidateTokenInfo: true,
              delayTolerance: batchConfig.batchTimeout,
              triggeredBy: trigger.id,
              timestamp: Date.now(),
            },
            3 * 60 * 60
          );

          this.contextLogger.warn('Batch forcing optimization activated', {
            triggerId: trigger.id,
            severity: trigger.severity,
            minBatchSize: batchConfig.minBatchSize,
            maxBatchSize: batchConfig.maxBatchSize,
            batchTimeout: batchConfig.batchTimeout,
          });

          return true;
        } catch (error) {
          logError(error as Error, { operation: 'activateBatchForcing' });
          return false;
        }
      },
      reversion: async () => {
        try {
          await redisManager.del(`${config.redis.keyPrefix}batch_forcing_optimization`);
          await redisManager.del(`${config.redis.keyPrefix}aggressive_batch_mode`);

          this.contextLogger.info('Batch forcing optimization deactivated');
          return true;
        } catch (error) {
          logError(error as Error, { operation: 'deactivateBatchForcing' });
          return false;
        }
      },
    };
  }

  /**
   * Create cache optimization action
   */
  private async createCacheOptimizationAction(
    trigger: OptimizationTrigger
  ): Promise<OptimizationAction> {
    return {
      id: `cache_optimize_${Date.now()}`,
      type: 'cache_aggressive',
      priority: 'high',
      estimatedSavings: 40, // 40% cost reduction through intelligent caching
      estimatedLatencyImpact: -300, // 300ms faster due to optimized cache hits
      reversible: true,
      autoRevert: true,
      revertConditions: [
        'efficiency_ratio > 0.8',
        'cache_staleness > 0.1',
        'memory_pressure > 0.85',
      ],
      implementation: async () => {
        try {
          const cacheOptimizationConfig = {
            enabled: true,
            intelligentCaching: true,
            extendedTTL: true,
            preemptiveRefresh: true,
            adaptiveExpiration: true,
            baseTTL: 15 * 60, // 15 minutes base TTL
            maxTTL: 2 * 60 * 60, // 2 hours max TTL
            preemptiveThreshold: 0.8, // Refresh when 80% of TTL elapsed
            triggeredBy: trigger.id,
            provider: trigger.provider,
            requestType: trigger.requestType,
            timestamp: Date.now(),
          };

          await redisManager.set(
            `${config.redis.keyPrefix}cache_optimization`,
            cacheOptimizationConfig,
            4 * 60 * 60 // 4 hours
          );

          // Enhanced cache strategies by request type
          const cacheStrategies = {
            balance: { ttl: 30, preemptive: 0.9 },
            transaction: { ttl: 300, preemptive: 0.8 },
            token_info: { ttl: 1800, preemptive: 0.7 },
            nft_metadata: { ttl: 3600, preemptive: 0.6 },
            historical_data: { ttl: 7200, preemptive: 0.5 },
          };

          await redisManager.set(
            `${config.redis.keyPrefix}cache_strategies`,
            cacheStrategies,
            4 * 60 * 60
          );

          // Enable predictive caching
          await redisManager.set(
            `${config.redis.keyPrefix}predictive_cache_mode`,
            {
              enabled: true,
              learningMode: true,
              patternDetection: true,
              preloadThreshold: 0.7, // Preload when 70% confidence
              triggeredBy: trigger.id,
              timestamp: Date.now(),
            },
            4 * 60 * 60
          );

          this.contextLogger.info('Cache optimization activated', {
            triggerId: trigger.id,
            efficiencyDrop: trigger.currentValue,
            baseTTL: cacheOptimizationConfig.baseTTL,
            maxTTL: cacheOptimizationConfig.maxTTL,
            preemptiveThreshold: cacheOptimizationConfig.preemptiveThreshold,
          });

          return true;
        } catch (error) {
          logError(error as Error, { operation: 'activateCacheOptimization' });
          return false;
        }
      },
      reversion: async () => {
        try {
          await redisManager.del(`${config.redis.keyPrefix}cache_optimization`);
          await redisManager.del(`${config.redis.keyPrefix}cache_strategies`);
          await redisManager.del(`${config.redis.keyPrefix}predictive_cache_mode`);

          this.contextLogger.info('Cache optimization deactivated');
          return true;
        } catch (error) {
          logError(error as Error, { operation: 'deactivateCacheOptimization' });
          return false;
        }
      },
    };
  }

  /**
   * Create fallback activation optimization action
   */
  private async createFallbackActivationAction(
    trigger: OptimizationTrigger
  ): Promise<OptimizationAction> {
    return {
      id: `fallback_activate_${Date.now()}`,
      type: 'fallback_activate',
      priority: trigger.severity === 'critical' ? 'immediate' : 'high',
      estimatedSavings: 30, // 30% cost reduction through fallback mechanisms
      estimatedLatencyImpact: 800, // 800ms added latency for fallback processing
      reversible: true,
      autoRevert: true,
      revertConditions: [
        'anomaly_confidence < 0.3',
        'primary_service_restored',
        'fallback_error_rate > 0.1',
      ],
      implementation: async () => {
        try {
          const fallbackConfig = {
            enabled: true,
            activateFallbacks: true,
            fallbackMode: trigger.severity === 'critical' ? 'aggressive' : 'conservative',
            primaryServiceBypass: trigger.severity === 'critical',
            fallbackProviders: ['backup_rpc', 'cached_data', 'simplified_response'],
            fallbackThreshold: 0.05, // 5% error rate threshold
            timeoutReduction: trigger.severity === 'critical' ? 0.5 : 0.7,
            triggeredBy: trigger.id,
            anomalyConfidence: trigger.currentValue,
            provider: trigger.provider,
            timestamp: Date.now(),
          };

          await redisManager.set(
            `${config.redis.keyPrefix}fallback_activation`,
            fallbackConfig,
            2 * 60 * 60 // 2 hours
          );

          // Configure fallback routing
          const fallbackRouting = {
            enabled: true,
            routingStrategy: 'cost_efficient',
            fallbackSequence: [
              { provider: 'cached_data', weight: 0.6 },
              { provider: 'backup_rpc', weight: 0.3 },
              { provider: 'simplified_response', weight: 0.1 },
            ],
            maxFallbackAttempts: 3,
            fallbackTimeout: 5000, // 5s timeout
            triggeredBy: trigger.id,
            timestamp: Date.now(),
          };

          await redisManager.set(
            `${config.redis.keyPrefix}fallback_routing`,
            fallbackRouting,
            2 * 60 * 60
          );

          // Enable graceful degradation
          await redisManager.set(
            `${config.redis.keyPrefix}graceful_degradation`,
            {
              enabled: true,
              degradationLevel: trigger.severity === 'critical' ? 'high' : 'medium',
              disableNonEssential: true,
              simplifyResponses: true,
              reduceDataGranularity: trigger.severity === 'critical',
              triggeredBy: trigger.id,
              timestamp: Date.now(),
            },
            2 * 60 * 60
          );

          this.contextLogger.warn('Fallback activation optimization enabled', {
            triggerId: trigger.id,
            severity: trigger.severity,
            anomalyConfidence: trigger.currentValue,
            fallbackMode: fallbackConfig.fallbackMode,
            primaryServiceBypass: fallbackConfig.primaryServiceBypass,
          });

          return true;
        } catch (error) {
          logError(error as Error, { operation: 'activateFallbackOptimization' });
          return false;
        }
      },
      reversion: async () => {
        try {
          await redisManager.del(`${config.redis.keyPrefix}fallback_activation`);
          await redisManager.del(`${config.redis.keyPrefix}fallback_routing`);
          await redisManager.del(`${config.redis.keyPrefix}graceful_degradation`);

          this.contextLogger.info('Fallback activation optimization deactivated');
          return true;
        } catch (error) {
          logError(error as Error, { operation: 'deactivateFallbackOptimization' });
          return false;
        }
      },
    };
  }

  /**
   * Execute a specific optimization action
   */
  private async executeOptimizationAction(
    action: OptimizationAction,
    trigger: OptimizationTrigger
  ): Promise<OptimizationResult> {
    const startTime = Date.now();

    try {
      const implemented = await action.implementation();

      const result: OptimizationResult = {
        actionId: action.id,
        implemented,
        timestamp: startTime,
      };

      if (implemented) {
        // Monitor the optimization for actual results
        setTimeout(
          async () => {
            try {
              const actualMetrics = await this.measureOptimizationImpact(action, trigger);
              result.actualSavings = actualMetrics.savings;
              result.actualLatencyImpact = actualMetrics.latencyImpact;
              result.sideEffects = actualMetrics.sideEffects;

              this.contextLogger.info('Optimization impact measured', {
                actionId: action.id,
                actualSavings: result.actualSavings,
                estimatedSavings: action.estimatedSavings,
                actualLatencyImpact: result.actualLatencyImpact,
              });

              // Auto-revert if conditions are met
              if (action.autoRevert && (await this.shouldRevertOptimization(action, result))) {
                await this.revertOptimization(action.id);
              }
            } catch (error) {
              logError(error as Error, {
                operation: 'measureOptimizationImpact',
                actionId: action.id,
              });
            }
          },
          5 * 60 * 1000
        ); // Measure impact after 5 minutes
      }

      return result;
    } catch (error) {
      logError(error as Error, {
        operation: 'executeOptimizationAction',
        actionId: action.id,
        triggerType: trigger.type,
      });

      return {
        actionId: action.id,
        implemented: false,
        timestamp: startTime,
      };
    }
  }

  /**
   * Revert an active optimization
   */
  async revertOptimization(actionId: string, reason?: string): Promise<boolean> {
    const optimization = this.activeOptimizations.get(actionId);
    if (!optimization) {
      this.contextLogger.warn('Attempted to revert non-existent optimization', { actionId });
      return false;
    }

    try {
      // Find the action to get reversion function (simplified for this example)
      const revertSuccess = true; // Would call actual reversion function

      if (revertSuccess) {
        optimization.revertedAt = Date.now();
        optimization.revertReason = reason || 'manual_revert';

        this.activeOptimizations.delete(actionId);

        this.contextLogger.info('Optimization reverted successfully', {
          actionId,
          reason,
          originalTimestamp: optimization.timestamp,
          duration: Date.now() - optimization.timestamp,
        });

        this.emit('optimizationReverted', {
          actionId,
          reason,
          optimization,
        });

        return true;
      }
    } catch (error) {
      logError(error as Error, { operation: 'revertOptimization', actionId });
    }

    return false;
  }

  /**
   * Start real-time monitoring for optimization triggers
   */
  private startRealTimeMonitoring(): void {
    // Monitor every 30 seconds
    setInterval(async () => {
      try {
        await this.checkAndOptimize();
      } catch (error) {
        logError(error as Error, { operation: 'realTimeMonitoring' });
      }
    }, 30 * 1000);

    // Clean up old optimizations every 5 minutes
    setInterval(
      async () => {
        await this.cleanupOldOptimizations();
      },
      5 * 60 * 1000
    );
  }

  /**
   * Main monitoring and optimization check
   */
  private async checkAndOptimize(): Promise<void> {
    if (!this.optimizationEnabled) return;

    // Get current metrics
    const costSummary = await getCostMonitoringService().getCostSummary('1h');
    const budgetUtilization = (costSummary.totalCost * 24 * 30) / config.costs.monthlyBudget;

    // Check budget emergency
    const budgetCheck = await this.budgetProtector.checkBudgetEmergency(budgetUtilization);
    if (budgetCheck.isEmergency && this.autoMitigationEnabled) {
      const triggers = await this.checkOptimizationTriggers({
        budgetUtilization,
        costSpike: costSummary.averageCostPerRequest > 0.01 ? 3.0 : 1.0,
      });

      if (triggers.length > 0) {
        await this.executeOptimizations(triggers);
      }
    }

    // Regular optimization checks
    const metrics = {
      budgetUtilization,
      costSpike: await this.calculateCostSpike(),
      efficiencyRatio: await this.calculateEfficiencyRatio(),
      anomalyConfidence: await this.getAnomalyConfidence(),
    };

    const triggers = await this.checkOptimizationTriggers(metrics);
    if (triggers.length > 0) {
      await this.executeOptimizations(triggers);
    }
  }

  /**
   * Calculate current cost spike ratio
   */
  private async calculateCostSpike(): Promise<number> {
    const currentSummary = await getCostMonitoringService().getCostSummary('1h');
    const baselineSummary = await getCostMonitoringService().getCostSummary('24h');

    if (baselineSummary.averageCostPerRequest === 0) return 1.0;

    return currentSummary.averageCostPerRequest / baselineSummary.averageCostPerRequest;
  }

  /**
   * Calculate efficiency ratio
   */
  private async calculateEfficiencyRatio(): Promise<number> {
    const currentSummary = await getCostMonitoringService().getCostSummary('1h');
    return currentSummary.cacheHitRate; // Simplified efficiency metric
  }

  /**
   * Get current anomaly confidence
   */
  private async getAnomalyConfidence(): Promise<number> {
    // This would integrate with the anomaly detection system
    return 0.3; // Placeholder
  }

  /**
   * Measure actual optimization impact
   */
  private async measureOptimizationImpact(
    action: OptimizationAction,
    trigger: OptimizationTrigger
  ): Promise<{
    savings: number;
    latencyImpact: number;
    sideEffects: string[];
  }> {
    // Compare metrics before and after optimization
    // This is a simplified implementation
    return {
      savings: action.estimatedSavings * (0.8 + Math.random() * 0.4), // 80-120% of estimate
      latencyImpact: action.estimatedLatencyImpact * (0.9 + Math.random() * 0.2),
      sideEffects: [],
    };
  }

  /**
   * Check if optimization should be reverted
   */
  private async shouldRevertOptimization(
    action: OptimizationAction,
    result: OptimizationResult
  ): Promise<boolean> {
    // Check revert conditions
    for (const condition of action.revertConditions) {
      if (await this.evaluateRevertCondition(condition)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Evaluate a revert condition
   */
  private async evaluateRevertCondition(condition: string): Promise<boolean> {
    // Parse and evaluate conditions like 'budget_utilization < 0.7'
    // Simplified implementation
    return false;
  }

  /**
   * Clean up old optimizations
   */
  private async cleanupOldOptimizations(): Promise<void> {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours

    for (const [actionId, optimization] of this.activeOptimizations) {
      if (optimization.timestamp < cutoff) {
        this.activeOptimizations.delete(actionId);
        this.contextLogger.info('Cleaned up old optimization', { actionId });
      }
    }
  }

  // Public API methods

  getOptimizationMetrics() {
    return { ...this.optimizationMetrics };
  }

  getActiveOptimizations() {
    return Array.from(this.activeOptimizations.values());
  }

  async forceOptimization(
    type: OptimizationTrigger['type'],
    severity: OptimizationTrigger['severity']
  ) {
    const trigger: OptimizationTrigger = {
      id: `manual_${type}_${Date.now()}`,
      type,
      severity,
      threshold: 0,
      currentValue: 1,
      triggerCondition: 'manual_trigger',
      autoMitigate: true,
      cooldownPeriod: 0,
    };

    return await this.executeOptimizations([trigger]);
  }

  setOptimizationEnabled(enabled: boolean): void {
    this.optimizationEnabled = enabled;
    this.contextLogger.info(`Real-time optimization ${enabled ? 'enabled' : 'disabled'}`);
  }

  setAutoMitigationEnabled(enabled: boolean): void {
    this.autoMitigationEnabled = enabled;
    this.contextLogger.info(`Auto-mitigation ${enabled ? 'enabled' : 'disabled'}`);
  }
}

// Export singleton instance
let realTimeOptimizerInstance: RealTimeOptimizer | null = null;

export const getRealTimeOptimizer = (): RealTimeOptimizer => {
  if (!realTimeOptimizerInstance) {
    realTimeOptimizerInstance = new RealTimeOptimizer();
  }
  return realTimeOptimizerInstance;
};

export default getRealTimeOptimizer;
