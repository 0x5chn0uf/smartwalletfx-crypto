import { ServiceDeps as ServiceDependencies } from '@/app/runtime';
import type { GetDeFiPortfolioOptions } from '@/ports/DeFiPort';

export class DeFiUseCase {
  constructor(private readonly deps: ServiceDependencies) {}

  async getPortfolio(address: string, options: GetDeFiPortfolioOptions) {
    return this.deps.defiPort.getDeFiPortfolio(address, options as any);
  }
}
