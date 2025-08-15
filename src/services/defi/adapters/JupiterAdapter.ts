/**
 * Jupiter DEX Aggregator Adapter
 * 
 * Provides comprehensive integration with Jupiter for:
 * - DEX aggregation across Solana
 * - Best price routing
 * - Swap execution and monitoring
 * - Historical swap analysis
 */

import axios, { AxiosInstance } from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import {
  SolanaProtocol,
  SolanaPositionType,
  SolanaDeFiPosition,
  JupiterQuote,
  JupiterRoutePlan,
  JupiterSwapInfo,
  JupiterApiResponse,
  SolanaToken,
  SolanaDeFiError,
  WELL_KNOWN_TOKENS,
} from '@/types/solana-defi';

export interface JupiterAdapterConfig {
  apiUrl: string;
  rpcUrl: string;
  timeout: number;
  retries: number;
  cacheSettings: {
    quotes: number;
    tokens: number;
    routes: number;
  };
}

export interface JupiterTokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  tags?: string[];
  verified: boolean;
}

export interface JupiterSwapParams {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps?: number;
  userPublicKey: string;
  wrapUnwrapSOL?: boolean;
  computeUnitPriceMicroLamports?: number;
}

export class JupiterAdapter {
  private readonly config: JupiterAdapterConfig;
  private readonly httpClient: AxiosInstance;
  private readonly connection: Connection;
  private isInitialized = false;

