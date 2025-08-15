/**
 * Test Fixtures for DeFi Positions
 * 
 * Comprehensive test data covering various DeFi scenarios
 */

import { 
  DeFiPosition, 
  LendingPosition, 
  LiquidityPosition,
  StakingPosition,
  DeFiToken,
  YieldInfo,
  RiskMetrics,
  DeFiProtocol,
  PositionType,
  PositionStatus,
  RiskLevel
} from '@/types/defi';
import { ChainId } from '@/types/blockchain';

// Common test tokens
export const testTokens = {
  WETH: {
    address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    chainId: ChainId.ETHEREUM,
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
    priceUSD: 2000,
    isStable: false
  } as DeFiToken,
  
  USDC: {
    address: '0xa0b86a33e6441b8435b6ba10d7c6f8c7e7eaee5a',
    chainId: ChainId.ETHEREUM,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    priceUSD: 1.0,
    isStable: true
  } as DeFiToken,
  
  DAI: {
    address: '0x6b175474e89094c44da98b954eedeac495271d0f',
    chainId: ChainId.ETHEREUM,
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    decimals: 18,
    priceUSD: 1.0,
    isStable: true
  } as DeFiToken,
  
  WBTC: {
    address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    chainId: ChainId.ETHEREUM,
    symbol: 'WBTC',
    name: 'Wrapped BTC',
    decimals: 8,
    priceUSD: 45000,
    isStable: false
  } as DeFiToken,
};

// Test yield info
export const testYieldInfo: YieldInfo = {
  apy: 5.25,
  apr: 5.12,
  dailyRate: 0.014,
  source: 'lending',
  isCompounding: true,
  calculatedAt: new Date('2024-01-01T00:00:00Z')
};

// Test risk metrics
export const testRiskMetrics = {
  healthy: {
    healthFactor: 2.5,
    liquidationPrice: 1500,
    liquidationRisk: RiskLevel.LOW,
    collateralRatio: 0.75,
    utilizationRate: 0.3
  } as RiskMetrics,
  
  risky: {
    healthFactor: 1.15,
    liquidationPrice: 1900,
    liquidationRisk: RiskLevel.HIGH,
    collateralRatio: 0.85,
    utilizationRate: 0.85
  } as RiskMetrics,
  
  critical: {
    healthFactor: 1.05,
    liquidationPrice: 1950,
    liquidationRisk: RiskLevel.CRITICAL,
    collateralRatio: 0.95,
    utilizationRate: 0.95
  } as RiskMetrics
};

// Aave V3 Lending Position Fixtures
export const aaveV3LendingPositions = {
  healthyPosition: {
    id: 'aave-v3:1:0x123:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    protocol: DeFiProtocol.AAVE_V3,
    chainId: ChainId.ETHEREUM,
    type: PositionType.LENDING,
    status: PositionStatus.ACTIVE,
    name: 'Aave V3 WETH Lending Position',
    description: 'Lending WETH on Aave V3 with USDC borrowing',
    url: 'https://app.aave.com/reserve-overview/?underlyingAsset=0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2&marketName=proto_mainnet_v3',
    
    suppliedTokens: [{
      token: testTokens.WETH,
      amount: '5000000000000000000', // 5 WETH
      amountFormatted: '5.000000',
      valueUSD: 10000
    }],
    
    borrowedTokens: [{
      token: testTokens.USDC,
      amount: '3000000000', // 3000 USDC
      amountFormatted: '3000.000000',
      valueUSD: 3000
    }],
    
    collateralTokens: [{
      token: testTokens.WETH,
      amount: '5000000000000000000',
      amountFormatted: '5.000000',
      valueUSD: 10000,
      isCollateral: true
    }],
    
    borrowingPower: {
      totalBorrowingPowerUSD: 7500,
      usedBorrowingPowerUSD: 3000,
      availableBorrowingPowerUSD: 4500
    },
    
    totalValueUSD: 10000,
    netValueUSD: 7000,
    yieldInfo: [testYieldInfo],
    riskMetrics: testRiskMetrics.healthy,
    
    createdAt: new Date('2024-01-01T00:00:00Z'),
    lastUpdatedAt: new Date('2024-01-01T12:00:00Z'),
    
    protocolData: {
      aTokenAddress: '0x4d5f47fa6a74757f35c14fd3a6ef8e3c9bc514e8',
      variableDebtTokenAddress: '0xf63b34710400cad3e044cffdcab00a0f32e33ecf',
      stableDebtTokenAddress: '0xd98ef0a2e7c7a8c9e5b6b12ac3d4b2c1e5f8e1b9',
      liquidityIndex: '1050000000000000000000000000',
      variableBorrowIndex: '1080000000000000000000000000',
      usageAsCollateralEnabled: true,
      stableBorrowRateEnabled: false
    }
  } as LendingPosition,
  
  riskyPosition: {
    id: 'aave-v3:1:0x456:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    protocol: DeFiProtocol.AAVE_V3,
    chainId: ChainId.ETHEREUM,
    type: PositionType.LENDING,
    status: PositionStatus.AT_RISK,
    name: 'Aave V3 WETH High Utilization',
    description: 'High utilization WETH position at risk',
    
    suppliedTokens: [{
      token: testTokens.WETH,
      amount: '2000000000000000000', // 2 WETH
      amountFormatted: '2.000000',
      valueUSD: 4000
    }],
    
    borrowedTokens: [{
      token: testTokens.USDC,
      amount: '3400000000', // 3400 USDC
      amountFormatted: '3400.000000',
      valueUSD: 3400
    }],
    
    collateralTokens: [{
      token: testTokens.WETH,
      amount: '2000000000000000000',
      amountFormatted: '2.000000',
      valueUSD: 4000,
      isCollateral: true
    }],
    
    borrowingPower: {
      totalBorrowingPowerUSD: 3000,
      usedBorrowingPowerUSD: 3400,
      availableBorrowingPowerUSD: -400
    },
    
    totalValueUSD: 4000,
    netValueUSD: 600,
    riskMetrics: testRiskMetrics.risky,
    
    createdAt: new Date('2024-01-01T00:00:00Z'),
    lastUpdatedAt: new Date('2024-01-01T12:00:00Z'),
    
    protocolData: {
      usageAsCollateralEnabled: true,
      healthFactor: 1.15
    }
  } as LendingPosition
};

