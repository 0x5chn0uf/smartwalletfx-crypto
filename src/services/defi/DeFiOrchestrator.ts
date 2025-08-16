import { logger, logPerformance } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { ChainId } from '@/types/blockchain';
import {
  DeFiProtocol,
  DeFiPosition,
  DeFiPortfolioSummary,
  DeFiApiResponse,
  ProtocolAdapter,
  ProtocolHealth,
  PositionType,
  RiskLevel,
} from '@/types/defi';
import { 
  ProtocolAdapterManager, 
  AdapterManagerConfig,
  createProtocolAdapterManager 
} from './ProtocolAdapterManager';
import type { DeFiPort } from '@/ports/DeFiPort';

interface DeFiOrchestratorConfig {
  enabledProtocols: DeFiProtocol[];
  maxConcurrentRequests: number;
  defaultCacheTtl: number;
  healthCheckInterval: number;
  fallbackToCache: boolean;
  rpcUrls: Partial<Record<ChainId, string>>;
}

export class DeFiOrchestrator implements DeFiPort {
  private adapterManager: ProtocolAdapterManager;
  private healthCheckTimer?: NodeJS.Timer;

  constructor(private readonly config: DeFiOrchestratorConfig) {
    // Initialize the adapter manager
    const managerConfig: AdapterManagerConfig = {
      enabledProtocols: config.enabledProtocols,
      healthCheckIntervalMs: config.healthCheckInterval,
      maxRetries: 3,
      retryDelayMs: 5000,
      enableAutoRecovery: true,
      rpcUrls: config.rpcUrls,
    };
    
    this.adapterManager = createProtocolAdapterManager(managerConfig);
    this.startHealthMonitoring();
  }

  /**
   * Initialize the orchestrator and all adapters
   */
  async initialize(): Promise<void> {
    await this.adapterManager.initialize();
    logger.info('DeFi Orchestrator initialized successfully');
  }

  /**
   * Get all registered protocol adapters
   */
  getRegisteredProtocols(): DeFiProtocol[] {
    return this.adapterManager.getAllAdapters().map(adapter => adapter.protocol);
  }

  /**
   * Get health status of all protocol adapters
   */
  getHealthStatus(): Record<DeFiProtocol, ProtocolHealth> {
    const healthMap = this.adapterManager.getHealthStatus();
    return Object.fromEntries(healthMap);
  }

  /**
   * Get DeFi portfolio for a specific address
   */
  async getDeFiPortfolio(
    address: string, 
    options: {
      chainIds?: ChainId[];
      protocols?: DeFiProtocol[];
      includeInactive?: boolean;
    } = {}
  ): Promise<DeFiApiResponse<DeFiPortfolioSummary>> {
    const startTime = Date.now();
    const requestId = `defi-portfolio-${address}-${Date.now()}`;

    try {
      logger.info('Starting DeFi portfolio fetch', {
        address,
        requestId,
        options,
      });

      // Check cache first
      const cacheKey = `defi-portfolio:${address}:${JSON.stringify(options)}`;
      const cached = await redisManager.get<DeFiPortfolioSummary>(cacheKey);
      
      if (cached) {
        logger.debug(`DeFi portfolio cache hit for ${address}`);
        return {
          success: true,
          data: cached,
          metadata: {
            provider: 'DeFiOrchestrator',
            timestamp: Date.now(),
            requestId,
            cacheHit: true,
            executionTime: Date.now() - startTime,
          },
        };
      }

      // Get positions from all adapters
      const positions = await this.fetchPositionsFromAdapters(
        address, 
        options.chainIds, 
        options.protocols
      );

      // Filter positions if needed
      let filteredPositions = positions;
      if (!options.includeInactive) {
        filteredPositions = positions.filter(pos => 
          pos.totalValueUSD > 0.01 // Filter out dust positions
        );
      }

      // Aggregate portfolio data
      const portfolioSummary = this.aggregatePortfolioData(
        address,
        filteredPositions
      );

      // Cache the result
      await redisManager.set(cacheKey, portfolioSummary, this.config.defaultCacheTtl);

      const duration = Date.now() - startTime;
      logPerformance('defi-portfolio-fetch', duration, {
        address,
        positionCount: filteredPositions.length,
        protocolCount: new Set(filteredPositions.map(p => p.protocol)).size,
        totalValueUSD: portfolioSummary.totalValueUSD,
      });

      return {
        success: true,
        data: portfolioSummary,
        metadata: {
          provider: 'DeFiOrchestrator',
          timestamp: Date.now(),
          requestId,
          cacheHit: false,
          executionTime: duration,
        },
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('DeFi portfolio fetch failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address,
        requestId,
        duration,
      });

      // Try to fallback to cached data if enabled
      if (this.config.fallbackToCache) {
        const fallbackKey = `defi-portfolio-fallback:${address}`;
        const fallbackData = await redisManager.get<DeFiPortfolioSummary>(fallbackKey);
        
        if (fallbackData) {
          logger.warn('Using fallback cache data for DeFi portfolio', { address });
          return {
            success: true,
            data: fallbackData,
            metadata: {
              provider: 'DeFiOrchestrator',
              timestamp: Date.now(),
              requestId,
              cacheHit: true,
              executionTime: duration,
            },
          };
        }
      }

      return {
        success: false,
        error: {
          code: 'DEFI_PORTFOLIO_ERROR',
          message: error instanceof Error ? error.message : 'Failed to fetch DeFi portfolio',
          details: { address, requestId },
        },
        metadata: {
          provider: 'DeFiOrchestrator',
          timestamp: Date.now(),
          requestId,
          executionTime: duration,
        },
      };
    }
  }

