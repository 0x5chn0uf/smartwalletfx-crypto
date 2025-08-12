/**
 * Protocol Adapter Manager
 * 
 * Manages the lifecycle and discovery of DeFi protocol adapters.
 * Handles dynamic loading, health monitoring, and adapter coordination.
 */

import { Logger } from 'pino';
import { EventEmitter } from 'events';
import {
  IProtocolAdapter,
  ProtocolType,
  ChainId,
  AdapterHealth,
  DeFiProtocolError,
  ProtocolConfig
} from '../../types/defi';
import { AaveV3Adapter } from './adapters/AaveV3Adapter';
import { UniswapV3Adapter } from './adapters/UniswapV3Adapter';
// Import other adapters as they're implemented
// import { CompoundV3Adapter } from './adapters/CompoundV3Adapter';
// import { CurveAdapter } from './adapters/CurveAdapter';
// import { YearnAdapter } from './adapters/YearnAdapter';

export interface AdapterManagerConfig {
  enabledProtocols: ProtocolType[];
  healthCheckIntervalMs: number;
  maxRetries: number;
  retryDelayMs: number;
  enableAutoRecovery: boolean;
}

export interface AdapterInfo {
  adapter: IProtocolAdapter;
  isEnabled: boolean;
  isHealthy: boolean;
  lastHealthCheck: number;
  errorCount: number;
  lastError?: string;
  config?: ProtocolConfig;
}

export class ProtocolAdapterManager extends EventEmitter {
  private readonly adapters = new Map<ProtocolType, AdapterInfo>();
  private readonly adapterFactory = new Map<ProtocolType, () => IProtocolAdapter>();
  private healthCheckInterval?: NodeJS.Timeout;
  private isInitialized = false;

  constructor(
    private readonly logger: Logger,
    private readonly config: AdapterManagerConfig,
    // Dependencies for adapter construction
    private readonly dependencies: {
      rpcProvider: any;
      subgraphClient: any;
      priceService: any;
      contractManager: any;
    }
  ) {
    super();
    this.registerAdapterFactories();
    this.setupEventHandlers();
  }

  /**
   * Initialize the adapter manager and load all enabled adapters
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing Protocol Adapter Manager...');

    try {
      // Load enabled adapters
      const loadPromises = this.config.enabledProtocols.map(protocol =>
        this.loadAdapter(protocol)
      );

      const results = await Promise.allSettled(loadPromises);
      
      let successCount = 0;
      let failureCount = 0;

      results.forEach((result, index) => {
        const protocol = this.config.enabledProtocols[index];
        
        if (result.status === 'fulfilled') {
          successCount++;
          this.logger.info(`Successfully loaded adapter for ${protocol}`);
        } else {
          failureCount++;
          this.logger.error(`Failed to load adapter for ${protocol}:`, result.reason);
        }
      });

      // Start health monitoring
      if (this.config.healthCheckIntervalMs > 0) {
        this.startHealthMonitoring();
      }

      this.isInitialized = true;
      this.logger.info(
        `Protocol Adapter Manager initialized: ${successCount} adapters loaded, ${failureCount} failed`
      );

      this.emit('initialized', {
        totalAdapters: this.adapters.size,
        successCount,
        failureCount
      });

    } catch (error) {
      this.logger.error('Failed to initialize Protocol Adapter Manager:', error);
      throw error;
    }
  }

  /**
   * Load a specific protocol adapter
   */
  async loadAdapter(protocol: ProtocolType): Promise<void> {
    if (this.adapters.has(protocol)) {
      this.logger.debug(`Adapter for ${protocol} already loaded`);
      return;
    }

    const factory = this.adapterFactory.get(protocol);
    if (!factory) {
      throw new Error(`No factory registered for protocol ${protocol}`);
    }

    try {
      this.logger.debug(`Loading adapter for ${protocol}...`);
      
      const adapter = factory();
      const adapterInfo: AdapterInfo = {
        adapter,
        isEnabled: true,
        isHealthy: false,
        lastHealthCheck: 0,
        errorCount: 0
      };

      // Perform initial health check
      try {
        const health = await adapter.getAdapterHealth();
        adapterInfo.isHealthy = health.isHealthy;
        adapterInfo.lastHealthCheck = Date.now();
        
        if (!health.isHealthy) {
          adapterInfo.lastError = health.lastError;
        }
      } catch (error) {
        adapterInfo.lastError = error instanceof Error ? error.message : 'Health check failed';
        this.logger.warn(`Initial health check failed for ${protocol}:`, error);
      }

      this.adapters.set(protocol, adapterInfo);
      this.emit('adapterLoaded', protocol, adapterInfo);

    } catch (error) {
      this.logger.error(`Failed to load adapter for ${protocol}:`, error);
      throw error;
    }
  }

