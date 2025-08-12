import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from './config/environment';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { authMiddleware } from './middleware/auth';
import { metricsMiddleware, metricsRouter } from './middleware/metrics';
import { portfolioRouter } from './controllers/portfolio';
import { pricesRouter } from './controllers/prices';
import { defiRouter } from './controllers/defi';
import { nftRouter } from './controllers/nft';
import { healthRouter } from './controllers/health';
import { prisma } from './utils/database';
import { redisClient } from './utils/redis';
import { initializeWebSocket } from './services/websocket';

// Create Express app
const app = express();
const server = createServer(app);

// WebSocket setup
const wss = new WebSocketServer({ server });
initializeWebSocket(wss);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: config.cors.origins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.window * 60 * 1000, // Convert to milliseconds
  max: config.rateLimit.max,
  message: {
    error: 'Too many requests, please try again later',
    retryAfter: config.rateLimit.window * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

// General middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Custom middleware
app.use(requestLogger);
app.use(metricsMiddleware);

// Health check (no auth required)
app.use('/health', healthRouter);
app.use('/metrics', metricsRouter);

// API routes (require authentication)
app.use('/api/portfolio', authMiddleware, portfolioRouter);
app.use('/api/prices', authMiddleware, pricesRouter);
app.use('/api/defi', authMiddleware, defiRouter);
app.use('/api/nft', authMiddleware, nftRouter);

// API documentation
app.get('/api', (req, res) => {
  res.json({
    service: 'SmartWalletFX Crypto Data Service',
    version: '1.0.0',
    endpoints: {
      portfolio: '/api/portfolio/:address',
      prices: '/api/prices/:symbol',
      defi: '/api/defi/positions/:address',
      nft: '/api/nft/:address',
      health: '/health',
      metrics: '/metrics',
      websocket: '/ws'
    },
    documentation: 'https://docs.smartwalletfx.com/crypto-data-service'
  });
});

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested endpoint does not exist',
    path: req.originalUrl
  });
});

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}, starting graceful shutdown`);

  server.close(() => {
    logger.info('HTTP server closed');
  });

  // Close WebSocket connections
  wss.clients.forEach(ws => ws.terminate());
  wss.close(() => {
    logger.info('WebSocket server closed');
  });

  // Close database connections
  try {
    await prisma.$disconnect();
    logger.info('Database disconnected');
  } catch (error) {
    logger.error('Error disconnecting database:', error);
  }

  // Close Redis connection
  try {
    await redisClient.disconnect();
    logger.info('Redis disconnected');
  } catch (error) {
    logger.error('Error disconnecting Redis:', error);
  }

  process.exit(0);
};

// Signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start server
const startServer = async () => {
  try {
    // Test database connection
    await prisma.$connect();
    logger.info('Database connected successfully');

    // Test Redis connection
    await redisClient.ping();
    logger.info('Redis connected successfully');

    // Start server
    server.listen(config.server.port, config.server.host, () => {
      logger.info(`🚀 Server running on http://${config.server.host}:${config.server.port}`);
      logger.info(`📊 Metrics available on http://${config.server.host}:${config.metrics.port}/metrics`);
      logger.info(`🔌 WebSocket server running on ws://${config.server.host}:${config.server.port}/ws`);
      logger.info(`Environment: ${config.server.nodeEnv}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();

export { app, server, wss };