  /**
   * Get positions for a specific protocol
   */
  async getProtocolPositions(
    protocol: DeFiProtocol,
    address: string,
    chainId?: ChainId
  ): Promise<DeFiApiResponse<DeFiPosition[]>> {
    const adapter = this.adapterManager.getAdapter(protocol);
    const requestId = `protocol-positions-${protocol}-${address}-${Date.now()}`;

    if (!adapter) {
      return {
        success: false,
        error: {
          code: 'ADAPTER_NOT_FOUND',
          message: `No adapter found for protocol: ${protocol}`,
        },
        metadata: {
          provider: 'DeFiOrchestrator',
          timestamp: Date.now(),
          requestId,
        },
      };
    }

    // Check adapter health
    const healthMap = this.adapterManager.getHealthStatus();
    const health = healthMap.get(protocol);
    if (!health?.isHealthy) {
      return {
        success: false,
        error: {
          code: 'ADAPTER_UNHEALTHY',
          message: `Protocol adapter is unhealthy: ${protocol}`,
          details: health?.issues,
        },
        metadata: {
          provider: 'DeFiOrchestrator',
          timestamp: Date.now(),
          requestId,
        },
      };
    }

    const startTime = Date.now();
    try {
      const positions = await adapter.getPositions(address, chainId);
      const duration = Date.now() - startTime;

      logPerformance('protocol-positions-fetch', duration, {
        protocol,
        address,
        chainId,
        positionCount: positions.length,
      });

      return {
        success: true,
        data: positions,
        metadata: {
          provider: adapter.protocol,
          timestamp: Date.now(),
          requestId,
          executionTime: duration,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Protocol positions fetch failed for ${protocol}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        address,
        chainId,
        requestId,
        duration,
      });

      return {
        success: false,
        error: {
          code: 'PROTOCOL_FETCH_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        metadata: {
          provider: adapter.protocol,
          timestamp: Date.now(),
          requestId,
          executionTime: duration,
        },
      };
    }
  }

  /**
   * Get yield opportunities across all protocols
   */
  async getYieldOpportunities(
    chainIds?: ChainId[],
    minAPY: number = 0
  ): Promise<DeFiApiResponse<Array<{
    protocol: DeFiProtocol;
    chainId: ChainId;
    name: string;
    apy: number;
    tvl: number;
    riskLevel: RiskLevel;
  }>>> {
    const requestId = `yield-opportunities-${Date.now()}`;
    
    // This would be implemented to aggregate yield opportunities
    // from all protocols - simplified for now
    return {
      success: true,
      data: [], // TODO: Implement yield opportunity aggregation
      metadata: {
        provider: 'DeFiOrchestrator',
        timestamp: Date.now(),
        requestId,
      },
    };
  }

  /**
   * Fetch positions from all available adapters
   */
  private async fetchPositionsFromAdapters(
    address: string,
    chainIds?: ChainId[],
    protocols?: DeFiProtocol[]
  ): Promise<DeFiPosition[]> {
    // Use adapter manager to get positions
    if (protocols && protocols.length === 1) {
      // Single protocol optimization
      const adapter = this.adapterManager.getAdapter(protocols[0]);
      if (adapter) {
        try {
          return await adapter.getPositions(address, chainIds?.[0]);
        } catch (error) {
          logger.error(`Failed to get positions from ${protocols[0]}:`, error);
          return [];
        }
      }
      return [];
    }
    
    // Multiple protocols - use the manager's aggregation method
    return await this.adapterManager.getAllPositions(address, chainIds?.[0]);
  }

