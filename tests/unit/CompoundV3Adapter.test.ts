import { ethers } from 'ethers';
import { CompoundV3Adapter } from '../../src/services/defi/adapters/CompoundV3Adapter';
import { ChainId, DeFiProtocol, PositionType, PositionStatus, RiskLevel } from '../../src/types/defi';
import { redisManager } from '../../src/utils/redis';

// Mock dependencies
jest.mock('../../src/utils/logger');
jest.mock('../../src/utils/redis', () => ({
  redisManager: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

jest.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: jest.fn(),
    Contract: jest.fn(),
    ZeroAddress: '0x0000000000000000000000000000000000000000',
  },
}));

describe('CompoundV3Adapter', () => {
  let adapter: CompoundV3Adapter;
  let mockProvider: any;
  let mockContract: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock provider
    mockProvider = {
      getBlockNumber: jest.fn().mockResolvedValue(12345),
    };

    // Mock contract
    mockContract = {
      balanceOf: jest.fn(),
      borrowBalanceOf: jest.fn(),
      collateralBalanceOf: jest.fn(),
      isLiquidatable: jest.fn(),
      liquidationThreshold: jest.fn(),
      numAssets: jest.fn(),
      getAssetInfo: jest.fn(),
      baseToken: jest.fn(),
      baseScale: jest.fn(),
      getSupplyRate: jest.fn(),
      getBorrowRate: jest.fn(),
      getUtilization: jest.fn(),
      totalSupply: jest.fn(),
      totalBorrow: jest.fn(),
      baseMinForRewards: jest.fn(),
      baseTrackingSupplySpeed: jest.fn(),
      baseTrackingBorrowSpeed: jest.fn(),
      symbol: jest.fn(),
      name: jest.fn(),
      decimals: jest.fn(),
    };

    (ethers.JsonRpcProvider as jest.Mock).mockReturnValue(mockProvider);
    (ethers.Contract as jest.Mock).mockReturnValue(mockContract);

    // Create adapter instance
    const rpcUrls = {
      [ChainId.ETHEREUM]: 'https://eth.llamarpc.com',
      [ChainId.POLYGON]: 'https://polygon.llamarpc.com',
      [ChainId.ARBITRUM]: 'https://arb1.arbitrum.io/rpc',
    };

    adapter = new CompoundV3Adapter(rpcUrls);
  });

  describe('Basic Configuration', () => {
    test('should have correct protocol configuration', () => {
      expect(adapter.protocol).toBe(DeFiProtocol.COMPOUND_V3);
      expect(adapter.supportedChains).toEqual([
        ChainId.ETHEREUM,
        ChainId.POLYGON,
        ChainId.ARBITRUM,
      ]);
      expect(adapter.version).toBe('1.0.0');
    });

    test('should return protocol metadata', () => {
      const metadata = adapter.getProtocolMetadata();
      
      expect(metadata.name).toBe('Compound V3');
      expect(metadata.website).toBe('https://compound.finance');
      expect(metadata.supportedAssets).toContain('USDC');
      expect(metadata.supportedAssets).toContain('WETH');
      expect(metadata.features).toContain('Single collateral markets');
      expect(metadata.features).toContain('COMP token rewards');
    });
  });

  describe('Health Checks', () => {
    test('should pass health check when provider is working', async () => {
      mockProvider.getBlockNumber.mockResolvedValue(12345);

      const isHealthy = await adapter.isHealthy();
      const health = adapter.getHealth();

      expect(isHealthy).toBe(true);
      expect(health.isHealthy).toBe(true);
      expect(health.issues).toEqual([]);
    });

    test('should fail health check when provider fails', async () => {
      mockProvider.getBlockNumber.mockRejectedValue(new Error('Network error'));

      const isHealthy = await adapter.isHealthy();
      const health = adapter.getHealth();

      expect(isHealthy).toBe(false);
      expect(health.isHealthy).toBe(false);
      expect(health.issues).toContain('Network error');
    });
  });

  describe('Position Fetching', () => {
    test('should return empty array when no positions exist', async () => {
      // Mock no cache
      (redisManager.get as jest.Mock).mockResolvedValue(null);

      // Mock empty positions
      mockContract.balanceOf.mockResolvedValue(0n);
      mockContract.borrowBalanceOf.mockResolvedValue(0n);
      mockContract.numAssets.mockResolvedValue(0);

      const positions = await adapter.getPositions('0x1234567890123456789012345678901234567890');

      expect(positions).toEqual([]);
    });

    test('should return cached positions when available', async () => {
      const cachedPositions = [{
        id: 'compound-v3:1:0x1234567890123456789012345678901234567890:USDC',
        protocol: DeFiProtocol.COMPOUND_V3,
        chainId: ChainId.ETHEREUM,
        type: PositionType.LENDING,
        status: PositionStatus.ACTIVE,
      }];

      (redisManager.get as jest.Mock).mockResolvedValue(cachedPositions);

      const positions = await adapter.getPositions('0x1234567890123456789012345678901234567890');

      expect(positions).toEqual(cachedPositions);
      expect(redisManager.get).toHaveBeenCalledWith(
        'compound-v3-positions:1:0x1234567890123456789012345678901234567890'
      );
    });

    test('should fetch and process supply position correctly', async () => {
      // Mock no cache
      (redisManager.get as jest.Mock).mockResolvedValue(null);

      // Mock supply position
      mockContract.balanceOf.mockResolvedValue(ethers.parseUnits('1000', 6)); // 1000 USDC
      mockContract.borrowBalanceOf.mockResolvedValue(0n);
      mockContract.numAssets.mockResolvedValue(0);
      mockContract.isLiquidatable.mockResolvedValue(false);
      mockContract.liquidationThreshold.mockResolvedValue(0n);

      // Mock market data
      mockContract.baseToken.mockResolvedValue('0xA0b86a33E6441b8435b6BA10d7c6f8c7E7eaEE5a');
      mockContract.baseScale.mockResolvedValue(ethers.parseUnits('1', 6));
      mockContract.getUtilization.mockResolvedValue(ethers.parseUnits('0.8', 18));
      mockContract.getSupplyRate.mockResolvedValue(ethers.parseUnits('0.05', 18));
      mockContract.getBorrowRate.mockResolvedValue(ethers.parseUnits('0.08', 18));
      mockContract.totalSupply.mockResolvedValue(ethers.parseUnits('1000000', 6));
      mockContract.totalBorrow.mockResolvedValue(ethers.parseUnits('800000', 6));
      mockContract.baseMinForRewards.mockResolvedValue(ethers.parseUnits('1', 6));
      mockContract.baseTrackingSupplySpeed.mockResolvedValue(ethers.parseUnits('0.001', 18));
      mockContract.baseTrackingBorrowSpeed.mockResolvedValue(ethers.parseUnits('0.001', 18));

      // Mock token info
      mockContract.symbol.mockResolvedValue('USDC');
      mockContract.name.mockResolvedValue('USD Coin');
      mockContract.decimals.mockResolvedValue(6);

      const positions = await adapter.getPositions('0x1234567890123456789012345678901234567890');

      expect(positions).toHaveLength(1);
      const position = positions[0];
      expect(position.protocol).toBe(DeFiProtocol.COMPOUND_V3);
      expect(position.type).toBe(PositionType.LENDING);
      expect(position.status).toBe(PositionStatus.ACTIVE);
      expect(position.suppliedTokens).toHaveLength(1);
      expect(position.suppliedTokens[0].token.symbol).toBe('USDC');
      expect(position.totalValueUSD).toBeGreaterThan(0);
    });

    test('should fetch and process borrow position correctly', async () => {
      // Mock no cache
      (redisManager.get as jest.Mock).mockResolvedValue(null);

      // Mock borrow position
      mockContract.balanceOf.mockResolvedValue(ethers.parseUnits('2000', 6)); // 2000 USDC supplied
      mockContract.borrowBalanceOf.mockResolvedValue(ethers.parseUnits('1000', 6)); // 1000 USDC borrowed
      mockContract.numAssets.mockResolvedValue(1);
      mockContract.isLiquidatable.mockResolvedValue(false);
      mockContract.liquidationThreshold.mockResolvedValue(ethers.parseUnits('0.8', 18));

      // Mock collateral
      mockContract.getAssetInfo.mockResolvedValue({
        offset: 0,
        asset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        priceFeed: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
        scale: ethers.parseUnits('1', 18),
        borrowCollateralFactor: ethers.parseUnits('0.8', 18),
        liquidateCollateralFactor: ethers.parseUnits('0.85', 18),
        liquidationFactor: ethers.parseUnits('0.95', 18),
        supplyCap: ethers.parseUnits('1000', 18),
      });
      mockContract.collateralBalanceOf.mockResolvedValue(ethers.parseUnits('1', 18)); // 1 WETH

      // Mock market data
      mockContract.baseToken.mockResolvedValue('0xA0b86a33E6441b8435b6BA10d7c6f8c7E7eaEE5a');
      mockContract.baseScale.mockResolvedValue(ethers.parseUnits('1', 6));
      mockContract.getUtilization.mockResolvedValue(ethers.parseUnits('0.5', 18));
      mockContract.getSupplyRate.mockResolvedValue(ethers.parseUnits('0.03', 18));
      mockContract.getBorrowRate.mockResolvedValue(ethers.parseUnits('0.05', 18));
      mockContract.totalSupply.mockResolvedValue(ethers.parseUnits('1000000', 6));
      mockContract.totalBorrow.mockResolvedValue(ethers.parseUnits('500000', 6));
      mockContract.baseMinForRewards.mockResolvedValue(ethers.parseUnits('1', 6));
      mockContract.baseTrackingSupplySpeed.mockResolvedValue(ethers.parseUnits('0.001', 18));
      mockContract.baseTrackingBorrowSpeed.mockResolvedValue(ethers.parseUnits('0.001', 18));

      // Mock token info - return different values based on address
      mockContract.symbol.mockImplementation((address?: string) => {
        if (address) {
          // This is a call to token.symbol()
          return Promise.resolve('WETH');
        }
        return Promise.resolve('USDC');
      });
      mockContract.name.mockImplementation((address?: string) => {
        if (address) {
          return Promise.resolve('Wrapped Ether');
        }
        return Promise.resolve('USD Coin');
      });
      mockContract.decimals.mockImplementation((address?: string) => {
        if (address) {
          return Promise.resolve(18);
        }
        return Promise.resolve(6);
      });

      const positions = await adapter.getPositions('0x1234567890123456789012345678901234567890');

      expect(positions).toHaveLength(1);
      const position = positions[0];
      expect(position.protocol).toBe(DeFiProtocol.COMPOUND_V3);
      expect(position.type).toBe(PositionType.LENDING);
      expect(position.suppliedTokens).toHaveLength(1);
      expect(position.borrowedTokens).toHaveLength(1);
      expect(position.collateralTokens).toHaveLength(1);
      expect(position.riskMetrics.healthFactor).toBeDefined();
      expect(position.riskMetrics.liquidationRisk).toBe(RiskLevel.LOW);
    });

    test('should handle errors gracefully', async () => {
      // Mock no cache
      (redisManager.get as jest.Mock).mockResolvedValue(null);

      // Mock contract error
      mockContract.balanceOf.mockRejectedValue(new Error('Contract call failed'));

      const positions = await adapter.getPositions('0x1234567890123456789012345678901234567890');

      expect(positions).toEqual([]);
    });
  });

  describe('Market Information', () => {
    test('should return available markets', async () => {
      // Mock market data calls
      mockContract.baseToken.mockResolvedValue('0xA0b86a33E6441b8435b6BA10d7c6f8c7E7eaEE5a');
      mockContract.baseScale.mockResolvedValue(ethers.parseUnits('1', 6));
      mockContract.getUtilization.mockResolvedValue(ethers.parseUnits('0.75', 18));
      mockContract.getSupplyRate.mockResolvedValue(ethers.parseUnits('0.04', 18));
      mockContract.getBorrowRate.mockResolvedValue(ethers.parseUnits('0.06', 18));
      mockContract.totalSupply.mockResolvedValue(ethers.parseUnits('1000000', 6));
      mockContract.totalBorrow.mockResolvedValue(ethers.parseUnits('750000', 6));
      mockContract.baseMinForRewards.mockResolvedValue(ethers.parseUnits('1', 6));
      mockContract.baseTrackingSupplySpeed.mockResolvedValue(ethers.parseUnits('0.001', 18));
      mockContract.baseTrackingBorrowSpeed.mockResolvedValue(ethers.parseUnits('0.001', 18));

      // Mock token info
      mockContract.symbol.mockResolvedValue('USDC');
      mockContract.name.mockResolvedValue('USD Coin');
      mockContract.decimals.mockResolvedValue(6);

      const markets = await adapter.getMarkets(ChainId.ETHEREUM);

      expect(markets.length).toBeGreaterThan(0);
      expect(markets[0]).toHaveProperty('market');
      expect(markets[0]).toHaveProperty('supplyAPY');
      expect(markets[0]).toHaveProperty('borrowAPY');
      expect(markets[0]).toHaveProperty('utilization');
    });
  });

  describe('Reward Calculation', () => {
    test('should return empty rewards when none available', async () => {
      // Mock rewards contract
      mockContract.getRewardOwed.mockResolvedValue({
        token: '0xc00e94Cb662C3520282E6f5717214004A7f26888',
        owed: 0n,
      });
      mockContract.rewardsClaimed.mockResolvedValue(0n);
      mockContract.rewardConfig.mockResolvedValue({
        token: '0xc00e94Cb662C3520282E6f5717214004A7f26888',
        rescaleFactor: ethers.parseUnits('1', 18),
        shouldUpscale: false,
      });

      const rewards = await adapter.getRewards('0x1234567890123456789012345678901234567890');

      expect(rewards).toEqual([]);
    });

    test('should calculate COMP rewards correctly', async () => {
      // Mock rewards contract with claimable COMP
      mockContract.getRewardOwed.mockResolvedValue({
        token: '0xc00e94Cb662C3520282E6f5717214004A7f26888',
        owed: ethers.parseUnits('10', 18), // 10 COMP tokens
      });
      mockContract.rewardsClaimed.mockResolvedValue(ethers.parseUnits('5', 18));
      mockContract.rewardConfig.mockResolvedValue({
        token: '0xc00e94Cb662C3520282E6f5717214004A7f26888',
        rescaleFactor: ethers.parseUnits('1', 18),
        shouldUpscale: false,
      });

      // Mock COMP token info
      mockContract.symbol.mockResolvedValue('COMP');
      mockContract.name.mockResolvedValue('Compound');
      mockContract.decimals.mockResolvedValue(18);

      const rewards = await adapter.getRewards('0x1234567890123456789012345678901234567890');

      expect(rewards).toHaveLength(1);
      expect(rewards[0].token.symbol).toBe('COMP');
      expect(rewards[0].valueUSD).toBeGreaterThan(0);
      expect(rewards[0].vesting?.isVesting).toBe(false);
    });
  });

  describe('Account Snapshot', () => {
    test('should return account snapshot for valid market', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const market = 'USDC';
      const chainId = ChainId.ETHEREUM;

      // Mock contract calls
      mockContract.balanceOf.mockResolvedValue(ethers.parseUnits('1000', 6));
      mockContract.borrowBalanceOf.mockResolvedValue(ethers.parseUnits('500', 6));
      mockContract.isLiquidatable.mockResolvedValue(false);
      mockContract.liquidationThreshold.mockResolvedValue(ethers.parseUnits('0.8', 18));
      mockContract.numAssets.mockResolvedValue(1);

      const snapshot = await adapter.getAccountSnapshot(address, market, chainId);

      expect(snapshot).not.toBeNull();
      expect(snapshot?.baseBalance).toBe(ethers.parseUnits('1000', 6));
      expect(snapshot?.borrowBalance).toBe(ethers.parseUnits('500', 6));
      expect(snapshot?.isLiquidatable).toBe(false);
    });

    test('should return null for invalid market', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const market = 'INVALID';
      const chainId = ChainId.ETHEREUM;

      const snapshot = await adapter.getAccountSnapshot(address, market, chainId);

      expect(snapshot).toBeNull();
    });
  });

  describe('Error Handling', () => {
    test('should handle RPC errors gracefully', async () => {
      (redisManager.get as jest.Mock).mockResolvedValue(null);
      mockContract.balanceOf.mockRejectedValue(new Error('RPC Error'));

      const positions = await adapter.getPositions('0x1234567890123456789012345678901234567890');

      expect(positions).toEqual([]);
    });

    test('should handle invalid addresses gracefully', async () => {
      const positions = await adapter.getPositions('invalid_address');

      expect(positions).toEqual([]);
    });

    test('should handle network timeouts gracefully', async () => {
      (redisManager.get as jest.Mock).mockResolvedValue(null);
      mockContract.balanceOf.mockImplementation(
        () => new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 100)
        )
      );

      const positions = await adapter.getPositions('0x1234567890123456789012345678901234567890');

      expect(positions).toEqual([]);
    });
  });
});