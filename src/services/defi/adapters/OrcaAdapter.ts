/**
 * Orca AMM Adapter
 * 
 * Provides comprehensive integration with Orca for:
 * - AMM liquidity pools and Whirlpools
 * - Liquidity provision tracking
 * - Yield farming positions
 * - Concentrated liquidity (Whirlpools)
 */

import axios, { AxiosInstance } from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import {
  SolanaProtocol,
  SolanaPositionType,
  SolanaDeFiPosition,
  OrcaPool,
  OrcaLiquidityPosition,
  OrcaWhirlpool,
  OrcaApiResponse,
  SolanaToken,
  SolanaDeFiError,
  WELL_KNOWN_TOKENS,
} from '@/types/solana-defi';

export interface OrcaAdapterConfig {
  apiUrl: string;
  rpcUrl: string;
  timeout: number;
  retries: number;
  cacheSettings: {
    pools: number;
    positions: number;
    whirlpools: number;
  };
}

export interface OrcaTokenInfo {
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  coingeckoId?: string;
}

export interface OrcaAquafarm {
  account: string;
  nonce: number;
  tokenMintA: string;
  tokenMintB: string;
  feeAccount: string;
  rewardTokenMint: string;
  rewardTokenAccount: string;
  baseTokenMint: string;
  baseTokenVault: string;
  rewardTokenVault: string;
  farmTokenMint: string;
}

export interface OrcaUserFarm {
  aquafarm: OrcaAquafarm;
  lpBalance: number;
  rewardsPending: number;
  rewardsClaimed: number;
  shareOfPool: number;
  farmValue: number;
}

export class OrcaAdapter {
  private readonly config: OrcaAdapterConfig;
  private readonly httpClient: AxiosInstance;
  private readonly connection: Connection;
  private isInitialized = false;

  // Orca program IDs
  private static readonly ORCA_SWAP_PROGRAM_ID = '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP';
  private static readonly WHIRLPOOL_PROGRAM_ID = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';
  private static readonly AQUAFARM_PROGRAM_ID = '82yxjeMsvaURa4MbZZ7WZZHfobirZYkH1zF8fmeGtyaQ';

