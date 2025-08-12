import axios from 'axios';
import {
  ChainId,
  ProviderConfig,
  ProviderResponse,
  TokenBalance,
  Transaction,
  Token,
  ChainProviderError,
  COMMON_TOKENS,
} from '@/types/blockchain';
import { BaseProvider } from './BaseProvider';
import { logger } from '@/utils/logger';

interface SolanaTokenAccount {
  account: {
    data: {
      parsed: {
        info: {
          mint: string;
          owner: string;
          tokenAmount: {
            amount: string;
            decimals: number;
            uiAmount: number;
          };
        };
      };
    };
  };
}

interface SolanaTokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
}

interface SolanaTransaction {
  signature: string;
  slot: number;
  blockTime: number;
  confirmationStatus: 'processed' | 'confirmed' | 'finalized';
  err: any;
  memo: string | null;
}

export class SolanaProvider extends BaseProvider {
  constructor(apiKey?: string) {
    const config: ProviderConfig = {
      apiKey: apiKey || '',
      baseUrl: 'https://api.helius.xyz/v0',
      rateLimit: {
        requestsPerSecond: 10, // Helius allows higher RPS
        requestsPerMinute: 600,
        requestsPerHour: 36000,
      },
      timeout: 30000,
      retries: 3,
      cacheTtl: {
        balance: 300, // 5 minutes
        transaction: 600, // 10 minutes  
        token: 3600, // 1 hour
      },
      costPerRequest: 0.001, // $0.001 per request (estimated)
    };

    super(ChainId.SOLANA, 'Helius-Solana', config);
  }

  async initialize(): Promise<void> {
    try {
      // Test connection with a simple RPC call
      const response = await axios.post('https://api.mainnet-beta.solana.com', {
        jsonrpc: '2.0',
        id: 1,
        method: 'getHealth',
      }, {
        timeout: 5000,
      });

      if (response.data.result !== 'ok') {
        throw new Error('Solana RPC health check failed');
      }

      logger.info('Solana provider initialized');
    } catch (error) {
      logger.error('Failed to initialize Solana provider:', { error });
      throw error;
    }
  }

  protected buildAuthHeaders(): Record<string, string> {
    if (this.config.apiKey) {
      return {
        'Authorization': `Bearer ${this.config.apiKey}`,
      };
    }
    return {};
  }

  protected handleProviderError(error: any): ChainProviderError {
    if (error.response?.data?.error) {
      const solanaError = error.response.data.error;
      return new ChainProviderError(
        solanaError.message || 'Solana API error',
        this.name,
        this.chainId,
        solanaError.code?.toString() || 'SOLANA_ERROR',
        error.response?.status === 429 || error.response?.status >= 500
      );
    }

    return new ChainProviderError(
      error.message || 'Unknown Solana error',
      this.name,
      this.chainId,
      'SOLANA_ERROR',
      true
    );
  }

  protected parseBalanceResponse(response: any): TokenBalance[] {
    throw new Error('Not implemented - use getBalance method');
  }

  protected parseTransactionResponse(response: any): Transaction {
    throw new Error('Not implemented - use getTransaction method');
  }

