/**
 * Unified Chain Configuration
 * 
 * Single source of truth for blockchain configuration
 * Consolidates disparate config sources as specified in PRD section 6.
 */

import { ChainId } from '@/types/blockchain';

/**
 * Chain configuration interface
 */
export interface ChainConfig {
  id: ChainId;
  name: string;
  displayName: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  enabled: boolean;
  testnet: boolean;
  features: {
    defi: boolean;
    nft: boolean;
    evm: boolean;
  };
  providers: {
    primary: string;
    fallback?: string[];
  };
  rateLimits: {
    requestsPerSecond: number;
    requestsPerMinute: number;
    requestsPerHour: number;
  };
  costs: {
    estimatedCostPerRequest: number; // USD
    priorityLevel: 'low' | 'medium' | 'high';
  };
}

/**
 * Get environment-specific RPC URL with fallback
 */
function getRpcUrl(chainName: string, defaultUrl: string): string {
  const envKey = `${chainName.toUpperCase()}_RPC_URL`;
  return process.env[envKey] || defaultUrl;
}

/**
 * Get environment-specific enabled status
 */
function isChainEnabled(chainName: string, defaultEnabled: boolean = true): boolean {
  const envKey = `ENABLE_${chainName.toUpperCase()}`;
  const envValue = process.env[envKey];
  
  if (envValue === undefined) {
    return defaultEnabled;
  }
  
  return envValue.toLowerCase() === 'true';
}

/**
 * Unified chain configurations
 */
