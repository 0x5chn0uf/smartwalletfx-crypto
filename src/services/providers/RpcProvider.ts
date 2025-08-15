import { ethers } from 'ethers';
import {
  ChainId,
  ProviderConfig,
  ProviderResponse,
  TokenBalance,
  Transaction,
  ChainProviderError,
  COMMON_TOKENS,
} from '@/types/blockchain';
import { BaseProvider } from './BaseProvider';
import { logger } from '@/utils/logger';

/**
 * Generic EVM JSON-RPC provider adapter.
 *
 * Notes:
 * - getBalance returns native token only (no token enumeration over plain RPC).
 * - getTokenBalance supports ERC20 via balanceOf(address).
 * - getTransaction fetches tx + receipt via RPC.
 */
export class RpcProvider extends BaseProvider {
  private readonly provider: ethers.JsonRpcProvider;

  constructor(chainId: ChainId, rpcUrl: string, name: string = 'RPC') {
    const config: ProviderConfig = {
      apiKey: '',
      baseUrl: rpcUrl,
      rateLimit: {
        requestsPerSecond: 5,
        requestsPerMinute: 300,
        requestsPerHour: 18000,
      },
      timeout: 30000,
      retries: 2,
      cacheTtl: {
        balance: 120, // 2 minutes
        transaction: 600,
        token: 3600,
      },
      costPerRequest: 0.0003,
    };

    super(chainId, name, config);
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  async initialize(): Promise<void> {
    try {
      const blockNumber = await this.provider.getBlockNumber();
      logger.info(`${this.name} provider initialized for chain ${this.chainId}`, {
        blockNumber,
        provider: this.name,
        chainId: this.chainId,
      });
      this.healthy = true;
    } catch (error) {
      this.healthy = false;
      logger.error(`Failed to initialize ${this.name} provider for chain ${this.chainId}:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        provider: this.name,
        chainId: this.chainId,
      });
      throw error;
    }
  }

  protected buildAuthHeaders(): Record<string, string> {
    return {};
  }

  protected handleProviderError(error: any): ChainProviderError {
    return new ChainProviderError(
      error?.message || 'RPC provider error',
      this.name,
      this.chainId,
      'RPC_ERROR',
      true
    );
  }

  protected parseBalanceResponse(): TokenBalance[] {
    throw new Error('Not implemented');
  }

  protected parseTransactionResponse(): Transaction {
    throw new Error('Not implemented');
  }

  protected async performHealthCheckRequest(): Promise<boolean> {
    try {
      await this.provider.getBlockNumber();
      return true;
    } catch {
      return false;
    }
  }

  async getBalance(address: string): Promise<ProviderResponse<TokenBalance[]>> {
    if (!this.isValidAddress(address)) {
      return {
        success: false,
        error: { code: 'INVALID_ADDRESS', message: `Invalid address: ${address}` },
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
          const nativeBalance = await this.provider.getBalance(address);
          const now = new Date();
          const nativeSymbol = this.chainId === ChainId.BSC ? 'BNB'
            : this.chainId === ChainId.AVALANCHE ? 'AVAX'
            : 'ETH';

          const balances: TokenBalance[] = [
            {
              token: {
                address: 'native',
                chainId: this.chainId,
                symbol: nativeSymbol,
                name: nativeSymbol,
                decimals: 18,
                isNative: true,
              },
              balance: nativeBalance.toString(),
              balanceFormatted: ethers.formatEther(nativeBalance),
              lastUpdated: now,
            },
          ];

          return {
            success: true,
            data: balances,
            metadata: {
              provider: this.name,
              chainId: this.chainId,
              timestamp: Date.now(),
              requestId: 'native_balance',
              cacheTtl: this.config.cacheTtl.balance,
              cost: this.config.costPerRequest,
            },
          };
        } catch (error) {
          logger.error(`RPC getBalance failed:`, { error, address, chainId: this.chainId });
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
        error: { code: 'INVALID_ADDRESS', message: `Invalid address: ${address}` },
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
          // Handle native
          if (tokenAddress === 'native') {
            const bal = await this.provider.getBalance(address);
            const symbol = this.chainId === ChainId.BSC ? 'BNB'
              : this.chainId === ChainId.AVALANCHE ? 'AVAX'
              : 'ETH';
            return {
              success: true,
              data: {
                token: { address: 'native', chainId: this.chainId, symbol, name: symbol, decimals: 18, isNative: true },
                balance: bal.toString(),
                balanceFormatted: ethers.formatEther(bal),
                lastUpdated: new Date(),
              },
              metadata: { provider: this.name, chainId: this.chainId, timestamp: Date.now(), requestId: 'native_balance', cost: this.config.costPerRequest },
            };
          }

          const contract = new ethers.Contract(
            tokenAddress,
            ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)', 'function symbol() view returns (string)', 'function name() view returns (string)'],
            this.provider
          );

          const [bal, decimals, symbol, name] = await Promise.all([
            contract.balanceOf(address),
            contract.decimals().catch(() => 18),
            contract.symbol().catch(() => 'TOKEN'),
            contract.name().catch(() => 'Token'),
          ]);

          return {
            success: true,
            data: {
              token: { address: tokenAddress.toLowerCase(), chainId: this.chainId, symbol, name, decimals },
              balance: bal.toString(),
              balanceFormatted: ethers.formatUnits(bal, decimals),
              lastUpdated: new Date(),
            },
            metadata: { provider: this.name, chainId: this.chainId, timestamp: Date.now(), requestId: 'token_balance', cost: this.config.costPerRequest * 1.5 },
          };
        } catch (error) {
          logger.error('RPC getTokenBalance failed', { error, address, tokenAddress, chainId: this.chainId });
          return { success: false, error: { code: 'TOKEN_BALANCE_ERROR', message: error instanceof Error ? error.message : 'Unknown error' }, metadata: { provider: this.name, chainId: this.chainId, timestamp: Date.now(), requestId: 'error' } };
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
            return { success: false, error: { code: 'TRANSACTION_NOT_FOUND', message: `Transaction ${hash} not found` }, metadata: { provider: this.name, chainId: this.chainId, timestamp: Date.now(), requestId: 'not_found' } };
          }

          const status = receipt?.status === 1 ? 'confirmed' : receipt ? 'failed' : 'pending';
          const value = tx.value ? tx.value.toString() : '0';
          const txData: Transaction = {
            hash: tx.hash,
            chainId: this.chainId,
            from: tx.from!,
            to: tx.to || undefined,
            value,
            status,
            gasPrice: tx.gasPrice?.toString(),
            gasLimit: tx.gasLimit?.toString(),
            gasUsed: receipt?.gasUsed?.toString(),
            blockNumber: tx.blockNumber || undefined,
            timestamp: new Date(),
          } as any;

          return { success: true, data: txData, metadata: { provider: this.name, chainId: this.chainId, timestamp: Date.now(), requestId: 'tx', cacheTtl: this.config.cacheTtl.transaction, cost: this.config.costPerRequest } };
        } catch (error) {
          logger.error('RPC getTransaction failed', { error, hash, chainId: this.chainId });
          return { success: false, error: { code: 'TRANSACTION_ERROR', message: error instanceof Error ? error.message : 'Unknown error' }, metadata: { provider: this.name, chainId: this.chainId, timestamp: Date.now(), requestId: 'error' } };
        }
      },
      this.config.cacheTtl.transaction
    );
  }

  async getTransactionHistory(): Promise<ProviderResponse<Transaction[]>> {
    return {
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'Transaction history not supported via generic RPC' },
      metadata: { provider: this.name, chainId: this.chainId, timestamp: Date.now(), requestId: 'not_implemented' },
    };
  }
}

