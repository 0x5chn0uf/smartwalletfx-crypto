import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { registry, httpDuration } from './utils/metrics';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './utils/logger';
import { redisManager } from './utils/redis';
import { getSimpleChainManager } from './services/SimpleChainManager';
import { getCostTracker } from './services/cost/CostTracker';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { costTrackingMiddleware } from './middleware/costTrackingMiddleware';
import { apiKeyAuth } from './middleware/auth';
import { createRedisRateLimiter } from './middleware/redisRateLimiter';

// Import route handlers
import { createHealthRoutes } from './routes/healthRouteFactory';
import { createProtocolsRoutes } from './routes/protocolsRouteFactory';
import { createPortfolioRoutes } from './routes/portfolioRouteFactory';
import { createDeFiRoutes } from './routes/defiRouteFactory';
import { createNFTRoutes } from './routes/nftRouteFactory';
import { createSolanaRoutes } from './routes/solanaRouteFactory';
import { getRuntime } from './app/runtime';

export default (config: any) => {
  const app = express();

  // Trust proxy for deployments behind load balancers
  app.set('trust proxy', 1);

  // Request ID middleware (must be first)
  app.use((req: Request, res: Response, next: NextFunction) => {
    req.requestId = (req.headers['x-request-id'] as string) || uuidv4();
    res.setHeader('X-Request-ID', req.requestId);
    next();
  });

  // Security middleware with enhanced headers
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      // SECURITY FIX: Add missing critical headers
      noSniff: true, // X-Content-Type-Options: nosniff
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );

  // CORS pre-check to send consistent 403 JSON for disallowed origins
  const isOriginAllowed = (origin?: string | null): boolean => {
    if (!origin) return true; // Allow non-browser / same-origin
    if (config.cors.origins.includes('*')) return true;
    if (config.cors.origins.includes(origin)) return true;
    if (config.server.isDevelopment && /^http:\/\/localhost:\d+$/.test(origin)) return true;
    return false;
  };

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin as string | undefined;
    if (!isOriginAllowed(origin)) {
      logger.warn('Blocked by CORS', { origin, path: req.path, requestId: req.requestId });
      return res.status(403).json({
        success: false,
        error: {
          code: 'CORS_NOT_ALLOWED',
          message: 'CORS origin not allowed',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    }
    return next();
  });

  // CORS configuration
  app.use(
    cors({
      // After pre-check, reflect request origin
      origin: true,
      credentials: config.cors.credentials,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-API-Key',
        'X-Request-ID',
        'X-Client-Version',
        'X-Platform',
      ],
      exposedHeaders: [
        'X-Request-ID',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'X-Cost-Used',
        'X-Cache-Status',
      ],
      maxAge: config.cors.maxAge,
    })
  );

  // Request parsing and compression
  app.use(
    compression({
      level: 6,
      threshold: 1024,
      filter: (req, res) => {
        // Don't compress responses for SSE endpoints
        if (req.headers['accept'] === 'text/event-stream') {
          return false;
        }
        return compression.filter(req, res);
      },
    })
  );

  app.use(
    express.json({
      limit: config.server.bodyLimit,
      verify: (req, res, buf) => {
        // Store raw body for webhook verification if needed
        (req as any).rawBody = buf;
      },
    })
  );

  app.use(
    express.urlencoded({
      extended: true,
      limit: config.server.bodyLimit,
    })
  );

  // Redis-backed rate limiting using rate-limiter-flexible
  const generalLimiter = createRedisRateLimiter({
    points: config.rateLimit.max,
    duration: config.rateLimit.window * 60, // seconds
    keyPrefix: 'rl:general',
  });
  const expensiveLimiter = createRedisRateLimiter({
    points: 20,
    duration: 60,
    keyPrefix: 'rl:expensive',
  });

  // Apply limiter before auth to protect from brute-force
  app.use('/api', (req, res, next) => {
    // Skip for health/metrics/internal
    if (
      req.path === '/health' ||
      req.path.startsWith('/metrics') ||
      req.headers['x-internal-request'] === 'true'
    ) {
      return next();
    }
    return generalLimiter(req, res, next);
  });
  app.use(['/api/portfolio', '/api/defi', '/api/nft'], expensiveLimiter);

  // Request logging and cost tracking
  app.use(requestLogger);
  app.use(costTrackingMiddleware);

  // SECURITY FIX: Swagger documentation setup with production protection
  if (config.features.swagger) {
    const swaggerOptions = {
      definition: {
        openapi: '3.0.0',
        info: {
          title: 'SmartWalletFX Crypto Data API',
          version: '1.0.0',
          description: 'High-performance cryptocurrency portfolio and DeFi data API',
          contact: {
            name: 'SmartWalletFX Team',
            url: 'https://smartwalletfx.com',
            email: 'api-support@smartwalletfx.com',
          },
          license: {
            name: 'MIT',
            url: 'https://opensource.org/licenses/MIT',
          },
        },
        servers: [
          {
            url: config.server.isDevelopment
              ? `http://localhost:${config.server.port}`
              : 'https://api.smartwalletfx.com',
            description: config.server.isDevelopment ? 'Development server' : 'Production server',
          },
        ],
        // Default security: require API key unless a route overrides it with security: []
        security: [{ ApiKeyAuth: [] }],
        components: {
          securitySchemes: {
            ApiKeyAuth: {
              type: 'apiKey',
              in: 'header',
              name: 'X-API-Key',
            },
            BearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
            },
          },
          responses: {
            BadRequest: {
              description: 'Bad request - invalid parameters',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: false },
                      error: {
                        type: 'object',
                        properties: {
                          code: { type: 'string' },
                          message: { type: 'string' },
                          details: { type: 'object' },
                        },
                      },
                      metadata: {
                        type: 'object',
                        properties: {
                          timestamp: { type: 'string', format: 'date-time' },
                          requestId: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
            Unauthorized: {
              description: 'Unauthorized - invalid or missing API key',
            },
            RateLimit: {
              description: 'Rate limit exceeded',
            },
            InternalError: {
              description: 'Internal server error',
            },
          },
        },
        tags: [
          {
            name: 'Health',
            description: 'Service health and status endpoints',
          },
          {
            name: 'DeFi',
            description: 'DeFi protocol position and data endpoints',
          },
          {
            name: 'NFT',
            description: 'NFT collection and portfolio endpoints',
          },
          {
            name: 'Portfolio',
            description: 'Aggregated portfolio data endpoints',
          },
          {
            name: 'Protocols',
            description: 'Available protocol and service information',
          },
        ],
      },
      // Only include factory-based routes plus health/protocols to avoid duplicate docs
      apis: ['./src/routes/*RouteFactory.ts', './src/docs/**/*.yaml'],
    };

    const specs = swaggerJsdoc(swaggerOptions);

    // SECURITY FIX: Production-aware Swagger setup
    if (config.server.isProduction) {
      // In production: require authentication and optional IP whitelist
      logger.warn('🚨 Swagger enabled in production environment - ensure proper access controls');

      app.use(
        '/api-docs',
        apiKeyAuth, // Require valid API key
        (req: Request, res: Response, next: NextFunction) => {
          // Optional IP whitelist for production
          const allowedIPs = process.env.SWAGGER_ALLOWED_IPS?.split(',').map(ip => ip.trim()) || [];
          if (allowedIPs.length > 0) {
            const clientIP = req.ip || req.connection.remoteAddress;
            if (
              !allowedIPs.some(
                allowed =>
                  clientIP === allowed ||
                  (allowed.includes('/') && clientIP?.startsWith(allowed.split('/')[0]))
              )
            ) {
              logger.warn('Swagger access denied for IP', {
                ip: clientIP,
                requestId: req.requestId,
              });
              return res.status(403).json({
                success: false,
                error: {
                  code: 'SWAGGER_ACCESS_DENIED',
                  message: 'API documentation access restricted in production',
                },
                metadata: {
                  timestamp: new Date().toISOString(),
                  requestId: req.requestId,
                },
              });
            }
          }
          next();
        },
        swaggerUi.serve,
        swaggerUi.setup(specs, {
          customCss: '.swagger-ui .topbar { display: none }',
          customSiteTitle: 'SmartWalletFX Crypto Data API (PRODUCTION)',
          swaggerOptions: {
            persistAuthorization: true,
            displayRequestDuration: true,
            filter: true,
            tryItOutEnabled: false, // Disable try-it-out in production
          },
        })
      );

      // Protected JSON spec endpoint in production
      app.get('/api-docs.json', apiKeyAuth, (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(specs);
      });
    } else {
      // Development/staging: normal access
      app.use(
        '/api-docs',
        swaggerUi.serve,
        swaggerUi.setup(specs, {
          customCss: '.swagger-ui .topbar { display: none }',
          customSiteTitle: 'SmartWalletFX Crypto Data API',
          swaggerOptions: {
            persistAuthorization: true,
            displayRequestDuration: true,
            filter: true,
            tryItOutEnabled: true,
          },
        })
      );

      // Open JSON spec endpoint in development
      app.get('/api-docs.json', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(specs);
      });
    }

    logger.info(
      `Swagger documentation available at /api-docs (Environment: ${config.server.nodeEnv})`
    );
  }

  // API route handlers
  // Health routes (mounted after runtime is ready below)

  // Enforce API key authentication for all other /api routes
  app.use('/api', apiKeyAuth);

  // Factory-based routes with dependency injection
  async function initializeRoutes() {
    try {
      logger.info('🏗️  Initializing runtime...');
      const runtime = getRuntime();

      // Ensure runtime is fully started before proceeding
      await runtime.start(config);
      const dependencies = runtime.dependencies;

      logger.info('🔌 Wiring route factories with dependency injection...');

      // Wire all route factories with dependency injection
      const portfolioRoutes = createPortfolioRoutes(dependencies);
      const defiRoutes = createDeFiRoutes(dependencies);
      const nftRoutes = createNFTRoutes(dependencies);
      const solanaRoutes = createSolanaRoutes(dependencies);
      const healthRoutes = createHealthRoutes(dependencies);
      const protocolsRoutes = createProtocolsRoutes(dependencies);

      // Mount all factory-based routes
      app.use('/health', healthRoutes);
      app.use('/api/portfolio', portfolioRoutes);
      app.use('/api/defi', defiRoutes);
      app.use('/api/nft', nftRoutes);
      app.use('/api/solana', solanaRoutes);
      app.use('/api/protocols', protocolsRoutes);

      logger.info('✅ All route factories initialized with dependency injection');
      logger.info('📊 Runtime health status:', runtime.getHealthStatus());
    } catch (error) {
      // Remove legacy fallback: fail fast so issues surface during startup
      logger.error('❌ Factory route initialization failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  // All routes now use factory/DI pattern

  // Initialize factory routes with proper async handling (uniform in all environments)
  setImmediate(async () => {
    try {
      await initializeRoutes();
    } catch (error) {
      logger.error('Failed to initialize routes:', error);
    }
  });

  // Service statistics endpoint (authenticated)
  app.get('/api/stats', async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Check for API key or internal request
      const apiKey = req.headers['x-api-key'];
      const isInternal = req.headers['x-internal-request'] === 'true';

      if (!apiKey && !isInternal) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'API key required for stats endpoint',
          },
        });
      }

      const chainManager = getSimpleChainManager();
      const healthStatus = chainManager.getHealthStatus();
      const costStats = getCostTracker().getCurrentStats();
      const redisInfo = await redisManager.ping();

      res.json({
        success: true,
        data: {
          service: {
            name: 'crypto-data-service',
            version: '1.0.0',
            uptime: process.uptime(),
            nodeVersion: process.version,
            environment: config.server.nodeEnv,
          },
          health: {
            status: healthStatus.healthyProviders > 0 ? 'healthy' : 'degraded',
            providers: healthStatus,
            redis: redisInfo ? 'connected' : 'disconnected',
          },
          costs: costStats,
          performance: {
            memory: {
              used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
              total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
              external: Math.round(process.memoryUsage().external / 1024 / 1024),
            },
            uptime: Math.floor(process.uptime()),
          },
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // Per-request timing middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const end = httpDuration.startTimer();
    res.on('finish', () => {
      const route = (req as any).route?.path || req.path || 'unknown';
      end({ method: req.method, route, status_code: String(res.statusCode) });
    });
    next();
  });

  app.get('/metrics', async (req: Request, res: Response) => {
    try {
      // Restrict metrics in production: require API key or internal header
      const isInternal = req.headers['x-internal-request'] === 'true';
      const apiKey = req.headers['x-api-key'] as string | undefined;

      if (config.server.isProduction && !isInternal) {
        const validApiKeys = config.security.validApiKeys || [];
        if (!apiKey || !validApiKeys.includes(apiKey)) {
          return res.status(401).json({
            success: false,
            error: {
              code: 'UNAUTHORIZED',
              message: 'Metrics endpoint requires API key in production',
            },
            metadata: {
              timestamp: new Date().toISOString(),
              requestId: req.requestId,
            },
          });
        }
      }

      res.set('Content-Type', registry.contentType);
      res.send(await registry.metrics());
    } catch (error) {
      logger.error('Failed to generate metrics:', error);
      res.status(500).set('Content-Type', 'text/plain').send('# Error generating metrics\n');
    }
  });

  // Root endpoint
  app.get('/', (req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        name: 'SmartWalletFX Crypto Data API',
        version: '1.0.0',
        description: 'High-performance cryptocurrency portfolio and DeFi data API',
        status: 'operational',
        endpoints: {
          health: '/health',
          apiDocs: config.features.swagger ? '/api-docs' : null,
          metrics: '/metrics',
        },
        supportedChains: Object.keys(config.chains).filter(
          chain => config.chains[chain as keyof typeof config.chains].enabled
        ),
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  });

  // 404 handler for API routes
  app.use('/api/*', (req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'ENDPOINT_NOT_FOUND',
        message: `API endpoint ${req.method} ${req.originalUrl} not found`,
        availableEndpoints: [
          '/health',
          '/api/defi/:address',
          '/api/nft/:address',
          '/api/portfolio/:address',
          '/api/solana/:address',
          '/api/protocols',
        ],
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  });

  // Generic 404 handler
  app.use('*', (req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Resource ${req.method} ${req.originalUrl} not found`,
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  });

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
};