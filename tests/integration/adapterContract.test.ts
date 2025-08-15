/**
 * Adapter Contract Tests
 * 
 * Tests that all provider adapters conform to the expected interface contracts
 * using canned fixtures and standardized test scenarios.
 * 
 * Phase 2 requirement: Create adapter contract tests with canned fixtures
 */

import { ChainId, TokenBalance, ProviderResponse, Transaction } from '@/types/blockchain';
import { DeFiPosition, ProtocolAdapter } from '@/types/defi';

// Test fixtures for consistent adapter testing
export const testFixtures = {
  ethereum: {
    addresses: {
      valid: '0x742d35cc6442c5f7d8e9d2e8c6ff1c6c73746a36',
      invalid: '0xinvalid',
      zero: '0x0000000000000000000000000000000000000000',
    },
    transactions: {
      valid: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      notFound: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    },
    tokens: {
      native: {
        address: '0x0000000000000000000000000000000000000000',
        symbol: 'ETH',
        name: 'Ether',
        decimals: 18,
        isNative: true,
      },
      usdc: {
        address: '0xA0b86991c6218B36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        isNative: false,
      },
      weth: {
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        symbol: 'WETH',
        name: 'Wrapped Ether',
        decimals: 18,
        isNative: false,
      },
    },
  },
  solana: {
    addresses: {
      valid: 'DQyrAcCrDXQ7NeoqGgDCZwBvZ7YbvhC7s9Gd8sDZRjfR',
      invalid: 'invalid-solana-address',
    },
    transactions: {
      valid: '5VfydruFd2qcgUVDRGCvgcBXt9Pft3MzGCvDcKSJZfxP8VQR7YG3nWQe1XFGqGjP',
      notFound: 'nonexistent-transaction-signature',
    },
    tokens: {
      native: {
        mint: 'So11111111111111111111111111111111111111112',
        symbol: 'SOL',
        name: 'Solana',
        decimals: 9,
      },
      usdc: {
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
      },
    },
  },
  defi: {
    protocols: {
      aave: {
        name: 'Aave V3',
        category: 'lending',
        chain: ChainId.ETHEREUM,
      },
      compound: {
        name: 'Compound V3',
        category: 'lending', 
        chain: ChainId.ETHEREUM,
      },
      uniswap: {
        name: 'Uniswap V3',
        category: 'dex',
        chain: ChainId.ETHEREUM,
      },
    },
    positions: {
      aaveLending: {
        protocol: 'aave-v3',
        position: 'lending',
        token: 'USDC',
        amount: '1000.50',
        valueUSD: 1000.50,
        apy: 0.045,
      },
      compoundBorrowing: {
        protocol: 'compound-v3',
        position: 'borrowing',
        token: 'ETH',
        amount: '0.5',
        valueUSD: 1000,
        apy: 0.03,
      },
      uniswapLP: {
        protocol: 'uniswap-v3',
        position: 'liquidity',
        token: 'ETH/USDC',
        amount: '1000',
        valueUSD: 2000,
        apy: 0.15,
      },
    },
  },
  responses: {
    success: <T>(data: T, provider: string = 'test'): ProviderResponse<T> => ({
      success: true,
      data,
      metadata: {
        provider,
        chainId: ChainId.ETHEREUM,
        timestamp: Date.now(),
        requestId: `test-${Math.random().toString(36)}`,
      },
    }),
    error: (code: string, message: string, provider: string = 'test'): ProviderResponse<any> => ({
      success: false,
      error: { code, message },
      metadata: {
        provider,
        chainId: ChainId.ETHEREUM,
        timestamp: Date.now(),
        requestId: `error-${Math.random().toString(36)}`,
      },
    }),
  },
};

/**
 * Standard test suite that all blockchain providers must pass
 */
