import { z } from 'zod';
import { ChainId } from '@/types/blockchain';
import { NFTCategory, NFTStandard } from '@/types/nft';

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

export const nftCategorySchema = z
  .enum([
    'art',
    'collectibles',
    'gaming',
    'metaverse',
    'music',
    'photography',
    'sports',
    'utility',
    'other',
  ])
  .transform(category => {
    const categoryMap = {
      art: NFTCategory.ART,
      collectibles: NFTCategory.COLLECTIBLES,
      gaming: NFTCategory.GAMING,
      metaverse: NFTCategory.VIRTUAL_WORLDS,
      music: NFTCategory.MUSIC,
      photography: NFTCategory.PHOTOGRAPHY,
      sports: NFTCategory.SPORTS,
      utility: NFTCategory.UTILITY,
      other: NFTCategory.UNKNOWN,
    } as const;
    return categoryMap[category];
  });

export const nftStandardSchema = z.enum(['ERC721', 'ERC1155', 'SPL']).transform(standard => {
  const standardMap = {
    ERC721: NFTStandard.ERC_721,
    ERC1155: NFTStandard.ERC_1155,
    SPL: NFTStandard.SPL_TOKEN,
  } as const;
  return standardMap[standard];
});

export const portfolioQuerySchema = z.object({
  chains: z
    .string()
    .optional()
    .transform(val => (val ? val.split(',').map(c => chainIdSchema.parse(c.trim())) : undefined)),
  categories: z
    .string()
    .optional()
    .transform(val =>
      val ? val.split(',').map(c => nftCategorySchema.parse(c.trim())) : undefined
    ),
  standards: z
    .string()
    .optional()
    .transform(val =>
      val ? val.split(',').map(s => nftStandardSchema.parse(s.trim())) : undefined
    ),
  includeMetadata: z
    .string()
    .optional()
    .transform(val => val !== 'false'),
  includeListings: z
    .string()
    .optional()
    .transform(val => val === 'true'),
  includeAnalytics: z
    .string()
    .optional()
    .transform(val => val === 'true'),
  forceRefresh: z
    .string()
    .optional()
    .transform(val => val === 'true'),
  minValue: z
    .string()
    .optional()
    .transform(val => (val ? parseFloat(val) : undefined)),
});
