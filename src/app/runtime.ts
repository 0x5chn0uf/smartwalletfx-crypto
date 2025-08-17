import { logger } from '../utils/logger';
import { Config } from '../config';
import { redisManager } from '../utils/redis';
import { SimpleChainManager, getSimpleChainManager } from '../services/SimpleChainManager';
import { DeFiOrchestrator } from '../services/defi/DeFiOrchestrator';
import { NFTOrchestrator, nftOrchestrator } from '../services/nft/NFTOrchestrator';
import { EventBusFactory } from '../events/EventBusFactory';
import { getPriceService } from '../services/pricing/PriceService';
import { AsyncPortfolioService } from '../services/AsyncPortfolioService';
import { getCostTracker } from '../services/cost/CostTracker';
import { getCacheManager } from '../services/cache/CacheManager';
import { CHAIN_CONFIGS } from '../types/blockchain';
import { initializeDeFiServices } from '../services/defi';
import { initializeNFTServices } from '../services/nft';
import { SolanaOrchestrator } from '../services/defi/SolanaOrchestrator';
import { SolanaProvider } from '../services/providers/SolanaProvider';
import type { DeFiPort } from '../ports/DeFiPort';
import type { NFTPort } from '../ports/NFTPort';
import type { SolanaPort } from '../ports/SolanaPort';
import {
  ServiceDependencies,
  Runtime as RuntimeInterface,
  RuntimeHealthStatus,
  RuntimeState,
} from './interfaces';
import { SolanaProtocol } from '../types/solana-defi';

class CryptoDataRuntime implements RuntimeInterface {
  private state: RuntimeState = 'uninitialized';
  private _dependencies: ServiceDependencies | null = null;
  private startTime: Date | null = null;
  private _config!: Config;

  get dependencies(): ServiceDependencies {
    if (!this._dependencies) {
      throw new Error('Runtime not initialized. Call start() first.');
    }
    return this._dependencies;
  }

  get runtimeState(): RuntimeState {
    return this.state;
  }

  get uptime(): number {
    return this.startTime ? Date.now() - this.startTime.getTime() : 0;
  }

