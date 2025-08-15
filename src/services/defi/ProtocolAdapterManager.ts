/**
 * Protocol Adapter Manager
 * 
 * Manages the lifecycle and discovery of DeFi protocol adapters.
 * Handles dynamic loading, health monitoring, and adapter coordination.
 */

import { logger } from '@/utils/logger';
import { EventEmitter } from 'events';
import {
  ProtocolAdapter,
  DeFiProtocol,
  ChainId,
  ProtocolHealth,
  DeFiPosition
} from '@/types/defi';
import { createAaveV3Adapter } from './adapters/AaveV3Adapter';
import { createUniswapV3Adapter } from './adapters/UniswapV3Adapter';
import { createCurveAdapter } from './adapters/CurveAdapter';
import { createCompoundV3Adapter } from './adapters/CompoundV3Adapter';
import { createYearnAdapter } from './adapters/YearnAdapter';

export interface AdapterManagerConfig {
  enabledProtocols: DeFiProtocol[];
  healthCheckIntervalMs: number;
  maxRetries: number;
  retryDelayMs: number;
  enableAutoRecovery: boolean;
  rpcUrls: Partial<Record<ChainId, string>>;
}

export interface AdapterInfo {
  adapter: ProtocolAdapter;
  isEnabled: boolean;
  isHealthy: boolean;
  lastHealthCheck: number;
  errorCount: number;
  lastError?: string;
}

export class ProtocolAdapterManager extends EventEmitter {
  private readonly adapters = new Map<DeFiProtocol, AdapterInfo>();
  private readonly adapterFactory = new Map<DeFiProtocol, () => ProtocolAdapter>();
  private healthCheckInterval?: NodeJS.Timeout;
  private isInitialized = false;

  constructor(
    private readonly config: AdapterManagerConfig
  ) {
    super();
    this.registerAdapterFactories();
    this.setupEventHandlers();
  }

