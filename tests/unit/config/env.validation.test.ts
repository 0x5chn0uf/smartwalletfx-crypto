describe('env validation', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    // Minimal required variables
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.REDIS_URL = 'redis://localhost:6379/0';
    process.env.ALCHEMY_API_KEY = 'test-alchemy-key';
    process.env.ETHEREUM_RPC_URL = 'https://eth.example/rpc';
    process.env.JWT_SECRET = 'x'.repeat(32);
    process.env.ENCRYPTION_KEY = 'y'.repeat(32);
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('parses required environment variables with defaults', () => {
    jest.isolateModules(() => {
      const { env } = require('../../../src/config/env/validation');
      expect(env.NODE_ENV).toBe('development');
      expect(env.DATABASE_URL).toContain('postgresql://');
      expect(env.REDIS_URL).toContain('redis://');
      expect(env.ALCHEMY_API_KEY).toBe('test-alchemy-key');
      expect(env.ETHEREUM_RPC_URL).toBe('https://eth.example/rpc');
      // Defaults applied
      expect(env.RATE_LIMIT_MAX).toBeGreaterThan(0);
      expect(env.CACHE_TTL_SHORT).toBeGreaterThan(0);
    });
  });
});