export const UNIFIED_CHAIN_CONFIGS: Record<ChainId, ChainConfig> = {
  [ChainId.ETHEREUM]: {
    id: ChainId.ETHEREUM,
    name: 'ethereum',
    displayName: 'Ethereum',
    rpcUrl: getRpcUrl('ethereum', 'https://eth-mainnet.g.alchemy.com/v2/demo'),
    explorerUrl: 'https://etherscan.io',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    enabled: isChainEnabled('ethereum'),
    testnet: false,
    features: {
      defi: true,
      nft: true,
      evm: true,
    },
    providers: {
      primary: 'alchemy',
      fallback: ['infura', 'quicknode'],
    },
    rateLimits: {
      requestsPerSecond: 10,
      requestsPerMinute: 600,
      requestsPerHour: 36000,
    },
    costs: {
      estimatedCostPerRequest: 0.001,
      priorityLevel: 'high',
    },
  },

  [ChainId.POLYGON]: {
    id: ChainId.POLYGON,
    name: 'polygon',
    displayName: 'Polygon',
    rpcUrl: getRpcUrl('polygon', 'https://polygon-mainnet.g.alchemy.com/v2/demo'),
    explorerUrl: 'https://polygonscan.com',
    nativeCurrency: {
      name: 'MATIC',
      symbol: 'MATIC',
      decimals: 18,
    },
    enabled: isChainEnabled('polygon'),
    testnet: false,
    features: {
      defi: true,
      nft: true,
      evm: true,
    },
    providers: {
      primary: 'alchemy',
      fallback: ['quicknode', 'ankr'],
    },
    rateLimits: {
      requestsPerSecond: 15,
      requestsPerMinute: 900,
      requestsPerHour: 54000,
    },
    costs: {
      estimatedCostPerRequest: 0.0005,
      priorityLevel: 'high',
    },
  },

  [ChainId.ARBITRUM]: {
    id: ChainId.ARBITRUM,
    name: 'arbitrum',
    displayName: 'Arbitrum One',
    rpcUrl: getRpcUrl('arbitrum', 'https://arb-mainnet.g.alchemy.com/v2/demo'),
    explorerUrl: 'https://arbiscan.io',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    enabled: isChainEnabled('arbitrum'),
    testnet: false,
    features: {
      defi: true,
      nft: true,
      evm: true,
    },
    providers: {
      primary: 'alchemy',
      fallback: ['quicknode', 'ankr'],
    },
    rateLimits: {
      requestsPerSecond: 12,
      requestsPerMinute: 720,
      requestsPerHour: 43200,
    },
    costs: {
      estimatedCostPerRequest: 0.0008,
      priorityLevel: 'medium',
    },
  },

  [ChainId.OPTIMISM]: {
    id: ChainId.OPTIMISM,
    name: 'optimism',
    displayName: 'Optimism',
    rpcUrl: getRpcUrl('optimism', 'https://opt-mainnet.g.alchemy.com/v2/demo'),
    explorerUrl: 'https://optimistic.etherscan.io',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    enabled: isChainEnabled('optimism'),
    testnet: false,
    features: {
      defi: true,
      nft: true,
      evm: true,
    },
    providers: {
      primary: 'alchemy',
      fallback: ['quicknode', 'ankr'],
    },
    rateLimits: {
      requestsPerSecond: 12,
      requestsPerMinute: 720,
      requestsPerHour: 43200,
    },
    costs: {
      estimatedCostPerRequest: 0.0008,
      priorityLevel: 'medium',
    },
  },

  [ChainId.BASE]: {
    id: ChainId.BASE,
    name: 'base',
    displayName: 'Base',
    rpcUrl: getRpcUrl('base', 'https://base-mainnet.g.alchemy.com/v2/demo'),
    explorerUrl: 'https://basescan.org',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    enabled: isChainEnabled('base'),
    testnet: false,
    features: {
      defi: true,
      nft: true,
      evm: true,
    },
    providers: {
      primary: 'alchemy',
      fallback: ['quicknode'],
    },
    rateLimits: {
      requestsPerSecond: 10,
      requestsPerMinute: 600,
      requestsPerHour: 36000,
    },
    costs: {
      estimatedCostPerRequest: 0.0008,
      priorityLevel: 'medium',
    },
  },

  [ChainId.BSC]: {
    id: ChainId.BSC,
    name: 'bsc',
    displayName: 'BNB Smart Chain',
    rpcUrl: getRpcUrl('bsc', 'https://bsc-dataseed1.binance.org'),
    explorerUrl: 'https://bscscan.com',
    nativeCurrency: {
      name: 'BNB',
      symbol: 'BNB',
      decimals: 18,
    },
    enabled: isChainEnabled('bsc'),
    testnet: false,
    features: {
      defi: true,
      nft: true,
      evm: true,
    },
    providers: {
      primary: 'ankr',
      fallback: ['quicknode'],
    },
    rateLimits: {
      requestsPerSecond: 8,
      requestsPerMinute: 480,
      requestsPerHour: 28800,
    },
    costs: {
      estimatedCostPerRequest: 0.0003,
      priorityLevel: 'medium',
    },
  },

  [ChainId.AVALANCHE]: {
    id: ChainId.AVALANCHE,
    name: 'avalanche',
    displayName: 'Avalanche',
    rpcUrl: getRpcUrl('avalanche', 'https://api.avax.network/ext/bc/C/rpc'),
    explorerUrl: 'https://snowtrace.io',
    nativeCurrency: {
      name: 'AVAX',
      symbol: 'AVAX',
      decimals: 18,
    },
    enabled: isChainEnabled('avalanche'),
    testnet: false,
    features: {
      defi: true,
      nft: true,
      evm: true,
    },
    providers: {
      primary: 'ankr',
      fallback: ['quicknode'],
    },
    rateLimits: {
      requestsPerSecond: 8,
      requestsPerMinute: 480,
      requestsPerHour: 28800,
    },
    costs: {
      estimatedCostPerRequest: 0.0004,
      priorityLevel: 'low',
    },
  },

  [ChainId.FANTOM]: {
    id: ChainId.FANTOM,
    name: 'fantom',
    displayName: 'Fantom',
    rpcUrl: getRpcUrl('fantom', 'https://rpc.fantom.network'),
    explorerUrl: 'https://ftmscan.com',
    nativeCurrency: {
      name: 'Fantom',
      symbol: 'FTM',
      decimals: 18,
    },
    enabled: isChainEnabled('fantom'),
    testnet: false,
    features: {
      defi: true,
      nft: true,
      evm: true,
    },
    providers: {
      primary: 'ankr',
      fallback: ['quicknode'],
    },
    rateLimits: {
      requestsPerSecond: 6,
      requestsPerMinute: 360,
      requestsPerHour: 21600,
    },
    costs: {
      estimatedCostPerRequest: 0.0002,
      priorityLevel: 'low',
    },
  },

  [ChainId.SOLANA]: {
    id: ChainId.SOLANA,
    name: 'solana',
    displayName: 'Solana',
    rpcUrl: getRpcUrl('solana', 'https://api.mainnet-beta.solana.com'),
    explorerUrl: 'https://explorer.solana.com',
    nativeCurrency: {
      name: 'Solana',
      symbol: 'SOL',
      decimals: 9,
    },
    enabled: isChainEnabled('solana'),
    testnet: false,
    features: {
      defi: true,
      nft: true,
      evm: false,
    },
    providers: {
      primary: 'helius',
      fallback: ['quicknode'],
    },
    rateLimits: {
      requestsPerSecond: 20,
      requestsPerMinute: 1200,
      requestsPerHour: 72000,
    },
    costs: {
      estimatedCostPerRequest: 0.0001,
      priorityLevel: 'medium',
    },
  },
};

