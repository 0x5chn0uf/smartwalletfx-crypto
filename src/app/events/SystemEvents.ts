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
export type { ProviderHealthChangedV1, CostThresholdExceededV1, PerformanceAlertV1, CacheInvalidationRequestV1, SystemMaintenanceV1 } from './interfaces/system';

/**
 * Cost Threshold Exceeded Event (Optional)
 * Emitted when API costs exceed configured thresholds
 */

/**
 * Performance Alert Event
 * Emitted when system performance degrades
 */

/**
 * Cache Invalidation Request Event
 * Emitted to request cache invalidation across the system
 */

/**
 * System Maintenance Event
 * Emitted for system maintenance operations
 */
// Interfaces re-exported from './interfaces/system'
