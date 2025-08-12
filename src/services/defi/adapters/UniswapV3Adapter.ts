import axios from 'axios';
import { ethers } from 'ethers';
import { logger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { ChainId } from '@/types/blockchain';
import {
  DeFiProtocol,
  DeFiPosition,
  LiquidityPosition,
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

// Uniswap V3 contract addresses by chain
const UNISWAP_V3_ADDRESSES: Record<ChainId, {
  positionManager: string;
  factory: string;
  quoter: string;
  subgraphUrl: string;
}> = {
  [ChainId.ETHEREUM]: {
    positionManager: '0xC36442b4E4502b459DC5a9c5dE2d6aCB1c2e93C0',
    factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
    subgraphUrl: 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3',
  },
  [ChainId.POLYGON]: {
    positionManager: '0xC36442b4E4502b459DC5a9c5dE2d6aCB1c2e93C0',
    factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
    subgraphUrl: 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3-polygon',
  },
  [ChainId.ARBITRUM]: {
    positionManager: '0xC36442b4E4502b459DC5a9c5dE2d6aCB1c2e93C0',
    factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
    subgraphUrl: 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3-arbitrum',
  },
  [ChainId.OPTIMISM]: {
    positionManager: '0xC36442b4E4502b459DC5a9c5dE2d6aCB1c2e93C0',
    factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
    subgraphUrl: 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3-optimism',
  },
  [ChainId.BASE]: {
    positionManager: '0x03a520b32C04BF3bEEf7BF8eFe7BA8c1C4d6C8B9',
    factory: '0x33128a8fC17869897dcE68Ed026d694621f6FD8',
    quoter: '0x3d4e44EB1374240CE5F1B871ab261CD1649Ba7',
    subgraphUrl: 'https://api.studio.thegraph.com/query/5713/uniswap-v3-base/version/latest',
  },
};

// Position Manager ABI (simplified)
const POSITION_MANAGER_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)',
  'function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
];

// Factory ABI (simplified)
const FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

// Pool ABI (simplified)
const POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint24)',
  'function tickSpacing() external view returns (int24)',
];

// ERC20 ABI (simplified)
const ERC20_ABI = [
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function decimals() external view returns (uint8)',
];

interface UniswapPosition {
  nonce: bigint;
  operator: string;
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  feeGrowthInside0LastX128: bigint;
  feeGrowthInside1LastX128: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
}

interface PoolData {
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  token0: string;
  token1: string;
  fee: number;
}

interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
}