  /**
   * Aggregate portfolio data from individual positions
   */
  private aggregatePortfolioData(
    address: string,
    positions: DeFiPosition[]
  ): DeFiPortfolioSummary {
    const totalValueUSD = positions.reduce((sum, pos) => sum + pos.totalValueUSD, 0);
    const totalSuppliedUSD = positions.reduce((sum, pos) => {
      return sum + pos.suppliedTokens.reduce((tokenSum, token) => 
        tokenSum + (token.valueUSD || 0), 0);
    }, 0);
    
    const totalBorrowedUSD = positions.reduce((sum, pos) => {
      return sum + (pos.borrowedTokens?.reduce((tokenSum, token) => 
        tokenSum + (token.valueUSD || 0), 0) || 0);
    }, 0);

    const totalRewardsUSD = positions.reduce((sum, pos) => {
      return sum + (pos.rewards?.reduce((rewardSum, reward) => 
        rewardSum + (reward.valueUSD || 0), 0) || 0);
    }, 0);

    const netValueUSD = totalValueUSD + totalRewardsUSD;

    // Calculate distributions
    const protocolDistribution = this.calculateProtocolDistribution(positions, totalValueUSD);
    const chainDistribution = this.calculateChainDistribution(positions, totalValueUSD);
    const typeDistribution = this.calculateTypeDistribution(positions, totalValueUSD);

    // Calculate risk summary
    const riskSummary = this.calculateRiskSummary(positions, totalSuppliedUSD);

    // Calculate yield summary
    const yieldSummary = this.calculateYieldSummary(positions);

    return {
      address,
      totalValueUSD,
      netValueUSD,
      totalSuppliedUSD,
      totalBorrowedUSD,
      totalRewardsUSD,
      protocolDistribution,
      chainDistribution,
      typeDistribution,
      riskSummary,
      yieldSummary,
      positions,
      lastUpdated: new Date(),
    };
  }

  private calculateProtocolDistribution(positions: DeFiPosition[], totalValue: number) {
    const protocolValues = new Map<DeFiProtocol, { value: number; count: number }>();

    positions.forEach(pos => {
      const current = protocolValues.get(pos.protocol) || { value: 0, count: 0 };
      protocolValues.set(pos.protocol, {
        value: current.value + pos.totalValueUSD,
        count: current.count + 1,
      });
    });

    return Array.from(protocolValues.entries()).map(([protocol, data]) => ({
      protocol,
      valueUSD: data.value,
      percentage: totalValue > 0 ? (data.value / totalValue) * 100 : 0,
      positionCount: data.count,
    }));
  }

  private calculateChainDistribution(positions: DeFiPosition[], totalValue: number) {
    const chainValues = new Map<ChainId, { value: number; count: number }>();

    positions.forEach(pos => {
      const current = chainValues.get(pos.chainId) || { value: 0, count: 0 };
      chainValues.set(pos.chainId, {
        value: current.value + pos.totalValueUSD,
        count: current.count + 1,
      });
    });

    return Array.from(chainValues.entries()).map(([chainId, data]) => ({
      chainId,
      valueUSD: data.value,
      percentage: totalValue > 0 ? (data.value / totalValue) * 100 : 0,
      positionCount: data.count,
    }));
  }

  private calculateTypeDistribution(positions: DeFiPosition[], totalValue: number) {
    const typeValues = new Map<PositionType, { value: number; count: number }>();

    positions.forEach(pos => {
      const current = typeValues.get(pos.type) || { value: 0, count: 0 };
      typeValues.set(pos.type, {
        value: current.value + pos.totalValueUSD,
        count: current.count + 1,
      });
    });

    return Array.from(typeValues.entries()).map(([type, data]) => ({
      type,
      valueUSD: data.value,
      percentage: totalValue > 0 ? (data.value / totalValue) * 100 : 0,
      positionCount: data.count,
    }));
  }

