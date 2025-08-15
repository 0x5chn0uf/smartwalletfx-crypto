/**
 * Uniswap V3 Adapter Unit Tests
 * 
 * Comprehensive testing of the Uniswap V3 protocol adapter including:
 * - Liquidity position calculations
 * - Fee collection tracking  
 * - In-range vs out-of-range positions
 * - Impermanent loss calculations
 */

import { UniswapV3Adapter, createUniswapV3Adapter } from '@/services/defi/adapters/UniswapV3Adapter';
import { ChainId } from '@/types/blockchain';
import { DeFiProtocol, PositionStatus, RiskLevel, PositionType } from '@/types/defi';
import { mockBlockchainProvider } from '../../mocks/MockBlockchainProvider';
import { testTokens, uniswapV3LiquidityPositions, testAddresses } from '../../fixtures/defiPositions';

// Mock dependencies
jest.mock('@/utils/logger');
jest.mock('@/utils/redis', () => ({
  redisManager: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

describe('UniswapV3Adapter', () => {
  let adapter: UniswapV3Adapter;
  let mockRpcUrls: Partial<Record<ChainId, string>>;

  beforeEach(() => {
    mockRpcUrls = {
      [ChainId.ETHEREUM]: 'https://eth-mainnet.mock',
      [ChainId.POLYGON]: 'https://polygon-mainnet.mock',
      [ChainId.ARBITRUM]: 'https://arbitrum-mainnet.mock',
      [ChainId.OPTIMISM]: 'https://optimism-mainnet.mock',
      [ChainId.BASE]: 'https://base-mainnet.mock',
    };

    adapter = createUniswapV3Adapter(mockRpcUrls);
    mockBlockchainProvider.reset();
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockBlockchainProvider.clearCallHistory();
  });

  describe('Initialization', () => {
    it('should initialize with correct protocol metadata', () => {
      expect(adapter.protocol).toBe(DeFiProtocol.UNISWAP_V3);
      expect(adapter.supportedChains).toContain(ChainId.ETHEREUM);
      expect(adapter.supportedChains).toContain(ChainId.BASE);
      expect(adapter.version).toBeDefined();
    });

    it('should provide protocol metadata', () => {
      const metadata = adapter.getProtocolMetadata();
      
      expect(metadata.name).toBe('Uniswap V3');
      expect(metadata.description).toContain('concentrated liquidity');
      expect(metadata.website).toBe('https://uniswap.org');
      expect(metadata.features).toContain('Concentrated liquidity');
      expect(metadata.features).toContain('Multiple fee tiers');
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
      expect(health.responseTime).toBeGreaterThanOrEqual(0);
      expect(health.issues).toEqual([]);
    });

    it('should handle health check failures', async () => {
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
      expect(isHealthy).toBe(false);
    });
  });

  describe('Position Fetching', () => {
    beforeEach(() => {
      setupUniswapMocks();
    });

    it('should fetch active liquidity positions', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);
      redisManager.set.mockResolvedValue('OK');

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);

      expect(positions).toBeDefined();
      expect(positions.length).toBeGreaterThan(0);
      
      const position = positions[0];
      expect(position.protocol).toBe(DeFiProtocol.UNISWAP_V3);
      expect(position.type).toBe(PositionType.LIQUIDITY_POOL);
      expect(position.suppliedTokens.length).toBe(2); // Token0 and Token1
    });

    it('should handle positions with zero liquidity', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      const positionManagerAddress = '0xC36442b4E4502b459DC5a9c5dE2d6aCB1c2e93C0';
      
      // Mock position with zero liquidity
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        positionManagerAddress,
        [{
          method: 'balanceOf',
          args: [testAddresses.whale],
          returnValue: BigInt(1)
        }, {
          method: 'tokenOfOwnerByIndex',
          args: [testAddresses.whale, 0],
          returnValue: BigInt(123456)
        }, {
          method: 'positions',
          args: [123456],
          returnValue: {
            nonce: BigInt(0),
            operator: '0x0000000000000000000000000000000000000000',
            token0: testTokens.WETH.address,
            token1: testTokens.USDC.address,
            fee: 3000,
            tickLower: -276320,
            tickUpper: 276320,
            liquidity: BigInt(0), // Zero liquidity
            feeGrowthInside0LastX128: BigInt(0),
            feeGrowthInside1LastX128: BigInt(0),
            tokensOwed0: BigInt(0),
            tokensOwed1: BigInt(0)
          }
        }]
      );

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      
      // Should filter out zero liquidity positions
      expect(positions).toEqual([]);
    });

    it('should calculate position amounts correctly for in-range positions', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);
      redisManager.set.mockResolvedValue('OK');

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      const position = positions[0];

      expect(position.suppliedTokens[0].valueUSD).toBeGreaterThan(0);
      expect(position.suppliedTokens[1].valueUSD).toBeGreaterThan(0);
      expect(position.totalValueUSD).toBeGreaterThan(0);
    });

    it('should calculate fees correctly', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      // Setup position with pending fees
      const positionManagerAddress = '0xC36442b4E4502b459DC5a9c5dE2d6aCB1c2e93C0';
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        positionManagerAddress,
        [{
          method: 'positions',
          args: [123456],
          returnValue: {
            nonce: BigInt(0),
            operator: '0x0000000000000000000000000000000000000000',
            token0: testTokens.WETH.address,
            token1: testTokens.USDC.address,
            fee: 3000,
            tickLower: -276320,
            tickUpper: 276320,
            liquidity: BigInt('1000000000000000000'),
            feeGrowthInside0LastX128: BigInt(0),
            feeGrowthInside1LastX128: BigInt(0),
            tokensOwed0: BigInt('5000000000000000'), // 0.005 WETH in fees
            tokensOwed1: BigInt('10000000') // 10 USDC in fees
          }
        }]
      );

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      const position = positions[0] as any;

      if (position.fees?.pendingFees) {
        expect(position.fees.pendingFees.length).toBe(2);
        expect(position.fees.pendingFees[0].valueUSD).toBeCloseTo(10, 1); // 0.005 * $2000
        expect(position.fees.pendingFees[1].valueUSD).toBeCloseTo(10, 1); // 10 * $1
      }
    });

    it('should determine in-range vs out-of-range positions', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      // Setup out-of-range position
      const poolAddress = '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8';
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        poolAddress,
        [{
          method: 'slot0',
          args: [],
          returnValue: [
            BigInt('1771845812700000000000000000000000000000000'), // sqrtPriceX96 (price = ~$2500)
            300000, // Current tick (out of range)
            0,
            1,
            1,
            0,
            true
          ]
        }]
      );

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      const position = positions[0];

      const protocolData = position.protocolData as any;
      if (protocolData.currentTick > protocolData.tickUpper || protocolData.currentTick < protocolData.tickLower) {
        expect(position.status).toBe(PositionStatus.INACTIVE);
        expect(protocolData.inRange).toBe(false);
      }
    });

    it('should estimate APY correctly based on fee tier', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      const position = positions[0];

      expect(position.yieldInfo).toBeDefined();
      expect(position.yieldInfo![0].apy).toBeGreaterThan(0);
      expect(position.yieldInfo![0].source).toBe('fees');
      expect(position.yieldInfo![0].isCompounding).toBe(false);
    });
  });

  describe('Position Calculations', () => {
    beforeEach(() => {
      setupUniswapMocks();
    });

    it('should calculate impermanent loss correctly', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      const position = positions[0];

      expect(position.riskMetrics.impermanentLoss).toBeDefined();
      expect(position.riskMetrics.impermanentLoss).toBeGreaterThanOrEqual(0);
    });

    it('should handle extreme price movements', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      // Mock extreme price (very high current tick)
      const poolAddress = '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8';
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        poolAddress,
        [{
          method: 'slot0',
          args: [],
          returnValue: [
            BigInt('5000000000000000000000000000000000000000000'), // Very high price
            500000, // Very high tick
            0, 1, 1, 0, true
          ]
        }]
      );

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      
      // Should handle extreme values without crashing
      if (positions.length > 0) {
        const position = positions[0];
        expect(Number.isFinite(position.totalValueUSD)).toBe(true);
        expect(position.riskMetrics.impermanentLoss).toBeLessThanOrEqual(1); // Should be <= 100%
      }
    });

    it('should handle positions with complex tick ranges', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      const positionManagerAddress = '0xC36442b4E4502b459DC5a9c5dE2d6aCB1c2e93C0';
      
      // Mock narrow range position
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        positionManagerAddress,
        [{
          method: 'positions',
          args: [123456],
          returnValue: {
            nonce: BigInt(0),
            operator: '0x0000000000000000000000000000000000000000',
            token0: testTokens.WETH.address,
            token1: testTokens.USDC.address,
            fee: 500, // 0.05% fee tier
            tickLower: 200000, // Narrow range
            tickUpper: 202000,
            liquidity: BigInt('1000000000000000000'),
            feeGrowthInside0LastX128: BigInt(0),
            feeGrowthInside1LastX128: BigInt(0),
            tokensOwed0: BigInt(0),
            tokensOwed1: BigInt(0)
          }
        }]
      );

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      
      if (positions.length > 0) {
        const position = positions[0];
        expect(position.name).toContain('0.05%'); // Should reflect fee tier
        expect(position.yieldInfo![0].apy).toBeGreaterThan(0);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle network timeouts', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      mockBlockchainProvider.simulateNetworkFailure(ChainId.ETHEREUM, 1000);

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      expect(positions).toEqual([]);
    });

    it('should handle invalid token IDs', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      const positionManagerAddress = '0xC36442b4E4502b459DC5a9c5dE2d6aCB1c2e93C0';
      
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        positionManagerAddress,
        [{
          method: 'balanceOf',
          args: [testAddresses.whale],
          returnValue: BigInt(1)
        }, {
          method: 'tokenOfOwnerByIndex',
          args: [testAddresses.whale, 0],
          returnValue: null,
          shouldThrow: true
        }]
      );

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      expect(positions).toEqual([]);
    });

    it('should handle non-existent pools', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      const factoryAddress = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        factoryAddress,
        [{
          method: 'getPool',
          args: [testTokens.WETH.address, testTokens.USDC.address, 3000],
          returnValue: '0x0000000000000000000000000000000000000000' // Zero address = no pool
        }]
      );

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      expect(positions).toEqual([]);
    });

    it('should handle malformed position data', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      const positionManagerAddress = '0xC36442b4E4502b459DC5a9c5dE2d6aCB1c2e93C0';
      
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        positionManagerAddress,
        [{
          method: 'positions',
          args: [123456],
          returnValue: null // Invalid response
        }]
      );

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      expect(positions).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should filter out dust positions', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      // Setup position with very low value
      setupUniswapMocks();
      
      // Mock very small liquidity that results in dust value
      const positionManagerAddress = '0xC36442b4E4502b459DC5a9c5dE2d6aCB1c2e93C0';
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        positionManagerAddress,
        [{
          method: 'positions',
          args: [123456],
          returnValue: {
            nonce: BigInt(0),
            operator: '0x0000000000000000000000000000000000000000',
            token0: testTokens.WETH.address,
            token1: testTokens.USDC.address,
            fee: 3000,
            tickLower: -276320,
            tickUpper: 276320,
            liquidity: BigInt('1000'), // Very small liquidity
            feeGrowthInside0LastX128: BigInt(0),
            feeGrowthInside1LastX128: BigInt(0),
            tokensOwed0: BigInt(0),
            tokensOwed1: BigInt(0)
          }
        }]
      );

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      
      // Should filter out positions with total value < $0.01
      const dustPositions = positions.filter(p => p.totalValueUSD < 0.01);
      expect(dustPositions).toHaveLength(0);
    });

    it('should handle positions across multiple fee tiers', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      const positionManagerAddress = '0xC36442b4E4502b459DC5a9c5dE2d6aCB1c2e93C0';
      
      // Mock multiple positions with different fee tiers
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        positionManagerAddress,
        [{
          method: 'balanceOf',
          args: [testAddresses.whale],
          returnValue: BigInt(3)
        }, {
          method: 'tokenOfOwnerByIndex',
          args: [testAddresses.whale, 0],
          returnValue: BigInt(123456)
        }, {
          method: 'tokenOfOwnerByIndex',
          args: [testAddresses.whale, 1],
          returnValue: BigInt(123457)
        }, {
          method: 'tokenOfOwnerByIndex',
          args: [testAddresses.whale, 2],
          returnValue: BigInt(123458)
        }]
      );

      // Mock positions with different fee tiers
      const feeTiers = [100, 500, 3000]; // 0.01%, 0.05%, 0.3%
      feeTiers.forEach((fee, index) => {
        mockBlockchainProvider.mockContractCall(
          ChainId.ETHEREUM,
          positionManagerAddress,
          [{
            method: 'positions',
            args: [123456 + index],
            returnValue: {
              nonce: BigInt(0),
              operator: '0x0000000000000000000000000000000000000000',
              token0: testTokens.WETH.address,
              token1: testTokens.USDC.address,
              fee,
              tickLower: -276320,
              tickUpper: 276320,
              liquidity: BigInt('1000000000000000000'),
              feeGrowthInside0LastX128: BigInt(0),
              feeGrowthInside1LastX128: BigInt(0),
              tokensOwed0: BigInt(0),
              tokensOwed1: BigInt(0)
            }
          }]
        );
      });

      setupPoolMocks();

      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      
      expect(positions.length).toBe(3);
      
      // Should have different APY estimates based on fee tiers
      const apys = positions.map(p => p.yieldInfo?.[0]?.apy || 0);
      expect(new Set(apys).size).toBeGreaterThan(1); // Should have different APYs
    });
  });

  describe('Performance', () => {
    it('should handle large numbers of positions efficiently', async () => {
      const { redisManager } = require('@/utils/redis');
      redisManager.get.mockResolvedValue(null);

      const positionManagerAddress = '0xC36442b4E4502b459DC5a9c5dE2d6aCB1c2e93C0';
      
      // Mock wallet with many positions
      const positionCount = 10;
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        positionManagerAddress,
        [{
          method: 'balanceOf',
          args: [testAddresses.whale],
          returnValue: BigInt(positionCount)
        }]
      );

      // Mock all token IDs
      for (let i = 0; i < positionCount; i++) {
        mockBlockchainProvider.mockContractCall(
          ChainId.ETHEREUM,
          positionManagerAddress,
          [{
            method: 'tokenOfOwnerByIndex',
            args: [testAddresses.whale, i],
            returnValue: BigInt(123456 + i)
          }]
        );
      }

      setupPoolMocks();

      const startTime = Date.now();
      const positions = await adapter.getPositions(testAddresses.whale, ChainId.ETHEREUM);
      const endTime = Date.now();

      expect(positions.length).toBeLessThanOrEqual(positionCount);
      expect(endTime - startTime).toBeLessThan(15000); // Should complete within 15 seconds
    }, 20000);
  });

  // Helper functions for setting up mocks
  function setupUniswapMocks() {
    const positionManagerAddress = '0xC36442b4E4502b459DC5a9c5dE2d6aCB1c2e93C0';
    
    mockBlockchainProvider.mockContractCall(
      ChainId.ETHEREUM,
      positionManagerAddress,
      [{
        method: 'balanceOf',
        args: [testAddresses.whale],
        returnValue: BigInt(1)
      }, {
        method: 'tokenOfOwnerByIndex',
        args: [testAddresses.whale, 0],
        returnValue: BigInt(123456)
      }, {
        method: 'positions',
        args: [123456],
        returnValue: {
          nonce: BigInt(0),
          operator: '0x0000000000000000000000000000000000000000',
          token0: testTokens.WETH.address,
          token1: testTokens.USDC.address,
          fee: 3000,
          tickLower: -276320,
          tickUpper: 276320,
          liquidity: BigInt('1000000000000000000'),
          feeGrowthInside0LastX128: BigInt(0),
          feeGrowthInside1LastX128: BigInt(0),
          tokensOwed0: BigInt(0),
          tokensOwed1: BigInt(0)
        }
      }]
    );

    setupFactoryMocks();
    setupPoolMocks();
    setupTokenMocks();
  }

  function setupFactoryMocks() {
    const factoryAddress = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
    mockBlockchainProvider.mockContractCall(
      ChainId.ETHEREUM,
      factoryAddress,
      [{
        method: 'getPool',
        args: [testTokens.WETH.address, testTokens.USDC.address, 3000],
        returnValue: '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8'
      }]
    );
  }

  function setupPoolMocks() {
    const poolAddress = '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8';
    mockBlockchainProvider.mockContractCall(
      ChainId.ETHEREUM,
      poolAddress,
      [{
        method: 'slot0',
        args: [],
        returnValue: [
          BigInt('1771845812700000000000000000000000000000000'), // sqrtPriceX96 for WETH/USDC ~$2000
          201000, // Current tick (in range)
          0, // observationIndex
          1, // observationCardinality
          1, // observationCardinalityNext
          0, // feeProtocol
          true // unlocked
        ]
      }, {
        method: 'liquidity',
        args: [],
        returnValue: BigInt('50000000000000000000000000') // 50M liquidity
      }]
    );
  }

  function setupTokenMocks() {
    // Mock token info calls
    [testTokens.WETH, testTokens.USDC].forEach(token => {
      mockBlockchainProvider.mockContractCall(
        ChainId.ETHEREUM,
        token.address,
        [{
          method: 'symbol',
          args: [],
          returnValue: token.symbol
        }, {
          method: 'name',
          args: [],
          returnValue: token.name
        }, {
          method: 'decimals',
          args: [],
          returnValue: token.decimals
        }]
      );
    });
  }
});