// Uniswap V3 Liquidity Position Fixtures
export const uniswapV3LiquidityPositions = {
  activePosition: {
    id: 'uniswap-v3:1:123456',
    protocol: DeFiProtocol.UNISWAP_V3,
    chainId: ChainId.ETHEREUM,
    type: PositionType.LIQUIDITY_POOL,
    status: PositionStatus.ACTIVE,
    name: 'WETH/USDC 0.3%',
    description: 'Uniswap V3 liquidity position in WETH/USDC pool',
    url: 'https://app.uniswap.org/#/pool/123456',
    
    suppliedTokens: [
      {
        token: testTokens.WETH,
        amount: '1000000000000000000', // 1 WETH
        amountFormatted: '1.000000',
        valueUSD: 2000
      },
      {
        token: testTokens.USDC,
        amount: '2000000000', // 2000 USDC
        amountFormatted: '2000.000000',
        valueUSD: 2000
      }
    ],
    
    poolInfo: {
      poolAddress: '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8',
      poolName: 'WETH/USDC',
      fee: 0.3,
      totalLiquidity: 50000000,
      volume24h: 25000000
    },
    
    lpTokens: {
      address: '0xc36442b4e4502b459dc5a9c5de2d6acb1c2e93c0',
      amount: '123456',
      share: 0.008 // 0.008% of pool
    },
    
    fees: {
      collected24h: 12.50,
      collectedTotal: 450.75,
      pendingFees: [
        {
          token: testTokens.WETH,
          amount: '5000000000000000', // 0.005 WETH
          valueUSD: 10
        },
        {
          token: testTokens.USDC,
          amount: '10000000', // 10 USDC
          valueUSD: 10
        }
      ]
    },
    
    totalValueUSD: 4000,
    netValueUSD: 4020, // Including pending fees
    yieldInfo: [{
      apy: 12.5,
      apr: 11.8,
      source: 'fees',
      isCompounding: false,
      calculatedAt: new Date('2024-01-01T00:00:00Z')
    }],
    riskMetrics: {
      liquidationRisk: RiskLevel.LOW,
      impermanentLoss: 0.02
    },
    
    createdAt: new Date('2024-01-01T00:00:00Z'),
    lastUpdatedAt: new Date('2024-01-01T12:00:00Z'),
    
    protocolData: {
      tokenId: 123456,
      tickLower: -276320,
      tickUpper: 276320,
      currentTick: 201000,
      inRange: true,
      priceRange: { min: 1800, max: 2200 },
      feeGrowthInside0LastX128: '100000000000000000000000000000000000',
      feeGrowthInside1LastX128: '200000000000000000000000000000000000'
    }
  } as LiquidityPosition,
  
  outOfRangePosition: {
    id: 'uniswap-v3:1:789012',
    protocol: DeFiProtocol.UNISWAP_V3,
    chainId: ChainId.ETHEREUM,
    type: PositionType.LIQUIDITY_POOL,
    status: PositionStatus.INACTIVE,
    name: 'WETH/USDC 0.3%',
    description: 'Out-of-range Uniswap V3 position',
    
    suppliedTokens: [
      {
        token: testTokens.WETH,
        amount: '0', // No WETH when out of range
        amountFormatted: '0.000000',
        valueUSD: 0
      },
      {
        token: testTokens.USDC,
        amount: '5000000000', // 5000 USDC
        amountFormatted: '5000.000000',
        valueUSD: 5000
      }
    ],
    
    poolInfo: {
      poolAddress: '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8',
      poolName: 'WETH/USDC',
      fee: 0.3,
      totalLiquidity: 50000000
    },
    
    lpTokens: {
      address: '0xc36442b4e4502b459dc5a9c5de2d6acb1c2e93c0',
      amount: '789012',
      share: 0.01
    },
    
    totalValueUSD: 5000,
    netValueUSD: 5000,
    riskMetrics: {
      liquidationRisk: RiskLevel.MEDIUM,
      impermanentLoss: 0.15 // Higher IL when out of range
    },
    
    createdAt: new Date('2024-01-01T00:00:00Z'),
    lastUpdatedAt: new Date('2024-01-01T12:00:00Z'),
    
    protocolData: {
      tokenId: 789012,
      tickLower: -200000,
      tickUpper: -100000,
      currentTick: 201000,
      inRange: false,
      priceRange: { min: 1200, max: 1600 }
    }
  } as LiquidityPosition
};

