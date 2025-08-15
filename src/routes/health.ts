import { Router, Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { getChainManager } from '@/services/ChainManager';
import { DeFiOrchestrator } from '@/services/defi/DeFiOrchestrator';
import { nftOrchestrator } from '@/services/nft/NFTOrchestrator';
import { getCostMonitoringService } from '@/services/CostMonitoringService';
import { getEnhancedMetricsMiddleware } from '@/middleware/enhancedMetricsMiddleware';

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

// Get enhanced metrics middleware
const metricsMiddleware = getEnhancedMetricsMiddleware();
const handlers = metricsMiddleware.getRouteHandlers();

// Apply request tracking middleware to all routes
router.use(handlers.trackRequest);

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Service health check
 *     description: Returns the health status of the crypto data service and all dependencies
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [healthy, degraded, unhealthy]
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 version:
 *                   type: string
 *                 uptime:
 *                   type: number
 *                 services:
 *                   type: object
 *                   properties:
 *                     redis:
 *                       type: string
 *                       enum: [healthy, unhealthy]
 *                     chains:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                           enum: [healthy, degraded, unhealthy]
 *                         healthyProviders:
 *                           type: number
 *                         totalProviders:
 *                           type: number
 *                         healthPercentage:
 *                           type: number
 *                     defi:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                         healthyProtocols:
 *                           type: number
 *                         totalProtocols:
 *                           type: number
 *                     nft:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                         healthyDetectors:
 *                           type: number
 *                         totalDetectors:
 *                           type: number
 *                 system:
 *                   type: object
 *                   properties:
 *                     memory:
 *                       type: object
 *                       properties:
 *                         used:
 *                           type: number
 *                         total:
 *                           type: number
 *                         external:
 *                           type: number
 *                     uptime:
 *                       type: number
 *                     nodeVersion:
 *                       type: string
 *                     platform:
 *                       type: string
 *       503:
 *         description: Service is unhealthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: unhealthy
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 error:
 *                   type: string
 */
router.get('/', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    logger.debug('Health check requested', { requestId: req.requestId });

    // Check Redis connection
    const redisStartTime = Date.now();
    const redisHealth = await Promise.race([
      redisManager.ping(),
      new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error('Redis timeout')), 5000)
      ),
    ]);
    const redisResponseTime = Date.now() - redisStartTime;

    // Check blockchain providers health
    const chainStartTime = Date.now();
    const chainHealth = getChainManager().getHealthStatus();
    const chainResponseTime = Date.now() - chainStartTime;

    // Check DeFi orchestrator health
    const defiStartTime = Date.now();
    const defiHealth = defiOrchestrator.getHealthStatus();
    const defiResponseTime = Date.now() - defiStartTime;

    // Check NFT orchestrator health
    const nftStartTime = Date.now();
    const nftHealth = nftOrchestrator.getHealthStatus();
    const nftResponseTime = Date.now() - nftStartTime;

    // Get cost monitoring stats
    const costMonitoringService = getCostMonitoringService();
    const costStats = costMonitoringService.getCurrentStats();

    // System metrics
    const memory = process.memoryUsage();
    const uptime = Math.floor(process.uptime());

    // Calculate overall health scores
    const redisScore = redisHealth ? 1 : 0;
    const chainScore = chainHealth.healthPercentage / 100;
    const defiScore =
      Object.values(defiHealth).filter((h: any) => h.isHealthy).length /
      Math.max(Object.keys(defiHealth).length, 1);
    const nftScore = nftHealth.isHealthy ? 1 : 0;

    // Overall health calculation (weighted)
    const overallScore = redisScore * 0.3 + chainScore * 0.4 + defiScore * 0.2 + nftScore * 0.1;

    let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
    if (overallScore >= 0.8) overallStatus = 'healthy';
    else if (overallScore >= 0.5) overallStatus = 'degraded';
    else overallStatus = 'unhealthy';

    const healthData = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      uptime,
      services: {
        redis: {
          status: redisHealth ? 'healthy' : 'unhealthy',
          responseTime: redisResponseTime,
          lastChecked: new Date().toISOString(),
        },
        chains: {
          status:
            chainHealth.healthPercentage > 75
              ? 'healthy'
              : chainHealth.healthPercentage > 25
                ? 'degraded'
                : 'unhealthy',
          healthyProviders: chainHealth.healthyProviders,
          totalProviders: chainHealth.totalProviders,
          healthPercentage: chainHealth.healthPercentage,
          responseTime: chainResponseTime,
          providerDetails: (chainHealth as any).providerDetails || {},
        },
        defi: {
          status: defiScore > 0.5 ? 'healthy' : 'degraded',
          healthyProtocols: Object.values(defiHealth).filter(h => h.isHealthy).length,
          totalProtocols: Object.keys(defiHealth).length,
          responseTime: defiResponseTime,
          protocolDetails: defiHealth,
        },
        nft: {
          status: nftHealth.isHealthy ? 'healthy' : 'degraded',
          healthyDetectors: Object.values(nftHealth.detectors).filter(d => d.isHealthy).length,
          totalDetectors: Object.keys(nftHealth.detectors).length,
          healthyEnrichers: Object.values(nftHealth.enrichers).filter(e => e.isHealthy).length,
          totalEnrichers: Object.keys(nftHealth.enrichers).length,
          responseTime: nftResponseTime,
          detectorDetails: nftHealth.detectors,
          enricherDetails: nftHealth.enrichers,
        },
      },
      costs: {
        dailySpent: (costStats as any).dailyCostUSD || 0,
        monthlyBudget: (costStats as any).monthlyBudget || 200,
        utilizationPercentage: costStats.budgetUtilization || 0,
        requestsToday: (costStats as any).dailyRequests || 0,
        averageCostPerRequest: costStats.averageCostPerRequest || 0,
      },
      performance: {
        healthCheckDuration: Date.now() - startTime,
        memory: {
          used: Math.round(memory.heapUsed / 1024 / 1024),
          total: Math.round(memory.heapTotal / 1024 / 1024),
          external: Math.round(memory.external / 1024 / 1024),
          rss: Math.round(memory.rss / 1024 / 1024),
        },
        uptime,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      metadata: {
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime,
      },
    };

    // Determine HTTP status code
    const statusCode = overallStatus === 'healthy' ? 200 : 503;

    // Set response headers
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('X-Health-Score', overallScore.toFixed(2));
    res.setHeader('X-Service-Status', overallStatus);

    res.status(statusCode).json(healthData);
  } catch (error) {
    const processingTime = Date.now() - startTime;

    logger.error('Health check failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      requestId: req.requestId,
      processingTime,
    });

    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Health check failed',
      version: '1.0.0',
      metadata: {
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
        processingTime,
      },
    });
  }
});

