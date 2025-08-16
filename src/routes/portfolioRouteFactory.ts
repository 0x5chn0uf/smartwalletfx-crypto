import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { addressSchema, chainIdSchema, portfolioQuerySchema } from '@/routes/schema/portfolio';
import { logger } from '@/utils/logger';
import { ChainId } from '@/types/blockchain';
import { config } from '@/config';
import { redisManager } from '@/utils/redis';
import { BaseRouteFactory, RouteFactory } from './routeFactory';
import { ServiceDeps as ServiceDependencies } from '@/app/runtime';
import { PortfolioUseCase } from '@/app/usecases/PortfolioUseCase';
import type { PortfolioQueryOptions } from './interfaces/portfolio';

// Validation schemas moved to '@/routes/schema/portfolio'

class PortfolioRouteFactory extends BaseRouteFactory {
  private readonly usecase: PortfolioUseCase;

  constructor(dependencies: ServiceDependencies) {
    super(dependencies);
    this.usecase = new PortfolioUseCase(dependencies);
  }
  createRoutes(): Router {
    const router = Router();

    // Main portfolio endpoint with full DI
    router.get('/:address', this.getPortfolio.bind(this));
    router.get('/:address/summary', this.getPortfolioSummary.bind(this));
    router.get('/status/:requestId', this.getAsyncStatus.bind(this));
    router.get('/result/:requestId', this.getAsyncResult.bind(this));
    router.get('/stats', this.getServiceStats.bind(this));

    return router;
  }

  private async getPortfolio(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();

    try {
      // Validate address parameter
      const addressResult = addressSchema.safeParse(req.params.address);
      if (!addressResult.success) {
        return res
          .status(400)
          .json(
            this.createErrorResponse(
              'INVALID_ADDRESS',
              'Invalid wallet address format',
              addressResult.error.flatten().formErrors
            )
          );
      }

      // Validate query parameters
      const queryResult = portfolioQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        return res
          .status(400)
          .json(
            this.createErrorResponse(
              'INVALID_QUERY_PARAMETERS',
              'Invalid query parameters',
              queryResult.error.flatten().fieldErrors
            )
          );
      }

      const address = addressResult.data;
      const options: PortfolioQueryOptions = queryResult.data as any;

      logger.info('Portfolio aggregation request', this.logRequest(req, { address, options }));

      // Delegate to use case
      const result: any = await this.usecase.getAggregatedPortfolio(address, options);

      const processingTime = Date.now() - startTime;

      res.setHeader('X-Cache-Status', result.cached ? 'HIT' : 'MISS');
      res.setHeader('X-Processing-Time', `${processingTime}ms`);
      res.setHeader(
        'X-Data-Sources',
        [result.data.defi ? 'defi' : null, result.data.nfts ? 'nfts' : null]
          .filter(Boolean)
          .join(',')
      );

      res.json(
        this.createSuccessResponse(result.data, {
          requestId: req.requestId,
          cacheHit: result.cached,
          processingTime,
          dataSources: {
            defi: !!result.data.defi,
            nfts: !!result.data.nfts,
          },
        })
      );
    } catch (error) {
      const processingTime = Date.now() - startTime;

      logger.error('Portfolio aggregation failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address: req.params.address,
        requestId: req.requestId,
        processingTime,
      });

