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
      const blockNumber = await this.provider.getBlockNumber();
      logger.info(`Alchemy provider initialized for chain ${this.chainId}`, {
        blockNumber,
        provider: this.name,
        chainId: this.chainId,
      });
      this.healthy = true;
    } catch (error) {
      this.healthy = false;
      logger.error(`Failed to initialize Alchemy provider for chain ${this.chainId}:`, { 
        error: error instanceof Error ? error.message : 'Unknown error',
        provider: this.name,
        chainId: this.chainId,
      });
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

  protected async performHealthCheckRequest(): Promise<boolean> {
    try {
      await this.provider.getBlockNumber();
      return true;
    } catch (error) {
      logger.debug(`Alchemy health check failed:`, { 
        error: error instanceof Error ? error.message : 'Unknown error',
        provider: this.name,
        chainId: this.chainId,
      });
      return false;
    }
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
          
          // Get token balances using Alchemy's enhanced API
          const tokenBalancesResponse = await this.makeRequest<{ result: AlchemyBalanceResponse }>({
            method: 'POST',
            url: '',
            data: {
              id: 1,
              jsonrpc: '2.0',
              method: 'alchemy_getTokenBalances',
              params: [address, 'erc20'],
            },
          }, undefined, this.config.costPerRequest * 1.5); // Token balance requests cost more

          if (!tokenBalancesResponse.success || !tokenBalancesResponse.data?.result) {
            logger.warn(`Failed to fetch token balances for ${address}:`, {
              success: tokenBalancesResponse.success,
              error: tokenBalancesResponse.error,
              provider: this.name,
            });
            // Still return native balance even if token fetch fails
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

          // Process token balances if available
          const tokenBalances = tokenBalancesResponse.data?.result?.tokenBalances || [];
          for (const tokenBalance of tokenBalances) {
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
                  isNative: false, // ERC-20 tokens are not native
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
              cost: this.config.costPerRequest * (tokenBalancesResponse.success ? 2.5 : 1), // Native + enhanced token balances
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
              cost: this.config.costPerRequest * 2.5, // Balance + metadata + ERC20 call
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
              cost: this.config.costPerRequest * 3.5, // Transaction + receipt + block + enhanced data
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
    const { limit = 10, startBlock, endBlock } = options;
    const cacheKey = this.getCacheKey('getTransactionHistory', { address, limit, startBlock, endBlock });
    
    return this.getCached(
      cacheKey,
      async () => {
        try {
          // Use Alchemy's asset transfers API for transaction history
          const response = await this.makeRequest<{ result: { transfers: any[] } }>({
            method: 'POST',
            url: '',
            data: {
              id: 1,
              jsonrpc: '2.0',
              method: 'alchemy_getAssetTransfers',
              params: [{
                fromAddress: address,
                toAddress: address,
                category: ['external', 'erc20', 'erc721', 'erc1155'],
                maxCount: limit,
                order: 'desc',
                ...(startBlock && { fromBlock: `0x${startBlock.toString(16)}` }),
                ...(endBlock && { toBlock: `0x${endBlock.toString(16)}` }),
              }],
            },
          }, undefined, this.config.costPerRequest * 2);

          if (!response.success || !response.data?.result?.transfers) {
            return {
              success: false,
              error: {
                code: 'TRANSACTION_HISTORY_ERROR',
                message: 'Failed to fetch transaction history from Alchemy',
                details: response.error,
              },
              metadata: {
                provider: this.name,
                chainId: this.chainId,
                timestamp: Date.now(),
                requestId: 'history_error',
              },
            };
          }

          const transactions: Transaction[] = response.data.result.transfers.map((transfer: any) => ({
            hash: transfer.hash,
            chainId: this.chainId,
            from: transfer.from,
            to: transfer.to,
            value: transfer.value?.toString() || '0',
            status: 'confirmed' as const,
            blockNumber: parseInt(transfer.blockNum, 16),
            timestamp: new Date(), // Alchemy doesn't provide timestamp in transfers
            tokenTransfers: transfer.asset ? [{
              token: {
                address: transfer.rawContract?.address || 'native',
                chainId: this.chainId,
                symbol: transfer.asset,
                name: transfer.asset,
                decimals: transfer.rawContract?.decimal || 18,
                isNative: !transfer.rawContract?.address, // Native if no contract address
              },
              from: transfer.from,
              to: transfer.to,
              amount: transfer.rawContract?.value || transfer.value || '0',
              amountFormatted: transfer.value?.toString() || '0',
            }] : undefined,
          }));

          return {
            success: true,
            data: transactions,
            metadata: {
              provider: this.name,
              chainId: this.chainId,
              timestamp: Date.now(),
              requestId: 'transaction_history',
              cost: this.config.costPerRequest * 2,
              cacheTtl: this.config.cacheTtl.transaction,
            },
          };
        } catch (error) {
          logger.error(`Failed to get transaction history for ${address}:`, { 
            error: error instanceof Error ? error.message : 'Unknown error',
            provider: this.name,
            chainId: this.chainId,
          });
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

  private async getTokenMetadata(tokenAddress: string): Promise<ProviderResponse<AlchemyTokenMetadata>> {
    const cacheKey = this.getCacheKey('getTokenMetadata', { tokenAddress });
    
    return this.getCached(
      cacheKey,
      async () => {
        const response = await this.makeRequest<{ result: { name: string; symbol: string; decimals: number; logo?: string } }>({
          method: 'POST',
          url: '',
          data: {
            id: 1,
            jsonrpc: '2.0',
            method: 'alchemy_getTokenMetadata',
            params: [tokenAddress],
          },
        }, undefined, this.config.costPerRequest * 0.5); // Metadata requests are cheaper

        if (!response.success) {
          return response as ProviderResponse<AlchemyTokenMetadata>;
        }

        return {
          ...response,
          data: response.data?.result as AlchemyTokenMetadata,
        };
      },
      this.config.cacheTtl.token
    );
  }
}