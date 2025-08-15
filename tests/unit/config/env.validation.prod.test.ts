describe('env validation (production paths)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.REDIS_URL = 'redis://localhost:6379/0';
    process.env.ALCHEMY_API_KEY = 'test-alchemy-key';
    process.env.ETHEREUM_RPC_URL = 'https://eth.example/rpc';
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('exits when JWT_SECRET or ENCRYPTION_KEY are too short', () => {
    process.env.JWT_SECRET = 'short';
    process.env.ENCRYPTION_KEY = 'short';
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error('process.exit:' + code);
    }) as any);

    expect(() => {
      jest.isolateModules(() => {
        require('../../../src/config/env/validation');
      });
    }).toThrow(/process\.exit:1/);

    exitSpy.mockRestore();
  });
});

