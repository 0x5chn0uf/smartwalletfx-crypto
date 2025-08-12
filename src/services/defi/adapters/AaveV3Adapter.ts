import axios from 'axios';
import { ethers } from 'ethers';
import { logger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { ChainId } from '@/types/blockchain';
import {
  DeFiProtocol,
  DeFiPosition,
  LendingPosition,
  ProtocolAdapter,
  ProtocolHealth,
  ProtocolMetadata,
  PositionType,
  PositionStatus,
  RiskLevel,
  DeFiToken,
  YieldInfo,
  RiskMetrics,
} from '@/types/defi';

// Aave V3 contract addresses by chain
const AAVE_V3_ADDRESSES: Record<ChainId, {
  poolDataProvider: string;
  pool: string;
  priceOracle: string;
  subgraphUrl: string;
}> = {
  [ChainId.ETHEREUM]: {
    poolDataProvider: '0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3',
    pool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    priceOracle: '0x54586bE62E3c3580375aE3723C145253060Ca0C2',
    subgraphUrl: 'https://api.thegraph.com/subgraphs/name/aave/protocol-v3',
  },
  [ChainId.POLYGON]: {
    poolDataProvider: '0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654',
    pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    priceOracle: '0xb023e699F5a33916Ea823A16485e259257cA8Bd1',
    subgraphUrl: 'https://api.thegraph.com/subgraphs/name/aave/protocol-v3-polygon',
  },
  [ChainId.ARBITRUM]: {
    poolDataProvider: '0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654',
    pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    priceOracle: '0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C7',
    subgraphUrl: 'https://api.thegraph.com/subgraphs/name/aave/protocol-v3-arbitrum',
  },
  [ChainId.OPTIMISM]: {
    poolDataProvider: '0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654',
    pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    priceOracle: '0xD81eb3728a631871a7eBBaD631b5f424909f0c77',
    subgraphUrl: 'https://api.thegraph.com/subgraphs/name/aave/protocol-v3-optimism',
  },
};

// Aave Pool Data Provider ABI (simplified)
const POOL_DATA_PROVIDER_ABI = [
  'function getUserReservesData(address user) external view returns (tuple(address underlyingAsset, uint256 scaledATokenBalance, bool usageAsCollateralEnabled, uint256 scaledVariableDebt, uint256 scaledStableDebt, uint256 principalStableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool stableBorrowRateEnabled)[])',
  'function getReservesData() external view returns (tuple(address underlyingAsset, string name, string symbol, uint256 decimals, uint256 baseLTVasCollateral, uint256 reserveLiquidationThreshold, uint256 reserveLiquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen, uint128 liquidityIndex, uint128 variableBorrowIndex, uint128 liquidityRate, uint128 variableBorrowRate, uint128 stableBorrowRate, uint40 lastUpdateTimestamp, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint8 aTokenDecimals, uint8 stableDebtTokenDecimals, uint8 variableDebtTokenDecimals)[])',
  'function getReserveConfigurationData(address asset) external view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)',
  'function getReserveTokensAddresses(address asset) external view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)',
];

// Pool ABI (simplified)
const POOL_ABI = [
  'function getUserAccountData(address user) external view returns (uint256 totalCollateralETH, uint256 totalDebtETH, uint256 availableBorrowsETH, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
];

interface AaveUserReserveData {
  underlyingAsset: string;
  scaledATokenBalance: bigint;
  usageAsCollateralEnabled: boolean;
  scaledVariableDebt: bigint;
  scaledStableDebt: bigint;
  principalStableDebt: bigint;
  stableBorrowRate: bigint;
  liquidityRate: bigint;
  stableRateLastUpdated: number;
  stableBorrowRateEnabled: boolean;
}

interface AaveReserveData {
  underlyingAsset: string;
  name: string;
  symbol: string;
  decimals: bigint;
  baseLTVasCollateral: bigint;
  reserveLiquidationThreshold: bigint;
  reserveLiquidationBonus: bigint;
  reserveFactor: bigint;
  usageAsCollateralEnabled: boolean;
  borrowingEnabled: boolean;
  stableBorrowRateEnabled: boolean;
  isActive: boolean;
  isFrozen: boolean;
  liquidityIndex: bigint;
  variableBorrowIndex: bigint;
  liquidityRate: bigint;
  variableBorrowRate: bigint;
  stableBorrowRate: bigint;
  lastUpdateTimestamp: number;
  aTokenAddress: string;
  stableDebtTokenAddress: string;
  variableDebtTokenAddress: string;
  interestRateStrategyAddress: string;
  aTokenDecimals: number;
  stableDebtTokenDecimals: number;
  variableDebtTokenDecimals: number;
}

interface AaveUserAccountData {
  totalCollateralETH: bigint;
  totalDebtETH: bigint;
  availableBorrowsETH: bigint;
  currentLiquidationThreshold: bigint;
  ltv: bigint;
  healthFactor: bigint;
}

export class AaveV3Adapter implements ProtocolAdapter {
  readonly protocol = DeFiProtocol.AAVE_V3;
  readonly supportedChains = [ChainId.ETHEREUM, ChainId.POLYGON, ChainId.ARBITRUM, ChainId.OPTIMISM];
  readonly version = '1.0.0';

  private health: ProtocolHealth = {
    isHealthy: true,
    lastCheckedAt: new Date(),
    responseTime: 0,
    errorRate: 0,
    uptime: 100,
    issues: [],
  };

  private providers: Map<ChainId, ethers.JsonRpcProvider> = new Map();

  constructor(private rpcUrls: Partial<Record<ChainId, string>>) {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    this.supportedChains.forEach(chainId => {
      const rpcUrl = this.rpcUrls[chainId];
      if (rpcUrl) {
        try {
          const provider = new ethers.JsonRpcProvider(rpcUrl);
          this.providers.set(chainId, provider);
          logger.info(`Aave V3 adapter initialized for ${chainId}`, { chainId, rpcUrl: rpcUrl.substring(0, 50) + '...' });
        } catch (error) {
          logger.error(`Failed to initialize Aave V3 provider for ${chainId}`, { error, chainId });
        }
      }
    });
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Test one provider to check health
      const testChain = ChainId.ETHEREUM;
      const provider = this.providers.get(testChain);
      
      if (!provider) {
        this.health.isHealthy = false;
        this.health.issues = ['No provider available for health check'];
        return false;
      }

      const startTime = Date.now();
      
      // Try to get the latest block number
      await provider.getBlockNumber();
      
      this.health.responseTime = Date.now() - startTime;
      this.health.isHealthy = true;
      this.health.issues = [];
      this.health.lastCheckedAt = new Date();
      
      return true;
    } catch (error) {
      this.health.isHealthy = false;
      this.health.issues = [error instanceof Error ? error.message : 'Unknown error'];
      this.health.lastCheckedAt = new Date();
      
      logger.warn('Aave V3 adapter health check failed', { error });
      return false;
    }
  }

  getHealth(): ProtocolHealth {
    return { ...this.health };
  }

  async getPositions(address: string, chainId?: ChainId): Promise<DeFiPosition[]> {
    const targetChains = chainId ? [chainId] : this.supportedChains;
    const positions: DeFiPosition[] = [];

    for (const chain of targetChains) {
      try {
        const chainPositions = await this.getPositionsForChain(address, chain);
        positions.push(...chainPositions);
      } catch (error) {
        logger.error(`Failed to get Aave V3 positions for chain ${chain}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          address,
          chainId: chain,
        });
      }
    }

    return positions;
  }

  async getPosition(positionId: string, chainId: ChainId): Promise<DeFiPosition | null> {
    // Position ID format: aave-v3:{chainId}:{address}:{asset}
    const [protocol, chain, userAddress, assetAddress] = positionId.split(':');
    
    if (protocol !== 'aave-v3' || chain !== chainId.toString()) {
      return null;
    }

    try {
      const positions = await this.getPositionsForChain(userAddress, chainId);
      return positions.find(pos => pos.id === positionId) || null;
    } catch (error) {
      logger.error(`Failed to get Aave V3 position ${positionId}`, { error });
      return null;
    }
  }

  getProtocolMetadata(): ProtocolMetadata {
    return {
      name: 'Aave V3',
      description: 'Aave is a decentralized non-custodial liquidity market protocol where users can participate as suppliers or borrowers.',
      website: 'https://aave.com',
      logoUrl: 'https://cryptologos.cc/logos/aave-aave-logo.png',
      supportedAssets: ['ETH', 'USDC', 'USDT', 'DAI', 'WBTC', 'LINK', 'MATIC', 'AVAX'],
      features: [
        'Variable and stable interest rates',
        'Collateral management',
        'Flash loans',
        'Rate switching',
        'aTokens (interest-bearing tokens)',
        'Liquidation protection',
      ],
    };
  }

  private async getPositionsForChain(address: string, chainId: ChainId): Promise<DeFiPosition[]> {
    const provider = this.providers.get(chainId);
    const contractAddresses = AAVE_V3_ADDRESSES[chainId];

    if (!provider || !contractAddresses) {
      logger.warn(`No provider or contract addresses for Aave V3 on chain ${chainId}`);
      return [];
    }

    const cacheKey = `aave-v3-positions:${chainId}:${address}`;
    const cached = await redisManager.get<DeFiPosition[]>(cacheKey);
    
    if (cached) {
      logger.debug(`Aave V3 positions cache hit for ${address} on ${chainId}`);
      return cached;
    }

    try {
      // Get contracts
      const poolDataProvider = new ethers.Contract(
        contractAddresses.poolDataProvider,
        POOL_DATA_PROVIDER_ABI,
        provider
      );

      const pool = new ethers.Contract(
        contractAddresses.pool,
        POOL_ABI,
        provider
      );

      // Get user data
      const [userReservesData, userAccountData, reservesData] = await Promise.all([
        poolDataProvider.getUserReservesData(address) as Promise<AaveUserReserveData[]>,
        pool.getUserAccountData(address) as Promise<AaveUserAccountData>,
        poolDataProvider.getReservesData() as Promise<AaveReserveData[]>,
      ]);

      // Create a map of reserve data for quick lookup
      const reserveMap = new Map<string, AaveReserveData>();
      reservesData.forEach(reserve => {
        reserveMap.set(reserve.underlyingAsset.toLowerCase(), reserve);
      });

      const positions: DeFiPosition[] = [];

      // Process each user reserve
      for (const userReserve of userReservesData) {
        const reserveData = reserveMap.get(userReserve.underlyingAsset.toLowerCase());
        if (!reserveData) continue;

        // Check if user has any position in this reserve
        const hasSupply = userReserve.scaledATokenBalance > 0n;
        const hasBorrow = userReserve.scaledVariableDebt > 0n || userReserve.scaledStableDebt > 0n;

        if (!hasSupply && !hasBorrow) continue;

        // Calculate actual balances
        const supplyBalance = this.calculateBalance(
          userReserve.scaledATokenBalance,
          reserveData.liquidityIndex,
          Number(reserveData.decimals)
        );

        const variableDebtBalance = this.calculateBalance(
          userReserve.scaledVariableDebt,
          reserveData.variableBorrowIndex,
          Number(reserveData.decimals)
        );

        const stableDebtBalance = this.calculateBalance(
          userReserve.principalStableDebt,
          BigInt(1e27), // Stable debt doesn't use index
          Number(reserveData.decimals)
        );

        // Get token prices (simplified - in production, integrate with price feeds)
        const tokenPriceUSD = await this.getTokenPrice(userReserve.underlyingAsset, chainId);

        // Create DeFi token
        const defiToken: DeFiToken = {
          address: userReserve.underlyingAsset,
          chainId,
          symbol: reserveData.symbol,
          name: reserveData.name,
          decimals: Number(reserveData.decimals),
          priceUSD: tokenPriceUSD,
        };

        // Calculate position value
        const supplyValueUSD = supplyBalance * tokenPriceUSD;
        const borrowValueUSD = (variableDebtBalance + stableDebtBalance) * tokenPriceUSD;
        const netValueUSD = supplyValueUSD - borrowValueUSD;

        // Calculate yield info
        const yieldInfo: YieldInfo[] = [];
        
        if (hasSupply) {
          yieldInfo.push({
            apy: this.rayToPercentage(reserveData.liquidityRate),
            apr: this.rayToPercentage(reserveData.liquidityRate),
            source: 'lending',
            isCompounding: true,
            calculatedAt: new Date(),
          });
        }

        // Calculate risk metrics
        const healthFactor = userAccountData.healthFactor > 0n 
          ? Number(userAccountData.healthFactor) / 1e18 
          : undefined;

        const liquidationThreshold = Number(reserveData.reserveLiquidationThreshold) / 10000; // Convert from basis points

        const riskMetrics: RiskMetrics = {
          healthFactor,
          liquidationRisk: this.calculateLiquidationRisk(healthFactor),
          collateralRatio: userReserve.usageAsCollateralEnabled ? liquidationThreshold : undefined,
          utilizationRate: supplyBalance > 0 ? (variableDebtBalance + stableDebtBalance) / supplyBalance : 0,
        };

        // Create position
        const position: LendingPosition = {
          id: `aave-v3:${chainId}:${address}:${userReserve.underlyingAsset}`,
          protocol: DeFiProtocol.AAVE_V3,
          chainId,
          type: PositionType.LENDING,
          status: this.determinePositionStatus(supplyBalance, variableDebtBalance + stableDebtBalance, healthFactor),
          name: `Aave V3 ${reserveData.symbol} Position`,
          description: `Lending position in ${reserveData.symbol} on Aave V3`,
          url: `https://app.aave.com/reserve-overview/?underlyingAsset=${userReserve.underlyingAsset}&marketName=proto_mainnet_v3`,
          
          suppliedTokens: hasSupply ? [{
            token: defiToken,
            amount: userReserve.scaledATokenBalance.toString(),
            amountFormatted: supplyBalance.toFixed(6),
            valueUSD: supplyValueUSD,
          }] : [],
          
          borrowedTokens: (hasBorrow) ? [{
            token: defiToken,
            amount: (userReserve.scaledVariableDebt + userReserve.scaledStableDebt).toString(),
            amountFormatted: (variableDebtBalance + stableDebtBalance).toFixed(6),
            valueUSD: borrowValueUSD,
          }] : undefined,

          collateralTokens: userReserve.usageAsCollateralEnabled && hasSupply ? [{
            token: defiToken,
            amount: userReserve.scaledATokenBalance.toString(),
            amountFormatted: supplyBalance.toFixed(6),
            valueUSD: supplyValueUSD,
            isCollateral: true,
          }] : [],

          borrowingPower: {
            totalBorrowingPowerUSD: Number(userAccountData.totalCollateralETH) / 1e18 * tokenPriceUSD,
            usedBorrowingPowerUSD: Number(userAccountData.totalDebtETH) / 1e18 * tokenPriceUSD,
            availableBorrowingPowerUSD: Number(userAccountData.availableBorrowsETH) / 1e18 * tokenPriceUSD,
          },

          totalValueUSD: Math.max(supplyValueUSD, borrowValueUSD),
          netValueUSD,
          yieldInfo: yieldInfo.length > 0 ? yieldInfo : undefined,
          riskMetrics,
          
          createdAt: new Date(), // In production, track actual creation time
          lastUpdatedAt: new Date(),
          
          protocolData: {
            aTokenAddress: reserveData.aTokenAddress,
            variableDebtTokenAddress: reserveData.variableDebtTokenAddress,
            stableDebtTokenAddress: reserveData.stableDebtTokenAddress,
            liquidityIndex: reserveData.liquidityIndex.toString(),
            variableBorrowIndex: reserveData.variableBorrowIndex.toString(),
            usageAsCollateralEnabled: userReserve.usageAsCollateralEnabled,
            stableBorrowRateEnabled: userReserve.stableBorrowRateEnabled,
          },
        };

        positions.push(position);
      }

      // Cache the results
      await redisManager.set(cacheKey, positions, 300); // 5 minutes cache

      logger.info(`Fetched ${positions.length} Aave V3 positions for ${address} on ${chainId}`);
      return positions;

    } catch (error) {
      logger.error(`Failed to fetch Aave V3 positions for ${address} on ${chainId}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  private calculateBalance(scaledBalance: bigint, index: bigint, decimals: number): number {
    if (scaledBalance === 0n) return 0;
    
    // Ray math: scaled balance * index / 1e27
    const balance = (scaledBalance * index) / BigInt(1e27);
    return Number(balance) / Math.pow(10, decimals);
  }

  private rayToPercentage(rayValue: bigint): number {
    // Convert from RAY (1e27) to percentage
    return (Number(rayValue) / 1e27) * 100;
  }

  private calculateLiquidationRisk(healthFactor?: number): RiskLevel {
    if (!healthFactor) return RiskLevel.LOW;
    
    if (healthFactor < 1.1) return RiskLevel.CRITICAL;
    if (healthFactor < 1.3) return RiskLevel.HIGH;
    if (healthFactor < 1.5) return RiskLevel.MEDIUM;
    return RiskLevel.LOW;
  }

  private determinePositionStatus(
    supplyBalance: number, 
    borrowBalance: number, 
    healthFactor?: number
  ): PositionStatus {
    if (supplyBalance === 0 && borrowBalance === 0) return PositionStatus.CLOSED;
    if (healthFactor && healthFactor < 1.0) return PositionStatus.LIQUIDATED;
    if (healthFactor && healthFactor < 1.1) return PositionStatus.AT_RISK;
    if (supplyBalance > 0 || borrowBalance > 0) return PositionStatus.ACTIVE;
    return PositionStatus.INACTIVE;
  }

  private async getTokenPrice(tokenAddress: string, chainId: ChainId): Promise<number> {
    try {
      // This is a simplified price fetch - in production, integrate with price oracles
      // For now, return mock prices
      const mockPrices: Record<string, number> = {
        '0xa0b86a33e6ba72a35c3ca96c2f0b96ff6fcf7b13': 2000, // ETH (placeholder)
        '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 45000, // WBTC (placeholder)
        '0xa0b86a33e6ba72a35c3ca96c2f0b96ff6fcf7b13': 1, // USDC (placeholder)
      };
      
      return mockPrices[tokenAddress.toLowerCase()] || 1;
    } catch (error) {
      logger.warn(`Failed to get price for token ${tokenAddress}`, { error });
      return 1; // Fallback price
    }
  }
}

// Factory function
export const createAaveV3Adapter = (rpcUrls: Partial<Record<ChainId, string>>): AaveV3Adapter => {
  return new AaveV3Adapter(rpcUrls);
};