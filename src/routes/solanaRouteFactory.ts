import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as solSchemas from '@/routes/schema/solana';
import { logger } from '@/utils/logger';
import { BaseRouteFactory } from './routeFactory';
import type { RouteFactory } from './interfaces';
import { ServiceDeps as ServiceDependencies } from '@/app/runtime';
import { SolanaUseCase } from '@/app/usecases/SolanaUseCase';
import { ErrorCode } from '@/utils/errorCatalog';
import { ResponseBuilder } from '@/utils/responseBuilder';
import { SolanaProtocol } from '@/types/solana-defi';

// Validation schemas moved to '@/routes/schema/solana'

const crossChainSchema = z.object({
  solanaAddress: solSchemas.solanaAddressSchema,
  evmAddresses: z.array(solSchemas.evmAddressSchema),
});

class SolanaRouteFactory extends BaseRouteFactory {
  private readonly usecase: SolanaUseCase;
  constructor(dependencies: ServiceDependencies) {
    super(dependencies);
    this.usecase = new SolanaUseCase(dependencies);
  }
  createRoutes(): Router {
    const router = Router();

    // Solana portfolio and DeFi endpoints
    router.get('/portfolio/:address', this.getSolanaPortfolio.bind(this));
    router.get('/defi/:address', this.getSolanaDeFiPositions.bind(this));
    router.get('/analytics/:address', this.getSolanaAnalytics.bind(this));
    router.post('/cross-chain', this.analyzeCrossChainPositions.bind(this));
    router.get('/health', this.getSolanaHealth.bind(this));
    router.get('/stats', this.getSolanaStats.bind(this));

    return router;
  }

  private async getSolanaPortfolio(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const responseBuilder = new ResponseBuilder(req.requestId);

    try {
      // Validate address parameter
      const addressResult = solSchemas.solanaAddressSchema.safeParse(req.params.address);
      if (!addressResult.success) {
        return res
          .status(400)
          .json(
            responseBuilder.error(
              ErrorCode.INVALID_ADDRESS,
              addressResult.error.flatten().formErrors
            )
          );
      }

      // Validate query parameters
      const queryResult = solSchemas.solanaQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        return res
          .status(400)
          .json(
            responseBuilder.error(
              ErrorCode.INVALID_QUERY_PARAMETERS,
              queryResult.error.flatten().fieldErrors
            )
          );
      }

      const address = addressResult.data;
      const options = queryResult.data;

      logger.info('Solana portfolio request', this.logRequest(req, { address, options }));

      // Use injected Solana orchestrator instead of manual initialization
      const portfolioResult = await this.usecase.getPortfolio(address, {
        protocols: options.protocols,
        includeInactive: options.includeInactive,
        includeYield: options.includeYield,
        includeRisk: options.includeRisk,
        includeAnalytics: options.includeAnalytics,
        minValue: options.minValue,
        forceRefresh: options.forceRefresh,
      });

      if (!portfolioResult.success) {
        logger.warn('Solana portfolio fetch failed', {
          error: portfolioResult.error,
          address,
          requestId: req.requestId,
        });

        return res
          .status(503)
          .json(
            responseBuilder
              .withProcessingTime(startTime)
              .error(ErrorCode.PROVIDER_ERROR, portfolioResult.error)
          );
      }

      const processingTime = Date.now() - startTime;

      res.setHeader('X-Processing-Time', `${processingTime}ms`);
      res.setHeader('X-Data-Source', 'solana-orchestrator');
      res.setHeader('X-Chain', 'solana');

      res.json(
        responseBuilder
          .withProcessingTime(startTime)
          .withMetadata('totalPositions', portfolioResult.data?.positions?.length || 0)
          .withMetadata('totalValueSOL', portfolioResult.data?.totalValueSOL || 0)
          .withMetadata('totalValueUSD', portfolioResult.data?.totalValueUSD || 0)
          .withMetadata('dataFreshness', Date.now() - (portfolioResult.data?.lastUpdated || 0))
          .success(portfolioResult.data)
      );
    } catch (error) {
      logger.error('Solana portfolio request failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address: req.params.address,
        requestId: req.requestId,
        processingTime: Date.now() - startTime,
      });

