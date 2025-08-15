import { logger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { ChainId } from '@/types/blockchain';
import {
  NFTToken,
  NFTCollection,
  NFTPortfolio,
  NFTDetectionResult,
  NFTApiResponse,
  NFTStandard,
  NFTCategory,
  NFTMarketplace,
  NFTTransaction,
  NFTListing,
  CollectionAnalytics,
  NFTPrice,
} from '@/types/nft';

// NFT Detector Interface
export interface NFTDetector {
  readonly name: string;
  readonly supportedChains: ChainId[];
  readonly supportedStandards: NFTStandard[];
  readonly supportedMarketplaces?: NFTMarketplace[];
  
  // Core detection methods
  detectNFTs(address: string, chainId: ChainId): Promise<NFTDetectionResult>;
  getNFTMetadata(contractAddress: string, tokenId: string, chainId: ChainId): Promise<NFTToken | null>;
  getCollectionInfo(contractAddress: string, chainId: ChainId): Promise<NFTCollection | null>;
  
  // Optional marketplace integration
  getListings?(contractAddress: string, tokenId: string, chainId: ChainId): Promise<NFTListing[]>;
  getCollectionAnalytics?(contractAddress: string, chainId: ChainId, timeframe?: string): Promise<CollectionAnalytics | null>;
  
  // Health check
  isHealthy(): Promise<boolean>;
}

// NFT Metadata Enricher Interface
export interface NFTMetadataEnricher {
  readonly name: string;
  readonly priority: number; // Lower number = higher priority
  
  enrichMetadata(nft: NFTToken): Promise<NFTToken>;
  enrichCollection(collection: NFTCollection): Promise<NFTCollection>;
  
  isHealthy(): Promise<boolean>;
}

// NFT Orchestrator Health Status
interface NFTOrchestratorHealth {
  isHealthy: boolean;
  lastCheckedAt: Date;
  detectors: Record<string, {
    isHealthy: boolean;
    responseTime?: number;
    lastCheckedAt: Date;
    errors?: string[];
  }>;
  enrichers: Record<string, {
    isHealthy: boolean;
    responseTime?: number;
    lastCheckedAt: Date;
    errors?: string[];
  }>;
}

// Portfolio Aggregation Options
export interface NFTPortfolioOptions {
  chainIds?: ChainId[];
  includeMetadata?: boolean;
  includeListings?: boolean;
  includeAnalytics?: boolean;
  forceRefresh?: boolean;
  minValue?: number; // USD
  categories?: NFTCategory[];
  standards?: NFTStandard[];
}

export class NFTOrchestrator {
  private detectors = new Map<string, NFTDetector>();
  private enrichers = new Map<string, NFTMetadataEnricher>();
  private health: NFTOrchestratorHealth = {
    isHealthy: true,
    lastCheckedAt: new Date(),
    detectors: {},
    enrichers: {},
  };

  private readonly CACHE_DURATION = {
    portfolio: 300, // 5 minutes
    collection: 600, // 10 minutes
    metadata: 1800, // 30 minutes
    analytics: 3600, // 1 hour
  };

  constructor() {
    logger.info('NFT Orchestrator initialized');
  }

  // Register NFT detector
  registerDetector(detector: NFTDetector): void {
    this.detectors.set(detector.name, detector);
    this.health.detectors[detector.name] = {
      isHealthy: true,
      lastCheckedAt: new Date(),
    };
    
    logger.info(`NFT detector registered: ${detector.name}`, {
      supportedChains: detector.supportedChains,
      supportedStandards: detector.supportedStandards,
    });
  }

  // Register metadata enricher
  registerEnricher(enricher: NFTMetadataEnricher): void {
    this.enrichers.set(enricher.name, enricher);
    this.health.enrichers[enricher.name] = {
      isHealthy: true,
      lastCheckedAt: new Date(),
    };
    
    logger.info(`NFT metadata enricher registered: ${enricher.name}`, {
      priority: enricher.priority,
    });
  }

  // Get NFT portfolio for an address
  async getNFTPortfolio(
    address: string,
    options: NFTPortfolioOptions = {}
  ): Promise<NFTApiResponse<NFTPortfolio>> {
    const startTime = Date.now();
    const requestId = `nft-portfolio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      logger.info('Fetching NFT portfolio', { address, options, requestId });

      // Check cache first
      const cacheKey = `nft-portfolio:${address}:${JSON.stringify(options)}`;
      if (!options.forceRefresh) {
        const cached = await redisManager.get<NFTPortfolio>(cacheKey);
        if (cached) {
          logger.debug('NFT portfolio cache hit', { address, requestId });
          return {
            success: true,
            data: cached,
            metadata: {
              timestamp: new Date().toISOString(),
              requestId,
              cacheHit: true,
              processingTime: `${Date.now() - startTime}ms`,
            },
          };
        }
      }

      // Determine target chains
      const targetChains = options.chainIds || [
        ChainId.ETHEREUM,
        ChainId.POLYGON,
        ChainId.ARBITRUM,
        ChainId.OPTIMISM,
        ChainId.BASE,
        ChainId.SOLANA,
      ];

      // Fetch NFTs from all chains concurrently
      const detectionPromises = targetChains.map(async (chainId) => {
        try {
          return await this.detectNFTsForChain(address, chainId, options);
        } catch (error) {
          logger.error(`Failed to detect NFTs for chain ${chainId}`, {
            error: error instanceof Error ? error.message : 'Unknown error',
            address,
            chainId,
            requestId,
          });
          return null;
        }
      });

      const detectionResults = await Promise.all(detectionPromises);
      const validResults = detectionResults.filter((result): result is NFTDetectionResult => result !== null);

      // Aggregate all NFTs and collections
      const allNFTs: NFTToken[] = [];
      const allCollections = new Map<string, NFTCollection>();

      for (const result of validResults) {
        allNFTs.push(...result.nfts);
        for (const collection of result.collections) {
          allCollections.set(collection.id, collection);
        }
      }

      // Apply filters
      let filteredNFTs = allNFTs;
      
      if (options.categories) {
        filteredNFTs = filteredNFTs.filter(nft => options.categories!.includes(nft.category));
      }
      
      if (options.standards) {
        filteredNFTs = filteredNFTs.filter(nft => options.standards!.includes(nft.standard));
      }
      
      if (options.minValue) {
        filteredNFTs = filteredNFTs.filter(nft => 
          nft.estimatedValue?.usdValue && nft.estimatedValue.usdValue >= options.minValue!
        );
      }

      // Enrich metadata if requested
      if (options.includeMetadata) {
        filteredNFTs = await this.enrichNFTMetadata(filteredNFTs);
      }

      // Enrich with marketplace data if requested
      if (options.includeListings) {
        await this.enrichWithListingData(filteredNFTs);
      }

      // Build portfolio summary
      const portfolio = await this.buildPortfolioSummary(address, filteredNFTs, Array.from(allCollections.values()));

      // Cache the result
      await redisManager.set(cacheKey, portfolio, this.CACHE_DURATION.portfolio);

      const processingTime = Date.now() - startTime;
      logger.info('NFT portfolio fetched successfully', {
        address,
        totalNFTs: portfolio.totalNFTs,
        totalCollections: portfolio.totalCollections,
        processingTime,
        requestId,
      });

      return {
        success: true,
        data: portfolio,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId,
          cacheHit: false,
          processingTime: `${processingTime}ms`,
        },
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      logger.error('Failed to fetch NFT portfolio', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address,
        processingTime,
        requestId,
      });

      return {
        success: false,
        error: {
          code: 'NFT_PORTFOLIO_ERROR',
          message: 'Failed to fetch NFT portfolio',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId,
          processingTime: `${processingTime}ms`,
        },
      };
    }
  }

  // Get collection information
  async getCollectionInfo(
    contractAddress: string,
    chainId: ChainId,
    includeAnalytics = false
  ): Promise<NFTApiResponse<NFTCollection & { analytics?: CollectionAnalytics }>> {
    const startTime = Date.now();
    const requestId = `collection-info-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Check cache first
      const cacheKey = `nft-collection:${chainId}:${contractAddress}:${includeAnalytics}`;
      const cached = await redisManager.get<NFTCollection & { analytics?: CollectionAnalytics }>(cacheKey);
      
      if (cached) {
        return {
          success: true,
          data: cached,
          metadata: {
            timestamp: new Date().toISOString(),
            requestId,
            cacheHit: true,
            processingTime: `${Date.now() - startTime}ms`,
          },
        };
      }

      // Find detectors that support this chain
      const supportedDetectors = Array.from(this.detectors.values())
        .filter(detector => detector.supportedChains.includes(chainId));

      if (supportedDetectors.length === 0) {
        throw new Error(`No NFT detectors available for chain ${chainId}`);
      }

      // Try each detector until we get collection info
      let collection: NFTCollection | null = null;
      for (const detector of supportedDetectors) {
        try {
          collection = await detector.getCollectionInfo(contractAddress, chainId);
          if (collection) break;
        } catch (error) {
          logger.warn(`Detector ${detector.name} failed to get collection info`, {
            error: error instanceof Error ? error.message : 'Unknown error',
            contractAddress,
            chainId,
          });
        }
      }

      if (!collection) {
        throw new Error('Collection not found or not supported');
      }

      let result: NFTCollection & { analytics?: CollectionAnalytics } = collection;

      // Get analytics if requested
      if (includeAnalytics) {
        for (const detector of supportedDetectors) {
          if (detector.getCollectionAnalytics) {
            try {
              const analytics = await detector.getCollectionAnalytics(contractAddress, chainId);
              if (analytics) {
                result.analytics = analytics;
                break;
              }
            } catch (error) {
              logger.warn(`Failed to get collection analytics from ${detector.name}`, {
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }
        }
      }

      // Cache the result
      await redisManager.set(cacheKey, result, this.CACHE_DURATION.collection);

      return {
        success: true,
        data: result,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId,
          cacheHit: false,
          processingTime: `${Date.now() - startTime}ms`,
        },
      };

    } catch (error) {
      logger.error('Failed to get collection info', {
        error: error instanceof Error ? error.message : 'Unknown error',
        contractAddress,
        chainId,
        requestId,
      });

      return {
        success: false,
        error: {
          code: 'COLLECTION_INFO_ERROR',
          message: 'Failed to get collection information',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId,
          processingTime: `${Date.now() - startTime}ms`,
        },
      };
    }
  }

  // Get NFT metadata
  async getNFTMetadata(
    contractAddress: string,
    tokenId: string,
    chainId: ChainId
  ): Promise<NFTApiResponse<NFTToken>> {
    const startTime = Date.now();
    const requestId = `nft-metadata-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Check cache first
      const cacheKey = `nft-metadata:${chainId}:${contractAddress}:${tokenId}`;
      const cached = await redisManager.get<NFTToken>(cacheKey);
      
      if (cached) {
        return {
          success: true,
          data: cached,
          metadata: {
            timestamp: new Date().toISOString(),
            requestId,
            cacheHit: true,
            processingTime: `${Date.now() - startTime}ms`,
          },
        };
      }

      // Find detectors that support this chain
      const supportedDetectors = Array.from(this.detectors.values())
        .filter(detector => detector.supportedChains.includes(chainId));

      if (supportedDetectors.length === 0) {
        throw new Error(`No NFT detectors available for chain ${chainId}`);
      }

      // Try each detector until we get NFT metadata
      let nft: NFTToken | null = null;
      for (const detector of supportedDetectors) {
        try {
          nft = await detector.getNFTMetadata(contractAddress, tokenId, chainId);
          if (nft) break;
        } catch (error) {
          logger.warn(`Detector ${detector.name} failed to get NFT metadata`, {
            error: error instanceof Error ? error.message : 'Unknown error',
            contractAddress,
            tokenId,
            chainId,
          });
        }
      }

      if (!nft) {
        throw new Error('NFT not found or metadata unavailable');
      }

      // Enrich metadata
      const enrichedNFTs = await this.enrichNFTMetadata([nft]);
      nft = enrichedNFTs[0] || nft;

      // Cache the result
      await redisManager.set(cacheKey, nft, this.CACHE_DURATION.metadata);

      return {
        success: true,
        data: nft,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId,
          cacheHit: false,
          processingTime: `${Date.now() - startTime}ms`,
        },
      };

    } catch (error) {
      logger.error('Failed to get NFT metadata', {
        error: error instanceof Error ? error.message : 'Unknown error',
        contractAddress,
        tokenId,
        chainId,
        requestId,
      });

      return {
        success: false,
        error: {
          code: 'NFT_METADATA_ERROR',
          message: 'Failed to get NFT metadata',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId,
          processingTime: `${Date.now() - startTime}ms`,
        },
      };
    }
  }

  // Get registered detectors
  getRegisteredDetectors(): string[] {
    return Array.from(this.detectors.keys());
  }

  // Get registered enrichers
  getRegisteredEnrichers(): string[] {
    return Array.from(this.enrichers.keys());
  }

  // Health check
  async checkHealth(): Promise<NFTOrchestratorHealth> {
    const startTime = Date.now();

    // Check all detectors
    for (const [name, detector] of this.detectors) {
      try {
        const isHealthy = await detector.isHealthy();
        this.health.detectors[name] = {
          isHealthy,
          responseTime: Date.now() - startTime,
          lastCheckedAt: new Date(),
          errors: isHealthy ? [] : ['Health check failed'],
        };
      } catch (error) {
        this.health.detectors[name] = {
          isHealthy: false,
          responseTime: Date.now() - startTime,
          lastCheckedAt: new Date(),
          errors: [error instanceof Error ? error.message : 'Unknown error'],
        };
      }
    }

    // Check all enrichers
    for (const [name, enricher] of this.enrichers) {
      try {
        const isHealthy = await enricher.isHealthy();
        this.health.enrichers[name] = {
          isHealthy,
          responseTime: Date.now() - startTime,
          lastCheckedAt: new Date(),
          errors: isHealthy ? [] : ['Health check failed'],
        };
      } catch (error) {
        this.health.enrichers[name] = {
          isHealthy: false,
          responseTime: Date.now() - startTime,
          lastCheckedAt: new Date(),
          errors: [error instanceof Error ? error.message : 'Unknown error'],
        };
      }
    }

    // Overall health
    const allDetectorsHealthy = Object.values(this.health.detectors).every(d => d.isHealthy);
    const allEnrichersHealthy = Object.values(this.health.enrichers).every(e => e.isHealthy);
    
    this.health.isHealthy = allDetectorsHealthy && allEnrichersHealthy;
    this.health.lastCheckedAt = new Date();

    return { ...this.health };
  }

  // Get health status
  getHealthStatus(): NFTOrchestratorHealth {
    return { ...this.health };
  }

  // Additional helper methods for marketplace enrichment
  private async enrichWithListingData(nfts: NFTToken[]): Promise<void> {
    if (nfts.length === 0) return;

    // Group NFTs by chain and detector capability
    const nftsByChain = new Map<ChainId, NFTToken[]>();
    for (const nft of nfts) {
      const chainNFTs = nftsByChain.get(nft.chainId) || [];
      chainNFTs.push(nft);
      nftsByChain.set(nft.chainId, chainNFTs);
    }

    // Enrich listings for each chain
    for (const [chainId, chainNFTs] of nftsByChain) {
      const supportedDetectors = Array.from(this.detectors.values())
        .filter(detector => 
          detector.supportedChains.includes(chainId) && 
          detector.getListings
        );

      for (const detector of supportedDetectors) {
        for (const nft of chainNFTs) {
          try {
            if (detector.getListings) {
              const listings = await detector.getListings(nft.contractAddress, nft.tokenId, chainId);
              if (listings.length > 0) {
                const activeListing = listings.find(l => l.status === 'active');
                if (activeListing) {
                  nft.isListed = true;
                  nft.listingPrice = activeListing.price;
                }
              }
            }
          } catch (error) {
            logger.debug(`Failed to get listings from ${detector.name}`, {
              error: error instanceof Error ? error.message : 'Unknown error',
              nftId: nft.id,
            });
          }
        }
      }
    }
  }

  // Stop the orchestrator
  stop(): void {
    logger.info('NFT Orchestrator stopped');
  }

  // Private helper methods

  private async detectNFTsForChain(
    address: string,
    chainId: ChainId,
    options: NFTPortfolioOptions
  ): Promise<NFTDetectionResult | null> {
    const supportedDetectors = Array.from(this.detectors.values())
      .filter(detector => detector.supportedChains.includes(chainId));

    if (supportedDetectors.length === 0) {
      logger.warn(`No NFT detectors available for chain ${chainId}`);
      return null;
    }

    // Try each detector until we get a successful result
    for (const detector of supportedDetectors) {
      try {
        const result = await detector.detectNFTs(address, chainId);
        logger.debug(`NFT detection successful for chain ${chainId}`, {
          detector: detector.name,
          nftCount: result.nfts.length,
          collectionCount: result.collections.length,
        });
        return result;
      } catch (error) {
        logger.warn(`NFT detector ${detector.name} failed for chain ${chainId}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          address,
          chainId,
        });
      }
    }

    return null;
  }

  private async enrichNFTMetadata(nfts: NFTToken[]): Promise<NFTToken[]> {
    if (this.enrichers.size === 0) {
      return nfts;
    }

    // Get enrichers sorted by priority
    const sortedEnrichers = Array.from(this.enrichers.values())
      .sort((a, b) => a.priority - b.priority);

    const enrichedNFTs: NFTToken[] = [];

    for (const nft of nfts) {
      let enrichedNFT = nft;
      
      for (const enricher of sortedEnrichers) {
        try {
          enrichedNFT = await enricher.enrichMetadata(enrichedNFT);
        } catch (error) {
          logger.warn(`NFT metadata enricher ${enricher.name} failed`, {
            error: error instanceof Error ? error.message : 'Unknown error',
            nftId: nft.id,
          });
        }
      }
      
      enrichedNFTs.push(enrichedNFT);
    }

    return enrichedNFTs;
  }

  private async buildPortfolioSummary(
    address: string,
    nfts: NFTToken[],
    collections: NFTCollection[]
  ): Promise<NFTPortfolio> {
    // Calculate total values
    const totalValue = this.calculateTotalValue(nfts, 'estimatedValue');
    const totalFloorValue = this.calculateTotalValue(nfts, 'floorPrice');

    // Build distributions
    const chainDistribution = this.buildChainDistribution(nfts);
    const categoryDistribution = this.buildCategoryDistribution(nfts);
    const collectionDistribution = this.buildCollectionDistribution(nfts, collections);

    // Get top holdings
    const topCollections = this.getTopCollections(nfts, collections).slice(0, 10);
    const topValueNFTs = nfts
      .filter(nft => nft.estimatedValue?.usdValue)
      .sort((a, b) => (b.estimatedValue?.usdValue || 0) - (a.estimatedValue?.usdValue || 0))
      .slice(0, 10);

    const recentlyAcquired = nfts
      .filter(nft => nft.lastTransferredAt)
      .sort((a, b) => (b.lastTransferredAt?.getTime() || 0) - (a.lastTransferredAt?.getTime() || 0))
      .slice(0, 10);

    // Build activity summary
    const activitySummary = this.buildActivitySummary(nfts);

    const now = new Date();
    const portfolio: NFTPortfolio = {
      address,
      totalNFTs: nfts.length,
      totalCollections: collections.length,
      totalValue,
      totalFloorValue,
      chainDistribution,
      categoryDistribution,
      collectionDistribution,
      topCollections,
      topValueNFTs,
      recentlyAcquired,
      activitySummary,
      lastUpdatedAt: now,
      cacheExpiresAt: new Date(now.getTime() + this.CACHE_DURATION.portfolio * 1000),
    };

    return portfolio;
  }

  private calculateTotalValue(nfts: NFTToken[], priceField: 'estimatedValue' | 'floorPrice'): NFTPrice {
    const totalUsd = nfts.reduce((sum, nft) => {
      const price = nft[priceField];
      return sum + (price?.usdValue || 0);
    }, 0);

    return {
      amount: totalUsd.toString(),
      currency: 'USD',
      usdValue: totalUsd,
      timestamp: new Date(),
    };
  }

  private buildChainDistribution(nfts: NFTToken[]) {
    const distribution = new Map<ChainId, { count: number; value: number }>();
    
    for (const nft of nfts) {
      const existing = distribution.get(nft.chainId) || { count: 0, value: 0 };
      existing.count++;
      existing.value += nft.estimatedValue?.usdValue || 0;
      distribution.set(nft.chainId, existing);
    }

    const totalValue = Array.from(distribution.values()).reduce((sum, d) => sum + d.value, 0);

    return Array.from(distribution.entries()).map(([chainId, data]) => ({
      chainId,
      count: data.count,
      value: {
        amount: data.value.toString(),
        currency: 'USD',
        usdValue: data.value,
        timestamp: new Date(),
      } as NFTPrice,
      percentage: totalValue > 0 ? (data.value / totalValue) * 100 : 0,
    }));
  }

  private buildCategoryDistribution(nfts: NFTToken[]) {
    const distribution = new Map<NFTCategory, { count: number; value: number }>();
    
    for (const nft of nfts) {
      const existing = distribution.get(nft.category) || { count: 0, value: 0 };
      existing.count++;
      existing.value += nft.estimatedValue?.usdValue || 0;
      distribution.set(nft.category, existing);
    }

    const totalValue = Array.from(distribution.values()).reduce((sum, d) => sum + d.value, 0);

    return Array.from(distribution.entries()).map(([category, data]) => ({
      category,
      count: data.count,
      value: {
        amount: data.value.toString(),
        currency: 'USD',
        usdValue: data.value,
        timestamp: new Date(),
      } as NFTPrice,
      percentage: totalValue > 0 ? (data.value / totalValue) * 100 : 0,
    }));
  }

  private buildCollectionDistribution(nfts: NFTToken[], collections: NFTCollection[]) {
    const distribution = new Map<string, { collection: NFTCollection; count: number; totalValue: number; floorValue: number }>();
    
    for (const nft of nfts) {
      const collectionId = `${nft.chainId}:${nft.collectionAddress || nft.contractAddress}`;
      const collection = collections.find(c => c.id === collectionId);
      
      if (collection) {
        const existing = distribution.get(collectionId) || { 
          collection, 
          count: 0, 
          totalValue: 0, 
          floorValue: 0 
        };
        existing.count++;
        existing.totalValue += nft.estimatedValue?.usdValue || 0;
        existing.floorValue += nft.floorPrice?.usdValue || 0;
        distribution.set(collectionId, existing);
      }
    }

    const totalValue = Array.from(distribution.values()).reduce((sum, d) => sum + d.totalValue, 0);

    return Array.from(distribution.values()).map(data => ({
      collection: data.collection,
      count: data.count,
      totalValue: {
        amount: data.totalValue.toString(),
        currency: 'USD',
        usdValue: data.totalValue,
        timestamp: new Date(),
      } as NFTPrice,
      floorValue: {
        amount: data.floorValue.toString(),
        currency: 'USD',
        usdValue: data.floorValue,
        timestamp: new Date(),
      } as NFTPrice,
      percentage: totalValue > 0 ? (data.totalValue / totalValue) * 100 : 0,
    }));
  }

  private getTopCollections(nfts: NFTToken[], collections: NFTCollection[]) {
    const collectionMap = new Map<string, {
      collection: NFTCollection;
      ownedCount: number;
      totalValue: number;
    }>();

    for (const nft of nfts) {
      const collectionId = `${nft.chainId}:${nft.collectionAddress || nft.contractAddress}`;
      const collection = collections.find(c => c.id === collectionId);
      
      if (collection) {
        const existing = collectionMap.get(collectionId) || {
          collection,
          ownedCount: 0,
          totalValue: 0,
        };
        existing.ownedCount++;
        existing.totalValue += nft.estimatedValue?.usdValue || 0;
        collectionMap.set(collectionId, existing);
      }
    }

    return Array.from(collectionMap.values())
      .sort((a, b) => b.totalValue - a.totalValue)
      .map(data => ({
        collection: data.collection,
        ownedCount: data.ownedCount,
        totalValue: {
          amount: data.totalValue.toString(),
          currency: 'USD',
          usdValue: data.totalValue,
          timestamp: new Date(),
        } as NFTPrice,
        averageValue: {
          amount: (data.totalValue / data.ownedCount).toString(),
          currency: 'USD',
          usdValue: data.totalValue / data.ownedCount,
          timestamp: new Date(),
        } as NFTPrice,
      }));
  }

  private buildActivitySummary(nfts: NFTToken[]) {
    const transferredNFTs = nfts.filter(nft => nft.lastTransferredAt);
    const dates = transferredNFTs.map(nft => nft.lastTransferredAt!).filter(Boolean);

    return {
      totalTransactions: transferredNFTs.length,
      totalSpent: {
        amount: '0',
        currency: 'USD',
        usdValue: 0,
        timestamp: new Date(),
      } as NFTPrice,
      totalReceived: {
        amount: '0',
        currency: 'USD',
        usdValue: 0,
        timestamp: new Date(),
      } as NFTPrice,
      netPosition: {
        amount: '0',
        currency: 'USD',
        usdValue: 0,
        timestamp: new Date(),
      } as NFTPrice,
      firstActivityAt: dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : undefined,
      lastActivityAt: dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : undefined,
    };
  }
}

// Export singleton instance
export const nftOrchestrator = new NFTOrchestrator();