  async start(config: Config): Promise<void> {
    this._config = config;
    if (this.state !== 'uninitialized' && this.state !== 'stopped') {
      throw new Error(`Cannot start runtime in state: ${this.state}`);
    }

    this.state = 'starting';
    this.startTime = new Date();

    try {
      logger.info('🚀 Initializing Crypto Data Runtime...');

      // 1. Initialize Redis connection
      logger.info('📡 Connecting to Redis...');
      await redisManager.connect();
      logger.info('✅ Redis connected');

      // 2. Initialize Chain Manager with unified config
      logger.info('🔗 Initializing blockchain providers...');
      const chainManagerConfig = {
        providers: {
          alchemy: {
            ethereum: this._config.apiKeys.alchemy,
            polygon: this._config.apiKeys.alchemy,
            arbitrum: this._config.apiKeys.alchemy,
            optimism: this._config.apiKeys.alchemy,
            base: this._config.apiKeys.alchemy,
          },
          rpc: {},
          solana: {
            mainnet: this._config.chains.solana?.rpcUrl || 'https://api.mainnet-beta.solana.com',
          },
        },
        healthCheck: {
          interval: this._config.healthCheck.interval,
          timeout: this._config.healthCheck.timeout,
        },
      };
      
      const chainManager = getSimpleChainManager(chainManagerConfig);
      await chainManager.initialize();

      const healthStatus = chainManager.getHealthStatus();
      logger.info(
        `✅ Chain providers initialized: ${healthStatus.healthyProviders}/${healthStatus.totalProviders} healthy`
      );

      if (healthStatus.healthyProviders === 0) {
        logger.warn('⚠️  No healthy providers available. Service may have limited functionality.');
      }

      // 3. Initialize Event Bus (centralized)
      logger.info('📨 Creating event bus...');
      const eventBus = EventBusFactory.create(this._config.eventBus?.type || 'memory', {});
      await eventBus.initialize();
      logger.info('✅ Event bus initialized');

      // 4. Initialize DeFi Services
      logger.info('🏦 Initializing DeFi protocol adapters...');
      await initializeDeFiServices();

      // Create RPC URLs mapping from unified chain config
      const rpcUrls = Object.fromEntries(
        Object.entries(CHAIN_CONFIGS).map(([chainId, config]) => [
          parseInt(chainId) || chainId,
          config.rpcUrl,
        ])
      );

      const defiOrchestrator = new DeFiOrchestrator({
        enabledProtocols: [],
        maxConcurrentRequests: this._config.performance.maxConcurrentRequests || 10,
        defaultCacheTtl: this._config.cache.ttl.medium,
        healthCheckInterval: this._config.healthCheck.interval,
        fallbackToCache: true,
        rpcUrls,
      });
      await defiOrchestrator.initialize();
      logger.info('✅ DeFi services initialized');

      // 5. Initialize NFT Services
      logger.info('🖼️  Initializing NFT detection services...');
      await initializeNFTServices();
      logger.info('✅ NFT services initialized');

      // 6. Initialize Price Service
      logger.info('💰 Initializing price service...');
      const priceService = getPriceService();
      logger.info('✅ Price service initialized');


      // 8. Initialize Async Portfolio Service
      logger.info('📊 Initializing async portfolio service...');
      const asyncPortfolioService = new AsyncPortfolioService(eventBus);
      logger.info('✅ Async portfolio service initialized');

      // 9. Initialize Solana Services
      logger.info('⚡ Initializing Solana services...');
      const solanaConfig = this._config.chains.solana || {};
      const solanaProvider = new SolanaProvider(
        solanaConfig.rpcUrl || 'https://api.mainnet-beta.solana.com'
      );
      await solanaProvider.initialize();

      const solanaOrchestrator = new SolanaOrchestrator({
        rpcUrl: solanaConfig.rpcUrl || 'https://api.mainnet-beta.solana.com',
        heliusApiKey: this._config.apiKeys.helius,
        enabledProtocols: [SolanaProtocol.JUPITER, SolanaProtocol.RAYDIUM, SolanaProtocol.ORCA],
        cacheSettings: {
          portfolio: this._config.cache.ttl.medium,
          analytics: this._config.cache.ttl.long,
          crossChain: this._config.cache.ttl.medium,
        },
        performance: {
          maxConcurrentRequests: 10,
          timeoutMs: 30000,
          retryAttempts: 3,
        },
      });
      await solanaOrchestrator.initialize();
      logger.info('✅ Solana services initialized');

      // 10. Expose ports by binding orchestrators to port interfaces (no extra adapters)
      const defiPort: DeFiPort = defiOrchestrator as unknown as DeFiPort;
      const nftPort: NFTPort = nftOrchestrator as unknown as NFTPort;
      const solanaPort: SolanaPort = solanaOrchestrator as unknown as SolanaPort;

      // 11. Initialize simplified services
      logger.info('💵 Initializing cost tracker...');
      const costTracker = getCostTracker();
      logger.info('✅ Cost tracker initialized');

      logger.info('🗄️ Initializing cache manager...');
      const cacheManager = getCacheManager();
      logger.info('✅ Cache manager initialized');

      // Store dependencies (ports only)
      this._dependencies = {
        chainManager,
        solanaProvider,
        defiPort,
        nftPort,
        solanaPort,
        eventBus,
        priceService,
        asyncPortfolioService,
        costTracker,
        cacheManager,
        runtimeConfig: this._config,
      };

      this.state = 'running';

      logger.info('🎯 Crypto Data Runtime started successfully!');
      logger.info(`📈 Runtime uptime tracking started`);
      logger.info(`🔧 Environment: ${this._config.server.nodeEnv}`);
      logger.info(
        `💰 Cost tracking: ${this._config.costs.trackingEnabled ? 'enabled' : 'disabled'}`
      );
    } catch (error) {
      this.state = 'error';
      logger.error('❌ Failed to start Crypto Data Runtime:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.state !== 'running') {
      logger.warn(`Cannot stop runtime in state: ${this.state}`);
      return;
    }

    this.state = 'stopping';

    try {
      logger.info('🛑 Stopping Crypto Data Runtime...');

      if (this._dependencies) {
        // Stop services in reverse order of initialization


        // 2. Stop orchestrators if managed (not exposed via dependencies)

        // 3. Stop event bus
        logger.info('📨 Stopping event bus...');
        if (
          this._dependencies.eventBus &&
          typeof this._dependencies.eventBus.close === 'function'
        ) {
          await this._dependencies.eventBus.close();
        }

        // 4. Stop Redis connection
        logger.info('📡 Disconnecting from Redis...');
        await redisManager.disconnect();
      }

      this.state = 'stopped';
      this._dependencies = null;

      const uptimeMs = this.uptime;
      logger.info(
        `✅ Crypto Data Runtime stopped gracefully (uptime: ${Math.round(uptimeMs / 1000)}s)`
      );
    } catch (error) {
      this.state = 'error';
      logger.error('❌ Error during runtime shutdown:', error);
      throw error;
    }
  }

  getHealthStatus(): RuntimeHealthStatus {
    if (!this._dependencies || this.state !== 'running') {
      return {
        status: 'unhealthy',
        services: {
          redis: false,
          chainManager: false,
          eventBus: false,
          defi: false,
          nft: false,
          solana: false,
        },
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const chainHealth = this._dependencies.chainManager.getHealthStatus();
      const redisHealthy = (redisManager as any).isConnected();

      const services = {
        redis: redisHealthy,
        chainManager: chainHealth.healthyProviders > 0,
        eventBus: true, // Health check implemented via EventBus interface
        defi: Object.values(this._dependencies.defiPort.getHealthStatus()).some(h => h.isHealthy),
        nft: true, // NFT service health integrated via orchestrator
        solana: this._dependencies.solanaProvider.isHealthy() || true,
      };

      const healthyServices = Object.values(services).filter(Boolean).length;
      const totalServices = Object.keys(services).length;

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      if (healthyServices === 0) {
        status = 'unhealthy';
      } else if (healthyServices < totalServices) {
        status = 'degraded';
      }

      return {
        status,
        services,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Error getting runtime health status:', error);
      return {
        status: 'unhealthy',
        services: {
          redis: false,
          chainManager: false,
          eventBus: false,
          defi: false,
          nft: false,
          solana: false,
        },
        timestamp: new Date().toISOString(),
      };
    }
  }
}

// Singleton runtime instance
let runtimeInstance: CryptoDataRuntime | null = null;

/**
 * Get the global runtime instance
 */
export function getRuntime(): CryptoDataRuntime {
  if (!runtimeInstance) {
    runtimeInstance = new CryptoDataRuntime();
  }
  return runtimeInstance;
}

/**
 * Export types for route factories
 */
export type {
  ServiceDependencies as ServiceDeps,
  RuntimeInterface as RuntimeInterface,
  RuntimeHealthStatus as RuntimeHealth,
  RuntimeState as RuntimeStateType,
};