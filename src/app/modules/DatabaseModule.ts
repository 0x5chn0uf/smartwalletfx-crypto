import { logger } from '../../utils/logger';
import { redisManager } from '../../utils/redis';
import { Config } from '../../config';
import { BaseRuntimeModule, ModuleHealth } from './RuntimeModule';

export class DatabaseModule extends BaseRuntimeModule {
  name = 'database';

  async initialize(config: Config): Promise<void> {
    logger.info('📡 Connecting to Redis...');
    await redisManager.connect();
    this.isInitialized = true;
    logger.info('✅ Redis connected');
  }

  async stop(): Promise<void> {
    if (!this.isInitialized) return;
    
    logger.info('📡 Disconnecting from Redis...');
    await redisManager.disconnect();
    this.isInitialized = false;
    logger.info('✅ Redis disconnected');
  }

  getHealthStatus(): ModuleHealth {
    this.lastHealthCheck = new Date();
    const isHealthy = this.isInitialized && (redisManager as any).isConnected();
    
    return {
      isHealthy,
      message: isHealthy ? 'Redis connected' : 'Redis not connected',
      lastCheck: this.lastHealthCheck,
    };
  }
}