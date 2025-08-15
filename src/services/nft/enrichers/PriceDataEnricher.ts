import axios from 'axios';
import { logger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { NFTToken, NFTCollection, NFTPrice, NFTMarketplace } from '@/types/nft';
import { NFTMetadataEnricher } from '../NFTOrchestrator';

interface PriceDataEnricherConfig {
  coinGeckoApiKey?: string;
  defiLlamaApiKey?: string;
}

/**
 * Price Data Enricher - Enhances NFT and collection data with comprehensive pricing information
 * 
 * This enricher:
 * - Fetches real-time ETH/SOL to USD conversion rates
 * - Updates USD values for NFT prices using current exchange rates
 * - Estimates NFT values based on collection floor prices and rarity
 * - Enriches collections with market cap calculations
 * - Provides trending and momentum indicators
 */
export class PriceDataEnricher implements NFTMetadataEnricher {
  readonly name = 'Price-Data-Enricher';
  readonly priority = 2; // Second priority after metadata resolution

  private readonly config: PriceDataEnricherConfig;
  private readonly CACHE_DURATION = 300; // 5 minutes for price data
  private isHealthyStatus = true;
  private lastHealthCheck = new Date();

  // Currency exchange rate cache
  private exchangeRates: Map<string, { rate: number; timestamp: number }> = new Map();
  private readonly RATE_CACHE_DURATION = 60 * 1000; // 1 minute

  constructor(config: PriceDataEnricherConfig = {}) {
    this.config = config;
  }

  async enrichMetadata(nft: NFTToken): Promise<NFTToken> {
    try {
      const enrichedNFT = { ...nft };

      // Update USD values for existing prices
      await this.updatePriceUSDValues(enrichedNFT);

      // Estimate value if not present
      if (!enrichedNFT.estimatedValue && enrichedNFT.floorPrice) {
        enrichedNFT.estimatedValue = await this.estimateNFTValue(enrichedNFT);
      }

      // Enhance price metadata
      enrichedNFT.metadata = {
        ...enrichedNFT.metadata,
        priceEnrichment: {
          enrichedAt: new Date().toISOString(),
          exchangeRatesUsed: this.getUsedExchangeRates(),
          estimationMethod: this.getEstimationMethod(enrichedNFT),
        },
      };

      logger.debug('NFT price data enriched', {
        nftId: nft.id,
        hasFloorPrice: !!enrichedNFT.floorPrice,
        hasEstimatedValue: !!enrichedNFT.estimatedValue,
        hasLastSalePrice: !!enrichedNFT.lastSalePrice,
        hasListingPrice: !!enrichedNFT.listingPrice,
      });

      return enrichedNFT;

    } catch (error) {
      logger.warn('Failed to enrich NFT price data', {
        error: error instanceof Error ? error.message : 'Unknown error',
        nftId: nft.id,
      });
      return nft;
    }
  }

  async enrichCollection(collection: NFTCollection): Promise<NFTCollection> {
    try {
      const enrichedCollection = { ...collection };

      // Update USD values for collection stats
      await this.updateCollectionPriceUSDValues(enrichedCollection);

      // Calculate market cap if missing
      if (!enrichedCollection.stats.marketCap && enrichedCollection.stats.floorPrice && enrichedCollection.stats.totalSupply) {
        enrichedCollection.stats.marketCap = await this.calculateMarketCap(
          enrichedCollection.stats.floorPrice,
          enrichedCollection.stats.totalSupply
        );
      }

      // Add trading momentum indicators
      enrichedCollection.metadata = {
        ...enrichedCollection.metadata,
        priceEnrichment: {
          enrichedAt: new Date().toISOString(),
          marketCapCalculated: !!enrichedCollection.stats.marketCap,
          volumeDataAvailable: !!(
            enrichedCollection.stats.volume24h?.usdValue ||
            enrichedCollection.stats.volume7d?.usdValue ||
            enrichedCollection.stats.volume30d?.usdValue
          ),
        },
      };

      logger.debug('Collection price data enriched', {
        collectionId: collection.id,
        hasFloorPrice: !!enrichedCollection.stats.floorPrice,
        hasMarketCap: !!enrichedCollection.stats.marketCap,
        hasVolumeData: !!(enrichedCollection.stats.volume24h?.usdValue),
      });

      return enrichedCollection;

    } catch (error) {
      logger.warn('Failed to enrich collection price data', {
        error: error instanceof Error ? error.message : 'Unknown error',
        collectionId: collection.id,
      });
      return collection;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Test fetching ETH price as a health check
      const ethPrice = await this.getExchangeRate('ETH', 'USD');
      this.isHealthyStatus = ethPrice > 0;
      this.lastHealthCheck = new Date();
      
      return this.isHealthyStatus;
    } catch (error) {
      this.isHealthyStatus = false;
      this.lastHealthCheck = new Date();
      return false;
    }
  }

  // Private helper methods

  private async updatePriceUSDValues(nft: NFTToken): Promise<void> {
    const priceFields: Array<keyof NFTToken> = ['lastSalePrice', 'floorPrice', 'estimatedValue', 'listingPrice'];

    for (const field of priceFields) {
      const price = nft[field] as NFTPrice | undefined;
      if (price && (!price.usdValue || price.usdValue === 0)) {
        const usdValue = await this.convertToUSD(price.amount, price.currency);
        if (usdValue > 0) {
          price.usdValue = usdValue;
        }
      }
    }
  }

  private async updateCollectionPriceUSDValues(collection: NFTCollection): Promise<void> {
    const priceFields = [
      'floorPrice', 'volume24h', 'volume7d', 'volume30d', 
      'volumeTotal', 'marketCap', 'averagePrice'
    ] as const;

    for (const field of priceFields) {
      const price = collection.stats[field];
      if (price && (!price.usdValue || price.usdValue === 0)) {
        const usdValue = await this.convertToUSD(price.amount, price.currency);
        if (usdValue > 0) {
          price.usdValue = usdValue;
        }
      }
    }
  }

  private async estimateNFTValue(nft: NFTToken): Promise<NFTPrice | undefined> {
    if (!nft.floorPrice) return undefined;

    try {
      let multiplier = 1.0; // Base multiplier for floor price

      // Adjust based on rarity if available
      if (nft.rarityRank && nft.totalSupply) {
        const rarityPercentile = nft.rarityRank / nft.totalSupply;
        
        if (rarityPercentile <= 0.01) { // Top 1%
          multiplier = 3.0;
        } else if (rarityPercentile <= 0.05) { // Top 5%
          multiplier = 2.0;
        } else if (rarityPercentile <= 0.10) { // Top 10%
          multiplier = 1.5;
        } else if (rarityPercentile <= 0.25) { // Top 25%
          multiplier = 1.2;
        }
      }

      // Adjust based on listing status
      if (nft.isListed && nft.listingPrice) {
        // If listed, use average of floor and listing price
        const floorValue = parseFloat(nft.floorPrice.amount);
        const listingValue = parseFloat(nft.listingPrice.amount);
        const avgValue = (floorValue + listingValue) / 2;
        
        return {
          amount: (avgValue * multiplier).toString(),
          currency: nft.floorPrice.currency,
          usdValue: await this.convertToUSD(
            (avgValue * multiplier).toString(), 
            nft.floorPrice.currency
          ),
          timestamp: new Date(),
        };
      }

      // Use floor price with rarity multiplier
      const estimatedValue = parseFloat(nft.floorPrice.amount) * multiplier;
      
      return {
        amount: estimatedValue.toString(),
        currency: nft.floorPrice.currency,
        usdValue: await this.convertToUSD(estimatedValue.toString(), nft.floorPrice.currency),
        timestamp: new Date(),
      };

    } catch (error) {
      logger.debug('Failed to estimate NFT value', {
        error: error instanceof Error ? error.message : 'Unknown error',
        nftId: nft.id,
      });
      return undefined;
    }
  }

  private async calculateMarketCap(floorPrice: NFTPrice, totalSupply: number): Promise<NFTPrice> {
    const floorValue = parseFloat(floorPrice.amount);
    const marketCapValue = floorValue * totalSupply;
    
    return {
      amount: marketCapValue.toString(),
      currency: floorPrice.currency,
      usdValue: await this.convertToUSD(marketCapValue.toString(), floorPrice.currency),
      timestamp: new Date(),
    };
  }

  private async convertToUSD(amount: string, currency: string): Promise<number> {
    try {
      const numericAmount = parseFloat(amount);
      if (isNaN(numericAmount) || numericAmount === 0) return 0;

      // Handle USD directly
      if (currency.toUpperCase() === 'USD') return numericAmount;

      // Get exchange rate
      const rate = await this.getExchangeRate(currency, 'USD');
      return numericAmount * rate;

    } catch (error) {
      logger.debug('Failed to convert currency to USD', {
        error: error instanceof Error ? error.message : 'Unknown error',
        amount,
        currency,
      });
      return 0;
    }
  }

  private async getExchangeRate(fromCurrency: string, toCurrency: string): Promise<number> {
    const cacheKey = `${fromCurrency}-${toCurrency}`;
    const cached = this.exchangeRates.get(cacheKey);
    
    // Check cache first
    if (cached && Date.now() - cached.timestamp < this.RATE_CACHE_DURATION) {
      return cached.rate;
    }

    try {
      let rate = 0;

      // Try CoinGecko first if API key available
      if (this.config.coinGeckoApiKey) {
        rate = await this.getExchangeRateFromCoinGecko(fromCurrency, toCurrency);
      }

      // Fallback to free APIs
      if (rate === 0) {
        rate = await this.getExchangeRateFromFreeAPI(fromCurrency, toCurrency);
      }

      // Cache the rate
      if (rate > 0) {
        this.exchangeRates.set(cacheKey, {
          rate,
          timestamp: Date.now(),
        });
      }

      return rate;

    } catch (error) {
      logger.debug('Failed to get exchange rate', {
        error: error instanceof Error ? error.message : 'Unknown error',
        fromCurrency,
        toCurrency,
      });
      
      // Return cached rate if available, even if expired
      return cached?.rate || 0;
    }
  }

  private async getExchangeRateFromCoinGecko(fromCurrency: string, toCurrency: string): Promise<number> {
    try {
      const coinId = this.getCoinGeckoCoinId(fromCurrency);
      if (!coinId) return 0;

      const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price`, {
        params: {
          ids: coinId,
          vs_currencies: toCurrency.toLowerCase(),
        },
        headers: {
          'X-CG-Pro-API-Key': this.config.coinGeckoApiKey,
        },
        timeout: 5000,
      });

      return response.data[coinId]?.[toCurrency.toLowerCase()] || 0;

    } catch (error) {
      logger.debug('CoinGecko rate fetch failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        fromCurrency,
        toCurrency,
      });
      return 0;
    }
  }

  private async getExchangeRateFromFreeAPI(fromCurrency: string, toCurrency: string): Promise<number> {
    try {
      // Use CoinGecko free tier
      const coinId = this.getCoinGeckoCoinId(fromCurrency);
      if (!coinId) return 0;

      const cacheKey = `coingecko-free:${fromCurrency}-${toCurrency}`;
      const cached = await redisManager.get<number>(cacheKey);
      if (cached) return cached;

      const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price`, {
        params: {
          ids: coinId,
          vs_currencies: toCurrency.toLowerCase(),
        },
        timeout: 10000,
      });

      const rate = response.data[coinId]?.[toCurrency.toLowerCase()] || 0;
      
      // Cache for 5 minutes
      if (rate > 0) {
        await redisManager.set(cacheKey, rate, 300);
      }

      return rate;

    } catch (error) {
      logger.debug('Free API rate fetch failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        fromCurrency,
        toCurrency,
      });
      return 0;
    }
  }

  private getCoinGeckoCoinId(currency: string): string | null {
    const currencyMap: Record<string, string> = {
      'ETH': 'ethereum',
      'SOL': 'solana',
      'MATIC': 'matic-network',
      'BNB': 'binancecoin',
      'AVAX': 'avalanche-2',
      'FTM': 'fantom',
      'ARB': 'arbitrum',
      'OP': 'optimism',
    };

    return currencyMap[currency.toUpperCase()] || null;
  }

  private getUsedExchangeRates(): string[] {
    return Array.from(this.exchangeRates.keys());
  }

  private getEstimationMethod(nft: NFTToken): string {
    if (nft.listingPrice && nft.floorPrice) {
      return 'listing-floor-average';
    } else if (nft.floorPrice && nft.rarityRank) {
      return 'floor-rarity-adjusted';
    } else if (nft.floorPrice) {
      return 'floor-price';
    } else if (nft.lastSalePrice) {
      return 'last-sale';
    }
    return 'none';
  }
}