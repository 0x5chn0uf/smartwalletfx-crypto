import { ServiceDeps as ServiceDependencies } from '@/app/runtime';
import type { GetNFTPortfolioOptions } from '@/ports/NFTPort';

export class NFTUseCase {
  constructor(private readonly deps: ServiceDependencies) {}

  async getPortfolio(address: string, options: GetNFTPortfolioOptions) {
    return this.deps.nftPort.getNFTPortfolio(address, options as any);
  }
}