      next(error);
    }
  }

  private async getPortfolioSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const addressResult = addressSchema.safeParse(req.params.address);
      if (!addressResult.success) {
        return res
          .status(400)
          .json(this.createErrorResponse('INVALID_ADDRESS', 'Invalid wallet address format'));
      }

      const address = addressResult.data;
      const chains = req.query.chains
        ? String(req.query.chains)
            .split(',')
            .map(c => chainIdSchema.parse(c.trim()))
        : undefined;

      const summary = await this.usecase.getSummary(address, chains);
      res.json(this.createSuccessResponse(summary, { requestId: req.requestId }));
    } catch (error) {
      logger.error('Portfolio summary failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address: req.params.address,
        requestId: req.requestId,
      });
      next(error);
    }
  }

  private async getAsyncStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { requestId } = req.params;

      // Validate UUID format
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(requestId)) {
        return res
          .status(400)
          .json(this.createErrorResponse('INVALID_REQUEST_ID', 'Invalid request ID format'));
      }

      if (!config.features.asyncPortfolio) {
        return res
          .status(404)
          .json(
            this.createErrorResponse('FEATURE_DISABLED', 'Async portfolio feature is disabled')
          );
      }

      const status = await this.usecase.getAsyncStatus(requestId);

      if (!status) {
        return res
          .status(404)
          .json(this.createErrorResponse('REQUEST_NOT_FOUND', 'Request not found or expired'));
      }

      const responseData: any = {
        requestId: status.requestId,
        status: status.status,
        submittedAt: status.submittedAt,
      };

      // Add optional fields based on status
      if (status.estimatedCompletionTime) {
        responseData.estimatedCompletionTime = status.estimatedCompletionTime;
      }

      if (status.completedAt) {
        responseData.completedAt = status.completedAt;
      }

      if (status.progress !== undefined) {
        responseData.progress = status.progress;
      }

      if (status.error) {
        responseData.error = status.error;
      }

      // Add result URL if completed
      if (status.status === 'completed') {
        responseData.resultUrl = `/api/portfolio/result/${requestId}`;
      }

      logger.debug('Portfolio status request', {
        requestId,
        status: status.status,
        originalRequestId: req.requestId,
      });

      res.json(
        this.createSuccessResponse(responseData, {
          requestId: req.requestId,
          asyncRequestId: requestId,
        })
      );
    } catch (error) {
      logger.error('Portfolio status request failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: req.params.requestId,
        originalRequestId: req.requestId,
      });
      next(error);
    }
  }

  private async getAsyncResult(req: Request, res: Response, next: NextFunction) {
    try {
      const { requestId } = req.params;

      // Validate UUID format
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(requestId)) {
        return res
          .status(400)
          .json(this.createErrorResponse('INVALID_REQUEST_ID', 'Invalid request ID format'));
      }

      if (!config.features.asyncPortfolio) {
        return res
          .status(404)
          .json(
            this.createErrorResponse('FEATURE_DISABLED', 'Async portfolio feature is disabled')
          );
      }

      // Check status first
      const status = await this.dependencies.asyncPortfolioService.getRequestStatus(requestId);

      if (!status) {
        return res
          .status(404)
          .json(this.createErrorResponse('REQUEST_NOT_FOUND', 'Request not found or expired'));
      }

      if (status.status !== 'completed') {
        const statusCode = status.status === 'failed' ? 404 : 202;
        return res.status(statusCode).json({
          success: false,
          error: {
            code: 'RESULT_NOT_READY',
            message: `Request is ${status.status}. Check status endpoint for updates.`,
          },
          data: {
            status: status.status,
            statusUrl: `/api/portfolio/status/${requestId}`,
          },
          metadata: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
            asyncRequestId: requestId,
          },
        });
      }

      // Get the result
      const result = await this.usecase.getAsyncResult(requestId);

      if (!result) {
        return res
          .status(410)
          .json(
            this.createErrorResponse(
              'RESULT_EXPIRED',
              'Result has expired and is no longer available'
            )
          );
      }

      logger.info('Portfolio result retrieved', {
        requestId,
        dataSize: JSON.stringify(result.data).length,
        completedAt: result.completedAt,
        originalRequestId: req.requestId,
      });

      res.setHeader('X-Detail-Mode', 'async');
      res.setHeader('X-Async-Request-Id', requestId);
      res.setHeader('X-Completed-At', result.completedAt);
      res.setHeader('X-Processing-Time', `${result.metadata.processingTime}ms`);

      res.json(
        this.createSuccessResponse(result.data, {
          requestId: req.requestId,
          asyncRequestId: requestId,
          completedAt: result.completedAt,
          processingTime: result.metadata.processingTime,
          cacheHitRate: result.metadata.cacheHitRate,
          dataQuality: result.metadata.dataQuality,
          detailMode: 'async',
        })
      );
    } catch (error) {
      logger.error('Portfolio result request failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: req.params.requestId,
        originalRequestId: req.requestId,
      });
      next(error);
    }
  }

  private async getServiceStats(req: Request, res: Response, next: NextFunction) {
    try {
      if (!config.features.asyncPortfolio) {
        return res
          .status(404)
          .json(
            this.createErrorResponse('FEATURE_DISABLED', 'Async portfolio feature is disabled')
          );
      }

      const stats = this.dependencies.asyncPortfolioService.getRequestStats();

      res.json(
        this.createSuccessResponse(stats, {
          requestId: req.requestId,
        })
      );
    } catch (error) {
      logger.error('Portfolio stats request failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: req.requestId,
      });
      next(error);
    }
  }

  // Helper methods (moved from original route file)
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
          liquidityRisk: 'MEDIUM', // Simplified - NFTs generally have lower liquidity
          marketRisk: 'HIGH', // NFTs are typically more volatile
        }
      : null;

    return {
      defi: defiRisk,
      nft: nftRisk,
      lastAssessed: new Date().toISOString(),
    };
  }

  private calculateNFTConcentrationRisk(nftData: any) {
    if (!nftData?.collectionDistribution || nftData.collectionDistribution.length === 0) {
      return 'LOW';
    }

    // Check if portfolio is concentrated in few collections
    const totalValue = nftData.totalValue?.usdValue || 0;
    if (totalValue === 0) return 'LOW';

    const topCollectionValue = nftData.collectionDistribution[0]?.totalValue?.usdValue || 0;
    const concentrationRatio = topCollectionValue / totalValue;

    if (concentrationRatio > 0.7) return 'HIGH';
    if (concentrationRatio > 0.4) return 'MEDIUM';
    return 'LOW';
  }

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
}

/**
 * Portfolio route factory function
 */
export const createPortfolioRoutes: RouteFactory = (dependencies: ServiceDependencies): Router => {
  const factory = new PortfolioRouteFactory(dependencies);
  return factory.createRoutes();
};
