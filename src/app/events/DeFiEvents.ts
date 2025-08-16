import { IntegrationEvent } from '@/ports/EventBusPort';
import { ChainId } from '@/types/blockchain';
import { DeFiProtocol, DeFiPosition, DeFiPortfolioSummary } from '@/types/defi';

/**
 * Event Types - Following semantic versioning for schema evolution
 */
export const DEFI_EVENT_TYPES = {
  POSITIONS_REQUESTED: 'DeFiPositionsRequestedV1',
  POSITIONS_FETCHED: 'DeFiPositionsFetchedV1',
  POSITIONS_ERROR: 'DeFiPositionsErrorV1',
} as const;

/**
 * DeFi Positions Requested Event
 * Emitted by HTTP routes when detailed DeFi portfolio is requested
 * Triggers async computation of positions
 */
export type { DeFiPositionsRequestedV1 } from './interfaces/defi';

/**
 * DeFi Positions Fetched Event  
 * Emitted by DeFiOrchestrator after successfully fetching positions
 * Contains raw position data and fetch statistics
 */
export type { DeFiPositionsFetchedV1 } from './interfaces/defi';

/**
 * DeFi Positions Error Event
 * Emitted when DeFi position fetching fails
 */
export type { DeFiPositionsErrorV1 } from './interfaces/defi';