      next(error);
    }
  }

  private async getSolanaDeFiPositions(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const responseBuilder = new ResponseBuilder(req.requestId);

    try {
      const addressResult = solSchemas.solanaAddressSchema.safeParse(req.params.address);
      if (!addressResult.success) {
        return res
          .status(400)
          .json(
            responseBuilder.error(
              ErrorCode.INVALID_ADDRESS,
              addressResult.error.flatten().formErrors
            )
          );
      }

      const queryResult = solSchemas.solanaQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        return res
          .status(400)
          .json(
            responseBuilder.error(
              ErrorCode.INVALID_QUERY_PARAMETERS,
              queryResult.error.flatten().fieldErrors
            )
          );
      }

      const address = addressResult.data;
      const options = queryResult.data;

      logger.info('Solana DeFi positions request', this.logRequest(req, { address, options }));

      // Use injected port for positions
      const positionsResult = await this.dependencies.solanaPort.getDeFiPositions(
        address,
        {
          protocols: options.protocols,
          includeInactive: options.includeInactive,
          includeYield: options.includeYield,
          includeRisk: options.includeRisk,
          minValue: options.minValue,
        }
      );

      if (!positionsResult.success) {
        return res
          .status(503)
          .json(
            responseBuilder
              .withProcessingTime(startTime)
              .error(ErrorCode.PROVIDER_ERROR, positionsResult.error)
          );
      }

      res.setHeader('X-Processing-Time', `${Date.now() - startTime}ms`);
      res.setHeader('X-Data-Source', 'solana-orchestrator');

      res.json(
        responseBuilder
          .withProcessingTime(startTime)
          .withMetadata('positionCount', positionsResult.data?.positions?.length || 0)
          .withMetadata(
            'protocolCount',
            new Set(positionsResult.data?.positions?.map((p: any) => p.protocol) || []).size
          )
          .withMetadata('totalValueUSD', positionsResult.data?.totalValue || 0)
          .success(positionsResult.data)
      );
    } catch (error) {
      logger.error('Solana DeFi positions request failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address: req.params.address,
        requestId: req.requestId,
        processingTime: Date.now() - startTime,
      });

      next(error);
    }
  }

  private async getSolanaAnalytics(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const responseBuilder = new ResponseBuilder(req.requestId);

    try {
      const addressResult = solSchemas.solanaAddressSchema.safeParse(req.params.address);
      if (!addressResult.success) {
        return res
          .status(400)
          .json(
            responseBuilder.error(
              ErrorCode.INVALID_ADDRESS,
              addressResult.error.flatten().formErrors
            )
          );
      }

      const queryResult = solSchemas.solanaQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        return res
          .status(400)
          .json(
            responseBuilder.error(
              ErrorCode.INVALID_QUERY_PARAMETERS,
              queryResult.error.flatten().fieldErrors
            )
          );
      }

      const address = addressResult.data;
      const options = queryResult.data;

      logger.info('Solana analytics request', this.logRequest(req, { address, options }));

      // Delegate to use case for analytics
      const analyticsResult = await this.usecase.getAnalytics(address, {
        protocols: options.protocols,
        includeRisk: options.includeRisk,
        includeYield: options.includeYield,
      });

      if (!analyticsResult.success) {
        return res
          .status(503)
          .json(
            responseBuilder
              .withProcessingTime(startTime)
              .error(ErrorCode.PROVIDER_ERROR, analyticsResult.error)
          );
      }

      res.setHeader('X-Processing-Time', `${Date.now() - startTime}ms`);
      res.setHeader('X-Data-Source', 'solana-orchestrator');

      res.json(
        responseBuilder
          .withProcessingTime(startTime)
          .withMetadata('analyticsType', 'portfolio')
          .withMetadata('riskLevel', analyticsResult.data?.riskAssessment?.overallRisk)
          .withMetadata('performanceScore', analyticsResult.data?.performance?.totalReturn)
          .success(analyticsResult.data)
      );
    } catch (error) {
      logger.error('Solana analytics request failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address: req.params.address,
        requestId: req.requestId,
        processingTime: Date.now() - startTime,
      });

      next(error);
    }
  }

  private async analyzeCrossChainPositions(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const responseBuilder = new ResponseBuilder(req.requestId);

    try {
      const bodyResult = crossChainSchema.safeParse(req.body);
      if (!bodyResult.success) {
        return res
          .status(400)
          .json(
            responseBuilder.error(ErrorCode.INVALID_INPUT, bodyResult.error.flatten().fieldErrors)
          );
      }

      const { solanaAddress, evmAddresses } = bodyResult.data;

      logger.info(
        'Cross-chain analysis request',
        this.logRequest(req, {
          solanaAddress,
          evmAddressCount: evmAddresses.length,
        })
      );

      // Delegate to use case for cross-chain analysis
      const analysisResult = await this.usecase.analyzeCrossChainPositions(
        solanaAddress,
        evmAddresses
      );

      if (!analysisResult.success) {
        return res
          .status(503)
          .json(
            responseBuilder
              .withProcessingTime(startTime)
              .error(ErrorCode.PROVIDER_ERROR, analysisResult.error)
          );
      }

      res.setHeader('X-Processing-Time', `${Date.now() - startTime}ms`);
      res.setHeader('X-Data-Source', 'solana-orchestrator');
      res.setHeader('X-Analysis-Type', 'cross-chain');

      res.json(
        responseBuilder
          .withProcessingTime(startTime)
          .withMetadata('solanaAddress', solanaAddress)
          .withMetadata('evmAddressCount', evmAddresses.length)
          .withMetadata(
            'correlationCount',
            analysisResult.data?.crossChainCorrelations?.length || 0
          )
          .withMetadata(
            'arbitrageOpportunities',
            analysisResult.data?.arbitrageOpportunities?.length || 0
          )
          .success(analysisResult.data)
      );
    } catch (error) {
      logger.error('Cross-chain analysis request failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: req.requestId,
        processingTime: Date.now() - startTime,
      });

      next(error);
    }
  }

  private async getSolanaHealth(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const responseBuilder = new ResponseBuilder(req.requestId);

    try {
      logger.info('Solana health check request', this.logRequest(req));

      const overallHealth = await this.usecase.getHealth();

      res.setHeader('X-Processing-Time', `${Date.now() - startTime}ms`);
      res.setHeader('X-Health-Status', overallHealth.status);

      res.json(
        responseBuilder
          .withProcessingTime(startTime)
          .withMetadata('healthStatus', overallHealth.status)
          .withMetadata('serviceCount', Object.keys((overallHealth as any).services).length)
          .success(overallHealth)
      );
    } catch (error) {
      logger.error('Solana health check failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: req.requestId,
        processingTime: Date.now() - startTime,
      });

      res
        .status(500)
        .json(
          responseBuilder
            .withProcessingTime(startTime)
            .error(ErrorCode.HEALTH_CHECK_FAILED, 'Failed to check Solana service health')
        );
    }
  }

  private async getSolanaStats(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const responseBuilder = new ResponseBuilder(req.requestId);

    try {
      logger.info('Solana stats request', this.logRequest(req));

      const stats = await this.usecase.getStats();

      res.setHeader('X-Processing-Time', `${Date.now() - startTime}ms`);

      res.json(
        responseBuilder
          .withProcessingTime(startTime)
          .withMetadata('configuredProtocols', (stats as any).configuration.enabledProtocols.length)
          .withMetadata('uptime', (stats as any).runtime.uptime)
          .success(stats)
      );
    } catch (error) {
      logger.error('Solana stats request failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: req.requestId,
        processingTime: Date.now() - startTime,
      });

      next(error);
    }
  }
}

/**
 * Solana route factory function with dependency injection
 */
export const createSolanaRoutes: RouteFactory = (dependencies: ServiceDependencies): Router => {
  const factory = new SolanaRouteFactory(dependencies);
  return factory.createRoutes();
};
