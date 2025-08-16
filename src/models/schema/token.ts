import { z } from 'zod';
import { AddressSchema, ChainIdSchema, UrlSchema } from './common';

export const TokenCreateSchema = z.object({
  address: AddressSchema,
  chainId: ChainIdSchema,
  symbol: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
  decimals: z.number().int().min(0).max(18),
  logoUrl: UrlSchema.optional(),
  coingeckoId: z.string().min(1).max(50).optional(),
  isNative: z.boolean().default(false),
  isStable: z.boolean().default(false),
});

export const TokenUpdateSchema = TokenCreateSchema.partial();

export const TokenQuerySchema = z.object({
  chainId: ChainIdSchema.optional(),
  symbol: z.string().optional(),
  isNative: z.boolean().optional(),
  isStable: z.boolean().optional(),
  search: z.string().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(50),
  sortBy: z.enum(['symbol', 'name', 'createdAt', 'updatedAt']).default('symbol'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});
