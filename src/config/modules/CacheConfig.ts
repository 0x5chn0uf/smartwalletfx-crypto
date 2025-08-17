import { BaseConfigModule, ValidationResult } from './ConfigModule';
import { env } from '../env/validation';

export interface CacheSettings {
  ttl: {
    short: number;
    medium: number;
    long: number;
    static: number;
  };
  compression: boolean;
}

export class CacheConfig extends BaseConfigModule<CacheSettings> {
  name = 'cache';

  load(): CacheSettings {
    if (!this.config) {
      this.config = {
        ttl: {
          short: env.CACHE_TTL_SHORT,
          medium: env.CACHE_TTL_MEDIUM,
          long: env.CACHE_TTL_LONG,
          static: env.CACHE_TTL_STATIC,
        },
        compression: env.CACHE_COMPRESSION,
      };
    }
    return this.config;
  }

  protected validateConfig(config: CacheSettings, errors: string[], warnings: string[]): void {
    const ttlValues = Object.values(config.ttl);
    
    // Check for negative TTL values
    for (const [key, value] of Object.entries(config.ttl)) {
      if (value < 0) {
        errors.push(`Cache TTL ${key} cannot be negative`);
      }
    }

    // Check for logical TTL ordering
    if (config.ttl.short > config.ttl.medium) {
      warnings.push('Short TTL is greater than medium TTL');
    }

    if (config.ttl.medium > config.ttl.long) {
      warnings.push('Medium TTL is greater than long TTL');
    }

    // Check for extremely high TTL values
    const maxReasonableTtl = 24 * 60 * 60 * 1000; // 24 hours
    for (const [key, value] of Object.entries(config.ttl)) {
      if (value > maxReasonableTtl) {
        warnings.push(`Cache TTL ${key} is very high (${value}ms), consider reducing`);
      }
    }

    // Check for extremely low TTL values
    const minReasonableTtl = 1000; // 1 second
    for (const [key, value] of Object.entries(config.ttl)) {
      if (value < minReasonableTtl && value > 0) {
        warnings.push(`Cache TTL ${key} is very low (${value}ms), consider increasing`);
      }
    }
  }
}