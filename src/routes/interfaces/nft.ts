import type { ChainId } from '@/types/blockchain';
import type { NFTCategory, NFTStandard } from '@/types/nft';

export interface NFTQueryOptions {
  chains?: ChainId[];
  categories?: NFTCategory[];
  standards?: NFTStandard[];
  includeMetadata?: boolean;
  includeAnalytics?: boolean;
  includeListings?: boolean;
  minValue?: number;
  forceRefresh?: boolean;
}
