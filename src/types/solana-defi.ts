/**
 * Solana DeFi Types and Interfaces
 *
 * Comprehensive type definitions for Solana DeFi protocols including
 * Jupiter, Marinade, Orca, Serum, and other ecosystem protocols.
 */

export enum SolanaProtocol {
  JUPITER = 'jupiter',
  MARINADE = 'marinade',
  ORCA = 'orca',
  SERUM = 'serum',
  RAYDIUM = 'raydium',
  DRIFT = 'drift',
  MANGO = 'mango',
  KAMINO = 'kamino',
  SOLEND = 'solend',
  METEORA = 'meteora',
  JITO = 'jito',
  SANCTUM = 'sanctum',
}

export enum SolanaPositionType {
  SWAP = 'swap',
  LIQUIDITY = 'liquidity',
  STAKING = 'staking',
  LENDING = 'lending',
  BORROWING = 'borrowing',
  FARMING = 'farming',
  PERP_TRADING = 'perp_trading',
  OPTIONS = 'options',
}

// Jupiter DEX Aggregator Types
export interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: 'ExactIn' | 'ExactOut';
  slippageBps: number;
  platformFee?: {
    amount: string;
    feeBps: number;
  };
  priceImpactPct: string;
  routePlan: JupiterRoutePlan[];
}

export interface JupiterRoutePlan {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
  percent: number;
}

export interface JupiterSwapInfo {
  signature: string;
  inputToken: SolanaToken;
  outputToken: SolanaToken;
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
  route: string[];
  fee: number;
  timestamp: number;
}

// Marinade Liquid Staking Types
export interface MarinadeStakeAccount {
  account: string;
  stakeAmount: number;
  marinadeAmount: number;
  delegatedValidator: string;
  apy: number;
  unstakeAvailable: boolean;
  cooldownEnd?: number;
  rewards: {
    accumulated: number;
    claimed: number;
    pending: number;
  };
}

export interface MarinadeValidatorInfo {
  voteAccount: string;
  name: string;
  commission: number;
  apy: number;
  stake: number;
  score: number;
  isActive: boolean;
}

// Orca AMM Types
export interface OrcaPool {
  address: string;
  tokenA: SolanaToken;
  tokenB: SolanaToken;
  tokenABalance: number;
  tokenBBalance: number;
  lpTokenSupply: number;
  fee: number;
  volume24h: number;
  tvl: number;
  apy: number;
}

export interface OrcaLiquidityPosition {
  poolAddress: string;
  lpTokens: number;
  tokenAAmount: number;
  tokenBAmount: number;
  value: number;
  share: number;
  rewards: {
    pending: number;
    claimed: number;
    tokenMint: string;
  }[];
  impermanentLoss: number;
}

export interface OrcaWhirlpool {
  address: string;
  tokenA: SolanaToken;
  tokenB: SolanaToken;
  tickSpacing: number;
  fee: number;
  sqrtPrice: number;
  liquidity: number;
  tick: number;
  volume24h: number;
  tvl: number;
  apy: number;
}

// Raydium AMM Types
export interface RaydiumPool {
  id: string;
  baseMint: string;
  quoteMint: string;
  baseReserve: number;
  quoteReserve: number;
  lpMint: string;
  lpSupply: number;
  fee: number;
  volume24h: number;
  apy: number;
}

export interface RaydiumFarmInfo {
  id: string;
  poolId: string;
  rewardTokens: SolanaToken[];
  apy: number;
  tvl: number;
  userStaked: number;
  pendingRewards: {
    token: string;
    amount: number;
  }[];
}

// Serum DEX Types
export interface SerumMarket {
  address: string;
  name: string;
  baseMint: string;
  quoteMint: string;
  baseVault: string;
  quoteVault: string;
  bids: string;
  asks: string;
  eventQueue: string;
  volume24h: number;
  price: number;
  spread: number;
}

export interface SerumOpenOrder {
  market: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  orderId: string;
  clientId: string;
  openOrdersAddress: string;
}

// General Solana DeFi Types
export interface SolanaToken {
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  price?: number;
  verified: boolean;
  tags?: string[];
}

export interface SolanaDeFiPosition {
  id: string;
  protocol: SolanaProtocol;
  type: SolanaPositionType;
  account: string;
  tokens: {
    mint: string;
    amount: number;
    value: number;
  }[];
  value: number;
  apy?: number;
  healthRatio?: number;
  lastUpdated: number;
  metadata: Record<string, any>;
}

