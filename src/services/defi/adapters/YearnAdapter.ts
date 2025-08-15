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
  VaultPosition,
} from '@/types/defi';

// Yearn Finance contract addresses by chain
const YEARN_ADDRESSES: Record<ChainId, {
  vaultRegistry: string;
  vaultRegistryV2: string;
  lens: string;
  apiUrl: string;
}> = {
  [ChainId.ETHEREUM]: {
    vaultRegistry: '0x50c1a2eA0a861A967D9d0FFE2AE4012c2E053804',
    vaultRegistryV2: '0xaF1f5e1c19cB68B30aAD73846eFfDf78a5863319',
    lens: '0x83d95e0D5f402511dB06817Aff3f9eA88224B030',
    apiUrl: 'https://api.yearn.fi/v1/chains/1/vaults/all',
  },
  [ChainId.POLYGON]: {
    vaultRegistry: '0xE14d13d8B3b85aF791b2AADD661cDBd5E6097Db1',
    vaultRegistryV2: '0x0000000000000000000000000000000000000000',
    lens: '0x0000000000000000000000000000000000000000',
    apiUrl: 'https://api.yearn.fi/v1/chains/137/vaults/all',
  },
  [ChainId.ARBITRUM]: {
    vaultRegistry: '0x3199437193625DCcD6F9C9e98BDf93582200Eb1f',
    vaultRegistryV2: '0x0000000000000000000000000000000000000000',
    lens: '0x043518AB266485dC085a1DB095B8d9C2Fc78E9b9',
    apiUrl: 'https://api.yearn.fi/v1/chains/42161/vaults/all',
  },
  [ChainId.OPTIMISM]: {
    vaultRegistry: '0x79286Dd38C9017E5423073bAc11F53357Fc5C128',
    vaultRegistryV2: '0x0000000000000000000000000000000000000000',
    lens: '0x0000000000000000000000000000000000000000',
    apiUrl: 'https://api.yearn.fi/v1/chains/10/vaults/all',
  },
};

// Yearn Vault ABI (simplified)
const YEARN_VAULT_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function totalSupply() external view returns (uint256)',
  'function totalAssets() external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function asset() external view returns (address)',
  'function pricePerShare() external view returns (uint256)',
  'function convertToAssets(uint256 shares) external view returns (uint256)',
  'function convertToShares(uint256 assets) external view returns (uint256)',
];

// Yearn Registry ABI (simplified)
const YEARN_REGISTRY_ABI = [
  'function numVaults(address token) external view returns (uint256)',
  'function vaults(address token, uint256 deploymentId) external view returns (address)',
  'function latestVault(address token) external view returns (address)',
];

// Yearn Lens ABI (simplified)
const YEARN_LENS_ABI = [
  'function assetsAddresses() external view returns (address[] memory)',
  'function assetsStatic() external view returns (tuple(address id, string typeId, address tokenId, string name, string version, string symbol, uint8 decimals)[])',
];

// ERC20 ABI (simplified)
const ERC20_ABI = [
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function decimals() external view returns (uint8)',
  'function balanceOf(address owner) external view returns (uint256)',
];

// Interface definitions for Yearn
interface YearnVaultInfo {
  address: string;
  symbol: string;
  name: string;
  token: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
  };
  version: string;
  apy: {
    type: string;
    gross_apr: number;
    net_apy: number;
    fees: {
      performance?: number;
      withdrawal?: number;
      management?: number;
      keep_crv?: number;
      cvx_keep_crv?: number;
    };
  };
  tvl: {
    total_assets: string;
    tvl: number;
    price: number;
  };
  strategies: Array<{
    address: string;
    name: string;
    description?: string;
    risk_score?: number;
    total_assets?: string;
    total_debt?: string;
  }>;
}

interface YearnVaultPosition {
  vaultAddress: string;
  tokenAddress: string;
  shares: bigint;
  assets: bigint;
  pricePerShare: bigint;
  decimals: number;
}

interface YearnVaultDetails {
  vault: YearnVaultInfo;
  userPosition?: YearnVaultPosition;
  historicalData?: {
    deposits: Array<{
      timestamp: number;
      amount: string;
      txHash: string;
    }>;
    withdrawals: Array<{
      timestamp: number;
      amount: string;
      txHash: string;
    }>;
  };
}