  /**
   * Initialize the adapter manager and load all enabled adapters
   */
  async initialize(): Promise<void> {
    logger.info('Initializing Protocol Adapter Manager...');

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
          logger.info(`Successfully loaded adapter for ${protocol}`);
        } else {
          failureCount++;
          logger.error(`Failed to load adapter for ${protocol}:`, result.reason);
        }
      });

      // Start health monitoring
      if (this.config.healthCheckIntervalMs > 0) {
        this.startHealthMonitoring();
      }

      this.isInitialized = true;
      logger.info(
        `Protocol Adapter Manager initialized: ${successCount} adapters loaded, ${failureCount} failed`
      );

      this.emit('initialized', {
        totalAdapters: this.adapters.size,
        successCount,
        failureCount
      });

    } catch (error) {
      logger.error('Failed to initialize Protocol Adapter Manager:', error);
      throw error;
    }
  }

  /**
   * Load a specific protocol adapter
   */
  async loadAdapter(protocol: DeFiProtocol): Promise<void> {
    if (this.adapters.has(protocol)) {
      logger.debug(`Adapter for ${protocol} already loaded`);
      return;
    }

    const factory = this.adapterFactory.get(protocol);
    if (!factory) {
      throw new Error(`No factory registered for protocol ${protocol}`);
    }

    try {
      logger.debug(`Loading adapter for ${protocol}...`);
      
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
        const isHealthy = await adapter.isHealthy();
        const health = adapter.getHealth();
        adapterInfo.isHealthy = isHealthy;
        adapterInfo.lastHealthCheck = Date.now();
        
        if (!isHealthy) {
          adapterInfo.lastError = health.issues?.join(', ') || 'Unknown health issue';
        }
      } catch (error) {
        adapterInfo.lastError = error instanceof Error ? error.message : 'Health check failed';
        logger.warn(`Initial health check failed for ${protocol}:`, error);
      }

      this.adapters.set(protocol, adapterInfo);
      this.emit('adapterLoaded', protocol, adapterInfo);

    } catch (error) {
      logger.error(`Failed to load adapter for ${protocol}:`, error);
      throw error;
    }
  }

  /**
   * Unload a specific protocol adapter
   */
  async unloadAdapter(protocol: DeFiProtocol): Promise<void> {
    const adapterInfo = this.adapters.get(protocol);
    if (!adapterInfo) {
      logger.debug(`Adapter for ${protocol} not loaded`);
      return;
    }

    try {
      // Cleanup any resources if the adapter supports it
      if ('cleanup' in adapterInfo.adapter && typeof adapterInfo.adapter.cleanup === 'function') {
        await (adapterInfo.adapter as any).cleanup();
      }

      this.adapters.delete(protocol);
      this.emit('adapterUnloaded', protocol);
      logger.info(`Unloaded adapter for ${protocol}`);

    } catch (error) {
      logger.error(`Failed to unload adapter for ${protocol}:`, error);
      throw error;
    }
  }

  /**
   * Get a specific protocol adapter
   */
  getAdapter(protocol: DeFiProtocol): ProtocolAdapter | null {
    const adapterInfo = this.adapters.get(protocol);
    return adapterInfo?.isEnabled ? adapterInfo.adapter : null;
  }

  /**
   * Get all active adapters
   */
  getAllAdapters(): ProtocolAdapter[] {
    return Array.from(this.adapters.values())
      .filter(info => info.isEnabled)
      .map(info => info.adapter);
  }

  /**
   * Get adapters that support a specific chain
   */
  getAdaptersForChain(chainId: ChainId): ProtocolAdapter[] {
    return this.getAllAdapters().filter(adapter =>
      adapter.supportedChains.includes(chainId)
    );
  }

  /**
   * Get health status of all adapters
   */
  getHealthStatus(): Map<DeFiProtocol, ProtocolHealth> {
    const healthMap = new Map<DeFiProtocol, ProtocolHealth>();

    for (const [protocol, adapterInfo] of this.adapters) {
      healthMap.set(protocol, {
        isHealthy: adapterInfo.isHealthy,
        lastCheckedAt: new Date(adapterInfo.lastHealthCheck),
        responseTime: 0, // Would be tracked separately
        errorRate: this.calculateErrorRate(adapterInfo),
        uptime: adapterInfo.isHealthy ? 100 : 0,
        issues: adapterInfo.lastError ? [adapterInfo.lastError] : []
      });
    }

    return healthMap;
  }

  /**
   * Enable a specific protocol adapter
   */
  enableAdapter(protocol: DeFiProtocol): void {
    const adapterInfo = this.adapters.get(protocol);
    if (adapterInfo) {
      adapterInfo.isEnabled = true;
      logger.info(`Enabled adapter for ${protocol}`);
      this.emit('adapterEnabled', protocol);
    } else {
      throw new Error(`Adapter for ${protocol} not found`);
    }
  }

  /**
   * Disable a specific protocol adapter
   */
  disableAdapter(protocol: DeFiProtocol): void {
    const adapterInfo = this.adapters.get(protocol);
    if (adapterInfo) {
      adapterInfo.isEnabled = false;
      logger.info(`Disabled adapter for ${protocol}`);
      this.emit('adapterDisabled', protocol);
    } else {
      throw new Error(`Adapter for ${protocol} not found`);
    }
  }

  /**
   * Reload a specific protocol adapter
   */
  async reloadAdapter(protocol: DeFiProtocol): Promise<void> {
    logger.info(`Reloading adapter for ${protocol}...`);
    
    try {
      await this.unloadAdapter(protocol);
      await this.loadAdapter(protocol);
      logger.info(`Successfully reloaded adapter for ${protocol}`);
    } catch (error) {
      logger.error(`Failed to reload adapter for ${protocol}:`, error);
      throw error;
    }
  }

  /**
   * Get all positions for an address across all enabled protocols
   */
  async getAllPositions(address: string, chainId?: ChainId): Promise<DeFiPosition[]> {
    const activeAdapters = this.getAllAdapters();
    const positionPromises = activeAdapters.map(async adapter => {
      try {
        return await adapter.getPositions(address, chainId);
      } catch (error) {
        logger.error(`Failed to get positions from ${adapter.protocol}:`, error);
        return [];
      }
    });

    const results = await Promise.allSettled(positionPromises);
    const allPositions: DeFiPosition[] = [];

    results.forEach(result => {
      if (result.status === 'fulfilled') {
        allPositions.push(...result.value);
      }
    });

    return allPositions;
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
          const isHealthy = await adapterInfo.adapter.isHealthy();
          const health = adapterInfo.adapter.getHealth();
          
          const wasHealthy = adapterInfo.isHealthy;
          adapterInfo.isHealthy = isHealthy;
          adapterInfo.lastHealthCheck = Date.now();

          if (isHealthy) {
            adapterInfo.errorCount = Math.max(0, adapterInfo.errorCount - 1);
            adapterInfo.lastError = undefined;

            if (!wasHealthy) {
              logger.info(`Adapter for ${protocol} recovered`);
              this.emit('adapterRecovered', protocol);
            }
          } else {
            adapterInfo.errorCount++;
            adapterInfo.lastError = health.issues?.join(', ') || 'Unknown health issue';

            if (wasHealthy) {
              logger.warn(`Adapter for ${protocol} became unhealthy: ${adapterInfo.lastError}`);
              this.emit('adapterUnhealthy', protocol, adapterInfo.lastError);
            }

            // Auto-recovery attempt
            if (this.config.enableAutoRecovery && adapterInfo.errorCount >= this.config.maxRetries) {
              logger.info(`Attempting auto-recovery for ${protocol}...`);
              await this.attemptRecovery(protocol);
            }
          }

        } catch (error) {
          adapterInfo.isHealthy = false;
          adapterInfo.errorCount++;
          adapterInfo.lastError = error instanceof Error ? error.message : 'Health check error';
          
          logger.error(`Health check failed for ${protocol}:`, error);
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
    logger.info('Shutting down Protocol Adapter Manager...');

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
    
    logger.info('Protocol Adapter Manager shut down');
  }

  // Private helper methods

  private registerAdapterFactories(): void {
    // Register factory functions for each adapter type
    this.adapterFactory.set(DeFiProtocol.AAVE_V3, () => 
      createAaveV3Adapter(this.config.rpcUrls)
    );

    this.adapterFactory.set(DeFiProtocol.UNISWAP_V3, () => 
      createUniswapV3Adapter(this.config.rpcUrls)
    );

    this.adapterFactory.set(DeFiProtocol.CURVE, () => 
      createCurveAdapter(this.config.rpcUrls)
    );

    this.adapterFactory.set(DeFiProtocol.COMPOUND_V3, () => 
      createCompoundV3Adapter(this.config.rpcUrls)
    );

    this.adapterFactory.set(DeFiProtocol.YEARN, () => 
      createYearnAdapter(this.config.rpcUrls)
    );
  }

  private setupEventHandlers(): void {
    this.on('adapterError', (protocol: DeFiProtocol, error: Error) => {
      logger.error(`Adapter error for ${protocol}:`, error);
    });

    this.on('adapterUnhealthy', (protocol: DeFiProtocol, error?: string) => {
      logger.warn(`Adapter ${protocol} is unhealthy: ${error || 'Unknown error'}`);
    });

    this.on('adapterRecovered', (protocol: DeFiProtocol) => {
      logger.info(`Adapter ${protocol} has recovered`);
    });
  }

  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(
      () => {
        this.performHealthCheck().catch(error => {
          logger.error('Health check interval failed:', error);
        });
      },
      this.config.healthCheckIntervalMs
    );

    logger.info(`Health monitoring started (interval: ${this.config.healthCheckIntervalMs}ms)`);
  }

  private async attemptRecovery(protocol: DeFiProtocol): Promise<void> {
    try {
      logger.info(`Attempting recovery for ${protocol}...`);
      
      // Wait for retry delay
      await new Promise(resolve => setTimeout(resolve, this.config.retryDelayMs));
      
      // Try reloading the adapter
      await this.reloadAdapter(protocol);
      
      logger.info(`Recovery successful for ${protocol}`);
      this.emit('adapterRecoverySuccess', protocol);

    } catch (error) {
      logger.error(`Recovery failed for ${protocol}:`, error);
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

// Factory function to create ProtocolAdapterManager
export const createProtocolAdapterManager = (config: AdapterManagerConfig): ProtocolAdapterManager => {
  return new ProtocolAdapterManager(config);
};