export interface SolanaPortfolio {
  address: string;
  totalValue: number;
  nativeBalance: number;
  tokenBalances: {
    mint: string;
    amount: number;
    value: number;
    token: SolanaToken;
  }[];
  defiPositions: SolanaDeFiPosition[];
  stakingPositions: MarinadeStakeAccount[];
  liquidityPositions: (OrcaLiquidityPosition | RaydiumFarmInfo)[];
  openOrders: SerumOpenOrder[];
  lastUpdated: number;
}

// API Response Types
export interface JupiterApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

export interface MarinadeApiResponse<T> {
  success: boolean;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

export interface OrcaApiResponse<T> {
  data?: T;
  error?: string;
  status: number;
}

// Configuration Types
export interface SolanaProviderConfig {
  rpcUrl: string;
  heliusApiKey?: string;
  jupiterApiUrl?: string;
  marinadeApiUrl?: string;
  orcaApiUrl?: string;
  timeout: number;
  retries: number;
  cacheSettings: {
    portfolio: number;
    positions: number;
    tokens: number;
    pools: number;
  };
}

// Error Types
export interface SolanaDeFiError {
  code: string;
  message: string;
  protocol?: SolanaProtocol;
  account?: string;
  details?: Record<string, any>;
}

// Analytics Types
export interface SolanaPortfolioAnalytics {
  totalValue: number;
  dayChange: number;
  weekChange: number;
  monthChange: number;
  protocolDistribution: {
    protocol: SolanaProtocol;
    value: number;
    percentage: number;
  }[];
  riskMetrics: {
    concentrationRisk: number;
    liquidityRisk: number;
    protocolRisk: number;
    overallRisk: 'low' | 'medium' | 'high';
  };
  yieldSummary: {
    totalYield: number;
    averageApy: number;
    bestPosition: {
      protocol: SolanaProtocol;
      apy: number;
      value: number;
    };
  };
}

// Utility Types
export type SolanaAddress = string;
export type SolanaTxSignature = string;
export type SolanaBlockTime = number;

// Constants
export const SOLANA_NATIVE_MINT = 'So11111111111111111111111111111111111111112';
export const WSOL_MINT = '11111111111111111111111111111111';

export const WELL_KNOWN_TOKENS: Record<string, SolanaToken> = {
  SOL: {
    mint: SOLANA_NATIVE_MINT,
    name: 'Solana',
    symbol: 'SOL',
    decimals: 9,
    verified: true,
  },
  USDC: {
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    verified: true,
  },
  USDT: {
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    name: 'Tether USD',
    symbol: 'USDT',
    decimals: 6,
    verified: true,
  },
  mSOL: {
    mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
    name: 'Marinade Staked SOL',
    symbol: 'mSOL',
    decimals: 9,
    verified: true,
  },
  JUP: {
    mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    name: 'Jupiter',
    symbol: 'JUP',
    decimals: 6,
    verified: true,
  },
  ORCA: {
    mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
    name: 'Orca',
    symbol: 'ORCA',
    decimals: 6,
    verified: true,
  },
  RAY: {
    mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    name: 'Raydium',
    symbol: 'RAY',
    decimals: 6,
    verified: true,
  },
};

export const PROTOCOL_PROGRAM_IDS: Record<SolanaProtocol, string[]> = {
  [SolanaProtocol.JUPITER]: [
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter V6
    'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', // Jupiter V4
  ],
  [SolanaProtocol.MARINADE]: [
    'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD', // Marinade
  ],
  [SolanaProtocol.ORCA]: [
    '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', // Orca
    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Whirlpools
  ],
  [SolanaProtocol.SERUM]: [
    '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', // Serum DEX V3
  ],
  [SolanaProtocol.RAYDIUM]: [
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM
    'EhhTKczWMGQt46ynNeRX1WfeagwwJd7ufHvCDjRxjo5Q', // Raydium Staking
  ],
  [SolanaProtocol.DRIFT]: [
    'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH', // Drift Protocol
  ],
  [SolanaProtocol.MANGO]: [
    '4MangoMjqJ2firMokCjjGgoK8d4MXcrgL7XJaL3w6fVg', // Mango Markets V4
  ],
  [SolanaProtocol.KAMINO]: [
    'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD', // Kamino Lending
  ],
  [SolanaProtocol.JITO]: [
    'Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb', // Jito Staking
  ],
  [SolanaProtocol.SANCTUM]: [
    'sanctDT45W5nLSZeEtQTSk8RV2HpqQUiXsrAVJ7wKUU', // Sanctum LST
  ],
};