/**
 * @swagger
 * /health/deep:
 *   get:
 *     summary: Deep health check with detailed diagnostics
 *     description: Performs comprehensive health checks including API connectivity tests
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Deep health check results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 diagnostics:
 *                   type: object
 *                 performance:
 *                   type: object
 */
router.get('/deep', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    // Perform comprehensive health checks
    const diagnostics = await Promise.allSettled([
      // Test Redis operations
      (async () => {
        const testKey = `health-test-${Date.now()}`;
        await redisManager.set(testKey, 'test', 10);
        const value = await redisManager.get(testKey);
        await redisManager.del(testKey);
        return { redis: { read: !!value, write: true, delete: true } };
      })(),

      // Test blockchain connectivity
      (async () => {
        const results = await (getChainManager() as any).testConnectivity();
        return { blockchain: results };
      })(),

      // Test DeFi adapters
      (async () => {
        const protocolTests: any = {};
        const healthStatus = defiOrchestrator.getHealthStatus();

        for (const [protocol, health] of Object.entries(healthStatus)) {
          (protocolTests as any)[protocol] = {
            healthy: health.isHealthy,
            issues: health.issues || [],
          };
        }

        return { defi: protocolTests };
      })(),

      // Test NFT services
      (async () => {
        const nftHealth = await nftOrchestrator.checkHealth();
        return { nft: nftHealth };
      })(),
    ]);

    const results = diagnostics.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return { error: result.reason.message };
      }
    });

    const combinedResults = Object.assign({}, ...results);

    res.json({
      status: 'completed',
      timestamp: new Date().toISOString(),
      diagnostics: combinedResults,
      performance: {
        totalTime: Date.now() - startTime,
        memory: process.memoryUsage(),
        uptime: process.uptime(),
      },
      metadata: {
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Deep health check failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.requestId,
    });

    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Deep health check failed',
      metadata: {
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
      },
    });
  }
});

