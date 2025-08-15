/**
 * Solana DeFi Orchestrator
 * 
 * Coordinates all Solana DeFi protocol adapters and provides unified
 * portfolio aggregation with cross-chain integration capabilities.
 */

import { logger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import SolanaTokenParser from '../solana/SolanaTokenParser';
import JupiterAdapter from './adapters/JupiterAdapter';
import MarinadeAdapter from './adapters/MarinadeAdapter';
import OrcaAdapter from './adapters/OrcaAdapter';
import {
  SolanaPortfolio,
  SolanaDeFiPosition,
  SolanaProtocol,
  SolanaPositionType,
  SolanaPortfolioAnalytics,
  SolanaToken,
  WELL_KNOWN_TOKENS,
} from '@/types/solana-defi';

export interface SolanaOrchestratorConfig {
  rpcUrl: string;
  heliusApiKey?: string;
  enabledProtocols: SolanaProtocol[];
  cacheSettings: {
    portfolio: number;
    analytics: number;
    crossChain: number;
  };
  performance: {
    maxConcurrentRequests: number;
    timeoutMs: number;
    retryAttempts: number;
  };
}

export interface CrossChainPosition {
  solanaAddress: string;
  evmAddresses: string[];
  totalValue: number;
  solanaValue: number;
  evmValue: number;
  crossChainCorrelations: {
    protocol: string;
    solanaProtocol: SolanaProtocol;
    evmProtocol: string;
    correlationScore: number;
  }[];
}

export class SolanaOrchestrator {
  private readonly config: SolanaOrchestratorConfig;
  private readonly tokenParser: SolanaTokenParser;
  private readonly adapters = new Map<SolanaProtocol, any>();
  private isInitialized = false;

  constructor(config: SolanaOrchestratorConfig) {
    this.config = config;
    this.tokenParser = new SolanaTokenParser(config.rpcUrl);
  }

  /**
   * Initialize all enabled protocol adapters
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Solana DeFi orchestrator', {
        enabledProtocols: this.config.enabledProtocols,
        rpcUrl: this.config.rpcUrl,
      });

      // Initialize token parser
      await this.tokenParser.healthCheck();

      // Initialize protocol adapters based on configuration
      const initPromises: Promise<void>[] = [];

      if (this.config.enabledProtocols.includes(SolanaProtocol.JUPITER)) {
        const jupiterAdapter = new JupiterAdapter({
          apiUrl: 'https://quote-api.jup.ag/v6',
          rpcUrl: this.config.rpcUrl,
          timeout: this.config.performance.timeoutMs,
          retries: this.config.performance.retryAttempts,
          cacheSettings: {
            quotes: 30,
            tokens: 3600,
            routes: 300,
          },
        });
        this.adapters.set(SolanaProtocol.JUPITER, jupiterAdapter);
        initPromises.push(jupiterAdapter.initialize());
      }

      if (this.config.enabledProtocols.includes(SolanaProtocol.MARINADE)) {
        const marinadeAdapter = new MarinadeAdapter({
          apiUrl: 'https://api.marinade.finance/v1',
          rpcUrl: this.config.rpcUrl,
          timeout: this.config.performance.timeoutMs,
          retries: this.config.performance.retryAttempts,
          cacheSettings: {
            positions: 600,
            validators: 3600,
            state: 300,
          },
        });
        this.adapters.set(SolanaProtocol.MARINADE, marinadeAdapter);
        initPromises.push(marinadeAdapter.initialize());
      }

      if (this.config.enabledProtocols.includes(SolanaProtocol.ORCA)) {
        const orcaAdapter = new OrcaAdapter({
          apiUrl: 'https://api.orca.so/v1',
          rpcUrl: this.config.rpcUrl,
          timeout: this.config.performance.timeoutMs,
          retries: this.config.performance.retryAttempts,
          cacheSettings: {
            pools: 1800,
            positions: 600,
            whirlpools: 900,
          },
        });
        this.adapters.set(SolanaProtocol.ORCA, orcaAdapter);
        initPromises.push(orcaAdapter.initialize());
      }

      // Initialize all adapters with controlled concurrency
      const results = await this.executeWithConcurrencyLimit(initPromises);
      const successCount = results.filter(result => result.status === 'fulfilled').length;

      this.isInitialized = successCount > 0;
      
      logger.info('Solana DeFi orchestrator initialization completed', {
        totalAdapters: initPromises.length,
        successfulAdapters: successCount,
        failedAdapters: initPromises.length - successCount,
        isInitialized: this.isInitialized,
      });

      if (!this.isInitialized) {
        throw new Error('Failed to initialize any DeFi adapters');
      }
    } catch (error) {
      logger.error('Failed to initialize Solana DeFi orchestrator', error);
      throw error;
    }
  }

  /**
   * Get comprehensive portfolio with all DeFi positions
   */
  async getPortfolio(address: string): Promise<SolanaPortfolio> {
    const cacheKey = `solana:orchestrator:portfolio:${address}`;
    
    try {
      // Check cache first
      const cached = await redisManager.get<SolanaPortfolio>(cacheKey);
      if (cached) {
        return cached;
      }

      if (!this.isInitialized) {
        throw new Error('Orchestrator not initialized');
      }

      // Get base portfolio from token parser
      const basePortfolio = await this.tokenParser.buildPortfolio(address);

      // Collect positions from all adapters
      const allPositions: SolanaDeFiPosition[] = [];
      const adapterPromises: Promise<SolanaDeFiPosition[]>[] = [];

      for (const [protocol, adapter] of this.adapters) {
        if (adapter && typeof adapter.getUserPositions === 'function') {
          adapterPromises.push(
            adapter.getUserPositions(address).catch((error: any) => {
              logger.debug(`Failed to get ${protocol} positions`, {
                address,
                protocol,
                error: error.message,
              });
              return [];
            })
          );
        }
      }

      // Execute position fetching with concurrency control
      const positionResults = await this.executeWithConcurrencyLimit(adapterPromises);
      
      // Flatten all positions
      for (const result of positionResults) {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
          allPositions.push(...result.value);
        }
      }

      // Merge with base portfolio
      const enhancedPortfolio: SolanaPortfolio = {
        ...basePortfolio,
        defiPositions: allPositions,
      };

      // Update staking and liquidity positions from DeFi positions
      enhancedPortfolio.stakingPositions = allPositions
        .filter(pos => pos.type === SolanaPositionType.STAKING && pos.protocol === SolanaProtocol.MARINADE)
        .map(pos => this.convertToStakingPosition(pos));

      enhancedPortfolio.liquidityPositions = allPositions
        .filter(pos => pos.type === SolanaPositionType.LIQUIDITY && pos.protocol === SolanaProtocol.ORCA)
        .map(pos => this.convertToLiquidityPosition(pos));

      // Recalculate total value
      const defiValue = allPositions.reduce((sum, pos) => sum + pos.value, 0);
      enhancedPortfolio.totalValue = basePortfolio.totalValue + defiValue;

      // Cache for 5 minutes
      await redisManager.set(cacheKey, enhancedPortfolio, this.config.cacheSettings.portfolio);

      return enhancedPortfolio;
    } catch (error) {
      logger.error('Failed to get orchestrated portfolio', {
        address,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get portfolio analytics with risk assessment
   */
  async getPortfolioAnalytics(address: string): Promise<SolanaPortfolioAnalytics> {
    const cacheKey = `solana:orchestrator:analytics:${address}`;
    
    try {
      // Check cache first
      const cached = await redisManager.get<SolanaPortfolioAnalytics>(cacheKey);
      if (cached) {
        return cached;
      }

      const portfolio = await this.getPortfolio(address);
      
      // Calculate protocol distribution
      const protocolDistribution = this.calculateProtocolDistribution(portfolio.defiPositions);
      
      // Calculate risk metrics
      const riskMetrics = this.calculateRiskMetrics(portfolio);
      
      // Calculate yield summary
      const yieldSummary = this.calculateYieldSummary(portfolio.defiPositions);
      
      // Calculate historical performance (simplified)
      const dayChange = 0; // Would need historical data
      const weekChange = 0;
      const monthChange = 0;

      const analytics: SolanaPortfolioAnalytics = {
        totalValue: portfolio.totalValue,
        dayChange,
        weekChange,
        monthChange,
        protocolDistribution,
        riskMetrics,
        yieldSummary,
      };

      // Cache for 10 minutes
      await redisManager.set(cacheKey, analytics, this.config.cacheSettings.analytics);

      return analytics;
    } catch (error) {
      logger.error('Failed to calculate portfolio analytics', {
        address,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Analyze cross-chain position correlations
   */
  async analyzeCrossChainPositions(
    solanaAddress: string,
    evmAddresses: string[]
  ): Promise<CrossChainPosition> {
    const cacheKey = `solana:orchestrator:cross-chain:${solanaAddress}:${evmAddresses.join(',')}`;
    
    try {
      // Check cache first
      const cached = await redisManager.get<CrossChainPosition>(cacheKey);
      if (cached) {
        return cached;
      }

      // Get Solana portfolio
      const solanaPortfolio = await this.getPortfolio(solanaAddress);
      
      // For EVM addresses, we'd need to call the EVM service
      // This is a placeholder for the integration
      const evmValue = 0; // Would be fetched from EVM service
      
      // Analyze protocol correlations
      const crossChainCorrelations = this.analyzeCrossChainCorrelations(
        solanaPortfolio.defiPositions
      );

      const result: CrossChainPosition = {
        solanaAddress,
        evmAddresses,
        totalValue: solanaPortfolio.totalValue + evmValue,
        solanaValue: solanaPortfolio.totalValue,
        evmValue,
        crossChainCorrelations,
      };

      // Cache for 15 minutes
      await redisManager.set(cacheKey, result, this.config.cacheSettings.crossChain);

      return result;
    } catch (error) {
      logger.error('Failed to analyze cross-chain positions', {
        solanaAddress,
        evmAddresses,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get health status of all adapters
   */
  async getHealthStatus(): Promise<Record<SolanaProtocol, boolean>> {
    const health: Record<SolanaProtocol, boolean> = {};
    
    const healthPromises: Promise<void>[] = [];
    
    for (const [protocol, adapter] of this.adapters) {
      if (adapter && typeof adapter.healthCheck === 'function') {
        healthPromises.push(
          adapter.healthCheck().then((isHealthy: boolean) => {
            health[protocol] = isHealthy;
          }).catch(() => {
            health[protocol] = false;
          })
        );
      }
    }
    
    await Promise.allSettled(healthPromises);
    
    return health;
  }

  /**
   * Execute promises with concurrency limit
   */
  private async executeWithConcurrencyLimit<T>(
    promises: Promise<T>[]
  ): Promise<PromiseSettledResult<T>[]> {
    const limit = this.config.performance.maxConcurrentRequests;
    const results: PromiseSettledResult<T>[] = [];
    
    for (let i = 0; i < promises.length; i += limit) {
      const batch = promises.slice(i, i + limit);
      const batchResults = await Promise.allSettled(batch);
      results.push(...batchResults);
    }
    
    return results;
  }

  /**
   * Calculate protocol distribution
   */
  private calculateProtocolDistribution(positions: SolanaDeFiPosition[]) {
    const distribution = new Map<SolanaProtocol, number>();
    const totalValue = positions.reduce((sum, pos) => sum + pos.value, 0);
    
    for (const position of positions) {
      const current = distribution.get(position.protocol) || 0;
      distribution.set(position.protocol, current + position.value);
    }
    
    return Array.from(distribution.entries()).map(([protocol, value]) => ({
      protocol,
      value,
      percentage: totalValue > 0 ? (value / totalValue) * 100 : 0,
    }));
  }

  /**
   * Calculate portfolio risk metrics
   */
  private calculateRiskMetrics(portfolio: SolanaPortfolio) {
    const positions = portfolio.defiPositions;
    const totalValue = portfolio.totalValue;
    
    // Concentration risk (how concentrated the portfolio is)
    const protocolDistribution = this.calculateProtocolDistribution(positions);
    const maxProtocolPercentage = Math.max(...protocolDistribution.map(p => p.percentage));
    const concentrationRisk = maxProtocolPercentage / 100;
    
    // Liquidity risk (based on position types)
    const liquidPositions = positions.filter(p => 
      p.type === SolanaPositionType.SWAP || 
      p.type === SolanaPositionType.LIQUIDITY
    );
    const liquidValue = liquidPositions.reduce((sum, pos) => sum + pos.value, 0);
    const liquidityRisk = totalValue > 0 ? 1 - (liquidValue / totalValue) : 0;
    
    // Protocol risk (based on number of protocols)
    const protocolCount = new Set(positions.map(p => p.protocol)).size;
    const protocolRisk = protocolCount < 3 ? 0.8 : protocolCount < 5 ? 0.5 : 0.2;
    
    // Overall risk assessment
    const overallRiskScore = (concentrationRisk + liquidityRisk + protocolRisk) / 3;
    const overallRisk = overallRiskScore > 0.7 ? 'high' : overallRiskScore > 0.4 ? 'medium' : 'low';
    
    return {
      concentrationRisk,
      liquidityRisk,
      protocolRisk,
      overallRisk: overallRisk as 'low' | 'medium' | 'high',
    };
  }

  /**
   * Calculate yield summary
   */
  private calculateYieldSummary(positions: SolanaDeFiPosition[]) {
    const yieldPositions = positions.filter(p => p.apy && p.apy > 0);
    
    if (yieldPositions.length === 0) {
      return {
        totalYield: 0,
        averageApy: 0,
        bestPosition: {
          protocol: SolanaProtocol.MARINADE,
          apy: 0,
          value: 0,
        },
      };
    }
    
    const totalValue = yieldPositions.reduce((sum, pos) => sum + pos.value, 0);
    const weightedApy = yieldPositions.reduce((sum, pos) => {
      const weight = pos.value / totalValue;
      return sum + (pos.apy! * weight);
    }, 0);
    
    const bestPosition = yieldPositions.reduce((best, current) => 
      current.apy! > best.apy! ? current : best
    );
    
    return {
      totalYield: totalValue,
      averageApy: weightedApy,
      bestPosition: {
        protocol: bestPosition.protocol,
        apy: bestPosition.apy!,
        value: bestPosition.value,
      },
    };
  }

  /**
   * Analyze cross-chain protocol correlations
   */
  private analyzeCrossChainCorrelations(positions: SolanaDeFiPosition[]) {
    // This would analyze similarities between Solana and EVM protocols
    // For example, Orca (Solana) correlates with Uniswap (Ethereum)
    const correlations = [];
    
    for (const position of positions) {
      switch (position.protocol) {
        case SolanaProtocol.ORCA:
          correlations.push({
            protocol: 'DEX/AMM',
            solanaProtocol: SolanaProtocol.ORCA,
            evmProtocol: 'Uniswap V3',
            correlationScore: 0.85,
          });
          break;
        case SolanaProtocol.MARINADE:
          correlations.push({
            protocol: 'Liquid Staking',
            solanaProtocol: SolanaProtocol.MARINADE,
            evmProtocol: 'Lido',
            correlationScore: 0.90,
          });
          break;
        case SolanaProtocol.JUPITER:
          correlations.push({
            protocol: 'DEX Aggregation',
            solanaProtocol: SolanaProtocol.JUPITER,
            evmProtocol: '1inch',
            correlationScore: 0.80,
          });
          break;
      }
    }
    
    return correlations;
  }

  /**
   * Convert DeFi position to staking position format
   */
  private convertToStakingPosition(position: SolanaDeFiPosition) {
    return {
      account: position.account,
      stakeAmount: position.tokens[0]?.amount || 0,
      marinadeAmount: position.tokens[0]?.amount || 0,
      delegatedValidator: position.metadata?.validator?.voteAccount || '',
      apy: position.apy || 0,
      unstakeAvailable: false,
      rewards: {
        accumulated: 0,
        claimed: 0,
        pending: 0,
      },
    };
  }

  /**
   * Convert DeFi position to liquidity position format
   */
  private convertToLiquidityPosition(position: SolanaDeFiPosition) {
    return {
      poolAddress: position.metadata?.poolAddress || '',
      lpTokens: position.metadata?.lpTokens || 0,
      tokenAAmount: position.tokens[0]?.amount || 0,
      tokenBAmount: position.tokens[1]?.amount || 0,
      value: position.value,
      share: position.metadata?.shareOfPool || 0,
      rewards: [],
      impermanentLoss: position.metadata?.impermanentLoss || 0,
    };
  }

  /**
   * Get orchestrator statistics
   */
  getStats() {
    return {
      isInitialized: this.isInitialized,
      adaptersCount: this.adapters.size,
      enabledProtocols: this.config.enabledProtocols,
      config: {
        maxConcurrentRequests: this.config.performance.maxConcurrentRequests,
        timeoutMs: this.config.performance.timeoutMs,
        retryAttempts: this.config.performance.retryAttempts,
      },
      tokenParserStats: this.tokenParser.getStats(),
    };
  }
}

export default SolanaOrchestrator;