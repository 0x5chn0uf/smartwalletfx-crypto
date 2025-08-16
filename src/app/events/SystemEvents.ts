import { IntegrationEvent } from '@/ports/EventBusPort';
import { ChainId } from '@/types/blockchain';

/**
 * System Event Types
 */
export const SYSTEM_EVENT_TYPES = {
  PROVIDER_HEALTH_CHANGED: 'ProviderHealthChangedV1',
  COST_THRESHOLD_EXCEEDED: 'CostThresholdExceededV1',
  PERFORMANCE_ALERT: 'PerformanceAlertV1',
  CACHE_INVALIDATION_REQUEST: 'CacheInvalidationRequestV1',
  SYSTEM_MAINTENANCE: 'SystemMaintenanceV1',
} as const;

/**
 * Provider Health Changed Event (Optional)
 * Emitted when provider health status changes
 */
export interface ProviderHealthChangedV1 extends IntegrationEvent {
  type: typeof SYSTEM_EVENT_TYPES.PROVIDER_HEALTH_CHANGED;
  data: {
    /** Provider identifier */
    provider: string;
    /** Chain this provider serves */
    chainId: ChainId;
    /** Previous health status */
    previous: {
      isHealthy: boolean;
      responseTimeMs?: number;
      errorRate: number;
      lastCheckedAt: string;
      issues: string[];
    };
    /** Current health status */
    current: {
      isHealthy: boolean;
      responseTimeMs?: number;
      errorRate: number;
      lastCheckedAt: string;
      issues: string[];
    };
    /** When the change was detected */
    changedAt: string; // ISO 8601
    /** Health change context */
    context: {
      /** What triggered the health check */
      trigger: 'scheduled' | 'error-threshold' | 'manual' | 'startup';
      /** Health check duration */
      checkDurationMs: number;
      /** Number of consecutive failures (if unhealthy) */
      consecutiveFailures?: number;
      /** Recent error samples */
      recentErrors?: Array<{
        timestamp: string;
        error: string;
        endpoint?: string;
      }>;
    };
    /** Impact assessment */
    impact: {
      /** Severity of this health change */
      severity: 'low' | 'medium' | 'high' | 'critical';
      /** Affected services/endpoints */
      affectedServices: string[];
      /** Estimated recovery time */
      estimatedRecoveryTimeMs?: number;
      /** Fallback providers available */
      fallbacksAvailable: boolean;
    };
  };
}

/**
 * Cost Threshold Exceeded Event (Optional)
 * Emitted when API costs exceed configured thresholds
 */
export interface CostThresholdExceededV1 extends IntegrationEvent {
  type: typeof SYSTEM_EVENT_TYPES.COST_THRESHOLD_EXCEEDED;
  data: {
    /** Time window for cost calculation */
    window: {
      /** Window type */
      type: 'hourly' | 'daily' | 'monthly';
      /** Window start time */
      startAt: string;
      /** Window end time */
      endAt: string;
    };
    /** Cost threshold that was exceeded */
    threshold: {
      /** Threshold amount in USD */
      amountUSD: number;
      /** Threshold type */
      type: 'hard-limit' | 'soft-warning' | 'budget-alert';
      /** Configured limit */
      limitUSD: number;
    };
    /** Actual costs incurred */
    actual: {
      /** Total cost in USD */
      totalUSD: number;
      /** Percentage of threshold exceeded */
      exceedancePercentage: number;
      /** Cost breakdown by provider */
      byProvider: Record<string, {
        costUSD: number;
        callCount: number;
        averageCostPerCall: number;
      }>;
      /** Cost breakdown by chain */
      byChain: Record<ChainId, {
        costUSD: number;
        callCount: number;
      }>;
      /** Cost breakdown by service */
      byService: Record<string, {
        costUSD: number;
        callCount: number;
      }>;
    };
    /** When threshold was exceeded */
    exceededAt: string; // ISO 8601
    /** Trend analysis */
    trends: {
      /** Cost velocity (USD per hour) */
      costVelocityUSDPerHour: number;
      /** Projected cost for remainder of window */
      projectedTotalUSD: number;
      /** Comparison to previous period */
      previousPeriodComparison: {
        percentageChange: number;
        absoluteChangeUSD: number;
      };
    };
    /** Recommended actions */
    recommendations: Array<{
      action: 'rate-limit' | 'cache-extend' | 'provider-throttle' | 'manual-review';
      priority: 'low' | 'medium' | 'high' | 'urgent';
      description: string;
      estimatedSavingsUSD?: number;
    }>;
  };
}

