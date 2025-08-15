import { config } from '@/config';
import { logger, logApiCall, logCost } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import {
  ChainId,
  ChainProvider,
  ProviderResponse,
  TokenBalance,
  Transaction,
  MultiChainPortfolio,
  PortfolioSummary,
  CHAIN_CONFIGS,
} from '@/types/blockchain';
import { AlchemyProvider } from './providers/AlchemyProvider';
import { RpcProvider } from './providers/RpcProvider';
import { SolanaProvider } from './providers/SolanaProvider';
import { getPriceService } from '@/services/pricing/PriceService';

interface ChainManagerConfig {
  providers: {
    alchemy: {
      ethereum?: string;
      polygon?: string;
      arbitrum?: string;
      optimism?: string;
      base?: string;
    };
    helius?: string;
  };
  fallbackEnabled: boolean;
  maxConcurrentRequests: number;
  costTracking: {
    enabled: boolean;
    monthlyBudget: number;
    alertThreshold: number;
  };
}

export class ChainManager {
  private providers: Map<ChainId, ChainProvider> = new Map();
  private providerHealth: Map<ChainId, boolean> = new Map();
  private costTracker: Map<string, number> = new Map(); // provider -> monthly cost
  private requestStats: Map<string, number> = new Map(); // provider -> request count

  constructor(private readonly managerConfig: ChainManagerConfig) {
    this.initializeProviders();
    this.startHealthChecking();
    this.startCostTracking();
  }

  private initializeProviders(): void {
    // Initialize EVM providers with Alchemy
    const evmChains: Array<{ chain: ChainId; key: string }> = [
      { chain: ChainId.ETHEREUM, key: 'ethereum' },
      { chain: ChainId.POLYGON, key: 'polygon' },
      { chain: ChainId.ARBITRUM, key: 'arbitrum' },
      { chain: ChainId.OPTIMISM, key: 'optimism' },
      { chain: ChainId.BASE, key: 'base' },
    ];

    for (const { chain, key } of evmChains) {
      const apiKey =
        this.managerConfig.providers.alchemy[
          key as keyof typeof this.managerConfig.providers.alchemy
        ];
      if (apiKey) {
        try {
          const provider = new AlchemyProvider(chain, apiKey);
          this.providers.set(chain, provider);
          this.providerHealth.set(chain, true);
          logger.info(`Initialized Alchemy provider for ${CHAIN_CONFIGS[chain].name}`);
        } catch (error) {
          logger.error(`Failed to initialize Alchemy provider for ${CHAIN_CONFIGS[chain].name}:`, {
            error,
          });
        }
      }
    }

    // Initialize Solana provider with Helius
    if (this.managerConfig.providers.helius) {
      try {
        const solanaProvider = new SolanaProvider(this.managerConfig.providers.helius);
        this.providers.set(ChainId.SOLANA, solanaProvider);
        this.providerHealth.set(ChainId.SOLANA, true);
        logger.info('Initialized Helius provider for Solana');
      } catch (error) {
        logger.error('Failed to initialize Helius provider for Solana:', { error });
      }
    }

    // Initialize generic RPC providers for additional EVM chains (BSC, Avalanche, Fantom)
    try {
      if (config.rpcUrls.bsc) {
        const bsc = new RpcProvider(ChainId.BSC, config.rpcUrls.bsc, 'BSC RPC');
        this.providers.set(ChainId.BSC, bsc);
        this.providerHealth.set(ChainId.BSC, true);
        logger.info('Initialized RPC provider for BSC');
      }
      if (config.rpcUrls.avalanche) {
        const avax = new RpcProvider(ChainId.AVALANCHE, config.rpcUrls.avalanche, 'Avalanche RPC');
        this.providers.set(ChainId.AVALANCHE, avax);
        this.providerHealth.set(ChainId.AVALANCHE, true);
        logger.info('Initialized RPC provider for Avalanche');
      }
      if (config.rpcUrls.fantom) {
        const ftm = new RpcProvider(
          ChainId.FANTOM as any,
          (config.rpcUrls as any).fantom,
          'Fantom RPC'
        );
        this.providers.set(ChainId.FANTOM as any, ftm);
        this.providerHealth.set(ChainId.FANTOM as any, true);
        logger.info('Initialized RPC provider for Fantom');
      }
    } catch (error) {
      logger.error('Failed to initialize RPC providers:', { error });
    }

    logger.info(`ChainManager initialized with ${this.providers.size} providers`);
  }

  // Initialize all providers
  async initialize(): Promise<void> {
    const initPromises = Array.from(this.providers.values()).map(async provider => {
      try {
        await provider.initialize();
        this.providerHealth.set(provider.chainId, true);
        logger.info(
          `Provider ${provider.name} for chain ${provider.chainId} initialized successfully`
        );
      } catch (error) {
        this.providerHealth.set(provider.chainId, false);
        logger.error(
          `Provider ${provider.name} for chain ${provider.chainId} failed to initialize:`,
          { error }
        );
      }
    });

    await Promise.allSettled(initPromises);
    logger.info('ChainManager initialization completed');
  }

