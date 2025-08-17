/**
 * Swagger UI Security Protection Test Suite
 * Verifies proper access controls for API documentation in different environments
 */

import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { createApp } from '../../src/app';
import { initializeConfig } from '../../src/config';
import { Config } from '../../src/config';

describe('Swagger UI Security Protection', () => {
  let app: any;
  let config: Config;

  beforeAll(async () => {
    config = await initializeConfig();
    app = await createApp(config);
  });

  afterAll(async () => {
    // Cleanup if needed
  });

  describe('Swagger Access Control', () => {
    it('should enable Swagger UI when feature flag is enabled', async () => {
      if (config.features.swagger) {
        const response = await request(app)
          .get('/api-docs')
          .expect(200);

        expect(response.text).toMatch(/swagger-ui/i);
      } else {
        await request(app)
          .get('/api-docs')
          .expect(404);
      }
    });

    it('should protect Swagger JSON spec appropriately by environment', async () => {
      if (!config.features.swagger) {
        return; // Skip if Swagger is disabled
      }

      if (config.server.isProduction) {
        // Production: should require API key
        await request(app)
          .get('/api-docs.json')
          .expect(401);

        // With valid API key should work
        const response = await request(app)
          .get('/api-docs.json')
          .set('X-API-Key', 'valid-test-key')
          .expect(200);

        expect(response.body.openapi).toBeDefined();
      } else {
        // Development: should be open
        const response = await request(app)
          .get('/api-docs.json')
          .expect(200);

        expect(response.body.openapi).toBeDefined();
      }
    });

    it('should disable try-it-out in production environment', async () => {
      if (!config.features.swagger || !config.server.isProduction) {
        return;
      }

      const response = await request(app)
        .get('/api-docs')
        .set('X-API-Key', 'valid-test-key')
        .expect(200);

      // Check that tryItOutEnabled is false in production
      expect(response.text).toMatch(/tryItOutEnabled.*false/);
    });
  });

  describe('Production Swagger Security', () => {
    beforeAll(() => {
      if (!config.server.isProduction) {
        return;
      }
    });

    it('should require API key authentication in production', async () => {
      if (!config.features.swagger || !config.server.isProduction) {
        return;
      }

      // No API key should fail
      await request(app)
        .get('/api-docs')
        .expect(401);

      // Invalid API key should fail
      await request(app)
        .get('/api-docs')
        .set('X-API-Key', 'invalid-key')
        .expect(401);
    });

    it('should respect IP whitelist when configured', async () => {
      if (!config.features.swagger || !config.server.isProduction) {
        return;
      }

      // Set up test with IP restriction
      process.env.SWAGGER_ALLOWED_IPS = '127.0.0.1,10.0.0.0/8';

      // Valid API key but restricted IP should be allowed for localhost
      const response = await request(app)
        .get('/api-docs')
        .set('X-API-Key', 'valid-test-key')
        .set('X-Forwarded-For', '127.0.0.1')
        .expect(200);

      expect(response.text).toMatch(/SmartWalletFX.*PRODUCTION/);

      // Clean up
      delete process.env.SWAGGER_ALLOWED_IPS;
    });

    it('should show production warning in title', async () => {
      if (!config.features.swagger || !config.server.isProduction) {
        return;
      }

      const response = await request(app)
        .get('/api-docs')
        .set('X-API-Key', 'valid-test-key')
        .expect(200);

      expect(response.text).toMatch(/PRODUCTION/);
    });
  });

  describe('Development Swagger Access', () => {
    it('should allow open access in development environment', async () => {
      if (!config.features.swagger || config.server.isProduction) {
        return;
      }

      const response = await request(app)
        .get('/api-docs')
        .expect(200);

      expect(response.text).toMatch(/swagger-ui/i);
      expect(response.text).not.toMatch(/PRODUCTION/);
    });

    it('should enable try-it-out in development', async () => {
      if (!config.features.swagger || config.server.isProduction) {
        return;
      }

      const response = await request(app)
        .get('/api-docs')
        .expect(200);

      // Should not disable try-it-out in development
      expect(response.text).not.toMatch(/tryItOutEnabled.*false/);
    });

    it('should provide open access to JSON spec in development', async () => {
      if (!config.features.swagger || config.server.isProduction) {
        return;
      }

      const response = await request(app)
        .get('/api-docs.json')
        .expect(200);

      expect(response.body.openapi).toBeDefined();
      expect(response.body.info.title).toMatch(/SmartWalletFX/);
    });
  });

  describe('Security Logging', () => {
    it('should log security events for Swagger access attempts', async () => {
      if (!config.features.swagger) {
        return;
      }

      // Mock logger to capture logs
      const originalWarn = console.warn;
      const logs: string[] = [];
      console.warn = (...args: any[]) => {
        logs.push(args.join(' '));
      };

      try {
        if (config.server.isProduction) {
          // Should log warning about production Swagger access
          await request(app)
            .get('/api-docs')
            .set('X-API-Key', 'valid-test-key');

          expect(logs.some(log => log.includes('Swagger enabled in production'))).toBe(true);
        }
      } finally {
        console.warn = originalWarn;
      }
    });

    it('should include request ID in security responses', async () => {
      if (!config.features.swagger || !config.server.isProduction) {
        return;
      }

      const response = await request(app)
        .get('/api-docs')
        .expect(401);

      expect(response.body.metadata?.requestId).toBeDefined();
    });
  });

  describe('API Documentation Security', () => {
    it('should not expose sensitive configuration in API docs', async () => {
      if (!config.features.swagger) {
        return;
      }

      const response = await request(app)
        .get('/api-docs.json')
        .set('X-API-Key', config.server.isProduction ? 'valid-test-key' : undefined)
        .expect(200);

      const docString = JSON.stringify(response.body);
      
      // Should not contain sensitive information
      expect(docString).not.toMatch(/password|secret|private_key|database_url/i);
      expect(docString).not.toMatch(/localhost:\d+/); // No localhost in production docs
    });

    it('should require authentication for all documented endpoints', async () => {
      if (!config.features.swagger) {
        return;
      }

      const response = await request(app)
        .get('/api-docs.json')
        .set('X-API-Key', config.server.isProduction ? 'valid-test-key' : undefined)
        .expect(200);

      const spec = response.body;
      
      // Check that security is defined globally
      expect(spec.security).toBeDefined();
      expect(spec.security).toContainEqual({ ApiKeyAuth: [] });
      
      // Verify security schemes
      expect(spec.components?.securitySchemes?.ApiKeyAuth).toBeDefined();
    });
  });
});