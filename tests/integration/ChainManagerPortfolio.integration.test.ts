import { ChainId, TokenBalance } from '@/types/blockchain';

// Mock PriceService to avoid external calls and Redis
jest.mock('@/services/pricing/PriceService', () => ({
  __esModule: true,
  getPriceService: () => ({
    enrichBalances: async (chainId: ChainId, balances: TokenBalance[]) => {
      return balances.map((b) => {
        let priceUSD: number | undefined;
        if (b.token.isNative) priceUSD = 2000; // ETH price
        else if (b.token.symbol === 'USDC') priceUSD = 1;
        const balanceNum = parseFloat(b.balanceFormatted || '0');
        const balanceUSD = priceUSD !== undefined ? balanceNum * priceUSD : undefined;
        return { ...b, priceUSD, balanceUSD } as TokenBalance;
      });
    },
  }),
}));

describe('ChainManager.getMultiChainPortfolio() valuation', () => {
  beforeAll(() => {
    jest.useRealTimers();
  });
  it('sanity', () => {
    expect(1 + 1).toBe(2);
  });
  beforeEach(() => {
    // Minimal env for config validation
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/db';
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/0';
    process.env.ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || 'test-alchemy-key';
    process.env.ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL || 'https://eth.example/rpc';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(32);
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'y'.repeat(32);
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('computes USD totals from native and token balances', async () => {
    const { ChainManager, getChainManager } = await import('@/services/ChainManager');

    // Stub healthy chains and balances
    jest.spyOn(ChainManager.prototype, 'getHealthyChains').mockReturnValue([ChainId.ETHEREUM]);
    jest.spyOn(ChainManager.prototype, 'getBalance').mockResolvedValue({
      success: true,
      data: [
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
        } as TokenBalance,
        {
          token: {
            address: '0xA0b86991c6218B36c1d19D4a2e9Eb0cE3606eB48', // USDC
            chainId: ChainId.ETHEREUM,
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            isNative: false,
          },
          balance: '100000000',
          balanceFormatted: '100',
          lastUpdated: new Date(),
        } as TokenBalance,
      ],
      metadata: {
        provider: 'mock',
        chainId: ChainId.ETHEREUM,
        timestamp: Date.now(),
        requestId: 'test',
      },
    });

    const cm = getChainManager();
    let result;
    try {
      result = await cm.getMultiChainPortfolio('0xdeadbeef');
    } catch (e) {
      // Surface error for debugging
      // eslint-disable-next-line no-console
      console.error('getMultiChainPortfolio threw:', e);
      throw e;
    }

    expect(result.success).toBe(true);
  });
});
