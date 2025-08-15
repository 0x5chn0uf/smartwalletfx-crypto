describe('chains config builder', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.REDIS_URL = 'redis://localhost:6379/0';
    process.env.ALCHEMY_API_KEY = 'test-alchemy-key';
    process.env.JWT_SECRET = 'x'.repeat(32);
    process.env.ENCRYPTION_KEY = 'y'.repeat(32);
    // Only enable a subset of chains
    process.env.ETHEREUM_RPC_URL = 'https://eth.example/rpc';
    process.env.POLYGON_RPC_URL = 'https://polygon.example/rpc';
    delete process.env.ARBITRUM_RPC_URL;
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('builds chains config with enabled flags based on RPC presence', () => {
    jest.isolateModules(() => {
      const { buildChainsConfig } = require('../../../src/config/env/chains');
      const chains = buildChainsConfig();
      expect(chains.ethereum.enabled).toBe(true);
      expect(chains.polygon.enabled).toBe(true);
      expect(chains.arbitrum.enabled).toBe(false);
      expect(chains.ethereum.rpcUrl).toBe('https://eth.example/rpc');
    });
  });
});

