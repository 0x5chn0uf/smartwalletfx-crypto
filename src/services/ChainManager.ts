// Config will be passed through constructor
import { logger, logApiCall, logCost } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { MoneyUtils, MoneyDecimal } from '@/utils/money';
import { recordProviderCall } from '@/utils/metrics';
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
import {
  ProviderConcurrencyLimiter,
  executeWithConcurrencyLimit,
  getGlobalConcurrencyLimiter,
} from '@/utils/concurrencyLimiter';
import { BatchProcessor, BatchItem, BatchResult } from '@/utils/batchProcessor';
import { CircuitBreakerFactory } from '@/utils/circuitBreaker';

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
  maxConcurrentRequests: number; // @deprecated - will be removed in favor of per-provider limits
  costTracking: {
    enabled: boolean;
    monthlyBudget: number;
    alertThreshold: number;
  };
  concurrency?: {
    enabled: boolean;
    retryConfig?: {
      maxAttempts: number;
      initialDelayMs: number;
      maxDelayMs: number;
      backoffMultiplier: number;
      jitterFactor: number;
    };
  };
}

export class ChainManager {
  private providers: Map<ChainId, ChainProvider> = new Map();
  private providerHealth: Map<ChainId, boolean> = new Map();
  private costTracker: Map<string, number> = new Map(); // provider -> monthly cost
  private requestStats: Map<string, number> = new Map(); // provider -> request count
  private concurrencyLimiter: ProviderConcurrencyLimiter;
  private batchProcessor: BatchProcessor<string, TokenBalance[]>;
  private portfolioCache = new Map<string, { data: MultiChainPortfolio; expires: number }>();

