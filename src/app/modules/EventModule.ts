import { logger } from '../../utils/logger';
import { EventBusFactory } from '../../events/EventBusFactory';
import { Config } from '../../config';
import { BaseRuntimeModule, ModuleHealth } from './RuntimeModule';
import type { EventBusPort } from '../../ports/EventBusPort';

export class EventModule extends BaseRuntimeModule {
  name = 'events';
  private eventBus?: EventBusPort;

  async initialize(config: Config): Promise<void> {
    logger.info('📨 Creating event bus...');
    this.eventBus = EventBusFactory.create(config.eventBus?.type || 'memory', {});
    await this.eventBus.initialize();
    this.isInitialized = true;
    logger.info('✅ Event bus initialized');
  }

  async stop(): Promise<void> {
    if (!this.isInitialized || !this.eventBus) return;
    
    logger.info('📨 Stopping event bus...');
    if (typeof this.eventBus.shutdown === 'function') {
      await this.eventBus.shutdown();
    }
    this.isInitialized = false;
    logger.info('✅ Event bus stopped');
  }

  getHealthStatus(): ModuleHealth {
    this.lastHealthCheck = new Date();
    const isHealthy = this.isInitialized && this.eventBus !== undefined;
    
    return {
      isHealthy,
      message: isHealthy ? 'Event bus running' : 'Event bus not initialized',
      lastCheck: this.lastHealthCheck,
    };
  }

  getEventBus(): EventBusPort {
    if (!this.eventBus) {
      throw new Error('Event bus not initialized');
    }
    return this.eventBus;
  }
}