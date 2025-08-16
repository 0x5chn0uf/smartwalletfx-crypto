/**
 * Options for computing an address' DeFi portfolio.
 *
 * Notes
 * - Implementations SHOULD apply provider-aware batching/caching.
 * - Implementations SHOULD return a consistent shape across providers.
 * - Idempotent: yes (read-only).
 */
export interface GetDeFiPortfolioOptions {
  chainIds?: any[];
  protocols?: any[];
  includeInactive?: boolean;
  includeYield?: boolean;
  includeRisk?: boolean;
  minValue?: number;
  forceRefresh?: boolean;
}

/**
 * DeFiPort (v1)
 *
 * Hexagonal port for DeFi portfolio aggregation and protocol queries.
 * Implementations MUST be side-effect free (reads only) and surface
 * provider/retry/caching behavior via consistent error semantics.
 */
export interface DeFiPort {
  /**
   * Compute an aggregated DeFi portfolio for a wallet.
   * @param address - EVM/Solana-compatible wallet address (implementation-specific support)
   * @param options - Filtering and enrichment options
   * @returns Aggregated portfolio with positions, totals, and breakdowns
   * @throws {ExternalApiError|RateLimitError|ValidationError}
   */
  getDeFiPortfolio(address: string, options: GetDeFiPortfolioOptions): Promise<any>;

  /**
   * Fetch positions for a specific protocol; mirrors orchestrator signature for performance.
   * @param protocol - Protocol identifier (enum/string)
   * @param address - Wallet address
   * @param chainId - Optional chain to scope the query
   * @returns Array of normalized positions
   */
  getProtocolPositions(protocol: any, address: string, chainId?: any): Promise<any>;

  /**
   * List protocol identifiers handled by this adapter.
   */
  getRegisteredProtocols(): string[];

  /**
   * Health state for DeFi integration (per-protocol if applicable):
   * { isHealthy: boolean, lastCheckedAt?: string, issues?: string[] }
   */
  getHealthStatus(): any;
}
