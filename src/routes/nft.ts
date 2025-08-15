import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { nftOrchestrator } from '@/services/nft/NFTOrchestrator';
import { ChainId } from '@/types/blockchain';
import { NFTCategory, NFTStandard } from '@/types/nft';

const router = Router();

// Validation schemas
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

const chainIdSchema = z
  .enum(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc', 'solana'])
  .transform(chain => {
    const chainMap = {
      ethereum: ChainId.ETHEREUM,
      polygon: ChainId.POLYGON,
      arbitrum: ChainId.ARBITRUM,
      optimism: ChainId.OPTIMISM,
      base: ChainId.BASE,
      bsc: ChainId.BSC,
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

/**
 * @swagger
 * /api/nft/{address}:
 *   get:
 *     summary: Get NFT portfolio for address
 *     description: Retrieves comprehensive NFT portfolio data including collections and individual tokens
 *     tags: [NFT]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^0x[a-fA-F0-9]{40}$'
 *         description: Wallet address (Ethereum format for EVM chains, native format for Solana)
 *       - in: query
 *         name: chains
 *         schema:
 *           type: string
 *         description: Comma-separated list of chain IDs (ethereum,polygon,solana,etc.)
 *       - in: query
 *         name: categories
 *         schema:
 *           type: string
 *         description: Comma-separated list of NFT categories (art,collectibles,gaming,etc.)
 *       - in: query
 *         name: standards
 *         schema:
 *           type: string
 *         description: Comma-separated list of NFT standards (ERC721,ERC1155,SPL)
 *       - in: query
 *         name: includeMetadata
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include detailed NFT metadata
 *       - in: query
 *         name: includeListings
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include marketplace listing data
 *       - in: query
 *         name: includeAnalytics
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include collection analytics
 *       - in: query
 *         name: forceRefresh
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Force refresh data (bypass cache)
 *       - in: query
 *         name: minValue
 *         schema:
 *           type: number
 *           minimum: 0
 *         description: Minimum USD value filter
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: NFT portfolio data
 *         headers:
 *           X-Cache-Status:
 *             description: Cache hit/miss status
 *             schema:
 *               type: string
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     address:
 *                       type: string
 *                     totalNFTs:
 *                       type: number
 *                     totalCollections:
 *                       type: number
 *                     totalValue:
 *                       type: object
 *                     totalFloorValue:
 *                       type: object
 *                     chainDistribution:
 *                       type: array
 *                     categoryDistribution:
 *                       type: array
 *                     collectionDistribution:
 *                       type: array
 *                     topCollections:
 *                       type: array
 *                     topValueNFTs:
 *                       type: array
 *                     recentlyAcquired:
 *                       type: array
 *                 metadata:
 *                   type: object
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       429:
 *         $ref: '#/components/responses/RateLimit'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/:address', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate address parameter
    const addressResult = addressSchema.safeParse(req.params.address);
    if (!addressResult.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ADDRESS',
          message: 'Invalid wallet address format',
          details: addressResult.error.flatten().formErrors,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    }

    // Validate query parameters
    const queryResult = portfolioQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_QUERY_PARAMETERS',
          message: 'Invalid query parameters',
          details: queryResult.error.flatten().fieldErrors,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    }

    const address = addressResult.data;
    const options = queryResult.data;

    logger.info('NFT portfolio request', {
      address,
      options,
      requestId: req.requestId,
      userAgent: req.get('User-Agent'),
    });

    // Fetch NFT portfolio
    const result = await nftOrchestrator.getNFTPortfolio(address, options);

    // Set cache status header
    res.setHeader('X-Cache-Status', result.metadata.cacheHit ? 'HIT' : 'MISS');
    res.setHeader('X-Processing-Time', result.metadata.processingTime || '0ms');

    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    logger.error('NFT portfolio request failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      address: req.params.address,
      requestId: req.requestId,
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/nft/{address}/collection/{contractAddress}:
 *   get:
 *     summary: Get collection information and owned tokens
 *     description: Retrieves detailed information about a specific NFT collection and tokens owned by the address
 *     tags: [NFT]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^0x[a-fA-F0-9]{40}$'
 *         description: Wallet address
 *       - in: path
 *         name: contractAddress
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^0x[a-fA-F0-9]{40}$'
 *         description: NFT contract address
 *       - in: query
 *         name: chainId
 *         required: true
 *         schema:
 *           type: string
 *           enum: [ethereum, polygon, arbitrum, optimism, base, bsc, solana]
 *         description: Blockchain network
 *       - in: query
 *         name: includeAnalytics
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include collection analytics data
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Collection information and owned tokens
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     collection:
 *                       type: object
 *                     ownedTokens:
 *                       type: array
 *                     analytics:
 *                       type: object
 *                 metadata:
 *                   type: object
 */
router.get(
  '/:address/collection/:contractAddress',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate parameters
      const addressResult = addressSchema.safeParse(req.params.address);
      const contractResult = addressSchema.safeParse(req.params.contractAddress);

      if (!addressResult.success || !contractResult.success) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_PARAMETERS',
            message: 'Invalid address or contract address format',
            details: {
              address: addressResult.error?.flatten().formErrors,
              contractAddress: contractResult.error?.flatten().formErrors,
            },
          },
          metadata: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
      }

      // Validate required chainId parameter
      const chainResult = chainIdSchema.safeParse(req.query.chainId);
      if (!chainResult.success) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_CHAIN_ID',
            message: 'Chain ID is required and must be valid',
            details: chainResult.error.flatten().formErrors,
          },
          metadata: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
      }

      const address = addressResult.data;
      const contractAddress = contractResult.data;
      const chainId = chainResult.data;
      const includeAnalytics = req.query.includeAnalytics === 'true';

      logger.info('NFT collection request', {
        address,
        contractAddress,
        chainId,
        includeAnalytics,
        requestId: req.requestId,
      });

      // Fetch collection information
      const result = await nftOrchestrator.getCollectionInfo(
        contractAddress,
        chainId,
        includeAnalytics
      );

      res.setHeader('X-Processing-Time', result.metadata.processingTime || '0ms');
      res.setHeader('X-Cache-Status', result.metadata.cacheHit ? 'HIT' : 'MISS');

      if (result.success) {
        res.json(result);
      } else {
        const statusCode = result.error?.code === 'COLLECTION_INFO_ERROR' ? 404 : 500;
        res.status(statusCode).json(result);
      }
    } catch (error) {
      logger.error('NFT collection request failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address: req.params.address,
        contractAddress: req.params.contractAddress,
        requestId: req.requestId,
      });
      next(error);
    }
  }
);

