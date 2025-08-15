import * as T from '@/types/blockchain';

describe('Token registry invariants', () => {
  it.skip('has correct Ethereum blue-chip token addresses', () => {
    const eth = (T as any).COMMON_TOKENS[T.ChainId.ETHEREUM];
    expect(eth.USDC?.address).toBe('0xA0b86991c6218B36c1d19D4a2e9Eb0cE3606eB48');
    expect(eth.USDT?.address).toBe('0xdAC17F958D2ee523a2206206994597C13D831ec7');
    expect(eth.WETH?.address).toBe('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
  });
});
