import { logger } from '../../utils/logger';
import { getSimpleChainManager, SimpleChainManager } from '../../services/SimpleChainManager';
import { Config } from '../../config';
import { BaseRuntimeModule, ModuleHealth } from './RuntimeModule';

export class ChainModule extends BaseRuntimeModule {
  name = 'chain';
  private chainManager?: SimpleChainManager;

  getDependencies(): string[] {
    return ['database'];
  }

  async initialize(config: Config): Promise<void> {
    logger.info('🔗 Initializing blockchain providers...');
    
    const chainManagerConfig = {
      providers: {
        alchemy: {
          ethereum: config.apiKeys.alchemy,
          polygon: config.apiKeys.alchemy,
          arbitrum: config.apiKeys.alchemy,
          optimism: config.apiKeys.alchemy,
          base: config.apiKeys.alchemy,
        },
        rpc: {},
        solana: {
          mainnet: config.chains.solana?.rpcUrl || 'https://api.mainnet-beta.solana.com',
        },
      },
      healthCheck: {
        interval: config.healthCheck.interval,
        timeout: config.healthCheck.timeout,
      },
    };
    
    this.chainManager = getSimpleChainManager(chainManagerConfig);
    await this.chainManager.initialize();

    const healthStatus = this.chainManager.getHealthStatus();
    logger.info(
      `✅ Chain providers initialized: ${healthStatus.healthyProviders}/${healthStatus.totalProviders} healthy`
    );

    if (healthStatus.healthyProviders === 0) {
      logger.warn('⚠️  No healthy providers available. Service may have limited functionality.');
    }

    this.isInitialized = true;
  }

  async stop(): Promise<void> {
    if (!this.isInitialized || !this.chainManager) return;
    
    logger.info('🔗 Stopping chain manager...');
    // ChainManager stop logic if available
    this.isInitialized = false;
    logger.info('✅ Chain manager stopped');
  }

  getHealthStatus(): ModuleHealth {
    this.lastHealthCheck = new Date();
    
    if (!this.isInitialized || !this.chainManager) {
      return {
        isHealthy: false,
        message: 'Chain manager not initialized',
        lastCheck: this.lastHealthCheck,
      };
    }

    const healthStatus = this.chainManager.getHealthStatus();
    const isHealthy = healthStatus.healthyProviders > 0;
    
    return {
      isHealthy,
      message: `${healthStatus.healthyProviders}/${healthStatus.totalProviders} providers healthy`,
      lastCheck: this.lastHealthCheck,
    };
  }

  getChainManager(): SimpleChainManager {
    if (!this.chainManager) {
      throw new Error('Chain manager not initialized');
    }
    return this.chainManager;
  }
}