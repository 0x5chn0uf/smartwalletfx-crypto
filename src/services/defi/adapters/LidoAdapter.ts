import axios from 'axios';
import { ethers } from 'ethers';
import { logger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { ChainId } from '@/types/blockchain';
import {
  DeFiProtocol,
  DeFiPosition,
  ProtocolAdapter,
  ProtocolHealth,
  ProtocolMetadata,
  PositionType,
  PositionStatus,
  RiskLevel,
  DeFiToken,
  YieldInfo,
  RiskMetrics,
  StakingPosition,
} from '@/types/defi';

// Lido contract addresses by chain
const LIDO_ADDRESSES: Record<ChainId, {
  stETH: string;
  wstETH: string;
  withdrawalQueue: string;
  lidoOracle: string;
  apiUrl: string;
}> = {
  [ChainId.ETHEREUM]: {
    stETH: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
    wstETH: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
    withdrawalQueue: '0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1',
    lidoOracle: '0x442af784A788A5bd6F42A01Ebe9F287a871243fb',
    apiUrl: 'https://stake.lido.fi/api/short-lido-stats',
  },
  [ChainId.POLYGON]: {
    stETH: '0x0000000000000000000000000000000000000000', // Not available
    wstETH: '0x03b54A6e9a984069379fae1a4fC4dBAE93B3bCCD',
    withdrawalQueue: '0x0000000000000000000000000000000000000000',
    lidoOracle: '0x0000000000000000000000000000000000000000',
    apiUrl: 'https://polygon.lido.fi/api/stats',
  },
  [ChainId.OPTIMISM]: {
    stETH: '0x0000000000000000000000000000000000000000',
    wstETH: '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb',
    withdrawalQueue: '0x0000000000000000000000000000000000000000',
    lidoOracle: '0x0000000000000000000000000000000000000000',
    apiUrl: 'https://optimism.lido.fi/api/stats',
  },
};

// Lido stETH ABI (simplified)
const STETH_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function totalSupply() external view returns (uint256)',
  'function getTotalShares() external view returns (uint256)',
  'function sharesOf(address _owner) external view returns (uint256)',
  'function getSharesByPooledEth(uint256 _ethAmount) external view returns (uint256)',
  'function getPooledEthByShares(uint256 _sharesAmount) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function getTotalPooledEther() external view returns (uint256)',
];

// Lido wstETH ABI (simplified)
const WSTETH_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function totalSupply() external view returns (uint256)',
  'function wrap(uint256 _stETHAmount) external returns (uint256)',
  'function unwrap(uint256 _wstETHAmount) external returns (uint256)',
  'function getWstETHByStETH(uint256 _stETHAmount) external view returns (uint256)',
  'function getStETHByWstETH(uint256 _wstETHAmount) external view returns (uint256)',
  'function stEthPerToken() external view returns (uint256)',
  'function tokensPerStEth() external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
];

// Lido Withdrawal Queue ABI (simplified)
const WITHDRAWAL_QUEUE_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function getWithdrawalStatus(uint256[] requestIds) external view returns (tuple(uint256 amountOfStETH, uint256 amountOfShares, address owner, uint256 timestamp, bool isFinalized, bool isClaimed)[])',
  'function getWithdrawalRequests(address owner) external view returns (uint256[])',
  'function getLastRequestId() external view returns (uint256)',
  'function findCheckpointHints(uint256[] requestIds, uint256 firstIndex, uint256 lastIndex) external view returns (uint256[])',
];

// Interface definitions for Lido
interface LidoStatsResponse {
  apr: number;
  totalStaked: string;
  marketCap: string;
  totalRewards: string;
  stakingRewards: string;
}

interface LidoStakingPosition {
  stETHBalance: bigint;
  stETHShares: bigint;
  wstETHBalance: bigint;
  totalStETHValue: bigint;
  totalValueUSD: number;
}

interface LidoWithdrawalRequest {
  requestId: bigint;
  amountOfStETH: bigint;
  amountOfShares: bigint;
  timestamp: bigint;
  isFinalized: boolean;
  isClaimed: boolean;
}

interface StakingYieldPeriod {
  period: string;
  startDate: Date;
  endDate: Date;
  startBalance: number;
  endBalance: number;
  rewards: number;
  apr: number;
  apy: number;
}

