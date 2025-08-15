import { Router, Request, Response, NextFunction } from 'express';
import { PortfolioSummary } from '@/types/blockchain';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { DeFiOrchestrator } from '@/services/defi/DeFiOrchestrator';
import { nftOrchestrator } from '@/services/nft/NFTOrchestrator';
import { redisManager } from '@/utils/redis';
import { ChainId } from '@/types/blockchain';
import { DeFiProtocol } from '@/types/defi';
import { NFTCategory, NFTStandard } from '@/types/nft';

const router = Router();

// Initialize DeFi Orchestrator
const defiOrchestrator = new DeFiOrchestrator({
  enabledProtocols: [],
  maxConcurrentRequests: 10,
  defaultCacheTtl: 300,
  healthCheckInterval: 60000,
  fallbackToCache: true,
  rpcUrls: {}
});

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

const portfolioQuerySchema = z.object({
  chains: z
    .string()
    .optional()
    .transform(val => (val ? val.split(',').map(c => chainIdSchema.parse(c.trim())) : undefined)),
  includeDefi: z
    .string()
    .optional()
    .transform(val => val !== 'false'),
  includeNfts: z
    .string()
    .optional()
    .transform(val => val !== 'false'),
  includeMetadata: z
    .string()
    .optional()
    .transform(val => val !== 'false'),
  includeAnalytics: z
    .string()
    .optional()
    .transform(val => val === 'true'),
  forceRefresh: z
    .string()
    .optional()
    .transform(val => val === 'true'),
  minDefiValue: z
    .string()
    .optional()
    .transform(val => (val ? parseFloat(val) : 0.01)),
  minNftValue: z
    .string()
    .optional()
    .transform(val => (val ? parseFloat(val) : undefined)),
});

/**
 * @swagger
 * /api/portfolio/{address}:
 *   get:
 *     summary: Get complete portfolio aggregation
 *     description: Retrieves comprehensive portfolio data including DeFi positions, NFTs, and aggregated metrics
 *     tags: [Portfolio]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^0x[a-fA-F0-9]{40}$'
 *         description: Wallet address
 *       - in: query
 *         name: chains
 *         schema:
 *           type: string
 *         description: Comma-separated list of chain IDs (ethereum,polygon,arbitrum,etc.)
 *       - in: query
 *         name: includeDefi
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include DeFi positions in portfolio
 *       - in: query
 *         name: includeNfts
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include NFT collections in portfolio
 *       - in: query
 *         name: includeMetadata
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include detailed metadata for assets
 *       - in: query
 *         name: includeAnalytics
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include advanced analytics and insights
 *       - in: query
 *         name: forceRefresh
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Force refresh data (bypass cache)
 *       - in: query
 *         name: minDefiValue
 *         schema:
 *           type: number
 *           default: 0.01
 *         description: Minimum USD value for DeFi positions
 *       - in: query
 *         name: minNftValue
 *         schema:
 *           type: number
 *         description: Minimum USD value for NFT assets
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Complete portfolio data
 *         headers:
 *           X-Cache-Status:
 *             description: Cache hit/miss status
 *             schema:
 *               type: string
 *           X-Processing-Time:
 *             description: Total processing time in milliseconds
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
 *                     summary:
 *                       type: object
 *                       properties:
 *                         totalValueUSD:
 *                           type: number
 *                         defiValueUSD:
 *                           type: number
 *                         nftValueUSD:
 *                           type: number
 *                         totalPositions:
 *                           type: number
 *                         totalCollections:
 *                           type: number
 *                     defi:
 *                       type: object
 *                       nullable: true
 *                     nfts:
 *                       type: object
 *                       nullable: true
 *                     chainDistribution:
 *                       type: array
 *                     performanceMetrics:
 *                       type: object
 *                     riskAnalysis:
 *                       type: object
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
  const startTime = Date.now();

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

    logger.info('Portfolio aggregation request', {
      address,
      options,
      requestId: req.requestId,
      userAgent: req.get('User-Agent'),
    });

    // Check cache first (unless forced refresh)
    const cacheKey = `portfolio-complete:${address}:${JSON.stringify(options)}`;
    let cacheHit = false;

    if (!options.forceRefresh) {
      const cached = await redisManager.get(cacheKey);
      if (cached) {
        cacheHit = true;
        res.setHeader('X-Cache-Status', 'HIT');
        res.setHeader('X-Processing-Time', `${Date.now() - startTime}ms`);

        return res.json({
          success: true,
          data: cached,
          metadata: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
            cacheHit: true,
            processingTime: Date.now() - startTime,
            detailMode: 'full',
          },
        });
      }
    }

    // Fetch DeFi and NFT data concurrently
    const fetchPromises: Promise<any>[] = [];

    if (options.includeDefi) {
      fetchPromises.push(
        defiOrchestrator
          .getDeFiPortfolio(address, {
            chainIds: options.chains,
            includeInactive: false, // Filter out dust positions
          })
          .catch((error: any) => {
            logger.warn('DeFi portfolio fetch failed in aggregation', {
              error: error.message,
              address,
              requestId: req.requestId,
            });
            return null;
          })
      );
    } else {
      fetchPromises.push(Promise.resolve(null));
    }

    if (options.includeNfts) {
      fetchPromises.push(
        nftOrchestrator
          .getNFTPortfolio(address, {
            chainIds: options.chains,
            includeMetadata: options.includeMetadata,
            includeAnalytics: options.includeAnalytics,
            minValue: options.minNftValue,
          })
          .catch(error => {
            logger.warn('NFT portfolio fetch failed in aggregation', {
              error: error.message,
              address,
              requestId: req.requestId,
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

    // Build aggregated portfolio
    const portfolioSummary = await buildPortfolioSummary(address, defiData, nftData, options);

    // Calculate performance metrics if analytics requested
    let performanceMetrics = null;
    let riskAnalysis = null;

    if (options.includeAnalytics) {
      performanceMetrics = calculatePerformanceMetrics(defiData, nftData);
      riskAnalysis = calculateRiskAnalysis(defiData, nftData);
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
      insights: options.includeAnalytics ? generatePortfolioInsights(defiData, nftData) : null,
    };

    // Cache the result for 5 minutes
    await redisManager.set(cacheKey, portfolioData, 300);

    const processingTime = Date.now() - startTime;

    res.setHeader('X-Cache-Status', 'MISS');
    res.setHeader('X-Processing-Time', `${processingTime}ms`);
    res.setHeader(
      'X-Data-Sources',
      [defiData ? 'defi' : null, nftData ? 'nfts' : null].filter(Boolean).join(',')
    );

    res.json({
      success: true,
      data: portfolioData,
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
        cacheHit: false,
        processingTime,
        dataSources: {
          defi: !!defiData,
          nfts: !!nftData,
        },
      },
    });
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
});

/**
 * @swagger
 * /api/portfolio/{address}/summary:
 *   get:
 *     summary: Get portfolio summary only
 *     description: Retrieves a lightweight portfolio summary with key metrics
 *     tags: [Portfolio]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^0x[a-fA-F0-9]{40}$'
 *         description: Wallet address
 *       - in: query
 *         name: chains
 *         schema:
 *           type: string
 *         description: Comma-separated list of chain IDs
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Portfolio summary
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
 *                     totalValueUSD:
 *                       type: number
 *                     breakdown:
 *                       type: object
 *                 metadata:
 *                   type: object
 */
