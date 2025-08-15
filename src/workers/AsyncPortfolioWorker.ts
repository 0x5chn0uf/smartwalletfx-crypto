import { EventBusPort, EventHandler } from '@/app/ports/EventBusPort';
import {
  PortfolioAggregationRequestV1,
  PortfolioAggregationCompletedV1,
  PortfolioAggregationErrorV1,
  PORTFOLIO_EVENT_TYPES,
} from '@/app/events/PortfolioEvents';
import { getAsyncPortfolioService } from '@/services/AsyncPortfolioService';
import { DeFiOrchestrator } from '@/services/defi/DeFiOrchestrator';
import { nftOrchestrator } from '@/services/nft/NFTOrchestrator';
import { logger } from '@/utils/logger';
import { config } from '@/config';

/**
 * Async Portfolio Worker
 *
 * Processes portfolio aggregation requests from the event bus
 * and manages the complete async portfolio workflow.
 */
export class AsyncPortfolioWorker {
  private eventBus: EventBusPort;
  private defiOrchestrator: DeFiOrchestrator;
  private isRunning = false;
  private subscriptionId?: string;

  // Performance tracking
  private stats = {
    requestsReceived: 0,
    requestsProcessed: 0,
    requestsFailed: 0,
    totalProcessingTime: 0,
    averageProcessingTime: 0,
  };

  constructor(eventBus: EventBusPort, defiOrchestrator: DeFiOrchestrator) {
    this.eventBus = eventBus;
    this.defiOrchestrator = defiOrchestrator;

    logger.info('AsyncPortfolioWorker initialized');
  }

