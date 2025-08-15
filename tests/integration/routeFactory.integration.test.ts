/**
 * Route Factory Integration Tests
 * 
 * Tests the factory-based route system with dependency injection
 * using supertest for HTTP testing and stubbed dependencies.
 * 
 * Phase 2 requirement: Integration tests with supertest and stubbed ports
 */

import request from 'supertest';
import express from 'express';
import { ChainId, TokenBalance, ProviderResponse } from '@/types/blockchain';
import { createPortfolioRouteFactory } from '@/routes/portfolioRouteFactory';
import { createDefiRouteFactory } from '@/routes/defiRouteFactory';
import { createNftRouteFactory } from '@/routes/nftRouteFactory';
import { createSolanaRouteFactory } from '@/routes/solanaRouteFactory';
import { ErrorCategory, buildErrorResponse } from '@/utils/responseBuilder';

// Mock all external dependencies
jest.mock('@/utils/redis', () => ({
  redisManager: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

jest.mock('@/services/pricing/PriceService', () => ({
  getPriceService: () => ({
    enrichBalances: jest.fn(),
    getPrice: jest.fn(),
  }),
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  logApiCall: jest.fn(),
  logCost: jest.fn(),
}));

describe('Route Factory Integration Tests', () => {
  let app: express.Application;
  let mockChainManager: any;
  let mockDeFiOrchestrator: any;
  let mockNFTOrchestrator: any;
  let mockSolanaOrchestrator: any;

  beforeEach(() => {
    // Create Express app
    app = express();
    app.use(express.json());

    // Create mock dependencies
    mockChainManager = {
      getBalance: jest.fn(),
      getMultiChainPortfolio: jest.fn(),
      getTransaction: jest.fn(),
      getHealthyChains: jest.fn(),
      getSupportedChains: jest.fn(),
    };

    mockDeFiOrchestrator = {
      getPositions: jest.fn(),
      getProtocolData: jest.fn(),
      getYield: jest.fn(),
    };

    mockNFTOrchestrator = {
      getNFTs: jest.fn(),
      getCollections: jest.fn(),
      getMetadata: jest.fn(),
    };

    mockSolanaOrchestrator = {
      getTokenAccounts: jest.fn(),
      getStakeAccounts: jest.fn(),
      getTransactions: jest.fn(),
    };

    // Wire routes with mocked dependencies
    const portfolioRoutes = createPortfolioRouteFactory({
      chainManager: mockChainManager,
    });

    const defiRoutes = createDefiRouteFactory({
      defiOrchestrator: mockDeFiOrchestrator,
    });

    const nftRoutes = createNftRouteFactory({
      nftOrchestrator: mockNFTOrchestrator,
    });

    const solanaRoutes = createSolanaRouteFactory({
      solanaOrchestrator: mockSolanaOrchestrator,
    });

    // Mount routes
    app.use('/api/portfolio', portfolioRoutes);
    app.use('/api/defi', defiRoutes);
    app.use('/api/nft', nftRoutes);
    app.use('/api/solana', solanaRoutes);

    // Add error handler
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      const errorResponse = buildErrorResponse(
        ErrorCategory.INTERNAL_ERROR,
        'Internal server error',
        err.message
      );
      res.status(500).json(errorResponse);
    });
  });

  describe('Portfolio Route Factory', () => {
    it('should get portfolio balance with proper dependency injection', async () => {
      const mockBalance: TokenBalance[] = [
        {
          token: {
            address: '0x0000000000000000000000000000000000000000',
            chainId: ChainId.ETHEREUM,
            symbol: 'ETH',
            name: 'Ether',
            decimals: 18,
            isNative: true,
          },
          balance: '1000000000000000000',
          balanceFormatted: '1.0',
          lastUpdated: new Date(),
          balanceUSD: 2000,
          priceUSD: 2000,
        },
      ];

      const mockResponse: ProviderResponse<TokenBalance[]> = {
        success: true,
        data: mockBalance,
        metadata: {
          provider: 'test',
          chainId: ChainId.ETHEREUM,
          timestamp: Date.now(),
          requestId: 'test-123',
        },
      };

      mockChainManager.getBalance.mockResolvedValue(mockResponse);

      const response = await request(app)
        .get('/api/portfolio/balance')
        .query({ 
          address: '0x742d35cc6442c5f7d8e9d2e8c6ff1c6c73746a36',
          chainId: ChainId.ETHEREUM 
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].token.symbol).toBe('ETH');
      expect(mockChainManager.getBalance).toHaveBeenCalledWith(
        ChainId.ETHEREUM,
        '0x742d35cc6442c5f7d8e9d2e8c6ff1c6c73746a36'
      );
    });

    it('should handle multi-chain portfolio requests', async () => {
      const mockPortfolio = {
        address: '0x742d35cc6442c5f7d8e9d2e8c6ff1c6c73746a36',
        totalValueUSD: 5000,
        chains: [
          {
            address: '0x742d35cc6442c5f7d8e9d2e8c6ff1c6c73746a36',
            chainId: ChainId.ETHEREUM,
            totalValueUSD: 3000,
            tokenCount: 2,
            tokens: [],
            lastUpdated: new Date(),
          },
          {
            address: '0x742d35cc6442c5f7d8e9d2e8c6ff1c6c73746a36',
            chainId: ChainId.POLYGON,
            totalValueUSD: 2000,
            tokenCount: 1,
            tokens: [],
            lastUpdated: new Date(),
          },
        ],
        topTokens: [],
        diversificationScore: 75,
        lastUpdated: new Date(),
        metadata: {
          fetchTimeMs: 150,
          chainCount: 2,
          totalTokens: 3,
          cacheHitRate: 0.5,
        },
      };

      mockChainManager.getMultiChainPortfolio.mockResolvedValue({
        success: true,
        data: mockPortfolio,
        metadata: {
          provider: 'ChainManager',
          chainId: ChainId.ETHEREUM,
          timestamp: Date.now(),
          requestId: 'multi-chain-test',
        },
      });

      const response = await request(app)
        .get('/api/portfolio/multi-chain')
        .query({ address: '0x742d35cc6442c5f7d8e9d2e8c6ff1c6c73746a36' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.totalValueUSD).toBe(5000);
      expect(response.body.data.chains).toHaveLength(2);
      expect(mockChainManager.getMultiChainPortfolio).toHaveBeenCalledWith(
        '0x742d35cc6442c5f7d8e9d2e8c6ff1c6c73746a36',
        undefined
      );
    });

    it('should handle provider errors with standardized error responses', async () => {
      mockChainManager.getBalance.mockResolvedValue({
        success: false,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Provider is currently unavailable',
        },
        metadata: {
          provider: 'test',
          chainId: ChainId.ETHEREUM,
          timestamp: Date.now(),
          requestId: 'error-test',
        },
      });

      const response = await request(app)
        .get('/api/portfolio/balance')
        .query({ 
          address: '0x742d35cc6442c5f7d8e9d2e8c6ff1c6c73746a36',
          chainId: ChainId.ETHEREUM 
        });

      expect(response.status).toBe(503);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('PROVIDER_UNAVAILABLE');
      expect(response.body.error.message).toBe('Provider is currently unavailable');
    });

    it('should validate request parameters', async () => {
      const response = await request(app)
        .get('/api/portfolio/balance')
        .query({ 
          address: 'invalid-address',
          chainId: 'invalid-chain' 
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DeFi Route Factory', () => {
    it('should get DeFi positions with proper dependency injection', async () => {
      const mockPositions = [
        {
          protocol: 'aave-v3',
          position: 'lending',
          token: 'USDC',
          amount: '1000',
          valueUSD: 1000,
        },
      ];

      mockDeFiOrchestrator.getPositions.mockResolvedValue({
        success: true,
        data: mockPositions,
        metadata: {
          provider: 'defi-orchestrator',
          timestamp: Date.now(),
        },
      });

      const response = await request(app)
        .get('/api/defi/positions')
        .query({ 
          address: '0x742d35cc6442c5f7d8e9d2e8c6ff1c6c73746a36',
          protocols: 'aave-v3,compound-v3'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].protocol).toBe('aave-v3');
      expect(mockDeFiOrchestrator.getPositions).toHaveBeenCalled();
    });

    it('should handle DeFi protocol data requests', async () => {
      const mockProtocolData = {
        protocol: 'aave-v3',
        totalValueLocked: '2000000000',
        totalBorrowed: '800000000',
        utilizationRate: 0.4,
        averageAPY: 0.05,
      };

      mockDeFiOrchestrator.getProtocolData.mockResolvedValue({
        success: true,
        data: mockProtocolData,
        metadata: {
          provider: 'defi-orchestrator',
          timestamp: Date.now(),
        },
      });

      const response = await request(app)
        .get('/api/defi/protocols/aave-v3');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.protocol).toBe('aave-v3');
      expect(response.body.data.totalValueLocked).toBe('2000000000');
    });
  });

  describe('NFT Route Factory', () => {
    it('should get NFT collections with proper dependency injection', async () => {
      const mockCollections = [
        {
          contractAddress: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
          name: 'Bored Ape Yacht Club',
          symbol: 'BAYC',
          tokenCount: 3,
          floorPrice: 50,
          totalValue: 150,
        },
      ];

      mockNFTOrchestrator.getCollections.mockResolvedValue({
        success: true,
        data: mockCollections,
        metadata: {
          provider: 'nft-orchestrator',
          timestamp: Date.now(),
        },
      });

      const response = await request(app)
        .get('/api/nft/collections')
        .query({ 
          address: '0x742d35cc6442c5f7d8e9d2e8c6ff1c6c73746a36',
          chainId: ChainId.ETHEREUM
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Bored Ape Yacht Club');
      expect(mockNFTOrchestrator.getCollections).toHaveBeenCalled();
    });
  });

  describe('Solana Route Factory', () => {
    it('should get Solana token accounts with proper dependency injection', async () => {
      const mockTokenAccounts = [
        {
          mint: 'So11111111111111111111111111111111111111112',
          symbol: 'SOL',
          balance: '10.5',
          valueUSD: 2100,
        },
      ];

      mockSolanaOrchestrator.getTokenAccounts.mockResolvedValue({
        success: true,
        data: mockTokenAccounts,
        metadata: {
          provider: 'solana-orchestrator',
          timestamp: Date.now(),
        },
      });

      const response = await request(app)
        .get('/api/solana/tokens')
        .query({ address: 'DQyrAcCrDXQ7NeoqGgDCZwBvZ7YbvhC7s9Gd8sDZRjfR' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].symbol).toBe('SOL');
      expect(mockSolanaOrchestrator.getTokenAccounts).toHaveBeenCalled();
    });
  });

  describe('Error Handling and Standardization', () => {
    it('should handle internal server errors with standardized format', async () => {
      mockChainManager.getBalance.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/portfolio/balance')
        .query({ 
          address: '0x742d35cc6442c5f7d8e9d2e8c6ff1c6c73746a36',
          chainId: ChainId.ETHEREUM 
        });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.category).toBe('INTERNAL_ERROR');
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
    });

    it('should handle missing required parameters', async () => {
      const response = await request(app)
        .get('/api/portfolio/balance');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should provide consistent error response structure across all routes', async () => {
      // Test portfolio route error
      const portfolioResponse = await request(app)
        .get('/api/portfolio/balance');

      // Test DeFi route error  
      const defiResponse = await request(app)
        .get('/api/defi/positions');

      // Test NFT route error
      const nftResponse = await request(app)
        .get('/api/nft/collections');

      // Test Solana route error
      const solanaResponse = await request(app)
        .get('/api/solana/tokens');

      // All should have consistent error structure
      const responses = [portfolioResponse, defiResponse, nftResponse, solanaResponse];
      
      responses.forEach(response => {
        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('success', false);
        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toHaveProperty('code');
        expect(response.body.error).toHaveProperty('message');
        expect(response.body.error).toHaveProperty('category');
      });
    });
  });

  describe('Performance and Metrics', () => {
    it('should track response times and metrics', async () => {
      mockChainManager.getBalance.mockResolvedValue({
        success: true,
        data: [],
        metadata: {
          provider: 'test',
          chainId: ChainId.ETHEREUM,
          timestamp: Date.now(),
          requestId: 'perf-test',
        },
      });

      const startTime = Date.now();
      
      const response = await request(app)
        .get('/api/portfolio/balance')
        .query({ 
          address: '0x742d35cc6442c5f7d8e9d2e8c6ff1c6c73746a36',
          chainId: ChainId.ETHEREUM 
        });

      const responseTime = Date.now() - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(1000); // Should respond within 1 second
      expect(response.body).toHaveProperty('metadata');
      expect(response.body.metadata).toHaveProperty('requestId');
    });
  });
});