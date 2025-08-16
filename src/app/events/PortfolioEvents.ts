import { IntegrationEvent } from '@/ports/EventBusPort';
import { ChainId } from '@/types/blockchain';
import { MultiChainPortfolio } from '@/types/blockchain';

/**
 * Portfolio Event Types
 */
export const PORTFOLIO_EVENT_TYPES = {
  COMPUTED: 'PortfolioComputedV1',
  CACHE_WARM_REQUEST: 'CacheWarmRequestV1',
  AGGREGATION_REQUEST: 'PortfolioAggregationRequestV1',
  AGGREGATION_COMPLETED: 'PortfolioAggregationCompletedV1',
  AGGREGATION_ERROR: 'PortfolioAggregationErrorV1',
} as const;

// Re-export event interfaces from local interfaces module to keep this file light
export type {
  PortfolioComputedV1,
  CacheWarmRequestV1,
  PortfolioAggregationRequestV1,
  PortfolioAggregationCompletedV1,
  PortfolioAggregationErrorV1,
} from './interfaces/portfolio';

/**
 * Portfolio Computed Event
 * Emitted after complete portfolio aggregation and enrichment
 */
// See './interfaces/portfolio'

/**
 * Cache Warm Request Event
 * Emitted to pre-compute and cache frequently accessed data
 */
// See './interfaces/portfolio'

/**
 * Portfolio Aggregation Request Event
 * Emitted when a complete portfolio aggregation is requested
 */
// See './interfaces/portfolio'

/**
 * Portfolio Aggregation Completed Event
 * Emitted when portfolio aggregation successfully completes
 */
// See './interfaces/portfolio'

/**
 * Portfolio Aggregation Error Event
 * Emitted when portfolio aggregation fails
 */
// See './interfaces/portfolio'