/**
 * Performance Alert Event
 * Emitted when system performance degrades
 */
export interface PerformanceAlertV1 extends IntegrationEvent {
  type: typeof SYSTEM_EVENT_TYPES.PERFORMANCE_ALERT;
  data: {
    /** Alert type */
    alertType: 'latency' | 'throughput' | 'error-rate' | 'resource-usage';
    /** Severity level */
    severity: 'warning' | 'error' | 'critical';
    /** Metric that triggered alert */
    metric: {
      name: string;
      currentValue: number;
      thresholdValue: number;
      unit: string;
      trend: 'increasing' | 'decreasing' | 'stable';
    };
    /** Affected component */
    component: {
      type: 'orchestrator' | 'provider' | 'cache' | 'database' | 'worker';
      name: string;
      version?: string;
    };
    /** Time window for measurement */
    timeWindow: {
      durationMs: number;
      startAt: string;
      endAt: string;
    };
    /** Performance context */
    context: {
      /** Current system load */
      systemLoad: {
        requestsPerSecond: number;
        activeConnections: number;
        queueDepth?: number;
      };
      /** Recent performance history */
      recentHistory: Array<{
        timestamp: string;
        value: number;
      }>;
      /** Correlated events */
      correlatedEvents?: string[];
    };
    /** When alert was triggered */
    triggeredAt: string; // ISO 8601
    /** Suggested mitigations */
    mitigations: Array<{
      action: string;
      priority: 'low' | 'medium' | 'high' | 'urgent';
      estimatedImpact: string;
      riskLevel: 'low' | 'medium' | 'high';
    }>;
  };
}

/**
 * Cache Invalidation Request Event
 * Emitted to request cache invalidation across the system
 */
export interface CacheInvalidationRequestV1 extends IntegrationEvent {
  type: typeof SYSTEM_EVENT_TYPES.CACHE_INVALIDATION_REQUEST;
  data: {
    /** Invalidation scope */
    scope: 'global' | 'address' | 'chain' | 'protocol' | 'key-pattern';
    /** Target specification */
    target: {
      /** Wallet address (if scope = 'address') */
      address?: string;
      /** Chain ID (if scope = 'chain') */
      chainId?: ChainId;
      /** Protocol (if scope = 'protocol') */
      protocol?: string;
      /** Key pattern (if scope = 'key-pattern') */
      pattern?: string;
    };
    /** Invalidation reason */
    reason: {
      type: 'data-update' | 'error-recovery' | 'manual' | 'scheduled' | 'policy-change';
      description: string;
      triggeredBy?: string;
    };
    /** Invalidation strategy */
    strategy: 'immediate' | 'lazy' | 'background-refresh';
    /** Priority */
    priority: 'low' | 'medium' | 'high' | 'urgent';
    /** When invalidation was requested */
    requestedAt: string; // ISO 8601
    /** Constraints */
    constraints?: {
      /** Maximum time to complete invalidation */
      maxDurationMs?: number;
      /** Whether to preserve partial data */
      preservePartialData?: boolean;
      /** Whether to notify dependent services */
      notifyDependents?: boolean;
    };
  };
}

/**
 * System Maintenance Event
 * Emitted for system maintenance operations
 */
export interface SystemMaintenanceV1 extends IntegrationEvent {
  type: typeof SYSTEM_EVENT_TYPES.SYSTEM_MAINTENANCE;
  data: {
    /** Maintenance operation type */
    operation: 'scheduled-restart' | 'cache-cleanup' | 'database-migration' | 'provider-update' | 'configuration-change';
    /** Maintenance phase */
    phase: 'scheduled' | 'starting' | 'in-progress' | 'completed' | 'failed';
    /** Affected components */
    affectedComponents: Array<{
      component: string;
      impact: 'none' | 'degraded' | 'unavailable';
      estimatedDowntimeMs?: number;
    }>;
    /** Maintenance window */
    window: {
      plannedStartAt: string;
      plannedEndAt: string;
      actualStartAt?: string;
      actualEndAt?: string;
    };
    /** Progress information (for in-progress phase) */
    progress?: {
      completionPercentage: number;
      currentStep: string;
      estimatedRemainingMs: number;
    };
    /** Maintenance context */
    context: {
      /** Who initiated the maintenance */
      initiatedBy: string;
      /** Maintenance reason */
      reason: string;
      /** Rollback plan available */
      rollbackAvailable: boolean;
      /** Emergency contact */
      emergencyContact?: string;
    };
    /** Timestamp for this phase */
    timestamp: string; // ISO 8601
  };
}