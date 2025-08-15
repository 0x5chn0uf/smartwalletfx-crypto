import axios from 'axios';
import { logger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { NFTToken, NFTCollection, NFTAttribute } from '@/types/nft';
import { NFTMetadataEnricher } from '../NFTOrchestrator';

/**
 * IPFS Metadata Enricher - Resolves and enhances NFT metadata from IPFS sources
 * 
 * This enricher:
 * - Resolves IPFS URIs to fetch complete metadata
 * - Handles various IPFS gateways for redundancy
 * - Processes and normalizes metadata attributes
 * - Enhances image and animation URLs
 * - Caches metadata to reduce repeated IPFS requests
 */
export class IPFSMetadataEnricher implements NFTMetadataEnricher {
  readonly name = 'IPFS-Metadata-Enricher';
  readonly priority = 1; // Highest priority for metadata enrichment

  private readonly ipfsGateways = [
    'https://ipfs.io/ipfs/',
    'https://gateway.pinata.cloud/ipfs/',
    'https://cloudflare-ipfs.com/ipfs/',
    'https://dweb.link/ipfs/',
    'https://infura-ipfs.io/ipfs/',
  ];

  private readonly arweaveGateways = [
    'https://arweave.net/',
    'https://ar-io.net/',
  ];

  private readonly CACHE_DURATION = 24 * 60 * 60; // 24 hours
  private isHealthyStatus = true;
  private lastHealthCheck = new Date();

  async enrichMetadata(nft: NFTToken): Promise<NFTToken> {
    try {
      let enrichedNFT = { ...nft };

      // Resolve token URI if it's an IPFS or Arweave URI
      if (nft.tokenUri) {
        const resolvedMetadata = await this.resolveMetadataURI(nft.tokenUri);
        if (resolvedMetadata) {
          enrichedNFT = this.mergeMetadata(enrichedNFT, resolvedMetadata);
        }
      }

      // Resolve image URI if it's an IPFS or Arweave URI
      if (enrichedNFT.image && this.isDecentralizedURI(enrichedNFT.image)) {
        const resolvedImageUrl = await this.resolveDecentralizedURI(enrichedNFT.image);
        if (resolvedImageUrl) {
          enrichedNFT.image = resolvedImageUrl;
        }
      }

      // Resolve animation URL if it's an IPFS or Arweave URI
      if (enrichedNFT.animationUrl && this.isDecentralizedURI(enrichedNFT.animationUrl)) {
        const resolvedAnimationUrl = await this.resolveDecentralizedURI(enrichedNFT.animationUrl);
        if (resolvedAnimationUrl) {
          enrichedNFT.animationUrl = resolvedAnimationUrl;
        }
      }

      // Process and enhance attributes
      if (enrichedNFT.attributes) {
        enrichedNFT.attributes = this.enhanceAttributes(enrichedNFT.attributes);
      }

      // Update metadata timestamp
      enrichedNFT.lastUpdatedAt = new Date();

      logger.debug('NFT metadata enriched via IPFS', {
        nftId: nft.id,
        hasResolvedMetadata: !!nft.tokenUri,
        hasResolvedImage: this.isDecentralizedURI(nft.image || ''),
        hasResolvedAnimation: this.isDecentralizedURI(nft.animationUrl || ''),
        attributeCount: enrichedNFT.attributes?.length || 0,
      });

      return enrichedNFT;

    } catch (error) {
      logger.warn('Failed to enrich NFT metadata via IPFS', {
        error: error instanceof Error ? error.message : 'Unknown error',
        nftId: nft.id,
        tokenUri: nft.tokenUri,
      });
      return nft;
    }
  }

  async enrichCollection(collection: NFTCollection): Promise<NFTCollection> {
    try {
      let enrichedCollection = { ...collection };

      // Resolve collection image if it's decentralized
      if (collection.image && this.isDecentralizedURI(collection.image)) {
        const resolvedImageUrl = await this.resolveDecentralizedURI(collection.image);
        if (resolvedImageUrl) {
          enrichedCollection.image = resolvedImageUrl;
          if (enrichedCollection.metadata) {
            enrichedCollection.metadata.image = resolvedImageUrl;
          }
        }
      }

      // Resolve banner image if it's decentralized
      if (collection.bannerImage && this.isDecentralizedURI(collection.bannerImage)) {
        const resolvedBannerUrl = await this.resolveDecentralizedURI(collection.bannerImage);
        if (resolvedBannerUrl) {
          enrichedCollection.bannerImage = resolvedBannerUrl;
        }
      }

      // Resolve featured image if it's decentralized
      if (collection.featuredImage && this.isDecentralizedURI(collection.featuredImage)) {
        const resolvedFeaturedUrl = await this.resolveDecentralizedURI(collection.featuredImage);
        if (resolvedFeaturedUrl) {
          enrichedCollection.featuredImage = resolvedFeaturedUrl;
        }
      }

      enrichedCollection.lastUpdatedAt = new Date();

      logger.debug('Collection metadata enriched via IPFS', {
        collectionId: collection.id,
        hasResolvedImage: this.isDecentralizedURI(collection.image || ''),
        hasResolvedBanner: this.isDecentralizedURI(collection.bannerImage || ''),
        hasResolvedFeatured: this.isDecentralizedURI(collection.featuredImage || ''),
      });

      return enrichedCollection;

    } catch (error) {
      logger.warn('Failed to enrich collection metadata via IPFS', {
        error: error instanceof Error ? error.message : 'Unknown error',
        collectionId: collection.id,
      });
      return collection;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Test connectivity to primary IPFS gateway
      const testHash = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'; // Hello World
      const testUrl = `${this.ipfsGateways[0]}${testHash}`;
      
      const response = await axios.get(testUrl, {
        timeout: 5000,
        validateStatus: (status) => status < 500, // Accept 4xx as healthy (content might not exist)
      });

      this.isHealthyStatus = response.status < 500;
      this.lastHealthCheck = new Date();
      
      return this.isHealthyStatus;
    } catch (error) {
      this.isHealthyStatus = false;
      this.lastHealthCheck = new Date();
      return false;
    }
  }

  // Private helper methods

  private async resolveMetadataURI(uri: string): Promise<any> {
    try {
      // Check cache first
      const cacheKey = `ipfs-metadata:${uri}`;
      const cached = await redisManager.get<any>(cacheKey);
      if (cached) {
        return cached;
      }

      const resolvedUrl = await this.resolveDecentralizedURI(uri);
      if (!resolvedUrl) {
        return null;
      }

      const response = await axios.get(resolvedUrl, {
        timeout: 10000,
        maxContentLength: 50 * 1024 * 1024, // 50MB max
      });

      const metadata = response.data;
      
      // Cache the resolved metadata
      await redisManager.set(cacheKey, metadata, this.CACHE_DURATION);

      return metadata;

    } catch (error) {
      logger.debug('Failed to resolve metadata URI', {
        error: error instanceof Error ? error.message : 'Unknown error',
        uri,
      });
      return null;
    }
  }

  private async resolveDecentralizedURI(uri: string): Promise<string | null> {
    if (!this.isDecentralizedURI(uri)) {
      return uri; // Return as-is if not a decentralized URI
    }

    try {
      // Check cache first
      const cacheKey = `ipfs-uri:${uri}`;
      const cached = await redisManager.get<string>(cacheKey);
      if (cached) {
        return cached;
      }

      let resolvedUrl: string | null = null;

      if (uri.startsWith('ipfs://')) {
        const hash = uri.replace('ipfs://', '');
        resolvedUrl = await this.tryIPFSGateways(hash);
      } else if (uri.startsWith('ar://')) {
        const hash = uri.replace('ar://', '');
        resolvedUrl = await this.tryArweaveGateways(hash);
      } else if (uri.includes('/ipfs/')) {
        // Already a gateway URL, validate it works
        resolvedUrl = await this.validateUrl(uri) ? uri : null;
      }

      if (resolvedUrl) {
        // Cache the resolved URL
        await redisManager.set(cacheKey, resolvedUrl, this.CACHE_DURATION);
      }

      return resolvedUrl;

    } catch (error) {
      logger.debug('Failed to resolve decentralized URI', {
        error: error instanceof Error ? error.message : 'Unknown error',
        uri,
      });
      return null;
    }
  }

  private async tryIPFSGateways(hash: string): Promise<string | null> {
    for (const gateway of this.ipfsGateways) {
      try {
        const url = `${gateway}${hash}`;
        const isValid = await this.validateUrl(url);
        if (isValid) {
          return url;
        }
      } catch (error) {
        // Continue to next gateway
        continue;
      }
    }
    return null;
  }

  private async tryArweaveGateways(hash: string): Promise<string | null> {
    for (const gateway of this.arweaveGateways) {
      try {
        const url = `${gateway}${hash}`;
        const isValid = await this.validateUrl(url);
        if (isValid) {
          return url;
        }
      } catch (error) {
        // Continue to next gateway
        continue;
      }
    }
    return null;
  }

  private async validateUrl(url: string): Promise<boolean> {
    try {
      const response = await axios.head(url, {
        timeout: 5000,
        validateStatus: (status) => status >= 200 && status < 300,
      });
      return response.status >= 200 && response.status < 300;
    } catch (error) {
      return false;
    }
  }

  private isDecentralizedURI(uri: string): boolean {
    return uri.startsWith('ipfs://') || 
           uri.startsWith('ar://') ||
           uri.includes('/ipfs/') ||
           uri.includes('arweave.net');
  }

  private mergeMetadata(nft: NFTToken, metadata: any): NFTToken {
    const enrichedNFT = { ...nft };

    // Update basic metadata fields
    if (metadata.name && !enrichedNFT.name) {
      enrichedNFT.name = metadata.name;
    }
    
    if (metadata.description && !enrichedNFT.description) {
      enrichedNFT.description = metadata.description;
    }

    if (metadata.image && !enrichedNFT.image) {
      enrichedNFT.image = metadata.image;
    }

    if (metadata.animation_url && !enrichedNFT.animationUrl) {
      enrichedNFT.animationUrl = metadata.animation_url;
    }

    if (metadata.external_url && !enrichedNFT.externalUrl) {
      enrichedNFT.externalUrl = metadata.external_url;
    }

    // Merge attributes
    if (metadata.attributes && Array.isArray(metadata.attributes)) {
      const existingAttributes = enrichedNFT.attributes || [];
      const newAttributes = this.parseAttributes(metadata.attributes);
      
      // Combine and deduplicate attributes
      const attributeMap = new Map<string, NFTAttribute>();
      
      // Add existing attributes
      for (const attr of existingAttributes) {
        attributeMap.set(attr.traitType, attr);
      }
      
      // Add/update with new attributes
      for (const attr of newAttributes) {
        attributeMap.set(attr.traitType, attr);
      }
      
      enrichedNFT.attributes = Array.from(attributeMap.values());
    }

    // Store original metadata
    enrichedNFT.metadata = {
      ...enrichedNFT.metadata,
      ipfsMetadata: metadata,
      ipfsResolvedAt: new Date().toISOString(),
    };

    return enrichedNFT;
  }

  private parseAttributes(attributes: any[]): NFTAttribute[] {
    return attributes
      .filter(attr => attr.trait_type || attr.key) // Must have a trait type
      .map(attr => ({
        traitType: attr.trait_type || attr.key,
        value: attr.value,
        displayType: attr.display_type,
        maxValue: attr.max_value,
      }));
  }

  private enhanceAttributes(attributes: NFTAttribute[]): NFTAttribute[] {
    return attributes.map(attr => {
      const enhanced = { ...attr };

      // Normalize trait type
      enhanced.traitType = this.normalizeTraitType(attr.traitType);

      // Enhance display type if not set
      if (!enhanced.displayType) {
        enhanced.displayType = this.inferDisplayType(attr.value);
      }

      return enhanced;
    });
  }

  private normalizeTraitType(traitType: string): string {
    // Convert to Title Case and handle common variations
    return traitType
      .split(/[\s_-]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  private inferDisplayType(value: any): string | undefined {
    if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        return 'number';
      }
      return 'number';
    }
    
    if (typeof value === 'string') {
      // Check if it's a percentage
      if (value.includes('%') || value.toLowerCase().includes('percent')) {
        return 'boost_percentage';
      }
      
      // Check if it's a date
      if (Date.parse(value)) {
        return 'date';
      }
    }
    
    return undefined;
  }
}