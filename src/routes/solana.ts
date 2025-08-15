/**
 * Solana DeFi Routes
 *
 * Express routes for Solana portfolio and DeFi position endpoints
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { SolanaOrchestrator } from '@/services/defi/SolanaOrchestrator';
import { SolanaProvider } from '@/services/providers/SolanaProvider';
import { SolanaProtocol } from '@/types/solana-defi';
import { config } from '@/config';

const router = Router();

// Initialize Solana services
let solanaProvider: SolanaProvider;
let solanaOrchestrator: SolanaOrchestrator;

// Initialize services
const initializeSolanaServices = async () => {
  if (!solanaProvider) {
    solanaProvider = new SolanaProvider(config.solana.heliusApiKey, config.solana.rpcUrl);
    await solanaProvider.initialize();
  }

  if (!solanaOrchestrator) {
    solanaOrchestrator = new SolanaOrchestrator({
      rpcUrl: config.solana.rpcUrl,
      heliusApiKey: config.solana.heliusApiKey,
      enabledProtocols: config.solana.enabledProtocols as SolanaProtocol[],
      cacheSettings: config.solana.cacheSettings,
      performance: config.solana.performance,
    });
    await solanaOrchestrator.initialize();
  }
};

// Address validation schema
const AddressSchema = z.object({
  address: z
    .string()
    .min(32)
    .max(44)
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid Solana address format'),
});

const CrossChainSchema = z.object({
  solanaAddress: z
    .string()
    .min(32)
    .max(44)
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid Solana address format'),
  evmAddresses: z.array(z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address format')),
});

/**
 * @swagger
 * /api/solana/portfolio/{address}:
 *   get:
 *     summary: Get comprehensive Solana portfolio
 *     tags: [Solana]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: Solana wallet address
 *     responses:
 *       200:
 *         description: Portfolio retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/SolanaPortfolio'
 *       400:
 *         description: Invalid address format
 *       500:
 *         description: Internal server error
 */
router.get('/portfolio/:address', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Initialize services if needed
    await initializeSolanaServices();

    // Validate address
    const { address } = AddressSchema.parse(req.params);

    logger.info('Fetching Solana portfolio', {
      address,
      requestId: req.requestId,
      userAgent: req.get('User-Agent'),
    });

    // Get portfolio from orchestrator
    const portfolio = await solanaOrchestrator.getPortfolio(address);

    res.json({
      success: true,
      data: portfolio,
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
        cacheable: true,
        dataFreshness: Date.now() - portfolio.lastUpdated,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ADDRESS',
          message: 'Invalid Solana address format',
          details: error.errors,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    }

    logger.error('Failed to get Solana portfolio', {
      address: req.params.address,
      error: error.message,
      requestId: req.requestId,
    });

    next(error);
  }
});

/**
 * @swagger
 * /api/solana/defi/{address}:
 *   get:
 *     summary: Get Solana DeFi positions
 *     tags: [Solana]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: Solana wallet address
 *     responses:
 *       200:
 *         description: DeFi positions retrieved successfully
 */
router.get('/defi/:address', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await initializeSolanaServices();

    const { address } = AddressSchema.parse(req.params);

    logger.info('Fetching Solana DeFi positions', {
      address,
      requestId: req.requestId,
    });

    const positions = await solanaProvider.getDeFiPositions(address);

    res.json({
      success: true,
      data: {
        address,
        positions,
        totalValue: positions.reduce((sum, pos) => sum + pos.value, 0),
        protocolCount: new Set(positions.map(pos => pos.protocol)).size,
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
        positionCount: positions.length,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ADDRESS',
          message: 'Invalid Solana address format',
          details: error.errors,
        },
      });
    }

    next(error);
  }
});

/**
 * @swagger
 * /api/solana/analytics/{address}:
 *   get:
 *     summary: Get Solana portfolio analytics
 *     tags: [Solana]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: Solana wallet address
 *     responses:
 *       200:
 *         description: Analytics retrieved successfully
 */
router.get('/analytics/:address', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await initializeSolanaServices();

    const { address } = AddressSchema.parse(req.params);

    logger.info('Fetching Solana portfolio analytics', {
      address,
      requestId: req.requestId,
    });

    const analytics = await solanaOrchestrator.getPortfolioAnalytics(address);

    res.json({
      success: true,
      data: analytics,
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ADDRESS',
          message: 'Invalid Solana address format',
          details: error.errors,
        },
      });
    }

    next(error);
  }
});

/**
 * @swagger
 * /api/solana/cross-chain:
 *   post:
 *     summary: Analyze cross-chain positions
 *     tags: [Solana]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               solanaAddress:
 *                 type: string
 *               evmAddresses:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Cross-chain analysis completed successfully
 */
router.post('/cross-chain', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await initializeSolanaServices();

    const { solanaAddress, evmAddresses } = CrossChainSchema.parse(req.body);

    logger.info('Analyzing cross-chain positions', {
      solanaAddress,
      evmAddressCount: evmAddresses.length,
      requestId: req.requestId,
    });

    const analysis = await solanaOrchestrator.analyzeCrossChainPositions(
      solanaAddress,
      evmAddresses
    );

    res.json({
      success: true,
      data: analysis,
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
        correlationCount: analysis.crossChainCorrelations.length,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid address format in request body',
          details: error.errors,
        },
      });
    }

    next(error);
  }
});

/**
 * @swagger
 * /api/solana/health:
 *   get:
 *     summary: Get Solana service health status
 *     tags: [Solana]
 *     responses:
 *       200:
 *         description: Health status retrieved successfully
 */
router.get('/health', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await initializeSolanaServices();

    logger.info('Checking Solana service health', {
      requestId: req.requestId,
    });

    const [providerHealth, orchestratorHealth] = await Promise.allSettled([
      solanaProvider.getDeFiAdaptersHealth(),
      solanaOrchestrator.getHealthStatus(),
    ]);

    const providerData = providerHealth.status === 'fulfilled' ? providerHealth.value : {};
    const orchestratorData =
      orchestratorHealth.status === 'fulfilled' ? orchestratorHealth.value : {};

    const allHealthy = Object.values({ ...providerData, ...orchestratorData }).every(Boolean);

    res.json({
      success: true,
      data: {
        status: allHealthy ? 'healthy' : 'degraded',
        services: {
          provider: {
            status: providerHealth.status === 'fulfilled' ? 'healthy' : 'error',
            adapters: providerData,
          },
          orchestrator: {
            status: orchestratorHealth.status === 'fulfilled' ? 'healthy' : 'error',
            protocols: orchestratorData,
          },
        },
        timestamp: new Date().toISOString(),
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  } catch (error) {
    logger.error('Failed to check Solana health', {
      error: error.message,
      requestId: req.requestId,
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'HEALTH_CHECK_FAILED',
        message: 'Failed to check Solana service health',
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  }
});

/**
 * @swagger
 * /api/solana/stats:
 *   get:
 *     summary: Get Solana service statistics
 *     tags: [Solana]
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 */
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await initializeSolanaServices();

    const stats = {
      orchestrator: solanaOrchestrator.getStats(),
      provider: solanaProvider.getStats ? solanaProvider.getStats() : {},
      config: {
        enabledProtocols: config.solana.enabledProtocols,
        rpcUrl: config.solana.rpcUrl,
        hasHeliusKey: !!config.solana.heliusApiKey,
        cacheSettings: config.solana.cacheSettings,
        performance: config.solana.performance,
      },
    };

    res.json({
      success: true,
      data: stats,
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