  async getBalance(address: string): Promise<ProviderResponse<TokenBalance[]>> {
    if (!this.isValidAddress(address)) {
      return {
        success: false,
        error: {
          code: 'INVALID_ADDRESS',
          message: `Invalid Solana address: ${address}`,
        },
        metadata: {
          provider: this.name,
          chainId: this.chainId,
          timestamp: Date.now(),
          requestId: 'validation_error',
        },
      };
    }

    const cacheKey = this.getCacheKey('getBalance', { address });
    
    return this.getCached(
      cacheKey,
      async () => {
        try {
          // Get SOL balance
          const solBalanceResponse = await this.makeRequest<{ value: number }>({
            method: 'POST',
            url: 'https://api.mainnet-beta.solana.com',
            data: {
              jsonrpc: '2.0',
              id: 1,
              method: 'getBalance',
              params: [address],
            },
          });

          if (!solBalanceResponse.success || !solBalanceResponse.data) {
            return solBalanceResponse as ProviderResponse<TokenBalance[]>;
          }

          const balances: TokenBalance[] = [];
          const now = new Date();

          // Add SOL balance (native token)
          const solBalance = solBalanceResponse.data.value;
          const solBalanceFormatted = (solBalance / Math.pow(10, 9)).toString(); // SOL has 9 decimals

          balances.push({
            token: {
              address: 'native',
              chainId: this.chainId,
              symbol: 'SOL',
              name: 'Solana',
              decimals: 9,
              isNative: true,
            },
            balance: solBalance.toString(),
            balanceFormatted: solBalanceFormatted,
            lastUpdated: now,
          });

          // Get SPL token balances
          const tokenAccountsResponse = await this.makeRequest<{ value: SolanaTokenAccount[] }>({
            method: 'POST',
            url: 'https://api.mainnet-beta.solana.com',
            data: {
              jsonrpc: '2.0',
              id: 1,
              method: 'getTokenAccountsByOwner',
              params: [
                address,
                { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, // SPL Token Program
                { encoding: 'jsonParsed' },
              ],
            },
          });

          if (tokenAccountsResponse.success && tokenAccountsResponse.data?.value) {
            for (const account of tokenAccountsResponse.data.value) {
              try {
                const tokenInfo = account.account.data.parsed.info;
                const tokenAmount = tokenInfo.tokenAmount;
                
                if (tokenAmount.uiAmount === 0) {
                  continue; // Skip zero balances
                }

                // Try to get token metadata (this would typically come from a token registry)
                const tokenMetadata = await this.getTokenMetadata(tokenInfo.mint);
                
                balances.push({
                  token: {
                    address: tokenInfo.mint,
                    chainId: this.chainId,
                    symbol: tokenMetadata?.symbol || 'UNKNOWN',
                    name: tokenMetadata?.name || 'Unknown Token',
                    decimals: tokenAmount.decimals,
                    logoUrl: tokenMetadata?.logoURI,
                  },
                  balance: tokenAmount.amount,
                  balanceFormatted: tokenAmount.uiAmount.toString(),
                  lastUpdated: now,
                });
              } catch (error) {
                logger.warn(`Failed to process Solana token account:`, { error });
                continue;
              }
            }
          }

          return {
            success: true,
            data: balances,
            metadata: {
              provider: this.name,
              chainId: this.chainId,
              timestamp: Date.now(),
              requestId: 'balance_fetch',
              cacheTtl: this.config.cacheTtl.balance,
              cost: this.config.costPerRequest * 2, // SOL balance + token accounts
            },
          };
        } catch (error) {
          logger.error(`Failed to get Solana balance for address ${address}:`, { error });
          return {
            success: false,
            error: {
              code: 'BALANCE_FETCH_ERROR',
              message: error instanceof Error ? error.message : 'Unknown error',
            },
            metadata: {
              provider: this.name,
              chainId: this.chainId,
              timestamp: Date.now(),
              requestId: 'error',
            },
          };
        }
      },
      this.config.cacheTtl.balance
    );
  }

  async getTokenBalance(address: string, tokenAddress: string): Promise<ProviderResponse<TokenBalance>> {
    if (!this.isValidAddress(address)) {
      return {
        success: false,
        error: {
          code: 'INVALID_ADDRESS',
          message: `Invalid Solana address: ${address}`,
        },
        metadata: {
          provider: this.name,
          chainId: this.chainId,
          timestamp: Date.now(),
          requestId: 'validation_error',
        },
      };
    }

    const cacheKey = this.getCacheKey('getTokenBalance', { address, tokenAddress });
    
    return this.getCached(
      cacheKey,
      async () => {
        try {
          // Handle native SOL
          if (tokenAddress === 'native' || tokenAddress === 'So11111111111111111111111111111111111111112') {
            const response = await this.makeRequest<{ value: number }>({
              method: 'POST',
              url: 'https://api.mainnet-beta.solana.com',
              data: {
                jsonrpc: '2.0',
                id: 1,
                method: 'getBalance',
                params: [address],
              },
            });

            if (!response.success || response.data === undefined) {
              return {
                success: false,
                error: {
                  code: 'BALANCE_FETCH_ERROR',
                  message: 'Failed to fetch SOL balance',
                },
                metadata: {
                  provider: this.name,
                  chainId: this.chainId,
                  timestamp: Date.now(),
                  requestId: 'sol_balance_error',
                },
              };
            }

            const balance = response.data.value;
            const balanceFormatted = (balance / Math.pow(10, 9)).toString();

            return {
              success: true,
              data: {
                token: {
                  address: 'native',
                  chainId: this.chainId,
                  symbol: 'SOL',
                  name: 'Solana',
                  decimals: 9,
                  isNative: true,
                },
                balance: balance.toString(),
                balanceFormatted,
                lastUpdated: new Date(),
              },
              metadata: {
                provider: this.name,
                chainId: this.chainId,
                timestamp: Date.now(),
                requestId: 'sol_balance',
                cost: this.config.costPerRequest,
              },
            };
          }

          // Get SPL token balance
          const tokenAccountsResponse = await this.makeRequest<{ value: SolanaTokenAccount[] }>({
            method: 'POST',
            url: 'https://api.mainnet-beta.solana.com',
            data: {
              jsonrpc: '2.0',
              id: 1,
              method: 'getTokenAccountsByOwner',
              params: [
                address,
                { mint: tokenAddress },
                { encoding: 'jsonParsed' },
              ],
            },
          });

          if (!tokenAccountsResponse.success || !tokenAccountsResponse.data?.value?.length) {
            return {
              success: true,
              data: {
                token: {
                  address: tokenAddress,
                  chainId: this.chainId,
                  symbol: 'UNKNOWN',
                  name: 'Unknown Token',
                  decimals: 0,
                },
                balance: '0',
                balanceFormatted: '0',
                lastUpdated: new Date(),
              },
              metadata: {
                provider: this.name,
                chainId: this.chainId,
                timestamp: Date.now(),
                requestId: 'zero_balance',
                cost: this.config.costPerRequest,
              },
            };
          }

          const account = tokenAccountsResponse.data.value[0];
          const tokenInfo = account.account.data.parsed.info;
          const tokenAmount = tokenInfo.tokenAmount;
          const metadata = await this.getTokenMetadata(tokenAddress);

          return {
            success: true,
            data: {
              token: {
                address: tokenAddress,
                chainId: this.chainId,
                symbol: metadata?.symbol || 'UNKNOWN',
                name: metadata?.name || 'Unknown Token',
                decimals: tokenAmount.decimals,
                logoUrl: metadata?.logoURI,
              },
              balance: tokenAmount.amount,
              balanceFormatted: tokenAmount.uiAmount.toString(),
              lastUpdated: new Date(),
            },
            metadata: {
              provider: this.name,
              chainId: this.chainId,
              timestamp: Date.now(),
              requestId: 'token_balance',
              cost: this.config.costPerRequest,
            },
          };
        } catch (error) {
          logger.error(`Failed to get Solana token balance:`, { error, address, tokenAddress });
          return {
            success: false,
            error: {
              code: 'TOKEN_BALANCE_ERROR',
              message: error instanceof Error ? error.message : 'Unknown error',
            },
            metadata: {
              provider: this.name,
              chainId: this.chainId,
              timestamp: Date.now(),
              requestId: 'error',
            },
          };
        }
      },
      this.config.cacheTtl.balance
    );
  }

  async getTransaction(signature: string): Promise<ProviderResponse<Transaction>> {
    const cacheKey = this.getCacheKey('getTransaction', { signature });
    
    return this.getCached(
      cacheKey,
      async () => {
        try {
          const response = await this.makeRequest<any>({
            method: 'POST',
            url: 'https://api.mainnet-beta.solana.com',
            data: {
              jsonrpc: '2.0',
              id: 1,
              method: 'getTransaction',
              params: [signature, { encoding: 'jsonParsed' }],
            },
          });

          if (!response.success || !response.data) {
            return {
              success: false,
              error: {
                code: 'TRANSACTION_NOT_FOUND',
                message: `Transaction ${signature} not found`,
              },
              metadata: {
                provider: this.name,
                chainId: this.chainId,
                timestamp: Date.now(),
                requestId: 'not_found',
              },
            };
          }

          const tx = response.data;
          
          return {
            success: true,
            data: {
              hash: signature,
              chainId: this.chainId,
              from: tx.transaction?.message?.accountKeys?.[0] || '',
              to: tx.transaction?.message?.accountKeys?.[1] || '',
              value: '0', // Solana doesn't have a simple value field
              status: tx.meta?.err ? 'failed' : 'confirmed',
              blockNumber: tx.slot,
              timestamp: new Date((tx.blockTime || 0) * 1000),
            },
            metadata: {
              provider: this.name,
              chainId: this.chainId,
              timestamp: Date.now(),
              requestId: 'transaction',
              cost: this.config.costPerRequest,
            },
          };
        } catch (error) {
          logger.error(`Failed to get Solana transaction ${signature}:`, { error });
          return {
            success: false,
            error: {
              code: 'TRANSACTION_ERROR',
              message: error instanceof Error ? error.message : 'Unknown error',
            },
            metadata: {
              provider: this.name,
              chainId: this.chainId,
              timestamp: Date.now(),
              requestId: 'error',
            },
          };
        }
      },
      this.config.cacheTtl.transaction
    );
  }

  async getTransactionHistory(
    address: string, 
    options: { limit?: number; offset?: number } = {}
  ): Promise<ProviderResponse<Transaction[]>> {
    const { limit = 10 } = options;
    const cacheKey = this.getCacheKey('getTransactionHistory', { address, limit });
    
    return this.getCached(
      cacheKey,
      async () => {
        try {
          const response = await this.makeRequest<SolanaTransaction[]>({
            method: 'POST',
            url: 'https://api.mainnet-beta.solana.com',
            data: {
              jsonrpc: '2.0',
              id: 1,
              method: 'getSignaturesForAddress',
              params: [
                address,
                {
                  limit,
                  commitment: 'confirmed',
                },
              ],
            },
          });

          if (!response.success || !response.data) {
            return {
              success: false,
              error: {
                code: 'TRANSACTION_HISTORY_ERROR',
                message: 'Failed to fetch transaction history',
              },
              metadata: {
                provider: this.name,
                chainId: this.chainId,
                timestamp: Date.now(),
                requestId: 'history_error',
              },
            };
          }

          const transactions: Transaction[] = response.data.map((tx) => ({
            hash: tx.signature,
            chainId: this.chainId,
            from: address,
            to: '',
            value: '0',
            status: tx.err ? 'failed' : 'confirmed',
            blockNumber: tx.slot,
            timestamp: new Date((tx.blockTime || 0) * 1000),
          }));

          return {
            success: true,
            data: transactions,
            metadata: {
              provider: this.name,
              chainId: this.chainId,
              timestamp: Date.now(),
              requestId: 'transaction_history',
              cost: this.config.costPerRequest,
            },
          };
        } catch (error) {
          logger.error(`Failed to get Solana transaction history:`, { error });
          return {
            success: false,
            error: {
              code: 'TRANSACTION_HISTORY_ERROR',
              message: error instanceof Error ? error.message : 'Unknown error',
            },
            metadata: {
              provider: this.name,
              chainId: this.chainId,
              timestamp: Date.now(),
              requestId: 'error',
            },
          };
        }
      },
      this.config.cacheTtl.transaction
    );
  }

  private async getTokenMetadata(mintAddress: string): Promise<SolanaTokenMetadata | null> {
    try {
      // This is a simplified metadata fetch - in production you would use 
      // Solana Token Registry or Metaplex metadata
      const commonToken = COMMON_TOKENS[ChainId.SOLANA][mintAddress];
      if (commonToken) {
        return {
          name: commonToken.name || commonToken.symbol || 'Unknown',
          symbol: commonToken.symbol || 'UNKNOWN',
          decimals: commonToken.decimals || 9,
          logoURI: commonToken.logoUrl,
        };
      }

      // For now, return null for unknown tokens
      return null;
    } catch (error) {
      logger.warn(`Failed to get Solana token metadata for ${mintAddress}:`, { error });
      return null;
    }
  }
}