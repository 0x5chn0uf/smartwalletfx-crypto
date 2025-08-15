import { ethers } from 'ethers';
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

// ERC-721 Interface
const ERC721_ABI = [
  'function name() external view returns (string)',
  'function symbol() external view returns (string)',
  'function tokenURI(uint256 tokenId) external view returns (string)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function totalSupply() external view returns (uint256)',
  'function supportsInterface(bytes4 interfaceId) external view returns (bool)',
];

// ERC-1155 Interface
const ERC1155_ABI = [
  'function name() external view returns (string)',
  'function symbol() external view returns (string)',
  'function uri(uint256 id) external view returns (string)',
  'function balanceOf(address account, uint256 id) external view returns (uint256)',
  'function balanceOfBatch(address[] accounts, uint256[] ids) external view returns (uint256[])',
  'function supportsInterface(bytes4 interfaceId) external view returns (bool)',
];

// Interface IDs
const INTERFACE_IDS = {
  ERC721: '0x80ac58cd',
  ERC721_METADATA: '0x5b5e139f',
  ERC721_ENUMERABLE: '0x780e9d63',
  ERC1155: '0xd9b67a26',
  ERC1155_METADATA: '0x0e89341c',
};

// OpenSea API URLs by chain
const OPENSEA_API_URLS: Record<ChainId, string> = {
  [ChainId.ETHEREUM]: 'https://api.opensea.io/api/v1',
  [ChainId.POLYGON]: 'https://api.opensea.io/api/v1',
  [ChainId.ARBITRUM]: 'https://api.opensea.io/api/v1',
  [ChainId.OPTIMISM]: 'https://api.opensea.io/api/v1',
  [ChainId.BASE]: 'https://api.opensea.io/api/v1',
  [ChainId.SOLANA]: '', // Not supported
};

// Chain names for OpenSea
const OPENSEA_CHAIN_NAMES: Record<ChainId, string> = {
  [ChainId.ETHEREUM]: 'ethereum',
  [ChainId.POLYGON]: 'matic',
  [ChainId.ARBITRUM]: 'arbitrum',
  [ChainId.OPTIMISM]: 'optimism',
  [ChainId.BASE]: 'base',
  [ChainId.SOLANA]: '', // Not supported
};

interface OpenSeaAsset {
  id: number;
  token_id: string;
  name: string;
  description?: string;
  image_url?: string;
  image_preview_url?: string;
  image_thumbnail_url?: string;
  image_original_url?: string;
  animation_url?: string;
  animation_original_url?: string;
  external_link?: string;
  asset_contract: {
    address: string;
    name: string;
    symbol: string;
    description?: string;
    image_url?: string;
    external_link?: string;
    total_supply?: number;
    created_date?: string;
    contract_type: string;
    schema_name: string;
  };
  collection: {
    name: string;
    slug: string;
    description?: string;
    image_url?: string;
    banner_image_url?: string;
    featured_image_url?: string;
    large_image_url?: string;
    external_url?: string;
    discord_url?: string;
    telegram_url?: string;
    twitter_username?: string;
    instagram_username?: string;
    wiki_url?: string;
    stats: {
      one_day_volume: number;
      one_day_change: number;
      one_day_sales: number;
      seven_day_volume: number;
      seven_day_change: number;
      seven_day_sales: number;
      thirty_day_volume: number;
      thirty_day_change: number;
      thirty_day_sales: number;
      total_volume: number;
      total_sales: number;
      total_supply: number;
      count: number;
      num_owners: number;
      average_price: number;
      num_reports: number;
      market_cap: number;
      floor_price: number;
    };
  };
  traits: Array<{
    trait_type: string;
    value: string | number;
    display_type?: string;
    max_value?: number;
    trait_count?: number;
  }>;
  last_sale?: {
    total_price: string;
    payment_token: {
      symbol: string;
      address: string;
      decimals: number;
      usd_price: string;
    };
    transaction: {
      timestamp: string;
    };
  };
  orders?: Array<{
    created_date: string;
    closing_date?: string;
    listing_time: string;
    expiration_time: string;
    order_hash: string;
    maker: string;
    taker?: string;
    base_price: string;
    current_price: string;
    payment_token: {
      symbol: string;
      address: string;
      decimals: number;
      usd_price: string;
    };
    side: number; // 0 = sell, 1 = buy
  }>;
}

export class EVMNFTDetector implements NFTDetector {
  readonly name = 'EVM-NFT-Detector';
  readonly supportedChains = [ChainId.ETHEREUM, ChainId.POLYGON, ChainId.ARBITRUM, ChainId.OPTIMISM, ChainId.BASE];
  readonly supportedStandards = [NFTStandard.ERC_721, NFTStandard.ERC_1155];
  readonly supportedMarketplaces = [NFTMarketplace.OPENSEA];

  private providers: Map<ChainId, ethers.JsonRpcProvider> = new Map();
  private lastHealthCheck = new Date();
  private isHealthyStatus = true;

