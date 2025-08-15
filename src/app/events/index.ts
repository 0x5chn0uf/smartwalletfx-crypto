/**
 * Event Contracts for Crypto Data Service
 * 
 * This module exports all event types and utilities for the event-driven
 * architecture implementation following hexagonal design principles.
 * 
 * Event Versioning:
 * - All events follow semantic versioning (V1, V2, etc.)
 * - Breaking changes require new versions
 * - Non-breaking additions can extend existing versions
 * 
 * Event Categories:
 * - DeFi: Position fetching and processing events
 * - Portfolio: Aggregation and computation events  
 * - System: Infrastructure and monitoring events
 */

// Re-export all event types
export * from './DeFiEvents';
export * from './PortfolioEvents';
export * from './SystemEvents';

// Re-export port interface and utilities
export * from '../ports/EventBusPort';

// Event type constants for easy reference
export const ALL_EVENT_TYPES = {
  // DeFi Events
  DEFI_POSITIONS_REQUESTED: 'DeFiPositionsRequestedV1',
  DEFI_POSITIONS_FETCHED: 'DeFiPositionsFetchedV1', 
  DEFI_POSITIONS_ERROR: 'DeFiPositionsErrorV1',
  
  // Portfolio Events
  PORTFOLIO_COMPUTED: 'PortfolioComputedV1',
  CACHE_WARM_REQUEST: 'CacheWarmRequestV1',
  PORTFOLIO_AGGREGATION_REQUEST: 'PortfolioAggregationRequestV1',
  PORTFOLIO_AGGREGATION_COMPLETED: 'PortfolioAggregationCompletedV1',
  PORTFOLIO_AGGREGATION_ERROR: 'PortfolioAggregationErrorV1',
  
  // System Events  
  PROVIDER_HEALTH_CHANGED: 'ProviderHealthChangedV1',
  COST_THRESHOLD_EXCEEDED: 'CostThresholdExceededV1',
  PERFORMANCE_ALERT: 'PerformanceAlertV1',
  CACHE_INVALIDATION_REQUEST: 'CacheInvalidationRequestV1',
  SYSTEM_MAINTENANCE: 'SystemMaintenanceV1',
} as const;

// Type union for all event types
export type AllEventTypes = typeof ALL_EVENT_TYPES[keyof typeof ALL_EVENT_TYPES];

// Event categories for subscription patterns
export const EVENT_CATEGORIES = {
  DEFI: ['DeFiPositionsRequestedV1', 'DeFiPositionsFetchedV1', 'DeFiPositionsErrorV1'],
  PORTFOLIO: ['PortfolioComputedV1', 'CacheWarmRequestV1', 'PortfolioAggregationRequestV1', 'PortfolioAggregationCompletedV1', 'PortfolioAggregationErrorV1'],
  SYSTEM: ['ProviderHealthChangedV1', 'CostThresholdExceededV1', 'PerformanceAlertV1', 'CacheInvalidationRequestV1', 'SystemMaintenanceV1'],
} as const;

// Event priority levels (for queue prioritization)
export const EVENT_PRIORITIES = {
  LOW: 1,
  MEDIUM: 5, 
  HIGH: 10,
  URGENT: 20,
  CRITICAL: 50,
} as const;

// Common event metadata fields
export interface CommonEventMetadata {
  /** Correlation ID for tracing across services */
  correlationId?: string;
  /** User ID who triggered this event (if applicable) */
  userId?: string;
  /** Session ID for user session tracking */
  sessionId?: string;
  /** Client type that originated the request */
  clientType?: 'web' | 'mobile' | 'api' | 'worker' | 'system';
  /** Event priority for queue processing */
  priority?: number;
  /** Retry count for failed events */
  retryCount?: number;
  /** Maximum retry attempts allowed */
  maxRetries?: number;
  /** Tags for categorization and filtering */
  tags?: string[];
  /** Performance tracking */
  performance?: {
    startedAt?: string;
    processingTimeMs?: number;
    queueTimeMs?: number;
  };
}

/**
 * Utility function to check if an event is retriable based on error
 */
export function isRetriableEvent(eventType: string, error: any): boolean {
  // System events are typically not retriable
  if (EVENT_CATEGORIES.SYSTEM.includes(eventType as any)) {
    return false;
  }
  
  // Network/timeout errors are usually retriable
  if (error?.code === 'NETWORK_ERROR' || error?.code === 'TIMEOUT') {
    return true;
  }
  
  // Validation errors are not retriable
  if (error?.code === 'VALIDATION_ERROR' || error?.code === 'INVALID_INPUT') {
    return false;
  }
  
  // Rate limit errors are retriable after delay
  if (error?.code === 'RATE_LIMITED') {
    return true;
  }
  
  // Default to retriable for data processing events
  return EVENT_CATEGORIES.DEFI.includes(eventType as any) || 
         EVENT_CATEGORIES.PORTFOLIO.includes(eventType as any);
}

/**
 * Get recommended retry delay for an event type and attempt number
 */
export function getRetryDelayMs(eventType: string, attemptNumber: number): number {
  const baseDelayMs = 1000; // 1 second
  const maxDelayMs = 300000; // 5 minutes
  
  // Exponential backoff with jitter
  const exponentialDelay = baseDelayMs * Math.pow(2, attemptNumber - 1);
  const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
  
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Extract wallet address from event data if present
 */
export function extractAddressFromEvent(event: any): string | null {
  return event?.data?.address || null;
}

/**
 * Extract request ID for correlation
 */
export function extractRequestId(event: any): string | null {
  return event?.requestId || event?.data?.requestId || null;
}