export class YearnAdapter implements ProtocolAdapter {
  readonly protocol = DeFiProtocol.YEARN;
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
  private vaultCache: Map<string, YearnVaultInfo[]> = new Map();

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
          logger.info(`Yearn adapter initialized for ${chainId}`, { chainId });
        } catch (error) {
          logger.error(`Failed to initialize Yearn provider for ${chainId}`, { error, chainId });
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
      
      // Test Yearn API
      const apiResponse = await axios.get(YEARN_ADDRESSES[testChain].apiUrl, {
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
      
      logger.warn('Yearn adapter health check failed', { error });
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
        const chainPositions = await this.getVaultPositions(address, chain);
        positions.push(...chainPositions);
      } catch (error) {
        logger.error(`Failed to get Yearn positions for chain ${chain}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          address,
          chainId: chain,
        });
      }
    }

    return positions;
  }

  async getPosition(positionId: string, chainId: ChainId): Promise<DeFiPosition | null> {
    // Position ID format: yearn:{chainId}:{vaultAddress}
    const [protocol, chain, vaultAddress] = positionId.split(':');
    
    if (protocol !== 'yearn' || chain !== chainId.toString()) {
      return null;
    }

    try {
      const positions = await this.getVaultPositions('', chainId);
      return positions.find(pos => pos.id === positionId) || null;
    } catch (error) {
      logger.error(`Failed to get Yearn position ${positionId}`, { error });
      return null;
    }
  }

  getProtocolMetadata(): ProtocolMetadata {
    return {
      name: 'Yearn Finance',
      description: 'Yearn Finance is a suite of products in Decentralized Finance (DeFi) that provides lending aggregation, yield generation, and insurance on the Ethereum blockchain.',
      website: 'https://yearn.fi',
      logoUrl: 'https://cryptologos.cc/logos/yearn-finance-yfi-logo.png',
      supportedAssets: ['DAI', 'USDC', 'USDT', 'WETH', 'WBTC', 'YFI', 'LINK', 'UNI'],
      features: [
        'Automated yield farming',
        'Vault strategies optimization',
        'Gas cost optimization',
        'Risk-adjusted returns',
        'Compounding yields',
        'Strategy diversification',
      ],
    };
  }

  // Yearn-specific methods
  public async getVaultPositions(address: string, chainId: ChainId): Promise<DeFiPosition[]> {
    const provider = this.providers.get(chainId);
    const contractAddresses = YEARN_ADDRESSES[chainId];

    if (!provider || !contractAddresses) {
      logger.warn(`No provider or contract addresses for Yearn on chain ${chainId}`);
      return [];
    }

    const cacheKey = `yearn-positions:${chainId}:${address}`;
    const cached = await redisManager.get<DeFiPosition[]>(cacheKey);
    
    if (cached) {
      logger.debug(`Yearn positions cache hit for ${address} on ${chainId}`);
      return cached;
    }

    try {
      // Get all vaults from API
      const vaults = await this.getAllVaults(chainId);
      const positions: DeFiPosition[] = [];

      // Check user balance in each vault
      for (const vault of vaults) {
        try {
          const position = await this.getVaultPosition(address, vault, chainId);
          if (position) {
            positions.push(position);
          }
        } catch (error) {
          logger.warn(`Failed to get position for vault ${vault.address}`, { error, vault: vault.address });
        }
      }

      // Cache the results
      await redisManager.set(cacheKey, positions, 300); // 5 minutes cache

      logger.info(`Fetched ${positions.length} Yearn positions for ${address} on ${chainId}`);
      return positions;

    } catch (error) {
      logger.error(`Failed to fetch Yearn positions for ${address} on ${chainId}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  public async getVaultDetails(vaultAddress: string, chainId: ChainId): Promise<YearnVaultDetails | null> {
    try {
      const vaults = await this.getAllVaults(chainId);
      const vault = vaults.find(v => v.address.toLowerCase() === vaultAddress.toLowerCase());
      
      if (!vault) {
        return null;
      }

      return {
        vault,
        // Additional details can be added here
      };
    } catch (error) {
      logger.error(`Failed to get vault details for ${vaultAddress}`, { error, vaultAddress, chainId });
      return null;
    }
  }

  public async calculateVaultValue(shares: bigint, vaultAddress: string, chainId: ChainId): Promise<number> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      return 0;
    }

    try {
      const vault = new ethers.Contract(vaultAddress, YEARN_VAULT_ABI, provider);
      
      // For Yearn v3 vaults
      try {
        const assets = await vault.convertToAssets(shares) as bigint;
        const tokenAddress = await vault.asset() as string;
        const tokenPrice = await this.getTokenPrice(tokenAddress, chainId);
        
        const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        const decimals = await token.decimals() as number;
        
        const assetValue = Number(assets) / Math.pow(10, decimals);
        return assetValue * tokenPrice;
      } catch {
        // Fallback to v2 calculation
        const pricePerShare = await vault.pricePerShare() as bigint;
        const decimals = await vault.decimals() as number;
        
        const shareValue = (Number(shares) * Number(pricePerShare)) / Math.pow(10, decimals * 2);
        return shareValue;
      }
    } catch (error) {
      logger.error(`Failed to calculate vault value`, { error, vaultAddress, shares: shares.toString() });
      return 0;
    }
  }

  public async getVaultHistory(address: string, vaultAddress: string, chainId: ChainId): Promise<any> {
    // This would typically integrate with The Graph or other indexing services
    // For now, return placeholder data
    logger.info(`Getting vault history for ${address} in vault ${vaultAddress}`);
    return {
      deposits: [],
      withdrawals: [],
    };
  }

  public async getStrategyInfo(vaultAddress: string, chainId: ChainId): Promise<any> {
    try {
      const vaultDetails = await this.getVaultDetails(vaultAddress, chainId);
      return vaultDetails?.vault.strategies || [];
    } catch (error) {
      logger.error(`Failed to get strategy info for vault ${vaultAddress}`, { error });
      return [];
    }
  }

  private async getAllVaults(chainId: ChainId): Promise<YearnVaultInfo[]> {
    const cacheKey = `yearn-vaults:${chainId}`;
    let cached = this.vaultCache.get(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      const apiUrl = YEARN_ADDRESSES[chainId]?.apiUrl;
      if (!apiUrl) {
        return [];
      }

      const response = await axios.get<YearnVaultInfo[]>(apiUrl, {
        timeout: 30000,
      });

      const vaults = response.data.filter(vault => 
        vault.tvl && 
        vault.tvl.tvl > 1000 && // Only vaults with > $1k TVL
        vault.version !== '0.3.0' // Filter out deprecated versions
      );

      this.vaultCache.set(cacheKey, vaults);
      
      // Cache for 10 minutes
      setTimeout(() => {
        this.vaultCache.delete(cacheKey);
      }, 600000);

      return vaults;
    } catch (error) {
      logger.error(`Failed to fetch Yearn vaults for chain ${chainId}`, { error });
      return [];
    }
  }

  private async getVaultPosition(address: string, vault: YearnVaultInfo, chainId: ChainId): Promise<DeFiPosition | null> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      return null;
    }

    try {
      const vaultContract = new ethers.Contract(vault.address, YEARN_VAULT_ABI, provider);
      const shares = await vaultContract.balanceOf(address) as bigint;
      
      if (shares === 0n) {
        return null;
      }

      // Calculate position value
      const valueUSD = await this.calculateVaultValue(shares, vault.address, chainId);
      
      // Skip dust positions
      if (valueUSD < 0.01) {
        return null;
      }

      // Get asset amount
      let assetAmount = 0;
      let assetAmountFormatted = '0';
      
      try {
        const assets = await vaultContract.convertToAssets(shares) as bigint;
        assetAmount = Number(assets) / Math.pow(10, vault.token.decimals);
        assetAmountFormatted = assetAmount.toFixed(6);
      } catch {
        // Fallback calculation for v2 vaults
        const pricePerShare = await vaultContract.pricePerShare() as bigint;
        assetAmount = (Number(shares) * Number(pricePerShare)) / Math.pow(10, vault.token.decimals * 2);
        assetAmountFormatted = assetAmount.toFixed(6);
      }

      // Create DeFi token
      const defiToken: DeFiToken = {
        address: vault.token.address,
        chainId,
        symbol: vault.token.symbol,
        name: vault.token.name,
        decimals: vault.token.decimals,
        priceUSD: vault.tvl?.price || 1,
      };

      // Calculate yield info
      const yieldInfo: YieldInfo[] = [{
        apy: vault.apy?.net_apy || 0,
        apr: vault.apy?.gross_apr || 0,
        source: 'vault',
        isCompounding: true,
        calculatedAt: new Date(),
      }];

      // Risk assessment based on strategies
      const riskLevel = this.assessVaultRisk(vault);
      const riskMetrics: RiskMetrics = {
        liquidationRisk: riskLevel,
      };

      // Create position
      const position: VaultPosition = {
        id: `yearn:${chainId}:${vault.address}`,
        protocol: DeFiProtocol.YEARN,
        chainId,
        type: PositionType.VAULT,
        status: PositionStatus.ACTIVE,
        name: `${vault.name || vault.symbol}`,
        description: `Yearn vault position in ${vault.token.symbol}`,
        url: `https://yearn.fi/vaults/${vault.address}`,

        suppliedTokens: [{
          token: defiToken,
          amount: shares.toString(),
          amountFormatted: assetAmountFormatted,
          valueUSD,
        }],

        vaultInfo: {
          vaultAddress: vault.address,
          vaultName: vault.name || vault.symbol,
          vaultVersion: vault.version,
          shares: shares.toString(),
          sharesFormatted: (Number(shares) / Math.pow(10, 18)).toFixed(6),
          underlyingAssets: (assetAmount * Math.pow(10, vault.token.decimals)).toString(),
          underlyingAssetsFormatted: assetAmountFormatted,
          pricePerShare: vault.tvl?.price || 0,
        },

        strategies: vault.strategies?.map(s => ({
          address: s.address,
          name: s.name,
          description: s.description,
          totalAssets: s.total_assets,
        })) || [],

        fees: {
          managementFee: vault.apy?.fees?.management,
          performanceFee: vault.apy?.fees?.performance,
          withdrawalFee: vault.apy?.fees?.withdrawal,
        },

        totalValueUSD: valueUSD,
        netValueUSD: valueUSD,
        yieldInfo,
        riskMetrics,

        createdAt: new Date(),
        lastUpdatedAt: new Date(),

        protocolData: {
          vaultAddress: vault.address,
          vaultVersion: vault.version,
          tvl: vault.tvl?.tvl || 0,
          apiData: vault,
        },
      };

      return position;

    } catch (error) {
      logger.error(`Failed to get vault position for ${vault.address}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        vault: vault.address,
        address,
      });
      return null;
    }
  }

  private assessVaultRisk(vault: YearnVaultInfo): RiskLevel {
    // Simple risk assessment based on strategies and TVL
    const tvl = vault.tvl?.tvl || 0;
    const strategyCount = vault.strategies?.length || 0;
    
    if (tvl > 100000000) { // >$100M TVL
      return RiskLevel.LOW;
    } else if (tvl > 10000000) { // >$10M TVL
      return strategyCount > 3 ? RiskLevel.MEDIUM : RiskLevel.LOW;
    } else if (tvl > 1000000) { // >$1M TVL
      return RiskLevel.MEDIUM;
    } else {
      return RiskLevel.HIGH;
    }
  }

  private async getTokenPrice(tokenAddress: string, chainId: ChainId): Promise<number> {
    try {
      const cacheKey = `token-price:${chainId}:${tokenAddress.toLowerCase()}`;
      const cached = await redisManager.get<number>(cacheKey);
      
      if (cached) {
        return cached;
      }

      // Mock token prices - in production, integrate with price feeds
      const tokenPrices: Record<string, Record<string, number>> = {
        [ChainId.ETHEREUM]: {
          '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 2000, // WETH
          '0xa0b86a33e6441b8435b6ba10d7c6f8c7e7eaee5a': 1, // USDC
          '0xdac17f958d2ee523a2206206994597c13d831ec7': 1, // USDT
          '0x6b175474e89094c44da98b954eedeac495271d0f': 1, // DAI
          '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 45000, // WBTC
          '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e': 3000, // YFI
        },
      };
      
      const chainPrices = tokenPrices[chainId] || {};
      const price = chainPrices[tokenAddress.toLowerCase()] || 1;
      
      await redisManager.set(cacheKey, price, 300);
      return price;
    } catch (error) {
      logger.warn(`Failed to get price for token ${tokenAddress}`, { error, chainId });
      return 1;
    }
  }
}

// Factory function
export const createYearnAdapter = (rpcUrls: Partial<Record<ChainId, string>>): YearnAdapter => {
  return new YearnAdapter(rpcUrls);
};