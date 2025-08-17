import { BaseConfigModule, ValidationResult } from './ConfigModule';
import { loadSensitiveSecrets, SensitiveSecrets } from '../env/validation';
import { env } from '../env/validation';

export interface DatabaseSettings {
  url: string;
  poolSize: number;
  timeout: number;
  ssl: boolean;
}

export class DatabaseConfig extends BaseConfigModule<DatabaseSettings> {
  name = 'database';
  private secrets?: SensitiveSecrets;

  async loadSecrets(): Promise<void> {
    if (!this.secrets) {
      this.secrets = await loadSensitiveSecrets();
    }
  }

  load(): DatabaseSettings {
    if (!this.config) {
      if (!this.secrets) {
        throw new Error('Database secrets not loaded. Call loadSecrets() first.');
      }
      
      this.config = {
        url: this.secrets.databaseUrl,
        poolSize: env.DATABASE_POOL_SIZE,
        timeout: env.DATABASE_TIMEOUT,
        ssl: env.DATABASE_SSL,
      };
    }
    return this.config;
  }

  protected validateConfig(config: DatabaseSettings, errors: string[], warnings: string[]): void {
    if (!config.url) {
      errors.push('Database URL is required');
    }

    if (!config.url.startsWith('postgresql://') && !config.url.startsWith('postgres://')) {
      errors.push('Database URL must be a valid PostgreSQL connection string');
    }

    if (config.poolSize < 1) {
      errors.push('Database pool size must be at least 1');
    }

    if (config.poolSize > 100) {
      warnings.push('Database pool size is very high, consider reducing');
    }

    if (config.timeout < 5000) {
      warnings.push('Database timeout is very low, consider increasing');
    }

    if (!config.ssl && config.url.includes('production')) {
      warnings.push('SSL is disabled for what appears to be a production database');
    }
  }
}