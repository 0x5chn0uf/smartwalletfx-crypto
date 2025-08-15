/**
 * Aave V3 Adapter Unit Tests
 * 
 * Comprehensive testing of the Aave V3 protocol adapter including:
 * - Position fetching and calculation accuracy  
 * - Health check functionality
 * - Error handling and edge cases
 * - Performance and timeout scenarios
 */

import { AaveV3Adapter, createAaveV3Adapter } from '@/services/defi/adapters/AaveV3Adapter';
import { ChainId } from '@/types/blockchain';
import { DeFiProtocol, PositionStatus, RiskLevel } from '@/types/defi';
import { mockBlockchainProvider } from '../../mocks/MockBlockchainProvider';
import { testTokens, aaveV3LendingPositions, testAddresses } from '../../fixtures/defiPositions';

// Mock the logger and redis
jest.mock('@/utils/logger');
jest.mock('@/utils/redis', () => ({
  redisManager: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

describe('AaveV3Adapter', () => {
  let adapter: AaveV3Adapter;
  let mockRpcUrls: Partial<Record<ChainId, string>>;

  beforeEach(() => {
    mockRpcUrls = {
      [ChainId.ETHEREUM]: 'https://eth-mainnet.mock',
      [ChainId.POLYGON]: 'https://polygon-mainnet.mock',
      [ChainId.ARBITRUM]: 'https://arbitrum-mainnet.mock',
      [ChainId.OPTIMISM]: 'https://optimism-mainnet.mock',
    };

    adapter = createAaveV3Adapter(mockRpcUrls);
    mockBlockchainProvider.reset();
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockBlockchainProvider.clearCallHistory();
  });

  describe('Initialization', () => {
    it('should initialize with correct protocol metadata', () => {
      expect(adapter.protocol).toBe(DeFiProtocol.AAVE_V3);
      expect(adapter.supportedChains).toContain(ChainId.ETHEREUM);
      expect(adapter.supportedChains).toContain(ChainId.POLYGON);
      expect(adapter.version).toBeDefined();
    });

    it('should provide protocol metadata', () => {
      const metadata = adapter.getProtocolMetadata();
      
      expect(metadata.name).toBe('Aave V3');
      expect(metadata.description).toContain('Aave');
      expect(metadata.website).toBe('https://aave.com');
      expect(metadata.supportedAssets).toContain('ETH');
      expect(metadata.features).toContain('Variable and stable interest rates');
    });

    it('should handle missing RPC URLs gracefully', () => {
      const incompleteRpcUrls = { [ChainId.ETHEREUM]: 'https://eth-mainnet.mock' };
      const incompleteAdapter = createAaveV3Adapter(incompleteRpcUrls);
      
      expect(incompleteAdapter.supportedChains).toContain(ChainId.POLYGON);
      // Should not throw during initialization
    });
  });

  describe('Health Checks', () => {
    it('should report healthy when provider is responsive', async () => {
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        'provider',
        [{
          method: 'getBlockNumber',
          args: [],
          returnValue: 18500000
        }]
      );

      const isHealthy = await adapter.isHealthy();
      const health = adapter.getHealth();

      expect(isHealthy).toBe(true);
      expect(health.isHealthy).toBe(true);
      expect(health.responseTime).toBeGreaterThan(0);
      expect(health.issues).toEqual([]);
    });

    it('should report unhealthy when provider fails', async () => {
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        'provider',
        [{
          method: 'getBlockNumber',
          args: [],
          returnValue: null,
          shouldThrow: true
        }]
      );

      const isHealthy = await adapter.isHealthy();
      const health = adapter.getHealth();

      expect(isHealthy).toBe(false);
      expect(health.isHealthy).toBe(false);
      expect(health.issues).not.toEqual([]);
    });

    it('should track response time during health checks', async () => {
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        'provider',
        [{
          method: 'getBlockNumber',
          args: [],
          returnValue: 18500000,
          delay: 100 // Simulate 100ms delay
        }]
      );

      const startTime = Date.now();
      await adapter.isHealthy();
      const endTime = Date.now();
      
      const health = adapter.getHealth();
      expect(health.responseTime).toBeGreaterThan(0);
      expect(health.responseTime).toBeLessThan(endTime - startTime + 50); // Allow some variance
    });
  });

  describe('Position Fetching', () => {
    beforeEach(() => {
      // Setup mock contract responses for Aave V3
      const poolDataProviderAddress = '0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3';
      const poolAddress = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';

      // Mock user reserves data
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        poolDataProviderAddress,
        [{
          method: 'getUserReservesData',
          args: [testAddresses.whale],
          returnValue: [{
            underlyingAsset: testTokens.WETH.address,
            scaledATokenBalance: BigInt('5000000000000000000'), // 5 WETH
            usageAsCollateralEnabled: true,
            scaledVariableDebt: BigInt(0),
            scaledStableDebt: BigInt(0),
            principalStableDebt: BigInt(0),
            stableBorrowRate: BigInt(0),
            liquidityRate: BigInt('50000000000000000000000000'), // 5% APY
            stableRateLastUpdated: 0,
            stableBorrowRateEnabled: false
          }]
        }]
      );

      // Mock user account data
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        poolAddress,
        [{
          method: 'getUserAccountData',
          args: [testAddresses.whale],
          returnValue: {
            totalCollateralETH: BigInt('5000000000000000000'),
            totalDebtETH: BigInt(0),
            availableBorrowsETH: BigInt('3750000000000000000'),
            currentLiquidationThreshold: BigInt('8500'),
            ltv: BigInt('7500'),
            healthFactor: BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935') // Max uint256
          }
        }]
      );

      // Mock reserves data
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        poolDataProviderAddress,
        [{
          method: 'getReservesData',
          args: [],
          returnValue: [{
            underlyingAsset: testTokens.WETH.address,
            name: testTokens.WETH.name,
            symbol: testTokens.WETH.symbol,
            decimals: BigInt(testTokens.WETH.decimals),
            baseLTVasCollateral: BigInt('7500'),
            reserveLiquidationThreshold: BigInt('8500'),
            reserveLiquidationBonus: BigInt('10500'),
            reserveFactor: BigInt('1000'),
            usageAsCollateralEnabled: true,
            borrowingEnabled: true,
            stableBorrowRateEnabled: false,
            isActive: true,
            isFrozen: false,
            liquidityIndex: BigInt('1050000000000000000000000000'),
            variableBorrowIndex: BigInt('1080000000000000000000000000'),
            liquidityRate: BigInt('50000000000000000000000000'),
            variableBorrowRate: BigInt('80000000000000000000000000'),
            stableBorrowRate: BigInt(0),
            lastUpdateTimestamp: Math.floor(Date.now() / 1000),
            aTokenAddress: '0x4d5f47fa6a74757f35c14fd3a6ef8e3c9bc514e8',
            stableDebtTokenAddress: '0xd98ef0a2e7c7a8c9e5b6b12ac3d4b2c1e5f8e1b9',
            variableDebtTokenAddress: '0xf63b34710400cad3e044cffdcab00a0f32e33ecf',
            interestRateStrategyAddress: '0x1234567890123456789012345678901234567890',
            aTokenDecimals: 18,
            stableDebtTokenDecimals: 18,
            variableDebtTokenDecimals: 18
          }]
        }]
      );
    });

    it('should fetch positions for a single chain', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null); // No cache hit
      redisManager.set.mockResolvedValue('OK');

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);

      expect(positions).toBeDefined();
      expect(positions.length).toBeGreaterThan(0);
      
      const position = positions[0];
      expect(position.protocol).toBe(DeFiProtocol.AAVE_V3);
      expect(position.chainId).toBe(ChainId.ETHEREUM);
      expect(position.suppliedTokens.length).toBeGreaterThan(0);
      expect(position.totalValueUSD).toBeGreaterThan(0);
    });

    it('should fetch positions across all supported chains', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);
      redisManager.set.mockResolvedValue('OK');

      // Setup mocks for multiple chains
      [ChainId.POLYGON, ChainId.ARBITRUM, ChainId.OPTIMISM].forEach(chainId => {
        const addresses = {
          [ChainId.POLYGON]: {
            poolDataProvider: '0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654',
            pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD'
          },
          [ChainId.ARBITRUM]: {
            poolDataProvider: '0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654',
            pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD'
          },
          [ChainId.OPTIMISM]: {
            poolDataProvider: '0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654',
            pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD'
          }
        }[chainId];

        mockBlockchainProvider.mockContractCall(chainId, addresses.poolDataProvider, [
          { method: 'getUserReservesData', args: [testAddresses.whale], returnValue: [] }
        ]);
      });

      const positions = await adapter.getPositions(testAddresses.whale);

      expect(Array.isArray(positions)).toBe(true);
      // Should have attempted to fetch from all chains
      const callHistory = mockBlockchainProvider.getCallHistory();
      const uniqueChains = new Set(callHistory.map(call => call.chainId));
      expect(uniqueChains.size).toBeGreaterThanOrEqual(3);
    });

    it('should return cached positions when available', async () => {
      const { redisManager } = require('@/utils/redis');
      const cachedPosition = aaveV3LendingPositions.healthyPosition;
      redisManager.get.mockResolvedValue([cachedPosition]);

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);

      expect(positions).toEqual([cachedPosition]);
      expect(redisManager.set).not.toHaveBeenCalled();
      
      // Should not have made blockchain calls
      const callHistory = mockBlockchainProvider.getCallHistory();
      expect(callHistory.length).toBe(0);
    });

    it('should handle empty positions gracefully', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      // Mock empty user data
      const poolDataProviderAddress = '0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3';
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        poolDataProviderAddress,
        [{
          method: 'getUserReservesData',
          args: [testAddresses.empty],
          returnValue: []
        }]
      );

      const positions = await adapter.getPositions(testAddresses.empty, ChainId.ETHEREUM);

      expect(positions).toEqual([]);
    });

    it('should filter out dust positions', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      const poolDataProviderAddress = '0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3';
      const poolAddress = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';

      // Mock dust position (very small balance)
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        poolDataProviderAddress,
        [{
          method: 'getUserReservesData',
          args: [testAddresses.retail],
          returnValue: [{
            underlyingAsset: testTokens.USDC.address,
            scaledATokenBalance: BigInt('1000'), // 0.001 USDC
            usageAsCollateralEnabled: false,
            scaledVariableDebt: BigInt(0),
            scaledStableDebt: BigInt(0),
            principalStableDebt: BigInt(0),
            stableBorrowRate: BigInt(0),
            liquidityRate: BigInt('30000000000000000000000000'),
            stableRateLastUpdated: 0,
            stableBorrowRateEnabled: false
          }]
        }, {
          method: 'getReservesData',
          args: [],
          returnValue: [{
            underlyingAsset: testTokens.USDC.address,
            symbol: testTokens.USDC.symbol,
            name: testTokens.USDC.name,
            decimals: BigInt(testTokens.USDC.decimals),
            liquidityIndex: BigInt('1000000000000000000000000000'),
            // ... other fields
          }]
        }]
      );

      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        poolAddress,
        [{
          method: 'getUserAccountData',
          args: [testAddresses.retail],
          returnValue: {
            totalCollateralETH: BigInt('1000000000000'), // Very small
            totalDebtETH: BigInt(0),
            availableBorrowsETH: BigInt(0),
            currentLiquidationThreshold: BigInt(0),
            ltv: BigInt(0),
            healthFactor: BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935')
          }
        }]
      );

      const positions = await adapter.getPositions(testAddresses.retail, ChainId.ETHEREUM);

      // Should filter out positions with value < $0.01
      expect(positions).toEqual([]);
    });
  });

  describe('Position Calculations', () => {
    it('should calculate lending position values correctly', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);
      redisManager.set.mockResolvedValue('OK');

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      const position = positions[0];

      expect(position.suppliedTokens[0].valueUSD).toBeCloseTo(10000, 0); // 5 WETH * $2000
      expect(position.totalValueUSD).toBeGreaterThan(0);
      expect(position.netValueUSD).toBeGreaterThan(0);
    });

    it('should calculate yield information correctly', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      const position = positions[0];

      expect(position.yieldInfo).toBeDefined();
      expect(position.yieldInfo![0].apy).toBeCloseTo(5.0, 1); // ~5% APY
      expect(position.yieldInfo![0].source).toBe('lending');
      expect(position.yieldInfo![0].isCompounding).toBe(true);
    });

    it('should calculate risk metrics accurately', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      const position = positions[0];

      expect(position.riskMetrics.liquidationRisk).toBe(RiskLevel.LOW);
      expect(position.riskMetrics.healthFactor).toBeGreaterThan(1);
      expect(position.riskMetrics.collateralRatio).toBeGreaterThan(0);
    });

    it('should determine position status correctly', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      const position = positions[0];

      expect(position.status).toBe(PositionStatus.ACTIVE);
    });
  });

  describe('Error Handling', () => {
    it('should handle network timeouts gracefully', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      mockBlockchainProvider.simulateNetworkFailure(ChainId.ETHEREUM, 1000);

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      
      // Should return empty array on failure rather than throwing
      expect(positions).toEqual([]);
    });

    it('should handle invalid addresses', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      const positions = await adapter.getPositions(testAddresses.invalid, ChainId.ETHEREUM);
      
      expect(positions).toEqual([]);
    });

    it('should handle contract call failures', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      const poolDataProviderAddress = '0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3';
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        poolDataProviderAddress,
        [{
          method: 'getUserReservesData',
          args: [testAddresses.whale],
          returnValue: null,
          shouldThrow: true
        }]
      );

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      
      expect(positions).toEqual([]);
    });

    it('should handle malformed contract responses', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      const poolDataProviderAddress = '0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3';
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        poolDataProviderAddress,
        [{
          method: 'getUserReservesData',
          args: [testAddresses.whale],
          returnValue: 'invalid-response'
        }]
      );

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      
      expect(positions).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle positions with zero health factor', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      const poolAddress = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        poolAddress,
        [{
          method: 'getUserAccountData',
          args: [testAddresses.whale],
          returnValue: {
            totalCollateralETH: BigInt('1000000000000000000'),
            totalDebtETH: BigInt('900000000000000000'),
            availableBorrowsETH: BigInt(0),
            currentLiquidationThreshold: BigInt('8500'),
            ltv: BigInt('7500'),
            healthFactor: BigInt(0) // Zero health factor
          }
        }]
      );

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      
      if (positions.length > 0) {
        const position = positions[0];
        expect(position.status).toBe(PositionStatus.LIQUIDATED);
        expect(position.riskMetrics.liquidationRisk).toBe(RiskLevel.CRITICAL);
      }
    });

    it('should handle extremely large numbers', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      const poolDataProviderAddress = '0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3';
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        poolDataProviderAddress,
        [{
          method: 'getUserReservesData',
          args: [testAddresses.whale],
          returnValue: [{
            underlyingAsset: testTokens.WETH.address,
            scaledATokenBalance: BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935'), // Max uint256
            usageAsCollateralEnabled: true,
            scaledVariableDebt: BigInt(0),
            scaledStableDebt: BigInt(0),
            principalStableDebt: BigInt(0),
            stableBorrowRate: BigInt(0),
            liquidityRate: BigInt('50000000000000000000000000'),
            stableRateLastUpdated: 0,
            stableBorrowRateEnabled: false
          }]
        }]
      );

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      
      // Should handle without crashing and return finite numbers
      if (positions.length > 0) {
        const position = positions[0];
        expect(Number.isFinite(position.totalValueUSD)).toBe(true);
        expect(Number.isFinite(position.netValueUSD)).toBe(true);
      }
    });

    it('should handle unsupported chains gracefully', async () => {
      const positions = await adapter.getPositions(testAddresses.whale, 999 as ChainId);
      
      expect(positions).toEqual([]);
    });
  });

  describe('Performance', () => {
    it('should complete position fetching within reasonable time', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      const startTime = Date.now();
      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    }, 10000);

    it('should handle concurrent requests efficiently', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);
      redisManager.set.mockResolvedValue('OK');

      const requests = Array(5).fill(null).map(() => 
        adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM)
      );

      const startTime = Date.now();
      const results = await Promise.all(requests);
      const endTime = Date.now();

      expect(results).toHaveLength(5);
      expect(endTime - startTime).toBeLessThan(10000); // Should handle concurrent requests efficiently
    }, 15000);
  });
});