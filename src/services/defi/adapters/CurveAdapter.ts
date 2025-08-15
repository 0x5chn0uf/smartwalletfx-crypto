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
  RewardToken,
} from '@/types/defi';

// Curve contract addresses by chain
const CURVE_ADDRESSES: Record<ChainId, {
  registry: string;
  metaRegistry: string;
  cryptoRegistry: string;
  gaugeController: string;
  minter: string;
  votingEscrow: string;
  feeDistributor: string;
  subgraphUrl: string;
}> = {
  [ChainId.ETHEREUM]: {
    registry: '0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5',
    metaRegistry: '0xF98B45FA17DE75FB1aD0e7aFD971b0ca00e379fC',
    cryptoRegistry: '0x8F942C20D02bEfc377D41445793068908E2250D0',
    gaugeController: '0x2F50D538606Fa9EDD2B11E2446BEb18C9D5846bB',
    minter: '0xd061D61a4d941c39E5453435B6345Dc261C2fcE0',
    votingEscrow: '0x5f3b5DfEb7B28CDbD7FABa78963EE202a494e2A2',
    feeDistributor: '0xA464e6DCda8AC41e03616F95f4BC98a13b8922Dc',
    subgraphUrl: 'https://api.thegraph.com/subgraphs/name/curvefi/curve',
  },
  [ChainId.POLYGON]: {
    registry: '0x094d12e5b541784701FD8d65F11fc0598FBC6332',
    metaRegistry: '0x47bB542B9dE58b970bA50c9dae444DDB4c16751a',
    cryptoRegistry: '0x722272D36ef0Da72FF51c5A65Db7b870E2e8D4ee',
    gaugeController: '0xabC000d88f23Bb1C8b11D2d11FaFA8E8C2C64E27',
    minter: '0xabC000d88f23Bb1C8b11D2d11FaFA8E8C2C64E27',
    votingEscrow: '0x8E42f2F4101563bF679975178e880FD87d3eFd4e',
    feeDistributor: '0x5f3b5DfEb7B28CDbD7FABa78963EE202a494e2A2',
    subgraphUrl: 'https://api.thegraph.com/subgraphs/name/curvefi/curve-polygon',
  },
  [ChainId.ARBITRUM]: {
    registry: '0x445FE580eF8d70FF569aB36e80c647af338db351',
    metaRegistry: '0x0E9fBF6e8C0CcEd1A78B5C4E7Fc9A27Af3e0C7dE',
    cryptoRegistry: '0x1A1FDf95B5F3F3e4aD4e6c1FfF1e8f3db5c1234E',
    gaugeController: '0x9AF14D26075f142eb3F292D5065EB3faa646167b',
    minter: '0xabC000d88f23Bb1C8b11D2d11FaFA8E8C2C64E27',
    votingEscrow: '0x8E42f2F4101563bF679975178e880FD87d3eFd4e',
    feeDistributor: '0x8b2270AaB0C2b1d5fA1e8D9B7Af03a0EfE0b8fDa',
    subgraphUrl: 'https://api.thegraph.com/subgraphs/name/curvefi/curve-arbitrum',
  },
  [ChainId.OPTIMISM]: {
    registry: '0xC5cfaDA84E902aD92DD40194f0883ad49639b023',
    metaRegistry: '0x7D86446dDb609eD0F5f8684AcF30380a356b2B4c',
    cryptoRegistry: '0x1A1FDf95B5F3F3e4aD4e6c1FfF1e8f3db5c1234E',
    gaugeController: '0x0481C7e8c1c0A5C4Fb0C51b2DAE4D1D8e8BDe4E1',
    minter: '0xabC000d88f23Bb1C8b11D2d11FaFA8E8C2C64E27',
    votingEscrow: '0x8E42f2F4101563bF679975178e880FD87d3eFd4e',
    feeDistributor: '0x8b2270AaB0C2b1d5fA1e8D9B7Af03a0EfE0b8fDa',
    subgraphUrl: 'https://api.thegraph.com/subgraphs/name/curvefi/curve-optimism',
  },
};

// Curve Registry ABI (simplified)
const REGISTRY_ABI = [
  'function get_pool_from_lp_token(address lp_token) external view returns (address)',
  'function get_lp_token(address pool) external view returns (address)',
  'function get_n_coins(address pool) external view returns (uint256)',
  'function get_coins(address pool) external view returns (address[8])',
  'function get_underlying_coins(address pool) external view returns (address[8])',
  'function get_balances(address pool) external view returns (uint256[8])',
  'function get_underlying_balances(address pool) external view returns (uint256[8])',
  'function get_virtual_price_from_lp_token(address lp_token) external view returns (uint256)',
  'function get_pool_name(address pool) external view returns (string)',
];

