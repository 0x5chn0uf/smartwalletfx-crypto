import { ethers } from 'ethers';
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

interface AlchemyTokenBalance {
  contractAddress: string;
  tokenBalance: string;
  error?: string;
}

interface AlchemyTokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
  logo?: string;
}

interface AlchemyBalanceResponse {
  address: string;
  tokenBalances: AlchemyTokenBalance[];
}

interface AlchemyTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  gas: string;
  gasPrice: string;
  gasUsed?: string;
  blockNumber: string;
  timeStamp: string;
  isError: string;
  txreceipt_status: string;
}

export class AlchemyProvider extends BaseProvider {
  private readonly provider: ethers.JsonRpcProvider;

  constructor(chainId: ChainId, apiKey: string) {
    const config: ProviderConfig = {
      apiKey,
      baseUrl: `https://${AlchemyProvider.getChainPrefix(chainId)}.alchemyapi.io/v2/${apiKey}`,
      rateLimit: {
        requestsPerSecond: 5, // Alchemy allows 5 RPS on free tier
        requestsPerMinute: 300, // 300 RPM on free tier
        requestsPerHour: 18000, // Conservative estimate
      },
      timeout: 30000,
      retries: 3,
      cacheTtl: {
        balance: 300, // 5 minutes
        transaction: 600, // 10 minutes
        token: 3600, // 1 hour
      },
      costPerRequest: 0.0005, // $0.0005 per request (estimated)
    };

    super(chainId, 'Alchemy', config);
    
    this.provider = new ethers.JsonRpcProvider(config.baseUrl);
  }

  private static getChainPrefix(chainId: ChainId): string {
    switch (chainId) {
      case ChainId.ETHEREUM:
        return 'eth-mainnet';
      case ChainId.POLYGON:
        return 'polygon-mainnet';
      case ChainId.ARBITRUM:
        return 'arb-mainnet';
      case ChainId.OPTIMISM:
        return 'opt-mainnet';
      case ChainId.BASE:
        return 'base-mainnet';
      default:
        throw new Error(`Unsupported chain ID: ${chainId}`);
    }
  }

  async initialize(): Promise<void> {
    try {
      // Test connection with a simple call
      await this.provider.getBlockNumber();
      logger.info(`Alchemy provider initialized for chain ${this.chainId}`);
    } catch (error) {
      logger.error(`Failed to initialize Alchemy provider for chain ${this.chainId}:`, { error });
      throw error;
    }
  }

  protected buildAuthHeaders(): Record<string, string> {
    return {}; // API key is in the URL for Alchemy
  }

  protected handleProviderError(error: any): ChainProviderError {
    if (error.response?.data?.error) {
      const alchemyError = error.response.data.error;
      return new ChainProviderError(
        alchemyError.message || 'Alchemy API error',
        this.name,
        this.chainId,
        alchemyError.code || 'ALCHEMY_ERROR',
        error.response?.status === 429 || error.response?.status >= 500
      );
    }

    return new ChainProviderError(
      error.message || 'Unknown Alchemy error',
      this.name,
      this.chainId,
      'ALCHEMY_ERROR',
      true
    );
  }

  protected parseBalanceResponse(response: AlchemyBalanceResponse): TokenBalance[] {
    // Implementation handled in getBalance method
    throw new Error('Not implemented - use getBalance method');
  }

  protected parseTransactionResponse(response: any): Transaction {
    // Implementation handled in getTransaction method
    throw new Error('Not implemented - use getTransaction method');
  }

