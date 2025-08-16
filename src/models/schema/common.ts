import { z } from 'zod';

export const AddressSchema = z.string().min(1, 'Address is required');
export const ChainIdSchema = z.string().min(1, 'Chain ID is required');
export const CuidSchema = z.string().cuid('Invalid ID format');
export const UUIDSchema = z.string().uuid('Invalid UUID format');
export const HashSchema = z.string().regex(/^0x[a-fA-F0-9]+$/, 'Invalid hash format');
export const UrlSchema = z.string().url('Invalid URL format');

export const PositiveNumberSchema = z.number().positive('Must be a positive number');
export const NonNegativeNumberSchema = z.number().min(0, 'Must be non-negative');
export const PercentageSchema = z.number().min(0).max(100, 'Must be between 0 and 100');
export const DecimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, 'Invalid decimal format');

export const FutureDateSchema = z
  .date()
  .refine(date => date > new Date(), 'Date must be in the future');
export const PastDateSchema = z
  .date()
  .refine(date => date <= new Date(), 'Date must be in the past or present');

export const PaginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});