router.get('/:address/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const addressResult = addressSchema.safeParse(req.params.address);
    if (!addressResult.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ADDRESS',
          message: 'Invalid wallet address format',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    }

    const address = addressResult.data;
    const chains = req.query.chains
      ? String(req.query.chains)
          .split(',')
          .map(c => chainIdSchema.parse(c.trim()))
      : undefined;

    // Quick summary with minimal data fetching
    const [defiResult, nftResult] = await Promise.allSettled([
      defiOrchestrator.getDeFiPortfolio(address, { chainIds: chains, includeInactive: false }),
      nftOrchestrator.getNFTPortfolio(address, {
        chainIds: chains,
        includeMetadata: false,
        includeListings: false,
      }),
    ]);

    const defiValue =
      defiResult.status === 'fulfilled' && defiResult.value.success
        ? defiResult.value.data.totalValueUSD
        : 0;

    const nftValue =
      nftResult.status === 'fulfilled' && nftResult.value.success
        ? nftResult.value.data.totalValue.usdValue || 0
        : 0;

    const totalValue = defiValue + nftValue;

    res.json({
      success: true,
      data: {
        address,
        totalValueUSD: totalValue,
        breakdown: {
          defiValueUSD: defiValue,
          nftValueUSD: nftValue,
        },
        percentageBreakdown:
          totalValue > 0
            ? {
                defiPercentage: (defiValue / totalValue) * 100,
                nftPercentage: (nftValue / totalValue) * 100,
              }
            : null,
        lastUpdated: new Date().toISOString(),
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  } catch (error) {
    logger.error('Portfolio summary failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      address: req.params.address,
      requestId: req.requestId,
    });
    next(error);
  }
});

// Helper functions