  // Track health check interval for cleanup
  private healthCheckInterval: NodeJS.Timeout | null = null;

  // Health checking
  private startHealthChecking(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, 60000); // Check every minute
  }

  private async performHealthChecks(): Promise<void> {
    const healthPromises = Array.from(this.providers.entries()).map(async ([chainId, provider]) => {
      try {
        const isHealthy = await provider.healthCheck();
        this.providerHealth.set(chainId, isHealthy);

        if (!isHealthy) {
          logger.warn(`Provider ${provider.name} for chain ${chainId} is unhealthy`);
        }
      } catch (error) {
        this.providerHealth.set(chainId, false);
        logger.error(`Health check failed for ${provider.name} (${chainId}):`, { error });
      }
    });

    await Promise.allSettled(healthPromises);
  }

  // Track cost tracking intervals for cleanup
  private costResetInterval: NodeJS.Timeout | null = null;
  private costReportInterval: NodeJS.Timeout | null = null;

  // Cost tracking
  private startCostTracking(): void {
    if (!this.managerConfig.costTracking.enabled) return;

    // Reset monthly costs at the start of each month
    this.costResetInterval = setInterval(() => {
      const now = new Date();
      if (now.getDate() === 1 && now.getHours() === 0 && now.getMinutes() === 0) {
        this.costTracker.clear();
        this.requestStats.clear();
        logger.info('Monthly cost tracking reset');
      }
    }, 60000); // Check every minute

    // Daily cost reporting
    this.costReportInterval = setInterval(
      () => {
        this.reportCostMetrics();
      },
      24 * 60 * 60 * 1000
    ); // Once per day
  }

  private trackCost(provider: string, cost: number): void {
    if (!this.managerConfig.costTracking.enabled) return;

    const currentCost = this.costTracker.get(provider) || 0;
    const newCost = currentCost + cost;
    this.costTracker.set(provider, newCost);

    const currentRequests = this.requestStats.get(provider) || 0;
    this.requestStats.set(provider, currentRequests + 1);

    // Check for budget alerts
    const totalCost = Array.from(this.costTracker.values()).reduce((sum, cost) => sum + cost, 0);
    if (totalCost >= this.managerConfig.costTracking.alertThreshold) {
      logger.warn('Cost alert: Monthly budget threshold reached', {
        totalCost,
        threshold: this.managerConfig.costTracking.alertThreshold,
        budget: this.managerConfig.costTracking.monthlyBudget,
      });
    }
  }

  private reportCostMetrics(): void {
    const totalCost = Array.from(this.costTracker.values()).reduce((sum, cost) => sum + cost, 0);
    const totalRequests = Array.from(this.requestStats.values()).reduce(
      (sum, count) => sum + count,
      0
    );

    logger.info('Daily cost report:', {
      totalCost: totalCost.toFixed(4),
      totalRequests,
      averageCostPerRequest: totalRequests > 0 ? (totalCost / totalRequests).toFixed(6) : 0,
      budgetUtilization: `${((totalCost / this.managerConfig.costTracking.monthlyBudget) * 100).toFixed(2)}%`,
      providerBreakdown: Object.fromEntries(
        Array.from(this.costTracker.entries()).map(([provider, cost]) => [
          provider,
          {
            cost: cost.toFixed(4),
            requests: this.requestStats.get(provider) || 0,
          },
        ])
      ),
    });
  }

  // Get supported chains
  getSupportedChains(): ChainId[] {
    return Array.from(this.providers.keys());
  }

  // Get healthy chains
  getHealthyChains(): ChainId[] {
    return Array.from(this.providers.keys()).filter(
      chainId => this.providerHealth.get(chainId) === true
    );
  }

  // Get provider for a specific chain
  private getProvider(chainId: ChainId): ChainProvider | null {
    const provider = this.providers.get(chainId);
    if (!provider || !this.providerHealth.get(chainId)) {
      return null;
    }
    return provider;
  }

  // Single chain balance
  async getBalance(chainId: ChainId, address: string): Promise<ProviderResponse<TokenBalance[]>> {
    const provider = this.getProvider(chainId);
    if (!provider) {
      return {
        success: false,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message: `No healthy provider available for chain ${chainId}`,
        },
        metadata: {
          provider: 'ChainManager',
          chainId,
          timestamp: Date.now(),
          requestId: 'provider_unavailable',
        },
      };
    }

    const startTime = Date.now();
    try {
      const result = await provider.getBalance(address);

      // Track cost
      if (result.metadata.cost) {
        this.trackCost(provider.name, result.metadata.cost);
      }

      const duration = Date.now() - startTime;
      logApiCall(provider.name, 'getBalance', duration, result.success ? 'success' : 'error', {
        chainId,
        address,
        tokenCount: result.success ? result.data?.length || 0 : 0,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logApiCall(provider.name, 'getBalance', duration, 'error', {
        chainId,
        address,
        error: error instanceof Error ? error.message : 'Unknown error',
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
          requestId: 'provider_error',
        },
      };
    }
  }

  // Multi-chain portfolio
  async getMultiChainPortfolio(
    address: string,
    chainIds?: ChainId[]
  ): Promise<ProviderResponse<MultiChainPortfolio>> {
    const startTime = Date.now();
    const targetChains = chainIds || this.getHealthyChains();

    const cacheKey = `multi-chain-portfolio:${address}:${targetChains.sort().join(',')}`;

    try {
      // Try cache first
      const cached = await redisManager.get<MultiChainPortfolio>(cacheKey);
      if (cached) {
        logger.debug(`Multi-chain portfolio cache hit for ${address}`);
        return {
          success: true,
          data: cached,
          metadata: {
            provider: 'ChainManager',
            chainId: ChainId.ETHEREUM, // Default
            timestamp: Date.now(),
            requestId: 'cache_hit',
          },
        };
      }

      // Fetch balances from all chains concurrently
      const balancePromises = targetChains.map(async chainId => {
        const result = await this.getBalance(chainId, address);
        return { chainId, result };
      });

      const balanceResults = await Promise.allSettled(balancePromises);

      // Process results
      const chains: PortfolioSummary[] = [];
      const allTokens: TokenBalance[] = [];
      let totalValueUSD = 0;
      let successfulChains = 0;
      let totalRequests = 0;

      for (const promiseResult of balanceResults) {
        if (promiseResult.status === 'fulfilled') {
          const { chainId, result } = promiseResult.value;
          totalRequests++;

          if (result.success && result.data) {
            successfulChains++;
            // Enrich with USD prices
            const enriched = await getPriceService().enrichBalances(chainId, result.data);
            // Calculate chain total in USD (sum non-NaN)
            const chainTotalUSD = enriched.reduce((sum, t) => sum + (t.balanceUSD || 0), 0);

            const chainSummary: PortfolioSummary = {
              address,
              chainId,
              totalValueUSD: chainTotalUSD,
              tokenCount: enriched.length,
              tokens: enriched,
              nativeBalance: enriched.find(t => t.token.isNative),
              lastUpdated: new Date(),
            };

            chains.push(chainSummary);
            allTokens.push(...enriched);
            totalValueUSD += chainTotalUSD;
          }
        }
      }

      // Calculate diversification score (simplified)
      const diversificationScore = this.calculateDiversificationScore(allTokens);

      // Top tokens by USD value (fallback to balance if no USD)
      const topTokens = allTokens
        .filter(t => !t.token.isNative)
        .sort(
          (a, b) =>
            (b.balanceUSD ?? parseFloat(b.balanceFormatted)) -
            (a.balanceUSD ?? parseFloat(a.balanceFormatted))
        )
        .slice(0, 10);

      const portfolio: MultiChainPortfolio = {
        address,
        totalValueUSD,
        chains,
        topTokens,
        diversificationScore,
        lastUpdated: new Date(),
        metadata: {
          fetchTimeMs: Date.now() - startTime,
          chainCount: successfulChains,
          totalTokens: allTokens.length,
          cacheHitRate: 0, // Fresh data
        },
      };

      // Cache the result using configured TTL
      await redisManager.set(cacheKey, portfolio, config.cache.ttl.medium);

      return {
        success: true,
        data: portfolio,
        metadata: {
          provider: 'ChainManager',
          chainId: ChainId.ETHEREUM, // Default
          timestamp: Date.now(),
          requestId: 'multi_chain_fetch',
        },
      };
    } catch (error) {
      logger.error(`Multi-chain portfolio fetch failed for ${address}:`, { error });
      return {
        success: false,
        error: {
          code: 'MULTI_CHAIN_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        metadata: {
          provider: 'ChainManager',
          chainId: ChainId.ETHEREUM, // Default
          timestamp: Date.now(),
          requestId: 'multi_chain_error',
        },
      };
    }
  }

  // Transaction methods
  async getTransaction(chainId: ChainId, hash: string): Promise<ProviderResponse<Transaction>> {
    const provider = this.getProvider(chainId);
    if (!provider) {
      return {
        success: false,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message: `No healthy provider available for chain ${chainId}`,
        },
        metadata: {
          provider: 'ChainManager',
          chainId,
          timestamp: Date.now(),
          requestId: 'provider_unavailable',
        },
      };
    }

    const result = await provider.getTransaction(hash);

    if (result.metadata.cost) {
      this.trackCost(provider.name, result.metadata.cost);
    }

    return result;
  }

  // Utility methods
  private calculateDiversificationScore(tokens: TokenBalance[]): number {
    if (tokens.length === 0) return 0;

    // Simplified diversification score based on token distribution
    // In a real implementation, this would consider USD values
    const uniqueSymbols = new Set(tokens.map(t => t.token.symbol));
    const symbolCount = uniqueSymbols.size;

    // Score based on number of unique tokens (0-100)
    return Math.min((symbolCount / 10) * 100, 100);
  }

  // Get cost statistics
  getCostStatistics() {
    const totalCost = Array.from(this.costTracker.values()).reduce((sum, cost) => sum + cost, 0);
    const totalRequests = Array.from(this.requestStats.values()).reduce(
      (sum, count) => sum + count,
      0
    );

    return {
      totalCost,
      totalRequests,
      averageCostPerRequest: totalRequests > 0 ? totalCost / totalRequests : 0,
      budgetUtilization: totalCost / this.managerConfig.costTracking.monthlyBudget,
      providerBreakdown: Object.fromEntries(
        Array.from(this.costTracker.entries()).map(([provider, cost]) => [
          provider,
          {
            cost,
            requests: this.requestStats.get(provider) || 0,
            averageCost: this.requestStats.get(provider)
              ? cost / this.requestStats.get(provider)!
              : 0,
          },
        ])
      ),
    };
  }

  // Get health status
  getHealthStatus() {
    const totalProviders = this.providers.size;
    const healthyProviders = Array.from(this.providerHealth.values()).filter(h => h).length;

    return {
      totalProviders,
      healthyProviders,
      unhealthyProviders: totalProviders - healthyProviders,
      healthPercentage: totalProviders > 0 ? (healthyProviders / totalProviders) * 100 : 0,
      providerStatus: Object.fromEntries(
        Array.from(this.providers.entries()).map(([chainId, provider]) => [
          chainId,
          {
            healthy: this.providerHealth.get(chainId) || false,
            provider: provider.name,
            chainId,
          },
        ])
      ),
    };
  }

  /**
   * Stop the ChainManager and cleanup resources
   * Called during graceful shutdown
   */
  async stop(): Promise<void> {
    try {
      logger.info('ChainManager: Starting graceful shutdown...');

      // Clear health checking interval
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
        logger.debug('ChainManager: Health check interval cleared');
      }

      // Clear cost tracking intervals
      if (this.costResetInterval) {
        clearInterval(this.costResetInterval);
        this.costResetInterval = null;
        logger.debug('ChainManager: Cost reset interval cleared');
      }

      if (this.costReportInterval) {
        clearInterval(this.costReportInterval);
        this.costReportInterval = null;
        logger.debug('ChainManager: Cost report interval cleared');
      }

      // Stop all providers
      const stopPromises = Array.from(this.providers.values()).map(async provider => {
        try {
          if (typeof provider.stop === 'function') {
            await provider.stop();
          }
          logger.debug(`ChainManager: Provider ${provider.name} stopped`);
        } catch (error) {
          logger.error(`ChainManager: Error stopping provider ${provider.name}:`, { error });
        }
      });

      await Promise.allSettled(stopPromises);

      // Clear internal state
      this.providers.clear();
      this.providerHealth.clear();
      this.costTracker.clear();
      this.requestStats.clear();

      logger.info('ChainManager: Graceful shutdown completed');
    } catch (error) {
      logger.error('ChainManager: Error during graceful shutdown:', { error });
      throw error;
    }
  }
}

// Factory function to create ChainManager
export const createChainManager = (): ChainManager => {
  const managerConfig: ChainManagerConfig = {
    providers: {
      alchemy: {
        ethereum: config.apiKeys.alchemy,
        polygon: config.apiKeys.alchemy,
        arbitrum: config.apiKeys.alchemy,
        optimism: config.apiKeys.alchemy,
        base: config.apiKeys.alchemy,
      },
      helius: config.apiKeys.helius,
    },
    fallbackEnabled: true,
    maxConcurrentRequests: 10,
    costTracking: {
      enabled: config.costs.trackingEnabled,
      monthlyBudget: config.costs.monthlyBudget,
      alertThreshold: config.costs.alertThreshold,
    },
  };

  return new ChainManager(managerConfig);
};

// Lazy singleton accessor to avoid import-time side effects
let _chainManager: ChainManager | null = null;
export const getChainManager = (): ChainManager => {
  if (!_chainManager) {
    _chainManager = createChainManager();
  }
  return _chainManager;
};

// For testing environments only
export const __resetChainManagerForTests = () => {
  _chainManager = null;
};
