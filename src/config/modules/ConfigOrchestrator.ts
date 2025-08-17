import { logger } from '../../utils/logger';
import { ConfigModule, ValidationResult } from './ConfigModule';
import { ServerConfig, ServerSettings } from './ServerConfig';
import { DatabaseConfig, DatabaseSettings } from './DatabaseConfig';
import { CacheConfig, CacheSettings } from './CacheConfig';
import { SecurityConfig, SecuritySettings } from './SecurityConfig';

export interface OrchestatedConfig {
  server: ServerSettings;
  database: DatabaseSettings;
  cache: CacheSettings;
  security: SecuritySettings;
}

export interface ModuleRegistry {
  server: ServerConfig;
  database: DatabaseConfig;
  cache: CacheConfig;
  security: SecurityConfig;
}

export class ConfigOrchestrator {
  private modules: ModuleRegistry;
  private config?: OrchestatedConfig;

  constructor() {
    this.modules = {
      server: new ServerConfig(),
      database: new DatabaseConfig(),
      cache: new CacheConfig(),
      security: new SecurityConfig(),
    };
  }

  async initialize(): Promise<OrchestatedConfig> {
    logger.info('🔧 Initializing configuration modules...');

    try {
      // Load secrets for modules that need them
      await this.modules.database.loadSecrets();
      await this.modules.security.loadSecrets();

      // Validate all modules
      const validationResults = await this.validateAllModules();
      
      // Check for critical errors
      const hasErrors = Object.values(validationResults).some(result => !result.isValid);
      if (hasErrors) {
        this.logValidationResults(validationResults);
        throw new Error('Configuration validation failed');
      }

      // Load configuration from all modules
      this.config = {
        server: this.modules.server.load(),
        database: this.modules.database.load(),
        cache: this.modules.cache.load(),
        security: this.modules.security.load(),
      };

      // Log warnings
      this.logValidationResults(validationResults);

      logger.info('✅ Configuration modules initialized successfully');
      return this.config;

    } catch (error) {
      logger.error('❌ Failed to initialize configuration modules:', error);
      throw error;
    }
  }

  private async validateAllModules(): Promise<Record<string, ValidationResult>> {
    const results: Record<string, ValidationResult> = {};

    for (const [name, module] of Object.entries(this.modules)) {
      try {
        results[name] = module.validate();
      } catch (error) {
        results[name] = {
          isValid: false,
          errors: [`Validation failed: ${error}`],
          warnings: [],
        };
      }
    }

    return results;
  }

  private logValidationResults(results: Record<string, ValidationResult>): void {
    for (const [moduleName, result] of Object.entries(results)) {
      if (result.errors.length > 0) {
        logger.error(`Configuration errors in ${moduleName}:`, {
          errors: result.errors,
        });
      }

      if (result.warnings.length > 0) {
        logger.warn(`Configuration warnings in ${moduleName}:`, {
          warnings: result.warnings,
        });
      }
    }
  }

  getConfig(): OrchestatedConfig {
    if (!this.config) {
      throw new Error('Configuration not initialized. Call initialize() first.');
    }
    return this.config;
  }

  getModule<K extends keyof ModuleRegistry>(name: K): ModuleRegistry[K] {
    return this.modules[name];
  }

  async reloadModule(moduleName: keyof ModuleRegistry): Promise<void> {
    logger.info(`🔄 Reloading configuration module: ${moduleName}`);

    try {
      const module = this.modules[moduleName];
      
      // Reload secrets if needed
      if ('loadSecrets' in module && typeof module.loadSecrets === 'function') {
        await (module as any).loadSecrets();
      }

      // Validate the module
      const validationResult = module.validate();
      if (!validationResult.isValid) {
        logger.error(`Failed to reload ${moduleName}:`, validationResult.errors);
        throw new Error(`Configuration validation failed for ${moduleName}`);
      }

      // Update the config
      if (this.config) {
        (this.config as any)[moduleName] = module.load();
      }

      // Log warnings
      if (validationResult.warnings.length > 0) {
        logger.warn(`Configuration warnings in ${moduleName}:`, validationResult.warnings);
      }

      logger.info(`✅ Configuration module ${moduleName} reloaded successfully`);
    } catch (error) {
      logger.error(`❌ Failed to reload configuration module ${moduleName}:`, error);
      throw error;
    }
  }

  watchModule(moduleName: keyof ModuleRegistry, callback: (config: any) => void): void {
    const module = this.modules[moduleName];
    if (module.watch) {
      module.watch(callback);
    }
  }

  getHealthStatus(): Record<string, { isValid: boolean; errors: string[]; warnings: string[] }> {
    const health: Record<string, { isValid: boolean; errors: string[]; warnings: string[] }> = {};

    for (const [name, module] of Object.entries(this.modules)) {
      try {
        const result = module.validate();
        health[name] = {
          isValid: result.isValid,
          errors: result.errors,
          warnings: result.warnings,
        };
      } catch (error) {
        health[name] = {
          isValid: false,
          errors: [`Health check failed: ${error}`],
          warnings: [],
        };
      }
    }

    return health;
  }
}