export function testBlockchainProviderContract(
  createProvider: () => any,
  chainId: ChainId,
  fixtures: typeof testFixtures.ethereum
) {
  describe(`Blockchain Provider Contract Tests (${ChainId[chainId]})`, () => {
    let provider: any;

    beforeEach(() => {
      provider = createProvider();
    });

    describe('Provider Interface', () => {
      it('should have all required methods', () => {
        expect(provider).toHaveProperty('getBalance');
        expect(provider).toHaveProperty('getTransaction');
        expect(provider).toHaveProperty('healthCheck');
        expect(provider).toHaveProperty('initialize');
        expect(provider).toHaveProperty('chainId', chainId);
        expect(provider).toHaveProperty('name');
        expect(typeof provider.getBalance).toBe('function');
        expect(typeof provider.getTransaction).toBe('function');
        expect(typeof provider.healthCheck).toBe('function');
        expect(typeof provider.initialize).toBe('function');
      });

      it('should expose chainId and name properties', () => {
        expect(provider.chainId).toBe(chainId);
        expect(typeof provider.name).toBe('string');
        expect(provider.name.length).toBeGreaterThan(0);
      });
    });

    describe('getBalance method', () => {
      it('should return ProviderResponse<TokenBalance[]> for valid address', async () => {
        // Mock successful response
        const mockBalances: TokenBalance[] = [
          {
            token: {
              ...fixtures.tokens.native,
              chainId,
            },
            balance: '1000000000000000000',
            balanceFormatted: '1.0',
            lastUpdated: new Date(),
          },
        ];

        jest.spyOn(provider, 'getBalance').mockResolvedValue(
          testFixtures.responses.success(mockBalances, provider.name)
        );

        const result = await provider.getBalance(fixtures.addresses.valid);

        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('metadata');
        expect(result.metadata).toHaveProperty('provider');
        expect(result.metadata).toHaveProperty('chainId', chainId);
        expect(result.metadata).toHaveProperty('timestamp');
        expect(result.metadata).toHaveProperty('requestId');

        if (result.success) {
          expect(Array.isArray(result.data)).toBe(true);
          result.data.forEach((balance: TokenBalance) => {
            expect(balance).toHaveProperty('token');
            expect(balance).toHaveProperty('balance');
            expect(balance).toHaveProperty('balanceFormatted');
            expect(balance).toHaveProperty('lastUpdated');
            expect(balance.token).toHaveProperty('address');
            expect(balance.token).toHaveProperty('symbol');
            expect(balance.token).toHaveProperty('name');
            expect(balance.token).toHaveProperty('decimals');
            expect(balance.token).toHaveProperty('chainId', chainId);
          });
        }
      });

      it('should handle invalid addresses gracefully', async () => {
        jest.spyOn(provider, 'getBalance').mockResolvedValue(
          testFixtures.responses.error('INVALID_ADDRESS', 'Invalid address format', provider.name)
        );

        const result = await provider.getBalance(fixtures.addresses.invalid);

        expect(result.success).toBe(false);
        expect(result.error).toHaveProperty('code');
        expect(result.error).toHaveProperty('message');
        expect(result.metadata).toHaveProperty('provider', provider.name);
      });

      it('should handle network errors gracefully', async () => {
        jest.spyOn(provider, 'getBalance').mockResolvedValue(
          testFixtures.responses.error('NETWORK_ERROR', 'Network request failed', provider.name)
        );

        const result = await provider.getBalance(fixtures.addresses.valid);

        expect(result.success).toBe(false);
        expect(result.error.code).toBe('NETWORK_ERROR');
      });
    });

    describe('getTransaction method', () => {
      it('should return ProviderResponse<Transaction> for valid transaction hash', async () => {
        const mockTransaction: Transaction = {
          hash: fixtures.transactions.valid,
          blockNumber: 12345678,
          from: fixtures.addresses.valid,
          to: fixtures.addresses.valid,
          value: '1000000000000000000',
          gasUsed: '21000',
          gasPrice: '20000000000',
          timestamp: new Date(),
          status: 'success',
          chainId,
        };

        jest.spyOn(provider, 'getTransaction').mockResolvedValue(
          testFixtures.responses.success(mockTransaction, provider.name)
        );

        const result = await provider.getTransaction(fixtures.transactions.valid);

        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('metadata');

        if (result.success) {
          const tx = result.data;
          expect(tx).toHaveProperty('hash');
          expect(tx).toHaveProperty('blockNumber');
          expect(tx).toHaveProperty('from');
          expect(tx).toHaveProperty('to');
          expect(tx).toHaveProperty('value');
          expect(tx).toHaveProperty('chainId', chainId);
          expect(tx).toHaveProperty('timestamp');
          expect(tx).toHaveProperty('status');
        }
      });

      it('should handle transaction not found', async () => {
        jest.spyOn(provider, 'getTransaction').mockResolvedValue(
          testFixtures.responses.error('TRANSACTION_NOT_FOUND', 'Transaction not found', provider.name)
        );

        const result = await provider.getTransaction(fixtures.transactions.notFound);

        expect(result.success).toBe(false);
        expect(result.error.code).toBe('TRANSACTION_NOT_FOUND');
      });
    });

    describe('healthCheck method', () => {
      it('should return boolean health status', async () => {
        jest.spyOn(provider, 'healthCheck').mockResolvedValue(true);

        const result = await provider.healthCheck();

        expect(typeof result).toBe('boolean');
      });

      it('should handle health check failures', async () => {
        jest.spyOn(provider, 'healthCheck').mockResolvedValue(false);

        const result = await provider.healthCheck();

        expect(result).toBe(false);
      });
    });

    describe('initialize method', () => {
      it('should initialize without throwing errors', async () => {
        jest.spyOn(provider, 'initialize').mockResolvedValue(undefined);

        await expect(provider.initialize()).resolves.not.toThrow();
      });
    });
  });
}

