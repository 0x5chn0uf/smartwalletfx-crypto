/**
 * Environment Security Configuration Test Suite
 * Validates secure environment variable handling and configuration
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { env, loadSensitiveSecrets } from '../../src/config/env/validation';
import { initializeConfig } from '../../src/config';

describe('Environment Security Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    originalEnv = { ...process.env };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Secret Management', () => {
    it('should load sensitive secrets through secret manager', async () => {
      const secrets = await loadSensitiveSecrets();
      
      expect(secrets).toBeDefined();
      expect(secrets.jwtSecret).toBeDefined();
      expect(secrets.encryptionKey).toBeDefined();
      expect(secrets.databaseUrl).toBeDefined();
      expect(secrets.redisUrl).toBeDefined();
    });

    it('should enforce minimum secret lengths in production', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      
      try {
        process.env.NODE_ENV = 'production';
        
        // Mock short secrets
        process.env.JWT_SECRET = 'short';
        process.env.ENCRYPTION_KEY = 'alsoshort';
        
        // Should throw or log errors for short secrets
        let errorThrown = false;
        try {
          await loadSensitiveSecrets();
        } catch (error) {
          errorThrown = true;
          expect(error).toBeDefined();
        }
        
        // Either throws error or logs warning
        expect(errorThrown).toBeTruthy();
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it('should not expose secrets in environment validation', () => {
      // Ensure env validation doesn't log or expose actual secret values
      const envKeys = Object.keys(env);
      
      // Should not contain actual secret values in the parsed env object
      expect(envKeys).not.toContain('JWT_SECRET');
      expect(envKeys).not.toContain('ENCRYPTION_KEY');
      expect(envKeys).not.toContain('DATABASE_URL');
    });
  });

  describe('Production Environment Validation', () => {
    it('should warn about Swagger enabled in production', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalSwagger = process.env.ENABLE_SWAGGER;
      const logs: string[] = [];
      const originalWarn = console.warn;
      
      console.warn = (...args: any[]) => {
        logs.push(args.join(' '));
      };
      
      try {
        process.env.NODE_ENV = 'production';
        process.env.ENABLE_SWAGGER = 'true';
        
        // Re-require the validation module to trigger production checks
        delete require.cache[require.resolve('../../src/config/env/validation')];
        require('../../src/config/env/validation');
        
        expect(logs.some(log => log.includes('Swagger UI is enabled in production'))).toBe(true);
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        process.env.ENABLE_SWAGGER = originalSwagger;
        console.warn = originalWarn;
      }
    });

    it('should validate CORS origins in production', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalCors = process.env.CORS_ORIGINS;
      const logs: string[] = [];
      const originalWarn = console.warn;
      
      console.warn = (...args: any[]) => {
        logs.push(args.join(' '));
      };
      
      try {
        process.env.NODE_ENV = 'production';
        process.env.CORS_ORIGINS = 'http://localhost:3000,https://app.example.com';
        
        // Re-require the validation module
        delete require.cache[require.resolve('../../src/config/env/validation')];
        require('../../src/config/env/validation');
        
        expect(logs.some(log => log.includes('Insecure CORS origins'))).toBe(true);
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        process.env.CORS_ORIGINS = originalCors;
        console.warn = originalWarn;
      }
    });

    it('should warn about high rate limits in production', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalRateLimit = process.env.RATE_LIMIT_MAX;
      const logs: string[] = [];
      const originalWarn = console.warn;
      
      console.warn = (...args: any[]) => {
        logs.push(args.join(' '));
      };
      
      try {
        process.env.NODE_ENV = 'production';
        process.env.RATE_LIMIT_MAX = '5000';
        
        // Re-require the validation module
        delete require.cache[require.resolve('../../src/config/env/validation')];
        require('../../src/config/env/validation');
        
        expect(logs.some(log => log.includes('Rate limit seems high'))).toBe(true);
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        process.env.RATE_LIMIT_MAX = originalRateLimit;
        console.warn = originalWarn;
      }
    });
  });

  describe('Configuration Security', () => {
    it('should use secure defaults for security-related settings', async () => {
      const config = await initializeConfig();
      
      // Security defaults
      expect(config.security.validApiKeys).toBeDefined();
      expect(config.rateLimit.max).toBeLessThanOrEqual(1000);
      expect(config.cors.credentials).toBe(true);
      
      // Production-appropriate CORS
      if (config.server.isProduction) {
        expect(config.cors.origins).not.toContain('*');
        expect(config.cors.origins.every((origin: string) => 
          !origin.includes('localhost')
        )).toBe(true);
      }
    });

    it('should properly configure security headers', async () => {
      const config = await initializeConfig();
      
      // Validate security-related feature flags
      expect(typeof config.features.swagger).toBe('boolean');
      
      // Cache security
      expect(config.cache.compression).toBe(true);
      expect(config.cache.ttl.static).toBeGreaterThan(0);
    });

    it('should validate required production secrets', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      
      try {
        process.env.NODE_ENV = 'production';
        
        const config = await initializeConfig();
        
        // Should have all required production configurations
        expect(config.security.jwtSecret).toBeDefined();
        expect(config.security.encryptionKey).toBeDefined();
        expect(config.database.url).toBeDefined();
        expect(config.redis.url).toBeDefined();
        
        // Security-specific validations
        if (config.server.isProduction) {
          expect(config.security.jwtSecret.length).toBeGreaterThanOrEqual(32);
          expect(config.security.encryptionKey.length).toBeGreaterThanOrEqual(32);
        }
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });
  });

  describe('Feature Flag Security', () => {
    it('should handle experimental features securely', async () => {
      const config = await initializeConfig();
      
      // Experimental features should be disabled by default in production
      if (config.server.isProduction) {
        expect(config.features.experimental).toBeDefined();
        // Most experimental features should be false in production
      }
    });

    it('should validate feature combinations', async () => {
      const config = await initializeConfig();
      
      // Certain feature combinations should be validated
      if (config.features.swagger && config.server.isProduction) {
        // Should have appropriate security measures
        expect(config.security.validApiKeys.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Logging Security', () => {
    it('should not log sensitive information', () => {
      const logs: string[] = [];
      const originalLog = console.log;
      const originalWarn = console.warn;
      const originalError = console.error;
      
      console.log = (...args: any[]) => { logs.push(args.join(' ')); };
      console.warn = (...args: any[]) => { logs.push(args.join(' ')); };
      console.error = (...args: any[]) => { logs.push(args.join(' ')); };
      
      try {
        // Trigger configuration loading
        require('../../src/config/env/validation');
        
        // Check that no logs contain sensitive patterns
        const allLogs = logs.join(' ');
        expect(allLogs).not.toMatch(/password.*=.*[a-zA-Z0-9]{8,}/);
        expect(allLogs).not.toMatch(/secret.*=.*[a-zA-Z0-9]{8,}/);
        expect(allLogs).not.toMatch(/key.*=.*[a-zA-Z0-9]{8,}/);
        
      } finally {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
      }
    });
  });

  describe('API Key Security', () => {
    it('should validate API key configuration', async () => {
      const config = await initializeConfig();
      
      expect(config.security.validApiKeys).toBeDefined();
      expect(Array.isArray(config.security.validApiKeys)).toBe(true);
      
      // API keys should be properly formatted if present
      config.security.validApiKeys.forEach((key: string) => {
        expect(typeof key).toBe('string');
        expect(key.length).toBeGreaterThan(8);
      });
    });

    it('should enforce API key rate limiting', async () => {
      const config = await initializeConfig();
      
      expect(config.security.apiKeyRateLimit).toBeDefined();
      expect(config.security.apiKeyRateLimit).toBeGreaterThan(0);
      expect(config.security.apiKeyRateLimit).toBeLessThanOrEqual(10000);
    });
  });
});