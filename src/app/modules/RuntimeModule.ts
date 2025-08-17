import { Config } from '../../config';

export interface ModuleHealth {
  isHealthy: boolean;
  message?: string;
  lastCheck: Date;
}

export interface RuntimeModule {
  name: string;
  initialize(config: Config, ...args: any[]): Promise<void>;
  stop(): Promise<void>;
  getHealthStatus(): ModuleHealth;
  getDependencies(): string[];
}

export abstract class BaseRuntimeModule implements RuntimeModule {
  protected isInitialized = false;
  protected lastHealthCheck = new Date();
  
  abstract name: string;
  abstract initialize(config: Config, ...args: any[]): Promise<void>;
  abstract stop(): Promise<void>;
  
  getHealthStatus(): ModuleHealth {
    this.lastHealthCheck = new Date();
    return {
      isHealthy: this.isInitialized,
      message: this.isInitialized ? 'Module running' : 'Module not initialized',
      lastCheck: this.lastHealthCheck,
    };
  }
  
  getDependencies(): string[] {
    return [];
  }
}