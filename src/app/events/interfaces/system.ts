import type { IntegrationEvent } from '@/ports/EventBusPort';
import type { ChainId } from '@/types/blockchain';

export interface ProviderHealthChangedV1 extends IntegrationEvent {
  type: 'ProviderHealthChangedV1';
  data: {
    provider: string;
    chainId: ChainId;
    previous: {
      isHealthy: boolean;
      responseTimeMs?: number;
      errorRate: number;
      lastCheckedAt: string;
      issues: string[];
    };
    current: {
      isHealthy: boolean;
      responseTimeMs?: number;
      errorRate: number;
      lastCheckedAt: string;
      issues: string[];
    };
    changedAt: string;
    context: {
      trigger: 'scheduled' | 'error-threshold' | 'manual' | 'startup';
      checkDurationMs: number;
      consecutiveFailures?: number;
      recentErrors?: Array<{ timestamp: string; error: string; endpoint?: string }>;
    };
    impact: {
      severity: 'low' | 'medium' | 'high' | 'critical';
      affectedServices: string[];
      estimatedRecoveryTimeMs?: number;
      fallbacksAvailable: boolean;
    };
  };
}

export interface CostThresholdExceededV1 extends IntegrationEvent {
  type: 'CostThresholdExceededV1';
  data: {
    window: { type: 'hourly' | 'daily' | 'monthly'; startAt: string; endAt: string };
    threshold: {
      amountUSD: number;
      type: 'hard-limit' | 'soft-warning' | 'budget-alert';
      limitUSD: number;
    };
    actual: {
      totalUSD: number;
      exceedancePercentage: number;
      byProvider: Record<
        string,
        { costUSD: number; callCount: number; averageCostPerCall: number }
      >;
      byChain: Record<ChainId, { costUSD: number; callCount: number }>;
      byService: Record<string, { costUSD: number; callCount: number }>;
    };
    exceededAt: string;
    trends: {
      costVelocityUSDPerHour: number;
      projectedTotalUSD: number;
      previousPeriodComparison: { percentageChange: number; absoluteChangeUSD: number };
    };
    recommendations: Array<{
      action: 'rate-limit' | 'cache-extend' | 'provider-throttle' | 'manual-review';
      priority: 'low' | 'medium' | 'high' | 'urgent';
      description: string;
      estimatedSavingsUSD?: number;
    }>;
  };
}

export interface PerformanceAlertV1 extends IntegrationEvent {
  type: 'PerformanceAlertV1';
  data: {
    alertType: 'latency' | 'throughput' | 'error-rate' | 'resource-usage';
    severity: 'warning' | 'error' | 'critical';
    metric: {
      name: string;
      currentValue: number;
      thresholdValue: number;
      unit: string;
      trend: 'increasing' | 'decreasing' | 'stable';
    };
    component: {
      type: 'orchestrator' | 'provider' | 'cache' | 'database' | 'worker';
      name: string;
      version?: string;
    };
    timeWindow: { durationMs: number; startAt: string; endAt: string };
    context: {
      systemLoad: { requestsPerSecond: number; activeConnections: number; queueDepth?: number };
      recentHistory: Array<{ timestamp: string; value: number }>;
      correlatedEvents?: string[];
    };
    triggeredAt: string;
    mitigations: Array<{
      action: string;
      priority: 'low' | 'medium' | 'high' | 'urgent';
      estimatedImpact: string;
      riskLevel: 'low' | 'medium' | 'high';
    }>;
  };
}

export interface CacheInvalidationRequestV1 extends IntegrationEvent {
  type: 'CacheInvalidationRequestV1';
  data: {
    scope: 'global' | 'address' | 'chain' | 'protocol' | 'key-pattern';
    target: { address?: string; chainId?: ChainId; protocol?: string; pattern?: string };
    reason: {
      type: 'data-update' | 'error-recovery' | 'manual' | 'scheduled' | 'policy-change';
      description: string;
      triggeredBy?: string;
    };
    strategy: 'immediate' | 'lazy' | 'background-refresh';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    requestedAt: string;
    constraints?: {
      maxDurationMs?: number;
      preservePartialData?: boolean;
      notifyDependents?: boolean;
    };
  };
}

export interface SystemMaintenanceV1 extends IntegrationEvent {
  type: 'SystemMaintenanceV1';
  data: {
    operation:
      | 'scheduled-restart'
      | 'cache-cleanup'
      | 'database-migration'
      | 'provider-update'
      | 'configuration-change';
    phase: 'scheduled' | 'starting' | 'in-progress' | 'completed' | 'failed';
    affectedComponents: Array<{
      component: string;
      impact: 'none' | 'degraded' | 'unavailable';
      estimatedDowntimeMs?: number;
    }>;
    window: {
      plannedStartAt: string;
      plannedEndAt: string;
      actualStartAt?: string;
      actualEndAt?: string;
    };
    progress?: { completionPercentage: number; currentStep: string; estimatedRemainingMs: number };
    context: {
      initiatedBy: string;
      reason: string;
      rollbackAvailable: boolean;
      emergencyContact?: string;
    };
    timestamp: string;
  };
}
