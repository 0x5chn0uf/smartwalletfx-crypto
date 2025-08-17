import { BaseConfigModule, ValidationResult } from './ConfigModule';
import { loadSensitiveSecrets, SensitiveSecrets, parseCommaSeparated } from '../env/validation';
import { env } from '../env/validation';

export interface SecuritySettings {
  jwtSecret: string;
  jwtExpiresIn: string;
  jwtRefreshExpiresIn: string;
  encryptionKey: string;
  encryptionAlgorithm: string;
  apiKeySalt: string;
  validApiKeys: string[];
  apiKeyRateLimit: number;
}

export class SecurityConfig extends BaseConfigModule<SecuritySettings> {
  name = 'security';
  private secrets?: SensitiveSecrets;

  async loadSecrets(): Promise<void> {
    if (!this.secrets) {
      this.secrets = await loadSensitiveSecrets();
    }
  }

  load(): SecuritySettings {
    if (!this.config) {
      if (!this.secrets) {
        throw new Error('Security secrets not loaded. Call loadSecrets() first.');
      }
      
      this.config = {
        jwtSecret: this.secrets.jwtSecret || '',
        jwtExpiresIn: this.secrets.jwtExpiresIn || '1h',
        jwtRefreshExpiresIn: this.secrets.jwtRefreshExpiresIn || '7d',
        encryptionKey: this.secrets.encryptionKey || '',
        encryptionAlgorithm: this.secrets.encryptionAlgorithm || 'aes-256-gcm',
        apiKeySalt: this.secrets.apiKeySalt || '',
        validApiKeys: env.VALID_API_KEYS ? parseCommaSeparated(env.VALID_API_KEYS) : [],
        apiKeyRateLimit: env.API_KEY_RATE_LIMIT || 100,
      };
    }
    return this.config;
  }

  protected validateConfig(config: SecuritySettings, errors: string[], warnings: string[]): void {
    // JWT Secret validation
    if (!config.jwtSecret) {
      errors.push('JWT secret is required');
    } else if (config.jwtSecret.length < 32) {
      errors.push('JWT secret must be at least 32 characters long');
    } else if (config.jwtSecret === 'your-secret-key' || config.jwtSecret === 'default') {
      errors.push('JWT secret cannot be a default value');
    }

    // Encryption key validation
    if (!config.encryptionKey) {
      errors.push('Encryption key is required');
    } else if (config.encryptionKey.length < 32) {
      errors.push('Encryption key must be at least 32 characters long');
    }

    // API key salt validation
    if (!config.apiKeySalt) {
      errors.push('API key salt is required');
    } else if (config.apiKeySalt.length < 16) {
      warnings.push('API key salt should be at least 16 characters long');
    }

    // Encryption algorithm validation
    const allowedAlgorithms = ['aes-256-gcm', 'aes-256-cbc', 'aes-192-gcm', 'aes-192-cbc'];
    if (!allowedAlgorithms.includes(config.encryptionAlgorithm)) {
      errors.push(`Encryption algorithm must be one of: ${allowedAlgorithms.join(', ')}`);
    }

    // JWT expiration validation
    if (!config.jwtExpiresIn) {
      errors.push('JWT expires in is required');
    }

    if (!config.jwtRefreshExpiresIn) {
      errors.push('JWT refresh expires in is required');
    }

    // API key rate limit validation
    if (config.apiKeyRateLimit < 1) {
      errors.push('API key rate limit must be at least 1');
    }

    if (config.validApiKeys.length === 0) {
      warnings.push('No valid API keys configured');
    }

    // Check for weak API keys
    for (const apiKey of config.validApiKeys) {
      if (apiKey.length < 32) {
        warnings.push(`API key "${apiKey.substring(0, 8)}..." is shorter than recommended 32 characters`);
      }
    }
  }
}