  constructor(private rpcUrls: Partial<Record<ChainId, string>>) {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    this.supportedChains.forEach(chainId => {
      const rpcUrl = this.rpcUrls[chainId];
      if (rpcUrl) {
        try {
          const provider = new ethers.JsonRpcProvider(rpcUrl);
          this.providers.set(chainId, provider);
          logger.info(`EVM NFT detector initialized for ${chainId}`, { chainId });
        } catch (error) {
          logger.error(`Failed to initialize EVM NFT provider for ${chainId}`, { error, chainId });
        }
      }
    });
  }

  async detectNFTs(address: string, chainId: ChainId): Promise<NFTDetectionResult> {
    const startTime = Date.now();
    
    try {
      logger.info('Starting EVM NFT detection', { address, chainId });

      // Check cache first
      const cacheKey = `evm-nft-detection:${chainId}:${address}`;
      const cached = await redisManager.get<NFTDetectionResult>(cacheKey);
      
      if (cached && cached.nextScanAt > new Date()) {
        logger.debug('EVM NFT detection cache hit', { address, chainId });
        return cached;
      }

      const provider = this.providers.get(chainId);
      if (!provider) {
        throw new Error(`No provider available for chain ${chainId}`);
      }

        // Try multiple detection methods in parallel for better coverage
      let nfts: NFTToken[] = [];
      let collections: NFTCollection[] = [];
      let detectionMethod: 'contract-scan' | 'marketplace-api' | 'indexer-api' = 'marketplace-api';

      // First try OpenSea API
      try {
        const openSeaResult = await this.detectNFTsViaOpenSea(address, chainId);
        nfts = openSeaResult.nfts;
        collections = openSeaResult.collections;
        detectionMethod = 'marketplace-api';
        
        // If we got good results from OpenSea, enhance with additional data
        if (nfts.length > 0) {
          await this.enrichWithReservoirData(nfts, collections, chainId);
          await this.enrichWithFloorPrices(collections, chainId);
        }
      } catch (error) {
        logger.warn('OpenSea detection failed, trying alternative methods', {
          error: error instanceof Error ? error.message : 'Unknown error',
          address,
          chainId,
        });

        // Try Reservoir API as fallback
        try {
          const reservoirResult = await this.detectNFTsViaReservoir(address, chainId);
          if (reservoirResult.nfts.length > 0) {
            nfts = reservoirResult.nfts;
            collections = reservoirResult.collections;
            detectionMethod = 'indexer-api';
          }
        } catch (reservoirError) {
          logger.warn('Reservoir detection also failed, falling back to contract scan', {
            error: reservoirError instanceof Error ? reservoirError.message : 'Unknown error',
          });
        }

        // Last resort: direct contract scanning (limited functionality)
        if (nfts.length === 0) {
          const contractScanResult = await this.detectNFTsViaContractScan(address, chainId, provider);
          nfts = contractScanResult.nfts;
          collections = contractScanResult.collections;
          detectionMethod = 'contract-scan';
        }
      }

      // Calculate quality metrics
      const metadataCompleteness = this.calculateMetadataCompleteness(nfts);
      const priceDataAvailability = this.calculatePriceDataAvailability(nfts);

      const result: NFTDetectionResult = {
        address,
        chainId,
        nfts,
        collections,
        totalCount: nfts.length,
        detectionMethod,
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
      logger.info('EVM NFT detection completed', {
        address,
        chainId,
        nftCount: nfts.length,
        collectionCount: collections.length,
        duration,
        detectionMethod,
      });

      return result;

    } catch (error) {
      logger.error('EVM NFT detection failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address,
        chainId,
      });
      
      throw error;
    }
  }

  async getNFTMetadata(contractAddress: string, tokenId: string, chainId: ChainId): Promise<NFTToken | null> {
    try {
      const provider = this.providers.get(chainId);
      if (!provider) {
        throw new Error(`No provider available for chain ${chainId}`);
      }

      // Determine NFT standard
      const standard = await this.detectNFTStandard(contractAddress, provider);
      if (!standard) {
        return null;
      }

      // Get basic contract info
      const contractInfo = await this.getContractInfo(contractAddress, standard, provider);
      
      // Get token metadata
      const tokenUri = await this.getTokenURI(contractAddress, tokenId, standard, provider);
      let metadata: any = {};
      
      if (tokenUri) {
        try {
          metadata = await this.fetchMetadataFromURI(tokenUri);
        } catch (error) {
          logger.warn('Failed to fetch metadata from URI', {
            error: error instanceof Error ? error.message : 'Unknown error',
            tokenUri,
          });
        }
      }

      // Build NFT token
      const nft: NFTToken = {
        id: `${chainId}:${contractAddress}:${tokenId}`,
        chainId,
        contractAddress,
        tokenId,
        standard,
        owner: '', // Would need to be fetched separately
        name: metadata.name || `${contractInfo.name} #${tokenId}`,
        description: metadata.description,
        image: metadata.image,
        animationUrl: metadata.animation_url,
        externalUrl: metadata.external_url,
        attributes: this.parseAttributes(metadata.attributes),
        collectionName: contractInfo.name,
        collectionSymbol: contractInfo.symbol,
        collectionAddress: contractAddress,
        isListed: false,
        category: this.categorizeNFT(metadata, contractInfo),
        createdAt: new Date(),
        lastUpdatedAt: new Date(),
        tokenUri,
        metadata,
      };

      return nft;

    } catch (error) {
      logger.error('Failed to get EVM NFT metadata', {
        error: error instanceof Error ? error.message : 'Unknown error',
        contractAddress,
        tokenId,
        chainId,
      });
      return null;
    }
  }