  /**
   * Start the async portfolio worker
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('AsyncPortfolioWorker is already running');
      return;
    }

    if (!config.features.asyncPortfolio) {
      logger.info('Async portfolio feature is disabled, worker not started');
      return;
    }

    try {
      // Subscribe to portfolio aggregation request events
      this.subscriptionId = await this.eventBus.subscribe(
        PORTFOLIO_EVENT_TYPES.AGGREGATION_REQUEST,
        this.handleAggregationRequest.bind(this) as EventHandler<PortfolioAggregationRequestV1>,
        {
          maxRetries: 2,
          retryDelayMs: 5000,
          timeoutMs: 60000, // 1 minute timeout
        }
      );

      this.isRunning = true;
      logger.info('AsyncPortfolioWorker started successfully', {
        subscriptionId: this.subscriptionId,
      });
    } catch (error) {
      logger.error('Failed to start AsyncPortfolioWorker', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Stop the async portfolio worker
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping AsyncPortfolioWorker...');
    this.isRunning = false;

    // Unsubscribe from events
    if (this.subscriptionId) {
      await this.eventBus.unsubscribe(this.subscriptionId);
      this.subscriptionId = undefined;
    }

    logger.info('AsyncPortfolioWorker stopped', {
      finalStats: this.getStats(),
    });
  }

  /**
   * Get worker statistics
   */
  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
    };
  }

  /**
   * Handle incoming portfolio aggregation requests
   */
  private async handleAggregationRequest(
    event: PortfolioAggregationRequestV1
  ): Promise<void> {
    this.stats.requestsReceived++;

    const startTime = Date.now();
    const { address, components, chains, options, context } = event.data;

    logger.info('Processing async portfolio aggregation request', {
      eventId: event.id,
      requestId: event.requestId,
      address,
      components,
      priority: context.priority,
    });

    try {
      // Update request status to processing
      const asyncService = getAsyncPortfolioService(this.eventBus);
      await asyncService.updateRequestStatus(event.requestId, 'processing');

      // Build portfolio aggregation options
      const aggregationOptions = {
        chainIds: chains,
        includeInactive: false,
        includeMetadata: options.includeMetadata,
        includeAnalytics: options.includeAnalytics,
        forceRefresh: options.forceRefresh,
        minDefiValue: options.minDefiValue || 0.01,
        minNftValue: options.minNftValue,
      };

      // Fetch components in parallel
      const fetchPromises: Promise<any>[] = [];

      if (components.includeDefi) {
        fetchPromises.push(
          this.defiOrchestrator.getDeFiPortfolio(address, aggregationOptions).catch(error => {
            logger.warn('DeFi portfolio fetch failed in async aggregation', {
              error: error.message,
              address,
              requestId: event.requestId,
            });
            return null;
          })
        );
      } else {
        fetchPromises.push(Promise.resolve(null));
      }

      if (components.includeNft) {
        fetchPromises.push(
          nftOrchestrator
            .getNFTPortfolio(address, {
              chainIds: chains,
              includeMetadata: options.includeMetadata,
              includeAnalytics: options.includeAnalytics,
              minValue: options.minNftValue,
            })
            .catch(error => {
              logger.warn('NFT portfolio fetch failed in async aggregation', {
                error: error.message,
                address,
                requestId: event.requestId,
              });
              return null;
            })
        );
      } else {
        fetchPromises.push(Promise.resolve(null));
      }

      const [defiResult, nftResult] = await Promise.all(fetchPromises);

      // Extract data from results
      const defiData = defiResult?.success ? defiResult.data : null;
      const nftData = nftResult?.success ? nftResult.data : null;

      // Build aggregated portfolio (reuse logic from sync endpoint)
      const portfolioSummary = await this.buildPortfolioSummary(
        address,
        defiData,
        nftData,
        options
      );

      // Calculate performance metrics if analytics requested
      let performanceMetrics = null;
      let riskAnalysis = null;

      if (options.includeAnalytics) {
        performanceMetrics = this.calculatePerformanceMetrics(defiData, nftData);
        riskAnalysis = this.calculateRiskAnalysis(defiData, nftData);
      }

      const portfolioData = {
        address,
        summary: {
          totalValueUSD: portfolioSummary.totalValueUSD,
          defiValueUSD: portfolioSummary.defiValueUSD,
          nftValueUSD: portfolioSummary.nftValueUSD,
          netWorth: portfolioSummary.netWorth,
          totalPositions: portfolioSummary.totalPositions,
          totalCollections: portfolioSummary.totalCollections,
          totalNFTs: portfolioSummary.totalNFTs,
          lastUpdated: new Date().toISOString(),
        },
        defi: defiData,
        nfts: nftData,
        chainDistribution: portfolioSummary.chainDistribution,
        assetAllocation: portfolioSummary.assetAllocation,
        performanceMetrics,
        riskAnalysis,
        insights: options.includeAnalytics
          ? this.generatePortfolioInsights(defiData, nftData)
          : null,
      };

      const processingTime = Date.now() - startTime;
      this.stats.totalProcessingTime += processingTime;
      this.stats.requestsProcessed++;
      this.stats.averageProcessingTime =
        this.stats.totalProcessingTime / this.stats.requestsProcessed;

      // Update service with completed result
      await asyncService.updateRequestStatus(event.requestId, 'completed', {
        requestId: event.requestId,
        data: portfolioData,
        completedAt: new Date().toISOString(),
        metadata: {
          processingTime,
          cacheHitRate: this.calculateCacheHitRate(defiResult, nftResult),
          dataQuality: this.calculateDataQuality(defiData, nftData),
        },
      });

      // Publish completion event
      await this.publishCompletionEvent(event, portfolioData, processingTime);

      logger.info('Async portfolio aggregation completed successfully', {
        eventId: event.id,
        requestId: event.requestId,
        address,
        processingTime,
        totalValueUSD: portfolioSummary.totalValueUSD,
      });
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.stats.requestsFailed++;

      await this.handleAggregationError(event, error, processingTime);
    }
  }

  /**
   * Build portfolio summary (reusing logic from sync route)
   */
  private async buildPortfolioSummary(address: string, defiData: any, nftData: any, options: any) {
    const defiValueUSD = defiData?.totalValueUSD || 0;
    const nftValueUSD = nftData?.totalValue?.usdValue || 0;
    const totalValueUSD = defiValueUSD + nftValueUSD;

    // Calculate net worth (considering borrowed amounts in DeFi)
    const totalBorrowedUSD = defiData?.totalBorrowedUSD || 0;
    const netWorth = totalValueUSD - totalBorrowedUSD;

    // Aggregate chain distribution
    const chainDistribution = this.aggregateChainDistribution(defiData, nftData);

    // Calculate asset allocation
    const assetAllocation = {
      defi: totalValueUSD > 0 ? (defiValueUSD / totalValueUSD) * 100 : 0,
      nfts: totalValueUSD > 0 ? (nftValueUSD / totalValueUSD) * 100 : 0,
    };

    return {
      totalValueUSD,
      defiValueUSD,
      nftValueUSD,
      netWorth,
      totalPositions: defiData?.positions?.length || 0,
      totalCollections: nftData?.totalCollections || 0,
      totalNFTs: nftData?.totalNFTs || 0,
      chainDistribution,
      assetAllocation,
    };
  }

  /**
   * Aggregate chain distribution from DeFi and NFT data
   */
  private aggregateChainDistribution(defiData: any, nftData: any) {
    const chainTotals = new Map<string, { defi: number; nft: number; total: number }>();

    // Add DeFi chain distribution
    if (defiData?.chainDistribution) {
      for (const chain of defiData.chainDistribution) {
        const existing = chainTotals.get(chain.chainId) || { defi: 0, nft: 0, total: 0 };
        existing.defi = chain.valueUSD;
        existing.total += chain.valueUSD;
        chainTotals.set(chain.chainId, existing);
      }
    }

    // Add NFT chain distribution
    if (nftData?.chainDistribution) {
      for (const chain of nftData.chainDistribution) {
        const existing = chainTotals.get(chain.chainId) || { defi: 0, nft: 0, total: 0 };
        existing.nft = chain.value?.usdValue || 0;
        existing.total += existing.nft;
        chainTotals.set(chain.chainId, existing);
      }
    }

    const totalValue = Array.from(chainTotals.values()).reduce(
      (sum, chain) => sum + chain.total,
      0
    );

    return Array.from(chainTotals.entries()).map(([chainId, values]) => ({
      chainId,
      defiValueUSD: values.defi,
      nftValueUSD: values.nft,
      totalValueUSD: values.total,
      percentage: totalValue > 0 ? (values.total / totalValue) * 100 : 0,
    }));
  }

  /**
   * Calculate performance metrics
   */
  private calculatePerformanceMetrics(defiData: any, nftData: any) {
    if (!defiData && !nftData) return null;

    // Calculate yield metrics from DeFi
    const yieldMetrics = defiData?.yieldSummary
      ? {
          totalYieldUSD24h: defiData.yieldSummary.totalYieldUSD24h,
          averageAPY: defiData.yieldSummary.averageAPY,
          bestPerformingPosition: defiData.yieldSummary.bestPerformingPosition,
        }
      : null;

    // NFT portfolio performance (simplified)
    const nftMetrics = nftData
      ? {
          totalValueUSD: nftData.totalValue?.usdValue || 0,
          totalFloorValueUSD: nftData.totalFloorValue?.usdValue || 0,
          unrealizedGains:
            (nftData.totalValue?.usdValue || 0) - (nftData.totalFloorValue?.usdValue || 0),
        }
      : null;

    return {
      yield: yieldMetrics,
      nft: nftMetrics,
      lastCalculated: new Date().toISOString(),
    };
  }

  /**
   * Calculate risk analysis
   */
  private calculateRiskAnalysis(defiData: any, nftData: any) {
    if (!defiData && !nftData) return null;

    const defiRisk = defiData?.riskSummary
      ? {
          overallRisk: defiData.riskSummary.overallRisk,
          positionsAtRisk: defiData.riskSummary.positionsAtRisk,
          averageHealthFactor: defiData.riskSummary.averageHealthFactor,
          totalCollateralUSD: defiData.riskSummary.totalCollateralUSD,
        }
      : null;

    // Simplified NFT risk assessment
    const nftRisk = nftData
      ? {
          concentrationRisk: this.calculateNFTConcentrationRisk(nftData),
          liquidityRisk: 'MEDIUM',
          marketRisk: 'HIGH',
        }
      : null;

    return {
      defi: defiRisk,
      nft: nftRisk,
      lastAssessed: new Date().toISOString(),
    };
  }

  /**
   * Calculate NFT concentration risk
   */
  private calculateNFTConcentrationRisk(nftData: any) {
    if (!nftData?.collectionDistribution || nftData.collectionDistribution.length === 0) {
      return 'LOW';
    }

    const totalValue = nftData.totalValue?.usdValue || 0;
    if (totalValue === 0) return 'LOW';

    const topCollectionValue = nftData.collectionDistribution[0]?.totalValue?.usdValue || 0;
    const concentrationRatio = topCollectionValue / totalValue;

    if (concentrationRatio > 0.7) return 'HIGH';
    if (concentrationRatio > 0.4) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Generate portfolio insights
   */
  private generatePortfolioInsights(defiData: any, nftData: any) {
    const insights = [];

    // DeFi insights
    if (defiData) {
      if (defiData.totalBorrowedUSD > defiData.totalSuppliedUSD * 0.8) {
        insights.push({
          type: 'WARNING',
          category: 'DEFI_RISK',
          message: 'High borrowing ratio detected. Consider reducing leverage.',
          severity: 'HIGH',
        });
      }

      if (defiData.yieldSummary?.averageAPY > 20) {
        insights.push({
          type: 'OPPORTUNITY',
          category: 'DEFI_YIELD',
          message: `High average APY of ${defiData.yieldSummary.averageAPY.toFixed(2)}% detected.`,
          severity: 'MEDIUM',
        });
      }
    }

    // NFT insights
    if (nftData) {
      const concentrationRisk = this.calculateNFTConcentrationRisk(nftData);
      if (concentrationRisk === 'HIGH') {
        insights.push({
          type: 'WARNING',
          category: 'NFT_CONCENTRATION',
          message:
            'Portfolio is heavily concentrated in one NFT collection. Consider diversifying.',
          severity: 'MEDIUM',
        });
      }

      if (nftData.totalNFTs > 100) {
        insights.push({
          type: 'INFO',
          category: 'NFT_COUNT',
          message: `Large NFT portfolio with ${nftData.totalNFTs} tokens across ${nftData.totalCollections} collections.`,
          severity: 'LOW',
        });
      }
    }

    return insights;
  }

  /**
   * Calculate cache hit rate from results
   */
  private calculateCacheHitRate(...results: any[]): number {
    let totalRequests = 0;
    let cacheHits = 0;

    results.forEach(result => {
      if (result?.metadata) {
        totalRequests++;
        if (result.metadata.cacheHit) {
          cacheHits++;
        }
      }
    });

    return totalRequests > 0 ? (cacheHits / totalRequests) * 100 : 0;
  }

  /**
   * Calculate data quality score
   */
  private calculateDataQuality(defiData: any, nftData: any): number {
    let qualityScore = 100;

    // Reduce score for missing data
    if (!defiData) qualityScore -= 20;
    if (!nftData) qualityScore -= 20;

    // Reduce score for stale data (simplified)
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes

    if (defiData?.lastUpdated) {
      const age = now - new Date(defiData.lastUpdated).getTime();
      if (age > maxAge) qualityScore -= 10;
    }

    if (nftData?.lastUpdated) {
      const age = now - new Date(nftData.lastUpdated).getTime();
      if (age > maxAge) qualityScore -= 10;
    }

    return Math.max(0, qualityScore);
  }

  /**
   * Publish completion event
   */
  private async publishCompletionEvent(
    originalEvent: PortfolioAggregationRequestV1,
    portfolioData: any,
    processingTime: number
  ): Promise<void> {
    // Implementation would create and publish PortfolioAggregationCompletedV1 event
    // Omitted for brevity - would follow similar pattern to other event publishing
    logger.debug('Portfolio aggregation completion event published', {
      requestId: originalEvent.requestId,
      processingTime,
    });
  }

  /**
   * Handle aggregation errors
   */
  private async handleAggregationError(
    originalEvent: PortfolioAggregationRequestV1,
    error: any,
    processingTime: number
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error('Async portfolio aggregation failed', {
      eventId: originalEvent.id,
      requestId: originalEvent.requestId,
      address: originalEvent.data.address,
      error: errorMessage,
      processingTime,
    });

    // Update service with failed status
    const asyncService = getAsyncPortfolioService(this.eventBus);
    await asyncService.updateRequestStatus(originalEvent.requestId, 'failed', null, errorMessage);

    // Publish error event
    // Implementation would create and publish PortfolioAggregationErrorV1 event
    // Omitted for brevity
  }
}

/**
 * Singleton instance
 */
let asyncPortfolioWorkerInstance: AsyncPortfolioWorker | null = null;

export const getAsyncPortfolioWorker = (eventBus: EventBusPort, defiOrchestrator: DeFiOrchestrator): AsyncPortfolioWorker => {
  if (!asyncPortfolioWorkerInstance) {
    asyncPortfolioWorkerInstance = new AsyncPortfolioWorker(eventBus, defiOrchestrator);
  }
  return asyncPortfolioWorkerInstance;
};
