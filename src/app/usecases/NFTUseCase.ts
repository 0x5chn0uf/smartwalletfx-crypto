import { ServiceDeps as ServiceDependencies } from '@/app/runtime';

export interface GetNFTPortfolioOptions {
  chainIds?: any[];
  categories?: any[];
  standards?: any[];
  includeMetadata?: boolean;
  includeAnalytics?: boolean;
  includeListings?: boolean;
  minValue?: number;
  forceRefresh?: boolean;
}

export class NFTUseCase {
  constructor(private readonly deps: ServiceDependencies) {}

  async getPortfolio(address: string, options: GetNFTPortfolioOptions) {
    return this.deps.nftPort.getNFTPortfolio(address, options as any);
  }
}
