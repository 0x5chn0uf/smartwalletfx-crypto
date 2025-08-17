import { logger } from '../../utils/logger';
import { Config } from '../../config';
import { RuntimeModule, ModuleHealth } from './RuntimeModule';
import { DatabaseModule } from './DatabaseModule';
import { ChainModule } from './ChainModule';
import { EventModule } from './EventModule';
import { ServiceModule } from './ServiceModule';
import type { ServiceDependencies } from '../interfaces';

export interface ModuleRegistry {
  database: DatabaseModule;
  chain: ChainModule;
  events: EventModule;
  services: ServiceModule;
}

export class RuntimeOrchestrator {
  private modules: ModuleRegistry;
  private initializationOrder: (keyof ModuleRegistry)[] = ['database', 'chain', 'events', 'services'];

  constructor() {
    this.modules = {
      database: new DatabaseModule(),
      chain: new ChainModule(),
      events: new EventModule(),
      services: new ServiceModule(),
    };
  }

  async start(config: Config): Promise<ServiceDependencies> {
    logger.info('🚀 Starting runtime modules...');

    try {
      for (const moduleName of this.initializationOrder) {
        const module = this.modules[moduleName];
        await this.initializeModule(module, config);
      }

      logger.info('🎯 All runtime modules started successfully!');
      
      return this.assembleDependencies(config);
    } catch (error) {
      logger.error('❌ Failed to start runtime modules:', error);
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    logger.info('🛑 Stopping runtime modules...');

    // Stop modules in reverse order
    const stopOrder = [...this.initializationOrder].reverse();
    
    for (const moduleName of stopOrder) {
      const module = this.modules[moduleName];
      try {
        await module.stop();
      } catch (error) {
        logger.error(`Error stopping ${module.name} module:`, error);
      }
    }

    logger.info('✅ All runtime modules stopped');
  }

  getHealthStatus(): Record<string, ModuleHealth> {
    const health: Record<string, ModuleHealth> = {};
    
    for (const [name, module] of Object.entries(this.modules)) {
      health[name] = module.getHealthStatus();
    }
    
    return health;
  }

  private async initializeModule(module: RuntimeModule, config: Config): Promise<void> {
    // Check dependencies
    const dependencies = module.getDependencies();
    for (const depName of dependencies) {
      const depModule = this.modules[depName as keyof ModuleRegistry];
      if (!depModule || !depModule.getHealthStatus().isHealthy) {
        throw new Error(`Module ${module.name} requires ${depName} to be healthy`);
      }
    }

    // Initialize based on module type
    if (module instanceof ServiceModule) {
      const eventBus = this.modules.events.getEventBus();
      await module.initialize(config, eventBus);
    } else {
      await module.initialize(config);
    }
  }

  private assembleDependencies(config: Config): ServiceDependencies {
    const chainManager = this.modules.chain.getChainManager();
    const eventBus = this.modules.events.getEventBus();
    const services = this.modules.services.getServices();

    return {
      chainManager,
      solanaProvider: services.solanaProvider,
      defiPort: services.defiPort,
      nftPort: services.nftPort,
      solanaPort: services.solanaPort,
      eventBus,
      priceService: services.priceService,
      asyncPortfolioService: services.asyncPortfolioService,
      costTracker: services.costTracker,
      cacheManager: services.cacheManager,
      runtimeConfig: config,
    };
  }
}