import axios from 'axios';
import { redisManager } from '@/utils/redis';
import { logger } from '@/utils/logger';
import { ChainId, TokenBalance } from '@/types/blockchain';
import { config } from '@/config';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

const PLATFORM_IDS: Record<string | number, string> = {
  [ChainId.ETHEREUM]: 'ethereum',
  [ChainId.POLYGON]: 'polygon-pos',
  [ChainId.ARBITRUM]: 'arbitrum-one',
  [ChainId.OPTIMISM]: 'optimistic-ethereum',
  [ChainId.BASE]: 'base',
  [ChainId.BSC]: 'binance-smart-chain',
  [ChainId.AVALANCHE]: 'avalanche',
  [ChainId.FANTOM]: 'fantom',
  [ChainId.SOLANA]: 'solana',
};

const NATIVE_IDS: Record<string | number, string> = {
  [ChainId.ETHEREUM]: 'ethereum',
  [ChainId.POLYGON]: 'matic-network',
  [ChainId.ARBITRUM]: 'ethereum', // Native is ETH
  [ChainId.OPTIMISM]: 'ethereum', // Native is ETH
  [ChainId.BASE]: 'ethereum', // Native is ETH
  [ChainId.BSC]: 'binancecoin',
  [ChainId.AVALANCHE]: 'avalanche-2',
  [ChainId.FANTOM]: 'fantom',
  [ChainId.SOLANA]: 'solana',
};

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

class PriceService {
  // Fetch native token USD price
  async getNativePrice(chainId: ChainId): Promise<number | null> {
    const nativeId = NATIVE_IDS[chainId];
    if (!nativeId) return null;

    const cacheKey = `price:native:${String(chainId)}`;
    const cached = await redisManager.get<number>(cacheKey);
    if (cached !== null) return cached;

    try {
      const url = `${COINGECKO_BASE}/simple/price?ids=${encodeURIComponent(nativeId)}&vs_currencies=usd`;
      const resp = await axios.get(url, { timeout: 8000 });
      const price = resp.data?.[nativeId]?.usd ?? null;
      if (price !== null) {
        await redisManager.set(cacheKey, price, config.pricing.ttl.native);
      }
      return price;
    } catch (error) {
      logger.warn('PriceService: native price fetch failed', { chainId, error: (error as any)?.message });
      return null;
    }
  }

  // Fetch ERC20/SPL token prices for a chain by contract addresses
  async getTokenPrices(chainId: ChainId, addresses: string[]): Promise<Record<string, number>> {
    const platform = PLATFORM_IDS[chainId];
    if (!platform || addresses.length === 0) return {};

    // Normalize addresses to lowercase for EVM
    const norm = (addr: string) => (typeof chainId === 'number' ? addr.toLowerCase() : addr);
    const uniqueAddrs = Array.from(new Set(addresses.map(norm)));

    // Try cache for each address
    const cacheKeys = uniqueAddrs.map((a) => `price:token:${String(chainId)}:${a}`);
    const cachedValues = await redisManager.mget<number>(cacheKeys);

    const result: Record<string, number> = {};
    const missing: string[] = [];
    uniqueAddrs.forEach((addr, i) => {
      const v = cachedValues[i];
      if (v !== null && typeof v === 'number') {
        result[addr] = v;
      } else {
        missing.push(addr);
      }
    });

    if (missing.length === 0) return result;

    // Fetch missing in chunks (CoinGecko supports up to ~100 addresses)
    const chunks = chunk(missing, 100);
    for (const group of chunks) {
      try {
        const url = `${COINGECKO_BASE}/simple/token_price/${platform}?contract_addresses=${group.join(',')}&vs_currencies=usd`;
        const resp = await axios.get(url, { timeout: 10000 });
        const data = resp.data || {};
        const toSet: Array<{ key: string; value: number; ttl?: number }> = [];
        for (const [addr, info] of Object.entries<any>(data)) {
          const price = info?.usd;
          if (typeof price === 'number') {
            result[addr.toLowerCase()] = price;
            toSet.push({ key: `price:token:${String(chainId)}:${addr.toLowerCase()}`, value: price, ttl: config.pricing.ttl.token });
          }
        }
        if (toSet.length > 0) {
          await redisManager.mset(toSet);
        }
      } catch (error) {
        logger.warn('PriceService: token price fetch failed', { chainId, count: group.length, error: (error as any)?.message });
      }
    }

    return result;
  }

  // Enrich balances with priceUSD and balanceUSD
  async enrichBalances(chainId: ChainId, balances: TokenBalance[]): Promise<TokenBalance[]> {
    if (!balances || balances.length === 0) return balances;

    const nativePrice = await this.getNativePrice(chainId);
    const tokenAddrs = balances
      .filter((b) => !b.token.isNative && b.token.address)
      .map((b) => b.token.address);
    const tokenPrices = await this.getTokenPrices(chainId, tokenAddrs);

    return balances.map((b) => {
      let priceUSD: number | undefined;
      if (b.token.isNative) {
        priceUSD = nativePrice ?? undefined;
      } else {
        const key = typeof chainId === 'number' ? b.token.address.toLowerCase() : b.token.address;
        priceUSD = tokenPrices[key];
      }

      const balanceNum = parseFloat(b.balanceFormatted || '0');
      const balanceUSD = priceUSD !== undefined ? balanceNum * priceUSD : undefined;

      return {
        ...b,
        priceUSD,
        balanceUSD,
      };
    });
  }
}

let _priceService: PriceService | null = null;
export const getPriceService = (): PriceService => {
  if (!_priceService) _priceService = new PriceService();
  return _priceService;
};

export default PriceService;
