import { z } from 'zod';
import { ChainId } from '@/types/blockchain';
import { DeFiProtocol } from '@/types/defi';

export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

export const chainIdSchema = z
  .enum(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc', 'avalanche'])
  .transform(chain => {
    const chainMap = {
      ethereum: ChainId.ETHEREUM,
      polygon: ChainId.POLYGON,
      arbitrum: ChainId.ARBITRUM,
      optimism: ChainId.OPTIMISM,
      base: ChainId.BASE,
      bsc: ChainId.BSC,
      avalanche: ChainId.AVALANCHE,
    } as const;
    return chainMap[chain];
  });

export const protocolSchema = z
  .enum(['aave-v3', 'compound-v3', 'uniswap-v3', 'curve', 'yearn', 'lido'])
  .transform(protocol => {
    const protocolMap = {
      'aave-v3': DeFiProtocol.AAVE_V3,
      'compound-v3': DeFiProtocol.COMPOUND_V3,
      'uniswap-v3': DeFiProtocol.UNISWAP_V3,
      curve: DeFiProtocol.CURVE,
      yearn: DeFiProtocol.YEARN,
      lido: DeFiProtocol.LIDO,
    } as const;
    return protocolMap[protocol];
  });

export const defiQuerySchema = z.object({
  chains: z
    .string()
    .optional()
    .transform(val => (val ? val.split(',').map(c => chainIdSchema.parse(c.trim())) : undefined)),
  protocols: z
    .string()
    .optional()
    .transform(val => (val ? val.split(',').map(p => protocolSchema.parse(p.trim())) : undefined)),
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
  minValue: z
    .string()
    .optional()
    .transform(val => (val ? parseFloat(val) : 0.01)),
  forceRefresh: z
    .string()
    .optional()
    .transform(val => val === 'true'),
});