  constructor(config: JupiterAdapterConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    
    this.httpClient = axios.create({
      baseURL: config.apiUrl,
      timeout: config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SmartWalletFX-CryptoData/1.0',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor for logging
    this.httpClient.interceptors.request.use(
      (config) => {
        logger.debug('Jupiter API request', {
          method: config.method,
          url: config.url,
          params: config.params,
        });
        return config;
      },
      (error) => {
        logger.error('Jupiter API request error', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor for error handling and logging
    this.httpClient.interceptors.response.use(
      (response) => {
        logger.debug('Jupiter API response', {
          status: response.status,
          url: response.config.url,
          dataSize: JSON.stringify(response.data).length,
        });
        return response;
      },
      (error) => {
        logger.error('Jupiter API response error', {
          status: error.response?.status,
          message: error.message,
          url: error.config?.url,
        });
        return Promise.reject(error);
      }
    );
  }

  async initialize(): Promise<void> {
    try {
      // Test connection and fetch token list
      await this.getTokenList();
      this.isInitialized = true;
      logger.info('Jupiter adapter initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Jupiter adapter', error);
      throw new SolanaDeFiError({
        code: 'JUPITER_INIT_FAILED',
        message: 'Failed to initialize Jupiter adapter',
        protocol: SolanaProtocol.JUPITER,
        details: { error: error.message },
      });
    }
  }

  /**
   * Get comprehensive token list from Jupiter
   */
  async getTokenList(): Promise<JupiterTokenInfo[]> {
    const cacheKey = 'jupiter:token-list';
    
    try {
      // Try cache first
      const cached = await redisManager.get<JupiterTokenInfo[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const response = await this.httpClient.get<JupiterTokenInfo[]>('/tokens');
      const tokens = response.data;

      // Cache for 1 hour
      await redisManager.set(cacheKey, tokens, this.config.cacheSettings.tokens);
      
      logger.info(`Fetched ${tokens.length} tokens from Jupiter`);
      return tokens;
    } catch (error) {
      logger.error('Failed to fetch Jupiter token list', error);
      throw new SolanaDeFiError({
        code: 'JUPITER_TOKEN_LIST_FAILED',
        message: 'Failed to fetch token list from Jupiter',
        protocol: SolanaProtocol.JUPITER,
        details: { error: error.message },
      });
    }
  }

  /**
   * Get best quote for a swap
   */
  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 50
  ): Promise<JupiterQuote> {
    const cacheKey = `jupiter:quote:${inputMint}:${outputMint}:${amount}:${slippageBps}`;
    
    try {
      // Check cache (shorter TTL for quotes)
      const cached = await redisManager.get<JupiterQuote>(cacheKey);
      if (cached) {
        return cached;
      }

      const params = {
        inputMint,
        outputMint,
        amount: amount.toString(),
        slippageBps: slippageBps.toString(),
        onlyDirectRoutes: 'false',
        asLegacyTransaction: 'false',
      };

      const response = await this.httpClient.get<JupiterQuote>('/quote', { params });
      const quote = response.data;

      // Cache for 30 seconds (quotes change quickly)
      await redisManager.set(cacheKey, quote, this.config.cacheSettings.quotes);
      
      return quote;
    } catch (error) {
      logger.error('Failed to get Jupiter quote', {
        inputMint,
        outputMint,
        amount,
        error: error.message,
      });
      throw new SolanaDeFiError({
        code: 'JUPITER_QUOTE_FAILED',
        message: 'Failed to get quote from Jupiter',
        protocol: SolanaProtocol.JUPITER,
        details: { inputMint, outputMint, amount, error: error.message },
      });
    }
  }

  /**
   * Get swap transaction
   */
  async getSwapTransaction(swapParams: JupiterSwapParams): Promise<string> {
    try {
      const quote = await this.getQuote(
        swapParams.inputMint,
        swapParams.outputMint,
        swapParams.amount,
        swapParams.slippageBps
      );

      const swapRequest = {
        quoteResponse: quote,
        userPublicKey: swapParams.userPublicKey,
        wrapUnwrapSOL: swapParams.wrapUnwrapSOL ?? true,
        computeUnitPriceMicroLamports: swapParams.computeUnitPriceMicroLamports,
      };

      const response = await this.httpClient.post<{ swapTransaction: string }>('/swap', swapRequest);
      return response.data.swapTransaction;
    } catch (error) {
      logger.error('Failed to get Jupiter swap transaction', {
        swapParams,
        error: error.message,
      });
      throw new SolanaDeFiError({
        code: 'JUPITER_SWAP_TX_FAILED',
        message: 'Failed to get swap transaction from Jupiter',
        protocol: SolanaProtocol.JUPITER,
        details: { swapParams, error: error.message },
      });
    }
  }

  /**
   * Get user's swap history and analyze trading patterns
   */
  async getSwapHistory(userAddress: string, limit: number = 100): Promise<JupiterSwapInfo[]> {
    const cacheKey = `jupiter:history:${userAddress}:${limit}`;
    
    try {
      // Check cache first
      const cached = await redisManager.get<JupiterSwapInfo[]>(cacheKey);
      if (cached) {
        return cached;
      }

      // Get transaction signatures for the user
      const publicKey = new PublicKey(userAddress);
      const signatures = await this.connection.getSignaturesForAddress(publicKey, { limit });

      const swapHistory: JupiterSwapInfo[] = [];

      // Analyze each transaction to identify Jupiter swaps
      for (const sig of signatures) {
        try {
          const tx = await this.connection.getTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
          });

          if (!tx || tx.meta?.err) continue;

          // Check if this is a Jupiter swap
          const jupiterSwap = await this.parseJupiterSwap(tx, userAddress);
          if (jupiterSwap) {
            swapHistory.push(jupiterSwap);
          }
        } catch (error) {
          logger.debug('Failed to parse transaction', { signature: sig.signature, error: error.message });
        }
      }

      // Cache for 5 minutes
      await redisManager.set(cacheKey, swapHistory, 300);
      
      return swapHistory;
    } catch (error) {
      logger.error('Failed to get Jupiter swap history', {
        userAddress,
        error: error.message,
      });
      throw new SolanaDeFiError({
        code: 'JUPITER_HISTORY_FAILED',
        message: 'Failed to get swap history from Jupiter',
        protocol: SolanaProtocol.JUPITER,
        details: { userAddress, error: error.message },
      });
    }
  }

  /**
   * Parse transaction to extract Jupiter swap information
   */
  private async parseJupiterSwap(tx: any, userAddress: string): Promise<JupiterSwapInfo | null> {
    try {
      // Check if transaction involves Jupiter program
      const jupiterPrograms = ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB'];
      const hasJupiterProgram = tx.transaction.message.accountKeys.some((key: any) =>
        jupiterPrograms.includes(key.toString())
      );

      if (!hasJupiterProgram) return null;

      // Parse token changes to identify swap
      const preBalances = tx.meta?.preTokenBalances || [];
      const postBalances = tx.meta?.postTokenBalances || [];

      const changes = this.calculateTokenChanges(preBalances, postBalances, userAddress);
      
      if (changes.length < 2) return null; // Should have at least input and output tokens

      const inputChange = changes.find(c => c.amount < 0); // Decreased token (input)
      const outputChange = changes.find(c => c.amount > 0); // Increased token (output)

      if (!inputChange || !outputChange) return null;

      return {
        signature: tx.transaction.signatures[0],
        inputToken: await this.getTokenInfo(inputChange.mint),
        outputToken: await this.getTokenInfo(outputChange.mint),
        inputAmount: Math.abs(inputChange.amount),
        outputAmount: outputChange.amount,
        priceImpact: this.calculatePriceImpact(inputChange, outputChange),
        route: this.extractRoute(tx),
        fee: this.calculateFee(tx),
        timestamp: tx.blockTime || Date.now() / 1000,
      };
    } catch (error) {
      logger.debug('Failed to parse Jupiter swap', { error: error.message });
      return null;
    }
  }

  /**
   * Calculate token balance changes from transaction
   */
  private calculateTokenChanges(preBalances: any[], postBalances: any[], userAddress: string) {
    const changes: { mint: string; amount: number }[] = [];
    
    // Create maps for easier comparison
    const preMap = new Map();
    const postMap = new Map();

    preBalances.filter(b => b.owner === userAddress).forEach(balance => {
      preMap.set(balance.mint, balance.uiTokenAmount.uiAmount || 0);
    });

    postBalances.filter(b => b.owner === userAddress).forEach(balance => {
      postMap.set(balance.mint, balance.uiTokenAmount.uiAmount || 0);
    });

    // Calculate changes
    const allMints = new Set([...preMap.keys(), ...postMap.keys()]);
    
    for (const mint of allMints) {
      const preBal = preMap.get(mint) || 0;
      const postBal = postMap.get(mint) || 0;
      const change = postBal - preBal;
      
      if (Math.abs(change) > 0.000001) { // Filter out dust
        changes.push({ mint, amount: change });
      }
    }

    return changes;
  }

  /**
   * Get token information by mint address
   */
  private async getTokenInfo(mint: string): Promise<SolanaToken> {
    // Check well-known tokens first
    const wellKnown = Object.values(WELL_KNOWN_TOKENS).find(token => token.mint === mint);
    if (wellKnown) return wellKnown;

    // Fetch from token list
    const tokens = await this.getTokenList();
    const token = tokens.find(t => t.address === mint);
    
    if (token) {
      return {
        mint: token.address,
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        logoURI: token.logoURI,
        verified: token.verified,
        tags: token.tags,
      };
    }

    // Fallback for unknown tokens
    return {
      mint,
      name: 'Unknown Token',
      symbol: mint.slice(0, 8),
      decimals: 9,
      verified: false,
    };
  }

  /**
   * Calculate price impact from swap
   */
  private calculatePriceImpact(inputChange: any, outputChange: any): number {
    // This is a simplified calculation
    // In practice, you'd need token prices to calculate accurate price impact
    return 0; // TODO: Implement proper price impact calculation
  }

  /**
   * Extract routing information from transaction
   */
  private extractRoute(tx: any): string[] {
    // This would parse the transaction logs to extract the actual route taken
    // For now, return a placeholder
    return ['Jupiter Aggregated Route'];
  }

  /**
   * Calculate transaction fee
   */
  private calculateFee(tx: any): number {
    return tx.meta?.fee || 0;
  }

  /**
   * Get Jupiter positions for a user
   */
  async getUserPositions(userAddress: string): Promise<SolanaDeFiPosition[]> {
    try {
      const swapHistory = await this.getSwapHistory(userAddress, 50);
      
      // Jupiter doesn't have "positions" in the traditional sense,
      // but we can create a summary of recent trading activity
      const position: SolanaDeFiPosition = {
        id: `jupiter-${userAddress}`,
        protocol: SolanaProtocol.JUPITER,
        type: SolanaPositionType.SWAP,
        account: userAddress,
        tokens: [], // Jupiter is a DEX aggregator, no static token positions
        value: 0,
        lastUpdated: Date.now(),
        metadata: {
          totalSwaps: swapHistory.length,
          recentSwaps: swapHistory.slice(0, 10),
          totalVolume: swapHistory.reduce((sum, swap) => sum + swap.inputAmount, 0),
        },
      };

      return [position];
    } catch (error) {
      logger.error('Failed to get Jupiter positions', {
        userAddress,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Health check for Jupiter service
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.httpClient.get('/health', { timeout: 5000 });
      return response.status === 200;
    } catch (error) {
      logger.warn('Jupiter health check failed', { error: error.message });
      return false;
    }
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      protocol: SolanaProtocol.JUPITER,
      isInitialized: this.isInitialized,
      config: {
        apiUrl: this.config.apiUrl,
        timeout: this.config.timeout,
        retries: this.config.retries,
      },
    };
  }
}

export default JupiterAdapter;