  /**
   * Unload a specific protocol adapter
   */
  async unloadAdapter(protocol: ProtocolType): Promise<void> {
    const adapterInfo = this.adapters.get(protocol);
    if (!adapterInfo) {
      this.logger.debug(`Adapter for ${protocol} not loaded`);
      return;
    }

    try {
      // Cleanup any resources if the adapter supports it
      if ('cleanup' in adapterInfo.adapter && typeof adapterInfo.adapter.cleanup === 'function') {
        await (adapterInfo.adapter as any).cleanup();
      }

      this.adapters.delete(protocol);
      this.emit('adapterUnloaded', protocol);
      this.logger.info(`Unloaded adapter for ${protocol}`);

    } catch (error) {
      this.logger.error(`Failed to unload adapter for ${protocol}:`, error);
      throw error;
    }
  }

  /**
   * Get a specific protocol adapter
   */
  getAdapter(protocol: ProtocolType): IProtocolAdapter | null {
    const adapterInfo = this.adapters.get(protocol);
    return adapterInfo?.isEnabled ? adapterInfo.adapter : null;
  }

  /**
   * Get all active adapters
   */
  getAllAdapters(): IProtocolAdapter[] {
    return Array.from(this.adapters.values())
      .filter(info => info.isEnabled)
      .map(info => info.adapter);
  }

  /**
   * Get adapters that support a specific chain
   */
  getAdaptersForChain(chainId: ChainId): IProtocolAdapter[] {
    return this.getAllAdapters().filter(adapter =>
      adapter.supportedChains.includes(chainId)
    );
  }

  /**
   * Get health status of all adapters
   */
  getHealthStatus(): Map<ProtocolType, AdapterHealth> {
    const healthMap = new Map<ProtocolType, AdapterHealth>();

    for (const [protocol, adapterInfo] of this.adapters) {
      healthMap.set(protocol, {
        isHealthy: adapterInfo.isHealthy,
        lastSuccessfulFetch: adapterInfo.lastHealthCheck,
        errorRate: this.calculateErrorRate(adapterInfo),
        averageResponseTime: 0, // Would be tracked separately
        lastError: adapterInfo.lastError
      });
    }

    return healthMap;
  }

  /**
   * Enable a specific protocol adapter
   */
  enableAdapter(protocol: ProtocolType): void {
    const adapterInfo = this.adapters.get(protocol);
    if (adapterInfo) {
      adapterInfo.isEnabled = true;
      this.logger.info(`Enabled adapter for ${protocol}`);
      this.emit('adapterEnabled', protocol);
    } else {
      throw new Error(`Adapter for ${protocol} not found`);
    }
  }

  /**
   * Disable a specific protocol adapter
   */
  disableAdapter(protocol: ProtocolType): void {
    const adapterInfo = this.adapters.get(protocol);
    if (adapterInfo) {
      adapterInfo.isEnabled = false;
      this.logger.info(`Disabled adapter for ${protocol}`);
      this.emit('adapterDisabled', protocol);
    } else {
      throw new Error(`Adapter for ${protocol} not found`);
    }
  }

  /**
   * Reload a specific protocol adapter
   */
  async reloadAdapter(protocol: ProtocolType): Promise<void> {
    this.logger.info(`Reloading adapter for ${protocol}...`);
    
    try {
      await this.unloadAdapter(protocol);
      await this.loadAdapter(protocol);
      this.logger.info(`Successfully reloaded adapter for ${protocol}`);
    } catch (error) {
      this.logger.error(`Failed to reload adapter for ${protocol}:`, error);
      throw error;
    }
  }

  /**
   * Perform health check on all adapters
   */
  async performHealthCheck(): Promise<void> {
    const healthCheckPromises = Array.from(this.adapters.entries()).map(
      async ([protocol, adapterInfo]) => {
        if (!adapterInfo.isEnabled) {
          return;
        }

        try {
          const health = await adapterInfo.adapter.getAdapterHealth();
          
          const wasHealthy = adapterInfo.isHealthy;
          adapterInfo.isHealthy = health.isHealthy;
          adapterInfo.lastHealthCheck = Date.now();

          if (health.isHealthy) {
            adapterInfo.errorCount = Math.max(0, adapterInfo.errorCount - 1);
            adapterInfo.lastError = undefined;

            if (!wasHealthy) {
              this.logger.info(`Adapter for ${protocol} recovered`);
              this.emit('adapterRecovered', protocol);
            }
          } else {
            adapterInfo.errorCount++;
            adapterInfo.lastError = health.lastError;

            if (wasHealthy) {
              this.logger.warn(`Adapter for ${protocol} became unhealthy: ${health.lastError}`);
              this.emit('adapterUnhealthy', protocol, health.lastError);
            }

            // Auto-recovery attempt
            if (this.config.enableAutoRecovery && adapterInfo.errorCount >= this.config.maxRetries) {
              this.logger.info(`Attempting auto-recovery for ${protocol}...`);
              await this.attemptRecovery(protocol);
            }
          }

        } catch (error) {
          adapterInfo.isHealthy = false;
          adapterInfo.errorCount++;
          adapterInfo.lastError = error instanceof Error ? error.message : 'Health check error';
          
          this.logger.error(`Health check failed for ${protocol}:`, error);
          this.emit('adapterError', protocol, error);
        }
      }
    );

    await Promise.allSettled(healthCheckPromises);
    this.emit('healthCheckCompleted', Date.now());
  }

