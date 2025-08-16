export interface GetDeFiPortfolioOptions {
  chainIds?: any[];
  protocols?: any[];
  includeInactive?: boolean;
  includeYield?: boolean;
  includeRisk?: boolean;
  minValue?: number;
  forceRefresh?: boolean;
}

export interface DeFiPort {
  getDeFiPortfolio(address: string, options: GetDeFiPortfolioOptions): Promise<any>;
  // Mirror orchestrator signature for simplicity and performance
  getProtocolPositions(protocol: any, address: string, chainId?: any): Promise<any>;
  getRegisteredProtocols(): string[];
  getHealthStatus(): any;
}
