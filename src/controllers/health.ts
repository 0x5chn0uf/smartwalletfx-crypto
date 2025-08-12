import { Router, Request, Response } from 'express';
import { asyncHandler } from '@/middleware/errorHandler';
import { prisma, dbUtils } from '@/utils/database';
import { redisManager } from '@/utils/redis';
import { logger } from '@/utils/logger';

const router = Router();

// Basic health check
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    service: 'crypto-data-service',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
}));

// Detailed health check with dependencies
router.get('/detailed', asyncHandler(async (req: Request, res: Response) => {
  const startTime = Date.now();
  const healthChecks: Record<string, any> = {};

  // Database health
  try {
    const dbHealth = await dbUtils.healthCheck();
    healthChecks.database = {
      status: dbHealth.status,
      latency: dbHealth.latency,
      connections: await dbUtils.getPerformanceMetrics(),
    };
  } catch (error) {
    healthChecks.database = {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Redis health
  try {
    const redisHealth = await redisManager.healthCheck();
    healthChecks.redis = {
      status: redisHealth.status,
      latency: redisHealth.latency,
    };
  } catch (error) {
    healthChecks.redis = {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // System health
  const systemHealth = {
    memory: {
      used: process.memoryUsage().heapUsed,
      total: process.memoryUsage().heapTotal,
      external: process.memoryUsage().external,
      rss: process.memoryUsage().rss,
    },
    cpu: {
      usage: process.cpuUsage(),
    },
    uptime: process.uptime(),
    nodeVersion: process.version,
  };

  healthChecks.system = systemHealth;

  // Overall status
  const isHealthy = Object.values(healthChecks).every(
    check => check.status === 'healthy' || !check.status
  );

  const response = {
    success: true,
    status: isHealthy ? 'healthy' : 'unhealthy',
    service: 'crypto-data-service',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    responseTime: Date.now() - startTime,
    checks: healthChecks,
  };

  // Log unhealthy status
  if (!isHealthy) {
    logger.warn('Health check failed:', response);
  }

  res.status(isHealthy ? 200 : 503).json(response);
}));

// Readiness probe (for Kubernetes)
router.get('/ready', asyncHandler(async (req: Request, res: Response) => {
  try {
    // Quick checks that service is ready to serve traffic
    await prisma.$queryRaw`SELECT 1`;
    await redisManager.ping();

    res.status(200).json({
      success: true,
      status: 'ready',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Readiness check failed:', { error });
    res.status(503).json({
      success: false,
      status: 'not_ready',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
}));

// Liveness probe (for Kubernetes)
router.get('/live', asyncHandler(async (req: Request, res: Response) => {
  // Simple check that the process is alive
  res.status(200).json({
    success: true,
    status: 'alive',
    timestamp: new Date().toISOString(),
    pid: process.pid,
    uptime: process.uptime(),
  });
}));

// Dependency status check
router.get('/dependencies', asyncHandler(async (req: Request, res: Response) => {
  const dependencies = {
    database: { status: 'unknown' },
    redis: { status: 'unknown' },
    external_apis: {
      alchemy: { status: 'unknown' },
      moralis: { status: 'unknown' },
    },
  };

  try {
    // Database check
    const dbHealth = await dbUtils.healthCheck();
    dependencies.database = dbHealth;
  } catch (error) {
    dependencies.database = {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  try {
    // Redis check
    const redisHealth = await redisManager.healthCheck();
    dependencies.redis = redisHealth;
  } catch (error) {
    dependencies.redis = {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // TODO: Add external API health checks
  // For now, mark as healthy if we have API keys
  dependencies.external_apis.alchemy.status = process.env.ALCHEMY_API_KEY ? 'healthy' : 'misconfigured';
  dependencies.external_apis.moralis.status = process.env.MORALIS_API_KEY ? 'healthy' : 'misconfigured';

  const allHealthy = Object.values(dependencies).every(dep => 
    typeof dep === 'object' && ('status' in dep) && dep.status === 'healthy'
  );

  res.status(allHealthy ? 200 : 503).json({
    success: true,
    overall_status: allHealthy ? 'healthy' : 'unhealthy',
    dependencies,
    timestamp: new Date().toISOString(),
  });
}));

export { router as healthRouter };