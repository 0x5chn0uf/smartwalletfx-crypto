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
const UNISWAP_V3_ADDRESSES: Partial<Record<ChainId, {
  positionManager: string;
  factory: string;
  quoter: string;
  subgraphUrl: string;
}>> = {
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

      // Get pool data with timeout
      const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Pool data fetch timeout')), 15000)
      );

      const [slot0, poolLiquidity] = await Promise.race([
        Promise.all([
          pool.slot0(),
          pool.liquidity()
        ]),
        timeoutPromise
      ]) as [any, bigint];

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

      // Calculate position value with safety checks
      const token0ValueUSD = Number.isFinite(amount0 * token0Price) ? amount0 * token0Price : 0;
      const token1ValueUSD = Number.isFinite(amount1 * token1Price) ? amount1 * token1Price : 0;
      const totalValueUSD = token0ValueUSD + token1ValueUSD;
      
      // Skip dust positions
      if (totalValueUSD < 0.01) {
        return null;
      }

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
    if (position.liquidity === 0n) {
      return { amount0: 0, amount1: 0 };
    }

    try {
      // More accurate calculation using Uniswap V3 math
      const currentTick = pool.tick;
      const currentSqrtPrice = pool.sqrtPriceX96;
      
      // Calculate sqrt prices at tick bounds
      const sqrtPriceLower = this.tickToSqrtPrice(position.tickLower);
      const sqrtPriceUpper = this.tickToSqrtPrice(position.tickUpper);
      
      const liquidity = Number(position.liquidity);
      
      let amount0 = 0;
      let amount1 = 0;
      
      if (currentTick < position.tickLower) {
        // Position is entirely in token0
        amount0 = this.getAmount0Delta(sqrtPriceLower, sqrtPriceUpper, liquidity);
      } else if (currentTick >= position.tickUpper) {
        // Position is entirely in token1
        amount1 = this.getAmount1Delta(sqrtPriceLower, sqrtPriceUpper, liquidity);
      } else {
        // Position is in range
        const currentSqrtPriceNumber = Number(currentSqrtPrice) / (2 ** 96);
        amount0 = this.getAmount0Delta(currentSqrtPriceNumber, sqrtPriceUpper, liquidity);
        amount1 = this.getAmount1Delta(sqrtPriceLower, currentSqrtPriceNumber, liquidity);
      }
      
      return { 
        amount0: Math.max(0, amount0), 
        amount1: Math.max(0, amount1) 
      };
    } catch (error) {
      logger.warn('Error calculating Uniswap V3 position amounts, using fallback', { 
        error,
        positionLiquidity: position.liquidity.toString(),
        currentTick: pool.tick
      });
      
      // Fallback to simple calculation
      const totalLiquidity = Number(position.liquidity) / 1e18;
      return { 
        amount0: totalLiquidity * 0.5, 
        amount1: totalLiquidity * 0.5 
      };
    }
  }

  private tickToSqrtPrice(tick: number): number {
    // Convert tick to sqrt price using Uniswap V3 formula
    return Math.pow(1.0001, tick / 2);
  }

  private getAmount0Delta(sqrtPriceA: number, sqrtPriceB: number, liquidity: number): number {
    if (sqrtPriceA > sqrtPriceB) {
      [sqrtPriceA, sqrtPriceB] = [sqrtPriceB, sqrtPriceA];
    }
    return liquidity * (sqrtPriceB - sqrtPriceA) / (sqrtPriceA * sqrtPriceB);
  }

  private getAmount1Delta(sqrtPriceA: number, sqrtPriceB: number, liquidity: number): number {
    if (sqrtPriceA > sqrtPriceB) {
      [sqrtPriceA, sqrtPriceB] = [sqrtPriceB, sqrtPriceA];
    }
    return liquidity * (sqrtPriceB - sqrtPriceA);
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
    try {
      // More sophisticated IL calculation
      const currentTick = pool.tick;
      const { priceRange } = this.calculatePriceRange(position, pool, 18, 18);
      
      // Calculate price deviation from range midpoint
      const currentPrice = Math.pow(1.0001, currentTick);
      const midRangePrice = Math.sqrt(priceRange.min * priceRange.max);
      const priceRatio = currentPrice / midRangePrice;
      
      // Estimate IL based on price deviation
      // This is still simplified - real IL requires entry price vs current price
      if (priceRatio >= 0.9 && priceRatio <= 1.1) {
        return 0; // Minimal IL when close to range center
      } else if (priceRatio >= 0.8 && priceRatio <= 1.25) {
        return 0.02; // 2% IL for moderate deviation
      } else if (priceRatio >= 0.7 && priceRatio <= 1.43) {
        return 0.05; // 5% IL for larger deviation
      } else {
        return 0.1; // 10% IL for extreme deviation
      }
    } catch (error) {
      logger.warn('Error calculating impermanent loss', { error });
      return 0.02; // Default 2% IL estimate
    }
  }

  private estimateAPY(feePercentage: number, liquidityValueUSD: number): number {
    try {
      // More sophisticated APY estimation
      // Base APY varies by fee tier and market conditions
      let baseMultiplier = 5; // Conservative base
      
      if (feePercentage === 0.01) { // 0.01% fee tier (stablecoins)
        baseMultiplier = 2;
      } else if (feePercentage === 0.05) { // 0.05% fee tier (majors)
        baseMultiplier = 8;
      } else if (feePercentage === 0.3) { // 0.3% fee tier (standard)
        baseMultiplier = 12;
      } else if (feePercentage === 1.0) { // 1% fee tier (exotic)
        baseMultiplier = 20;
      }
      
      // Base APY from fees
      const baseAPY = feePercentage * baseMultiplier;
      
      // Liquidity concentration factor (smaller positions get better rates)
      const sizeAdjustment = liquidityValueUSD < 10000 
        ? 1.5 // Boost for smaller positions
        : liquidityValueUSD < 100000 
        ? 1.2 
        : 1.0; // Larger positions have lower effective rates
      
      const estimatedAPY = baseAPY * sizeAdjustment;
      
      // Cap at reasonable bounds
      return Math.min(Math.max(estimatedAPY, 0.1), 100);
    } catch (error) {
      logger.warn('Error estimating APY', { error, feePercentage, liquidityValueUSD });
      return 5; // Conservative fallback
    }
  }

  private async getTokenPrice(tokenAddress: string, chainId: ChainId): Promise<number> {
    try {
      // Try cache first
      const cacheKey = `token-price:${chainId}:${tokenAddress.toLowerCase()}`;
      const cached = await redisManager.get<number>(cacheKey);
      
      if (cached) {
        return cached;
      }

      // Enhanced token prices by chain
      const tokenPrices: Record<string, Record<string, number>> = {
        [ChainId.ETHEREUM]: {
          '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 2000, // WETH
          '0xa0b86a33e6441b8435b6ba10d7c6f8c7e7eaee5a': 1, // USDC
          '0xdac17f958d2ee523a2206206994597c13d831ec7': 1, // USDT
          '0x6b175474e89094c44da98b954eedeac495271d0f': 1, // DAI
          '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 45000, // WBTC
          '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 8, // UNI
          '0x514910771af9ca656af840dff83e8264ecf986ca': 15, // LINK
        },
        [ChainId.POLYGON]: {
          '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': 2000, // WETH
          '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 1, // USDC
          '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 1, // USDT
          '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': 0.8, // WMATIC
        },
        [ChainId.ARBITRUM]: {
          '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 2000, // WETH
          '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8': 1, // USDC
          '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 1, // USDT
          '0x912ce59144191c1204e64559fe8253a0e49e6548': 1.2, // ARB
          '0xfa7f8980b0f1e64a2062791cc3b0871572f1f7f0': 8, // UNI
        },
        [ChainId.OPTIMISM]: {
          '0x4200000000000000000000000000000000000006': 2000, // WETH
          '0x7f5c764cbc14f9669b88837ca1490cca17c31607': 1, // USDC
          '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': 1, // USDT
          '0x4200000000000000000000000000000000000042': 1.8, // OP
          '0x6fd9d7ad17242c41f7131d257212c54a0e816691': 8, // UNI
        },
        [ChainId.BASE]: {
          '0x4200000000000000000000000000000000000006': 2000, // WETH
          '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 1, // USDbC
        }
      };
      
      const chainPrices = tokenPrices[chainId] || {};
      const price = chainPrices[tokenAddress.toLowerCase()] || 1;
      
      // Cache for 1 minute
      await redisManager.set(cacheKey, price, 60);
      
      return price;
    } catch (error) {
      logger.warn(`Failed to get price for token ${tokenAddress}`, { error, chainId });
      return 1;
    }
  }
}

// Factory function
export const createUniswapV3Adapter = (rpcUrls: Partial<Record<ChainId, string>>): UniswapV3Adapter => {
  return new UniswapV3Adapter(rpcUrls);
};