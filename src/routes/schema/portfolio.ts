import { z } from 'zod';
import { ChainId } from '@/types/blockchain';

export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

export const chainIdSchema = z
  .enum(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc', 'avalanche', 'solana'])
  .transform(chain => {
    const chainMap = {
      ethereum: ChainId.ETHEREUM,
      polygon: ChainId.POLYGON,
      arbitrum: ChainId.ARBITRUM,
      optimism: ChainId.OPTIMISM,
      base: ChainId.BASE,
      bsc: ChainId.BSC,
      avalanche: ChainId.AVALANCHE,
      solana: ChainId.SOLANA,
    } as const;
    return chainMap[chain];
  });

export const portfolioQuerySchema = z.object({
  chains: z
    .string()
    .optional()
    .transform(val => (val ? val.split(',').map(c => chainIdSchema.parse(c.trim())) : undefined)),
  includeDefi: z
    .string()
    .optional()
    .transform(val => val !== 'false'),
  includeNfts: z
    .string()
    .optional()
    .transform(val => val !== 'false'),
  includeMetadata: z
    .string()
    .optional()
    .transform(val => val !== 'false'),
  includeAnalytics: z
    .string()
    .optional()
    .transform(val => val === 'true'),
  forceRefresh: z
    .string()
    .optional()
    .transform(val => val === 'true'),
  minDefiValue: z
    .string()
    .optional()
    .transform(val => (val ? parseFloat(val) : 0.01)),
  minNftValue: z
    .string()
    .optional()
    .transform(val => (val ? parseFloat(val) : undefined)),
});
