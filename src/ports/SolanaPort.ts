export interface SolanaPortfolioOptions {
  protocols?: any[];
  includeInactive?: boolean;
  includeYield?: boolean;
  includeRisk?: boolean;
  includeAnalytics?: boolean;
  minValue?: number;
  forceRefresh?: boolean;
}

export interface SolanaPort {
  getPortfolio(address: string, options: SolanaPortfolioOptions): Promise<any>;
  getPortfolioAnalytics(
    address: string,
    options: Pick<SolanaPortfolioOptions, 'protocols' | 'includeYield' | 'includeRisk'>
  ): Promise<any>;
  analyzeCrossChainPositions(solanaAddress: string, evmAddresses: string[]): Promise<any>;
  getDeFiPositions(
    address: string,
    options: Omit<SolanaPortfolioOptions, 'includeAnalytics' | 'forceRefresh'>
  ): Promise<any>;
  getHealthStatus(): Promise<any> | any;
  getStats?(): Promise<any>;
}
