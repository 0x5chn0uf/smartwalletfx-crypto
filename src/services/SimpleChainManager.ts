import { logger } from '@/utils/logger';
import {
  ChainId,
  ChainProvider,
  ProviderResponse,
  TokenBalance,
  ProviderHealthStatus,
  MultiChainPortfolio,
  PortfolioSummary,
} from '@/types/blockchain';
import { AlchemyProvider } from './providers/AlchemyProvider';
import { RpcProvider } from './providers/RpcProvider';
import { SolanaProvider } from './providers/SolanaProvider';
import { getCacheManager } from './cache/CacheManager';
import { getCostTracker } from './cost/CostTracker';

interface ChainManagerConfig {
  providers: {
    alchemy: {
      ethereum?: string;
      polygon?: string;
      arbitrum?: string;
      optimism?: string;
      base?: string;
    };
    rpc: Record<string, string>;
    solana: {
      mainnet: string;
    };
  };
  healthCheck: {
    interval: number;
    timeout: number;
  };
}

export interface ProviderHealthSummary {
  healthyProviders: number;
  totalProviders: number;
  unhealthyProviders: string[];
  lastChecked: number;
}

/**
 * Simplified Chain Manager
 * 
 * Focused responsibilities:
 * - Provider initialization and management
 * - Health checking
 * - Basic multi-chain coordination
 * - Provider failover
 */
export class SimpleChainManager {
  private providers: Map<ChainId, ChainProvider> = new Map();
  private providerHealth: Map<ChainId, boolean> = new Map();
  private healthCheckInterval?: NodeJS.Timeout;
  private cacheManager = getCacheManager();
  private costTracker = getCostTracker();

  constructor(private readonly config: ChainManagerConfig) {
    this.initializeProviders();
    this.startHealthChecking();
  }

  /**
   * Initialize all blockchain providers
   */
  private initializeProviders(): void {
    try {
      // Initialize EVM providers with Alchemy
      if (this.config.providers.alchemy.ethereum) {
        const ethProvider = new AlchemyProvider(ChainId.ETHEREUM, this.config.providers.alchemy.ethereum);
        this.providers.set(ChainId.ETHEREUM, ethProvider);
        this.providerHealth.set(ChainId.ETHEREUM, true);
      }

      if (this.config.providers.alchemy.polygon) {
        const polygonProvider = new AlchemyProvider(ChainId.POLYGON, this.config.providers.alchemy.polygon);
        this.providers.set(ChainId.POLYGON, polygonProvider);
        this.providerHealth.set(ChainId.POLYGON, true);
      }

      if (this.config.providers.alchemy.arbitrum) {
        const arbitrumProvider = new AlchemyProvider(ChainId.ARBITRUM, this.config.providers.alchemy.arbitrum);
        this.providers.set(ChainId.ARBITRUM, arbitrumProvider);
        this.providerHealth.set(ChainId.ARBITRUM, true);
      }

      if (this.config.providers.alchemy.optimism) {
        const optimismProvider = new AlchemyProvider(ChainId.OPTIMISM, this.config.providers.alchemy.optimism);
        this.providers.set(ChainId.OPTIMISM, optimismProvider);
        this.providerHealth.set(ChainId.OPTIMISM, true);
      }

      if (this.config.providers.alchemy.base) {
        const baseProvider = new AlchemyProvider(ChainId.BASE, this.config.providers.alchemy.base);
        this.providers.set(ChainId.BASE, baseProvider);
        this.providerHealth.set(ChainId.BASE, true);
      }

      // Initialize RPC providers for other chains
      for (const [chainName, rpcUrl] of Object.entries(this.config.providers.rpc)) {
        const chainId = this.getChainIdFromName(chainName);
        if (chainId && !this.providers.has(chainId)) {
          const rpcProvider = new RpcProvider(chainId, rpcUrl);
          this.providers.set(chainId, rpcProvider);
          this.providerHealth.set(chainId, true);
        }
      }

      // Initialize Solana provider
      if (this.config.providers.solana.mainnet) {
        const solanaProvider = new SolanaProvider(this.config.providers.solana.mainnet);
        this.providers.set(ChainId.SOLANA, solanaProvider);
        this.providerHealth.set(ChainId.SOLANA, true);
      }

      logger.info('Chain providers initialized', {
        totalProviders: this.providers.size,
        chains: Array.from(this.providers.keys()),
      });
    } catch (error) {
      logger.error('Failed to initialize providers:', error);
      throw error;
    }
  }

