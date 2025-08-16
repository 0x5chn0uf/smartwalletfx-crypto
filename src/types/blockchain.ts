import { z } from 'zod';

// Supported blockchain networks
export enum ChainId {
  ETHEREUM = 1,
  POLYGON = 137,
  ARBITRUM = 42161,
  OPTIMISM = 10,
  BASE = 8453,
  BSC = 56,
  AVALANCHE = 43114,
  FANTOM = 250,
  SOLANA = 'solana', // Special case for Solana
}

// Chain configuration
export interface ChainConfig {
  id: ChainId;
  name: string;
  symbol: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  isTestnet: boolean;
  features: {
    eip1559: boolean;
    multicall: boolean;
  };
}

// Token information
export const TokenSchema = z.object({
  address: z.string(),
  chainId: z.union([z.number(), z.literal('solana')]),
  symbol: z.string(),
  name: z.string(),
  decimals: z.number(),
  logoUrl: z.string().optional(),
  coingeckoId: z.string().optional(),
  isNative: z.boolean().default(false),
});

export type Token = z.infer<typeof TokenSchema>;

// Token balance
export const TokenBalanceSchema = z.object({
  token: TokenSchema,
  balance: z.string(), // Raw balance as string to handle large numbers
  balanceFormatted: z.string(), // Human-readable format
  balanceUSD: z.number().optional(),
  priceUSD: z.number().optional(),
  change24h: z.number().optional(),
  lastUpdated: z.date(),
  blockNumber: z.number().optional(),
});

export type TokenBalance = z.infer<typeof TokenBalanceSchema>;

// Portfolio summary
export const PortfolioSummarySchema = z.object({
  address: z.string(),
  chainId: z.union([z.number(), z.literal('solana')]),
  totalValueUSD: z.number(),
  tokenCount: z.number(),
  tokens: z.array(TokenBalanceSchema),
  nativeBalance: TokenBalanceSchema.optional(),
  lastUpdated: z.date(),
});

export type PortfolioSummary = z.infer<typeof PortfolioSummarySchema>;

// Multi-chain portfolio
export const MultiChainPortfolioSchema = z.object({
  address: z.string(),
  totalValueUSD: z.number(),
  chains: z.array(PortfolioSummarySchema),
  topTokens: z.array(TokenBalanceSchema),
  diversificationScore: z.number().min(0).max(100),
  lastUpdated: z.date(),
  metadata: z.object({
    fetchTimeMs: z.number(),
    chainCount: z.number(),
    totalTokens: z.number(),
    cacheHitRate: z.number().optional(),
  }),
});

export type MultiChainPortfolio = z.infer<typeof MultiChainPortfolioSchema>;

// Transaction data
export const TransactionSchema = z.object({
  hash: z.string(),
  chainId: z.union([z.number(), z.literal('solana')]),
  from: z.string(),
  to: z.string().optional(),
  value: z.string(),
  valueUSD: z.number().optional(),
  gasPrice: z.string().optional(),
  gasUsed: z.string().optional(),
  gasLimit: z.string().optional(),
  status: z.enum(['pending', 'confirmed', 'failed']),
  blockNumber: z.number().optional(),
  timestamp: z.date(),
  tokenTransfers: z
    .array(
      z.object({
        token: TokenSchema,
        from: z.string(),
        to: z.string(),
        amount: z.string(),
        amountFormatted: z.string(),
        amountUSD: z.number().optional(),
      })
    )
    .optional(),
});

export type Transaction = z.infer<typeof TransactionSchema>;

// Provider response types
export interface ProviderResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata: {
    provider: string;
    chainId: ChainId;
    timestamp: number;
    requestId: string;
    cacheTtl?: number;
    cost?: number; // Estimated API cost in USD
    attempts?: number; // Number of retry attempts made
    totalTime?: number; // Total time including retries
  };
}

// Chain provider interface
export interface ChainProvider {
  readonly chainId: ChainId;
  readonly name: string;
  readonly isHealthy: boolean;

  // Core methods
  initialize(): Promise<void>;
  healthCheck(): Promise<boolean>;
  getBalance(address: string): Promise<ProviderResponse<TokenBalance[]>>;
  getTokenBalance(address: string, tokenAddress: string): Promise<ProviderResponse<TokenBalance>>;
  getTransaction(hash: string): Promise<ProviderResponse<Transaction>>;
  getTransactionHistory(
    address: string,
    options?: {
      limit?: number;
      offset?: number;
      startBlock?: number;
      endBlock?: number;
    }
  ): Promise<ProviderResponse<Transaction[]>>;

