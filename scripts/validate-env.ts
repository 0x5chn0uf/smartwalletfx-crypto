#!/usr/bin/env tsx
/**
 * Environment Validation Script
 * 
 * This script validates the environment configuration for the crypto-data service.
 * It checks for required environment variables, validates their formats,
 * and provides helpful error messages for missing or invalid configuration.
 */

import { config, validateEnvironment } from '../src/config/environment';
import { logger } from '../src/utils/logger';

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

class EnvironmentValidator {
  private errors: string[] = [];
  private warnings: string[] = [];

  async validate(): Promise<ValidationResult> {
    console.log('🔍 Validating environment configuration...\n');

    // Basic validation from environment.ts
    const basicValidation = validateEnvironment();
    this.errors.push(...basicValidation.errors);

    // Additional validations
    await this.validateApiConnectivity();
    this.validateSecurityConfiguration();
    this.validatePerformanceSettings();
    this.validateProductionReadiness();

    const isValid = this.errors.length === 0;
    
    this.printResults(isValid);
    
    return {
      isValid,
      errors: this.errors,
      warnings: this.warnings,
    };
  }

  private async validateApiConnectivity(): Promise<void> {
    console.log('🌐 Validating API connectivity...');

    // Test Redis connection
    try {
      const { redisManager } = await import('../src/utils/redis');
      const isRedisHealthy = await redisManager.ping();
      if (!isRedisHealthy) {
        this.errors.push('Redis connection failed');
      } else {
        console.log('✅ Redis connection successful');
      }
    } catch (error) {
      this.errors.push(`Redis connection error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Test database connection
    try {
      // This would test the database connection
      // For now, we just validate the URL format
      const dbUrl = new URL(config.database.url);
      if (dbUrl.protocol !== 'postgresql:' && dbUrl.protocol !== 'postgres:') {
        this.errors.push('Database URL must be a PostgreSQL connection string');
      } else {
        console.log('✅ Database URL format is valid');
      }
    } catch (error) {
      this.errors.push('Invalid database URL format');
    }

    // Validate API keys format (basic checks)
    if (config.apiKeys.alchemy && config.apiKeys.alchemy.length < 20) {
      this.warnings.push('Alchemy API key seems too short - verify it is correct');
    }

    console.log('');
  }

  private validateSecurityConfiguration(): void {
    console.log('🔒 Validating security configuration...');

    // JWT Secret validation
    if (config.security.jwtSecret.length < 32) {
      this.errors.push('JWT_SECRET must be at least 32 characters long');
    } else if (config.security.jwtSecret.length < 64 && config.server.isProduction) {
      this.warnings.push('JWT_SECRET should be at least 64 characters in production');
    } else {
      console.log('✅ JWT secret length is adequate');
    }

    // Encryption key validation
    if (config.security.encryptionKey.length < 32) {
      this.errors.push('ENCRYPTION_KEY must be at least 32 characters long');
    } else {
      console.log('✅ Encryption key length is adequate');
    }

    // Check for development defaults in production
    if (config.server.isProduction) {
      if (config.security.jwtSecret.includes('changeme') || 
          config.security.jwtSecret.includes('secret')) {
        this.errors.push('JWT_SECRET appears to be a default value - use a secure random string');
      }

      if (config.security.encryptionKey.includes('changeme') || 
          config.security.encryptionKey.includes('key')) {
        this.errors.push('ENCRYPTION_KEY appears to be a default value - use a secure random string');
      }
    }

    // CORS validation for production
    if (config.server.isProduction && config.cors.origins.includes('*')) {
      this.errors.push('Wildcard CORS origins (*) are not allowed in production');
    }

    console.log('');
  }

  private validatePerformanceSettings(): void {
    console.log('⚡ Validating performance configuration...');

    // Rate limiting validation
    if (config.rateLimit.max > 1000) {
      this.warnings.push('Rate limit is very high - consider if this is intentional');
    }

    // Cache TTL validation
    if (config.cache.ttl.short > 3600) {
      this.warnings.push('Short cache TTL is longer than 1 hour - consider if this is optimal');
    }

    // Database pool size validation
    if (config.database.poolSize > 50) {
      this.warnings.push('Database pool size is very large - monitor connection usage');
    } else if (config.database.poolSize < 5 && config.server.isProduction) {
      this.warnings.push('Database pool size might be too small for production load');
    }

    // Redis memory validation
    const redisMemoryMB = parseInt(config.redis.maxMemory.replace('mb', ''));
    if (redisMemoryMB > 2048) {
      this.warnings.push('Redis memory limit is very high - ensure sufficient system RAM');
    }

    console.log('✅ Performance settings reviewed');
    console.log('');
  }

  private validateProductionReadiness(): void {
    if (!config.server.isProduction) return;

    console.log('🚀 Validating production readiness...');

    // Error tracking
    if (!config.errorTracking.sentryDsn) {
      this.warnings.push('Sentry DSN not configured - error tracking will be disabled');
    }

    // Logging configuration
    if (config.logging.level === 'debug') {
      this.warnings.push('Debug logging is enabled in production - consider changing to "info" or "warn"');
    }

    // Feature flags validation
    if (config.features.swagger && config.server.isProduction) {
      this.warnings.push('Swagger documentation is enabled in production - consider disabling for security');
    }

    // Budget alerts
    if (config.costs.monthlyBudget < 100) {
      this.warnings.push('Monthly API budget is quite low - monitor usage closely');
    }

    console.log('✅ Production readiness checked');
    console.log('');
  }

  private printResults(isValid: boolean): void {
    console.log('📊 Validation Summary');
    console.log('━━━━━━━━━━━━━━━━━━━━');

    if (isValid) {
      console.log('✅ Environment configuration is valid!');
    } else {
      console.log('❌ Environment configuration has errors!');
    }

    console.log(`\n📈 Configuration Overview:`);
    console.log(`   Environment: ${config.server.nodeEnv}`);
    console.log(`   Port: ${config.server.port}`);
    console.log(`   Enabled chains: ${Object.entries(config.chains).filter(([, chain]) => chain.enabled).length}`);
    console.log(`   Available API providers: ${Object.values(config.apiKeys).filter(Boolean).length}`);
    console.log(`   Features enabled: ${Object.values(config.features).filter(Boolean).length}`);

    if (this.errors.length > 0) {
      console.log(`\n❌ Errors (${this.errors.length}):`);
      this.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }

    if (this.warnings.length > 0) {
      console.log(`\n⚠️  Warnings (${this.warnings.length}):`);
      this.warnings.forEach((warning, index) => {
        console.log(`   ${index + 1}. ${warning}`);
      });
    }

    console.log('\n' + '━'.repeat(40));

    if (!isValid) {
      console.log('\n💡 Next steps:');
      console.log('   1. Fix the errors listed above');
      console.log('   2. Update your .env file with correct values');
      console.log('   3. Run this validation script again');
      console.log('   4. Refer to .env.example for required variables');
    } else {
      console.log('\n🎉 Your environment is ready to go!');
      console.log('   You can now start the application with: npm run dev');
    }
  }
}

// Run validation
async function main() {
  const validator = new EnvironmentValidator();
  const result = await validator.validate();
  
  process.exit(result.isValid ? 0 : 1);
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection during validation:', error);
  process.exit(1);
});

if (require.main === module) {
  main().catch((error) => {
    console.error('Validation failed:', error);
    process.exit(1);
  });
}

export { EnvironmentValidator };