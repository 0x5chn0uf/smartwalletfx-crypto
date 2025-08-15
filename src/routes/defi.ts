import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { DeFiOrchestrator } from '@/services/defi/DeFiOrchestrator';
import { ChainId } from '@/types/blockchain';
import { DeFiProtocol } from '@/types/defi';

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

const portfolioQuerySchema = z.object({
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
  forceRefresh: z
    .string()
    .optional()
    .transform(val => val === 'true'),
});

/**
 * @swagger
 * /api/defi/{address}:
 *   get:
 *     summary: Get DeFi portfolio for address
 *     description: Retrieves comprehensive DeFi portfolio data including positions across all supported protocols
 *     tags: [DeFi]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^0x[a-fA-F0-9]{40}$'
 *         description: Ethereum wallet address
 *       - in: query
 *         name: chains
 *         schema:
 *           type: string
 *         description: Comma-separated list of chain IDs (ethereum,polygon,arbitrum,etc.)
 *       - in: query
 *         name: protocols
 *         schema:
 *           type: string
 *         description: Comma-separated list of protocols (aave-v3,compound-v3,uniswap-v3,etc.)
 *       - in: query
 *         name: includeInactive
 *         schema:
 *           type: boolean
 *         description: Include positions with zero or very low value
 *       - in: query
 *         name: forceRefresh
 *         schema:
 *           type: boolean
 *         description: Force refresh data (bypass cache)
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: DeFi portfolio data
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
 *                     totalValueUSD:
 *                       type: number
 *                     netValueUSD:
 *                       type: number
 *                     totalSuppliedUSD:
 *                       type: number
 *                     totalBorrowedUSD:
 *                       type: number
 *                     totalRewardsUSD:
 *                       type: number
 *                     protocolDistribution:
 *                       type: array
 *                     chainDistribution:
 *                       type: array
 *                     positions:
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

    logger.info('DeFi portfolio request', {
      address,
      options,
      requestId: req.requestId,
      userAgent: req.get('User-Agent'),
    });

    // Fetch DeFi portfolio
    const result = await defiOrchestrator.getDeFiPortfolio(address, {
      chainIds: options.chains,
      protocols: options.protocols,
      includeInactive: options.includeInactive,
    });

    // Set cache status header
    res.setHeader('X-Cache-Status', result.metadata.cacheHit ? 'HIT' : 'MISS');

    // Set performance headers
    res.setHeader('X-Execution-Time', result.metadata.executionTime || 0);
    res.setHeader('X-Provider', result.metadata.provider);

    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    logger.error('DeFi portfolio request failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      address: req.params.address,
      requestId: req.requestId,
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/defi/{address}/protocol/{protocol}:
 *   get:
 *     summary: Get protocol-specific positions
 *     description: Retrieves DeFi positions for a specific protocol and address
 *     tags: [DeFi]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^0x[a-fA-F0-9]{40}$'
 *         description: Ethereum wallet address
 *       - in: path
 *         name: protocol
 *         required: true
 *         schema:
 *           type: string
 *           enum: [aave-v3, compound-v3, uniswap-v3, curve, yearn, lido]
 *         description: DeFi protocol identifier
 *       - in: query
 *         name: chainId
 *         schema:
 *           type: string
 *           enum: [ethereum, polygon, arbitrum, optimism, base, bsc, avalanche]
 *         description: Specific chain to query (optional)
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Protocol-specific positions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                 metadata:
 *                   type: object
 */
