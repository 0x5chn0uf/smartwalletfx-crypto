/**
 * Options for computing an address' NFT portfolio.
 *
 * Notes
 * - Implementations SHOULD enrich metadata when includeMetadata=true.
 * - Implementations MAY compute analytics (floor, listings) when includeAnalytics=true.
 * - Idempotent: yes (read-only).
 */
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

/**
 * NFTPort (v1)
 *
 * Hexagonal port for NFT portfolio and metadata operations.
 * Implementations SHOULD normalize collection/token metadata and prices.
 */
export interface NFTPort {
  /**
   * Compute an aggregated NFT portfolio for a wallet.
   */
  getNFTPortfolio(address: string, options: GetNFTPortfolioOptions): Promise<any>;

  /**
   * Get collection-level information and optional analytics.
   */
  getCollectionInfo(contract: string, chainId: any, includeAnalytics?: boolean): Promise<any>;

  /**
   * Get NFT token metadata for a contract/tokenId on a given chain.
   */
  getNFTMetadata(contract: string, tokenId: string, chainId: any): Promise<any>;

  /**
   * List registered NFT detectors (discovery sources).
   */
  getRegisteredDetectors(): string[];

  /**
   * List registered metadata enrichers (augmenters).
   */
  getRegisteredEnrichers(): string[];

  /**
   * Health state for NFT services: { isHealthy: boolean, detectors: {}, enrichers: {} }
   */
  getHealthStatus(): any;
}
