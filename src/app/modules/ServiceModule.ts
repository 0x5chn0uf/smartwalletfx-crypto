import { logger } from '../../utils/logger';
import { Config } from '../../config';
import { BaseRuntimeModule, ModuleHealth } from './RuntimeModule';
import { DeFiOrchestrator } from '../../services/defi/DeFiOrchestrator';
import { NFTOrchestrator, nftOrchestrator } from '../../services/nft/NFTOrchestrator';
import { SolanaOrchestrator } from '../../services/defi/SolanaOrchestrator';
import { SolanaProvider } from '../../services/providers/SolanaProvider';
import { AsyncPortfolioService } from '../../services/AsyncPortfolioService';
import { getPriceService } from '../../services/pricing/PriceService';
import { getCostTracker } from '../../services/cost/CostTracker';
import { getCacheManager } from '../../services/cache/CacheManager';
import { initializeDeFiServices } from '../../services/defi';
import { initializeNFTServices } from '../../services/nft';
import { CHAIN_CONFIGS } from '../../types/blockchain';
import { SolanaProtocol } from '../../types/solana-defi';
import type { DeFiPort } from '../../ports/DeFiPort';
import type { NFTPort } from '../../ports/NFTPort';
import type { SolanaPort } from '../../ports/SolanaPort';
import type { EventBusPort } from '../../ports/EventBusPort';

export interface ServiceModuleDependencies {
  defiPort: DeFiPort;
  nftPort: NFTPort;
  solanaPort: SolanaPort;
  solanaProvider: SolanaProvider;
  priceService: any;
  asyncPortfolioService: AsyncPortfolioService;
  costTracker: any;
  cacheManager: any;
}

export class ServiceModule extends BaseRuntimeModule {
  name = 'services';
  private services?: ServiceModuleDependencies;

  getDependencies(): string[] {
    return ['database', 'chain', 'events'];
  }

  async initialize(config: Config, eventBus: EventBusPort): Promise<void> {
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
      maxConcurrentRequests: config.performance.maxConcurrentRequests || 10,
      defaultCacheTtl: config.cache.ttl.medium,
      healthCheckInterval: config.healthCheck.interval,
      fallbackToCache: true,
      rpcUrls,
    });
    await defiOrchestrator.initialize();
    logger.info('✅ DeFi services initialized');

    // Initialize NFT Services
    logger.info('🖼️  Initializing NFT detection services...');
    await initializeNFTServices();
    logger.info('✅ NFT services initialized');

    // Initialize Price Service
    logger.info('💰 Initializing price service...');
    const priceService = getPriceService();
    logger.info('✅ Price service initialized');

    // Initialize Async Portfolio Service
    logger.info('📊 Initializing async portfolio service...');
    const asyncPortfolioService = new AsyncPortfolioService(eventBus);
    logger.info('✅ Async portfolio service initialized');

    // Initialize Solana Services
    logger.info('⚡ Initializing Solana services...');
    const solanaConfig = config.chains.solana || {};
    const solanaProvider = new SolanaProvider(
      solanaConfig.rpcUrl || 'https://api.mainnet-beta.solana.com'
    );
    await solanaProvider.initialize();

    const solanaOrchestrator = new SolanaOrchestrator({
      rpcUrl: solanaConfig.rpcUrl || 'https://api.mainnet-beta.solana.com',
      heliusApiKey: config.apiKeys.helius,
      enabledProtocols: [SolanaProtocol.JUPITER, SolanaProtocol.RAYDIUM, SolanaProtocol.ORCA],
      cacheSettings: {
        portfolio: config.cache.ttl.medium,
        analytics: config.cache.ttl.long,
        crossChain: config.cache.ttl.medium,
      },
      performance: {
        maxConcurrentRequests: 10,
        timeoutMs: 30000,
        retryAttempts: 3,
      },
    });
    await solanaOrchestrator.initialize();
    logger.info('✅ Solana services initialized');

    // Initialize utility services
    logger.info('💵 Initializing cost tracker...');
    const costTracker = getCostTracker();
    logger.info('✅ Cost tracker initialized');

    logger.info('🗄️ Initializing cache manager...');
    const cacheManager = getCacheManager();
    logger.info('✅ Cache manager initialized');

    // Create ports
    const defiPort: DeFiPort = defiOrchestrator as unknown as DeFiPort;
    const nftPort: NFTPort = nftOrchestrator as unknown as NFTPort;
    const solanaPort: SolanaPort = solanaOrchestrator as unknown as SolanaPort;

    this.services = {
      defiPort,
      nftPort,
      solanaPort,
      solanaProvider,
      priceService,
      asyncPortfolioService,
      costTracker,
      cacheManager,
    };

    this.isInitialized = true;
  }

  async stop(): Promise<void> {
    if (!this.isInitialized || !this.services) return;
    
    logger.info('🛠️ Stopping services...');
    // Service-specific cleanup logic would go here
    this.isInitialized = false;
    logger.info('✅ Services stopped');
  }

  getHealthStatus(): ModuleHealth {
    this.lastHealthCheck = new Date();
    
    if (!this.isInitialized || !this.services) {
      return {
        isHealthy: false,
        message: 'Services not initialized',
        lastCheck: this.lastHealthCheck,
      };
    }

    try {
      const defiHealthy = Object.values(this.services.defiPort.getHealthStatus()).some((h: any) => h?.isHealthy);
      const solanaHealthy = (this.services.solanaProvider as any).isHealthy?.() || true;
      
      const isHealthy = defiHealthy && solanaHealthy;
      
      return {
        isHealthy,
        message: isHealthy ? 'All services healthy' : 'Some services degraded',
        lastCheck: this.lastHealthCheck,
      };
    } catch (error) {
      return {
        isHealthy: false,
        message: `Health check failed: ${error}`,
        lastCheck: this.lastHealthCheck,
      };
    }
  }

  getServices(): ServiceModuleDependencies {
    if (!this.services) {
      throw new Error('Services not initialized');
    }
    return this.services;
  }
}