  /**
   * Get token balance for an address on a specific chain
   */
  async getBalance(chainId: ChainId, address: string): Promise<ProviderResponse<TokenBalance[]>> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      return {
        success: false,
        error: {
          code: 'PROVIDER_NOT_FOUND',
          message: `No provider found for chain ${chainId}`,
        },
        metadata: {
          provider: 'ChainManager',
          chainId,
          timestamp: Date.now(),
          requestId: `error_${Date.now()}`,
        },
      };
    }

    // Check provider health
    if (!this.providerHealth.get(chainId)) {
      return {
        success: false,
        error: {
          code: 'PROVIDER_UNHEALTHY',
          message: `Provider for chain ${chainId} is unhealthy`,
        },
        metadata: {
          provider: provider.name,
          chainId,
          timestamp: Date.now(),
          requestId: `error_${Date.now()}`,
        },
      };
    }

    try {
      // Check cache first
      const cacheKey = `balance:${chainId}:${address}`;
      const cached = await this.cacheManager.get<TokenBalance[]>(cacheKey);
      if (cached) {
        return {
          success: true,
          data: cached,
          metadata: {
            provider: provider.name,
            chainId,
            timestamp: Date.now(),
            requestId: `cache_hit_${Date.now()}`,
            cached: true,
          },
        };
      }

      // Fetch from provider
      const startTime = Date.now();
      const result = await provider.getTokenBalances(address);

      // Track cost
      await this.costTracker.trackCost(
        provider.name,
        'getTokenBalances',
        0.001, // Basic cost estimate
        {
          chainId,
          requestType: 'balance',
          success: result.success,
          cacheHit: false,
        }
      );

      // Cache successful results
      if (result.success && result.data) {
        await this.cacheManager.set(cacheKey, result.data, { ttl: 300 }); // 5 minutes
      }

      logger.debug('Balance fetched', {
        chainId,
        address,
        provider: provider.name,
        success: result.success,
        tokenCount: result.data?.length || 0,
        duration: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      logger.error('Failed to get balance:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        chainId,
        address,
        provider: provider.name,
      });

      return {
        success: false,
        error: {
          code: 'PROVIDER_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        metadata: {
          provider: provider.name,
          chainId,
          timestamp: Date.now(),
          requestId: `error_${Date.now()}`,
        },
      };
    }
  }

  /**
   * Get balances across multiple chains
   */
  async getMultiChainBalance(
    address: string,
    chainIds?: ChainId[]
  ): Promise<ProviderResponse<MultiChainPortfolio>> {
    const targetChains = chainIds || this.getHealthyChains();
    const startTime = Date.now();

    if (targetChains.length === 0) {
      return {
        success: false,
        error: {
          code: 'NO_HEALTHY_PROVIDERS',
          message: 'No healthy providers available',
        },
        metadata: {
          provider: 'ChainManager',
          chainId: ChainId.ETHEREUM,
          timestamp: Date.now(),
          requestId: `error_${Date.now()}`,
        },
      };
    }

    try {
      // Check cache first
      const cacheKey = `multichain:${address}:${targetChains.sort().join(',')}`;
      const cached = await this.cacheManager.get<MultiChainPortfolio>(cacheKey);
      if (cached) {
        return {
          success: true,
          data: cached,
          metadata: {
            provider: 'ChainManager',
            chainId: ChainId.ETHEREUM,
            timestamp: Date.now(),
            requestId: `cache_hit_${Date.now()}`,
            cached: true,
          },
        };
      }

      // Fetch from all chains in parallel
      const chainPromises = targetChains.map(async (chainId) => {
        const result = await this.getBalance(chainId, address);
        return { chainId, result };
      });

      const chainResults = await Promise.allSettled(chainPromises);

      // Process results
      const chains: PortfolioSummary[] = [];
      let totalValueUSD = 0;
      let successfulChains = 0;

      for (const chainResult of chainResults) {
        if (chainResult.status === 'fulfilled') {
          const { chainId, result } = chainResult.value;

          if (result.success && result.data) {
            const chainTotalUSD = result.data.reduce((sum, token) => {
              return sum + (token.balanceUSD || 0);
            }, 0);

            const chainSummary: PortfolioSummary = {
              address,
              chainId,
              totalValueUSD: chainTotalUSD,
              tokenCount: result.data.length,
              tokens: result.data,
              nativeBalance: result.data.find(t => t.token.isNative),
              lastUpdated: new Date(),
            };

            chains.push(chainSummary);
            totalValueUSD += chainTotalUSD;
            successfulChains++;
          }
        }
      }

      const portfolio: MultiChainPortfolio = {
        address,
        totalValueUSD,
        chains,
        chainCount: successfulChains,
        lastUpdated: new Date(),
        metadata: {
          fetchTimeMs: Date.now() - startTime,
          chainCount: successfulChains,
          totalTokens: chains.reduce((sum, chain) => sum + chain.tokenCount, 0),
          cacheHitRate: 0,
        },
      };

      // Cache the result
      await this.cacheManager.set(cacheKey, portfolio, { ttl: 600 }); // 10 minutes

      return {
        success: true,
        data: portfolio,
        metadata: {
          provider: 'ChainManager',
          chainId: ChainId.ETHEREUM,
          timestamp: Date.now(),
          requestId: `success_${Date.now()}`,
        },
      };
    } catch (error) {
      logger.error('Failed to get multi-chain balance:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address,
        targetChains,
      });

      return {
        success: false,
        error: {
          code: 'MULTICHAIN_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        metadata: {
          provider: 'ChainManager',
          chainId: ChainId.ETHEREUM,
          timestamp: Date.now(),
          requestId: `error_${Date.now()}`,
        },
      };
    }
  }

  /**
   * Get list of supported chains
   */
  getSupportedChains(): ChainId[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get provider for a specific chain
   */
  getProvider(chainId: ChainId): ChainProvider | undefined {
    return this.providers.get(chainId);
  }

  /**
   * Get list of healthy chains
   */
  getHealthyChains(): ChainId[] {
    return Array.from(this.providerHealth.entries())
      .filter(([_, isHealthy]) => isHealthy)
      .map(([chainId]) => chainId);
  }

  /**
   * Get health status summary
   */
  getHealthStatus(): ProviderHealthSummary {
    const totalProviders = this.providers.size;
    const healthyProviders = Array.from(this.providerHealth.values()).filter(Boolean).length;
    const unhealthyProviders = Array.from(this.providerHealth.entries())
      .filter(([_, isHealthy]) => !isHealthy)
      .map(([chainId]) => chainId.toString());

    return {
      healthyProviders,
      totalProviders,
      unhealthyProviders,
      lastChecked: Date.now(),
    };
  }

  /**
   * Initialize the chain manager
   */
  async initialize(): Promise<void> {
    // Providers are already initialized in constructor
    // Perform initial health check
    await this.performHealthCheck();
    logger.info('SimpleChainManager initialized successfully');
  }

  /**
   * Stop the chain manager and cleanup resources
   */
  async stop(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    this.providers.clear();
    this.providerHealth.clear();

    logger.info('SimpleChainManager stopped');
  }

  // Private helper methods

  private startHealthChecking(): void {
    // Perform initial health check
    this.performHealthCheck().catch(error => {
      logger.error('Initial health check failed:', error);
    });

    // Start periodic health checks
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        logger.error('Health check failed:', error);
      }
    }, this.config.healthCheck.interval);
  }

  private async performHealthCheck(): Promise<void> {
    const healthPromises = Array.from(this.providers.entries()).map(async ([chainId, provider]) => {
      try {
        const isHealthy = await this.checkProviderHealth(provider);
        this.providerHealth.set(chainId, isHealthy);
        return { chainId, isHealthy };
      } catch (error) {
        this.providerHealth.set(chainId, false);
        return { chainId, isHealthy: false, error };
      }
    });

    const results = await Promise.allSettled(healthPromises);
    
    let healthyCount = 0;
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.isHealthy) {
        healthyCount++;
      }
    }

    logger.debug('Health check completed', {
      totalProviders: this.providers.size,
      healthyProviders: healthyCount,
      unhealthyProviders: this.providers.size - healthyCount,
    });
  }

  private async checkProviderHealth(provider: ChainProvider): Promise<boolean> {
    try {
      // Simple health check - try to get block number or similar
      const startTime = Date.now();
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Health check timeout')), this.config.healthCheck.timeout)
      );

      // Race between actual health check and timeout
      await Promise.race([
        provider.getTokenBalances('0x0000000000000000000000000000000000000000'), // Test with null address
        timeout,
      ]);

      const duration = Date.now() - startTime;
      if (duration > this.config.healthCheck.timeout * 0.8) {
        logger.warn('Provider responding slowly', {
          provider: provider.name,
          duration,
        });
      }

      return true;
    } catch (error) {
      logger.debug('Provider health check failed', {
        provider: provider.name,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  private getChainIdFromName(chainName: string): ChainId | null {
    const chainMap: Record<string, ChainId> = {
      ethereum: ChainId.ETHEREUM,
      polygon: ChainId.POLYGON,
      arbitrum: ChainId.ARBITRUM,
      optimism: ChainId.OPTIMISM,
      base: ChainId.BASE,
      bsc: ChainId.BSC,
      avalanche: ChainId.AVALANCHE,
      fantom: ChainId.FANTOM,
      solana: ChainId.SOLANA,
    };

    return chainMap[chainName.toLowerCase()] || null;
  }
}

// Export singleton getter
let chainManagerInstance: SimpleChainManager | null = null;

export const getSimpleChainManager = (config?: ChainManagerConfig): SimpleChainManager => {
  if (!chainManagerInstance && config) {
    chainManagerInstance = new SimpleChainManager(config);
  }
  
  if (!chainManagerInstance) {
    throw new Error('SimpleChainManager not initialized. Please provide config on first call.');
  }
  
  return chainManagerInstance;
};

export { SimpleChainManager };