import { describe, it, expect } from '@jest/globals';
import * as portfolioSchemas from '@/routes/schema/portfolio';
import * as defiSchemas from '@/routes/schema/defi';
import * as nftSchemas from '@/routes/schema/nft';
import * as solSchemas from '@/routes/schema/solana';

describe('Route schema modules', () => {
  it('parses a valid EVM address', () => {
    const ok = portfolioSchemas.addressSchema.safeParse('0x' + 'a'.repeat(40));
    expect(ok.success).toBe(true);
  });

  it('parses portfolio query defaults', () => {
    const ok = portfolioSchemas.portfolioQuerySchema.safeParse({});
    expect(ok.success).toBe(true);
  });

  it('parses DeFi query chains and protocols', () => {
    const ok = defiSchemas.defiQuerySchema.safeParse({ chains: 'ethereum,polygon', protocols: 'aave-v3,curve' });
    expect(ok.success).toBe(true);
  });

  it('parses NFT query categories and standards', () => {
    const ok = nftSchemas.portfolioQuerySchema.safeParse({ categories: 'art,collectibles', standards: 'ERC721,SPL' });
    expect(ok.success).toBe(true);
  });

  it('parses Solana address and protocols', () => {
    const okAddr = solSchemas.solanaAddressSchema.safeParse('11111111111111111111111111111111');
    expect(okAddr.success).toBe(true);
    const ok = solSchemas.solanaQuerySchema.safeParse({ protocols: 'raydium,orca' });
    expect(ok.success).toBe(true);
  });
});

