import { z } from 'zod';
import { AddressSchema, ChainIdSchema } from './common';

export const UserWalletCreateSchema = z.object({
  address: AddressSchema,
  chainId: ChainIdSchema,
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().default(true),
});

export const UserWalletUpdateSchema = UserWalletCreateSchema.partial();

export const UserWalletQuerySchema = z.object({
  address: AddressSchema.optional(),
  chainId: ChainIdSchema.optional(),
  isActive: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['createdAt', 'updatedAt', 'lastSyncAt', 'address']).default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