  // Utility methods
  isValidAddress(address: string): boolean;
  formatAddress(address: string): string;
  getExplorerUrl(hash: string): string;
  
  // Lifecycle methods
  stop?(): Promise<void>;
}

// Provider configuration
export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  rateLimit: {
    requestsPerSecond: number;
    requestsPerMinute: number;
    requestsPerHour: number;
  };
  timeout: number;
  retries: number;
  cacheTtl: {
    balance: number;
    transaction: number;
    token: number;
  };
  costPerRequest: number; // USD cost per API request
}

// Error types
export class ChainProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly chainId: ChainId,
    public readonly code: string,
    public readonly isRetryable: boolean = false
  ) {
    super(message);
    this.name = 'ChainProviderError';
  }
}

export class InvalidAddressError extends ChainProviderError {
  constructor(address: string, provider: string, chainId: ChainId) {
    super(`Invalid address: ${address}`, provider, chainId, 'INVALID_ADDRESS', false);
  }
}

export class RateLimitError extends ChainProviderError {
  constructor(provider: string, chainId: ChainId) {
    super('Rate limit exceeded', provider, chainId, 'RATE_LIMIT_EXCEEDED', true);
  }
}

export class NetworkError extends ChainProviderError {
  constructor(provider: string, chainId: ChainId, originalError?: Error) {
    super(
      `Network error: ${originalError?.message || 'Unknown error'}`,
      provider,
      chainId,
      'NETWORK_ERROR',
      true
    );
  }
}

// Chain registry
export const CHAIN_CONFIGS: Record<ChainId, ChainConfig> = {
  [ChainId.ETHEREUM]: {
    id: ChainId.ETHEREUM,
    name: 'Ethereum',
    symbol: 'ETH',
    rpcUrl: 'https://eth-mainnet.alchemyapi.io/v2/',
    explorerUrl: 'https://etherscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    isTestnet: false,
    features: { eip1559: true, multicall: true },
  },
  [ChainId.BSC]: {
    id: ChainId.BSC,
    name: 'BNB Smart Chain',
    symbol: 'BNB',
    rpcUrl: 'https://bsc-dataseed.binance.org',
    explorerUrl: 'https://bscscan.com',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    isTestnet: false,
    features: { eip1559: false, multicall: true },
  },
  [ChainId.POLYGON]: {
    id: ChainId.POLYGON,
    name: 'Polygon',
    symbol: 'MATIC',
    rpcUrl: 'https://polygon-mainnet.alchemyapi.io/v2/',
    explorerUrl: 'https://polygonscan.com',
    nativeCurrency: { name: 'Polygon', symbol: 'MATIC', decimals: 18 },
    isTestnet: false,
    features: { eip1559: true, multicall: true },
  },
  [ChainId.AVALANCHE]: {
    id: ChainId.AVALANCHE,
    name: 'Avalanche',
    symbol: 'AVAX',
    rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
    explorerUrl: 'https://snowtrace.io',
    nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
    isTestnet: false,
    features: { eip1559: true, multicall: true },
  },
  [ChainId.ARBITRUM]: {
    id: ChainId.ARBITRUM,
    name: 'Arbitrum One',
    symbol: 'ETH',
    rpcUrl: 'https://arb-mainnet.alchemyapi.io/v2/',
    explorerUrl: 'https://arbiscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    isTestnet: false,
    features: { eip1559: true, multicall: true },
  },
  [ChainId.OPTIMISM]: {
    id: ChainId.OPTIMISM,
    name: 'Optimism',
    symbol: 'ETH',
    rpcUrl: 'https://opt-mainnet.alchemyapi.io/v2/',
    explorerUrl: 'https://optimistic.etherscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    isTestnet: false,
    features: { eip1559: true, multicall: true },
  },
  [ChainId.BASE]: {
    id: ChainId.BASE,
    name: 'Base',
    symbol: 'ETH',
    rpcUrl: 'https://base-mainnet.alchemyapi.io/v2/',
    explorerUrl: 'https://basescan.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    isTestnet: false,
    features: { eip1559: true, multicall: true },
  },
  [ChainId.FANTOM]: {
    id: ChainId.FANTOM,
    name: 'Fantom',
    symbol: 'FTM',
    rpcUrl: 'https://rpc.ftm.tools',
    explorerUrl: 'https://ftmscan.com',
    nativeCurrency: { name: 'Fantom', symbol: 'FTM', decimals: 18 },
    isTestnet: false,
    features: { eip1559: false, multicall: true },
  },
  [ChainId.SOLANA]: {
    id: ChainId.SOLANA,
    name: 'Solana',
    symbol: 'SOL',
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    explorerUrl: 'https://solscan.io',
    nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9 },
    isTestnet: false,
    features: { eip1559: false, multicall: false },
  },
};

