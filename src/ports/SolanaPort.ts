/**
 * Options for Solana portfolio/DeFi queries.
 */
export interface SolanaPortfolioOptions {
  protocols?: any[];
  includeInactive?: boolean;
  includeYield?: boolean;
  includeRisk?: boolean;
  includeAnalytics?: boolean;
  minValue?: number;
  forceRefresh?: boolean;
}

/**
 * SolanaPort (v1)
 *
 * Hexagonal port for Solana DeFi and cross-chain analytics.
 */
export interface SolanaPort {
  /**
   * Compute an aggregated Solana portfolio for a wallet.
   */
  getPortfolio(address: string, options: SolanaPortfolioOptions): Promise<any>;

  /**
   * Compute analytics for a Solana wallet (yield/risk summaries, etc.).
   */
  getPortfolioAnalytics(
    address: string,
    options: Pick<SolanaPortfolioOptions, 'protocols' | 'includeYield' | 'includeRisk'>
  ): Promise<any>;

  /**
   * Analyze positions across Solana and EVM addresses for correlation and aggregation.
   */
  analyzeCrossChainPositions(solanaAddress: string, evmAddresses: string[]): Promise<any>;

  /**
   * Get DeFi positions on Solana.
   */
  getDeFiPositions(
    address: string,
    options: Omit<SolanaPortfolioOptions, 'includeAnalytics' | 'forceRefresh'>
  ): Promise<any>;

  /**
   * Health state for Solana integrations; adapters SHOULD include endpoint health and latency.
   */
  getHealthStatus(): Promise<any> | any;

  /**
   * Optional: adapter-reported statistics (throughput, cache hit-rate, provider mix).
   */
  getStats?(): Promise<any>;
}
