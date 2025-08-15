import { ChainId, TokenBalance } from '@/types/blockchain';

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// In-memory redis mock
const store = new Map<string, any>();
jest.mock('@/utils/redis', () => ({
  __esModule: true,
  redisManager: {
    get: jest.fn((key: string) => Promise.resolve(store.has(key) ? store.get(key) : null)),
    set: jest.fn((key: string, value: any) => {
      store.set(key, value);
      return Promise.resolve(true);
    }),
    mget: jest.fn((keys: string[]) =>
      Promise.resolve(keys.map((k) => (store.has(k) ? store.get(k) : null)))
    ),
    mset: jest.fn((pairs: Array<{ key: string; value: any }>) => {
      pairs.forEach(({ key, value }) => store.set(key, value));
      return Promise.resolve(true);
    }),
  },
}));

describe('PriceService', () => {
  beforeEach(() => {
    // Minimal env for config validation
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/db';
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/0';
    process.env.ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || 'test-alchemy-key';
    process.env.ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL || 'https://eth.example/rpc';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(32);
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'y'.repeat(32);
    store.clear();
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('enriches native and token balances with USD values', async () => {
    const axios = (await import('axios')).default as any;
    // Mock native price (ETH = $2000)
    axios.get
      .mockResolvedValueOnce({ data: { ethereum: { usd: 2000 } } })
      // Mock token price (USDC = $1)
      .mockResolvedValueOnce({ data: { '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { usd: 1 } } });

    const balances: TokenBalance[] = [
      {
        token: {
          address: '0x0000000000000000000000000000000000000000',
          chainId: ChainId.ETHEREUM,
          symbol: 'ETH',
          name: 'Ether',
          decimals: 18,
          isNative: true,
        },
        balance: '2000000000000000000',
        balanceFormatted: '2',
        lastUpdated: new Date(),
      } as any,
      {
        token: {
          address: '0xA0b86991c6218B36c1d19D4a2e9Eb0cE3606eB48',
          chainId: ChainId.ETHEREUM,
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          isNative: false,
        },
        balance: '100000000',
        balanceFormatted: '100',
        lastUpdated: new Date(),
      } as any,
    ];

    const { getPriceService } = await import('@/services/pricing/PriceService');
    const enriched = await getPriceService().enrichBalances(ChainId.ETHEREUM, balances);

    const eth = enriched.find((b) => b.token.isNative)!;
    const usdc = enriched.find((b) => !b.token.isNative)!;

    expect(eth.priceUSD).toBe(2000);
    expect(eth.balanceUSD).toBeCloseTo(4000);
    expect(usdc.priceUSD).toBe(1);
    expect(usdc.balanceUSD).toBe(100);
  });

  it('uses cached prices when available', async () => {
    const axios = (await import('axios')).default as any;
    // Pre-populate cache
    store.set('price:native:1', 1000);
    store.set('price:token:1:0xabc', 2.5);

    const balances: TokenBalance[] = [
      {
        token: {
          address: 'native',
          chainId: ChainId.ETHEREUM,
          symbol: 'ETH',
          name: 'Ether',
          decimals: 18,
          isNative: true,
        },
        balance: '1000000000000000000',
        balanceFormatted: '1',
        lastUpdated: new Date(),
      } as any,
      {
        token: {
          address: '0xAbC',
          chainId: ChainId.ETHEREUM,
          symbol: 'TKN',
          name: 'Token',
          decimals: 18,
          isNative: false,
        },
        balance: '10',
        balanceFormatted: '10',
        lastUpdated: new Date(),
      } as any,
    ];

    const { getPriceService } = await import('@/services/pricing/PriceService');
    const enriched = await getPriceService().enrichBalances(ChainId.ETHEREUM, balances);
    expect(enriched[0].priceUSD).toBe(1000);
    expect(enriched[0].balanceUSD).toBe(1000);
    expect(enriched[1].priceUSD).toBe(2.5);
    expect(enriched[1].balanceUSD).toBe(25);
    // axios.get should not be called because of cache
    expect(axios.get).not.toHaveBeenCalled();
  });
});
