/**
 * Security Headers Validation Test Suite
 * Verifies all critical security headers are properly implemented
 */

import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { createApp } from '../../src/app';
import { initializeConfig } from '../../src/config';
import { Config } from '../../src/config';

describe('Security Headers Validation', () => {
  let app: any;
  let config: Config;

  beforeAll(async () => {
    // Initialize with test configuration
    config = await initializeConfig();
    app = await createApp(config);
  });

  afterAll(async () => {
    // Cleanup if needed
  });

  describe('Critical Security Headers', () => {
    it('should include X-Content-Type-Options: nosniff', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('should include Referrer-Policy: strict-origin-when-cross-origin', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    it('should include X-Frame-Options: DENY', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers['x-frame-options']).toBe('DENY');
    });

    it('should include X-XSS-Protection', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers['x-xss-protection']).toBeDefined();
    });

    it('should include Strict-Transport-Security (HSTS)', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers['strict-transport-security']).toMatch(/max-age=31536000/);
      expect(response.headers['strict-transport-security']).toMatch(/includeSubDomains/);
      expect(response.headers['strict-transport-security']).toMatch(/preload/);
    });

    it('should include Content-Security-Policy', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      const csp = response.headers['content-security-policy'];
      expect(csp).toBeDefined();
      expect(csp).toMatch(/default-src 'self'/);
      expect(csp).toMatch(/object-src 'none'/);
      expect(csp).toMatch(/frame-src 'none'/);
    });

    it('should include X-Cross-Origin-Resource-Policy', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });
  });

  describe('Request ID Security', () => {
    it('should include X-Request-ID header in all responses', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers['x-request-id']).toBeDefined();
      expect(response.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/); // UUID format
    });

    it('should preserve custom X-Request-ID when provided', async () => {
      const customRequestId = 'test-request-12345';
      
      const response = await request(app)
        .get('/health')
        .set('X-Request-ID', customRequestId)
        .expect(200);

      expect(response.headers['x-request-id']).toBe(customRequestId);
    });
  });

  describe('CORS Security', () => {
    it('should reject requests from unauthorized origins', async () => {
      const response = await request(app)
        .get('/api/protocols')
        .set('Origin', 'https://malicious-site.com')
        .expect(403);

      expect(response.body.error.code).toBe('CORS_NOT_ALLOWED');
    });

    it('should accept requests from allowed origins in development', async () => {
      if (!config.server.isProduction) {
        const response = await request(app)
          .get('/health')
          .set('Origin', 'http://localhost:3000')
          .expect(200);

        expect(response.headers['access-control-allow-origin']).toBeDefined();
      }
    });
  });

  describe('Information Disclosure Prevention', () => {
    it('should not expose server information in headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers['server']).toBeUndefined();
      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('should not include stack traces in error responses', async () => {
      const response = await request(app)
        .get('/api/nonexistent-endpoint')
        .expect(404);

      expect(response.body).not.toHaveProperty('stack');
      expect(response.body).not.toHaveProperty('trace');
      expect(JSON.stringify(response.body)).not.toMatch(/Error:/);
    });

    it('should sanitize error messages', async () => {
      const response = await request(app)
        .get('/api/portfolio/invalid-address')
        .expect(400);

      expect(response.body.error.message).toBeDefined();
      expect(response.body.error.message).not.toMatch(/internal|system|database|redis/i);
    });
  });

  describe('Rate Limiting Headers', () => {
    it('should include rate limiting headers', async () => {
      const response = await request(app)
        .get('/api/protocols')
        .set('X-API-Key', 'valid-test-key')
        .expect(200);

      expect(response.headers['x-ratelimit-limit'] || response.headers['x-ratelimit-remaining']).toBeDefined();
    });
  });

  describe('Security Response Format', () => {
    it('should use consistent security-aware JSON response format', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('metadata');
      expect(response.body.metadata).toHaveProperty('timestamp');
      expect(response.body.metadata).toHaveProperty('requestId');
    });

    it('should not leak sensitive information in success responses', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      const responseString = JSON.stringify(response.body);
      expect(responseString).not.toMatch(/password|secret|key|token|credential/i);
    });
  });
});