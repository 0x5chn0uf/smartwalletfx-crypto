// Unified Cost Monitoring Type System
// Fixes CostAnomaly vs CostAlert conflicts

export type CostSeverity = 'low' | 'medium' | 'high' | 'critical';

export type CostAlertType =
  | 'budget_threshold'
  | 'anomaly_detection'
  | 'provider_cost_spike'
  | 'efficiency_degradation'
  | 'free_tier_exhaustion';

// Base cost event interface
export interface BaseCostEvent {
  id: string;
  timestamp: number;
  severity: CostSeverity;
  message: string;
  metadata?: Record<string, any>;
}

// Unified CostAlert interface (base for all cost alerts)
export interface CostAlert extends BaseCostEvent {
  type: CostAlertType;
  provider?: string;
  chainId?: string;
  currentValue: number;
  threshold?: number;
  recommendations: string[];
}

// Enhanced CostAnomaly interface (extends CostAlert with anomaly-specific data)
export interface CostAnomaly extends CostAlert {
  type: 'anomaly_detection';
  detectedAt: number;
  affectedProviders: string[];
  anomalyType: 'spike' | 'sustained_increase' | 'pattern_deviation' | 'efficiency_drop';
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

// Type guards for runtime type checking
export const isCostAlert = (item: CostAlert | CostAnomaly): item is CostAlert =>
  'threshold' in item;

export const isCostAnomaly = (item: CostAlert | CostAnomaly): item is CostAnomaly =>
  item.type === 'anomaly_detection' && 'anomalyType' in item;

// Helper functions for type-safe operations
export const filterCriticalAlerts = (
  items: (CostAlert | CostAnomaly)[]
): (CostAlert | CostAnomaly)[] => items.filter(item => item.severity === 'critical');

export const separateAlertsAndAnomalies = (items: (CostAlert | CostAnomaly)[]) => {
  const alerts: CostAlert[] = [];
  const anomalies: CostAnomaly[] = [];

  items.forEach(item => {
    if (isCostAnomaly(item)) {
      anomalies.push(item);
    } else {
      alerts.push(item);
    }
  });

  return { alerts, anomalies };
};
