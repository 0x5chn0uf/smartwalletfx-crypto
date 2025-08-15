/**
 * Marinade Liquid Staking Adapter
 * 
 * Provides comprehensive integration with Marinade Finance for:
 * - Liquid staking positions (mSOL)
 * - Validator delegation tracking
 * - Staking rewards and APY calculation
 * - Native staking position monitoring
 */

import axios, { AxiosInstance } from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import {
  SolanaProtocol,
  SolanaPositionType,
  SolanaDeFiPosition,
  MarinadeStakeAccount,
  MarinadeValidatorInfo,
  MarinadeApiResponse,
  SolanaToken,
  SolanaDeFiError,
  WELL_KNOWN_TOKENS,
  SOLANA_NATIVE_MINT,
} from '@/types/solana-defi';

export interface MarinadeAdapterConfig {
  apiUrl: string;
  rpcUrl: string;
  timeout: number;
  retries: number;
  cacheSettings: {
    positions: number;
    validators: number;
    state: number;
  };
}

export interface MarinadeState {
  msolMint: string;
  msolPrice: number;
  totalCoolingDown: number;
  totalLamportsUnderControl: number;
  msolSupply: number;
  validatorCount: number;
  validatorCapacity: number;
  circulatingTicketCount: number;
  circulatingTicketBalance: number;
}

export interface MarinadeTicket {
  beneficiary: string;
  lamportsAmount: number;
  createdEpoch: number;
}

export interface MarinadeStakeInfo {
  stakeAccount: string;
  voterAddress: string;
  balance: number;
  delegatedStake: number;
  activatingStake: number;
  deactivatingStake: number;
  rentExemptReserve: number;
}

export class MarinadeAdapter {
  private readonly config: MarinadeAdapterConfig;
  private readonly httpClient: AxiosInstance;
  private readonly connection: Connection;
  private isInitialized = false;

  // Marinade program and account addresses
  private static readonly MARINADE_PROGRAM_ID = 'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD';
  private static readonly MARINADE_STATE_ADDRESS = '8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC';
  private static readonly MSOL_MINT = 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So';