// Curve Pool ABI (simplified)
const POOL_ABI = [
  'function balances(uint256 i) external view returns (uint256)',
  'function coins(uint256 i) external view returns (address)',
  'function get_virtual_price() external view returns (uint256)',
  'function fee() external view returns (uint256)',
  'function admin_fee() external view returns (uint256)',
  'function A() external view returns (uint256)',
  'function A_precise() external view returns (uint256)',
  'function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256)',
];

// Gauge ABI (simplified)
const GAUGE_ABI = [
  'function balanceOf(address addr) external view returns (uint256)',
  'function claimable_tokens(address addr) external view returns (uint256)',
  'function claimable_reward(address addr, address token) external view returns (uint256)',
  'function reward_tokens(uint256 i) external view returns (address)',
  'function reward_count() external view returns (uint256)',
  'function working_balances(address addr) external view returns (uint256)',
  'function working_supply() external view returns (uint256)',
  'function integrate_fraction(address addr) external view returns (uint256)',
];

// Gauge Controller ABI (simplified)
const GAUGE_CONTROLLER_ABI = [
  'function gauges(uint256 i) external view returns (address)',
  'function n_gauges() external view returns (int128)',
  'function get_gauge_weight(address gauge) external view returns (uint256)',
  'function gauge_relative_weight(address gauge) external view returns (uint256)',
  'function vote_user_slopes(address user, address gauge) external view returns (uint256, uint256, uint256)',
];

// LP Token ABI (ERC20)
const LP_TOKEN_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function totalSupply() external view returns (uint256)',
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function decimals() external view returns (uint8)',
];

// CRV Token ABI
const CRV_TOKEN_ABI = [
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function decimals() external view returns (uint8)',
];

interface CurvePoolData {
  poolAddress: string;
  lpToken: string;
  name: string;
  coins: string[];
  nCoins: number;
  balances: bigint[];
  virtualPrice: bigint;
  fee: bigint;
  adminFee: bigint;
  A: bigint;
  poolType: 'stable' | 'crypto' | 'meta';
}

interface CurveGaugeData {
  gaugeAddress: string;
  lpToken: string;
  stakedBalance: bigint;
  workingBalance: bigint;
  claimableCRV: bigint;
  rewardTokens: {
    address: string;
    symbol: string;
    claimableAmount: bigint;
  }[];
  weight: bigint;
  relativeWeight: bigint;
}

interface CurvePosition {
  pool: CurvePoolData;
  lpBalance: bigint;
  lpTotalSupply: bigint;
  sharePercent: number;
  underlyingBalances: {
    token: DeFiToken;
    balance: number;
    valueUSD: number;
  }[];
  gauge?: CurveGaugeData;
}