  /**
   * Shutdown the adapter manager
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down Protocol Adapter Manager...');

    // Stop health monitoring
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    // Unload all adapters
    const unloadPromises = Array.from(this.adapters.keys()).map(protocol =>
      this.unloadAdapter(protocol)
    );

    await Promise.allSettled(unloadPromises);

    this.isInitialized = false;
    this.removeAllListeners();
    
    this.logger.info('Protocol Adapter Manager shut down');
  }

  // Private helper methods

  private registerAdapterFactories(): void {
    // Register factory functions for each adapter type
    this.adapterFactory.set(ProtocolType.AAVE_V3, () => new AaveV3Adapter(
      this.logger,
      this.dependencies.rpcProvider,
      this.dependencies.subgraphClient,
      this.dependencies.priceService,
      this.dependencies.contractManager
    ));

    this.adapterFactory.set(ProtocolType.UNISWAP_V3, () => new UniswapV3Adapter(
      this.logger,
      this.dependencies.rpcProvider,
      this.dependencies.subgraphClient,
      this.dependencies.priceService,
      this.dependencies.contractManager
    ));

    // Additional adapters can be registered here as they're implemented
    /*
    this.adapterFactory.set(ProtocolType.COMPOUND_V3, () => new CompoundV3Adapter(
      this.logger,
      this.dependencies.rpcProvider,
      this.dependencies.subgraphClient,
      this.dependencies.priceService,
      this.dependencies.contractManager
    ));

    this.adapterFactory.set(ProtocolType.CURVE, () => new CurveAdapter(
      this.logger,
      this.dependencies.rpcProvider,
      this.dependencies.subgraphClient,
      this.dependencies.priceService,
      this.dependencies.contractManager
    ));

    this.adapterFactory.set(ProtocolType.YEARN, () => new YearnAdapter(
      this.logger,
      this.dependencies.rpcProvider,
      this.dependencies.subgraphClient,
      this.dependencies.priceService,
      this.dependencies.contractManager
    ));
    */
  }

  private setupEventHandlers(): void {
    this.on('adapterError', (protocol: ProtocolType, error: Error) => {
      this.logger.error(`Adapter error for ${protocol}:`, error);
    });

    this.on('adapterUnhealthy', (protocol: ProtocolType, error?: string) => {
      this.logger.warn(`Adapter ${protocol} is unhealthy: ${error || 'Unknown error'}`);
    });

    this.on('adapterRecovered', (protocol: ProtocolType) => {
      this.logger.info(`Adapter ${protocol} has recovered`);
    });
  }

  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(
      () => {
        this.performHealthCheck().catch(error => {
          this.logger.error('Health check interval failed:', error);
        });
      },
      this.config.healthCheckIntervalMs
    );

    this.logger.info(`Health monitoring started (interval: ${this.config.healthCheckIntervalMs}ms)`);
  }

  private async attemptRecovery(protocol: ProtocolType): Promise<void> {
    try {
      this.logger.info(`Attempting recovery for ${protocol}...`);
      
      // Wait for retry delay
      await new Promise(resolve => setTimeout(resolve, this.config.retryDelayMs));
      
      // Try reloading the adapter
      await this.reloadAdapter(protocol);
      
      this.logger.info(`Recovery successful for ${protocol}`);
      this.emit('adapterRecoverySuccess', protocol);

    } catch (error) {
      this.logger.error(`Recovery failed for ${protocol}:`, error);
      this.emit('adapterRecoveryFailed', protocol, error);
      
      // If recovery fails, disable the adapter to prevent further issues
      this.disableAdapter(protocol);
    }
  }

  private calculateErrorRate(adapterInfo: AdapterInfo): number {
    // Simplified error rate calculation
    // In practice, this would track errors over a time window
    const maxErrors = 10;
    return Math.min(100, (adapterInfo.errorCount / maxErrors) * 100);
  }
}