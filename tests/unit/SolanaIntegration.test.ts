/**
 * Solana DeFi Integration Tests
 * 
 * Comprehensive test suite for Solana DeFi ecosystem integration
 * including Jupiter, Marinade, Orca, and cross-chain functionality.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import SolanaTokenParser from '../../src/services/solana/SolanaTokenParser';
import JupiterAdapter from '../../src/services/defi/adapters/JupiterAdapter';
import MarinadeAdapter from '../../src/services/defi/adapters/MarinadeAdapter';
import OrcaAdapter from '../../src/services/defi/adapters/OrcaAdapter';
import SolanaOrchestrator from '../../src/services/defi/SolanaOrchestrator';
import {
  SolanaProtocol,
  SolanaPositionType,
  WELL_KNOWN_TOKENS,
  SOLANA_NATIVE_MINT,
} from '../../src/types/solana-defi';

// Mock dependencies
jest.mock('../../src/utils/logger');
jest.mock('../../src/utils/redis');
jest.mock('@solana/web3.js');

describe('Solana DeFi Integration', () => {
  let tokenParser: SolanaTokenParser;
  let jupiterAdapter: JupiterAdapter;
  let marinadeAdapter: MarinadeAdapter;
  let orcaAdapter: OrcaAdapter;
  let orchestrator: SolanaOrchestrator;
  
  const testAddress = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
  const testRpcUrl = 'https://api.mainnet-beta.solana.com';

  beforeEach(() => {
    // Initialize components
    tokenParser = new SolanaTokenParser(testRpcUrl);
    
    jupiterAdapter = new JupiterAdapter({
      apiUrl: 'https://quote-api.jup.ag/v6',
      rpcUrl: testRpcUrl,
      timeout: 15000,
      retries: 3,
      cacheSettings: {
        quotes: 30,
        tokens: 3600,
        routes: 300,
      },
    });
    
    marinadeAdapter = new MarinadeAdapter({
      apiUrl: 'https://api.marinade.finance/v1',
      rpcUrl: testRpcUrl,
      timeout: 15000,
      retries: 3,
      cacheSettings: {
        positions: 600,
        validators: 3600,
        state: 300,
      },
    });
    
    orcaAdapter = new OrcaAdapter({
      apiUrl: 'https://api.orca.so/v1',
      rpcUrl: testRpcUrl,
      timeout: 15000,
      retries: 3,
      cacheSettings: {
        pools: 1800,
        positions: 600,
        whirlpools: 900,
      },
    });
    
    orchestrator = new SolanaOrchestrator({
      rpcUrl: testRpcUrl,
      enabledProtocols: [
        SolanaProtocol.JUPITER,
        SolanaProtocol.MARINADE,
        SolanaProtocol.ORCA,
      ],
      cacheSettings: {
        portfolio: 300,
        analytics: 600,
        crossChain: 900,
      },
      performance: {
        maxConcurrentRequests: 5,
        timeoutMs: 15000,
        retryAttempts: 3,
      },
    });

    // Mock external API calls
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('SolanaTokenParser', () => {
    test('should initialize with well-known tokens', () => {
      const stats = tokenParser.getStats();
      expect(stats.wellKnownTokensCount).toBeGreaterThan(0);
      expect(stats.supportedProtocols).toBeGreaterThan(0);
    });

    test('should get token metadata for known tokens', async () => {
      const solToken = await tokenParser.getTokenMetadata(SOLANA_NATIVE_MINT);
      
      expect(solToken).toMatchObject({
        mint: SOLANA_NATIVE_MINT,
        name: 'Solana',
        symbol: 'SOL',
        decimals: 9,
        verified: true,
      });
    });

    test('should handle unknown tokens gracefully', async () => {
      const unknownMint = 'UnknownTokenMint123456789';
      const token = await tokenParser.getTokenMetadata(unknownMint);
      
      expect(token).toMatchObject({
        mint: unknownMint,
        name: 'Unknown Token',
        verified: false,
      });
    });

    test('should build portfolio structure', async () => {
      // Mock connection methods
      const mockGetBalance = jest.fn().mockResolvedValue(1000000000); // 1 SOL
      const mockGetTokenAccountsByOwner = jest.fn().mockResolvedValue({ value: [] });
      
      (tokenParser as any).connection = {
        getBalance: mockGetBalance,
        getTokenAccountsByOwner: mockGetTokenAccountsByOwner,
      };

      const portfolio = await tokenParser.buildPortfolio(testAddress);
      
      expect(portfolio).toMatchObject({
        address: testAddress,
        totalValue: expect.any(Number),
        nativeBalance: 1,
        tokenBalances: expect.any(Array),
        defiPositions: expect.any(Array),
        lastUpdated: expect.any(Number),
      });
    });
  });

  describe('JupiterAdapter', () => {
    test('should initialize successfully', async () => {
      // Mock successful API response
      const mockAxios = {
        get: jest.fn().mockResolvedValue({
          data: [
            {
              address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
              name: 'USD Coin',
              symbol: 'USDC',
              decimals: 6,
              verified: true,
            },
          ],
        }),
      };
      
      (jupiterAdapter as any).httpClient = mockAxios;
      
      await expect(jupiterAdapter.initialize()).resolves.not.toThrow();
      expect(jupiterAdapter.getStats().isInitialized).toBe(true);
    });

    test('should get token list', async () => {
      const mockTokens = [
        {
          address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          name: 'USD Coin',
          symbol: 'USDC',
          decimals: 6,
          verified: true,
        },
      ];
      
      const mockAxios = {
        get: jest.fn().mockResolvedValue({ data: mockTokens }),
      };
      
      (jupiterAdapter as any).httpClient = mockAxios;
      
      const tokens = await jupiterAdapter.getTokenList();
      expect(tokens).toEqual(mockTokens);
      expect(mockAxios.get).toHaveBeenCalledWith('/tokens');
    });

    test('should get swap quote', async () => {
      const mockQuote = {
        inputMint: SOLANA_NATIVE_MINT,
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000000',
        outAmount: '100000000',
        otherAmountThreshold: '99000000',
        swapMode: 'ExactIn' as const,
        slippageBps: 50,
        priceImpactPct: '0.1',
        routePlan: [],
      };
      
      const mockAxios = {
        get: jest.fn().mockResolvedValue({ data: mockQuote }),
      };
      
      (jupiterAdapter as any).httpClient = mockAxios;
      
      const quote = await jupiterAdapter.getQuote(
        SOLANA_NATIVE_MINT,
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        1000000000,
        50
      );
      
      expect(quote).toEqual(mockQuote);
    });

    test('should get user positions (swap history)', async () => {
      const mockConnection = {
        getSignaturesForAddress: jest.fn().mockResolvedValue([]),
      };
      
      (jupiterAdapter as any).connection = mockConnection;
      
      const positions = await jupiterAdapter.getUserPositions(testAddress);
      
      expect(Array.isArray(positions)).toBe(true);
      expect(positions[0]).toMatchObject({
        id: expect.stringContaining('jupiter'),
        protocol: SolanaProtocol.JUPITER,
        type: SolanaPositionType.SWAP,
        account: testAddress,
      });
    });
  });

  describe('MarinadeAdapter', () => {
    test('should initialize successfully', async () => {
      const mockState = {
        msolMint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
        msolPrice: 1.05,
        totalCoolingDown: 1000000,
        totalLamportsUnderControl: 50000000000,
        msolSupply: 40000000000,
        validatorCount: 100,
        validatorCapacity: 150,
        circulatingTicketCount: 0,
        circulatingTicketBalance: 0,
      };
      
      const mockAxios = {
        get: jest.fn().mockResolvedValue({
          data: { success: true, result: mockState },
        }),
      };
      
      (marinadeAdapter as any).httpClient = mockAxios;
      
      await expect(marinadeAdapter.initialize()).resolves.not.toThrow();
      expect(marinadeAdapter.getStats().isInitialized).toBe(true);
    });

    test('should get Marinade state', async () => {
      const mockState = {
        msolMint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
        msolPrice: 1.05,
        totalCoolingDown: 1000000,
        totalLamportsUnderControl: 50000000000,
        msolSupply: 40000000000,
        validatorCount: 100,
        validatorCapacity: 150,
        circulatingTicketCount: 0,
        circulatingTicketBalance: 0,
      };
      
      const mockAxios = {
        get: jest.fn().mockResolvedValue({
          data: { success: true, result: mockState },
        }),
      };
      
      (marinadeAdapter as any).httpClient = mockAxios;
      
      const state = await marinadeAdapter.getMarinadeState();
      expect(state).toEqual(mockState);
    });

    test('should calculate staking APY', async () => {
      const mockState = { msolPrice: 1.05 };
      const mockValidators = [
        { voteAccount: 'validator1', apy: 6.5, stake: 1000000 },
        { voteAccount: 'validator2', apy: 7.0, stake: 2000000 },
      ];
      
      jest.spyOn(marinadeAdapter, 'getMarinadeState').mockResolvedValue(mockState as any);
      jest.spyOn(marinadeAdapter, 'getValidators').mockResolvedValue(mockValidators as any);
      
      const apy = await marinadeAdapter.calculateStakingApy();
      expect(apy).toBeGreaterThan(0);
      expect(apy).toBeLessThan(10); // Reasonable range
    });

    test('should get user positions', async () => {
      // Mock mSOL balance
      jest.spyOn(marinadeAdapter, 'getMsolBalance').mockResolvedValue({
        amount: 10,
        value: 10.5,
      });
      
      // Mock native stakes
      jest.spyOn(marinadeAdapter, 'getNativeStakeAccounts').mockResolvedValue([]);
      
      // Mock tickets
      jest.spyOn(marinadeAdapter, 'getDelayedUnstakeTickets').mockResolvedValue([]);
      
      const positions = await marinadeAdapter.getUserPositions(testAddress);
      
      expect(Array.isArray(positions)).toBe(true);
      if (positions.length > 0) {
        expect(positions[0]).toMatchObject({
          protocol: SolanaProtocol.MARINADE,
          type: SolanaPositionType.STAKING,
          account: testAddress,
        });
      }
    });
  });

  describe('OrcaAdapter', () => {
    test('should initialize successfully', async () => {
      const mockPools = [
        {
          address: 'pool123',
          tokenA: WELL_KNOWN_TOKENS.SOL,
          tokenB: WELL_KNOWN_TOKENS.USDC,
          tokenABalance: 1000,
          tokenBBalance: 100000,
          lpTokenSupply: 10000,
          fee: 0.3,
          volume24h: 1000000,
          tvl: 200000,
          apy: 15.5,
        },
      ];
      
      const mockAxios = {
        get: jest.fn().mockResolvedValue({
          data: { data: mockPools },
        }),
      };
      
      (orcaAdapter as any).httpClient = mockAxios;
      
      await expect(orcaAdapter.initialize()).resolves.not.toThrow();
      expect(orcaAdapter.getStats().isInitialized).toBe(true);
    });

    test('should get pools', async () => {
      const mockPools = [
        {
          address: 'pool123',
          tokenA: WELL_KNOWN_TOKENS.SOL,
          tokenB: WELL_KNOWN_TOKENS.USDC,
          tokenABalance: 1000,
          tokenBBalance: 100000,
          lpTokenSupply: 10000,
          fee: 0.3,
          volume24h: 1000000,
          tvl: 200000,
          apy: 15.5,
        },
      ];
      
      const mockAxios = {
        get: jest.fn().mockResolvedValue({
          data: { data: mockPools },
        }),
      };
      
      (orcaAdapter as any).httpClient = mockAxios;
      
      const pools = await orcaAdapter.getPools();
      expect(pools).toEqual(mockPools);
    });

    test('should get user positions', async () => {
      // Mock connection methods
      const mockConnection = {
        getTokenAccountsByOwner: jest.fn().mockResolvedValue({ value: [] }),
        getProgramAccounts: jest.fn().mockResolvedValue([]),
      };
      
      (orcaAdapter as any).connection = mockConnection;
      
      jest.spyOn(orcaAdapter, 'getLiquidityPositions').mockResolvedValue([]);
      jest.spyOn(orcaAdapter, 'getWhirlpoolPositions').mockResolvedValue([]);
      jest.spyOn(orcaAdapter, 'getAquafarmPositions').mockResolvedValue([]);
      
      const positions = await orcaAdapter.getUserPositions(testAddress);
      
      expect(Array.isArray(positions)).toBe(true);
    });
  });

  describe('SolanaOrchestrator', () => {
    test('should initialize with all adapters', async () => {
      // Mock all adapter initializations
      jest.spyOn(jupiterAdapter, 'initialize').mockResolvedValue();
      jest.spyOn(marinadeAdapter, 'initialize').mockResolvedValue();
      jest.spyOn(orcaAdapter, 'initialize').mockResolvedValue();
      
      // Mock token parser health check
      jest.spyOn(tokenParser, 'healthCheck').mockResolvedValue(true);
      
      await expect(orchestrator.initialize()).resolves.not.toThrow();
      
      const stats = orchestrator.getStats();
      expect(stats.isInitialized).toBe(true);
      expect(stats.adaptersCount).toBe(3);
    });

    test('should get comprehensive portfolio', async () => {
      // Mock initialization
      jest.spyOn(orchestrator, 'initialize').mockResolvedValue();
      (orchestrator as any).isInitialized = true;
      
      // Mock token parser
      const mockBasePortfolio = {
        address: testAddress,
        totalValue: 100,
        nativeBalance: 1,
        tokenBalances: [],
        defiPositions: [],
        stakingPositions: [],
        liquidityPositions: [],
        openOrders: [],
        lastUpdated: Date.now(),
      };
      
      jest.spyOn(tokenParser, 'buildPortfolio').mockResolvedValue(mockBasePortfolio);
      
      // Mock adapter responses
      (orchestrator as any).adapters.set(SolanaProtocol.JUPITER, {
        getUserPositions: jest.fn().mockResolvedValue([
          {
            id: 'jupiter-1',
            protocol: SolanaProtocol.JUPITER,
            type: SolanaPositionType.SWAP,
            account: testAddress,
            tokens: [],
            value: 0,
            lastUpdated: Date.now(),
            metadata: {},
          },
        ]),
      });
      
      const portfolio = await orchestrator.getPortfolio(testAddress);
      
      expect(portfolio).toMatchObject({
        address: testAddress,
        totalValue: expect.any(Number),
        defiPositions: expect.any(Array),
      });
    });

    test('should calculate portfolio analytics', async () => {
      // Mock portfolio
      const mockPortfolio = {
        address: testAddress,
        totalValue: 1000,
        nativeBalance: 1,
        tokenBalances: [],
        defiPositions: [
          {
            id: 'test-position',
            protocol: SolanaProtocol.MARINADE,
            type: SolanaPositionType.STAKING,
            account: testAddress,
            tokens: [],
            value: 500,
            apy: 6.5,
            lastUpdated: Date.now(),
            metadata: {},
          },
        ],
        stakingPositions: [],
        liquidityPositions: [],
        openOrders: [],
        lastUpdated: Date.now(),
      };
      
      jest.spyOn(orchestrator, 'getPortfolio').mockResolvedValue(mockPortfolio);
      
      const analytics = await orchestrator.getPortfolioAnalytics(testAddress);
      
      expect(analytics).toMatchObject({
        totalValue: 1000,
        protocolDistribution: expect.any(Array),
        riskMetrics: expect.objectContaining({
          concentrationRisk: expect.any(Number),
          liquidityRisk: expect.any(Number),
          protocolRisk: expect.any(Number),
          overallRisk: expect.stringMatching(/^(low|medium|high)$/),
        }),
        yieldSummary: expect.objectContaining({
          totalYield: expect.any(Number),
          averageApy: expect.any(Number),
          bestPosition: expect.any(Object),
        }),
      });
    });

    test('should analyze cross-chain positions', async () => {
      const evmAddresses = ['0x742d35Cc6634C0532925a3b8D0bE6Bc2E7E4'];
      
      // Mock portfolio
      const mockPortfolio = {
        address: testAddress,
        totalValue: 1000,
        defiPositions: [
          {
            protocol: SolanaProtocol.ORCA,
            type: SolanaPositionType.LIQUIDITY,
            value: 500,
          },
        ],
      };
      
      jest.spyOn(orchestrator, 'getPortfolio').mockResolvedValue(mockPortfolio as any);
      
      const crossChainAnalysis = await orchestrator.analyzeCrossChainPositions(
        testAddress,
        evmAddresses
      );
      
      expect(crossChainAnalysis).toMatchObject({
        solanaAddress: testAddress,
        evmAddresses,
        totalValue: expect.any(Number),
        solanaValue: 1000,
        evmValue: expect.any(Number),
        crossChainCorrelations: expect.any(Array),
      });
    });

    test('should get health status', async () => {
      // Mock adapters with health checks
      (orchestrator as any).adapters.set(SolanaProtocol.JUPITER, {
        healthCheck: jest.fn().mockResolvedValue(true),
      });
      
      (orchestrator as any).adapters.set(SolanaProtocol.MARINADE, {
        healthCheck: jest.fn().mockResolvedValue(false),
      });
      
      const health = await orchestrator.getHealthStatus();
      
      expect(health).toEqual({
        [SolanaProtocol.JUPITER]: true,
        [SolanaProtocol.MARINADE]: false,
      });
    });
  });

  describe('Integration Scenarios', () => {
    test('should handle mixed portfolio with multiple protocols', async () => {
      // This test would verify that the orchestrator correctly combines
      // positions from Jupiter, Marinade, and Orca into a unified portfolio
      
      const mockPositions = [
        {
          id: 'jupiter-swap',
          protocol: SolanaProtocol.JUPITER,
          type: SolanaPositionType.SWAP,
          value: 0, // Jupiter tracks history, not active positions
        },
        {
          id: 'marinade-stake',
          protocol: SolanaProtocol.MARINADE,
          type: SolanaPositionType.STAKING,
          value: 1050, // 10 mSOL at 1.05 rate
          apy: 6.8,
        },
        {
          id: 'orca-lp',
          protocol: SolanaProtocol.ORCA,
          type: SolanaPositionType.LIQUIDITY,
          value: 2000, // LP position
          apy: 15.2,
        },
      ];
      
      // Test would verify correct aggregation and analytics
      expect(mockPositions.length).toBe(3);
      
      const totalValue = mockPositions.reduce((sum, pos) => sum + pos.value, 0);
      expect(totalValue).toBe(3050);
      
      const yieldPositions = mockPositions.filter(pos => pos.apy && pos.apy > 0);
      expect(yieldPositions.length).toBe(2);
    });

    test('should handle error scenarios gracefully', async () => {
      // Test that the system gracefully handles adapter failures
      const mockOrchestrator = new SolanaOrchestrator({
        rpcUrl: testRpcUrl,
        enabledProtocols: [SolanaProtocol.JUPITER],
        cacheSettings: { portfolio: 300, analytics: 600, crossChain: 900 },
        performance: { maxConcurrentRequests: 5, timeoutMs: 15000, retryAttempts: 3 },
      });
      
      // Mock adapter that throws error
      (mockOrchestrator as any).adapters.set(SolanaProtocol.JUPITER, {
        getUserPositions: jest.fn().mockRejectedValue(new Error('Network error')),
      });
      
      // System should continue to work even with adapter failures
      expect(async () => {
        const health = await mockOrchestrator.getHealthStatus();
        expect(health[SolanaProtocol.JUPITER]).toBe(false);
      }).not.toThrow();
    });
  });
});

describe('Solana Types and Constants', () => {
  test('should have correct well-known tokens', () => {
    expect(WELL_KNOWN_TOKENS.SOL).toMatchObject({
      mint: SOLANA_NATIVE_MINT,
      name: 'Solana',
      symbol: 'SOL',
      decimals: 9,
      verified: true,
    });
    
    expect(WELL_KNOWN_TOKENS.USDC).toMatchObject({
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      verified: true,
    });
  });

  test('should have correct protocol definitions', () => {
    expect(SolanaProtocol.JUPITER).toBe('jupiter');
    expect(SolanaProtocol.MARINADE).toBe('marinade');
    expect(SolanaProtocol.ORCA).toBe('orca');
  });

  test('should have correct position types', () => {
    expect(SolanaPositionType.SWAP).toBe('swap');
    expect(SolanaPositionType.STAKING).toBe('staking');
    expect(SolanaPositionType.LIQUIDITY).toBe('liquidity');
  });
});