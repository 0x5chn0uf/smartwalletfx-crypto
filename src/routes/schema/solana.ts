import { z } from 'zod';
import { SolanaProtocol } from '@/types/solana-defi';

export const solanaAddressSchema = z
  .string()
  .min(32)
  .max(44)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid Solana address format');

export const evmAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address format');

export const solanaProtocolSchema = z
  .enum(['raydium', 'orca', 'serum', 'mango', 'solend', 'kamino', 'meteora'])
  .transform(protocol => {
    const protocolMap = {
      raydium: SolanaProtocol.RAYDIUM,
      orca: SolanaProtocol.ORCA,
      serum: SolanaProtocol.SERUM,
      mango: SolanaProtocol.MANGO,
      solend: SolanaProtocol.SOLEND,
      kamino: SolanaProtocol.KAMINO,
      meteora: SolanaProtocol.METEORA,
    } as const;
    return protocolMap[protocol];
  });

export const solanaQuerySchema = z.object({
  protocols: z
    .string()
    .optional()
    .transform(val =>
      val ? val.split(',').map(p => solanaProtocolSchema.parse(p.trim())) : undefined
    ),
  includeInactive: z
    .string()
    .optional()
    .transform(val => val === 'true'),
  includeYield: z
    .string()
    .optional()
    .transform(val => val !== 'false'),
  includeRisk: z
    .string()
    .optional()
    .transform(val => val === 'true'),
  includeAnalytics: z
    .string()
    .optional()
    .transform(val => val === 'true'),
  minValue: z
    .string()
    .optional()
    .transform(val => (val ? parseFloat(val) : undefined)),
});