  constructor(config: MarinadeAdapterConfig) {
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
        logger.debug('Marinade API request', {
          method: config.method,
          url: config.url,
          params: config.params,
        });
        return config;
      },
      (error) => {
        logger.error('Marinade API request error', error);
        return Promise.reject(error);
      }
    );

    this.httpClient.interceptors.response.use(
      (response) => {
        logger.debug('Marinade API response', {
          status: response.status,
          url: response.config.url,
        });
        return response;
      },
      (error) => {
        logger.error('Marinade API response error', {
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
      // Test connection by fetching Marinade state
      await this.getMarinadeState();
      this.isInitialized = true;
      logger.info('Marinade adapter initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Marinade adapter', error);
      throw new SolanaDeFiError({
        code: 'MARINADE_INIT_FAILED',
        message: 'Failed to initialize Marinade adapter',
        protocol: SolanaProtocol.MARINADE,
        details: { error: error.message },
      });
    }
  }

  /**
   * Get current Marinade protocol state
   */
  async getMarinadeState(): Promise<MarinadeState> {
    const cacheKey = 'marinade:state';
    
    try {
      // Try cache first
      const cached = await redisManager.get<MarinadeState>(cacheKey);
      if (cached) {
        return cached;
      }

      // Fetch from API or on-chain
      const response = await this.httpClient.get<MarinadeApiResponse<MarinadeState>>('/state');
      
      if (!response.data.success || !response.data.result) {
        throw new Error('Invalid response from Marinade API');
      }

      const state = response.data.result;

      // Cache for 5 minutes
      await redisManager.set(cacheKey, state, this.config.cacheSettings.state);
      
      return state;
    } catch (error) {
      logger.error('Failed to fetch Marinade state', error);
      throw new SolanaDeFiError({
        code: 'MARINADE_STATE_FAILED',
        message: 'Failed to fetch Marinade state',
        protocol: SolanaProtocol.MARINADE,
        details: { error: error.message },
      });
    }
  }

  /**
   * Get mSOL balance for a user
   */
  async getMsolBalance(userAddress: string): Promise<{ amount: number; value: number }> {
    try {
      const publicKey = new PublicKey(userAddress);
      
      // Get mSOL token account
      const tokenAccounts = await this.connection.getTokenAccountsByOwner(
        publicKey,
        { mint: new PublicKey(MarinadeAdapter.MSOL_MINT) }
      );

      if (tokenAccounts.value.length === 0) {
        return { amount: 0, value: 0 };
      }

      // Parse token account data
      const accountInfo = await this.connection.getAccountInfo(tokenAccounts.value[0].pubkey);
      if (!accountInfo) {
        return { amount: 0, value: 0 };
      }

      // Decode token account data (simplified)
      const amount = this.parseTokenAccountBalance(accountInfo.data);
      const state = await this.getMarinadeState();
      const value = amount * state.msolPrice;

      return { amount, value };
    } catch (error) {
      logger.error('Failed to get mSOL balance', {
        userAddress,
        error: error.message,
      });
      return { amount: 0, value: 0 };
    }
  }

  /**
   * Get native stake accounts for a user
   */
  async getNativeStakeAccounts(userAddress: string): Promise<MarinadeStakeInfo[]> {
    const cacheKey = `marinade:native-stakes:${userAddress}`;
    
    try {
      // Check cache first
      const cached = await redisManager.get<MarinadeStakeInfo[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const publicKey = new PublicKey(userAddress);
      
      // Get all stake accounts for this user
      const stakeAccounts = await this.connection.getParsedProgramAccounts(
        new PublicKey('Stake11111111111111111111111111111111111111'),
        {
          filters: [
            {
              memcmp: {
                offset: 12, // Staker authority offset
                bytes: publicKey.toBase58(),
              },
            },
          ],
        }
      );

      const stakeInfos: MarinadeStakeInfo[] = [];

      for (const account of stakeAccounts) {
        const parsed = account.account.data.parsed;
        if (parsed?.type === 'delegated') {
          const info = parsed.info;
          
          stakeInfos.push({
            stakeAccount: account.pubkey.toString(),
            voterAddress: info.stake.delegation.voter,
            balance: account.account.lamports / 1e9, // Convert to SOL
            delegatedStake: info.stake.delegation.stake / 1e9,
            activatingStake: info.stake.delegation.activationEpoch === '18446744073709551615' ? 0 : info.stake.delegation.stake / 1e9,
            deactivatingStake: info.stake.delegation.deactivationEpoch === '18446744073709551615' ? 0 : info.stake.delegation.stake / 1e9,
            rentExemptReserve: info.meta.rentExemptReserve / 1e9,
          });
        }
      }

      // Cache for 10 minutes
      await redisManager.set(cacheKey, stakeInfos, this.config.cacheSettings.positions);
      
      return stakeInfos;
    } catch (error) {
      logger.error('Failed to get native stake accounts', {
        userAddress,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get delayed unstake tickets for a user
   */
  async getDelayedUnstakeTickets(userAddress: string): Promise<MarinadeTicket[]> {
    const cacheKey = `marinade:tickets:${userAddress}`;
    
    try {
      // Check cache first
      const cached = await redisManager.get<MarinadeTicket[]>(cacheKey);
      if (cached) {
        return cached;
      }

      // Get ticket accounts for this user
      const publicKey = new PublicKey(userAddress);
      const tickets: MarinadeTicket[] = [];

      // This is a simplified implementation
      // In practice, you'd need to query Marinade's ticket accounts
      // using the proper program account filters

      // Cache for 5 minutes
      await redisManager.set(cacheKey, tickets, this.config.cacheSettings.positions);
      
      return tickets;
    } catch (error) {
      logger.error('Failed to get delayed unstake tickets', {
        userAddress,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get validator information
   */
  async getValidators(): Promise<MarinadeValidatorInfo[]> {
    const cacheKey = 'marinade:validators';
    
    try {
      // Try cache first
      const cached = await redisManager.get<MarinadeValidatorInfo[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const response = await this.httpClient.get<MarinadeApiResponse<MarinadeValidatorInfo[]>>('/validators');
      
      if (!response.data.success || !response.data.result) {
        throw new Error('Invalid response from Marinade validators API');
      }

      const validators = response.data.result;

      // Cache for 1 hour
      await redisManager.set(cacheKey, validators, this.config.cacheSettings.validators);
      
      return validators;
    } catch (error) {
      logger.error('Failed to fetch Marinade validators', error);
      throw new SolanaDeFiError({
        code: 'MARINADE_VALIDATORS_FAILED',
        message: 'Failed to fetch Marinade validators',
        protocol: SolanaProtocol.MARINADE,
        details: { error: error.message },
      });
    }
  }

  /**
   * Calculate current APY for mSOL staking
   */
  async calculateStakingApy(): Promise<number> {
    try {
      const state = await this.getMarinadeState();
      const validators = await this.getValidators();
      
      // Calculate weighted average APY based on validator performance
      const totalStake = validators.reduce((sum, v) => sum + v.stake, 0);
      const weightedApy = validators.reduce((sum, v) => {
        const weight = v.stake / totalStake;
        return sum + (v.apy * weight);
      }, 0);

      // Apply Marinade's performance fee (typically around 2-6%)
      const performanceFee = 0.06; // 6% performance fee
      const netApy = weightedApy * (1 - performanceFee);

      return netApy;
    } catch (error) {
      logger.error('Failed to calculate staking APY', error);
      return 0;
    }
  }

  /**
   * Get comprehensive Marinade positions for a user
   */
  async getUserPositions(userAddress: string): Promise<SolanaDeFiPosition[]> {
    try {
      const positions: SolanaDeFiPosition[] = [];

      // Get mSOL liquid staking position
      const msolBalance = await this.getMsolBalance(userAddress);
      if (msolBalance.amount > 0) {
        const apy = await this.calculateStakingApy();
        
        positions.push({
          id: `marinade-msol-${userAddress}`,
          protocol: SolanaProtocol.MARINADE,
          type: SolanaPositionType.STAKING,
          account: userAddress,
          tokens: [
            {
              mint: MarinadeAdapter.MSOL_MINT,
              amount: msolBalance.amount,
              value: msolBalance.value,
            },
          ],
          value: msolBalance.value,
          apy,
          lastUpdated: Date.now(),
          metadata: {
            positionType: 'liquid_staking',
            liquidStakingToken: 'mSOL',
            exchangeRate: (await this.getMarinadeState()).msolPrice,
          },
        });
      }

      // Get native stake accounts
      const nativeStakes = await this.getNativeStakeAccounts(userAddress);
      for (const stake of nativeStakes) {
        const validators = await this.getValidators();
        const validator = validators.find(v => v.voteAccount === stake.voterAddress);
        
        positions.push({
          id: `marinade-native-${stake.stakeAccount}`,
          protocol: SolanaProtocol.MARINADE,
          type: SolanaPositionType.STAKING,
          account: userAddress,
          tokens: [
            {
              mint: SOLANA_NATIVE_MINT,
              amount: stake.balance,
              value: stake.balance, // Assuming SOL price = 1 for simplicity
            },
          ],
          value: stake.balance,
          apy: validator?.apy || 0,
          lastUpdated: Date.now(),
          metadata: {
            positionType: 'native_staking',
            stakeAccount: stake.stakeAccount,
            validator: {
              voteAccount: stake.voterAddress,
              name: validator?.name || 'Unknown',
              commission: validator?.commission || 0,
            },
            activatingStake: stake.activatingStake,
            deactivatingStake: stake.deactivatingStake,
          },
        });
      }

      // Get delayed unstake tickets
      const tickets = await this.getDelayedUnstakeTickets(userAddress);
      if (tickets.length > 0) {
        const totalTicketValue = tickets.reduce((sum, ticket) => sum + ticket.lamportsAmount / 1e9, 0);
        
        positions.push({
          id: `marinade-tickets-${userAddress}`,
          protocol: SolanaProtocol.MARINADE,
          type: SolanaPositionType.STAKING,
          account: userAddress,
          tokens: [
            {
              mint: SOLANA_NATIVE_MINT,
              amount: totalTicketValue,
              value: totalTicketValue,
            },
          ],
          value: totalTicketValue,
          lastUpdated: Date.now(),
          metadata: {
            positionType: 'delayed_unstake',
            ticketCount: tickets.length,
            tickets: tickets.map(t => ({
              amount: t.lamportsAmount / 1e9,
              createdEpoch: t.createdEpoch,
            })),
          },
        });
      }

      return positions;
    } catch (error) {
      logger.error('Failed to get Marinade positions', {
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
    // This is a simplified parser
    // In practice, you'd use the proper SPL token account layout
    try {
      // Token account layout: [mint(32), owner(32), amount(8), ...]
      const amount = data.readBigUInt64LE(64);
      return Number(amount) / 1e9; // Convert to UI amount (mSOL has 9 decimals)
    } catch (error) {
      logger.debug('Failed to parse token account balance', error);
      return 0;
    }
  }

  /**
   * Health check for Marinade service
   */
  async healthCheck(): Promise<boolean> {
    try {
      const state = await this.getMarinadeState();
      return state.msolMint === MarinadeAdapter.MSOL_MINT;
    } catch (error) {
      logger.warn('Marinade health check failed', { error: error.message });
      return false;
    }
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      protocol: SolanaProtocol.MARINADE,
      isInitialized: this.isInitialized,
      config: {
        apiUrl: this.config.apiUrl,
        timeout: this.config.timeout,
        retries: this.config.retries,
      },
    };
  }
}

export default MarinadeAdapter;