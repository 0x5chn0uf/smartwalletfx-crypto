import type { ChainId } from '@/types/blockchain';
import type { DeFiProtocol } from '@/types/defi';

export interface DeFiQueryOptions {
  chains?: ChainId[];
  protocols?: DeFiProtocol[];
  includeInactive?: boolean;
  includeYield?: boolean;
  includeRisk?: boolean;
  minValue?: number;
  forceRefresh?: boolean;
}