  async getCollectionInfo(contractAddress: string, chainId: ChainId): Promise<NFTCollection | null> {
    try {
      const provider = this.providers.get(chainId);
      if (!provider) {
        throw new Error(`No provider available for chain ${chainId}`);
      }

      // Try OpenSea first
      try {
        return await this.getCollectionInfoFromOpenSea(contractAddress, chainId);
      } catch (error) {
        logger.warn('Failed to get collection info from OpenSea', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      // Fallback to direct contract interaction
      const standard = await this.detectNFTStandard(contractAddress, provider);
      if (!standard) {
        return null;
      }

      const contractInfo = await this.getContractInfo(contractAddress, standard, provider);
      
      const collection: NFTCollection = {
        id: `${chainId}:${contractAddress}`,
        chainId,
        contractAddress,
        standard,
        name: contractInfo.name,
        symbol: contractInfo.symbol,
        slug: contractInfo.name.toLowerCase().replace(/\s+/g, '-'),
        metadata: {
          name: contractInfo.name,
          symbol: contractInfo.symbol,
          totalSupply: contractInfo.totalSupply,
          verified: false,
          category: NFTCategory.UNKNOWN,
        },
        category: NFTCategory.UNKNOWN,
        verified: false,
        stats: {
          totalSupply: contractInfo.totalSupply || 0,
          ownersCount: 0,
          listedCount: 0,
          volumeTotal: { amount: '0', currency: 'ETH', timestamp: new Date() },
          volume24h: { amount: '0', currency: 'ETH', timestamp: new Date() },
          volume7d: { amount: '0', currency: 'ETH', timestamp: new Date() },
          volume30d: { amount: '0', currency: 'ETH', timestamp: new Date() },
          salesCount24h: 0,
          salesCount7d: 0,
          salesCount30d: 0,
        },
        createdAt: new Date(),
        lastUpdatedAt: new Date(),
      };

      return collection;

    } catch (error) {
      logger.error('Failed to get EVM collection info', {
        error: error instanceof Error ? error.message : 'Unknown error',
        contractAddress,
        chainId,
      });
      return null;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Check if we can connect to at least one provider
      let healthyProviders = 0;
      
      for (const [chainId, provider] of this.providers) {
        try {
          await provider.getBlockNumber();
          healthyProviders++;
        } catch (error) {
          logger.warn(`Provider for chain ${chainId} is unhealthy`, { error });
        }
      }

      this.isHealthyStatus = healthyProviders > 0;
      this.lastHealthCheck = new Date();
      
      return this.isHealthyStatus;
    } catch (error) {
      this.isHealthyStatus = false;
      this.lastHealthCheck = new Date();
      return false;
    }
  }

  // Private helper methods

  private async detectNFTsViaOpenSea(address: string, chainId: ChainId): Promise<{ nfts: NFTToken[]; collections: NFTCollection[] }> {
    const apiUrl = OPENSEA_API_URLS[chainId];
    const chainName = OPENSEA_CHAIN_NAMES[chainId];
    
    if (!apiUrl || !chainName) {
      throw new Error(`OpenSea not supported for chain ${chainId}`);
    }

    const url = `${apiUrl}/assets?owner=${address}&order_direction=desc&limit=50&include_orders=true`;
    
    try {
      const response = await axios.get<{ assets: OpenSeaAsset[] }>(url, {
        headers: {
          'X-API-KEY': process.env.OPENSEA_API_KEY || '',
        },
        timeout: 10000,
      });

      const nfts: NFTToken[] = [];
      const collectionsMap = new Map<string, NFTCollection>();

      for (const asset of response.data.assets) {
        // Create NFT token
        const nft = this.convertOpenSeaAssetToNFT(asset, chainId);
        nfts.push(nft);

        // Create collection if not exists
        const collectionId = `${chainId}:${asset.asset_contract.address}`;
        if (!collectionsMap.has(collectionId)) {
          const collection = this.convertOpenSeaAssetToCollection(asset, chainId);
          collectionsMap.set(collectionId, collection);
        }
      }

      return {
        nfts,
        collections: Array.from(collectionsMap.values()),
      };

    } catch (error) {
      logger.error('OpenSea API request failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        url,
      });
      throw error;
    }
  }

  private async detectNFTsViaContractScan(
    address: string, 
    chainId: ChainId, 
    provider: ethers.JsonRpcProvider
  ): Promise<{ nfts: NFTToken[]; collections: NFTCollection[] }> {
    // This is a simplified implementation
    // In production, you would need to:
    // 1. Scan transaction history for NFT transfers
    // 2. Query known NFT contracts
    // 3. Use indexing services like The Graph
    
    logger.warn('Contract scanning not fully implemented', { address, chainId });
    
    return {
      nfts: [],
      collections: [],
    };
  }

  private async detectNFTStandard(contractAddress: string, provider: ethers.JsonRpcProvider): Promise<NFTStandard | null> {
    try {
      const contract = new ethers.Contract(contractAddress, ['function supportsInterface(bytes4 interfaceId) external view returns (bool)'], provider);
      
      // Check ERC-721
      try {
        const isERC721 = await contract.supportsInterface(INTERFACE_IDS.ERC721);
        if (isERC721) return NFTStandard.ERC_721;
      } catch {}
      
      // Check ERC-1155
      try {
        const isERC1155 = await contract.supportsInterface(INTERFACE_IDS.ERC1155);
        if (isERC1155) return NFTStandard.ERC_1155;
      } catch {}
      
      return null;
    } catch (error) {
      logger.warn('Failed to detect NFT standard', {
        error: error instanceof Error ? error.message : 'Unknown error',
        contractAddress,
      });
      return null;
    }
  }

  private async getContractInfo(contractAddress: string, standard: NFTStandard, provider: ethers.JsonRpcProvider) {
    const abi = standard === NFTStandard.ERC_721 ? ERC721_ABI : ERC1155_ABI;
    const contract = new ethers.Contract(contractAddress, abi, provider);
    
    try {
      const [name, symbol] = await Promise.all([
        contract.name().catch(() => 'Unknown'),
        contract.symbol().catch(() => 'UNKNOWN'),
      ]);
      
      let totalSupply: number | undefined;
      try {
        if (standard === NFTStandard.ERC_721) {
          totalSupply = Number(await contract.totalSupply());
        }
      } catch {}
      
      return { name, symbol, totalSupply };
    } catch (error) {
      logger.warn('Failed to get contract info', {
        error: error instanceof Error ? error.message : 'Unknown error',
        contractAddress,
      });
      return { name: 'Unknown', symbol: 'UNKNOWN', totalSupply: undefined };
    }
  }

  private async getTokenURI(contractAddress: string, tokenId: string, standard: NFTStandard, provider: ethers.JsonRpcProvider): Promise<string | null> {
    try {
      if (standard === NFTStandard.ERC_721) {
        const contract = new ethers.Contract(contractAddress, ERC721_ABI, provider);
        return await contract.tokenURI(tokenId);
      } else if (standard === NFTStandard.ERC_1155) {
        const contract = new ethers.Contract(contractAddress, ERC1155_ABI, provider);
        return await contract.uri(tokenId);
      }
      return null;
    } catch (error) {
      logger.warn('Failed to get token URI', {
        error: error instanceof Error ? error.message : 'Unknown error',
        contractAddress,
        tokenId,
      });
      return null;
    }
  }

  private async fetchMetadataFromURI(uri: string): Promise<any> {
    try {
      // Handle IPFS URIs
      if (uri.startsWith('ipfs://')) {
        uri = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
      }
      
      const response = await axios.get(uri, { timeout: 5000 });
      return response.data;
    } catch (error) {
      logger.warn('Failed to fetch metadata from URI', {
        error: error instanceof Error ? error.message : 'Unknown error',
        uri,
      });
      return {};
    }
  }

  private convertOpenSeaAssetToNFT(asset: OpenSeaAsset, chainId: ChainId): NFTToken {
    const standard = asset.asset_contract.schema_name === 'ERC721' ? NFTStandard.ERC_721 : NFTStandard.ERC_1155;
    
    // Parse last sale price
    let lastSalePrice: NFTPrice | undefined;
    if (asset.last_sale) {
      try {
        const price = parseFloat(ethers.formatUnits(asset.last_sale.total_price, asset.last_sale.payment_token.decimals));
        const usdPrice = parseFloat(asset.last_sale.payment_token.usd_price);
        
        lastSalePrice = {
          amount: price.toString(),
          currency: asset.last_sale.payment_token.symbol,
          usdValue: price * usdPrice,
          timestamp: new Date(asset.last_sale.transaction.timestamp),
          marketplace: NFTMarketplace.OPENSEA,
        };
      } catch (error) {
        logger.debug('Failed to parse last sale price', { error, assetId: asset.id });
      }
    }

    // Parse listing price
    let listingPrice: NFTPrice | undefined;
    let isListed = false;
    
    if (asset.orders && asset.orders.length > 0) {
      const sellOrder = asset.orders.find(order => order.side === 0 && new Date(order.expiration_time) > new Date());
      if (sellOrder) {
        try {
          const price = parseFloat(ethers.formatUnits(sellOrder.current_price, sellOrder.payment_token.decimals));
          const usdPrice = parseFloat(sellOrder.payment_token.usd_price);
          
          listingPrice = {
            amount: price.toString(),
            currency: sellOrder.payment_token.symbol,
            usdValue: price * usdPrice,
            timestamp: new Date(sellOrder.created_date),
            marketplace: NFTMarketplace.OPENSEA,
          };
          isListed = true;
        } catch (error) {
          logger.debug('Failed to parse listing price', { error, assetId: asset.id });
        }
      }
    }

    // Parse floor price from collection stats
    let floorPrice: NFTPrice | undefined;
    let estimatedValue: NFTPrice | undefined;
    
    if (asset.collection.stats.floor_price && asset.collection.stats.floor_price > 0) {
      floorPrice = {
        amount: asset.collection.stats.floor_price.toString(),
        currency: 'ETH',
        usdValue: asset.collection.stats.floor_price, // In OpenSea this is already in ETH
        timestamp: new Date(),
      };
      
      // Use floor price as estimated value if no listing price
      if (!listingPrice) {
        estimatedValue = { ...floorPrice };
      }
    }

    // Calculate rarity if trait information is available
    let rarityRank: number | undefined;
    let rarityScore: number | undefined;
    
    if (asset.traits && asset.traits.length > 0) {
      // Simple rarity calculation based on trait rarity
      const traitRarities = asset.traits
        .filter(trait => trait.trait_count && trait.trait_count > 0)
        .map(trait => trait.trait_count!);
      
      if (traitRarities.length > 0) {
        rarityScore = traitRarities.reduce((sum, count) => sum + (1 / count), 0);
      }
    }

    return {
      id: `${chainId}:${asset.asset_contract.address}:${asset.token_id}`,
      chainId,
      contractAddress: asset.asset_contract.address,
      tokenId: asset.token_id,
      standard,
      owner: '', // Not provided by OpenSea API
      name: asset.name || `${asset.asset_contract.name} #${asset.token_id}`,
      description: asset.description,
      image: asset.image_url,
      imageHighRes: asset.image_original_url,
      animationUrl: asset.animation_url,
      externalUrl: asset.external_link,
      attributes: asset.traits?.map(trait => ({
        traitType: trait.trait_type,
        value: trait.value,
        displayType: trait.display_type,
        maxValue: trait.max_value,
        traitCount: trait.trait_count,
        rarityPercentage: trait.trait_count && asset.collection.stats.total_supply ?
          (trait.trait_count / asset.collection.stats.total_supply) * 100 : undefined,
      })),
      collectionName: asset.collection.name,
      collectionSymbol: asset.asset_contract.symbol,
      collectionSlug: asset.collection.slug,
      collectionAddress: asset.asset_contract.address,
      lastSalePrice,
      floorPrice,
      estimatedValue,
      listingPrice,
      isListed,
      rarityRank,
      rarityScore,
      totalSupply: asset.collection.stats.total_supply || undefined,
      category: this.categorizeNFTFromOpenSea(asset),
      createdAt: new Date(),
      lastUpdatedAt: new Date(),
      tokenUri: `https://api.opensea.io/api/v1/asset/${asset.asset_contract.address}/${asset.token_id}/`,
      metadata: {
        opensea: asset,
        source: 'opensea-api',
        lastFetched: new Date().toISOString(),
      },
    };
  }

  private convertOpenSeaAssetToCollection(asset: OpenSeaAsset, chainId: ChainId): NFTCollection {
    const standard = asset.asset_contract.schema_name === 'ERC721' ? NFTStandard.ERC_721 : NFTStandard.ERC_1155;
    
    return {
      id: `${chainId}:${asset.asset_contract.address}`,
      chainId,
      contractAddress: asset.asset_contract.address,
      standard,
      name: asset.collection.name,
      symbol: asset.asset_contract.symbol,
      description: asset.collection.description,
      slug: asset.collection.slug,
      image: asset.collection.image_url,
      bannerImage: asset.collection.banner_image_url,
      featuredImage: asset.collection.featured_image_url,
      metadata: {
        name: asset.collection.name,
        symbol: asset.asset_contract.symbol,
        description: asset.collection.description,
        image: asset.collection.image_url,
        externalLink: asset.collection.external_url,
        totalSupply: asset.collection.stats.total_supply,
        verified: true, // Assume OpenSea collections are verified
        category: this.categorizeNFTFromOpenSea(asset),
        floorPrice: asset.collection.stats.floor_price ? {
          amount: asset.collection.stats.floor_price.toString(),
          currency: 'ETH',
          usdValue: asset.collection.stats.floor_price,
          timestamp: new Date(),
        } : undefined,
        volume24h: {
          amount: asset.collection.stats.one_day_volume.toString(),
          currency: 'ETH',
          usdValue: asset.collection.stats.one_day_volume,
          timestamp: new Date(),
        },
        volume7d: {
          amount: asset.collection.stats.seven_day_volume.toString(),
          currency: 'ETH',
          usdValue: asset.collection.stats.seven_day_volume,
          timestamp: new Date(),
        },
        volume30d: {
          amount: asset.collection.stats.thirty_day_volume.toString(),
          currency: 'ETH',
          usdValue: asset.collection.stats.thirty_day_volume,
          timestamp: new Date(),
        },
        volumeTotal: {
          amount: asset.collection.stats.total_volume.toString(),
          currency: 'ETH',
          usdValue: asset.collection.stats.total_volume,
          timestamp: new Date(),
        },
        marketCap: {
          amount: asset.collection.stats.market_cap.toString(),
          currency: 'ETH',
          usdValue: asset.collection.stats.market_cap,
          timestamp: new Date(),
        },
        ownersCount: asset.collection.stats.num_owners,
        socialLinks: {
          website: asset.collection.external_url,
          discord: asset.collection.discord_url,
          twitter: asset.collection.twitter_username,
          instagram: asset.collection.instagram_username,
        },
      },
      category: this.categorizeNFTFromOpenSea(asset),
      verified: true,
      stats: {
        totalSupply: asset.collection.stats.total_supply,
        ownersCount: asset.collection.stats.num_owners,
        listedCount: 0, // Not provided
        floorPrice: asset.collection.stats.floor_price ? {
          amount: asset.collection.stats.floor_price.toString(),
          currency: 'ETH',
          usdValue: asset.collection.stats.floor_price,
          timestamp: new Date(),
        } : undefined,
        volumeTotal: {
          amount: asset.collection.stats.total_volume.toString(),
          currency: 'ETH',
          usdValue: asset.collection.stats.total_volume,
          timestamp: new Date(),
        },
        volume24h: {
          amount: asset.collection.stats.one_day_volume.toString(),
          currency: 'ETH',
          usdValue: asset.collection.stats.one_day_volume,
          timestamp: new Date(),
        },
        volume7d: {
          amount: asset.collection.stats.seven_day_volume.toString(),
          currency: 'ETH',
          usdValue: asset.collection.stats.seven_day_volume,
          timestamp: new Date(),
        },
        volume30d: {
          amount: asset.collection.stats.thirty_day_volume.toString(),
          currency: 'ETH',
          usdValue: asset.collection.stats.thirty_day_volume,
          timestamp: new Date(),
        },
        marketCap: {
          amount: asset.collection.stats.market_cap.toString(),
          currency: 'ETH',
          usdValue: asset.collection.stats.market_cap,
          timestamp: new Date(),
        },
        averagePrice: {
          amount: asset.collection.stats.average_price.toString(),
          currency: 'ETH',
          usdValue: asset.collection.stats.average_price,
          timestamp: new Date(),
        },
        salesCount24h: asset.collection.stats.one_day_sales,
        salesCount7d: asset.collection.stats.seven_day_sales,
        salesCount30d: asset.collection.stats.thirty_day_sales,
      },
      createdAt: asset.asset_contract.created_date ? new Date(asset.asset_contract.created_date) : new Date(),
      lastUpdatedAt: new Date(),
    };
  }

  private async getCollectionInfoFromOpenSea(contractAddress: string, chainId: ChainId): Promise<NFTCollection | null> {
    const apiUrl = OPENSEA_API_URLS[chainId];
    if (!apiUrl) return null;

    try {
      const response = await axios.get(`${apiUrl}/asset_contract/${contractAddress}`, {
        headers: {
          'X-API-KEY': process.env.OPENSEA_API_KEY || '',
        },
      });

      // This would need to be implemented based on OpenSea's collection API
      // For now, return null to fallback to contract scanning
      return null;
    } catch (error) {
      return null;
    }
  }

  private parseAttributes(attributes: any[]): NFTAttribute[] {
    if (!Array.isArray(attributes)) return [];
    
    return attributes.map(attr => ({
      traitType: attr.trait_type || 'Unknown',
      value: attr.value,
      displayType: attr.display_type,
      maxValue: attr.max_value,
    }));
  }

  private categorizeNFT(metadata: any, contractInfo: any): NFTCategory {
    // Simple categorization logic
    const name = (metadata.name || contractInfo.name || '').toLowerCase();
    const description = (metadata.description || '').toLowerCase();
    
    if (name.includes('art') || description.includes('art')) return NFTCategory.ART;
    if (name.includes('game') || description.includes('game')) return NFTCategory.GAMING;
    if (name.includes('punk') || name.includes('ape') || name.includes('pfp')) return NFTCategory.PFPS;
    if (name.includes('music') || description.includes('music')) return NFTCategory.MUSIC;
    if (name.includes('photo') || description.includes('photo')) return NFTCategory.PHOTOGRAPHY;
    if (name.includes('sport') || description.includes('sport')) return NFTCategory.SPORTS;
    if (name.includes('domain') || name.includes('.eth')) return NFTCategory.DOMAIN_NAMES;
    
    return NFTCategory.COLLECTIBLES;
  }

  private categorizeNFTFromOpenSea(asset: OpenSeaAsset): NFTCategory {
    const name = asset.collection.name.toLowerCase();
    const description = (asset.collection.description || '').toLowerCase();
    
    return this.categorizeNFT({ name, description }, { name });
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
      if (nft.collectionName) score++;
      
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

  // Additional marketplace integration methods
  private async detectNFTsViaReservoir(
    address: string, 
    chainId: ChainId
  ): Promise<{ nfts: NFTToken[]; collections: NFTCollection[] }> {
    try {
      const chainName = this.getReservoirChainName(chainId);
      if (!chainName) {
        throw new Error(`Reservoir not supported for chain ${chainId}`);
      }

      const response = await axios.get(`https://api.reservoir.tools/users/${address}/tokens/v7`, {
        headers: {
          'X-API-KEY': process.env.RESERVOIR_API_KEY || '',
        },
        params: {
          limit: 50,
          includeTopBid: true,
          includeLastSale: true,
        },
        timeout: 10000,
      });

      const nfts: NFTToken[] = [];
      const collectionsMap = new Map<string, NFTCollection>();

      for (const token of response.data.tokens || []) {
        const nft = this.convertReservoirTokenToNFT(token, chainId);
        if (nft) {
          nfts.push(nft);
        }
      }

      return {
        nfts,
        collections: Array.from(collectionsMap.values()),
      };
    } catch (error) {
      logger.error('Reservoir API request failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address,
        chainId,
      });
      throw error;
    }
  }

  private async enrichWithReservoirData(
    nfts: NFTToken[], 
    collections: NFTCollection[], 
    chainId: ChainId
  ): Promise<void> {
    if (!process.env.RESERVOIR_API_KEY) return;
    
    try {
      const chainName = this.getReservoirChainName(chainId);
      if (!chainName) return;

      // Enrich floor prices for collections
      const uniqueCollections = Array.from(new Set(nfts.map(nft => nft.contractAddress)));
      
      for (const contractAddress of uniqueCollections.slice(0, 10)) { // Limit to avoid rate limits
        try {
          const response = await axios.get(`https://api.reservoir.tools/collections/v5`, {
            headers: {
              'X-API-KEY': process.env.RESERVOIR_API_KEY,
            },
            params: {
              id: contractAddress,
              includeTopBid: true,
            },
            timeout: 5000,
          });

          const collection = response.data.collections?.[0];
          if (collection && collection.floorAsk?.price?.amount?.native) {
            // Update NFTs from this collection with more accurate floor price
            const collectionNFTs = nfts.filter(nft => nft.contractAddress === contractAddress);
            for (const nft of collectionNFTs) {
              if (!nft.floorPrice || nft.floorPrice.amount === '0') {
                nft.floorPrice = {
                  amount: collection.floorAsk.price.amount.native.toString(),
                  currency: 'ETH',
                  usdValue: collection.floorAsk.price.amount.usd || 0,
                  timestamp: new Date(),
                };
              }
            }
          }
        } catch (error) {
          logger.debug('Failed to enrich collection with Reservoir data', {
            error: error instanceof Error ? error.message : 'Unknown error',
            contractAddress,
          });
        }
        
        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      logger.warn('Failed to enrich with Reservoir data', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async enrichWithFloorPrices(
    collections: NFTCollection[], 
    chainId: ChainId
  ): Promise<void> {
    // This could integrate with additional price feeds like
    // NFTGo, OpenSea API v2, or other aggregators
    logger.debug('Floor price enrichment not implemented yet', {
      collectionCount: collections.length,
      chainId,
    });
  }

  private getReservoirChainName(chainId: ChainId): string | null {
    const chainMap: Record<ChainId, string> = {
      [ChainId.ETHEREUM]: 'mainnet',
      [ChainId.POLYGON]: 'polygon',
      [ChainId.ARBITRUM]: 'arbitrum',
      [ChainId.OPTIMISM]: 'optimism',
      [ChainId.BASE]: 'base',
      [ChainId.SOLANA]: '', // Not supported
    };
    
    return chainMap[chainId] || null;
  }

  private convertReservoirTokenToNFT(token: any, chainId: ChainId): NFTToken | null {
    try {
      if (!token || !token.token) return null;
      
      const tokenData = token.token;
      const contract = tokenData.contract;
      
      return {
        id: `${chainId}:${contract}:${tokenData.tokenId}`,
        chainId,
        contractAddress: contract,
        tokenId: tokenData.tokenId,
        standard: tokenData.kind === 'erc721' ? NFTStandard.ERC_721 : NFTStandard.ERC_1155,
        owner: token.ownership?.owner || '',
        name: tokenData.name || `Token #${tokenData.tokenId}`,
        description: tokenData.description,
        image: tokenData.image,
        attributes: tokenData.attributes?.map((attr: any) => ({
          traitType: attr.key,
          value: attr.value,
        })) || [],
        collectionName: tokenData.collection?.name,
        collectionAddress: contract,
        isListed: false,
        category: NFTCategory.COLLECTIBLES,
        createdAt: new Date(),
        lastUpdatedAt: new Date(),
        metadata: {
          reservoir: token,
          source: 'reservoir-api',
          lastFetched: new Date().toISOString(),
        },
      };
    } catch (error) {
      logger.warn('Failed to convert Reservoir token', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tokenId: token?.token?.tokenId,
      });
      return null;
    }
  }

  // Implement getListings method for marketplace integration
  async getListings(
    contractAddress: string, 
    tokenId: string, 
    chainId: ChainId
  ): Promise<NFTListing[]> {
    const listings: NFTListing[] = [];
    
    try {
      // Try OpenSea listings
      const openSeaListings = await this.getOpenSeaListings(contractAddress, tokenId, chainId);
      listings.push(...openSeaListings);
      
      // Try Reservoir listings if available
      if (process.env.RESERVOIR_API_KEY) {
        const reservoirListings = await this.getReservoirListings(contractAddress, tokenId, chainId);
        listings.push(...reservoirListings);
      }
      
      return listings;
    } catch (error) {
      logger.error('Failed to get listings', {
        error: error instanceof Error ? error.message : 'Unknown error',
        contractAddress,
        tokenId,
        chainId,
      });
      return [];
    }
  }

  private async getOpenSeaListings(
    contractAddress: string, 
    tokenId: string, 
    chainId: ChainId
  ): Promise<NFTListing[]> {
    try {
      const apiUrl = OPENSEA_API_URLS[chainId];
      if (!apiUrl) return [];
      
      const response = await axios.get(
        `${apiUrl}/asset/${contractAddress}/${tokenId}/orders`,
        {
          headers: {
            'X-API-KEY': process.env.OPENSEA_API_KEY || '',
          },
          timeout: 5000,
        }
      );
      
      const listings: NFTListing[] = [];
      
      for (const order of response.data.orders || []) {
        if (order.side === 0 && order.order_hash) { // Sell order
          listings.push({
            id: order.order_hash,
            chainId,
            marketplace: NFTMarketplace.OPENSEA,
            contractAddress,
            tokenId,
            seller: order.maker,
            price: {
              amount: ethers.formatUnits(order.current_price, order.payment_token.decimals),
              currency: order.payment_token.symbol,
              usdValue: parseFloat(order.current_price) * parseFloat(order.payment_token.usd_price),
              timestamp: new Date(order.created_date),
            },
            startTime: new Date(order.listing_time),
            endTime: new Date(order.expiration_time),
            listingType: 'fixed-price',
            status: new Date(order.expiration_time) > new Date() ? 'active' : 'expired',
            createdAt: new Date(order.created_date),
            lastUpdatedAt: new Date(),
            externalUrl: `https://opensea.io/assets/${contractAddress}/${tokenId}`,
          });
        }
      }
      
      return listings;
    } catch (error) {
      logger.debug('Failed to get OpenSea listings', {
        error: error instanceof Error ? error.message : 'Unknown error',
        contractAddress,
        tokenId,
      });
      return [];
    }
  }

  private async getReservoirListings(
    contractAddress: string, 
    tokenId: string, 
    chainId: ChainId
  ): Promise<NFTListing[]> {
    try {
      const chainName = this.getReservoirChainName(chainId);
      if (!chainName) return [];
      
      const response = await axios.get(
        `https://api.reservoir.tools/orders/asks/v4`,
        {
          headers: {
            'X-API-KEY': process.env.RESERVOIR_API_KEY || '',
          },
          params: {
            contracts: contractAddress,
            tokenSetId: `token:${contractAddress}:${tokenId}`,
            status: 'active',
            limit: 10,
          },
          timeout: 5000,
        }
      );
      
      const listings: NFTListing[] = [];
      
      for (const order of response.data.orders || []) {
        listings.push({
          id: order.id,
          chainId,
          marketplace: NFTMarketplace.OPENSEA, // Reservoir aggregates from multiple sources
          contractAddress,
          tokenId,
          seller: order.maker,
          price: {
            amount: order.price?.amount?.native?.toString() || '0',
            currency: order.price?.currency?.symbol || 'ETH',
            usdValue: order.price?.amount?.usd || 0,
            timestamp: new Date(order.createdAt),
          },
          startTime: new Date(order.createdAt),
          endTime: new Date(order.validUntil),
          listingType: 'fixed-price',
          status: 'active',
          createdAt: new Date(order.createdAt),
          lastUpdatedAt: new Date(order.updatedAt),
        });
      }
      
      return listings;
    } catch (error) {
      logger.debug('Failed to get Reservoir listings', {
        error: error instanceof Error ? error.message : 'Unknown error',
        contractAddress,
        tokenId,
      });
      return [];
    }
  }
}

// Factory function
export const createEVMNFTDetector = (rpcUrls: Partial<Record<ChainId, string>>): EVMNFTDetector => {
  return new EVMNFTDetector(rpcUrls);
};