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
  RewardToken,
} from '@/types/defi';

// Compound V3 contract addresses by chain
const COMPOUND_V3_ADDRESSES: Record<ChainId, {
  markets: Record<string, {
    comet: string;
    baseToken: string;
    name: string;
  }>;
  cometRewards: string;
  subgraphUrl: string;
}> = {
  [ChainId.ETHEREUM]: {
    markets: {
      'USDC': {
        comet: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
        baseToken: '0xA0b86a33E6441b8435b6BA10d7c6f8c7E7eaEE5a',
        name: 'Compound USDC',
      },
      'WETH': {
        comet: '0xA17581A9E3356d9A858b789D68B4d866e593aE94',
        baseToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        name: 'Compound WETH',
      },
    },
    cometRewards: '0x1B0e765F6224C21223AeA2af16c1C46E38885a40',
    subgraphUrl: 'https://api.thegraph.com/subgraphs/name/compound-finance/compound-v3',
  },
  [ChainId.POLYGON]: {
    markets: {
      'USDC': {
        comet: '0xF25212E676D1F7F89Cd72fFEe66158f541246445',
        baseToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        name: 'Compound USDC',
      },
      'USDT': {
        comet: '0xaeB318360f27748Acb200CE616E389A6C9409a07',
        baseToken: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        name: 'Compound USDT',
      },
    },
    cometRewards: '0x45939657d1CA34A8FA39A924B71D28Fe8431e581',
    subgraphUrl: 'https://api.thegraph.com/subgraphs/name/compound-finance/compound-v3-polygon',
  },
  [ChainId.ARBITRUM]: {
    markets: {
      'USDC': {
        comet: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA',
        baseToken: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
        name: 'Compound USDC',
      },
      'USDT': {
        comet: '0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07',
        baseToken: '0xFd086bC7CD5C481DCC9C85ebE478a1C0b69FCbb9',
        name: 'Compound USDT',
      },
    },
    cometRewards: '0x88730d254A2f7e6AC8388c3198aFd694bA9f7fae',
    subgraphUrl: 'https://api.thegraph.com/subgraphs/name/compound-finance/compound-v3-arbitrum',
  },
};

// Comet (Compound V3) ABI - simplified for key functions
const COMET_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function borrowBalanceOf(address account) external view returns (uint256)',
  'function collateralBalanceOf(address account, address asset) external view returns (uint128)',
  'function baseToken() external view returns (address)',
  'function baseScale() external view returns (uint256)',
  'function baseMinForRewards() external view returns (uint256)',
  'function baseTrackingSupplySpeed() external view returns (uint256)',
  'function baseTrackingBorrowSpeed() external view returns (uint256)',
  'function getAssetInfo(uint8 i) external view returns (tuple(uint8 offset, address asset, address priceFeed, uint128 scale, uint128 borrowCollateralFactor, uint128 liquidateCollateralFactor, uint128 liquidationFactor, uint128 supplyCap))',
  'function getAssetInfoByAddress(address asset) external view returns (tuple(uint8 offset, address asset, address priceFeed, uint128 scale, uint128 borrowCollateralFactor, uint128 liquidateCollateralFactor, uint128 liquidationFactor, uint128 supplyCap))',
  'function numAssets() external view returns (uint8)',
  'function getSupplyRate(uint256 utilization) external view returns (uint64)',
  'function getBorrowRate(uint256 utilization) external view returns (uint64)',
  'function getUtilization() external view returns (uint256)',
  'function getPrice(address priceFeed) external view returns (uint256)',
  'function isLiquidatable(address account) external view returns (bool)',
  'function liquidationThreshold(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function totalSupply() external view returns (uint256)',
  'function totalBorrow() external view returns (uint256)',
];

// CometRewards ABI - for COMP token rewards
const COMET_REWARDS_ABI = [
  'function getRewardOwed(address comet, address account) external returns (tuple(address token, uint256 owed))',
  'function rewardsClaimed(address comet, address account) external view returns (uint256)',
  'function rewardConfig(address comet) external view returns (tuple(address token, uint64 rescaleFactor, bool shouldUpscale))',
];

// ERC20 ABI for token information
const ERC20_ABI = [
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function decimals() external view returns (uint8)',
];

// Compound V3 types
interface CometAssetInfo {
  offset: number;
  asset: string;
  priceFeed: string;
  scale: bigint;
  borrowCollateralFactor: bigint;
  liquidateCollateralFactor: bigint;
  liquidationFactor: bigint;
  supplyCap: bigint;
}

