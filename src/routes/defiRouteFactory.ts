import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { ChainId } from '@/types/blockchain';
import { DeFiProtocol } from '@/types/defi';
import { BaseRouteFactory, RouteFactory } from './routeFactory';
import { ServiceDeps as ServiceDependencies } from '@/app/runtime';
import { ErrorCode } from '@/utils/errorCatalog';
import { ResponseBuilder } from '@/utils/responseBuilder';
import { DeFiUseCase } from '@/app/usecases/DeFiUseCase';

// Validation schemas
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

const chainIdSchema = z
  .enum(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc', 'avalanche'])
  .transform(chain => {
    const chainMap = {
      ethereum: ChainId.ETHEREUM,
      polygon: ChainId.POLYGON,
      arbitrum: ChainId.ARBITRUM,
      optimism: ChainId.OPTIMISM,
      base: ChainId.BASE,
      bsc: ChainId.BSC,
      avalanche: ChainId.AVALANCHE,
    };
    return chainMap[chain];
  });

const protocolSchema = z
  .enum(['aave-v3', 'compound-v3', 'uniswap-v3', 'curve', 'yearn', 'lido'])
  .transform(protocol => {
    const protocolMap = {
      'aave-v3': DeFiProtocol.AAVE_V3,
      'compound-v3': DeFiProtocol.COMPOUND_V3,
      'uniswap-v3': DeFiProtocol.UNISWAP_V3,
      curve: DeFiProtocol.CURVE,
      yearn: DeFiProtocol.YEARN,
      lido: DeFiProtocol.LIDO,
    };
    return protocolMap[protocol];
  });

const defiQuerySchema = z.object({
  chains: z
    .string()
    .optional()
    .transform(val => (val ? val.split(',').map(c => chainIdSchema.parse(c.trim())) : undefined)),
  protocols: z
    .string()
    .optional()
    .transform(val => (val ? val.split(',').map(p => protocolSchema.parse(p.trim())) : undefined)),
  includeInactive: z
    .string()
    .optional()
    .transform(val => val === 'true'),
  includeYield: z
    .string()
    .optional()
    .transform(val => val !== 'false'),
  includeRisk: z
    .string()
    .optional()
    .transform(val => val === 'true'),
  minValue: z
    .string()
    .optional()
    .transform(val => (val ? parseFloat(val) : 0.01)),
  forceRefresh: z
    .string()
    .optional()
    .transform(val => val === 'true'),
});

class DeFiRouteFactory extends BaseRouteFactory {
  private readonly usecase: DeFiUseCase;

  constructor(dependencies: ServiceDependencies) {
    super(dependencies);
    this.usecase = new DeFiUseCase(dependencies);
  }
  createRoutes(): Router {
    const router = Router();

    router.get('/:address', this.getDeFiPortfolio.bind(this));
    router.get('/:address/protocols/:protocol', this.getProtocolPositions.bind(this));

    return router;
  }

  private async getDeFiPortfolio(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const responseBuilder = new ResponseBuilder(req.requestId);

    try {
      // Validate address parameter
      const addressResult = addressSchema.safeParse(req.params.address);
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
      const queryResult = defiQuerySchema.safeParse(req.query);
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

      logger.info('DeFi portfolio request', this.logRequest(req, { address, options }));

      // Delegate to use case
      const portfolioResult = await this.usecase.getPortfolio(address, {
        chainIds: options.chains,
        protocols: options.protocols,
        includeInactive: options.includeInactive,
        includeYield: options.includeYield,
        includeRisk: options.includeRisk,
        minValue: options.minValue,
        forceRefresh: options.forceRefresh,
      });

      if (!portfolioResult.success) {
        logger.warn('DeFi portfolio fetch failed', {
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
      res.setHeader('X-Data-Source', 'defi-orchestrator');

      res.json(
        responseBuilder
          .withProcessingTime(startTime)
          .withMetadata('totalPositions', portfolioResult.data?.positions?.length || 0)
          .withMetadata('totalValueUSD', portfolioResult.data?.totalValueUSD || 0)
          .success(portfolioResult.data)
      );
    } catch (error) {
      logger.error('DeFi portfolio request failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address: req.params.address,
        requestId: req.requestId,
        processingTime: Date.now() - startTime,
      });

      next(error);
    }
  }

  private async getProtocolPositions(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const responseBuilder = new ResponseBuilder(req.requestId);

    try {
      const addressResult = addressSchema.safeParse(req.params.address);
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

      const protocolResult = protocolSchema.safeParse(req.params.protocol);
      if (!protocolResult.success) {
        return res
          .status(400)
          .json(responseBuilder.error(ErrorCode.BAD_REQUEST, 'Invalid protocol specified'));
      }

      const queryResult = defiQuerySchema.safeParse(req.query);
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
      const protocol = protocolResult.data;
      const options = queryResult.data;

      logger.info(
        'Protocol positions request',
        this.logRequest(req, { address, protocol, options })
      );

      const positionsResult = await this.dependencies.defiPort.getProtocolPositions(
        protocol as any,
        address,
        options.chains?.[0]
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

      if (!positionsResult.data || positionsResult.data.length === 0) {
        return res
          .status(404)
          .json(
            responseBuilder
              .withProcessingTime(startTime)
              .error(ErrorCode.POSITION_NOT_FOUND, 'No positions found for the specified protocol')
          );
      }

      res.json(
        responseBuilder
          .withProcessingTime(startTime)
          .withMetadata('protocol', protocol)
          .withMetadata('positionCount', positionsResult.data.length)
          .success(positionsResult.data)
      );
    } catch (error) {
      logger.error('Protocol positions request failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address: req.params.address,
        protocol: req.params.protocol,
        requestId: req.requestId,
        processingTime: Date.now() - startTime,
      });

      next(error);
    }
  }
}

/**
 * DeFi route factory function
 */
export const createDeFiRoutes: RouteFactory = (dependencies: ServiceDependencies): Router => {
  const factory = new DeFiRouteFactory(dependencies);
  return factory.createRoutes();
};