export class LidoAdapter implements ProtocolAdapter {
  readonly protocol = DeFiProtocol.LIDO;
  readonly supportedChains = [ChainId.ETHEREUM, ChainId.POLYGON, ChainId.OPTIMISM];
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
  private statsCache: Map<string, any> = new Map();

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
          logger.info(`Lido adapter initialized for ${chainId}`, { chainId });
        } catch (error) {
          logger.error(`Failed to initialize Lido provider for ${chainId}`, { error, chainId });
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
      
      // Test Lido API
      const apiResponse = await axios.get(LIDO_ADDRESSES[testChain].apiUrl, {
        timeout: 10000,
      });
      
      this.health.responseTime = Date.now() - startTime;
      this.health.isHealthy = true;
      this.health.issues = [];
      this.health.lastCheckedAt = new Date();
      
      return apiResponse.status === 200;
    } catch (error) {
      this.health.isHealthy = false;
      this.health.issues = [error instanceof Error ? error.message : 'Unknown error'];
      this.health.lastCheckedAt = new Date();
      
      logger.warn('Lido adapter health check failed', { error });
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
        const chainPositions = await this.getStakingPositions(address, chain);
        positions.push(...chainPositions);
      } catch (error) {
        logger.error(`Failed to get Lido positions for chain ${chain}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          address,
          chainId: chain,
        });
      }
    }

    return positions;
  }

  async getPosition(positionId: string, chainId: ChainId): Promise<DeFiPosition | null> {
    // Position ID format: lido:{chainId}:{tokenType}:{address}
    const [protocol, chain, tokenType, userAddress] = positionId.split(':');
    
    if (protocol !== 'lido' || chain !== chainId.toString()) {
      return null;
    }

    try {
      const positions = await this.getStakingPositions(userAddress, chainId);
      return positions.find(pos => pos.id === positionId) || null;
    } catch (error) {
      logger.error(`Failed to get Lido position ${positionId}`, { error });
      return null;
    }
  }

  getProtocolMetadata(): ProtocolMetadata {
    return {
      name: 'Lido',
      description: 'Lido is a liquid staking solution for Ethereum 2.0 and other proof-of-stake blockchains.',
      website: 'https://lido.fi',
      logoUrl: 'https://cryptologos.cc/logos/lido-dao-ldo-logo.png',
      supportedAssets: ['ETH', 'stETH', 'wstETH'],
      features: [
        'Liquid staking for ETH 2.0',
        'Daily staking rewards',
        'No lockup period',
        'Withdrawal queue system',
        'Validator diversification',
        'DAO governance',
      ],
    };
  }

  // Lido-specific methods
  public async getStakingPositions(address: string, chainId: ChainId): Promise<DeFiPosition[]> {
    const provider = this.providers.get(chainId);
    const contractAddresses = LIDO_ADDRESSES[chainId];

    if (!provider || !contractAddresses) {
      logger.warn(`No provider or contract addresses for Lido on chain ${chainId}`);
      return [];
    }

    const cacheKey = `lido-positions:${chainId}:${address}`;
    const cached = await redisManager.get<DeFiPosition[]>(cacheKey);
    
    if (cached) {
      logger.debug(`Lido positions cache hit for ${address} on ${chainId}`);
      return cached;
    }

    try {
      const positions: DeFiPosition[] = [];

      // Get stETH position
      if (contractAddresses.stETH && contractAddresses.stETH !== '0x0000000000000000000000000000000000000000') {
        const stETHPosition = await this.getStETHPosition(address, chainId);
        if (stETHPosition) {
          positions.push(stETHPosition);
        }
      }

      // Get wstETH position
      if (contractAddresses.wstETH && contractAddresses.wstETH !== '0x0000000000000000000000000000000000000000') {
        const wstETHPosition = await this.getWstETHPosition(address, chainId);
        if (wstETHPosition) {
          positions.push(wstETHPosition);
        }
      }

      // Get withdrawal requests (only on Ethereum mainnet)
      if (chainId === ChainId.ETHEREUM && contractAddresses.withdrawalQueue) {
        const withdrawalPositions = await this.getWithdrawalRequests(address, chainId);
        positions.push(...withdrawalPositions);
      }

      // Cache the results
      await redisManager.set(cacheKey, positions, 300); // 5 minutes cache

      logger.info(`Fetched ${positions.length} Lido positions for ${address} on ${chainId}`);
      return positions;

    } catch (error) {
      logger.error(`Failed to fetch Lido positions for ${address} on ${chainId}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  public async getStETHBalance(address: string, chainId: ChainId = ChainId.ETHEREUM): Promise<{
    balance: number;
    shares: number;
    rewards: number;
    valueUSD: number;
  } | null> {
    const provider = this.providers.get(chainId);
    const contractAddress = LIDO_ADDRESSES[chainId]?.stETH;

    if (!provider || !contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    try {
      const stETH = new ethers.Contract(contractAddress, STETH_ABI, provider);
      
      const [balance, shares] = await Promise.all([
        stETH.balanceOf(address) as Promise<bigint>,
        stETH.sharesOf(address) as Promise<bigint>,
      ]);

      if (balance === 0n) {
        return null;
      }

      const balanceFormatted = Number(balance) / 1e18;
      const sharesFormatted = Number(shares) / 1e18;
      const ethPrice = await this.getETHPrice();
      const valueUSD = balanceFormatted * ethPrice;

      // Calculate rewards (simplified - difference between balance and initial shares)
      const rewards = balanceFormatted - sharesFormatted;

      return {
        balance: balanceFormatted,
        shares: sharesFormatted,
        rewards: Math.max(0, rewards),
        valueUSD,
      };
    } catch (error) {
      logger.error(`Failed to get stETH balance for ${address}`, { error, chainId });
      return null;
    }
  }

  public async getWstETHPosition(address: string, chainId: ChainId): Promise<DeFiPosition | null> {
    const provider = this.providers.get(chainId);
    const contractAddress = LIDO_ADDRESSES[chainId]?.wstETH;

    if (!provider || !contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    try {
      const wstETH = new ethers.Contract(contractAddress, WSTETH_ABI, provider);
      const balance = await wstETH.balanceOf(address) as bigint;
      
      if (balance === 0n) {
        return null;
      }

      // Convert wstETH to stETH equivalent
      const stETHAmount = await wstETH.getStETHByWstETH(balance) as bigint;
      const balanceFormatted = Number(balance) / 1e18;
      const stETHFormatted = Number(stETHAmount) / 1e18;
      
      const ethPrice = await this.getETHPrice();
      const valueUSD = stETHFormatted * ethPrice;

      // Skip dust positions
      if (valueUSD < 0.01) {
        return null;
      }

      // Get yield info
      const lidoStats = await this.getLidoStats(chainId);
      const currentAPR = lidoStats?.apr || 4.0; // Default 4% if stats unavailable

      const defiToken: DeFiToken = {
        address: contractAddress,
        chainId,
        symbol: 'wstETH',
        name: 'Wrapped Liquid Staked Ether 2.0',
        decimals: 18,
        priceUSD: ethPrice,
      };

      const yieldInfo: YieldInfo[] = [{
        apy: this.aprToApy(currentAPR),
        apr: currentAPR,
        source: 'staking',
        isCompounding: true,
        calculatedAt: new Date(),
      }];

      const riskMetrics: RiskMetrics = {
        liquidationRisk: RiskLevel.LOW, // Lido is generally low risk
      };

      const position: StakingPosition = {
        id: `lido:${chainId}:wstETH:${address}`,
        protocol: DeFiProtocol.LIDO,
        chainId,
        type: PositionType.STAKING,
        status: PositionStatus.ACTIVE,
        name: 'Lido wstETH Staking',
        description: 'Wrapped staked ETH position on Lido',
        url: 'https://stake.lido.fi',

        suppliedTokens: [{
          token: defiToken,
          amount: balance.toString(),
          amountFormatted: balanceFormatted.toFixed(6),
          valueUSD,
        }],

        stakingInfo: {
          stakedAmount: balance.toString(),
          stakedAmountFormatted: balanceFormatted.toFixed(6),
          stakedValueUSD: valueUSD,
        },

        totalValueUSD: valueUSD,
        netValueUSD: valueUSD,
        yieldInfo,
        riskMetrics,

        createdAt: new Date(),
        lastUpdatedAt: new Date(),

        protocolData: {
          tokenType: 'wstETH',
          wstETHBalance: balance.toString(),
          stETHEquivalent: stETHAmount.toString(),
          exchangeRate: Number(stETHAmount) / Number(balance),
        },
      };

      return position;
    } catch (error) {
      logger.error(`Failed to get wstETH position for ${address}`, { error, chainId });
      return null;
    }
  }

  public async getWithdrawalRequests(address: string, chainId: ChainId = ChainId.ETHEREUM): Promise<DeFiPosition[]> {
    const provider = this.providers.get(chainId);
    const contractAddress = LIDO_ADDRESSES[chainId]?.withdrawalQueue;

    if (!provider || !contractAddress) {
      return [];
    }

    try {
      const withdrawalQueue = new ethers.Contract(contractAddress, WITHDRAWAL_QUEUE_ABI, provider);
      
      // Get number of withdrawal NFTs owned by the address
      const balance = await withdrawalQueue.balanceOf(address) as bigint;
      
      if (balance === 0n) {
        return [];
      }

      // For simplicity, we'll create a single position representing all withdrawal requests
      // In a full implementation, you'd iterate through each NFT and get detailed status
      
      const ethPrice = await this.getETHPrice();
      const totalValueUSD = 100; // Placeholder - would calculate actual pending amount

      const defiToken: DeFiToken = {
        address: LIDO_ADDRESSES[chainId].stETH,
        chainId,
        symbol: 'stETH',
        name: 'Liquid Staked Ether 2.0',
        decimals: 18,
        priceUSD: ethPrice,
      };

      const riskMetrics: RiskMetrics = {
        liquidationRisk: RiskLevel.LOW,
      };

      const position: StakingPosition = {
        id: `lido:${chainId}:withdrawal:${address}`,
        protocol: DeFiProtocol.LIDO,
        chainId,
        type: PositionType.STAKING,
        status: PositionStatus.INACTIVE, // Pending withdrawal
        name: 'Lido Withdrawal Requests',
        description: 'Pending ETH withdrawal requests from Lido',
        url: 'https://stake.lido.fi/withdrawals',

        suppliedTokens: [{
          token: defiToken,
          amount: '0', // Would calculate actual amount
          amountFormatted: '0.000000',
          valueUSD: totalValueUSD,
        }],

        stakingInfo: {
          stakedAmount: '0',
          stakedAmountFormatted: '0.000000',
          stakedValueUSD: totalValueUSD,
          isUnbonding: true,
          unbondingAmount: balance.toString(),
        },

        totalValueUSD,
        netValueUSD: totalValueUSD,
        riskMetrics,

        createdAt: new Date(),
        lastUpdatedAt: new Date(),

        protocolData: {
          tokenType: 'withdrawal',
          requestCount: Number(balance),
        },
      };

      return [position];
    } catch (error) {
      logger.error(`Failed to get withdrawal requests for ${address}`, { error, chainId });
      return [];
    }
  }

  public async calculateStakingYield(address: string, period: string, chainId: ChainId = ChainId.ETHEREUM): Promise<StakingYieldPeriod | null> {
    // This would require historical data - placeholder implementation
    const currentBalance = await this.getStETHBalance(address, chainId);
    
    if (!currentBalance) {
      return null;
    }

    // Mock historical calculation
    const periodDays = period === '1d' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 365;
    const startDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
    const endDate = new Date();
    
    // Simulate historical balance (in production, would fetch from historical data)
    const estimatedStartBalance = currentBalance.balance * 0.99; // Assume 1% growth
    const rewards = currentBalance.balance - estimatedStartBalance;
    const apr = (rewards / estimatedStartBalance) * (365 / periodDays) * 100;
    const apy = this.aprToApy(apr);

    return {
      period,
      startDate,
      endDate,
      startBalance: estimatedStartBalance,
      endBalance: currentBalance.balance,
      rewards,
      apr,
      apy,
    };
  }

  private async getStETHPosition(address: string, chainId: ChainId): Promise<DeFiPosition | null> {
    const stETHBalance = await this.getStETHBalance(address, chainId);
    
    if (!stETHBalance || stETHBalance.valueUSD < 0.01) {
      return null;
    }

    const contractAddress = LIDO_ADDRESSES[chainId].stETH;
    const ethPrice = await this.getETHPrice();
    
    // Get yield info
    const lidoStats = await this.getLidoStats(chainId);
    const currentAPR = lidoStats?.apr || 4.0;

    const defiToken: DeFiToken = {
      address: contractAddress,
      chainId,
      symbol: 'stETH',
      name: 'Liquid Staked Ether 2.0',
      decimals: 18,
      priceUSD: ethPrice,
    };

    const yieldInfo: YieldInfo[] = [{
      apy: this.aprToApy(currentAPR),
      apr: currentAPR,
      source: 'staking',
      isCompounding: true,
      calculatedAt: new Date(),
    }];

    const riskMetrics: RiskMetrics = {
      liquidationRisk: RiskLevel.LOW,
    };

    const position: StakingPosition = {
      id: `lido:${chainId}:stETH:${address}`,
      protocol: DeFiProtocol.LIDO,
      chainId,
      type: PositionType.STAKING,
      status: PositionStatus.ACTIVE,
      name: 'Lido stETH Staking',
      description: 'Liquid staked ETH position on Lido',
      url: 'https://stake.lido.fi',

      suppliedTokens: [{
        token: defiToken,
        amount: (BigInt(Math.floor(stETHBalance.balance * 1e18))).toString(),
        amountFormatted: stETHBalance.balance.toFixed(6),
        valueUSD: stETHBalance.valueUSD,
      }],

      stakingInfo: {
        stakedAmount: (BigInt(Math.floor(stETHBalance.balance * 1e18))).toString(),
        stakedAmountFormatted: stETHBalance.balance.toFixed(6),
        stakedValueUSD: stETHBalance.valueUSD,
      },

      rewards: stETHBalance.rewards > 0 ? [{
        token: defiToken,
        amount: (BigInt(Math.floor(stETHBalance.rewards * 1e18))).toString(),
        amountFormatted: stETHBalance.rewards.toFixed(6),
        valueUSD: stETHBalance.rewards * ethPrice,
        apy: currentAPR,
      }] : undefined,

      totalValueUSD: stETHBalance.valueUSD,
      netValueUSD: stETHBalance.valueUSD,
      yieldInfo,
      riskMetrics,

      createdAt: new Date(),
      lastUpdatedAt: new Date(),

      protocolData: {
        tokenType: 'stETH',
        balance: stETHBalance.balance,
        shares: stETHBalance.shares,
        rewards: stETHBalance.rewards,
        rewardRate: currentAPR,
      },
    };

    return position;
  }

  private async getLidoStats(chainId: ChainId): Promise<LidoStatsResponse | null> {
    const cacheKey = `lido-stats:${chainId}`;
    const cached = this.statsCache.get(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      const apiUrl = LIDO_ADDRESSES[chainId]?.apiUrl;
      if (!apiUrl) {
        return null;
      }

      const response = await axios.get<LidoStatsResponse>(apiUrl, {
        timeout: 10000,
      });

      const stats = response.data;
      this.statsCache.set(cacheKey, stats);
      
      // Cache for 5 minutes
      setTimeout(() => {
        this.statsCache.delete(cacheKey);
      }, 300000);

      return stats;
    } catch (error) {
      logger.error(`Failed to fetch Lido stats for chain ${chainId}`, { error });
      return null;
    }
  }

  private async getETHPrice(): Promise<number> {
    try {
      const cacheKey = 'eth-price';
      const cached = await redisManager.get<number>(cacheKey);
      
      if (cached) {
        return cached;
      }

      // In production, integrate with price feeds
      const ethPrice = 2000; // Mock price
      
      await redisManager.set(cacheKey, ethPrice, 300); // 5 minutes cache
      return ethPrice;
    } catch (error) {
      logger.warn('Failed to get ETH price', { error });
      return 2000; // Fallback price
    }
  }

  private aprToApy(apr: number): number {
    // Convert APR to APY with daily compounding
    const n = 365; // Daily compounding
    return ((1 + apr / 100 / n) ** n - 1) * 100;
  }
}

// Factory function
export const createLidoAdapter = (rpcUrls: Partial<Record<ChainId, string>>): LidoAdapter => {
  return new LidoAdapter(rpcUrls);
};