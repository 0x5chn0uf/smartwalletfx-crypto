import { logger } from '../utils/logger';
import { Config } from '../config';
import { RuntimeOrchestrator } from './modules/RuntimeOrchestrator';
import {
  ServiceDependencies,
  Runtime as RuntimeInterface,
  RuntimeHealthStatus,
  RuntimeState,
} from './interfaces';

class CryptoDataRuntime implements RuntimeInterface {
  private state: RuntimeState = 'uninitialized';
  private _dependencies: ServiceDependencies | null = null;
  private startTime: Date | null = null;
  private _config!: Config;
  private orchestrator: RuntimeOrchestrator;

  constructor() {
    this.orchestrator = new RuntimeOrchestrator();
  }

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

      // Use orchestrator to manage module initialization
      this._dependencies = await this.orchestrator.start(config);

      this.state = 'running';

      logger.info('🎯 Crypto Data Runtime started successfully!');
      logger.info(`📈 Runtime uptime tracking started`);
      logger.info(`🔧 Environment: ${config.server.nodeEnv}`);
      logger.info(
        `💰 Cost tracking: ${config.costs.trackingEnabled ? 'enabled' : 'disabled'}`
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

      // Use orchestrator to manage graceful shutdown
      await this.orchestrator.stop();

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
      const moduleHealthStatus = this.orchestrator.getHealthStatus();
      
      const services = {
        redis: moduleHealthStatus.database?.isHealthy || false,
        chainManager: moduleHealthStatus.chain?.isHealthy || false,
        eventBus: moduleHealthStatus.events?.isHealthy || false,
        defi: moduleHealthStatus.services?.isHealthy || false,
        nft: moduleHealthStatus.services?.isHealthy || false,
        solana: moduleHealthStatus.services?.isHealthy || false,
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