router.get(
  '/:address/protocol/:protocol',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate parameters
      const addressResult = addressSchema.safeParse(req.params.address);
      const protocolResult = protocolSchema.safeParse(req.params.protocol);

      if (!addressResult.success || !protocolResult.success) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_PARAMETERS',
            message: 'Invalid address or protocol format',
            details: {
              address: addressResult.error?.flatten().formErrors,
              protocol: protocolResult.error?.flatten().formErrors,
            },
          },
          metadata: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
      }

      // Validate optional chainId parameter
      let chainId: ChainId | undefined;
      if (req.query.chainId) {
        const chainResult = chainIdSchema.safeParse(req.query.chainId);
        if (!chainResult.success) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_CHAIN_ID',
              message: 'Invalid chain ID',
              details: chainResult.error.flatten().formErrors,
            },
            metadata: {
              timestamp: new Date().toISOString(),
              requestId: req.requestId,
            },
          });
        }
        chainId = chainResult.data;
      }

      const address = addressResult.data;
      const protocol = protocolResult.data;

      logger.info('Protocol-specific DeFi positions request', {
        address,
        protocol,
        chainId,
        requestId: req.requestId,
      });

      // Fetch protocol positions
      const result = await defiOrchestrator.getProtocolPositions(protocol, address, chainId);

      // Set response headers
      res.setHeader('X-Provider', result.metadata.provider);
      res.setHeader('X-Execution-Time', result.metadata.executionTime || 0);

      if (result.success) {
        res.json(result);
      } else {
        const statusCode =
          result.error?.code === 'ADAPTER_NOT_FOUND'
            ? 404
            : result.error?.code === 'ADAPTER_UNHEALTHY'
              ? 503
              : 500;
        res.status(statusCode).json(result);
      }
    } catch (error) {
      logger.error('Protocol positions request failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address: req.params.address,
        protocol: req.params.protocol,
        requestId: req.requestId,
      });
      next(error);
    }
  }
);

/**
 * @swagger
 * /api/defi/yields:
 *   get:
 *     summary: Get yield opportunities
 *     description: Retrieves current yield opportunities across all supported DeFi protocols
 *     tags: [DeFi]
 *     parameters:
 *       - in: query
 *         name: chains
 *         schema:
 *           type: string
 *         description: Comma-separated list of chain IDs
 *       - in: query
 *         name: minAPY
 *         schema:
 *           type: number
 *           minimum: 0
 *         description: Minimum APY percentage
 *       - in: query
 *         name: maxRisk
 *         schema:
 *           type: string
 *           enum: [LOW, MEDIUM, HIGH]
 *         description: Maximum risk level
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Available yield opportunities
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       protocol:
 *                         type: string
 *                       chainId:
 *                         type: string
 *                       name:
 *                         type: string
 *                       apy:
 *                         type: number
 *                       tvl:
 *                         type: number
 *                       riskLevel:
 *                         type: string
 */
router.get('/yields', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Parse query parameters
    const chainIds = req.query.chains
      ? String(req.query.chains)
          .split(',')
          .map(c => chainIdSchema.parse(c.trim()))
      : undefined;

    const minAPY = req.query.minAPY ? parseFloat(String(req.query.minAPY)) : 0;

    if (isNaN(minAPY) || minAPY < 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_MIN_APY',
          message: 'minAPY must be a non-negative number',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    }

    logger.info('Yield opportunities request', {
      chainIds,
      minAPY,
      requestId: req.requestId,
    });

    // Fetch yield opportunities
    const result = await defiOrchestrator.getYieldOpportunities(chainIds, minAPY);

    res.json(result);
  } catch (error) {
    logger.error('Yield opportunities request failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.requestId,
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/defi/protocols:
 *   get:
 *     summary: Get supported DeFi protocols
 *     description: Returns list of all supported DeFi protocols and their health status
 *     tags: [DeFi]
 *     responses:
 *       200:
 *         description: Supported protocols and status
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
 *                     protocols:
 *                       type: array
 *                       items:
 *                         type: string
 *                     healthStatus:
 *                       type: object
 */
router.get('/protocols', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const protocols = defiOrchestrator.getRegisteredProtocols();
    const healthStatus = defiOrchestrator.getHealthStatus();

    res.json({
      success: true,
      data: {
        protocols,
        healthStatus,
        totalProtocols: protocols.length,
        healthyProtocols: Object.values(healthStatus).filter((h: any) => h.isHealthy).length,
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  } catch (error) {
    logger.error('Protocols request failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.requestId,
    });
    next(error);
  }
});

export default router;
