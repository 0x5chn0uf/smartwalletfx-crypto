import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { ChainId } from '@/types/blockchain';
import { NFTCategory, NFTStandard } from '@/types/nft';
import { BaseRouteFactory, RouteFactory } from './routeFactory';
import { ServiceDeps as ServiceDependencies } from '@/app/runtime';
import { NFTUseCase } from '@/app/usecases/NFTUseCase';

// Validation schemas
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

const chainIdSchema = z
  .enum(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc', 'avalanche', 'solana'])
  .transform(chain => {
    const chainMap = {
      ethereum: ChainId.ETHEREUM,
      polygon: ChainId.POLYGON,
      arbitrum: ChainId.ARBITRUM,
      optimism: ChainId.OPTIMISM,
      base: ChainId.BASE,
      bsc: ChainId.BSC,
      avalanche: ChainId.AVALANCHE,
      solana: ChainId.SOLANA,
    };
    return chainMap[chain];
  });

const nftCategorySchema = z
  .enum([
    'art',
    'collectibles',
    'gaming',
    'metaverse',
    'music',
    'photography',
    'sports',
    'utility',
    'other',
  ])
  .transform(category => {
    const categoryMap = {
      art: NFTCategory.ART,
      collectibles: NFTCategory.COLLECTIBLES,
      gaming: NFTCategory.GAMING,
      metaverse: NFTCategory.VIRTUAL_WORLDS,
      music: NFTCategory.MUSIC,
      photography: NFTCategory.PHOTOGRAPHY,
      sports: NFTCategory.SPORTS,
      utility: NFTCategory.UTILITY,
      other: NFTCategory.UNKNOWN,
    };
    return categoryMap[category];
  });

const nftStandardSchema = z.enum(['ERC721', 'ERC1155', 'SPL']).transform(standard => {
  const standardMap = {
    ERC721: NFTStandard.ERC_721,
    ERC1155: NFTStandard.ERC_1155,
    SPL: NFTStandard.SPL_TOKEN,
  };
  return standardMap[standard];
});

const portfolioQuerySchema = z.object({
  chains: z
    .string()
    .optional()
    .transform(val => (val ? val.split(',').map(c => chainIdSchema.parse(c.trim())) : undefined)),
  categories: z
    .string()
    .optional()
    .transform(val =>
      val ? val.split(',').map(c => nftCategorySchema.parse(c.trim())) : undefined
    ),
  standards: z
    .string()
    .optional()
    .transform(val =>
      val ? val.split(',').map(s => nftStandardSchema.parse(s.trim())) : undefined
    ),
  includeMetadata: z
    .string()
    .optional()
    .transform(val => val !== 'false'),
  includeListings: z
    .string()
    .optional()
    .transform(val => val === 'true'),
  includeAnalytics: z
    .string()
    .optional()
    .transform(val => val === 'true'),
  forceRefresh: z
    .string()
    .optional()
    .transform(val => val === 'true'),
  minValue: z
    .string()
    .optional()
    .transform(val => (val ? parseFloat(val) : undefined)),
});

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
      const options = queryResult.data;

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
      const addressResult = addressSchema.safeParse(req.params.address);
      const contractResult = addressSchema.safeParse(req.params.contractAddress);

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
      const chainResult = chainIdSchema.safeParse(req.query.chainId);
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
      const chainResult = chainIdSchema.safeParse(req.query.chainId);
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