/**
 * Get all enabled chains
 */
export function getEnabledChains(): ChainConfig[] {
  return Object.values(UNIFIED_CHAIN_CONFIGS).filter(chain => chain.enabled);
}

/**
 * Get enabled chains by feature
 */
export function getChainsByFeature(feature: keyof ChainConfig['features']): ChainConfig[] {
  return getEnabledChains().filter(chain => chain.features[feature]);
}

/**
 * Get chain config by ID
 */
export function getChainConfig(chainId: ChainId): ChainConfig | undefined {
  return UNIFIED_CHAIN_CONFIGS[chainId];
}

/**
 * Get chain config by name
 */
export function getChainConfigByName(name: string): ChainConfig | undefined {
  return Object.values(UNIFIED_CHAIN_CONFIGS).find(chain => chain.name === name);
}

/**
 * Get all supported chain IDs
 */
export function getSupportedChainIds(): ChainId[] {
  return getEnabledChains().map(chain => chain.id);
}

/**
 * Check if a chain is supported
 */
export function isChainSupported(chainId: ChainId): boolean {
  const config = getChainConfig(chainId);
  return config?.enabled ?? false;
}

/**
 * Get RPC URLs mapping for legacy compatibility
 */
export function getRpcUrlsMapping(): Record<ChainId, string> {
  const mapping: Record<ChainId, string> = {} as Record<ChainId, string>;
  
  Object.values(UNIFIED_CHAIN_CONFIGS).forEach(config => {
    if (config.enabled) {
      mapping[config.id] = config.rpcUrl;
    }
  });
  
  return mapping;
}

/**
 * Validate chain configuration at startup
 */
export function validateChainConfigs(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  const enabledChains = getEnabledChains();
  
  if (enabledChains.length === 0) {
    errors.push('No chains are enabled');
  }
  
  enabledChains.forEach(chain => {
    if (!chain.rpcUrl || chain.rpcUrl.includes('demo')) {
      errors.push(`Chain ${chain.name} has invalid or demo RPC URL`);
    }
    
    if (chain.rateLimits.requestsPerSecond <= 0) {
      errors.push(`Chain ${chain.name} has invalid rate limits`);
    }
    
    if (!chain.nativeCurrency.symbol) {
      errors.push(`Chain ${chain.name} missing native currency symbol`);
    }
  });
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get chain configuration summary for logging
 */
export function getChainConfigSummary(): {
  total: number;
  enabled: number;
  byFeature: Record<string, number>;
  byProvider: Record<string, number>;
} {
  const enabled = getEnabledChains();
  
  const byFeature = {
    defi: enabled.filter(c => c.features.defi).length,
    nft: enabled.filter(c => c.features.nft).length,
    evm: enabled.filter(c => c.features.evm).length,
  };
  
  const byProvider: Record<string, number> = {};
  enabled.forEach(chain => {
    byProvider[chain.providers.primary] = (byProvider[chain.providers.primary] || 0) + 1;
  });
  
  return {
    total: Object.keys(UNIFIED_CHAIN_CONFIGS).length,
    enabled: enabled.length,
    byFeature,
    byProvider,
  };
}