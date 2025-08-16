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

export interface NFTPort {
  getNFTPortfolio(address: string, options: GetNFTPortfolioOptions): Promise<any>;
  getCollectionInfo(contract: string, chainId: any, includeAnalytics?: boolean): Promise<any>;
  getNFTMetadata(contract: string, tokenId: string, chainId: any): Promise<any>;
  getRegisteredDetectors(): string[];
  getRegisteredEnrichers(): string[];
  getHealthStatus(): any;
}