export class CurveAdapter implements ProtocolAdapter {
  readonly protocol = DeFiProtocol.CURVE;
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
  private rateLimitCount = 0;
  private lastRateLimitReset = Date.now();
  private readonly maxRequestsPerMinute = 100;

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
          logger.info(`Curve adapter initialized for ${chainId}`, { chainId, rpcUrl: rpcUrl.substring(0, 50) + '...' });
        } catch (error) {
          logger.error(`Failed to initialize Curve provider for ${chainId}`, { error, chainId });
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
      
      // Test basic provider connectivity
      await provider.getBlockNumber();
      
      // Test Curve registry contract
      const contractAddresses = CURVE_ADDRESSES[testChain];
      const registry = new ethers.Contract(contractAddresses.registry, REGISTRY_ABI, provider);
      
      // Try to get a known pool (3pool on mainnet)
      const pool3Address = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7';
      await registry.get_lp_token(pool3Address);
      
      this.health.responseTime = Date.now() - startTime;
      this.health.isHealthy = true;
      this.health.issues = [];
      this.health.lastCheckedAt = new Date();
      
      return true;
    } catch (error) {
      this.health.isHealthy = false;
      this.health.issues = [error instanceof Error ? error.message : 'Unknown error'];
      this.health.lastCheckedAt = new Date();
      
      logger.warn('Curve adapter health check failed', { error });
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
        logger.error(`Failed to get Curve positions for chain ${chain}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          address,
          chainId: chain,
        });
      }
    }

    return positions;
  }

  async getPosition(positionId: string, chainId: ChainId): Promise<DeFiPosition | null> {
    // Position ID format: curve:{chainId}:{address}:{lpToken}
    const [protocol, chain, userAddress, lpToken] = positionId.split(':');
    
    if (protocol !== 'curve' || chain !== chainId.toString()) {
      return null;
    }

    try {
      const positions = await this.getPositionsForChain(userAddress, chainId);
      return positions.find(pos => pos.id === positionId) || null;
    } catch (error) {
      logger.error(`Failed to get Curve position ${positionId}`, { error });
      return null;
    }
  }

  getProtocolMetadata(): ProtocolMetadata {
    return {
      name: 'Curve Finance',
      description: 'Curve is a decentralized exchange liquidity pool on Ethereum designed for extremely efficient stablecoin trading and low-risk, supplemental fee income for liquidity providers.',
      website: 'https://curve.fi',
      logoUrl: 'https://cryptologos.cc/logos/curve-dao-token-crv-logo.png',
      supportedAssets: ['USDC', 'USDT', 'DAI', 'FRAX', 'LUSD', 'sUSD', 'WETH', 'WBTC', 'stETH', 'rETH'],
      features: [
        'Stablecoin trading with minimal slippage',
        'Liquidity pools for various asset types',
        'Gauge voting and boosting',
        'CRV token rewards',
        'Cross-asset swaps',
        'Meta pools and factory pools',
        'Crypto asset pools',
        'Vote-escrowed governance',
      ],
    };
  }

  private async getPositionsForChain(address: string, chainId: ChainId): Promise<DeFiPosition[]> {
    const provider = this.providers.get(chainId);
    const contractAddresses = CURVE_ADDRESSES[chainId];

    if (!provider || !contractAddresses) {
      logger.warn(`No provider or contract addresses for Curve on chain ${chainId}`);
      return [];
    }

    const cacheKey = `curve-positions:${chainId}:${address}`;
    const cached = await redisManager.get<DeFiPosition[]>(cacheKey);
    
    if (cached) {
      logger.debug(`Curve positions cache hit for ${address} on ${chainId}`);
      return cached;
    }

    try {
      // Check rate limit
      if (!this.checkRateLimit()) {
        logger.warn('Curve adapter rate limit exceeded, using cache or skipping');
        return [];
      }

      const positions: DeFiPosition[] = [];

      // Get all LP positions and gauge positions
      const [lpPositions, gaugePositions] = await Promise.all([
        this.getPoolPositions(address, chainId),
        this.getGaugePositions(address, chainId),
      ]);

      // Merge LP and gauge positions
      const allPositions = this.mergePositions(lpPositions, gaugePositions);

      // Convert to DeFi positions
      for (const curvePosition of allPositions) {
        const defiPosition = await this.convertToDefiPosition(curvePosition, address, chainId);
        if (defiPosition) {
          positions.push(defiPosition);
        }
      }

      // Cache the results
      await redisManager.set(cacheKey, positions, 300); // 5 minutes cache

      logger.info(`Fetched ${positions.length} Curve positions for ${address} on ${chainId}`);
      return positions;

    } catch (error) {
      logger.error(`Failed to fetch Curve positions for ${address} on ${chainId}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  async getPoolPositions(address: string, chainId: ChainId): Promise<CurvePosition[]> {
    const provider = this.providers.get(chainId);
    const contractAddresses = CURVE_ADDRESSES[chainId];

    if (!provider || !contractAddresses) {
      return [];
    }

    const positions: CurvePosition[] = [];

    try {
      // Get known pools from API or subgraph (simplified approach)
      const knownPools = await this.getKnownPools(chainId);

      for (const poolData of knownPools) {
        try {
          const lpToken = new ethers.Contract(poolData.lpToken, LP_TOKEN_ABI, provider);
          const balance = await lpToken.balanceOf(address) as bigint;

          if (balance > 0n) {
            const totalSupply = await lpToken.totalSupply() as bigint;
            const sharePercent = totalSupply > 0n ? (Number(balance) / Number(totalSupply)) * 100 : 0;

            // Get underlying token balances
            const underlyingBalances = await this.calculateUnderlyingBalances(
              poolData,
              balance,
              totalSupply,
              chainId
            );

            const position: CurvePosition = {
              pool: poolData,
              lpBalance: balance,
              lpTotalSupply: totalSupply,
              sharePercent,
              underlyingBalances,
            };

            positions.push(position);
          }
        } catch (error) {
          logger.warn(`Failed to get LP position for pool ${poolData.poolAddress}`, { error });
        }
      }

      return positions;
    } catch (error) {
      logger.error(`Failed to get Curve pool positions for ${address}`, { error });
      return [];
    }
  }

  async getGaugePositions(address: string, chainId: ChainId): Promise<Map<string, CurveGaugeData>> {
    const provider = this.providers.get(chainId);
    const contractAddresses = CURVE_ADDRESSES[chainId];

    if (!provider || !contractAddresses) {
      return new Map();
    }

    const gaugePositions = new Map<string, CurveGaugeData>();

    try {
      // Get all gauges from the controller
      const gaugeController = new ethers.Contract(
        contractAddresses.gaugeController,
        GAUGE_CONTROLLER_ABI,
        provider
      );

      const nGauges = await gaugeController.n_gauges() as bigint;
      const numGauges = Number(nGauges);

      // Check first 50 gauges (to avoid too many calls)
      const maxGauges = Math.min(numGauges, 50);

      for (let i = 0; i < maxGauges; i++) {
        try {
          const gaugeAddress = await gaugeController.gauges(i) as string;
          const gauge = new ethers.Contract(gaugeAddress, GAUGE_ABI, provider);

          const stakedBalance = await gauge.balanceOf(address) as bigint;

          if (stakedBalance > 0n) {
            // Get additional gauge data
            const [workingBalance, claimableCRV, weight, relativeWeight] = await Promise.all([
              gauge.working_balances(address) as Promise<bigint>,
              gauge.claimable_tokens(address) as Promise<bigint>,
              gaugeController.get_gauge_weight(gaugeAddress) as Promise<bigint>,
              gaugeController.gauge_relative_weight(gaugeAddress) as Promise<bigint>,
            ]);

            // Get reward tokens
            const rewardTokens = await this.getGaugeRewardTokens(gauge, address);

            // Get LP token address (implementation specific)
            const lpToken = await this.getLPTokenFromGauge(gaugeAddress, chainId);

            const gaugeData: CurveGaugeData = {
              gaugeAddress,
              lpToken,
              stakedBalance,
              workingBalance,
              claimableCRV,
              rewardTokens,
              weight,
              relativeWeight,
            };

            gaugePositions.set(lpToken, gaugeData);
          }
        } catch (error) {
          logger.warn(`Failed to get gauge position at index ${i}`, { error });
        }
      }

      return gaugePositions;
    } catch (error) {
      logger.error(`Failed to get Curve gauge positions for ${address}`, { error });
      return new Map();
    }
  }

  async getRewards(address: string, chainId: ChainId): Promise<RewardToken[]> {
    const gaugePositions = await this.getGaugePositions(address, chainId);
    const rewards: RewardToken[] = [];

    for (const [lpToken, gaugeData] of gaugePositions) {
      // CRV rewards
      if (gaugeData.claimableCRV > 0n) {
        const crvToken = await this.getCRVToken(chainId);
        const crvPrice = await this.getTokenPrice(crvToken.address, chainId);
        const crvAmount = Number(gaugeData.claimableCRV) / Math.pow(10, crvToken.decimals);

        rewards.push({
          token: crvToken,
          amount: gaugeData.claimableCRV.toString(),
          amountFormatted: crvAmount.toFixed(6),
          valueUSD: crvAmount * crvPrice,
          apy: await this.calculateCRVApy(gaugeData, chainId),
        });
      }

      // Additional reward tokens
      for (const rewardToken of gaugeData.rewardTokens) {
        if (rewardToken.claimableAmount > 0n) {
          const token = await this.getTokenInfo(rewardToken.address, chainId);
          const price = await this.getTokenPrice(rewardToken.address, chainId);
          const amount = Number(rewardToken.claimableAmount) / Math.pow(10, token.decimals);

          rewards.push({
            token,
            amount: rewardToken.claimableAmount.toString(),
            amountFormatted: amount.toFixed(6),
            valueUSD: amount * price,
          });
        }
      }
    }

    return rewards;
  }

  async getPoolInfo(poolAddress: string, chainId: ChainId): Promise<any> {
    const provider = this.providers.get(chainId);
    const contractAddresses = CURVE_ADDRESSES[chainId];

    if (!provider || !contractAddresses) {
      return null;
    }

    try {
      const registry = new ethers.Contract(contractAddresses.registry, REGISTRY_ABI, provider);
      const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);

      const [lpToken, nCoins, virtualPrice, fee, adminFee, A] = await Promise.all([
        registry.get_lp_token(poolAddress) as Promise<string>,
        registry.get_n_coins(poolAddress) as Promise<bigint>,
        pool.get_virtual_price() as Promise<bigint>,
        pool.fee() as Promise<bigint>,
        pool.admin_fee() as Promise<bigint>,
        pool.A() as Promise<bigint>,
      ]);

      const coins = await registry.get_coins(poolAddress) as string[];
      const balances = await registry.get_balances(poolAddress) as bigint[];

      // Calculate APY
      const baseApy = await this.calculatePoolApy(poolAddress, chainId);
      const crvApy = await this.calculatePoolCRVApy(poolAddress, chainId);

      return {
        poolAddress,
        lpToken,
        nCoins: Number(nCoins),
        coins: coins.slice(0, Number(nCoins)).filter(coin => coin !== ethers.ZeroAddress),
        balances: balances.slice(0, Number(nCoins)),
        virtualPrice,
        fee,
        adminFee,
        A,
        apy: {
          base: baseApy,
          crv: crvApy,
          total: baseApy + crvApy,
        },
      };
    } catch (error) {
      logger.error(`Failed to get pool info for ${poolAddress}`, { error });
      return null;
    }
  }

  // Private helper methods

  private checkRateLimit(): boolean {
    const now = Date.now();
    const timeSinceReset = now - this.lastRateLimitReset;

    // Reset counter every minute
    if (timeSinceReset >= 60000) {
      this.rateLimitCount = 0;
      this.lastRateLimitReset = now;
    }

    if (this.rateLimitCount >= this.maxRequestsPerMinute) {
      return false;
    }

    this.rateLimitCount++;
    return true;
  }

  private async getKnownPools(chainId: ChainId): Promise<CurvePoolData[]> {
    const cacheKey = `curve-known-pools:${chainId}`;
    const cached = await redisManager.get<CurvePoolData[]>(cacheKey);
    
    if (cached) {
      return cached;
    }

    // In production, this would query the Curve API or subgraph
    // For now, return some well-known pools
    const knownPools: CurvePoolData[] = [];

    if (chainId === ChainId.ETHEREUM) {
      knownPools.push(
        {
          poolAddress: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7',
          lpToken: '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490',
          name: '3pool',
          coins: [
            '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
            '0xA0b86a33E6441b8435b6BA10D7C6F8C7e7EaEe5A', // USDC
            '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
          ],
          nCoins: 3,
          balances: [0n, 0n, 0n],
          virtualPrice: 0n,
          fee: 0n,
          adminFee: 0n,
          A: 0n,
          poolType: 'stable',
        },
        {
          poolAddress: '0xD51a44d3FaE010294C616388b506AcdA1bfAAE46',
          lpToken: '0x075b1bb99792c9E1041bA13afEf80C91a1e70fB3',
          name: 'tricrypto2',
          coins: [
            '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
            '0x2260FAC5E5542a773Aa44fBcfedf7C193bc2C599', // WBTC
            '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
          ],
          nCoins: 3,
          balances: [0n, 0n, 0n],
          virtualPrice: 0n,
          fee: 0n,
          adminFee: 0n,
          A: 0n,
          poolType: 'crypto',
        }
      );
    }

    // Cache for 1 hour
    await redisManager.set(cacheKey, knownPools, 3600);
    return knownPools;
  }

  private async calculateUnderlyingBalances(
    poolData: CurvePoolData,
    lpBalance: bigint,
    lpTotalSupply: bigint,
    chainId: ChainId
  ): Promise<{ token: DeFiToken; balance: number; valueUSD: number }[]> {
    const provider = this.providers.get(chainId);
    if (!provider) return [];

    const underlyingBalances: { token: DeFiToken; balance: number; valueUSD: number }[] = [];

    try {
      const contractAddresses = CURVE_ADDRESSES[chainId];
      const registry = new ethers.Contract(contractAddresses.registry, REGISTRY_ABI, provider);

      // Get pool balances
      const balances = await registry.get_balances(poolData.poolAddress) as bigint[];
      
      for (let i = 0; i < poolData.nCoins; i++) {
        const coinAddress = poolData.coins[i];
        if (!coinAddress || coinAddress === ethers.ZeroAddress) continue;

        const tokenInfo = await this.getTokenInfo(coinAddress, chainId);
        const tokenPrice = await this.getTokenPrice(coinAddress, chainId);

        // Calculate user's share of this token
        const poolBalance = balances[i];
        const userBalance = lpTotalSupply > 0n 
          ? (poolBalance * lpBalance) / lpTotalSupply 
          : 0n;
        
        const userBalanceFormatted = Number(userBalance) / Math.pow(10, tokenInfo.decimals);
        const valueUSD = userBalanceFormatted * tokenPrice;

        underlyingBalances.push({
          token: tokenInfo,
          balance: userBalanceFormatted,
          valueUSD,
        });
      }

      return underlyingBalances;
    } catch (error) {
      logger.warn('Failed to calculate underlying balances', { error, poolAddress: poolData.poolAddress });
      return [];
    }
  }

  private mergePositions(
    lpPositions: CurvePosition[],
    gaugePositions: Map<string, CurveGaugeData>
  ): CurvePosition[] {
    const mergedPositions: CurvePosition[] = [];

    // Add LP positions with gauge data if available
    for (const lpPosition of lpPositions) {
      const gauge = gaugePositions.get(lpPosition.pool.lpToken);
      mergedPositions.push({
        ...lpPosition,
        gauge,
      });
    }

    // Add gauge-only positions (staked but no LP balance)
    for (const [lpToken, gaugeData] of gaugePositions) {
      const hasLpPosition = lpPositions.some(pos => pos.pool.lpToken === lpToken);
      
      if (!hasLpPosition) {
        // Create a position for the staked amount
        const pool = {
          poolAddress: '',
          lpToken,
          name: 'Staked Position',
          coins: [],
          nCoins: 0,
          balances: [],
          virtualPrice: 0n,
          fee: 0n,
          adminFee: 0n,
          A: 0n,
          poolType: 'stable' as const,
        };

        mergedPositions.push({
          pool,
          lpBalance: gaugeData.stakedBalance,
          lpTotalSupply: 1n, // Placeholder
          sharePercent: 0,
          underlyingBalances: [],
          gauge: gaugeData,
        });
      }
    }

    return mergedPositions;
  }

  private async convertToDefiPosition(
    curvePosition: CurvePosition,
    address: string,
    chainId: ChainId
  ): Promise<LiquidityPosition | null> {
    try {
      // Calculate total value
      const totalValueUSD = curvePosition.underlyingBalances.reduce(
        (sum, balance) => sum + balance.valueUSD,
        0
      );

      // Get rewards if gauge exists
      const rewards: RewardToken[] = [];
      if (curvePosition.gauge) {
        const gaugeRewards = await this.getGaugeRewards(curvePosition.gauge, chainId);
        rewards.push(...gaugeRewards);
      }

      // Calculate total rewards value
      const totalRewardsUSD = rewards.reduce((sum, reward) => sum + (reward.valueUSD || 0), 0);

      // Determine position status
      const status = totalValueUSD > 0.01 ? PositionStatus.ACTIVE : PositionStatus.INACTIVE;

      // Skip dust positions
      if (totalValueUSD < 0.01 && totalRewardsUSD < 0.01) {
        return null;
      }

      // Calculate yield info
      const yieldInfo: YieldInfo[] = [];
      
      // Base APY from fees
      const baseApy = await this.calculatePoolApy(curvePosition.pool.poolAddress, chainId);
      if (baseApy > 0) {
        yieldInfo.push({
          apy: baseApy,
          apr: baseApy,
          source: 'fees',
          isCompounding: true,
          calculatedAt: new Date(),
        });
      }

      // CRV rewards APY
      if (curvePosition.gauge) {
        const crvApy = await this.calculateCRVApy(curvePosition.gauge, chainId);
        if (crvApy > 0) {
          yieldInfo.push({
            apy: crvApy,
            apr: crvApy,
            source: 'rewards',
            isCompounding: false,
            calculatedAt: new Date(),
          });
        }
      }

      // Risk metrics
      const riskMetrics: RiskMetrics = {
        liquidationRisk: RiskLevel.LOW, // Curve pools generally have low liquidation risk
        impermanentLoss: this.calculateImpermanentLoss(curvePosition.pool.poolType),
      };

      // Create supplied tokens array
      const suppliedTokens = curvePosition.underlyingBalances.map(balance => ({
        token: balance.token,
        amount: (balance.balance * Math.pow(10, balance.token.decimals)).toString(),
        amountFormatted: balance.balance.toFixed(6),
        valueUSD: balance.valueUSD,
      }));

      // LP token info
      const lpTokenInfo = await this.getTokenInfo(curvePosition.pool.lpToken, chainId);

      const position: LiquidityPosition = {
        id: `curve:${chainId}:${address}:${curvePosition.pool.lpToken}`,
        protocol: DeFiProtocol.CURVE,
        chainId,
        type: PositionType.LIQUIDITY_POOL,
        status,
        name: `Curve ${curvePosition.pool.name}`,
        description: `Curve liquidity position in ${curvePosition.pool.name} pool`,
        url: `https://curve.fi/#/ethereum/pools/${curvePosition.pool.poolAddress}/deposit`,

        suppliedTokens,

        poolInfo: {
          poolAddress: curvePosition.pool.poolAddress,
          poolName: curvePosition.pool.name,
          fee: Number(curvePosition.pool.fee) / 1e10, // Convert from basis points
          totalLiquidity: 0, // Would need additional calculation
        },

        lpTokens: {
          address: curvePosition.pool.lpToken,
          amount: curvePosition.lpBalance.toString(),
          share: curvePosition.sharePercent,
        },

        fees: curvePosition.gauge ? {
          pendingFees: rewards.map(reward => ({
            token: reward.token,
            amount: reward.amount,
            valueUSD: reward.valueUSD || 0,
          })),
        } : undefined,

        totalValueUSD,
        netValueUSD: totalValueUSD + totalRewardsUSD,
        yieldInfo: yieldInfo.length > 0 ? yieldInfo : undefined,
        rewards: rewards.length > 0 ? rewards : undefined,
        riskMetrics,

        createdAt: new Date(),
        lastUpdatedAt: new Date(),

        protocolData: {
          poolType: curvePosition.pool.poolType,
          virtualPrice: curvePosition.pool.virtualPrice.toString(),
          A: curvePosition.pool.A.toString(),
          gaugeAddress: curvePosition.gauge?.gaugeAddress,
          stakedBalance: curvePosition.gauge?.stakedBalance.toString(),
          workingBalance: curvePosition.gauge?.workingBalance.toString(),
          gaugeWeight: curvePosition.gauge?.weight.toString(),
          relativeWeight: curvePosition.gauge?.relativeWeight.toString(),
        },
      };

      return position;
    } catch (error) {
      logger.error('Failed to convert Curve position to DeFi position', { error });
      return null;
    }
  }

  private async getGaugeRewardTokens(
    gauge: ethers.Contract,
    address: string
  ): Promise<{ address: string; symbol: string; claimableAmount: bigint }[]> {
    const rewardTokens: { address: string; symbol: string; claimableAmount: bigint }[] = [];

    try {
      const rewardCount = await gauge.reward_count() as bigint;
      const count = Number(rewardCount);

      for (let i = 0; i < Math.min(count, 5); i++) {
        try {
          const tokenAddress = await gauge.reward_tokens(i) as string;
          if (tokenAddress === ethers.ZeroAddress) continue;

          const claimableAmount = await gauge.claimable_reward(address, tokenAddress) as bigint;
          
          if (claimableAmount > 0n) {
            // Get token symbol (simplified)
            const symbol = await this.getTokenSymbol(tokenAddress);
            
            rewardTokens.push({
              address: tokenAddress,
              symbol,
              claimableAmount,
            });
          }
        } catch (error) {
          logger.warn(`Failed to get reward token at index ${i}`, { error });
        }
      }

      return rewardTokens;
    } catch (error) {
      logger.warn('Failed to get gauge reward tokens', { error });
      return [];
    }
  }

  private async getLPTokenFromGauge(gaugeAddress: string, chainId: ChainId): Promise<string> {
    // This would typically require additional contract calls or API lookups
    // For now, return a placeholder
    return ethers.ZeroAddress;
  }

  private async getGaugeRewards(gaugeData: CurveGaugeData, chainId: ChainId): Promise<RewardToken[]> {
    const rewards: RewardToken[] = [];

    // CRV rewards
    if (gaugeData.claimableCRV > 0n) {
      const crvToken = await this.getCRVToken(chainId);
      const crvPrice = await this.getTokenPrice(crvToken.address, chainId);
      const crvAmount = Number(gaugeData.claimableCRV) / Math.pow(10, crvToken.decimals);

      rewards.push({
        token: crvToken,
        amount: gaugeData.claimableCRV.toString(),
        amountFormatted: crvAmount.toFixed(6),
        valueUSD: crvAmount * crvPrice,
      });
    }

    // Additional reward tokens
    for (const rewardToken of gaugeData.rewardTokens) {
      if (rewardToken.claimableAmount > 0n) {
        const token = await this.getTokenInfo(rewardToken.address, chainId);
        const price = await this.getTokenPrice(rewardToken.address, chainId);
        const amount = Number(rewardToken.claimableAmount) / Math.pow(10, token.decimals);

        rewards.push({
          token,
          amount: rewardToken.claimableAmount.toString(),
          amountFormatted: amount.toFixed(6),
          valueUSD: amount * price,
        });
      }
    }

    return rewards;
  }

  private async getCRVToken(chainId: ChainId): Promise<DeFiToken> {
    const crvAddresses: Record<ChainId, string> = {
      [ChainId.ETHEREUM]: '0xD533a949740bb3306d119CC777fa900bA034cd52',
      [ChainId.POLYGON]: '0x172370d5Cd63279eFa6d502DAB29171933a610AF',
      [ChainId.ARBITRUM]: '0x11cDb42B0EB46D95f990BeDD4695A6e3fA034978',
      [ChainId.OPTIMISM]: '0x0994206dfE8De6Ec6920FF4D779B0d950605Fb53',
    };

    const address = crvAddresses[chainId] || crvAddresses[ChainId.ETHEREUM];
    
    return {
      address,
      chainId,
      symbol: 'CRV',
      name: 'Curve DAO Token',
      decimals: 18,
      priceUSD: await this.getTokenPrice(address, chainId),
    };
  }

  private async getTokenInfo(tokenAddress: string, chainId: ChainId): Promise<DeFiToken> {
    const cacheKey = `curve-token-info:${chainId}:${tokenAddress}`;
    const cached = await redisManager.get<DeFiToken>(cacheKey);
    
    if (cached) {
      return cached;
    }

    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`No provider for chain ${chainId}`);
    }

    try {
      const token = new ethers.Contract(tokenAddress, CRV_TOKEN_ABI, provider);
      
      const [symbol, name, decimals] = await Promise.all([
        token.symbol() as Promise<string>,
        token.name() as Promise<string>,
        token.decimals() as Promise<number>,
      ]);

      const tokenInfo: DeFiToken = {
        address: tokenAddress,
        chainId,
        symbol,
        name,
        decimals,
        priceUSD: await this.getTokenPrice(tokenAddress, chainId),
      };

      // Cache for 1 hour
      await redisManager.set(cacheKey, tokenInfo, 3600);
      
      return tokenInfo;
    } catch (error) {
      logger.warn(`Failed to get token info for ${tokenAddress}`, { error });
      return {
        address: tokenAddress,
        chainId,
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        decimals: 18,
        priceUSD: 1,
      };
    }
  }

  private async getTokenSymbol(tokenAddress: string): Promise<string> {
    // Simplified token symbol lookup
    const commonTokens: Record<string, string> = {
      '0xD533a949740bb3306d119CC777fa900bA034cd52': 'CRV',
      '0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B': 'CVX',
      '0xA0b86a33E6441b8435b6BA10D7C6F8C7e7EaEe5A': 'USDC',
      '0xdAC17F958D2ee523a2206206994597C13D831ec7': 'USDT',
      '0x6B175474E89094C44Da98b954EedeAC495271d0F': 'DAI',
    };

    return commonTokens[tokenAddress] || 'UNKNOWN';
  }

  private async calculatePoolApy(poolAddress: string, chainId: ChainId): Promise<number> {
    try {
      // In production, this would use historical data to calculate APY
      // For now, return estimated APY based on pool type
      const poolInfo = await this.getPoolInfo(poolAddress, chainId);
      
      if (!poolInfo) return 0;

      // Base APY varies by pool type and current market conditions
      if (poolInfo.nCoins === 3 && poolAddress.includes('bEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7')) {
        return 1.5; // 3pool typically has low but stable returns
      }
      
      // Default estimate for other pools
      return 2.5;
    } catch (error) {
      logger.warn('Failed to calculate pool APY', { error, poolAddress });
      return 0;
    }
  }

  private async calculatePoolCRVApy(poolAddress: string, chainId: ChainId): Promise<number> {
    try {
      // This would require complex calculations involving:
      // - Gauge weight
      // - Total CRV emission rate
      // - Pool TVL
      // - CRV price
      // - Boost multiplier
      
      // Simplified estimate
      return 3.0;
    } catch (error) {
      logger.warn('Failed to calculate CRV APY', { error, poolAddress });
      return 0;
    }
  }

  private async calculateCRVApy(gaugeData: CurveGaugeData, chainId: ChainId): Promise<number> {
    try {
      // Simplified CRV APY calculation
      // In production, this would use:
      // - Current CRV emission rate
      // - Gauge weight and relative weight
      // - Total staked amount
      // - CRV price
      // - User's boost multiplier
      
      const relativeWeight = Number(gaugeData.relativeWeight) / 1e18;
      const baseApy = relativeWeight * 15; // Estimated base APY
      
      return Math.min(baseApy, 50); // Cap at 50% APY
    } catch (error) {
      logger.warn('Failed to calculate CRV APY', { error });
      return 0;
    }
  }

  private calculateImpermanentLoss(poolType: 'stable' | 'crypto' | 'meta'): number {
    // Curve pools generally have lower IL than Uniswap
    switch (poolType) {
      case 'stable':
        return 0.001; // Very low IL for stablecoin pools
      case 'crypto':
        return 0.02; // Higher IL for crypto pools
      case 'meta':
        return 0.005; // Low IL for meta pools
      default:
        return 0.01;
    }
  }

  private async getTokenPrice(tokenAddress: string, chainId: ChainId): Promise<number> {
    try {
      const cacheKey = `token-price:${chainId}:${tokenAddress.toLowerCase()}`;
      const cached = await redisManager.get<number>(cacheKey);
      
      if (cached) {
        return cached;
      }

      // Enhanced token prices for Curve ecosystem
      const tokenPrices: Record<string, Record<string, number>> = {
        [ChainId.ETHEREUM]: {
          // Stablecoins
          '0x6b175474e89094c44da98b954eedeac495271d0f': 1, // DAI
          '0xa0b86a33e6441b8435b6ba10d7c6f8c7e7eaee5a': 1, // USDC
          '0xdac17f958d2ee523a2206206994597c13d831ec7': 1, // USDT
          '0x853d955acef822db058eb8505911ed77f175b99e': 1, // FRAX
          '0x5f98805a4e8be255a32880fdec7f6728c6568ba0': 1, // LUSD
          '0x57ab1ec28d129707052df4df418d58a2d46d5f51': 1, // sUSD
          
          // Major tokens
          '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 2000, // WETH
          '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 45000, // WBTC
          '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': 2100, // stETH
          '0xae78736cd615f374d3085123a210448e74fc6393': 2050, // rETH
          
          // Curve ecosystem
          '0xd533a949740bb3306d119cc777fa900ba034cd52': 0.5, // CRV
          '0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b': 4.5, // CVX
          '0x6c3f90f043a72fa612cbac8115ee7e52bde6e490': 1.02, // 3CRV
        },
        [ChainId.POLYGON]: {
          '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 1, // USDC
          '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 1, // USDT
          '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063': 1, // DAI
          '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': 0.8, // WMATIC
          '0x172370d5cd63279efa6d502dab29171933a610af': 0.5, // CRV
        },
        [ChainId.ARBITRUM]: {
          '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8': 1, // USDC
          '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 1, // USDT
          '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 1, // DAI
          '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 2000, // WETH
          '0x11cdb42b0eb46d95f990bedd4695a6e3fa034978': 0.5, // CRV
        },
        [ChainId.OPTIMISM]: {
          '0x7f5c764cbc14f9669b88837ca1490cca17c31607': 1, // USDC
          '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': 1, // USDT
          '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 1, // DAI
          '0x4200000000000000000000000000000000000006': 2000, // WETH
          '0x0994206dfe8de6ec6920ff4d779b0d950605fb53': 0.5, // CRV
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
export const createCurveAdapter = (rpcUrls: Partial<Record<ChainId, string>>): CurveAdapter => {
  return new CurveAdapter(rpcUrls);
};