// Edge cases and error scenarios
export const edgeCasePositions = {
  dustPosition: {
    id: 'dust-position',
    protocol: DeFiProtocol.AAVE_V3,
    chainId: ChainId.ETHEREUM,
    type: PositionType.LENDING,
    status: PositionStatus.INACTIVE,
    name: 'Dust Position',
    suppliedTokens: [{
      token: testTokens.USDC,
      amount: '1000', // 0.001 USDC
      amountFormatted: '0.001000',
      valueUSD: 0.001
    }],
    totalValueUSD: 0.001,
    netValueUSD: 0.001,
    riskMetrics: { liquidationRisk: RiskLevel.LOW },
    createdAt: new Date(),
    lastUpdatedAt: new Date(),
    protocolData: {}
  } as DeFiPosition,
  
  zeroBalancePosition: {
    id: 'zero-balance',
    protocol: DeFiProtocol.UNISWAP_V3,
    chainId: ChainId.ETHEREUM,
    type: PositionType.LIQUIDITY_POOL,
    status: PositionStatus.CLOSED,
    name: 'Closed Position',
    suppliedTokens: [],
    totalValueUSD: 0,
    netValueUSD: 0,
    riskMetrics: { liquidationRisk: RiskLevel.LOW },
    createdAt: new Date(),
    lastUpdatedAt: new Date(),
    protocolData: {}
  } as DeFiPosition,
  
  invalidPosition: {
    id: 'invalid-position',
    protocol: 'invalid-protocol' as DeFiProtocol,
    chainId: 999 as ChainId,
    type: 'invalid-type' as PositionType,
    status: 'invalid-status' as PositionStatus,
    name: '',
    suppliedTokens: [],
    totalValueUSD: NaN,
    netValueUSD: Infinity,
    riskMetrics: { liquidationRisk: 'invalid' as RiskLevel },
    createdAt: new Date('invalid'),
    lastUpdatedAt: new Date('invalid'),
    protocolData: null
  } as any // Intentionally invalid for testing
};

// Portfolio summary fixtures
export const portfolioSummaryFixtures = {
  diversifiedPortfolio: {
    address: '0x1234567890123456789012345678901234567890',
    totalValueUSD: 50000,
    netValueUSD: 45000,
    totalSuppliedUSD: 50000,
    totalBorrowedUSD: 5000,
    totalRewardsUSD: 250,
    protocolDistribution: [
      { protocol: DeFiProtocol.AAVE_V3, valueUSD: 25000, percentage: 50, positionCount: 2 },
      { protocol: DeFiProtocol.UNISWAP_V3, valueUSD: 20000, percentage: 40, positionCount: 3 },
      { protocol: DeFiProtocol.CURVE, valueUSD: 5000, percentage: 10, positionCount: 1 }
    ],
    chainDistribution: [
      { chainId: ChainId.ETHEREUM, valueUSD: 35000, percentage: 70, positionCount: 4 },
      { chainId: ChainId.POLYGON, valueUSD: 10000, percentage: 20, positionCount: 1 },
      { chainId: ChainId.ARBITRUM, valueUSD: 5000, percentage: 10, positionCount: 1 }
    ],
    typeDistribution: [
      { type: PositionType.LENDING, valueUSD: 25000, percentage: 50, positionCount: 2 },
      { type: PositionType.LIQUIDITY_POOL, valueUSD: 20000, percentage: 40, positionCount: 3 },
      { type: PositionType.STAKING, valueUSD: 5000, percentage: 10, positionCount: 1 }
    ],
    riskSummary: {
      overallRisk: RiskLevel.LOW,
      positionsAtRisk: 0,
      totalCollateralUSD: 30000,
      averageHealthFactor: 2.5,
      liquidationThreshold: 0.4
    },
    yieldSummary: {
      totalYieldUSD24h: 25.5,
      totalYieldUSDLifetime: 9307.5,
      averageAPY: 8.2,
      bestPerformingPosition: 'uniswap-v3:1:123456',
      worstPerformingPosition: 'aave-v3:1:0x123:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
    },
    positions: [
      aaveV3LendingPositions.healthyPosition,
      uniswapV3LiquidityPositions.activePosition
    ],
    lastUpdated: new Date('2024-01-01T12:00:00Z')
  }
};

export const testAddresses = {
  whale: '0x8ba1f109551bd432803012645hac136c',
  retail: '0x742d35cc6831d168117b9cee0b72f9dc',
  empty: '0x0000000000000000000000000000000000000000',
  invalid: 'not-an-address',
  contract: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
};