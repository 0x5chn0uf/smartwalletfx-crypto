import type { ChainId } from '@/types/blockchain';

export interface PortfolioQueryOptions {
  chains?: ChainId[];
  includeDefi?: boolean;
  includeNfts?: boolean;
  includeMetadata?: boolean;
  includeAnalytics?: boolean;
  forceRefresh?: boolean;
  minDefiValue?: number;
  minNftValue?: number;
}
