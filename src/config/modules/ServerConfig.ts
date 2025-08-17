import { BaseConfigModule, ValidationResult } from './ConfigModule';
import { env } from '../env/validation';

export interface ServerSettings {
  nodeEnv: string;
  port: number;
  host: string;
  timeout: number;
  bodyLimit: string;
  isDevelopment: boolean;
  isStaging: boolean;
  isProduction: boolean;
  gracefulShutdownTimeout: number;
}

export class ServerConfig extends BaseConfigModule<ServerSettings> {
  name = 'server';

  load(): ServerSettings {
    if (!this.config) {
      this.config = {
        nodeEnv: env.NODE_ENV,
        port: env.PORT,
        host: env.HOST,
        timeout: env.SERVER_TIMEOUT,
        bodyLimit: env.BODY_LIMIT,
        isDevelopment: env.NODE_ENV === 'development',
        isStaging: env.NODE_ENV === 'staging',
        isProduction: env.NODE_ENV === 'production',
        gracefulShutdownTimeout: env.GRACEFUL_SHUTDOWN_TIMEOUT,
      };
    }
    return this.config;
  }

  protected validateConfig(config: ServerSettings, errors: string[], warnings: string[]): void {
    if (!config.nodeEnv) {
      errors.push('NODE_ENV is required');
    }

    if (!['development', 'staging', 'production'].includes(config.nodeEnv)) {
      errors.push('NODE_ENV must be development, staging, or production');
    }

    if (config.port < 1 || config.port > 65535) {
      errors.push('PORT must be between 1 and 65535');
    }

    if (config.timeout < 1000) {
      warnings.push('SERVER_TIMEOUT is very low, consider increasing');
    }

    if (config.isProduction && config.port < 1024) {
      warnings.push('Running on privileged port in production');
    }
  }
}