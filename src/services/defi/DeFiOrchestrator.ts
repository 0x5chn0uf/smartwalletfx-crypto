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

interface DeFiOrchestratorConfig {
  enabledProtocols: DeFiProtocol[];
  maxConcurrentRequests: number;
  defaultCacheTtl: number;
  healthCheckInterval: number;
  fallbackToCache: boolean;
}

export class DeFiOrchestrator {
  private adapters: Map<DeFiProtocol, ProtocolAdapter> = new Map();
  private adapterHealth: Map<DeFiProtocol, ProtocolHealth> = new Map();
  private healthCheckTimer?: NodeJS.Timer;

  constructor(private readonly config: DeFiOrchestratorConfig) {
    this.startHealthMonitoring();
  }

  /**
   * Register a protocol adapter
   */
  registerAdapter(adapter: ProtocolAdapter): void {
    this.adapters.set(adapter.protocol, adapter);
    this.adapterHealth.set(adapter.protocol, adapter.getHealth());
    
    logger.info(`DeFi adapter registered: ${adapter.protocol}`, {
      protocol: adapter.protocol,
      version: adapter.version,
      supportedChains: adapter.supportedChains,
    });
  }

  /**
   * Get all registered protocol adapters
   */
  getRegisteredProtocols(): DeFiProtocol[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get health status of all protocol adapters
   */
  getHealthStatus(): Record<DeFiProtocol, ProtocolHealth> {
    return Object.fromEntries(this.adapterHealth);
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
    const adapter = this.adapters.get(protocol);
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
    const health = this.adapterHealth.get(protocol);
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
    const targetProtocols = protocols || this.config.enabledProtocols;
    const healthyAdapters = targetProtocols
      .filter(protocol => {
        const adapter = this.adapters.get(protocol);
        const health = this.adapterHealth.get(protocol);
        return adapter && health?.isHealthy;
      })
      .map(protocol => this.adapters.get(protocol)!)
      .filter(adapter => {
        // Filter by supported chains if specified
        if (chainIds) {
          return chainIds.some(chainId => adapter.supportedChains.includes(chainId));
        }
        return true;
      });

    logger.info(`Fetching positions from ${healthyAdapters.length} healthy adapters`, {
      address,
      adapters: healthyAdapters.map(a => a.protocol),
    });

    // Fetch positions from all adapters concurrently
    const fetchPromises = healthyAdapters.map(async adapter => {
      try {
        const positions = await Promise.race([
          adapter.getPositions(address, chainIds?.[0]),
          new Promise<DeFiPosition[]>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 30000)
          )
        ]);
        
        return {
          protocol: adapter.protocol,
          positions,
          success: true,
        };
      } catch (error) {
        logger.warn(`Failed to fetch positions from ${adapter.protocol}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return {
          protocol: adapter.protocol,
          positions: [] as DeFiPosition[],
          success: false,
        };
      }
    });

    const results = await Promise.all(fetchPromises);
    const allPositions: DeFiPosition[] = [];
    
    results.forEach(result => {
      if (result.success) {
        allPositions.push(...result.positions);
      }
    });

    logger.info(`Fetched ${allPositions.length} total DeFi positions`, {
      address,
      positionsByProtocol: results.reduce((acc, result) => {
        acc[result.protocol] = result.positions.length;
        return acc;
      }, {} as Record<string, number>),
    });

    return allPositions;
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
    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthChecks();
    }, this.config.healthCheckInterval);
  }

  /**
   * Perform health checks on all adapters
   */
  private async performHealthChecks(): Promise<void> {
    const healthPromises = Array.from(this.adapters.entries()).map(async ([protocol, adapter]) => {
      try {
        const isHealthy = await adapter.isHealthy();
        const health: ProtocolHealth = {
          ...adapter.getHealth(),
          isHealthy,
          lastCheckedAt: new Date(),
        };
        
        this.adapterHealth.set(protocol, health);
        
        if (!isHealthy) {
          logger.warn(`Protocol adapter ${protocol} is unhealthy`, { health });
        }
      } catch (error) {
        logger.error(`Health check failed for ${protocol}`, { error });
        this.adapterHealth.set(protocol, {
          isHealthy: false,
          lastCheckedAt: new Date(),
          responseTime: undefined,
          errorRate: 1.0,
          uptime: 0,
          issues: [error instanceof Error ? error.message : 'Unknown error'],
        });
      }
    });

    await Promise.allSettled(healthPromises);
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }
}

// Factory function to create DeFiOrchestrator with default config
export const createDeFiOrchestrator = (): DeFiOrchestrator => {
  const config: DeFiOrchestratorConfig = {
    enabledProtocols: [
      DeFiProtocol.AAVE_V3,
      DeFiProtocol.COMPOUND_V3,
      DeFiProtocol.UNISWAP_V3,
      DeFiProtocol.CURVE,
      DeFiProtocol.YEARN,
      DeFiProtocol.LIDO,
    ],
    maxConcurrentRequests: 10,
    defaultCacheTtl: 300, // 5 minutes
    healthCheckInterval: 60000, // 1 minute
    fallbackToCache: true,
  };

  return new DeFiOrchestrator(config);
};

// Singleton instance
export const defiOrchestrator = createDeFiOrchestrator();