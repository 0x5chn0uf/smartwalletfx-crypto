import { ServiceDeps as ServiceDependencies } from '@/app/runtime';

export interface GetDeFiPortfolioOptions {
  chainIds?: any[];
  protocols?: any[];
  includeInactive?: boolean;
  includeYield?: boolean;
  includeRisk?: boolean;
  minValue?: number;
  forceRefresh?: boolean;
}

export class DeFiUseCase {
  constructor(private readonly deps: ServiceDependencies) {}

  async getPortfolio(address: string, options: GetDeFiPortfolioOptions) {
    return this.deps.defiPort.getDeFiPortfolio(address, options as any);
  }
}