async function buildPortfolioSummary(address: string, defiData: any, nftData: any, options: any) {
  const defiValueUSD = defiData?.totalValueUSD || 0;
  const nftValueUSD = nftData?.totalValue?.usdValue || 0;
  const totalValueUSD = defiValueUSD + nftValueUSD;

  // Calculate net worth (considering borrowed amounts in DeFi)
  const totalBorrowedUSD = defiData?.totalBorrowedUSD || 0;
  const netWorth = totalValueUSD - totalBorrowedUSD;

  // Aggregate chain distribution
  const chainDistribution = aggregateChainDistribution(defiData, nftData);

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

function aggregateChainDistribution(defiData: any, nftData: any) {
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

  const totalValue = Array.from(chainTotals.values()).reduce((sum, chain) => sum + chain.total, 0);

  return Array.from(chainTotals.entries()).map(([chainId, values]) => ({
    chainId,
    defiValueUSD: values.defi,
    nftValueUSD: values.nft,
    totalValueUSD: values.total,
    percentage: totalValue > 0 ? (values.total / totalValue) * 100 : 0,
  }));
}

function calculatePerformanceMetrics(defiData: any, nftData: any) {
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

function calculateRiskAnalysis(defiData: any, nftData: any) {
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
        concentrationRisk: calculateNFTConcentrationRisk(nftData),
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

function calculateNFTConcentrationRisk(nftData: any) {
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

function generatePortfolioInsights(defiData: any, nftData: any) {
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
    const concentrationRisk = calculateNFTConcentrationRisk(nftData);
    if (concentrationRisk === 'HIGH') {
      insights.push({
        type: 'WARNING',
        category: 'NFT_CONCENTRATION',
        message: 'Portfolio is heavily concentrated in one NFT collection. Consider diversifying.',
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
 * @swagger
 * /api/portfolio/status/{requestId}:
 *   get:
 *     summary: Get async portfolio request status
 *     description: Retrieves the status and progress of an async portfolio request
 *     tags: [Portfolio]
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Async request ID
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Request status information
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
 *                     requestId:
 *                       type: string
 *                     status:
 *                       type: string
 *                       enum: [queued, processing, completed, failed]
 *                     submittedAt:
 *                       type: string
 *                       format: date-time
 *                     completedAt:
 *                       type: string
 *                       format: date-time
 *                     progress:
 *                       type: number
 *                       minimum: 0
 *                       maximum: 100
 *                     estimatedCompletionTime:
 *                       type: string
 *                       format: date-time
 *                     error:
 *                       type: string
 *                     resultUrl:
 *                       type: string
 *                 metadata:
 *                   type: object
 *       404:
 *         description: Request not found
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/status/:requestId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.params;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(requestId)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST_ID',
          message: 'Invalid request ID format',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    }

    if (!config.features.asyncPortfolio) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'FEATURE_DISABLED',
          message: 'Async portfolio feature is disabled',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    }

    const eventBus = getEventBus();
    const asyncService = getAsyncPortfolioService(eventBus);

    const status = await asyncService.getRequestStatus(requestId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'REQUEST_NOT_FOUND',
          message: 'Request not found or expired',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
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

    res.json({
      success: true,
      data: responseData,
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
        asyncRequestId: requestId,
      },
    });
  } catch (error) {
    logger.error('Portfolio status request failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.params.requestId,
      originalRequestId: req.requestId,
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/portfolio/result/{requestId}:
 *   get:
 *     summary: Get async portfolio request result
 *     description: Retrieves the result of a completed async portfolio request
 *     tags: [Portfolio]
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Async request ID
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Portfolio data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: Complete portfolio data (same structure as sync endpoint)
 *                 metadata:
 *                   type: object
 *       404:
 *         description: Result not found or not ready
 *       410:
 *         description: Result expired
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/result/:requestId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.params;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(requestId)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST_ID',
          message: 'Invalid request ID format',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    }

    if (!config.features.asyncPortfolio) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'FEATURE_DISABLED',
          message: 'Async portfolio feature is disabled',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    }

    const eventBus = getEventBus();
    const asyncService = getAsyncPortfolioService(eventBus);

    // Check status first
    const status = await asyncService.getRequestStatus(requestId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'REQUEST_NOT_FOUND',
          message: 'Request not found or expired',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
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
    const result = await asyncService.getRequestResult(requestId);

    if (!result) {
      return res.status(410).json({
        success: false,
        error: {
          code: 'RESULT_EXPIRED',
          message: 'Result has expired and is no longer available',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
          asyncRequestId: requestId,
        },
      });
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

    res.json({
      success: true,
      data: result.data,
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
        asyncRequestId: requestId,
        completedAt: result.completedAt,
        processingTime: result.metadata.processingTime,
        cacheHitRate: result.metadata.cacheHitRate,
        dataQuality: result.metadata.dataQuality,
        detailMode: 'async',
      },
    });
  } catch (error) {
    logger.error('Portfolio result request failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.params.requestId,
      originalRequestId: req.requestId,
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/portfolio/stats:
 *   get:
 *     summary: Get async portfolio service statistics
 *     description: Retrieves statistics about the async portfolio processing service
 *     tags: [Portfolio]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Service statistics
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
 *                     activeRequests:
 *                       type: number
 *                     maxConcurrentRequests:
 *                       type: number
 *                     queuedRequests:
 *                       type: number
 *                     processingRequests:
 *                       type: number
 *                     utilizationPercent:
 *                       type: number
 *                 metadata:
 *                   type: object
 *       404:
 *         description: Feature disabled
 */
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!config.features.asyncPortfolio) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'FEATURE_DISABLED',
          message: 'Async portfolio feature is disabled',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    }

    const eventBus = getEventBus();
    const asyncService = getAsyncPortfolioService(eventBus);
    const stats = asyncService.getRequestStats();

    res.json({
      success: true,
      data: stats,
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  } catch (error) {
    logger.error('Portfolio stats request failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.requestId,
    });
    next(error);
  }
});

export default router;