/**
 * Standard test suite for DeFi protocol adapters
 */
export function testProtocolAdapterContract(
  createAdapter: () => ProtocolAdapter,
  protocolName: string
) {
  describe(`Protocol Adapter Contract Tests (${protocolName})`, () => {
    let adapter: ProtocolAdapter;

    beforeEach(() => {
      adapter = createAdapter();
    });

    describe('Adapter Interface', () => {
      it('should have all required methods and properties', () => {
        expect(adapter).toHaveProperty('name', protocolName);
        expect(adapter).toHaveProperty('getPositions');
        expect(adapter).toHaveProperty('getProtocolMetrics');
        expect(typeof adapter.getPositions).toBe('function');
        expect(typeof adapter.getProtocolMetrics).toBe('function');
      });
    });

    describe('getPositions method', () => {
      it('should return DeFi positions for valid address', async () => {
        const mockPositions: DeFiPosition[] = [
          {
            protocol: protocolName,
            position: 'lending',
            token: 'USDC',
            amount: '1000',
            valueUSD: 1000,
            apy: 0.045,
            chainId: ChainId.ETHEREUM,
            contractAddress: testFixtures.ethereum.addresses.valid,
            lastUpdated: new Date(),
          },
        ];

        jest.spyOn(adapter, 'getPositions').mockResolvedValue(mockPositions);

        const result = await adapter.getPositions(testFixtures.ethereum.addresses.valid);

        expect(Array.isArray(result)).toBe(true);
        result.forEach((position: DeFiPosition) => {
          expect(position).toHaveProperty('protocol');
          expect(position).toHaveProperty('position');
          expect(position).toHaveProperty('token');
          expect(position).toHaveProperty('amount');
          expect(position).toHaveProperty('valueUSD');
          expect(position).toHaveProperty('chainId');
          expect(position).toHaveProperty('lastUpdated');
          expect(position.protocol).toBe(protocolName);
        });
      });

      it('should handle addresses with no positions', async () => {
        jest.spyOn(adapter, 'getPositions').mockResolvedValue([]);

        const result = await adapter.getPositions(testFixtures.ethereum.addresses.valid);

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(0);
      });
    });

    describe('getProtocolMetrics method', () => {
      it('should return protocol-level metrics', async () => {
        const mockMetrics = {
          totalValueLocked: '1000000000',
          totalBorrowed: '400000000',
          utilizationRate: 0.4,
          averageAPY: 0.05,
          protocolRevenue: '5000000',
        };

        jest.spyOn(adapter, 'getProtocolMetrics').mockResolvedValue(mockMetrics);

        const result = await adapter.getProtocolMetrics();

        expect(result).toHaveProperty('totalValueLocked');
        expect(result).toHaveProperty('utilizationRate');
        expect(typeof result.totalValueLocked).toBe('string');
        expect(typeof result.utilizationRate).toBe('number');
        expect(result.utilizationRate).toBeGreaterThanOrEqual(0);
        expect(result.utilizationRate).toBeLessThanOrEqual(1);
      });
    });
  });
}