export class UniswapV3Adapter implements ProtocolAdapter {
  readonly protocol = DeFiProtocol.UNISWAP_V3;
  readonly supportedChains = [ChainId.ETHEREUM, ChainId.POLYGON, ChainId.ARBITRUM, ChainId.OPTIMISM, ChainId.BASE];
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
          logger.info(`Uniswap V3 adapter initialized for ${chainId}`, { chainId });
        } catch (error) {
          logger.error(`Failed to initialize Uniswap V3 provider for ${chainId}`, { error, chainId });
        }
      }
    });
  }

  async isHealthy(): Promise<boolean> {
    try {
      const testChain = ChainId.ETHEREUM;
      const provider = this.providers.get(testChain);
      
      if (!provider) {
        this.health.isHealthy = false;
        this.health.issues = ['No provider available for health check'];
        return false;
      }

      const startTime = Date.now();
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
      
      logger.warn('Uniswap V3 adapter health check failed', { error });
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
        logger.error(`Failed to get Uniswap V3 positions for chain ${chain}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          address,
          chainId: chain,
        });
      }
    }

    return positions;
  }

  async getPosition(positionId: string, chainId: ChainId): Promise<DeFiPosition | null> {
    // Position ID format: uniswap-v3:{chainId}:{tokenId}
    const [protocol, chain, tokenId] = positionId.split(':');
    
    if (protocol !== 'uniswap-v3' || chain !== chainId.toString()) {
      return null;
    }

    try {
      const positions = await this.getPositionByTokenId(parseInt(tokenId), chainId);
      return positions;
    } catch (error) {
      logger.error(`Failed to get Uniswap V3 position ${positionId}`, { error });
      return null;
    }
  }

  getProtocolMetadata(): ProtocolMetadata {
    return {
      name: 'Uniswap V3',
      description: 'Uniswap V3 is a decentralized protocol for automated token exchanges on Ethereum with concentrated liquidity.',
      website: 'https://uniswap.org',
      logoUrl: 'https://cryptologos.cc/logos/uniswap-uni-logo.png',
      supportedAssets: ['ETH', 'USDC', 'USDT', 'DAI', 'WBTC', 'LINK', 'UNI'],
      features: [
        'Concentrated liquidity',
        'Multiple fee tiers',
        'Range orders',
        'Capital efficiency',
        'Non-fungible liquidity positions',
        'Flexible fee structure',
      ],
    };
  }

  private async getPositionsForChain(address: string, chainId: ChainId): Promise<DeFiPosition[]> {
    const provider = this.providers.get(chainId);
    const contractAddresses = UNISWAP_V3_ADDRESSES[chainId];

    if (!provider || !contractAddresses) {
      logger.warn(`No provider or contract addresses for Uniswap V3 on chain ${chainId}`);
      return [];
    }

    const cacheKey = `uniswap-v3-positions:${chainId}:${address}`;
    const cached = await redisManager.get<DeFiPosition[]>(cacheKey);
    
    if (cached) {
      logger.debug(`Uniswap V3 positions cache hit for ${address} on ${chainId}`);
      return cached;
    }

    try {
      const positionManager = new ethers.Contract(
        contractAddresses.positionManager,
        POSITION_MANAGER_ABI,
        provider
      );

      // Get number of positions owned by the address
      const balance = await positionManager.balanceOf(address) as bigint;
      const balanceNumber = Number(balance);

      if (balanceNumber === 0) {
        return [];
      }

      const positions: DeFiPosition[] = [];

      // Get all token IDs owned by the address
      for (let i = 0; i < balanceNumber; i++) {
        try {
          const tokenId = await positionManager.tokenOfOwnerByIndex(address, i) as bigint;
          const position = await this.getPositionByTokenId(Number(tokenId), chainId);
          
          if (position) {
            positions.push(position);
          }
        } catch (error) {
          logger.warn(`Failed to get position at index ${i} for ${address}`, { error });
        }
      }

      // Cache the results
      await redisManager.set(cacheKey, positions, 300); // 5 minutes cache

      logger.info(`Fetched ${positions.length} Uniswap V3 positions for ${address} on ${chainId}`);
      return positions;

    } catch (error) {
      logger.error(`Failed to fetch Uniswap V3 positions for ${address} on ${chainId}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  private async getPositionByTokenId(tokenId: number, chainId: ChainId): Promise<DeFiPosition | null> {
    const provider = this.providers.get(chainId);
    const contractAddresses = UNISWAP_V3_ADDRESSES[chainId];

    if (!provider || !contractAddresses) {
      return null;
    }

    try {
      const positionManager = new ethers.Contract(
        contractAddresses.positionManager,
        POSITION_MANAGER_ABI,
        provider
      );

      const factory = new ethers.Contract(
        contractAddresses.factory,
        FACTORY_ABI,
        provider
      );

      // Get position data
      const positionData = await positionManager.positions(tokenId) as UniswapPosition;

      // Skip if no liquidity
      if (positionData.liquidity === 0n) {
        return null;
      }

      // Get pool address
      const poolAddress = await factory.getPool(
        positionData.token0,
        positionData.token1,
        positionData.fee
      ) as string;

      if (poolAddress === ethers.ZeroAddress) {
        return null;
      }

      // Get pool data
      const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
      const slot0 = await pool.slot0();
      const poolLiquidity = await pool.liquidity();

      const poolData: PoolData = {
        sqrtPriceX96: slot0[0],
        tick: slot0[1],
        liquidity: poolLiquidity,
        token0: positionData.token0,
        token1: positionData.token1,
        fee: positionData.fee,
      };

      // Get token information
      const [token0Info, token1Info] = await Promise.all([
        this.getTokenInfo(positionData.token0, provider),
        this.getTokenInfo(positionData.token1, provider),
      ]);

      // Calculate position amounts
      const { amount0, amount1 } = this.calculatePositionAmounts(positionData, poolData);

      // Get token prices (simplified)
      const [token0Price, token1Price] = await Promise.all([
        this.getTokenPrice(positionData.token0, chainId),
        this.getTokenPrice(positionData.token1, chainId),
      ]);

      // Create DeFi tokens
      const defiToken0: DeFiToken = {
        address: positionData.token0,
        chainId,
        symbol: token0Info.symbol,
        name: token0Info.name,
        decimals: token0Info.decimals,
        priceUSD: token0Price,
      };

      const defiToken1: DeFiToken = {
        address: positionData.token1,
        chainId,
        symbol: token1Info.symbol,
        name: token1Info.name,
        decimals: token1Info.decimals,
        priceUSD: token1Price,
      };

      // Calculate position value
      const token0ValueUSD = amount0 * token0Price;
      const token1ValueUSD = amount1 * token1Price;
      const totalValueUSD = token0ValueUSD + token1ValueUSD;

      // Calculate fees
      const feesOwed0 = Number(positionData.tokensOwed0) / Math.pow(10, token0Info.decimals);
      const feesOwed1 = Number(positionData.tokensOwed1) / Math.pow(10, token1Info.decimals);
      const totalFeesUSD = (feesOwed0 * token0Price) + (feesOwed1 * token1Price);

      // Calculate APY (simplified estimate)
      const poolFeePercentage = positionData.fee / 10000; // Convert from basis points
      const estimatedAPY = this.estimateAPY(poolFeePercentage, totalValueUSD);

      // Calculate risk metrics
      const { inRange, priceRange } = this.calculatePriceRange(positionData, poolData, token0Info.decimals, token1Info.decimals);
      const impermanentLoss = this.calculateImpermanentLoss(positionData, poolData);

      const riskMetrics: RiskMetrics = {
        liquidationRisk: inRange ? RiskLevel.LOW : RiskLevel.MEDIUM,
        impermanentLoss,
      };

      // Create yield info
      const yieldInfo: YieldInfo[] = [{
        apy: estimatedAPY,
        apr: estimatedAPY,
        source: 'fees',
        isCompounding: false,
        calculatedAt: new Date(),
      }];

      // Create position
      const position: LiquidityPosition = {
        id: `uniswap-v3:${chainId}:${tokenId}`,
        protocol: DeFiProtocol.UNISWAP_V3,
        chainId,
        type: PositionType.LIQUIDITY_POOL,
        status: inRange ? PositionStatus.ACTIVE : PositionStatus.INACTIVE,
        name: `${token0Info.symbol}/${token1Info.symbol} ${poolFeePercentage}%`,
        description: `Uniswap V3 liquidity position in ${token0Info.symbol}/${token1Info.symbol} pool`,
        url: `https://app.uniswap.org/#/pool/${tokenId}`,

        suppliedTokens: [
          {
            token: defiToken0,
            amount: positionData.liquidity.toString(),
            amountFormatted: amount0.toFixed(6),
            valueUSD: token0ValueUSD,
          },
          {
            token: defiToken1,
            amount: positionData.liquidity.toString(),
            amountFormatted: amount1.toFixed(6),
            valueUSD: token1ValueUSD,
          },
        ],

        poolInfo: {
          poolAddress,
          poolName: `${token0Info.symbol}/${token1Info.symbol}`,
          fee: poolFeePercentage,
          totalLiquidity: Number(poolData.liquidity),
        },

        lpTokens: {
          address: contractAddresses.positionManager,
          amount: tokenId.toString(),
          // Calculate share of pool (simplified)
          share: Number(positionData.liquidity) / Number(poolData.liquidity) * 100,
        },

        fees: {
          pendingFees: [
            {
              token: defiToken0,
              amount: positionData.tokensOwed0.toString(),
              valueUSD: feesOwed0 * token0Price,
            },
            {
              token: defiToken1,
              amount: positionData.tokensOwed1.toString(),
              valueUSD: feesOwed1 * token1Price,
            },
          ],
        },

        totalValueUSD,
        netValueUSD: totalValueUSD + totalFeesUSD,
        yieldInfo,
        riskMetrics,

        createdAt: new Date(),
        lastUpdatedAt: new Date(),

        protocolData: {
          tokenId,
          tickLower: positionData.tickLower,
          tickUpper: positionData.tickUpper,
          currentTick: poolData.tick,
          inRange,
          priceRange,
          feeGrowthInside0LastX128: positionData.feeGrowthInside0LastX128.toString(),
          feeGrowthInside1LastX128: positionData.feeGrowthInside1LastX128.toString(),
        },
      };

      return position;

    } catch (error) {
      logger.error(`Failed to get Uniswap V3 position for token ID ${tokenId}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        tokenId,
        chainId,
      });
      return null;
    }
  }

  private async getTokenInfo(tokenAddress: string, provider: ethers.JsonRpcProvider): Promise<TokenInfo> {
    try {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      
      const [symbol, name, decimals] = await Promise.all([
        token.symbol() as Promise<string>,
        token.name() as Promise<string>,
        token.decimals() as Promise<number>,
      ]);

      return { symbol, name, decimals };
    } catch (error) {
      logger.warn(`Failed to get token info for ${tokenAddress}`, { error });
      return { symbol: 'UNKNOWN', name: 'Unknown Token', decimals: 18 };
    }
  }

  private calculatePositionAmounts(position: UniswapPosition, pool: PoolData): { amount0: number; amount1: number } {
    // Simplified calculation - in production, use proper Uniswap V3 math libraries
    // This is a rough approximation
    
    if (position.liquidity === 0n) {
      return { amount0: 0, amount1: 0 };
    }

    // For simplicity, assume equal value distribution
    // In reality, this depends on current tick vs position ticks
    const totalLiquidity = Number(position.liquidity);
    
    // This is a simplified calculation - real implementation would need proper tick math
    const amount0 = totalLiquidity * 0.5; // Rough approximation
    const amount1 = totalLiquidity * 0.5; // Rough approximation

    return { amount0, amount1 };
  }

  private calculatePriceRange(
    position: UniswapPosition, 
    pool: PoolData, 
    token0Decimals: number, 
    token1Decimals: number
  ): { inRange: boolean; priceRange: { min: number; max: number } } {
    const currentTick = pool.tick;
    const inRange = currentTick >= position.tickLower && currentTick <= position.tickUpper;
    
    // Simplified price calculation - in production, use proper tick-to-price conversion
    const minPrice = Math.pow(1.0001, position.tickLower);
    const maxPrice = Math.pow(1.0001, position.tickUpper);

    return {
      inRange,
      priceRange: { min: minPrice, max: maxPrice },
    };
  }

  private calculateImpermanentLoss(position: UniswapPosition, pool: PoolData): number {
    // Simplified impermanent loss calculation
    // In production, this would require historical price data and more complex calculations
    
    const { inRange } = this.calculatePriceRange(position, pool, 18, 18);
    
    if (inRange) {
      return 0; // No IL when in range (simplified)
    } else {
      return 0.05; // 5% estimated IL when out of range (simplified)
    }
  }

  private estimateAPY(feePercentage: number, liquidityValueUSD: number): number {
    // Simplified APY estimation based on pool fee and liquidity
    // In production, this would use historical volume data
    
    // Base APY from fees (very rough estimate)
    const baseAPY = feePercentage * 10; // Multiplier based on typical volume
    
    // Adjust for liquidity concentration
    const liquidityAdjustment = Math.min(liquidityValueUSD / 1000000, 2); // Cap at 2x
    
    return Math.max(baseAPY * liquidityAdjustment, 0.1); // Minimum 0.1% APY
  }

  private async getTokenPrice(tokenAddress: string, chainId: ChainId): Promise<number> {
    try {
      // Simplified price fetch - in production, integrate with price oracles
      const mockPrices: Record<string, number> = {
        '0xa0b86a33e6ba72a35c3ca96c2f0b96ff6fcf7b13': 2000, // ETH
        '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 45000, // WBTC
        '0xa0b86a33e6ba72a35c3ca96c2f0b96ff6fcf7b13': 1, // USDC
        '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 8, // UNI
      };
      
      return mockPrices[tokenAddress.toLowerCase()] || 1;
    } catch (error) {
      logger.warn(`Failed to get price for token ${tokenAddress}`, { error });
      return 1;
    }
  }
}

// Factory function
export const createUniswapV3Adapter = (rpcUrls: Partial<Record<ChainId, string>>): UniswapV3Adapter => {
  return new UniswapV3Adapter(rpcUrls);
};