/**
 * @swagger
 * /api/nft/{contractAddress}/{tokenId}:
 *   get:
 *     summary: Get NFT metadata
 *     description: Retrieves detailed metadata for a specific NFT token
 *     tags: [NFT]
 *     parameters:
 *       - in: path
 *         name: contractAddress
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^0x[a-fA-F0-9]{40}$'
 *         description: NFT contract address
 *       - in: path
 *         name: tokenId
 *         required: true
 *         schema:
 *           type: string
 *         description: NFT token ID
 *       - in: query
 *         name: chainId
 *         required: true
 *         schema:
 *           type: string
 *           enum: [ethereum, polygon, arbitrum, optimism, base, bsc, solana]
 *         description: Blockchain network
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: NFT metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     tokenId:
 *                       type: string
 *                     name:
 *                       type: string
 *                     description:
 *                       type: string
 *                     imageUrl:
 *                       type: string
 *                     attributes:
 *                       type: array
 *                     estimatedValue:
 *                       type: object
 *                     floorPrice:
 *                       type: object
 *                 metadata:
 *                   type: object
 */
router.get(
  '/:contractAddress/:tokenId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate parameters
      const contractResult = addressSchema.safeParse(req.params.contractAddress);
      const tokenId = req.params.tokenId;

      if (!contractResult.success) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_CONTRACT_ADDRESS',
            message: 'Invalid contract address format',
            details: contractResult.error.flatten().formErrors,
          },
          metadata: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
      }

      if (!tokenId || tokenId.trim() === '') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_TOKEN_ID',
            message: 'Token ID is required',
          },
          metadata: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
      }

      // Validate required chainId parameter
      const chainResult = chainIdSchema.safeParse(req.query.chainId);
      if (!chainResult.success) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_CHAIN_ID',
            message: 'Chain ID is required and must be valid',
            details: chainResult.error.flatten().formErrors,
          },
          metadata: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
      }

      const contractAddress = contractResult.data;
      const chainId = chainResult.data;

      logger.info('NFT metadata request', {
        contractAddress,
        tokenId,
        chainId,
        requestId: req.requestId,
      });

      // Fetch NFT metadata
      const result = await nftOrchestrator.getNFTMetadata(contractAddress, tokenId, chainId);

      res.setHeader('X-Processing-Time', result.metadata.processingTime || '0ms');
      res.setHeader('X-Cache-Status', result.metadata.cacheHit ? 'HIT' : 'MISS');

      if (result.success) {
        res.json(result);
      } else {
        const statusCode = result.error?.code === 'NFT_METADATA_ERROR' ? 404 : 500;
        res.status(statusCode).json(result);
      }
    } catch (error) {
      logger.error('NFT metadata request failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        contractAddress: req.params.contractAddress,
        tokenId: req.params.tokenId,
        requestId: req.requestId,
      });
      next(error);
    }
  }
);

/**
 * @swagger
 * /api/nft/detectors:
 *   get:
 *     summary: Get registered NFT detectors
 *     description: Returns list of all registered NFT detectors and their health status
 *     tags: [NFT]
 *     responses:
 *       200:
 *         description: NFT detectors and status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     detectors:
 *                       type: array
 *                       items:
 *                         type: string
 *                     enrichers:
 *                       type: array
 *                       items:
 *                         type: string
 *                     healthStatus:
 *                       type: object
 */
router.get('/detectors', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const detectors = nftOrchestrator.getRegisteredDetectors();
    const enrichers = nftOrchestrator.getRegisteredEnrichers();
    const healthStatus = nftOrchestrator.getHealthStatus();

    res.json({
      success: true,
      data: {
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
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  } catch (error) {
    logger.error('NFT detectors request failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.requestId,
    });
    next(error);
  }
});

export default router;