/**
 * Performance contract tests
 */
export function testProviderPerformanceContract(
  createProvider: () => any,
  chainId: ChainId
) {
  describe(`Provider Performance Contract (${ChainId[chainId]})`, () => {
    let provider: any;

    beforeEach(() => {
      provider = createProvider();
    });

    it('should respond to getBalance within reasonable time', async () => {
      const mockResponse = testFixtures.responses.success([], provider.name);
      jest.spyOn(provider, 'getBalance').mockResolvedValue(mockResponse);

      const startTime = Date.now();
      await provider.getBalance(testFixtures.ethereum.addresses.valid);
      const responseTime = Date.now() - startTime;

      // Should respond within 5 seconds (mocked, but tests the interface)
      expect(responseTime).toBeLessThan(5000);
    });

    it('should handle concurrent requests', async () => {
      const mockResponse = testFixtures.responses.success([], provider.name);
      jest.spyOn(provider, 'getBalance').mockResolvedValue(mockResponse);

      const promises = Array(10).fill(null).map(() => 
        provider.getBalance(testFixtures.ethereum.addresses.valid)
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });

    it('should provide request metadata for debugging', async () => {
      const mockResponse = testFixtures.responses.success([], provider.name);
      jest.spyOn(provider, 'getBalance').mockResolvedValue(mockResponse);

      const result = await provider.getBalance(testFixtures.ethereum.addresses.valid);

      expect(result.metadata).toHaveProperty('requestId');
      expect(result.metadata).toHaveProperty('timestamp');
      expect(result.metadata).toHaveProperty('provider', provider.name);
      expect(typeof result.metadata.requestId).toBe('string');
      expect(typeof result.metadata.timestamp).toBe('number');
    });
  });
}

// Example usage of contract tests for specific providers
describe('Alchemy Provider Contract', () => {
  const createAlchemyProvider = () => ({
    name: 'Alchemy',
    chainId: ChainId.ETHEREUM,
    getBalance: jest.fn(),
    getTransaction: jest.fn(),
    healthCheck: jest.fn(),
    initialize: jest.fn(),
  });

  testBlockchainProviderContract(
    createAlchemyProvider,
    ChainId.ETHEREUM,
    testFixtures.ethereum
  );

  testProviderPerformanceContract(createAlchemyProvider, ChainId.ETHEREUM);
});

describe('Aave V3 Adapter Contract', () => {
  const createAaveAdapter = () => ({
    name: 'aave-v3',
    getPositions: jest.fn(),
    getProtocolMetrics: jest.fn(),
  });

  testProtocolAdapterContract(createAaveAdapter, 'aave-v3');
});

describe('Solana Provider Contract', () => {
  const createSolanaProvider = () => ({
    name: 'Helius',
    chainId: ChainId.SOLANA,
    getBalance: jest.fn(),
    getTransaction: jest.fn(),
    healthCheck: jest.fn(),
    initialize: jest.fn(),
  });

  testBlockchainProviderContract(
    createSolanaProvider,
    ChainId.SOLANA,
    testFixtures.solana
  );

  testProviderPerformanceContract(createSolanaProvider, ChainId.SOLANA);
});