/**
 * @swagger
 * /health/liveness:
 *   get:
 *     summary: Kubernetes liveness probe
 *     description: Simple endpoint for Kubernetes liveness probe
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is alive
 */
router.get('/liveness', (req: Request, res: Response) => {
  res.json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

/**
 * @swagger
 * /health/readiness:
 *   get:
 *     summary: Kubernetes readiness probe
 *     description: Checks if service is ready to accept traffic
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is ready
 *       503:
 *         description: Service is not ready
 */
router.get('/readiness', async (req: Request, res: Response) => {
  try {
    // Check critical dependencies
    const redisReady = await redisManager.ping();
    const chainReady = getChainManager().getHealthStatus().healthyProviders > 0;

    if (redisReady && chainReady) {
      res.json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        services: {
          redis: 'ready',
          blockchain: 'ready',
        },
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        services: {
          redis: redisReady ? 'ready' : 'not_ready',
          blockchain: chainReady ? 'ready' : 'not_ready',
        },
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Readiness check failed',
    });
  }
});

/**
 * @swagger
 * /health/metrics:
 *   get:
 *     summary: Prometheus metrics endpoint
 *     description: Returns Prometheus-formatted metrics for monitoring
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Metrics in Prometheus format
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 */
router.get('/metrics', handlers.metrics);

/**
 * @swagger
 * /health/enhanced:
 *   get:
 *     summary: Enhanced health check with comprehensive monitoring
 *     description: Returns detailed health status including event monitoring, cache warming, and performance metrics
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Enhanced health check results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [healthy, warning, critical, emergency]
 *                 timestamp:
 *                   type: number
 *                 services:
 *                   type: object
 *                 metrics:
 *                   type: object
 *                 alerts:
 *                   type: object
 */
router.get('/enhanced', handlers.health);

/**
 * @swagger
 * /health/dashboard:
 *   get:
 *     summary: Performance dashboard data
 *     description: Returns comprehensive performance dashboard metrics
 *     tags: [Health]
 *     parameters:
 *       - in: query
 *         name: timeRange
 *         schema:
 *           type: string
 *           enum: [1h, 6h, 24h, 7d, 30d]
 *           default: 1h
 *         description: Time range for metrics
 *       - in: query
 *         name: detailed
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include detailed metrics
 *     responses:
 *       200:
 *         description: Dashboard data
 */
router.get('/dashboard', handlers.dashboard);

/**
 * @swagger
 * /health/cost:
 *   get:
 *     summary: Cost optimization metrics
 *     description: Returns cost monitoring and optimization metrics
 *     tags: [Health]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [1h, 24h, 7d, 30d]
 *           default: 24h
 *         description: Period for cost metrics
 *       - in: query
 *         name: detailed
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include detailed breakdown
 *     responses:
 *       200:
 *         description: Cost metrics
 */
router.get('/cost', handlers.cost);

/**
 * @swagger
 * /health/events:
 *   get:
 *     summary: Event system metrics
 *     description: Returns event system monitoring metrics
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Event system metrics
 */
router.get('/events', handlers.events);

/**
 * @swagger
 * /health/cache-warming:
 *   get:
 *     summary: Cache warming performance metrics
 *     description: Returns cache warming performance and strategy metrics
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Cache warming metrics
 */
router.get('/cache-warming', handlers.cacheWarming);

/**
 * @swagger
 * /health/alerts:
 *   get:
 *     summary: System alerts
 *     description: Returns active system alerts and notifications
 *     tags: [Health]
 *     parameters:
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *           enum: [info, warning, critical, emergency]
 *         description: Filter by alert severity
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of alerts to return
 *     responses:
 *       200:
 *         description: System alerts
 */
router.get('/alerts', handlers.alerts);

/**
 * @swagger
 * /health/force-update:
 *   post:
 *     summary: Force metrics update
 *     description: Forces an immediate update of all monitoring metrics (admin only)
 *     tags: [Health]
 *     security:
 *       - AdminKey: []
 *     responses:
 *       200:
 *         description: Metrics update triggered
 *       401:
 *         description: Unauthorized
 */
router.post('/force-update', handlers.forceUpdate);

export default router;
