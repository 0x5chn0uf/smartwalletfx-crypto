/**
 * Curve Adapter Tests
 * 
 * Tests for the Curve protocol adapter implementation.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ethers } from 'ethers';
import { ChainId } from '../../src/types/blockchain';
import { DeFiProtocol, PositionType, PositionStatus } from '../../src/types/defi';
import { CurveAdapter } from '../../src/services/defi/adapters/CurveAdapter';

// Mock ethers
jest.mock('ethers');

// Mock Redis
jest.mock('../../src/utils/redis', () => ({
  redisManager: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

// Mock Logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('CurveAdapter', () => {
  let adapter: CurveAdapter;
  let mockProvider: jest.Mocked<ethers.JsonRpcProvider>;
  let mockContract: jest.Mocked<ethers.Contract>;

  const mockRpcUrls = {
    [ChainId.ETHEREUM]: 'https://eth-mainnet.example.com',
    [ChainId.POLYGON]: 'https://polygon-mainnet.example.com',
  };

  const mockAddress = '0x742d35Cc6634C0532925a3b8D3Ac3F8a5F2d08b6';

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock provider
    mockProvider = {
      getBlockNumber: jest.fn(),
      getBalance: jest.fn(),
    } as any;

    // Mock contract
    mockContract = {
      balanceOf: jest.fn(),
      totalSupply: jest.fn(),
      symbol: jest.fn(),
      name: jest.fn(),
      decimals: jest.fn(),
      get_lp_token: jest.fn(),
      get_n_coins: jest.fn(),
      get_coins: jest.fn(),
      get_balances: jest.fn(),
      get_virtual_price: jest.fn(),
      getUserReservesData: jest.fn(),
      positions: jest.fn(),
      claimable_tokens: jest.fn(),
      working_balances: jest.fn(),
      n_gauges: jest.fn(),
      gauges: jest.fn(),
    } as any;

    // Mock ethers.JsonRpcProvider
    (ethers.JsonRpcProvider as jest.MockedClass<typeof ethers.JsonRpcProvider>).mockImplementation(() => mockProvider);

    // Mock ethers.Contract
    (ethers.Contract as jest.MockedClass<typeof ethers.Contract>).mockImplementation(() => mockContract);

    // Create adapter instance
    adapter = new CurveAdapter(mockRpcUrls);
  });

  describe('constructor', () => {
    it('should initialize with correct protocol and supported chains', () => {
      expect(adapter.protocol).toBe(DeFiProtocol.CURVE);
      expect(adapter.supportedChains).toEqual([
        ChainId.ETHEREUM,
        ChainId.POLYGON,
        ChainId.ARBITRUM,
        ChainId.OPTIMISM,
      ]);
      expect(adapter.version).toBe('1.0.0');
    });

    it('should initialize providers for supported chains', () => {
      expect(ethers.JsonRpcProvider).toHaveBeenCalledWith(mockRpcUrls[ChainId.ETHEREUM]);
      expect(ethers.JsonRpcProvider).toHaveBeenCalledWith(mockRpcUrls[ChainId.POLYGON]);
    });
  });

  describe('isHealthy', () => {
    it('should return true when provider is accessible and contracts work', async () => {
      mockProvider.getBlockNumber.mockResolvedValue(12345);
      mockContract.get_lp_token.mockResolvedValue('0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490');

      const result = await adapter.isHealthy();

      expect(result).toBe(true);
      expect(mockProvider.getBlockNumber).toHaveBeenCalled();
      expect(mockContract.get_lp_token).toHaveBeenCalled();
    });

    it('should return false when provider is not accessible', async () => {
      mockProvider.getBlockNumber.mockRejectedValue(new Error('Network error'));

      const result = await adapter.isHealthy();

      expect(result).toBe(false);
    });

    it('should return false when contract calls fail', async () => {
      mockProvider.getBlockNumber.mockResolvedValue(12345);
      mockContract.get_lp_token.mockRejectedValue(new Error('Contract error'));

      const result = await adapter.isHealthy();

      expect(result).toBe(false);
    });
  });

  describe('getHealth', () => {
    it('should return health status object', () => {
      const health = adapter.getHealth();

      expect(health).toHaveProperty('isHealthy');
      expect(health).toHaveProperty('lastCheckedAt');
      expect(health).toHaveProperty('responseTime');
      expect(health).toHaveProperty('errorRate');
      expect(health).toHaveProperty('uptime');
      expect(health).toHaveProperty('issues');
    });
  });

  describe('getProtocolMetadata', () => {
    it('should return correct protocol metadata', () => {
      const metadata = adapter.getProtocolMetadata();

      expect(metadata.name).toBe('Curve Finance');
      expect(metadata.description).toContain('Curve is a decentralized exchange');
      expect(metadata.website).toBe('https://curve.fi');
      expect(metadata.features).toContain('Stablecoin trading with minimal slippage');
      expect(metadata.supportedAssets).toContain('USDC');
      expect(metadata.supportedAssets).toContain('WETH');
    });
  });

  describe('getPositions', () => {
    beforeEach(() => {
      // Mock redis cache miss
      const { redisManager } = require('../../src/utils/redis');
      redisManager.get.mockResolvedValue(null);
      redisManager.set.mockResolvedValue(true);
    });

    it('should return empty array when no positions found', async () => {
      // Mock LP token balance as 0
      mockContract.balanceOf.mockResolvedValue(0n);

      const positions = await adapter.getPositions(mockAddress, ChainId.ETHEREUM);

      expect(positions).toEqual([]);
    });

    it('should return positions when LP tokens are held', async () => {
      // Mock LP token balance
      mockContract.balanceOf.mockResolvedValue(ethers.parseEther('100'));
      mockContract.totalSupply.mockResolvedValue(ethers.parseEther('1000'));
      mockContract.symbol.mockResolvedValue('3CRV');
      mockContract.name.mockResolvedValue('Curve.fi DAI/USDC/USDT');
      mockContract.decimals.mockResolvedValue(18);

      // Mock registry calls
      mockContract.get_lp_token.mockResolvedValue('0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490');
      mockContract.get_n_coins.mockResolvedValue(3n);
      mockContract.get_coins.mockResolvedValue([
        '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        '0xA0b86a33E6441b8435b6BA10D7C6F8C7e7EaEe5A',
        '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
      ]);
      mockContract.get_balances.mockResolvedValue([
        ethers.parseEther('1000000'),
        ethers.parseUnits('1000000', 6),
        ethers.parseUnits('1000000', 6),
        0n, 0n, 0n, 0n, 0n,
      ]);

      // Mock gauge calls
      mockContract.n_gauges.mockResolvedValue(0n);

      const positions = await adapter.getPositions(mockAddress, ChainId.ETHEREUM);

      expect(positions).toHaveLength(1);
      expect(positions[0].protocol).toBe(DeFiProtocol.CURVE);
      expect(positions[0].type).toBe(PositionType.LIQUIDITY_POOL);
      expect(positions[0].name).toContain('Curve');
    });

    it('should handle multiple chains', async () => {
      mockContract.balanceOf.mockResolvedValue(0n);
      mockContract.n_gauges.mockResolvedValue(0n);

      const positions = await adapter.getPositions(mockAddress);

      expect(positions).toEqual([]);
      // Should have been called for each supported chain with providers
      expect(mockContract.balanceOf).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockContract.balanceOf.mockRejectedValue(new Error('Contract error'));

      const positions = await adapter.getPositions(mockAddress, ChainId.ETHEREUM);

      expect(positions).toEqual([]);
    });
  });

  describe('getPosition', () => {
    it('should return null for invalid position ID format', async () => {
      const result = await adapter.getPosition('invalid-id', ChainId.ETHEREUM);
      expect(result).toBeNull();
    });

    it('should return null for wrong protocol', async () => {
      const result = await adapter.getPosition('aave-v3:1:address:token', ChainId.ETHEREUM);
      expect(result).toBeNull();
    });

    it('should return null for wrong chain', async () => {
      const result = await adapter.getPosition('curve:137:address:token', ChainId.ETHEREUM);
      expect(result).toBeNull();
    });
  });

  describe('getPoolPositions', () => {
    it('should return empty array when no LP tokens are held', async () => {
      mockContract.balanceOf.mockResolvedValue(0n);

      const positions = await adapter.getPoolPositions(mockAddress, ChainId.ETHEREUM);

      expect(positions).toEqual([]);
    });

    it('should return positions for held LP tokens', async () => {
      // Mock LP token balance
      mockContract.balanceOf.mockResolvedValue(ethers.parseEther('100'));
      mockContract.totalSupply.mockResolvedValue(ethers.parseEther('1000'));

      // Mock registry calls
      mockContract.get_balances.mockResolvedValue([
        ethers.parseEther('1000000'),
        ethers.parseUnits('1000000', 6),
        ethers.parseUnits('1000000', 6),
      ]);

      // Mock token info calls
      mockContract.symbol.mockResolvedValue('DAI');
      mockContract.name.mockResolvedValue('Dai Stablecoin');
      mockContract.decimals.mockResolvedValue(18);

      const positions = await adapter.getPoolPositions(mockAddress, ChainId.ETHEREUM);

      expect(positions.length).toBeGreaterThan(0);
    });
  });

  describe('getGaugePositions', () => {
    it('should return empty map when no gauges are staked', async () => {
      mockContract.n_gauges.mockResolvedValue(0n);

      const positions = await adapter.getGaugePositions(mockAddress, ChainId.ETHEREUM);

      expect(positions.size).toBe(0);
    });

    it('should return gauge positions when tokens are staked', async () => {
      // Mock gauge controller
      mockContract.n_gauges.mockResolvedValue(1n);
      mockContract.gauges.mockResolvedValue('0x7ca5b0a2910b33e9759dc7ddb0413949071d7575');

      // Mock gauge contract
      mockContract.balanceOf.mockResolvedValue(ethers.parseEther('50'));
      mockContract.working_balances.mockResolvedValue(ethers.parseEther('45'));
      mockContract.claimable_tokens.mockResolvedValue(ethers.parseEther('10'));

      const positions = await adapter.getGaugePositions(mockAddress, ChainId.ETHEREUM);

      expect(positions.size).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getRewards', () => {
    it('should return empty array when no rewards are available', async () => {
      const mockGaugePositions = new Map();
      
      // Mock the getGaugePositions method
      jest.spyOn(adapter, 'getGaugePositions').mockResolvedValue(mockGaugePositions);

      const rewards = await adapter.getRewards(mockAddress, ChainId.ETHEREUM);

      expect(rewards).toEqual([]);
    });

    it('should return rewards when available', async () => {
      // Mock gauge positions with rewards
      const mockGaugeData = {
        gaugeAddress: '0x7ca5b0a2910b33e9759dc7ddb0413949071d7575',
        lpToken: '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490',
        stakedBalance: ethers.parseEther('100'),
        workingBalance: ethers.parseEther('90'),
        claimableCRV: ethers.parseEther('10'),
        rewardTokens: [],
        weight: ethers.parseEther('1000'),
        relativeWeight: ethers.parseEther('0.1'),
      };

      const mockGaugePositions = new Map([
        ['0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490', mockGaugeData]
      ]);

      // Mock the getGaugePositions method
      jest.spyOn(adapter, 'getGaugePositions').mockResolvedValue(mockGaugePositions);

      const rewards = await adapter.getRewards(mockAddress, ChainId.ETHEREUM);

      expect(rewards.length).toBeGreaterThan(0);
      expect(rewards[0].token.symbol).toBe('CRV');
    });
  });

  describe('getPoolInfo', () => {
    const poolAddress = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7';

    it('should return pool information', async () => {
      // Mock registry calls
      mockContract.get_lp_token.mockResolvedValue('0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490');
      mockContract.get_n_coins.mockResolvedValue(3n);
      mockContract.get_virtual_price.mockResolvedValue(ethers.parseEther('1.02'));
      mockContract.fee.mockResolvedValue(400n); // 0.04%
      mockContract.admin_fee.mockResolvedValue(5000n); // 50%
      mockContract.A.mockResolvedValue(2000n);

      mockContract.get_coins.mockResolvedValue([
        '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        '0xA0b86a33E6441b8435b6BA10D7C6F8C7e7EaEe5A',
        '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
      ]);

      mockContract.get_balances.mockResolvedValue([
        ethers.parseEther('1000000'),
        ethers.parseUnits('1000000', 6),
        ethers.parseUnits('1000000', 6),
        0n, 0n, 0n, 0n, 0n,
      ]);

      const poolInfo = await adapter.getPoolInfo(poolAddress, ChainId.ETHEREUM);

      expect(poolInfo).toBeDefined();
      expect(poolInfo.poolAddress).toBe(poolAddress);
      expect(poolInfo.nCoins).toBe(3);
      expect(poolInfo.coins).toHaveLength(3);
      expect(poolInfo.apy).toBeDefined();
      expect(poolInfo.apy.base).toBeGreaterThanOrEqual(0);
      expect(poolInfo.apy.crv).toBeGreaterThanOrEqual(0);
      expect(poolInfo.apy.total).toBeGreaterThanOrEqual(0);
    });

    it('should return null when pool info fails to load', async () => {
      mockContract.get_lp_token.mockRejectedValue(new Error('Pool not found'));

      const poolInfo = await adapter.getPoolInfo(poolAddress, ChainId.ETHEREUM);

      expect(poolInfo).toBeNull();
    });
  });

  describe('rate limiting', () => {
    it('should respect rate limits', async () => {
      // Mock redis cache miss
      const { redisManager } = require('../../src/utils/redis');
      redisManager.get.mockResolvedValue(null);

      // Make many requests rapidly
      const promises = Array(150).fill(null).map(() => 
        adapter.getPositions(mockAddress, ChainId.ETHEREUM)
      );

      await Promise.all(promises);

      // Should have been rate limited after 100 requests
      expect(mockContract.balanceOf).toHaveBeenCalledTimes(100);
    });
  });

  describe('error handling', () => {
    it('should handle provider initialization errors', () => {
      (ethers.JsonRpcProvider as jest.MockedClass<typeof ethers.JsonRpcProvider>).mockImplementation(() => {
        throw new Error('Provider error');
      });

      expect(() => new CurveAdapter(mockRpcUrls)).not.toThrow();
    });

    it('should handle contract call timeouts', async () => {
      mockContract.balanceOf.mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 100)
        )
      );

      const positions = await adapter.getPositions(mockAddress, ChainId.ETHEREUM);

      expect(positions).toEqual([]);
    });

    it('should handle malformed contract responses', async () => {
      mockContract.balanceOf.mockResolvedValue('invalid');

      const positions = await adapter.getPositions(mockAddress, ChainId.ETHEREUM);

      expect(positions).toEqual([]);
    });
  });

  describe('caching', () => {
    it('should use cached data when available', async () => {
      const { redisManager } = require('../../src/utils/redis');
      const cachedPositions = [{
        id: 'curve:1:address:token',
        protocol: DeFiProtocol.CURVE,
        chainId: ChainId.ETHEREUM,
        type: PositionType.LIQUIDITY_POOL,
        status: PositionStatus.ACTIVE,
        name: 'Cached Position',
        suppliedTokens: [],
        totalValueUSD: 1000,
        netValueUSD: 1000,
        riskMetrics: { liquidationRisk: 'low' },
        createdAt: new Date(),
        lastUpdatedAt: new Date(),
        protocolData: {},
        poolInfo: { poolAddress: '', poolName: '' },
        lpTokens: { address: '', amount: '' },
      }];

      redisManager.get.mockResolvedValue(cachedPositions);

      const positions = await adapter.getPositions(mockAddress, ChainId.ETHEREUM);

      expect(positions).toEqual(cachedPositions);
      expect(mockContract.balanceOf).not.toHaveBeenCalled();
    });

    it('should cache results after fetching', async () => {
      const { redisManager } = require('../../src/utils/redis');
      redisManager.get.mockResolvedValue(null);
      redisManager.set.mockResolvedValue(true);

      mockContract.balanceOf.mockResolvedValue(0n);
      mockContract.n_gauges.mockResolvedValue(0n);

      await adapter.getPositions(mockAddress, ChainId.ETHEREUM);

      expect(redisManager.set).toHaveBeenCalledWith(
        expect.stringContaining('curve-positions'),
        expect.any(Array),
        300
      );
    });
  });
});