  async getBalance(address: string): Promise<ProviderResponse<TokenBalance[]>> {
    if (!this.isValidAddress(address)) {
      return {
        success: false,
        error: {
          code: 'INVALID_ADDRESS',
          message: `Invalid address: ${address}`,
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
          // Get native balance
          const nativeBalance = await this.provider.getBalance(address);
          
          // Get token balances
          const tokenBalancesResponse = await this.makeRequest<AlchemyBalanceResponse>({
            method: 'POST',
            url: '',
            data: {
              id: 1,
              jsonrpc: '2.0',
              method: 'alchemy_getTokenBalances',
              params: [address],
            },
          });

          if (!tokenBalancesResponse.success || !tokenBalancesResponse.data) {
            return tokenBalancesResponse as ProviderResponse<TokenBalance[]>;
          }

          const balances: TokenBalance[] = [];
          const now = new Date();

          // Add native token balance
          const nativeConfig = COMMON_TOKENS[this.chainId];
          const nativeSymbol = this.chainId === ChainId.POLYGON ? 'MATIC' : 'ETH';
          
          balances.push({
            token: {
              address: 'native',
              chainId: this.chainId,
              symbol: nativeSymbol,
              name: nativeSymbol === 'MATIC' ? 'Polygon' : 'Ethereum',
              decimals: 18,
              isNative: true,
            },
            balance: nativeBalance.toString(),
            balanceFormatted: ethers.formatEther(nativeBalance),
            lastUpdated: now,
          });

          // Process token balances
          for (const tokenBalance of tokenBalancesResponse.data.tokenBalances) {
            if (tokenBalance.error || !tokenBalance.tokenBalance || tokenBalance.tokenBalance === '0x0') {
              continue;
            }

            try {
              // Get token metadata
              const metadataResponse = await this.getTokenMetadata(tokenBalance.contractAddress);
              if (!metadataResponse.success || !metadataResponse.data) {
                continue;
              }

              const metadata = metadataResponse.data;
              const balance = BigInt(tokenBalance.tokenBalance);
              
              if (balance === 0n) {
                continue;
              }

              const balanceFormatted = ethers.formatUnits(balance, metadata.decimals);

              balances.push({
                token: {
                  address: tokenBalance.contractAddress.toLowerCase(),
                  chainId: this.chainId,
                  symbol: metadata.symbol,
                  name: metadata.name,
                  decimals: metadata.decimals,
                  logoUrl: metadata.logo,
                },
                balance: balance.toString(),
                balanceFormatted,
                lastUpdated: now,
              });
            } catch (error) {
              logger.warn(`Failed to process token balance for ${tokenBalance.contractAddress}:`, { error });
              continue;
            }
          }

          return {
            success: true,
            data: balances,
            metadata: {
              provider: this.name,
              chainId: this.chainId,
              timestamp: Date.now(),
              requestId: tokenBalancesResponse.metadata.requestId,
              cacheTtl: this.config.cacheTtl.balance,
              cost: this.config.costPerRequest * 2, // Native + token balances = 2 requests
            },
          };
        } catch (error) {
          logger.error(`Failed to get balance for address ${address}:`, { error });
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
          message: `Invalid address: ${address}`,
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
          // Handle native token
          if (tokenAddress === 'native') {
            const balance = await this.provider.getBalance(address);
            const nativeSymbol = this.chainId === ChainId.POLYGON ? 'MATIC' : 'ETH';
            
            return {
              success: true,
              data: {
                token: {
                  address: 'native',
                  chainId: this.chainId,
                  symbol: nativeSymbol,
                  name: nativeSymbol === 'MATIC' ? 'Polygon' : 'Ethereum',
                  decimals: 18,
                  isNative: true,
                },
                balance: balance.toString(),
                balanceFormatted: ethers.formatEther(balance),
                lastUpdated: new Date(),
              },
              metadata: {
                provider: this.name,
                chainId: this.chainId,
                timestamp: Date.now(),
                requestId: 'native_balance',
                cost: this.config.costPerRequest,
              },
            };
          }

          // Get ERC20 token balance
          const contract = new ethers.Contract(
            tokenAddress,
            ['function balanceOf(address) view returns (uint256)'],
            this.provider
          );

          const [balance, metadata] = await Promise.all([
            contract.balanceOf(address),
            this.getTokenMetadata(tokenAddress),
          ]);

          if (!metadata.success || !metadata.data) {
            return {
              success: false,
              error: {
                code: 'TOKEN_METADATA_ERROR',
                message: 'Failed to fetch token metadata',
              },
              metadata: {
                provider: this.name,
                chainId: this.chainId,
                timestamp: Date.now(),
                requestId: 'metadata_error',
              },
            };
          }

          const balanceFormatted = ethers.formatUnits(balance, metadata.data.decimals);

          return {
            success: true,
            data: {
              token: {
                address: tokenAddress.toLowerCase(),
                chainId: this.chainId,
                symbol: metadata.data.symbol,
                name: metadata.data.name,
                decimals: metadata.data.decimals,
                logoUrl: metadata.data.logo,
              },
              balance: balance.toString(),
              balanceFormatted,
              lastUpdated: new Date(),
            },
            metadata: {
              provider: this.name,
              chainId: this.chainId,
              timestamp: Date.now(),
              requestId: 'token_balance',
              cost: this.config.costPerRequest * 2, // Balance + metadata
            },
          };
        } catch (error) {
          logger.error(`Failed to get token balance:`, { error, address, tokenAddress });
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

  async getTransaction(hash: string): Promise<ProviderResponse<Transaction>> {
    const cacheKey = this.getCacheKey('getTransaction', { hash });
    
    return this.getCached(
      cacheKey,
      async () => {
        try {
          const [tx, receipt] = await Promise.all([
            this.provider.getTransaction(hash),
            this.provider.getTransactionReceipt(hash),
          ]);

          if (!tx) {
            return {
              success: false,
              error: {
                code: 'TRANSACTION_NOT_FOUND',
                message: `Transaction ${hash} not found`,
              },
              metadata: {
                provider: this.name,
                chainId: this.chainId,
                timestamp: Date.now(),
                requestId: 'not_found',
              },
            };
          }

          const block = await this.provider.getBlock(tx.blockNumber || 'latest');

          return {
            success: true,
            data: {
              hash: tx.hash,
              chainId: this.chainId,
              from: tx.from,
              to: tx.to || '',
              value: tx.value.toString(),
              gasPrice: tx.gasPrice?.toString(),
              gasUsed: receipt?.gasUsed?.toString(),
              gasLimit: tx.gasLimit.toString(),
              status: receipt?.status === 1 ? 'confirmed' : 'failed',
              blockNumber: tx.blockNumber || 0,
              timestamp: new Date((block?.timestamp || 0) * 1000),
            },
            metadata: {
              provider: this.name,
              chainId: this.chainId,
              timestamp: Date.now(),
              requestId: 'transaction',
              cost: this.config.costPerRequest * 3, // Transaction + receipt + block
            },
          };
        } catch (error) {
          logger.error(`Failed to get transaction ${hash}:`, { error });
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
    options: { limit?: number; offset?: number; startBlock?: number; endBlock?: number } = {}
  ): Promise<ProviderResponse<Transaction[]>> {
    // Alchemy doesn't have a direct transaction history endpoint
    // This would typically require using Etherscan API or similar
    // For now, return a not implemented response
    return {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Transaction history not implemented for Alchemy provider',
      },
      metadata: {
        provider: this.name,
        chainId: this.chainId,
        timestamp: Date.now(),
        requestId: 'not_implemented',
      },
    };
  }

  private async getTokenMetadata(tokenAddress: string): Promise<ProviderResponse<AlchemyTokenMetadata>> {
    const cacheKey = this.getCacheKey('getTokenMetadata', { tokenAddress });
    
    return this.getCached(
      cacheKey,
      async () => {
        const response = await this.makeRequest<{ name: string; symbol: string; decimals: number; logo?: string }>({
          method: 'POST',
          url: '',
          data: {
            id: 1,
            jsonrpc: '2.0',
            method: 'alchemy_getTokenMetadata',
            params: [tokenAddress],
          },
        });

        if (!response.success) {
          return response as ProviderResponse<AlchemyTokenMetadata>;
        }

        return {
          ...response,
          data: response.data as AlchemyTokenMetadata,
        };
      },
      this.config.cacheTtl.token
    );
  }
}