  private calculateRiskSummary(positions: DeFiPosition[], totalCollateralUSD: number) {
    const positionsAtRisk = positions.filter(pos => 
      pos.riskMetrics.liquidationRisk === RiskLevel.HIGH || 
      pos.riskMetrics.liquidationRisk === RiskLevel.CRITICAL
    ).length;

    const healthFactors = positions
      .map(pos => pos.riskMetrics.healthFactor)
      .filter(hf => hf !== undefined) as number[];
    
    const averageHealthFactor = healthFactors.length > 0 
      ? healthFactors.reduce((sum, hf) => sum + hf, 0) / healthFactors.length
      : undefined;

    // Determine overall risk level
    let overallRisk = RiskLevel.LOW;
    if (positionsAtRisk > 0) {
      const riskRatio = positionsAtRisk / positions.length;
      if (riskRatio > 0.5) overallRisk = RiskLevel.CRITICAL;
      else if (riskRatio > 0.25) overallRisk = RiskLevel.HIGH;
      else overallRisk = RiskLevel.MEDIUM;
    }

    return {
      overallRisk,
      positionsAtRisk,
      totalCollateralUSD,
      averageHealthFactor,
      liquidationThreshold: averageHealthFactor ? 1.0 / averageHealthFactor : undefined,
    };
  }

  private calculateYieldSummary(positions: DeFiPosition[]) {
    const yieldPositions = positions.filter(pos => pos.yieldInfo && pos.yieldInfo.length > 0);
    
    const totalYieldUSD24h = yieldPositions.reduce((sum, pos) => {
      const dailyYield = pos.yieldInfo?.reduce((yieldSum, yield_) => {
        const dailyRate = yield_.dailyRate || yield_.apy / 365;
        return yieldSum + (pos.totalValueUSD * dailyRate / 100);
      }, 0) || 0;
      return sum + dailyYield;
    }, 0);

    const averageAPY = yieldPositions.length > 0 
      ? yieldPositions.reduce((sum, pos) => {
          const positionAPY = pos.yieldInfo?.reduce((apySum, yield_) => 
            apySum + yield_.apy, 0) || 0;
          return sum + positionAPY / (pos.yieldInfo?.length || 1);
        }, 0) / yieldPositions.length
      : 0;

    // Find best and worst performing positions
    let bestPerformingPosition: string | undefined;
    let worstPerformingPosition: string | undefined;
    let bestAPY = -Infinity;
    let worstAPY = Infinity;

    yieldPositions.forEach(pos => {
      const positionAPY = pos.yieldInfo?.reduce((sum, yield_) => sum + yield_.apy, 0) || 0;
      if (positionAPY > bestAPY) {
        bestAPY = positionAPY;
        bestPerformingPosition = pos.id;
      }
      if (positionAPY < worstAPY) {
        worstAPY = positionAPY;
        worstPerformingPosition = pos.id;
      }
    });

    return {
      totalYieldUSD24h,
      totalYieldUSDLifetime: totalYieldUSD24h * 365, // Rough estimate
      averageAPY,
      bestPerformingPosition,
      worstPerformingPosition,
    };
  }

  /**
   * Start health monitoring for all adapters
   */
  private startHealthMonitoring(): void {
    // The adapter manager handles its own health monitoring
    // This timer is just for orchestrator-level health checks
    this.healthCheckTimer = setInterval(async () => {
      const healthStatus = this.getHealthStatus();
      const unhealthyProtocols = Object.entries(healthStatus)
        .filter(([_, health]) => !health.isHealthy)
        .map(([protocol, _]) => protocol);
      
      if (unhealthyProtocols.length > 0) {
        logger.warn('DeFi Orchestrator health check found unhealthy protocols', {
          unhealthyProtocols,
          totalProtocols: Object.keys(healthStatus).length,
        });
      }
    }, this.config.healthCheckInterval);
  }

  /**
   * Stop health monitoring and shutdown
   */
  async stop(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
    
    await this.adapterManager.shutdown();
    logger.info('DeFi Orchestrator stopped');
  }
}

// Factory function to create DeFiOrchestrator with default config
export const createDeFiOrchestrator = (rpcUrls: Partial<Record<ChainId, string>>): DeFiOrchestrator => {
  const config: DeFiOrchestratorConfig = {
    enabledProtocols: [
      DeFiProtocol.AAVE_V3,
      DeFiProtocol.UNISWAP_V3,
      DeFiProtocol.COMPOUND_V3,
      DeFiProtocol.CURVE,
      DeFiProtocol.YEARN,
      // Add more as they're implemented
      // DeFiProtocol.LIDO,
    ],
    maxConcurrentRequests: 10,
    defaultCacheTtl: 300, // 5 minutes
    healthCheckInterval: 60000, // 1 minute
    fallbackToCache: true,
    rpcUrls,
  };

  return new DeFiOrchestrator(config);
};

// Factory for creating singleton with RPC URLs from config
export const createDeFiOrchestratorSingleton = (rpcUrls: Partial<Record<ChainId, string>>): DeFiOrchestrator => {
  return createDeFiOrchestrator(rpcUrls);
};
