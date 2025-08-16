import { z } from 'zod';
import {
  CuidSchema,
  PositiveNumberSchema,
  NonNegativeNumberSchema,
  FutureDateSchema,
} from './common';

export const PriceCacheCreateSchema = z.object({
  tokenId: CuidSchema,
  priceUSD: PositiveNumberSchema,
  change24h: z.number().optional(),
  change7d: z.number().optional(),
  change30d: z.number().optional(),
  volume24h: NonNegativeNumberSchema.optional(),
  marketCap: NonNegativeNumberSchema.optional(),
  source: z.string().min(1).max(50),
  expiresAt: FutureDateSchema,
});