  constructor(private readonly managerConfig: ChainManagerConfig) {
    // Initialize concurrency limiter with default configuration
    const retryConfig = this.managerConfig.concurrency?.retryConfig || {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2.0,
      jitterFactor: 0.1,
    };
    const defaultConcurrency = {
      concurrency: this.managerConfig.maxConcurrentRequests || 10,
      rateLimitPerSecond: 10,
      rateLimitPerMinute: 600,
      burstAllowance: 5,
    };

    this.concurrencyLimiter = new ProviderConcurrencyLimiter(retryConfig, defaultConcurrency);

    // Initialize batch processor for multi-chain operations
    this.batchProcessor = new BatchProcessor(
      async (address: string, context: { chainId?: ChainId; provider?: string }) => {
        const result = await this.getBalance(context.chainId!, address);
        if (!result.success || !result.data) {
          throw new Error(result.error?.message || 'Failed to get balance');
        }
        return result.data;
      },
      {
        maxConcurrency: defaultConcurrency.concurrency,
        batchSize: 5,
        timeoutMs: 30000,
        retryAttempts: 3,
        retryDelayMs: 1000,
        useCircuitBreaker: true
      }
    );

    this.initializeProviders();
    this.startHealthChecking();
    this.startCostTracking();
    this.startCacheCleanup();
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
    // Additional RPC providers can be initialized here
    // Currently using Alchemy for EVM chains and Helius for Solana

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

    // Use concurrency limiter if enabled
    if (this.managerConfig.concurrency?.enabled) {
      const result = await executeWithConcurrencyLimit(
        () => provider.getBalance(address),
        provider.name,
        chainId,
        this.managerConfig.concurrency?.retryConfig
      );

      if (result.success && result.data) {
        // Track cost - note that ProviderResult doesn't have cost metadata
        // This would be added by the actual provider response
        const duration = Date.now() - startTime;

        // Use enhanced metrics with all required parameters
        recordProviderCall(
          provider.name,
          chainId,
          'getBalance',
          true,
          duration,
          undefined, // no error
          result.metadata.attempts,
          result.metadata.cost
        );

        logApiCall(provider.name, 'getBalance', duration, 'success', {
          chainId,
          address,
          tokenCount: result.data.length,
          attempts: result.metadata.attempts,
          totalTime: result.metadata.totalTime,
        });

        return {
          success: true,
          data: result.data,
          metadata: {
            provider: provider.name,
            chainId,
            timestamp: Date.now(),
            requestId: 'concurrency_limited',
            attempts: result.metadata.attempts,
            totalTime: result.metadata.totalTime,
          },
        };
      } else {
        const duration = Date.now() - startTime;

        // Use enhanced metrics with all required parameters
        recordProviderCall(
          provider.name,
          chainId,
          'getBalance',
          false,
          duration,
          result.error?.code,
          result.metadata.attempts,
          result.metadata.cost
        );

        logApiCall(provider.name, 'getBalance', duration, 'error', {
          chainId,
          address,
          error: result.error?.message || 'Unknown error',
          attempts: result.metadata.attempts,
          totalTime: result.metadata.totalTime,
        });

        return {
          success: false,
          error: {
            code: result.error?.code || 'PROVIDER_ERROR',
            message: result.error?.message || 'Unknown error',
          },
          metadata: {
            provider: provider.name,
            chainId,
            timestamp: Date.now(),
            requestId: 'concurrency_limited_error',
            attempts: result.metadata.attempts,
            totalTime: result.metadata.totalTime,
          },
        };
      }
    }

    // Fallback to original implementation if concurrency limiting is disabled
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

  // Multi-chain portfolio with optimized batch processing
  async getMultiChainPortfolio(
    address: string,
    chainIds?: ChainId[]
  ): Promise<ProviderResponse<MultiChainPortfolio>> {
    const startTime = Date.now();
    const targetChains = chainIds || this.getHealthyChains();

    const cacheKey = `multi-chain-portfolio:${address}:${targetChains.sort().join(',')}`;

    try {
      // Try multi-level cache (memory -> Redis)
      const memoryCache = this.getFromMemoryCache(cacheKey);
      if (memoryCache) {
        logger.debug(`Multi-chain portfolio memory cache hit for ${address}`);
        return {
          success: true,
          data: memoryCache,
          metadata: {
            provider: 'ChainManager',
            chainId: ChainId.ETHEREUM,
            timestamp: Date.now(),
            requestId: 'memory_cache_hit',
          },
        };
      }

      const cached = await redisManager.get<MultiChainPortfolio>(cacheKey);
      if (cached) {
        logger.debug(`Multi-chain portfolio Redis cache hit for ${address}`);
        // Store in memory cache for faster future access
        this.setMemoryCache(cacheKey, cached, 300); // 5 minutes
        return {
          success: true,
          data: cached,
          metadata: {
            provider: 'ChainManager',
            chainId: ChainId.ETHEREUM,
            timestamp: Date.now(),
            requestId: 'redis_cache_hit',
          },
        };
      }

      // Prepare batch items for parallel processing
      const batchItems: BatchItem<string, TokenBalance[]>[] = targetChains.map((chainId, index) => ({
        id: `${address}-${chainId}`,
        input: address,
        chainId,
        provider: this.getProvider(chainId)?.name || 'unknown',
        priority: this.getChainPriority(chainId)
      }));

      // Process all chains in parallel with intelligent batching
      const batchResults = await this.batchProcessor.processBatch(batchItems);

      // Process results with parallel USD enrichment
      const chains: PortfolioSummary[] = [];
      const allTokens: TokenBalance[] = [];
      let totalValueUSD = 0;
      let successfulChains = 0;
      let totalRequests = targetChains.length;

      // Parallel price enrichment for all successful results
      const enrichmentPromises = batchResults
        .filter(result => result.success && result.data)
        .map(async (result) => {
          const chainId = result.metadata.chainId!;
          const enriched = await getPriceService().enrichBalances(chainId, result.data!);
          return { chainId, enriched, result };
        });

      const enrichmentResults = await Promise.allSettled(enrichmentPromises);

      for (const enrichmentResult of enrichmentResults) {
        if (enrichmentResult.status === 'fulfilled') {
          const { chainId, enriched, result } = enrichmentResult.value;
          successfulChains++;

            // Calculate chain total in USD using precise decimal arithmetic
            const chainTotalUSD = enriched.reduce((sum, t) => {
              if (t.balanceUSD && !isNaN(t.balanceUSD)) {
                const currentSum = MoneyUtils.usd(sum);
                const tokenValue = MoneyUtils.usd(t.balanceUSD);
                return currentSum.add(tokenValue).toNumber();
              }
              return sum;
            }, 0);

          // Calculate chain total in USD using precise decimal arithmetic
          const chainTotalUSD = enriched.reduce((sum, t) => {
            if (t.balanceUSD && !isNaN(t.balanceUSD)) {
              const currentSum = MoneyUtils.usd(sum);
              const tokenValue = MoneyUtils.usd(t.balanceUSD);
              return currentSum.add(tokenValue).toNumber();
            }
            return sum;
          }, 0);

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

          // Add to total using precise decimal arithmetic
          const currentTotal = MoneyUtils.usd(totalValueUSD);
          const chainValue = MoneyUtils.usd(chainTotalUSD);
          totalValueUSD = currentTotal.add(chainValue).toNumber();
        }
      }

      // Calculate diversification score (simplified)
      const diversificationScore = this.calculateDiversificationScore(allTokens);

      // Top tokens by USD value (fallback to balance if no USD) using precise sorting
      const topTokens = allTokens
        .filter(t => !t.token.isNative)
        .sort((a, b) => {
          const aValue = a.balanceUSD
            ? MoneyUtils.usd(a.balanceUSD)
            : MoneyUtils.crypto(parseFloat(a.balanceFormatted));
          const bValue = b.balanceUSD
            ? MoneyUtils.usd(b.balanceUSD)
            : MoneyUtils.crypto(parseFloat(b.balanceFormatted));
          return bValue.compare(aValue);
        })
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

      // Cache the result in both Redis and memory
      await redisManager.set(cacheKey, portfolio, 3600); // 1 hour
      this.setMemoryCache(cacheKey, portfolio, 300); // 5 minutes

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

    // Use concurrency limiter if enabled
    if (this.managerConfig.concurrency?.enabled) {
      const result = await executeWithConcurrencyLimit(
        () => provider.getTransaction(hash),
        provider.name,
        chainId,
        this.managerConfig.concurrency?.retryConfig
      );

      if (result.success && result.data) {
        // Track cost - note that ProviderResult doesn't have cost metadata
        // This would be added by the actual provider response

        return {
          success: true,
          data: result.data,
          metadata: {
            provider: provider.name,
            chainId,
            timestamp: Date.now(),
            requestId: 'concurrency_limited',
            attempts: result.metadata.attempts,
            totalTime: result.metadata.totalTime,
          },
        };
      } else {
        return {
          success: false,
          error: {
            code: result.error?.code || 'PROVIDER_ERROR',
            message: result.error?.message || 'Unknown error',
          },
          metadata: {
            provider: provider.name,
            chainId,
            timestamp: Date.now(),
            requestId: 'concurrency_limited_error',
            attempts: result.metadata.attempts,
            totalTime: result.metadata.totalTime,
          },
        };
      }
    }

    // Fallback to original implementation
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
   * Get concurrency limit from environment variables or use default
   */
  private getConcurrencyFromEnv(): number {
    const envConcurrency = process.env.CHAIN_MANAGER_CONCURRENCY;
    if (envConcurrency) {
      const parsed = parseInt(envConcurrency, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return this.managerConfig.maxConcurrentRequests || 10;
  }

  /**
   * Get concurrency limiter statistics
   */
  getConcurrencyStats() {
    return this.concurrencyLimiter.getStats();
  }

  /**
   * Get from memory cache
   */
  private getFromMemoryCache(key: string): MultiChainPortfolio | null {
    const cached = this.portfolioCache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }
    if (cached) {
      this.portfolioCache.delete(key); // Remove expired entry
    }
    return null;
  }

  /**
   * Set memory cache with expiration
   */
  private setMemoryCache(key: string, data: MultiChainPortfolio, ttlSeconds: number): void {
    const expires = Date.now() + (ttlSeconds * 1000);
    this.portfolioCache.set(key, { data, expires });
  }

  /**
   * Get chain priority for batch processing ordering
   */
  private getChainPriority(chainId: ChainId): number {
    // Prioritize commonly used chains for faster user experience
    const priorities: Record<ChainId, number> = {
      [ChainId.ETHEREUM]: 10,
      [ChainId.POLYGON]: 9,
      [ChainId.ARBITRUM]: 8,
      [ChainId.OPTIMISM]: 7,
      [ChainId.BASE]: 6,
      [ChainId.BSC]: 5,
      [ChainId.AVALANCHE]: 4,
      [ChainId.FANTOM]: 3,
      [ChainId.SOLANA]: 8, // High priority for Solana
    };
    return priorities[chainId] || 1;
  }

  /**
   * Start cache cleanup for memory cache
   */
  private startCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [key, cached] of this.portfolioCache.entries()) {
        if (cached.expires <= now) {
          this.portfolioCache.delete(key);
        }
      }
    }, 300000); // Clean every 5 minutes
  }

  /**
   * Get batch processor statistics
   */
  getBatchProcessorStats() {
    return this.batchProcessor.getStats();
  }

  /**
   * Get memory cache statistics
   */
  getMemoryCacheStats() {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;
    
    for (const cached of this.portfolioCache.values()) {
      if (cached.expires > now) {
        validEntries++;
      } else {
        expiredEntries++;
      }
    }

    return {
      totalEntries: this.portfolioCache.size,
      validEntries,
      expiredEntries,
      memoryUsageApprox: this.portfolioCache.size * 1024 // Rough estimate
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

      // Clear concurrency limiter
      this.concurrencyLimiter.clear();

      // Clear internal state
      this.providers.clear();
      this.providerHealth.clear();
      this.costTracker.clear();
      this.requestStats.clear();
      this.portfolioCache.clear();

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
    maxConcurrentRequests: parseInt(process.env.CHAIN_MANAGER_CONCURRENCY || '10', 10),
    costTracking: {
      enabled: config.costs.trackingEnabled,
      monthlyBudget: config.costs.monthlyBudget,
      alertThreshold: config.costs.alertThreshold,
    },
    concurrency: {
      enabled: config.concurrency.enabled,
      retryConfig: config.concurrency.retryConfig,
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