// Validation helpers
export const validateAddress = (address: string, chainId: ChainId): boolean => {
  if (chainId === ChainId.SOLANA) {
    // Solana address validation (base58, 32-44 characters)
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  } else {
    // EVM address validation (0x + 40 hex characters)
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }
};

export const formatAddress = (address: string, chainId: ChainId): string => {
  if (chainId === ChainId.SOLANA) {
    return address; // Solana addresses are already properly formatted
  } else {
    return address.toLowerCase(); // EVM addresses to lowercase
  }
};

// RPC URL constants
export const CHAIN_RPC_URLS: Record<ChainId, string> = {
  [ChainId.ETHEREUM]: 'https://eth-mainnet.alchemyapi.io/v2/',
  [ChainId.POLYGON]: 'https://polygon-mainnet.alchemyapi.io/v2/',
  [ChainId.ARBITRUM]: 'https://arb-mainnet.alchemyapi.io/v2/',
  [ChainId.OPTIMISM]: 'https://opt-mainnet.alchemyapi.io/v2/',
  [ChainId.BASE]: 'https://base-mainnet.alchemyapi.io/v2/',
  [ChainId.BSC]: 'https://bsc-dataseed.binance.org',
  [ChainId.AVALANCHE]: 'https://api.avax.network/ext/bc/C/rpc',
  [ChainId.FANTOM]: 'https://rpc.ftm.tools',
  [ChainId.SOLANA]: 'https://api.mainnet-beta.solana.com',
};

// Common token addresses
export const COMMON_TOKENS: Record<ChainId, Record<string, Partial<Token>>> = {
  [ChainId.FANTOM]: {
    USDC: { symbol: 'USDC', address: '0x04068DA6C83AFCFA0e13ba15A6696662335D5B75', decimals: 6 },
    USDT: { symbol: 'USDT', address: '0x049d68029688eAbF473097a2fC38ef61633A3C7A', decimals: 6 },
    DAI: { symbol: 'DAI', address: '0x8D11eC38a3EB5E956B052f67Da8Bdc9bef8Abf3E', decimals: 18 },
  },
  [ChainId.ETHEREUM]: {
    USDC: { symbol: 'USDC', address: '0xA0b86991c6218B36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    USDT: { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    WETH: { symbol: 'WETH', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
    DAI: { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
  },
  [ChainId.BSC]: {
    USDT: { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    USDC: { symbol: 'USDC', address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', decimals: 18 },
    WBNB: { symbol: 'WBNB', address: '0xBB4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18 },
  },
  [ChainId.POLYGON]: {
    USDC: { symbol: 'USDC', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimals: 6 },
    USDT: { symbol: 'USDT', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    WETH: { symbol: 'WETH', address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimals: 18 },
    WMATIC: {
      symbol: 'WMATIC',
      address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      decimals: 18,
    },
  },
  [ChainId.AVALANCHE]: {
    USDC: { symbol: 'USDC', address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6 },
    USDT_e: {
      symbol: 'USDT.e',
      address: '0xc7198437980c041c805A1EDcbA50c1Ce5db95118',
      decimals: 6,
    },
    WAVAX: { symbol: 'WAVAX', address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', decimals: 18 },
  },
  [ChainId.ARBITRUM]: {
    USDC: { symbol: 'USDC', address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', decimals: 6 },
    USDT: { symbol: 'USDT', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    WETH: { symbol: 'WETH', address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 },
    ARB: { symbol: 'ARB', address: '0x912CE59144191C1204E64559FE8253a0e49E6548', decimals: 18 },
  },
  [ChainId.OPTIMISM]: {
    USDC: { symbol: 'USDC', address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', decimals: 6 },
    USDT: { symbol: 'USDT', address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6 },
    WETH: { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18 },
    OP: { symbol: 'OP', address: '0x4200000000000000000000000000000000000042', decimals: 18 },
  },
  [ChainId.BASE]: {
    USDbC: { symbol: 'USDbC', address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', decimals: 6 },
    WETH: { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18 },
  },
  [ChainId.SOLANA]: {
    USDC: { symbol: 'USDC', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
    USDT: { symbol: 'USDT', address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
    SOL: {
      symbol: 'SOL',
      address: 'So11111111111111111111111111111111111111112',
      decimals: 9,
      isNative: true,
    },
  },
};