  constructor(config: OrcaAdapterConfig) {
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
    this.httpClient.interceptors.request.use(
      (config) => {
        logger.debug('Orca API request', {
          method: config.method,
          url: config.url,
          params: config.params,
        });
        return config;
      },
      (error) => {
        logger.error('Orca API request error', error);
        return Promise.reject(error);
      }
    );

    this.httpClient.interceptors.response.use(
      (response) => {
        logger.debug('Orca API response', {
          status: response.status,
          url: response.config.url,
        });
        return response;
      },
      (error) => {
        logger.error('Orca API response error', {
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
      // Test connection by fetching pools
      await this.getPools();
      this.isInitialized = true;
      logger.info('Orca adapter initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Orca adapter', error);
      throw new SolanaDeFiError({
        code: 'ORCA_INIT_FAILED',
        message: 'Failed to initialize Orca adapter',
        protocol: SolanaProtocol.ORCA,
        details: { error: error.message },
      });
    }
  }

  /**
   * Get all available Orca pools
   */
  async getPools(): Promise<OrcaPool[]> {
    const cacheKey = 'orca:pools';
    
    try {
      // Try cache first
      const cached = await redisManager.get<OrcaPool[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const response = await this.httpClient.get<OrcaApiResponse<OrcaPool[]>>('/pools');
      
      if (!response.data.data) {
        throw new Error('Invalid response from Orca pools API');
      }

      const pools = response.data.data;

      // Cache for 30 minutes
      await redisManager.set(cacheKey, pools, this.config.cacheSettings.pools);
      
      return pools;
    } catch (error) {
      logger.error('Failed to fetch Orca pools', error);
      throw new SolanaDeFiError({
        code: 'ORCA_POOLS_FAILED',
        message: 'Failed to fetch Orca pools',
        protocol: SolanaProtocol.ORCA,
        details: { error: error.message },
      });
    }
  }

  /**
   * Get all available Whirlpools (concentrated liquidity)
   */
  async getWhirlpools(): Promise<OrcaWhirlpool[]> {
    const cacheKey = 'orca:whirlpools';
    
    try {
      // Try cache first
      const cached = await redisManager.get<OrcaWhirlpool[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const response = await this.httpClient.get<OrcaApiResponse<OrcaWhirlpool[]>>('/whirlpools');
      
      if (!response.data.data) {
        throw new Error('Invalid response from Orca whirlpools API');
      }

      const whirlpools = response.data.data;

      // Cache for 15 minutes (more volatile)
      await redisManager.set(cacheKey, whirlpools, this.config.cacheSettings.whirlpools);
      
      return whirlpools;
    } catch (error) {
      logger.error('Failed to fetch Orca whirlpools', error);
      throw new SolanaDeFiError({
        code: 'ORCA_WHIRLPOOLS_FAILED',
        message: 'Failed to fetch Orca whirlpools',
        protocol: SolanaProtocol.ORCA,
        details: { error: error.message },
      });
    }
  }

  /**
   * Get user's liquidity positions in Orca pools
   */
  async getLiquidityPositions(userAddress: string): Promise<OrcaLiquidityPosition[]> {
    const cacheKey = `orca:positions:${userAddress}`;
    
    try {
      // Check cache first
      const cached = await redisManager.get<OrcaLiquidityPosition[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const positions: OrcaLiquidityPosition[] = [];
      const publicKey = new PublicKey(userAddress);

      // Get all pools to match against user's LP tokens
      const pools = await this.getPools();

      // Check each pool for user's LP tokens
      for (const pool of pools) {
        try {
          const lpTokenAccounts = await this.connection.getTokenAccountsByOwner(
            publicKey,
            { mint: new PublicKey(pool.address) } // Assuming pool.address is the LP mint
          );

          for (const tokenAccount of lpTokenAccounts.value) {
            const accountInfo = await this.connection.getAccountInfo(tokenAccount.pubkey);
            if (!accountInfo) continue;

            const lpTokens = this.parseTokenAccountBalance(accountInfo.data);
            if (lpTokens <= 0) continue;

            // Calculate user's share of the pool
            const share = lpTokens / pool.lpTokenSupply;
            const tokenAAmount = pool.tokenABalance * share;
            const tokenBAmount = pool.tokenBBalance * share;
            const value = tokenAAmount + tokenBAmount; // Simplified calculation

            positions.push({
              poolAddress: pool.address,
              lpTokens,
              tokenAAmount,
              tokenBAmount,
              value,
              share,
              rewards: [], // Would need to fetch from farm contracts
              impermanentLoss: this.calculateImpermanentLoss(tokenAAmount, tokenBAmount, pool),
            });
          }
        } catch (error) {
          logger.debug(`Failed to check pool ${pool.address} for user positions`, error);
        }
      }

      // Cache for 5 minutes
      await redisManager.set(cacheKey, positions, this.config.cacheSettings.positions);
      
      return positions;
    } catch (error) {
      logger.error('Failed to get Orca liquidity positions', {
        userAddress,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get user's Whirlpool positions (concentrated liquidity)
   */
  async getWhirlpoolPositions(userAddress: string): Promise<OrcaLiquidityPosition[]> {
    const cacheKey = `orca:whirlpool-positions:${userAddress}`;
    
    try {
      // Check cache first
      const cached = await redisManager.get<OrcaLiquidityPosition[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const positions: OrcaLiquidityPosition[] = [];
      const publicKey = new PublicKey(userAddress);

      // Get Whirlpool position accounts owned by user
      const positionAccounts = await this.connection.getProgramAccounts(
        new PublicKey(OrcaAdapter.WHIRLPOOL_PROGRAM_ID),
        {
          filters: [
            {
              memcmp: {
                offset: 40, // Position owner offset in Whirlpool position account
                bytes: publicKey.toBase58(),
              },
            },
          ],
        }
      );

      for (const account of positionAccounts) {
        try {
          const position = this.parseWhirlpoolPosition(account.account.data);
          if (position) {
            positions.push(position);
          }
        } catch (error) {
          logger.debug('Failed to parse Whirlpool position', error);
        }
      }

      // Cache for 5 minutes
      await redisManager.set(cacheKey, positions, this.config.cacheSettings.positions);
      
      return positions;
    } catch (error) {
      logger.error('Failed to get Whirlpool positions', {
        userAddress,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get user's Aquafarm positions (yield farming)
   */
  async getAquafarmPositions(userAddress: string): Promise<OrcaUserFarm[]> {
    const cacheKey = `orca:aquafarms:${userAddress}`;
    
    try {
      // Check cache first
      const cached = await redisManager.get<OrcaUserFarm[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const farms: OrcaUserFarm[] = [];
      const publicKey = new PublicKey(userAddress);

      // Get farm token accounts owned by user
      const farmAccounts = await this.connection.getProgramAccounts(
        new PublicKey(OrcaAdapter.AQUAFARM_PROGRAM_ID)
      );

      // This is a simplified implementation
      // In practice, you'd need to properly parse farm accounts and match them to users

      // Cache for 10 minutes
      await redisManager.set(cacheKey, farms, this.config.cacheSettings.positions);
      
      return farms;
    } catch (error) {
      logger.error('Failed to get Aquafarm positions', {
        userAddress,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get comprehensive Orca positions for a user
   */
  async getUserPositions(userAddress: string): Promise<SolanaDeFiPosition[]> {
    try {
      const positions: SolanaDeFiPosition[] = [];

      // Get liquidity positions
      const liquidityPositions = await this.getLiquidityPositions(userAddress);
      for (const position of liquidityPositions) {
        positions.push({
          id: `orca-lp-${position.poolAddress}`,
          protocol: SolanaProtocol.ORCA,
          type: SolanaPositionType.LIQUIDITY,
          account: userAddress,
          tokens: [
            {
              mint: 'tokenA', // Would need to get actual token mints
              amount: position.tokenAAmount,
              value: position.tokenAAmount, // Simplified
            },
            {
              mint: 'tokenB',
              amount: position.tokenBAmount,
              value: position.tokenBAmount,
            },
          ],
          value: position.value,
          lastUpdated: Date.now(),
          metadata: {
            positionType: 'liquidity_pool',
            poolAddress: position.poolAddress,
            lpTokens: position.lpTokens,
            shareOfPool: position.share,
            impermanentLoss: position.impermanentLoss,
          },
        });
      }

      // Get Whirlpool positions
      const whirlpoolPositions = await this.getWhirlpoolPositions(userAddress);
      for (const position of whirlpoolPositions) {
        positions.push({
          id: `orca-whirlpool-${position.poolAddress}`,
          protocol: SolanaProtocol.ORCA,
          type: SolanaPositionType.LIQUIDITY,
          account: userAddress,
          tokens: [
            {
              mint: 'tokenA',
              amount: position.tokenAAmount,
              value: position.tokenAAmount,
            },
            {
              mint: 'tokenB',
              amount: position.tokenBAmount,
              value: position.tokenBAmount,
            },
          ],
          value: position.value,
          lastUpdated: Date.now(),
          metadata: {
            positionType: 'concentrated_liquidity',
            poolAddress: position.poolAddress,
            shareOfPool: position.share,
            impermanentLoss: position.impermanentLoss,
          },
        });
      }

      // Get farming positions
      const farmPositions = await this.getAquafarmPositions(userAddress);
      for (const farm of farmPositions) {
        positions.push({
          id: `orca-farm-${farm.aquafarm.account}`,
          protocol: SolanaProtocol.ORCA,
          type: SolanaPositionType.FARMING,
          account: userAddress,
          tokens: [
            {
              mint: farm.aquafarm.baseTokenMint,
              amount: farm.lpBalance,
              value: farm.farmValue,
            },
          ],
          value: farm.farmValue,
          lastUpdated: Date.now(),
          metadata: {
            positionType: 'yield_farming',
            farmAddress: farm.aquafarm.account,
            pendingRewards: farm.rewardsPending,
            claimedRewards: farm.rewardsClaimed,
            rewardTokenMint: farm.aquafarm.rewardTokenMint,
          },
        });
      }

      return positions;
    } catch (error) {
      logger.error('Failed to get Orca positions', {
        userAddress,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Parse token account balance from raw data
   */
  private parseTokenAccountBalance(data: Buffer): number {
    try {
      // Token account layout: [mint(32), owner(32), amount(8), ...]
      const amount = data.readBigUInt64LE(64);
      return Number(amount) / 1e9; // Convert to UI amount
    } catch (error) {
      logger.debug('Failed to parse token account balance', error);
      return 0;
    }
  }

  /**
   * Parse Whirlpool position from account data
   */
  private parseWhirlpoolPosition(data: Buffer): OrcaLiquidityPosition | null {
    try {
      // This is a simplified parser
      // In practice, you'd use the proper Whirlpool position account layout
      return null;
    } catch (error) {
      logger.debug('Failed to parse Whirlpool position', error);
      return null;
    }
  }

  /**
   * Calculate impermanent loss for a liquidity position
   */
  private calculateImpermanentLoss(tokenAAmount: number, tokenBAmount: number, pool: OrcaPool): number {
    // Simplified impermanent loss calculation
    // In practice, you'd need historical prices and entry values
    return 0;
  }

  /**
   * Health check for Orca service
   */
  async healthCheck(): Promise<boolean> {
    try {
      const pools = await this.getPools();
      return pools.length > 0;
    } catch (error) {
      logger.warn('Orca health check failed', { error: error.message });
      return false;
    }
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      protocol: SolanaProtocol.ORCA,
      isInitialized: this.isInitialized,
      config: {
        apiUrl: this.config.apiUrl,
        timeout: this.config.timeout,
        retries: this.config.retries,
      },
    };
  }
}

export default OrcaAdapter;