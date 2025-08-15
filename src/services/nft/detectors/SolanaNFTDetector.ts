import axios from 'axios';
import { logger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { ChainId } from '@/types/blockchain';
import {
  NFTToken,
  NFTCollection,
  NFTDetectionResult,
  NFTStandard,
  NFTCategory,
  NFTMarketplace,
  NFTPrice,
  NFTAttribute,
  NFTContractMetadata,
} from '@/types/nft';
import { NFTDetector } from '../NFTOrchestrator';

// Helius API Types
interface HeliusNFT {
  id: string;
  content: {
    $schema: string;
    json_uri: string;
    files: Array<{
      uri: string;
      type: string;
    }>;
    metadata: {
      attributes: Array<{
        trait_type: string;
        value: string | number;
      }>;
      description: string;
      name: string;
      symbol: string;
      image?: string;
      animation_url?: string;
      external_url?: string;
    };
    links: {
      image?: string;
      animation_url?: string;
      external_url?: string;
    };
  };
  authorities: Array<{
    address: string;
    scopes: string[];
  }>;
  compression: {
    eligible: boolean;
    compressed: boolean;
    data_hash: string;
    creator_hash: string;
    asset_hash: string;
    tree: string;
    seq: number;
    leaf_id: number;
  };
  grouping: Array<{
    group_key: string;
    group_value: string;
  }>;
  royalty: {
    royalty_model: string;
    target?: string;
    percent: number;
    basis_points: number;
    primary_sale_happened: boolean;
    locked: boolean;
  };
  creators: Array<{
    address: string;
    share: number;
    verified: boolean;
  }>;
  ownership: {
    frozen: boolean;
    delegated: boolean;
    delegate?: string;
    ownership_model: string;
    owner: string;
  };
  supply: {
    print_max_supply: number;
    print_current_supply: number;
    edition_nonce?: number;
  };
  mutable: boolean;
  burnt: boolean;
  token_info?: {
    symbol: string;
    balance: number;
    supply: number;
    decimals: number;
    token_program: string;
    associated_token_address: string;
  };
}

// Magic Eden API Types
interface MagicEdenCollection {
  symbol: string;
  name: string;
  description: string;
  image: string;
  twitter?: string;
  discord?: string;
  website?: string;
  categories: string[];
  floorPrice?: number;
  listedCount?: number;
  volumeAll?: number;
}

interface MagicEdenNFT {
  mintAddress: string;
  owner: string;
  supply: number;
  collection: string;
  name: string;
  updateAuthority: string;
  primarySaleHappened: boolean;
  sellerFeeBasisPoints: number;
  image: string;
  attributes: Array<{
    trait_type: string;
    value: string | number;
  }>;
  properties: {
    files: Array<{
      uri: string;
      type: string;
    }>;
    category: string;
    creators: Array<{
      address: string;
      share: number;
    }>;
  };
  price?: number;
  listStatus?: string;
}

export class SolanaNFTDetector implements NFTDetector {
  readonly name = 'Solana-NFT-Detector';
  readonly supportedChains = [ChainId.SOLANA];
  readonly supportedStandards = [NFTStandard.SPL_TOKEN, NFTStandard.METAPLEX];
  readonly supportedMarketplaces = [NFTMarketplace.MAGIC_EDEN, NFTMarketplace.TENSOR, NFTMarketplace.SOLANART];

  private readonly heliusApiKey: string;
  private readonly heliusBaseUrl = 'https://api.helius.xyz/v0';
  private readonly magicEdenBaseUrl = 'https://api-mainnet.magiceden.dev/v2';
  
  private lastHealthCheck = new Date();
  private isHealthyStatus = true;

  constructor(heliusApiKey?: string) {
    this.heliusApiKey = heliusApiKey || process.env.HELIUS_API_KEY || '';
    
    if (!this.heliusApiKey) {
      logger.warn('No Helius API key provided for Solana NFT detection');
      this.isHealthyStatus = false;
    }
  }

  async detectNFTs(address: string, chainId: ChainId): Promise<NFTDetectionResult> {
    if (chainId !== ChainId.SOLANA) {
      throw new Error(`Solana NFT detector does not support chain ${chainId}`);
    }

    const startTime = Date.now();
    
    try {
      logger.info('Starting Solana NFT detection', { address });

      // Check cache first
      const cacheKey = `solana-nft-detection:${address}`;
      const cached = await redisManager.get<NFTDetectionResult>(cacheKey);
      
      if (cached && cached.nextScanAt > new Date()) {
        logger.debug('Solana NFT detection cache hit', { address });
        return cached;
      }

      // Get NFTs from Helius
      const heliusNFTs = await this.getNFTsFromHelius(address);
      
      // Convert to our NFT format
      const nfts: NFTToken[] = [];
      const collectionsMap = new Map<string, NFTCollection>();

      for (const heliusNFT of heliusNFTs) {
        const nft = this.convertHeliusNFTToToken(heliusNFT);
        if (nft) {
          nfts.push(nft);

          // Create collection entry
          const collectionKey = this.extractCollectionKey(heliusNFT);
          if (collectionKey && !collectionsMap.has(collectionKey)) {
            const collection = await this.createCollectionFromNFT(heliusNFT, collectionKey);
            if (collection) {
              collectionsMap.set(collectionKey, collection);
            }
          }
        }
      }

      // Enrich with marketplace data
      await this.enrichWithMarketplaceData(nfts, Array.from(collectionsMap.values()));

      // Calculate quality metrics
      const metadataCompleteness = this.calculateMetadataCompleteness(nfts);
      const priceDataAvailability = this.calculatePriceDataAvailability(nfts);

      const result: NFTDetectionResult = {
        address,
        chainId,
        nfts,
        collections: Array.from(collectionsMap.values()),
        totalCount: nfts.length,
        detectionMethod: 'indexer-api',
        coverage: {
          standardsCovered: this.supportedStandards,
          marketplacesCovered: this.supportedMarketplaces,
        },
        metadataCompleteness,
        priceDataAvailability,
        lastScanAt: new Date(),
        nextScanAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
      };

      // Cache the result
      await redisManager.set(cacheKey, result, 900); // 15 minutes

      const duration = Date.now() - startTime;
      logger.info('Solana NFT detection completed', {
        address,
        nftCount: nfts.length,
        collectionCount: collectionsMap.size,
        duration,
      });

      return result;

    } catch (error) {
      logger.error('Solana NFT detection failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address,
      });
      
      throw error;
    }
  }

  async getNFTMetadata(contractAddress: string, tokenId: string, chainId: ChainId): Promise<NFTToken | null> {
    if (chainId !== ChainId.SOLANA) {
      return null;
    }

    try {
      // In Solana, the "contractAddress" is actually the mint address
      const mintAddress = contractAddress;
      
      const heliusNFT = await this.getNFTFromHelius(mintAddress);
      if (!heliusNFT) {
        return null;
      }

      return this.convertHeliusNFTToToken(heliusNFT);

    } catch (error) {
      logger.error('Failed to get Solana NFT metadata', {
        error: error instanceof Error ? error.message : 'Unknown error',
        contractAddress,
        tokenId,
      });
      return null;
    }
  }

  async getCollectionInfo(contractAddress: string, chainId: ChainId): Promise<NFTCollection | null> {
    if (chainId !== ChainId.SOLANA) {
      return null;
    }

    try {
      // Try to get collection info from Magic Eden
      const collection = await this.getCollectionFromMagicEden(contractAddress);
      return collection;

    } catch (error) {
      logger.error('Failed to get Solana collection info', {
        error: error instanceof Error ? error.message : 'Unknown error',
        contractAddress,
      });
      return null;
    }
  }

  async isHealthy(): Promise<boolean> {
    if (!this.heliusApiKey) {
      this.isHealthyStatus = false;
      return false;
    }

    try {
      // Simple health check - try to make a request
      const response = await axios.get(`${this.heliusBaseUrl}/addresses/11111111111111111111111111111111/nfts`, {
        params: { 'api-key': this.heliusApiKey },
        timeout: 5000,
      });

      this.isHealthyStatus = response.status === 200;
      this.lastHealthCheck = new Date();
      
      return this.isHealthyStatus;
    } catch (error) {
      this.isHealthyStatus = false;
      this.lastHealthCheck = new Date();
      return false;
    }
  }

  // Private helper methods

  private async getNFTsFromHelius(address: string): Promise<HeliusNFT[]> {
    try {
      const response = await axios.get<HeliusNFT[]>(`${this.heliusBaseUrl}/addresses/${address}/nfts`, {
        params: {
          'api-key': this.heliusApiKey,
        },
        timeout: 10000,
      });

      return response.data || [];
    } catch (error) {
      logger.error('Failed to fetch NFTs from Helius', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address,
      });
      return [];
    }
  }

  private async getNFTFromHelius(mintAddress: string): Promise<HeliusNFT | null> {
    try {
      const response = await axios.get<HeliusNFT[]>(`${this.heliusBaseUrl}/nfts`, {
        params: {
          'api-key': this.heliusApiKey,
          ids: mintAddress,
        },
        timeout: 5000,
      });

      return response.data?.[0] || null;
    } catch (error) {
      logger.error('Failed to fetch NFT from Helius', {
        error: error instanceof Error ? error.message : 'Unknown error',
        mintAddress,
      });
      return null;
    }
  }

  private convertHeliusNFTToToken(heliusNFT: HeliusNFT): NFTToken | null {
    try {
      const metadata = heliusNFT.content?.metadata;
      if (!metadata) {
        return null;
      }

      // Determine NFT standard
      const standard = heliusNFT.compression?.compressed ? NFTStandard.METAPLEX : NFTStandard.SPL_TOKEN;

      // Parse attributes
      const attributes: NFTAttribute[] = metadata.attributes?.map(attr => ({
        traitType: attr.trait_type,
        value: attr.value,
      })) || [];

      // Get collection info from grouping
      const collectionGroup = heliusNFT.grouping?.find(g => g.group_key === 'collection');
      const collectionAddress = collectionGroup?.group_value;

      const nft: NFTToken = {
        id: `${ChainId.SOLANA}:${heliusNFT.id}:0`,
        chainId: ChainId.SOLANA,
        contractAddress: heliusNFT.id, // Mint address
        tokenId: '0', // Solana NFTs don't have token IDs like EVM
        standard,
        owner: heliusNFT.ownership?.owner || '',
        name: metadata.name || 'Unknown NFT',
        description: metadata.description,
        image: metadata.image || heliusNFT.content?.links?.image,
        animationUrl: metadata.animation_url || heliusNFT.content?.links?.animation_url,
        externalUrl: metadata.external_url || heliusNFT.content?.links?.external_url,
        attributes,
        collectionAddress,
        isListed: false, // Will be updated by marketplace enrichment
        category: this.categorizeNFT(metadata),
        createdAt: new Date(),
        lastUpdatedAt: new Date(),
        tokenUri: heliusNFT.content?.json_uri,
        metadata: heliusNFT,
      };

      return nft;

    } catch (error) {
      logger.warn('Failed to convert Helius NFT to token', {
        error: error instanceof Error ? error.message : 'Unknown error',
        nftId: heliusNFT.id,
      });
      return null;
    }
  }

  private extractCollectionKey(heliusNFT: HeliusNFT): string | null {
    const collectionGroup = heliusNFT.grouping?.find(g => g.group_key === 'collection');
    return collectionGroup?.group_value || null;
  }

  private async createCollectionFromNFT(heliusNFT: HeliusNFT, collectionKey: string): Promise<NFTCollection | null> {
    try {
      const metadata = heliusNFT.content?.metadata;
      if (!metadata) return null;

      // Try to get more collection info from Magic Eden
      let magicEdenCollection: MagicEdenCollection | null = null;
      try {
        magicEdenCollection = await this.getCollectionFromMagicEden(collectionKey);
      } catch {
        // Ignore Magic Eden errors
      }

      const collection: NFTCollection = {
        id: `${ChainId.SOLANA}:${collectionKey}`,
        chainId: ChainId.SOLANA,
        contractAddress: collectionKey,
        standard: heliusNFT.compression?.compressed ? NFTStandard.METAPLEX : NFTStandard.SPL_TOKEN,
        name: magicEdenCollection?.name || metadata.name || 'Unknown Collection',
        symbol: magicEdenCollection?.symbol || metadata.symbol || 'UNKNOWN',
        description: magicEdenCollection?.description || metadata.description,
        slug: collectionKey.toLowerCase(),
        image: magicEdenCollection?.image || metadata.image,
        metadata: {
          name: magicEdenCollection?.name || metadata.name || 'Unknown Collection',
          symbol: magicEdenCollection?.symbol || metadata.symbol || 'UNKNOWN',
          description: magicEdenCollection?.description || metadata.description,
          image: magicEdenCollection?.image || metadata.image,
          verified: false,
          category: this.categorizeNFT(metadata),
          floorPrice: magicEdenCollection?.floorPrice ? {
            amount: (magicEdenCollection.floorPrice / 1e9).toString(), // Convert lamports to SOL
            currency: 'SOL',
            usdValue: magicEdenCollection.floorPrice / 1e9, // Simplified
            timestamp: new Date(),
          } : undefined,
          socialLinks: {
            website: magicEdenCollection?.website,
            twitter: magicEdenCollection?.twitter,
            discord: magicEdenCollection?.discord,
          },
        },
        category: this.categorizeNFT(metadata),
        verified: false,
        stats: {
          totalSupply: 0, // Unknown for now
          ownersCount: 0, // Unknown for now
          listedCount: magicEdenCollection?.listedCount || 0,
          floorPrice: magicEdenCollection?.floorPrice ? {
            amount: (magicEdenCollection.floorPrice / 1e9).toString(),
            currency: 'SOL',
            usdValue: magicEdenCollection.floorPrice / 1e9,
            timestamp: new Date(),
          } : undefined,
          volumeTotal: magicEdenCollection?.volumeAll ? {
            amount: (magicEdenCollection.volumeAll / 1e9).toString(),
            currency: 'SOL',
            usdValue: magicEdenCollection.volumeAll / 1e9,
            timestamp: new Date(),
          } : {
            amount: '0',
            currency: 'SOL',
            timestamp: new Date(),
          },
          volume24h: { amount: '0', currency: 'SOL', timestamp: new Date() },
          volume7d: { amount: '0', currency: 'SOL', timestamp: new Date() },
          volume30d: { amount: '0', currency: 'SOL', timestamp: new Date() },
          salesCount24h: 0,
          salesCount7d: 0,
          salesCount30d: 0,
        },
        createdAt: new Date(),
        lastUpdatedAt: new Date(),
      };

      return collection;

    } catch (error) {
      logger.warn('Failed to create collection from NFT', {
        error: error instanceof Error ? error.message : 'Unknown error',
        collectionKey,
      });
      return null;
    }
  }

  private async getCollectionFromMagicEden(symbol: string): Promise<MagicEdenCollection | null> {
    try {
      const response = await axios.get<MagicEdenCollection>(`${this.magicEdenBaseUrl}/collections/${symbol}`, {
        timeout: 5000,
      });

      return response.data;
    } catch (error) {
      logger.debug('Failed to get collection from Magic Eden', {
        error: error instanceof Error ? error.message : 'Unknown error',
        symbol,
      });
      return null;
    }
  }

  private async enrichWithMarketplaceData(nfts: NFTToken[], collections: NFTCollection[]): Promise<void> {
    if (nfts.length === 0) return;

    try {
      // Enrich with Magic Eden data
      await this.enrichWithMagicEdenData(nfts, collections);
      
      // Enrich with Tensor data (if API key available)
      if (process.env.TENSOR_API_KEY) {
        await this.enrichWithTensorData(nfts, collections);
      }
      
      logger.debug('Marketplace data enrichment completed', {
        nftCount: nfts.length,
        collectionCount: collections.length,
      });
    } catch (error) {
      logger.warn('Failed to enrich with marketplace data', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async enrichWithMagicEdenData(nfts: NFTToken[], collections: NFTCollection[]): Promise<void> {
    // Group NFTs by collection for batch processing
    const nftsByCollection = new Map<string, NFTToken[]>();
    
    for (const nft of nfts) {
      if (nft.collectionAddress) {
        const collectionNFTs = nftsByCollection.get(nft.collectionAddress) || [];
        collectionNFTs.push(nft);
        nftsByCollection.set(nft.collectionAddress, collectionNFTs);
      }
    }

    // Process each collection
    for (const [collectionAddress, collectionNFTs] of nftsByCollection) {
      try {
        // Get collection floor price and stats
        const collectionStats = await this.getMagicEdenCollectionStats(collectionAddress);
        
        if (collectionStats) {
          // Update collection with current stats
          const collection = collections.find(c => c.contractAddress === collectionAddress);
          if (collection && collectionStats.floorPrice) {
            collection.stats.floorPrice = {
              amount: (collectionStats.floorPrice / 1e9).toString(),
              currency: 'SOL',
              usdValue: collectionStats.floorPrice / 1e9,
              timestamp: new Date(),
            };
            
            collection.stats.volume24h = {
              amount: collectionStats.volume24hr ? (collectionStats.volume24hr / 1e9).toString() : '0',
              currency: 'SOL',
              usdValue: collectionStats.volume24hr ? collectionStats.volume24hr / 1e9 : 0,
              timestamp: new Date(),
            };
            
            collection.stats.listedCount = collectionStats.listedCount || 0;
          }
          
          // Update NFTs with floor price if they don't have one
          for (const nft of collectionNFTs) {
            if (!nft.floorPrice && collectionStats.floorPrice) {
              nft.floorPrice = {
                amount: (collectionStats.floorPrice / 1e9).toString(),
                currency: 'SOL',
                usdValue: collectionStats.floorPrice / 1e9,
                timestamp: new Date(),
              };
              
              // Use floor price as estimated value if no other price data
              if (!nft.estimatedValue) {
                nft.estimatedValue = { ...nft.floorPrice };
              }
            }
          }
        }
        
        // Check for individual NFT listings
        for (const nft of collectionNFTs.slice(0, 5)) { // Limit to avoid rate limits
          try {
            const listings = await this.getMagicEdenNFTListings(nft.contractAddress);
            if (listings.length > 0) {
              const activeListing = listings.find(l => l.listStatus === 'listed');
              if (activeListing && activeListing.price) {
                nft.isListed = true;
                nft.listingPrice = {
                  amount: (activeListing.price / 1e9).toString(),
                  currency: 'SOL',
                  usdValue: activeListing.price / 1e9,
                  timestamp: new Date(),
                  marketplace: NFTMarketplace.MAGIC_EDEN,
                };
              }
            }
            
            // Small delay to respect rate limits
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (error) {
            logger.debug('Failed to get Magic Eden NFT listings', {
              error: error instanceof Error ? error.message : 'Unknown error',
              mintAddress: nft.contractAddress,
            });
          }
        }
        
        // Delay between collections
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        logger.debug('Failed to enrich collection with Magic Eden data', {
          error: error instanceof Error ? error.message : 'Unknown error',
          collectionAddress,
        });
      }
    }
  }

  private async enrichWithTensorData(nfts: NFTToken[], collections: NFTCollection[]): Promise<void> {
    // Tensor API integration for more comprehensive Solana NFT data
    logger.debug('Tensor data enrichment not implemented yet', {
      nftCount: nfts.length,
      collectionCount: collections.length,
    });
  }

  private async getMagicEdenCollectionStats(symbol: string): Promise<any> {
    try {
      const response = await axios.get(`${this.magicEdenBaseUrl}/collections/${symbol}/stats`, {
        timeout: 5000,
      });
      
      return response.data;
    } catch (error) {
      logger.debug('Failed to get Magic Eden collection stats', {
        error: error instanceof Error ? error.message : 'Unknown error',
        symbol,
      });
      return null;
    }
  }

  private async getMagicEdenNFTListings(mintAddress: string): Promise<any[]> {
    try {
      const response = await axios.get(`${this.magicEdenBaseUrl}/tokens/${mintAddress}/listings`, {
        timeout: 5000,
      });
      
      return response.data || [];
    } catch (error) {
      logger.debug('Failed to get Magic Eden NFT listings', {
        error: error instanceof Error ? error.message : 'Unknown error',
        mintAddress,
      });
      return [];
    }
  }

  // Implement getListings method for marketplace integration
  async getListings(
    contractAddress: string, 
    tokenId: string, 
    chainId: ChainId
  ): Promise<NFTListing[]> {
    if (chainId !== ChainId.SOLANA) {
      return [];
    }

    const listings: NFTListing[] = [];
    
    try {
      // Get Magic Eden listings
      const magicEdenListings = await this.getMagicEdenListings(contractAddress);
      listings.push(...magicEdenListings);
      
      // Get Tensor listings if API available
      if (process.env.TENSOR_API_KEY) {
        const tensorListings = await this.getTensorListings(contractAddress);
        listings.push(...tensorListings);
      }
      
      return listings;
    } catch (error) {
      logger.error('Failed to get Solana NFT listings', {
        error: error instanceof Error ? error.message : 'Unknown error',
        contractAddress,
      });
      return [];
    }
  }

  private async getMagicEdenListings(mintAddress: string): Promise<NFTListing[]> {
    try {
      const listingsData = await this.getMagicEdenNFTListings(mintAddress);
      const listings: NFTListing[] = [];
      
      for (const listing of listingsData) {
        if (listing.price && listing.seller) {
          listings.push({
            id: `magiceden-${mintAddress}-${listing.seller}`,
            chainId: ChainId.SOLANA,
            marketplace: NFTMarketplace.MAGIC_EDEN,
            contractAddress: mintAddress,
            tokenId: '0', // Solana NFTs don't have token IDs
            seller: listing.seller,
            price: {
              amount: (listing.price / 1e9).toString(),
              currency: 'SOL',
              usdValue: listing.price / 1e9, // Simplified USD conversion
              timestamp: new Date(),
            },
            startTime: new Date(),
            listingType: 'fixed-price',
            status: listing.listStatus === 'listed' ? 'active' : 'expired',
            createdAt: new Date(),
            lastUpdatedAt: new Date(),
            externalUrl: `https://magiceden.io/item-details/${mintAddress}`,
          });
        }
      }
      
      return listings;
    } catch (error) {
      logger.debug('Failed to get Magic Eden listings', {
        error: error instanceof Error ? error.message : 'Unknown error',
        mintAddress,
      });
      return [];
    }
  }

  private async getTensorListings(mintAddress: string): Promise<NFTListing[]> {
    // Tensor API integration would go here
    // For now, return empty array
    logger.debug('Tensor listings not implemented yet', { mintAddress });
    return [];
  }

  // Enhanced collection analytics method
  async getCollectionAnalytics(
    contractAddress: string, 
    chainId: ChainId, 
    timeframe = '7d'
  ): Promise<CollectionAnalytics | null> {
    if (chainId !== ChainId.SOLANA) {
      return null;
    }

    try {
      const collection = await this.getCollectionInfo(contractAddress, chainId);
      if (!collection) {
        return null;
      }

      // Get Magic Eden collection stats for analytics
      const stats = await this.getMagicEdenCollectionStats(contractAddress);
      if (!stats) {
        return null;
      }

      const analytics: CollectionAnalytics = {
        collection,
        timeframe: timeframe as any,
        priceHistory: [], // Would need historical data API
        volatility: 0, // Would calculate from price history
        liquidity: stats.listedCount ? stats.listedCount / (collection.stats.totalSupply || 1) : 0,
        momentum: 0, // Would calculate from recent price changes
        holderDistribution: [], // Would need holder analysis
        rarityDistribution: [], // Would need rarity data
      };

      return analytics;
    } catch (error) {
      logger.error('Failed to get Solana collection analytics', {
        error: error instanceof Error ? error.message : 'Unknown error',
        contractAddress,
      });
      return null;
    }
  }

  private categorizeNFT(metadata: any): NFTCategory {
    const name = (metadata.name || '').toLowerCase();
    const description = (metadata.description || '').toLowerCase();
    
    if (name.includes('art') || description.includes('art')) return NFTCategory.ART;
    if (name.includes('game') || description.includes('game')) return NFTCategory.GAMING;
    if (name.includes('pfp') || name.includes('avatar')) return NFTCategory.PFPS;
    if (name.includes('music') || description.includes('music')) return NFTCategory.MUSIC;
    if (name.includes('photo') || description.includes('photo')) return NFTCategory.PHOTOGRAPHY;
    if (name.includes('sport') || description.includes('sport')) return NFTCategory.SPORTS;
    if (name.includes('domain') || name.includes('.sol')) return NFTCategory.DOMAIN_NAMES;
    if (name.includes('meme') || description.includes('meme')) return NFTCategory.MEMES;
    
    return NFTCategory.COLLECTIBLES;
  }

  private calculateMetadataCompleteness(nfts: NFTToken[]): number {
    if (nfts.length === 0) return 0;
    
    const scores = nfts.map(nft => {
      let score = 0;
      let maxScore = 5;
      
      if (nft.name) score++;
      if (nft.description) score++;
      if (nft.image) score++;
      if (nft.attributes && nft.attributes.length > 0) score++;
      if (nft.collectionAddress) score++;
      
      return score / maxScore;
    });
    
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }

  private calculatePriceDataAvailability(nfts: NFTToken[]): number {
    if (nfts.length === 0) return 0;
    
    const withPriceData = nfts.filter(nft => 
      nft.lastSalePrice || nft.floorPrice || nft.estimatedValue || nft.listingPrice
    );
    
    return withPriceData.length / nfts.length;
  }
}

// Factory function
export const createSolanaNFTDetector = (heliusApiKey?: string): SolanaNFTDetector => {
  return new SolanaNFTDetector(heliusApiKey);
};