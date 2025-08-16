import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as nftSchemas from '@/routes/schema/nft';
import { logger } from '@/utils/logger';
// Local schemas now provide chain/category/standard parsing
import { BaseRouteFactory } from './routeFactory';
import type { RouteFactory } from './interfaces';
import { ServiceDeps as ServiceDependencies } from '@/app/runtime';
import { NFTUseCase } from '@/app/usecases/NFTUseCase';
import type { NFTQueryOptions } from './interfaces/nft';

// Validation schemas moved to '@/routes/schema/nft'

class NFTRouteFactory extends BaseRouteFactory {
  private readonly usecase: NFTUseCase;

  constructor(dependencies: ServiceDependencies) {
    super(dependencies);
    this.usecase = new NFTUseCase(dependencies);
  }
  createRoutes(): Router {
    const router = Router();

    // NFT portfolio and metadata endpoints
    router.get('/:address', this.getNFTPortfolio.bind(this));
    router.get('/:address/collection/:contractAddress', this.getCollectionInfo.bind(this));
    router.get('/:contractAddress/:tokenId', this.getNFTMetadata.bind(this));
    router.get('/detectors', this.getDetectors.bind(this));

    return router;
  }

  private async getNFTPortfolio(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();

    try {
      // Validate address parameter
      const addressResult = nftSchemas.addressSchema.safeParse(req.params.address);
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
      const queryResult = nftSchemas.portfolioQuerySchema.safeParse(req.query);
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
      const options: NFTQueryOptions = queryResult.data;

      logger.info('NFT portfolio request', this.logRequest(req, { address, options }));

      // Delegate to use case
      const result = await this.usecase.getPortfolio(address, {
        chainIds: options.chains,
        categories: options.categories,
        standards: options.standards,
        includeMetadata: options.includeMetadata,
        includeListings: options.includeListings,
        includeAnalytics: options.includeAnalytics,
        forceRefresh: options.forceRefresh,
        minValue: options.minValue,
      });

      const processingTime = Date.now() - startTime;

      // Set response headers
      res.setHeader('X-Cache-Status', result.metadata?.cacheHit ? 'HIT' : 'MISS');
      res.setHeader('X-Processing-Time', `${processingTime}ms`);

      if (result.success) {
        res.json(
          this.createSuccessResponse(result.data, {
            requestId: req.requestId,
            processingTime,
            cacheHit: result.metadata?.cacheHit || false,
            totalNFTs: result.data?.totalNFTs || 0,
            totalCollections: result.data?.totalCollections || 0,
          })
        );
      } else {
        logger.warn('NFT portfolio fetch failed', {
          error: result.error,
          address,
          requestId: req.requestId,
        });

        res
          .status(500)
          .json(
            this.createErrorResponse(
              'NFT_PORTFOLIO_ERROR',
              result.error?.message || 'Failed to fetch NFT portfolio',
              result.error
            )
          );
      }
    } catch (error) {
      logger.error('NFT portfolio request failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address: req.params.address,
        requestId: req.requestId,
        processingTime: Date.now() - startTime,
      });

      next(error);
    }
  }

  private async getCollectionInfo(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();

    try {
      // Validate parameters
      const addressResult = nftSchemas.addressSchema.safeParse(req.params.address);
      const contractResult = nftSchemas.addressSchema.safeParse(req.params.contractAddress);

      if (!addressResult.success || !contractResult.success) {
        return res.status(400).json(
          this.createErrorResponse(
            'INVALID_PARAMETERS',
            'Invalid address or contract address format',
            {
              address: addressResult.error?.flatten().formErrors,
              contractAddress: contractResult.error?.flatten().formErrors,
            }
          )
        );
      }

      // Validate required chainId parameter
      const chainResult = nftSchemas.chainIdSchema.safeParse(req.query.chainId);
      if (!chainResult.success) {
        return res
          .status(400)
          .json(
            this.createErrorResponse(
              'INVALID_CHAIN_ID',
              'Chain ID is required and must be valid',
              chainResult.error.flatten().formErrors
            )
          );
      }

      const address = addressResult.data;
      const contractAddress = contractResult.data;
      const chainId = chainResult.data;
      const includeAnalytics = req.query.includeAnalytics === 'true';

      logger.info(
        'NFT collection request',
        this.logRequest(req, {
          address,
          contractAddress,
          chainId,
          includeAnalytics,
        })
      );

      // Use injected NFT port
      const result = await this.dependencies.nftPort.getCollectionInfo(
        contractAddress,
        chainId,
        includeAnalytics
      );

      const processingTime = Date.now() - startTime;

      res.setHeader('X-Processing-Time', `${processingTime}ms`);
      res.setHeader('X-Cache-Status', result.metadata?.cacheHit ? 'HIT' : 'MISS');

      if (result.success) {
        res.json(
          this.createSuccessResponse(result.data, {
            requestId: req.requestId,
            processingTime,
            contractAddress,
            chainId,
          })
        );
      } else {
        const statusCode = result.error?.code === 'COLLECTION_INFO_ERROR' ? 404 : 500;
        res
          .status(statusCode)
          .json(
            this.createErrorResponse(
              result.error?.code || 'COLLECTION_ERROR',
              result.error?.message || 'Failed to fetch collection information',
              result.error
            )
          );
      }
    } catch (error) {
      logger.error('NFT collection request failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address: req.params.address,
        contractAddress: req.params.contractAddress,
        requestId: req.requestId,
        processingTime: Date.now() - startTime,
      });

      next(error);
    }
  }

  private async getNFTMetadata(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();

    try {
      // Validate parameters
      const contractResult = addressSchema.safeParse(req.params.contractAddress);
      const tokenId = req.params.tokenId;

      if (!contractResult.success) {
        return res
          .status(400)
          .json(
            this.createErrorResponse(
              'INVALID_CONTRACT_ADDRESS',
              'Invalid contract address format',
              contractResult.error.flatten().formErrors
            )
          );
      }

      if (!tokenId || tokenId.trim() === '') {
        return res
          .status(400)
          .json(this.createErrorResponse('INVALID_TOKEN_ID', 'Token ID is required'));
      }

      // Validate required chainId parameter
      const chainResult = nftSchemas.chainIdSchema.safeParse(req.query.chainId);
      if (!chainResult.success) {
        return res
          .status(400)
          .json(
            this.createErrorResponse(
              'INVALID_CHAIN_ID',
              'Chain ID is required and must be valid',
              chainResult.error.flatten().formErrors
            )
          );
      }

      const contractAddress = contractResult.data;
      const chainId = chainResult.data;

      logger.info(
        'NFT metadata request',
        this.logRequest(req, {
          contractAddress,
          tokenId,
          chainId,
        })
      );

      // Use injected NFT port
      const result = await this.dependencies.nftPort.getNFTMetadata(
        contractAddress,
        tokenId,
        chainId
      );

      const processingTime = Date.now() - startTime;

      res.setHeader('X-Processing-Time', `${processingTime}ms`);
      res.setHeader('X-Cache-Status', result.metadata?.cacheHit ? 'HIT' : 'MISS');

      if (result.success) {
        res.json(
          this.createSuccessResponse(result.data, {
            requestId: req.requestId,
            processingTime,
            contractAddress,
            tokenId,
            chainId,
          })
        );
      } else {
        const statusCode = result.error?.code === 'NFT_METADATA_ERROR' ? 404 : 500;
        res
          .status(statusCode)
          .json(
            this.createErrorResponse(
              result.error?.code || 'NFT_ERROR',
              result.error?.message || 'Failed to fetch NFT metadata',
              result.error
            )
          );
      }
    } catch (error) {
      logger.error('NFT metadata request failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        contractAddress: req.params.contractAddress,
        tokenId: req.params.tokenId,
        requestId: req.requestId,
        processingTime: Date.now() - startTime,
      });

      next(error);
    }
  }

  private async getDetectors(req: Request, res: Response, next: NextFunction) {
    try {
      logger.info('NFT detectors request', this.logRequest(req));

      // Use injected NFT port
      const detectors = this.dependencies.nftPort.getRegisteredDetectors();
      const enrichers = this.dependencies.nftPort.getRegisteredEnrichers();
      const healthStatus = this.dependencies.nftPort.getHealthStatus();

      const responseData = {
        detectors,
        enrichers,
        healthStatus,
        summary: {
          totalDetectors: detectors.length,
          totalEnrichers: enrichers.length,
          healthyDetectors: Object.values(healthStatus.detectors).filter(d => d.isHealthy).length,
          healthyEnrichers: Object.values(healthStatus.enrichers).filter(e => e.isHealthy).length,
          overallHealth: healthStatus.isHealthy,
        },
      };

      res.json(
        this.createSuccessResponse(responseData, {
          requestId: req.requestId,
        })
      );
    } catch (error) {
      logger.error('NFT detectors request failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: req.requestId,
      });

      next(error);
    }
  }
}

/**
 * NFT route factory function
 */
export const createNFTRoutes: RouteFactory = (dependencies: ServiceDependencies): Router => {
  const factory = new NFTRouteFactory(dependencies);
  return factory.createRoutes();
};
