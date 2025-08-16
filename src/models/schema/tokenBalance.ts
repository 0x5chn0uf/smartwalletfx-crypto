import { z } from 'zod';
import { CuidSchema, DecimalStringSchema } from './common';

export const TokenBalanceCreateSchema = z.object({
  walletId: CuidSchema,
  tokenId: CuidSchema,
  balance: DecimalStringSchema,
  balanceFormatted: z.string().min(1),
  balanceUSD: z.number().min(0).optional(),
  priceUSD: z.number().min(0).optional(),
  change24h: z.number().optional(),
  blockNumber: z.bigint().optional(),
});

export const TokenBalanceUpdateSchema = TokenBalanceCreateSchema.partial();