interface CometAccountSnapshot {
  baseBalance: bigint; // Positive = supplied, Negative = borrowed
  borrowBalance: bigint;
  collateralBalances: Array<{
    asset: string;
    balance: bigint;
    info: CometAssetInfo;
  }>;
  isLiquidatable: boolean;
  liquidationThreshold: bigint;
}

interface CometMarketData {
  comet: string;
  baseToken: string;
  name: string;
  baseSymbol: string;
  baseName: string;
  baseDecimals: number;
  baseScale: bigint;
  supplyRate: bigint;
  borrowRate: bigint;
  utilization: bigint;
  totalSupply: bigint;
  totalBorrow: bigint;
  assets: CometAssetInfo[];
  baseMinForRewards: bigint;
  baseTrackingSupplySpeed: bigint;
  baseTrackingBorrowSpeed: bigint;
}

interface CometRewardInfo {
  token: string;
  owed: bigint;
  claimed: bigint;
  rescaleFactor: bigint;
  shouldUpscale: boolean;
}

interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
}

export class CompoundV3Adapter implements ProtocolAdapter {
  readonly protocol = DeFiProtocol.COMPOUND_V3;
  readonly supportedChains = [ChainId.ETHEREUM, ChainId.POLYGON, ChainId.ARBITRUM];
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
          logger.info(`Compound V3 adapter initialized for ${chainId}`, { 
            chainId, 
            rpcUrl: rpcUrl.substring(0, 50) + '...' 
          });
        } catch (error) {
          logger.error(`Failed to initialize Compound V3 provider for ${chainId}`, { error, chainId });
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
      
      logger.warn('Compound V3 adapter health check failed', { error });
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
        logger.error(`Failed to get Compound V3 positions for chain ${chain}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          address,
          chainId: chain,
        });
      }
    }

    return positions;
  }

  async getPosition(positionId: string, chainId: ChainId): Promise<DeFiPosition | null> {
    // Position ID format: compound-v3:{chainId}:{address}:{market}
    const [protocol, chain, userAddress, market] = positionId.split(':');
    
    if (protocol !== 'compound-v3' || chain !== chainId.toString()) {
      return null;
    }

    try {
      const positions = await this.getPositionsForChain(userAddress, chainId);
      return positions.find(pos => pos.id === positionId) || null;
    } catch (error) {
      logger.error(`Failed to get Compound V3 position ${positionId}`, { error });
      return null;
    }
  }

  getProtocolMetadata(): ProtocolMetadata {
    return {
      name: 'Compound V3',
      description: 'Compound V3 is a decentralized lending protocol featuring single collateral markets with efficient capital utilization.',
      website: 'https://compound.finance',
      logoUrl: 'https://cryptologos.cc/logos/compound-comp-logo.png',
      supportedAssets: ['USDC', 'WETH', 'USDT', 'WBTC', 'COMP', 'UNI', 'LINK'],
      features: [
        'Single collateral markets',
        'Efficient capital utilization',
        'COMP token rewards',
        'Automatic interest compounding',
        'Liquidation protection',
        'Cross-collateral borrowing',
        'Real-time interest rates',
      ],
    };
  }

  /**
   * Get all available markets for a specific chain
   */
  async getMarkets(chainId?: ChainId): Promise<Array<{
    chainId: ChainId;
    market: string;
    comet: string;
    baseToken: string;
    name: string;
    supplyAPY: number;
    borrowAPY: number;
    totalSupply: number;
    totalBorrow: number;
    utilization: number;
  }>> {
    const targetChains = chainId ? [chainId] : this.supportedChains;
    const markets: Array<{
      chainId: ChainId;
      market: string;
      comet: string;
      baseToken: string;
      name: string;
      supplyAPY: number;
      borrowAPY: number;
      totalSupply: number;
      totalBorrow: number;
      utilization: number;
    }> = [];

    for (const chain of targetChains) {
      try {
        const chainMarkets = await this.getMarketsForChain(chain);
        markets.push(...chainMarkets);
      } catch (error) {
        logger.error(`Failed to get Compound V3 markets for chain ${chain}`, { error });
      }
    }

    return markets;
  }

  /**
   * Get account snapshot for a specific market
   */
  async getAccountSnapshot(
    address: string, 
    market: string, 
    chainId: ChainId
  ): Promise<CometAccountSnapshot | null> {
    const provider = this.providers.get(chainId);
    const chainAddresses = COMPOUND_V3_ADDRESSES[chainId];

    if (!provider || !chainAddresses) {
      logger.warn(`No provider or addresses for Compound V3 on chain ${chainId}`);
      return null;
    }

    const marketData = chainAddresses.markets[market];
    if (!marketData) {
      logger.warn(`Market ${market} not found on chain ${chainId}`);
      return null;
    }

    try {
      const comet = new ethers.Contract(marketData.comet, COMET_ABI, provider);

      // Get base balance (positive = supplied, negative = borrowed)
      const [baseBalance, borrowBalance, isLiquidatable, liquidationThreshold, numAssets] = await Promise.all([
        comet.balanceOf(address) as Promise<bigint>,
        comet.borrowBalanceOf(address) as Promise<bigint>,
        comet.isLiquidatable(address) as Promise<boolean>,
        comet.liquidationThreshold(address) as Promise<bigint>,
        comet.numAssets() as Promise<number>,
      ]);

      // Get collateral balances
      const collateralBalances: Array<{
        asset: string;
        balance: bigint;
        info: CometAssetInfo;
      }> = [];

      for (let i = 0; i < numAssets; i++) {
        try {
          const assetInfo = await comet.getAssetInfo(i) as CometAssetInfo;
          const balance = await comet.collateralBalanceOf(address, assetInfo.asset) as bigint;
          
          if (balance > 0n) {
            collateralBalances.push({
              asset: assetInfo.asset,
              balance,
              info: assetInfo,
            });
          }
        } catch (error) {
          logger.warn(`Failed to get collateral balance for asset ${i}`, { error });
        }
      }

      return {
        baseBalance,
        borrowBalance,
        collateralBalances,
        isLiquidatable,
        liquidationThreshold,
      };
    } catch (error) {
      logger.error(`Failed to get account snapshot for ${address} in ${market}`, { error });
      return null;
    }
  }

  /**
   * Get claimable COMP rewards for an address
   */
  async getRewards(address: string, chainId?: ChainId): Promise<RewardToken[]> {
    const targetChains = chainId ? [chainId] : this.supportedChains;
    const rewards: RewardToken[] = [];

    for (const chain of targetChains) {
      try {
        const chainRewards = await this.getRewardsForChain(address, chain);
        rewards.push(...chainRewards);
      } catch (error) {
        logger.error(`Failed to get Compound V3 rewards for chain ${chain}`, { error });
      }
    }

    return rewards;
  }

  private async getPositionsForChain(address: string, chainId: ChainId): Promise<DeFiPosition[]> {
    const provider = this.providers.get(chainId);
    const chainAddresses = COMPOUND_V3_ADDRESSES[chainId];

    if (!provider || !chainAddresses) {
      logger.warn(`No provider or addresses for Compound V3 on chain ${chainId}`);
      return [];
    }

    const cacheKey = `compound-v3-positions:${chainId}:${address}`;
    const cached = await redisManager.get<DeFiPosition[]>(cacheKey);
    
    if (cached) {
      logger.debug(`Compound V3 positions cache hit for ${address} on ${chainId}`);
      return cached;
    }

    try {
      const positions: DeFiPosition[] = [];

      // Process each market
      for (const [marketSymbol, marketData] of Object.entries(chainAddresses.markets)) {
        try {
          const marketSnapshot = await this.getAccountSnapshot(address, marketSymbol, chainId);
          if (!marketSnapshot) continue;

          // Skip if no position exists
          const hasSupply = marketSnapshot.baseBalance > 0n;
          const hasBorrow = marketSnapshot.borrowBalance > 0n;
          const hasCollateral = marketSnapshot.collateralBalances.length > 0;

          if (!hasSupply && !hasBorrow && !hasCollateral) continue;

          // Get market data
          const marketInfo = await this.getMarketData(marketData.comet, provider);
          if (!marketInfo) continue;

          // Get base token info
          const baseTokenInfo = await this.getTokenInfo(marketData.baseToken, provider);
          const baseTokenPrice = await this.getTokenPrice(marketData.baseToken, chainId);

          // Create base DeFi token
          const baseDefiToken: DeFiToken = {
            address: marketData.baseToken,
            chainId,
            symbol: baseTokenInfo.symbol,
            name: baseTokenInfo.name,
            decimals: baseTokenInfo.decimals,
            priceUSD: baseTokenPrice,
          };

          // Calculate position values
          const supplyBalance = hasSupply 
            ? Number(marketSnapshot.baseBalance) / Math.pow(10, baseTokenInfo.decimals)
            : 0;
          const borrowBalance = hasBorrow 
            ? Number(marketSnapshot.borrowBalance) / Math.pow(10, baseTokenInfo.decimals)
            : 0;

          const supplyValueUSD = supplyBalance * baseTokenPrice;
          const borrowValueUSD = borrowBalance * baseTokenPrice;

          // Calculate collateral
          const collateralTokens: Array<{
            token: DeFiToken;
            amount: string;
            amountFormatted: string;
            valueUSD?: number;
            isCollateral: boolean;
          }> = [];

          let totalCollateralUSD = 0;
          for (const collateral of marketSnapshot.collateralBalances) {
            try {
              const collateralTokenInfo = await this.getTokenInfo(collateral.asset, provider);
              const collateralPrice = await this.getTokenPrice(collateral.asset, chainId);
              
              const collateralBalance = Number(collateral.balance) / Math.pow(10, collateralTokenInfo.decimals);
              const collateralValueUSD = collateralBalance * collateralPrice;
              totalCollateralUSD += collateralValueUSD;

              const collateralDefiToken: DeFiToken = {
                address: collateral.asset,
                chainId,
                symbol: collateralTokenInfo.symbol,
                name: collateralTokenInfo.name,
                decimals: collateralTokenInfo.decimals,
                priceUSD: collateralPrice,
              };

              collateralTokens.push({
                token: collateralDefiToken,
                amount: collateral.balance.toString(),
                amountFormatted: collateralBalance.toFixed(6),
                valueUSD: collateralValueUSD,
                isCollateral: true,
              });
            } catch (error) {
              logger.warn(`Failed to process collateral ${collateral.asset}`, { error });
            }
          }

          // Calculate health factor and risk metrics
          const healthFactor = this.calculateHealthFactor(
            supplyValueUSD + totalCollateralUSD,
            borrowValueUSD,
            marketSnapshot.liquidationThreshold
          );

          const riskMetrics: RiskMetrics = {
            healthFactor,
            liquidationRisk: this.calculateLiquidationRisk(healthFactor, marketSnapshot.isLiquidatable),
            collateralRatio: borrowValueUSD > 0 ? (supplyValueUSD + totalCollateralUSD) / borrowValueUSD : undefined,
            utilizationRate: (supplyValueUSD + totalCollateralUSD) > 0 ? borrowValueUSD / (supplyValueUSD + totalCollateralUSD) : 0,
          };

          // Calculate yield info
          const yieldInfo: YieldInfo[] = [];
          if (hasSupply) {
            const supplyAPY = this.calculateAPY(marketInfo.supplyRate);
            yieldInfo.push({
              apy: supplyAPY,
              apr: supplyAPY,
              source: 'lending',
              isCompounding: true,
              calculatedAt: new Date(),
            });
          }

          // Get rewards
          const rewards = await this.getRewardsForChain(address, chainId);

          // Skip dust positions
          const totalValueUSD = supplyValueUSD + totalCollateralUSD;
          if (totalValueUSD < 0.01) continue;

          // Create position
          const position: LendingPosition = {
            id: `compound-v3:${chainId}:${address}:${marketSymbol}`,
            protocol: DeFiProtocol.COMPOUND_V3,
            chainId,
            type: PositionType.LENDING,
            status: this.determinePositionStatus(
              supplyBalance + totalCollateralUSD / baseTokenPrice,
              borrowBalance,
              healthFactor,
              marketSnapshot.isLiquidatable
            ),
            name: `Compound V3 ${marketSymbol} Position`,
            description: `Lending position in ${marketSymbol} market on Compound V3`,
            url: `https://app.compound.finance/markets/${marketData.comet}`,

            suppliedTokens: hasSupply ? [{
              token: baseDefiToken,
              amount: marketSnapshot.baseBalance.toString(),
              amountFormatted: supplyBalance.toFixed(6),
              valueUSD: supplyValueUSD,
            }] : [],

            borrowedTokens: hasBorrow ? [{
              token: baseDefiToken,
              amount: marketSnapshot.borrowBalance.toString(),
              amountFormatted: borrowBalance.toFixed(6),
              valueUSD: borrowValueUSD,
            }] : undefined,

            collateralTokens,

            borrowingPower: {
              totalBorrowingPowerUSD: totalCollateralUSD + supplyValueUSD,
              usedBorrowingPowerUSD: borrowValueUSD,
              availableBorrowingPowerUSD: Math.max(0, (totalCollateralUSD + supplyValueUSD) - borrowValueUSD),
            },

            totalValueUSD,
            netValueUSD: totalValueUSD - borrowValueUSD,
            yieldInfo: yieldInfo.length > 0 ? yieldInfo : undefined,
            rewards: rewards.length > 0 ? rewards : undefined,
            riskMetrics,

            createdAt: new Date(),
            lastUpdatedAt: new Date(),

            protocolData: {
              market: marketSymbol,
              cometAddress: marketData.comet,
              baseToken: marketData.baseToken,
              isLiquidatable: marketSnapshot.isLiquidatable,
              liquidationThreshold: marketSnapshot.liquidationThreshold.toString(),
              supplyRate: marketInfo.supplyRate.toString(),
              borrowRate: marketInfo.borrowRate.toString(),
              utilization: marketInfo.utilization.toString(),
            },
          };

          positions.push(position);
        } catch (error) {
          logger.error(`Failed to process market ${marketSymbol} for ${address}`, { error });
        }
      }

      // Cache the results
      await redisManager.set(cacheKey, positions, 300); // 5 minutes cache

      logger.info(`Fetched ${positions.length} Compound V3 positions for ${address} on ${chainId}`);
      return positions;

    } catch (error) {
      logger.error(`Failed to fetch Compound V3 positions for ${address} on ${chainId}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  private async getMarketsForChain(chainId: ChainId): Promise<Array<{
    chainId: ChainId;
    market: string;
    comet: string;
    baseToken: string;
    name: string;
    supplyAPY: number;
    borrowAPY: number;
    totalSupply: number;
    totalBorrow: number;
    utilization: number;
  }>> {
    const provider = this.providers.get(chainId);
    const chainAddresses = COMPOUND_V3_ADDRESSES[chainId];

    if (!provider || !chainAddresses) {
      return [];
    }

    const markets = [];

    for (const [marketSymbol, marketData] of Object.entries(chainAddresses.markets)) {
      try {
        const marketInfo = await this.getMarketData(marketData.comet, provider);
        if (!marketInfo) continue;

        const baseTokenInfo = await this.getTokenInfo(marketData.baseToken, provider);
        const supplyAPY = this.calculateAPY(marketInfo.supplyRate);
        const borrowAPY = this.calculateAPY(marketInfo.borrowRate);
        const utilization = Number(marketInfo.utilization) / 1e18 * 100;

        markets.push({
          chainId,
          market: marketSymbol,
          comet: marketData.comet,
          baseToken: marketData.baseToken,
          name: marketData.name,
          supplyAPY,
          borrowAPY,
          totalSupply: Number(marketInfo.totalSupply) / Math.pow(10, baseTokenInfo.decimals),
          totalBorrow: Number(marketInfo.totalBorrow) / Math.pow(10, baseTokenInfo.decimals),
          utilization,
        });
      } catch (error) {
        logger.warn(`Failed to get market data for ${marketSymbol}`, { error });
      }
    }

    return markets;
  }

  private async getMarketData(cometAddress: string, provider: ethers.JsonRpcProvider): Promise<CometMarketData | null> {
    try {
      const comet = new ethers.Contract(cometAddress, COMET_ABI, provider);

      const [
        baseToken,
        baseScale,
        supplyRate,
        borrowRate,
        utilization,
        totalSupply,
        totalBorrow,
        numAssets,
        baseMinForRewards,
        baseTrackingSupplySpeed,
        baseTrackingBorrowSpeed,
      ] = await Promise.all([
        comet.baseToken() as Promise<string>,
        comet.baseScale() as Promise<bigint>,
        comet.getSupplyRate(await comet.getUtilization()) as Promise<bigint>,
        comet.getBorrowRate(await comet.getUtilization()) as Promise<bigint>,
        comet.getUtilization() as Promise<bigint>,
        comet.totalSupply() as Promise<bigint>,
        comet.totalBorrow() as Promise<bigint>,
        comet.numAssets() as Promise<number>,
        comet.baseMinForRewards() as Promise<bigint>,
        comet.baseTrackingSupplySpeed() as Promise<bigint>,
        comet.baseTrackingBorrowSpeed() as Promise<bigint>,
      ]);

      // Get asset information
      const assets: CometAssetInfo[] = [];
      for (let i = 0; i < numAssets; i++) {
        try {
          const assetInfo = await comet.getAssetInfo(i) as CometAssetInfo;
          assets.push(assetInfo);
        } catch (error) {
          logger.warn(`Failed to get asset info for index ${i}`, { error });
        }
      }

      // Get base token info
      const baseTokenInfo = await this.getTokenInfo(baseToken, provider);

      return {
        comet: cometAddress,
        baseToken,
        name: `Compound ${baseTokenInfo.symbol}`,
        baseSymbol: baseTokenInfo.symbol,
        baseName: baseTokenInfo.name,
        baseDecimals: baseTokenInfo.decimals,
        baseScale,
        supplyRate,
        borrowRate,
        utilization,
        totalSupply,
        totalBorrow,
        assets,
        baseMinForRewards,
        baseTrackingSupplySpeed,
        baseTrackingBorrowSpeed,
      };
    } catch (error) {
      logger.error(`Failed to get market data for ${cometAddress}`, { error });
      return null;
    }
  }

  private async getRewardsForChain(address: string, chainId: ChainId): Promise<RewardToken[]> {
    const provider = this.providers.get(chainId);
    const chainAddresses = COMPOUND_V3_ADDRESSES[chainId];

    if (!provider || !chainAddresses) {
      return [];
    }

    try {
      const cometRewards = new ethers.Contract(
        chainAddresses.cometRewards,
        COMET_REWARDS_ABI,
        provider
      );

      const rewards: RewardToken[] = [];

      // Check rewards for each market
      for (const [marketSymbol, marketData] of Object.entries(chainAddresses.markets)) {
        try {
          const [rewardOwed, rewardsClaimed, rewardConfig] = await Promise.all([
            cometRewards.getRewardOwed(marketData.comet, address),
            cometRewards.rewardsClaimed(marketData.comet, address) as Promise<bigint>,
            cometRewards.rewardConfig(marketData.comet),
          ]);

          if (rewardOwed.owed > 0n) {
            const rewardTokenInfo = await this.getTokenInfo(rewardOwed.token, provider);
            const rewardPrice = await this.getTokenPrice(rewardOwed.token, chainId);
            
            const rewardAmount = Number(rewardOwed.owed) / Math.pow(10, rewardTokenInfo.decimals);
            const rewardValueUSD = rewardAmount * rewardPrice;

            const rewardToken: RewardToken = {
              token: {
                address: rewardOwed.token,
                chainId,
                symbol: rewardTokenInfo.symbol,
                name: rewardTokenInfo.name,
                decimals: rewardTokenInfo.decimals,
                priceUSD: rewardPrice,
              },
              amount: rewardOwed.owed.toString(),
              amountFormatted: rewardAmount.toFixed(6),
              valueUSD: rewardValueUSD,
              // Compound rewards are typically claimable immediately
              vesting: {
                isVesting: false,
                claimableAt: new Date(),
              },
            };

            rewards.push(rewardToken);
          }
        } catch (error) {
          logger.warn(`Failed to get rewards for market ${marketSymbol}`, { error });
        }
      }

      return rewards;
    } catch (error) {
      logger.error(`Failed to get Compound V3 rewards for ${address} on ${chainId}`, { error });
      return [];
    }
  }

  private async getTokenInfo(tokenAddress: string, provider: ethers.JsonRpcProvider): Promise<TokenInfo> {
    try {
      const cacheKey = `token-info:${tokenAddress}`;
      const cached = await redisManager.get<TokenInfo>(cacheKey);
      if (cached) return cached;

      const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      
      const [symbol, name, decimals] = await Promise.all([
        token.symbol() as Promise<string>,
        token.name() as Promise<string>,
        token.decimals() as Promise<number>,
      ]);

      const tokenInfo = { symbol, name, decimals };
      await redisManager.set(cacheKey, tokenInfo, 3600); // 1 hour cache

      return tokenInfo;
    } catch (error) {
      logger.warn(`Failed to get token info for ${tokenAddress}`, { error });
      return { symbol: 'UNKNOWN', name: 'Unknown Token', decimals: 18 };
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

      // Enhanced token prices by chain with Compound V3 specific tokens
      const tokenPrices: Record<string, Record<string, number>> = {
        [ChainId.ETHEREUM]: {
          '0xa0b86a33e6441b8435b6ba10d7c6f8c7e7eaee5a': 1, // USDC
          '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 2000, // WETH
          '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 45000, // WBTC
          '0xc00e94cb662c3520282e6f5717214004a7f26888': 45, // COMP
          '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 8, // UNI
          '0x514910771af9ca656af840dff83e8264ecf986ca': 15, // LINK
          '0xdac17f958d2ee523a2206206994597c13d831ec7': 1, // USDT
        },
        [ChainId.POLYGON]: {
          '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 1, // USDC
          '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 1, // USDT
          '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': 2000, // WETH
          '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6': 45000, // WBTC
          '0x8505b9d2254a7ae468c0e9dd10ccea3a837aef5c': 45, // COMP
          '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': 0.8, // WMATIC
        },
        [ChainId.ARBITRUM]: {
          '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8': 1, // USDC
          '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 1, // USDT
          '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 2000, // WETH
          '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f': 45000, // WBTC
          '0x354a6da3fcde098f8389cad84b0182725c6c91de': 45, // COMP
          '0x912ce59144191c1204e64559fe8253a0e49e6548': 1.2, // ARB
          '0xfa7f8980b0f1e64a2062791cc3b0871572f1f7f0': 8, // UNI
        },
      };
      
      const chainPrices = tokenPrices[chainId] || {};
      const price = chainPrices[tokenAddress.toLowerCase()] || 1;
      
      // Cache for 1 minute
      await redisManager.set(cacheKey, price, 60);
      
      return price;
    } catch (error) {
      logger.warn(`Failed to get price for token ${tokenAddress}`, { error, chainId });
      return 1; // Fallback price
    }
  }

  private calculateHealthFactor(
    totalCollateralUSD: number,
    totalBorrowUSD: number,
    liquidationThreshold: bigint
  ): number | undefined {
    if (totalBorrowUSD === 0) return undefined;
    
    // Convert liquidation threshold from basis points (if needed) or use as decimal
    const threshold = Number(liquidationThreshold) > 1 
      ? Number(liquidationThreshold) / 10000 // If in basis points
      : Number(liquidationThreshold) / 1e18; // If in wei/decimal format
    
    return (totalCollateralUSD * threshold) / totalBorrowUSD;
  }

  private calculateLiquidationRisk(healthFactor?: number, isLiquidatable?: boolean): RiskLevel {
    if (isLiquidatable) return RiskLevel.CRITICAL;
    if (!healthFactor) return RiskLevel.LOW;
    
    if (healthFactor < 1.1) return RiskLevel.CRITICAL;
    if (healthFactor < 1.3) return RiskLevel.HIGH;
    if (healthFactor < 1.5) return RiskLevel.MEDIUM;
    return RiskLevel.LOW;
  }

  private calculateAPY(rate: bigint): number {
    try {
      // Compound V3 rates are typically per second
      // Convert to APY: ((1 + ratePerSecond) ^ secondsPerYear) - 1
      const ratePerSecond = Number(rate) / 1e18;
      const secondsPerYear = 365.25 * 24 * 60 * 60;
      
      if (ratePerSecond <= 0) return 0;
      
      // For small rates, use approximation to avoid overflow
      if (ratePerSecond < 1e-10) {
        return ratePerSecond * secondsPerYear * 100;
      }
      
      const apy = (Math.pow(1 + ratePerSecond, secondsPerYear) - 1) * 100;
      
      // Safety bounds
      return Math.min(Math.max(apy, 0), 1000); // Cap at 1000% APY
    } catch (error) {
      logger.warn('Error calculating APY from rate', { rate: rate.toString(), error });
      return 0;
    }
  }

  private determinePositionStatus(
    supplyBalance: number,
    borrowBalance: number,
    healthFactor?: number,
    isLiquidatable?: boolean
  ): PositionStatus {
    if (isLiquidatable) return PositionStatus.LIQUIDATED;
    if (supplyBalance === 0 && borrowBalance === 0) return PositionStatus.CLOSED;
    if (healthFactor && healthFactor < 1.1) return PositionStatus.AT_RISK;
    if (supplyBalance > 0 || borrowBalance > 0) return PositionStatus.ACTIVE;
    return PositionStatus.INACTIVE;
  }
}

// Factory function
export const createCompoundV3Adapter = (rpcUrls: Partial<Record<ChainId, string>>): CompoundV3Adapter => {
  return new CompoundV3Adapter(rpcUrls);
};