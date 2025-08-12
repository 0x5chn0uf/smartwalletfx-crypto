import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { config } from '@/config/environment';
import { logger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { chainManager } from '@/services/ChainManager';
import { requestLogger } from '@/middleware/requestLogger';
import { errorHandler } from '@/middleware/errorHandler';
import { authMiddleware, optionalAuthMiddleware } from '@/middleware/auth';
import { portfolioRouter } from '@/controllers/portfolio';
import { defiRouter } from '@/controllers/defi';
import { defiOrchestrator } from '@/services/defi/DeFiOrchestrator';

const app = express();

// Trust proxy (for deployment behind load balancers)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false, // Disable CSP for API
}));

// CORS configuration
app.use(cors({
  origin: config.cors.origins.length > 0 ? config.cors.origins : true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
}));

// Request parsing
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const rateLimiter = rateLimit({
  windowMs: config.rateLimit.window * 60 * 1000, // window in minutes
  max: config.rateLimit.max,
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP, please try again later.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use user ID if authenticated, otherwise use IP
    return req.user?.userId || req.ip;
  },
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health' || req.path === '/api/health';
  },
});

app.use(rateLimiter);

// Request logging
app.use(requestLogger);

// Health check endpoint (no auth required)
app.get('/health', async (req, res) => {
  try {
    // Check Redis connection
    const redisHealth = await redisManager.ping();
    
    // Check chain providers health
    const chainHealth = chainManager.getHealthStatus();
    
    // Check DeFi orchestrator health
    const defiHealth = defiOrchestrator.getHealthStatus();
    
    // Get service stats
    const uptime = process.uptime();
    const memory = process.memoryUsage();
    
    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      uptime: Math.floor(uptime),
      services: {
        redis: redisHealth ? 'healthy' : 'unhealthy',
        chains: {
          status: chainHealth.healthPercentage > 50 ? 'healthy' : 'degraded',
          healthyProviders: chainHealth.healthyProviders,
          totalProviders: chainHealth.totalProviders,
          healthPercentage: chainHealth.healthPercentage,
        },
        defi: {
          status: Object.values(defiHealth).filter(h => h.isHealthy).length > 0 ? 'healthy' : 'degraded',
          healthyProtocols: Object.values(defiHealth).filter(h => h.isHealthy).length,
          totalProtocols: Object.keys(defiHealth).length,
        },
      },
      system: {
        memory: {
          used: Math.round(memory.heapUsed / 1024 / 1024),
          total: Math.round(memory.heapTotal / 1024 / 1024),
          external: Math.round(memory.external / 1024 / 1024),
        },
        uptime: Math.floor(uptime),
        nodeVersion: process.version,
        platform: process.platform,
      },
    };
    
    // Return 503 if critical services are down
    const isHealthy = redisHealth && chainHealth.healthyProviders > 0;
    const statusCode = isHealthy ? 200 : 503;
    
    res.status(statusCode).json(healthData);
  } catch (error) {
    logger.error('Health check failed:', { error });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Health check failed',
    });
  }
});

// API routes with authentication
app.use('/api/portfolio', optionalAuthMiddleware, portfolioRouter);
app.use('/api/defi', optionalAuthMiddleware, defiRouter);

// Additional API endpoints for service management
app.get('/api/stats', authMiddleware, async (req, res) => {
  try {
    const healthStatus = chainManager.getHealthStatus();
    const costStats = chainManager.getCostStatistics();
    
    res.json({
      success: true,
      data: {
        health: healthStatus,
        costs: costStats,
        system: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          version: '1.0.0',
          nodeVersion: process.version,
        },
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  } catch (error) {
    logger.error('Failed to get service stats:', { error });
    res.status(500).json({
      success: false,
      error: {
        code: 'STATS_ERROR',
        message: 'Failed to retrieve service statistics',
      },
    });
  }
});

// Metrics endpoint (Prometheus-style metrics)
app.get('/metrics', async (req, res) => {
  try {
    const healthStatus = chainManager.getHealthStatus();
    const costStats = chainManager.getCostStatistics();
    const memory = process.memoryUsage();
    
    const metrics = [
      '# HELP crypto_data_service_uptime_seconds Total uptime in seconds',
      '# TYPE crypto_data_service_uptime_seconds counter',
      `crypto_data_service_uptime_seconds ${process.uptime()}`,
      '',
      '# HELP crypto_data_service_memory_bytes Memory usage in bytes',
      '# TYPE crypto_data_service_memory_bytes gauge',
      `crypto_data_service_memory_bytes{type="heap_used"} ${memory.heapUsed}`,
      `crypto_data_service_memory_bytes{type="heap_total"} ${memory.heapTotal}`,
      `crypto_data_service_memory_bytes{type="external"} ${memory.external}`,
      '',
      '# HELP crypto_data_providers_healthy Number of healthy providers',
      '# TYPE crypto_data_providers_healthy gauge',
      `crypto_data_providers_healthy ${healthStatus.healthyProviders}`,
      '',
      '# HELP crypto_data_providers_total Total number of providers',
      '# TYPE crypto_data_providers_total gauge',
      `crypto_data_providers_total ${healthStatus.totalProviders}`,
      '',
      '# HELP crypto_data_api_requests_total Total API requests',
      '# TYPE crypto_data_api_requests_total counter',
      `crypto_data_api_requests_total ${costStats.totalRequests}`,
      '',
      '# HELP crypto_data_api_cost_usd_total Total API costs in USD',
      '# TYPE crypto_data_api_cost_usd_total counter',
      `crypto_data_api_cost_usd_total ${costStats.totalCost}`,
      '',
    ].join('\n');
    
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics);
  } catch (error) {
    logger.error('Failed to generate metrics:', { error });
    res.status(500).send('# Error generating metrics');
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Endpoint ${req.method} ${req.originalUrl} not found`,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
    },
  });
});

// Global error handler (must be last)
app.use(errorHandler);

export default app;