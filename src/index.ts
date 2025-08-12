import app from './app';
import { config } from '@/config/environment';
import { logger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { chainManager } from '@/services/ChainManager';
import { initializeDeFiServices, shutdownDeFiServices } from '@/services/defi';

// Graceful shutdown handler
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  try {
    // Stop accepting new connections
    server.close(async () => {
      logger.info('HTTP server closed');
      
      // Shutdown DeFi services
      try {
        await shutdownDeFiServices();
        logger.info('DeFi services shutdown');
      } catch (error) {
        logger.error('Error shutting down DeFi services:', { error });
      }
      
      // Close Redis connections
      try {
        await redisManager.disconnect();
        logger.info('Redis connections closed');
      } catch (error) {
        logger.error('Error closing Redis connections:', { error });
      }
      
      // Perform any additional cleanup here
      logger.info('Graceful shutdown completed');
      process.exit(0);
    });
    
    // Force shutdown after 30 seconds
    setTimeout(() => {
      logger.error('Graceful shutdown timeout, forcing exit');
      process.exit(1);
    }, 30000);
    
  } catch (error) {
    logger.error('Error during graceful shutdown:', { error });
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', { reason, promise });
  process.exit(1);
});

// Initialize services and start server
async function startServer() {
  try {
    logger.info('Starting crypto-data service...');
    
    // Initialize Redis
    logger.info('Initializing Redis connection...');
    await redisManager.connect();
    logger.info('✅ Redis connected');
    
    // Initialize Chain Manager
    logger.info('Initializing blockchain providers...');
    await chainManager.initialize();
    
    const healthStatus = chainManager.getHealthStatus();
    logger.info(`✅ Chain providers initialized: ${healthStatus.healthyProviders}/${healthStatus.totalProviders} healthy`);
    
    if (healthStatus.healthyProviders === 0) {
      logger.warn('⚠️  No healthy providers available. Service may have limited functionality.');
    }

    // Initialize DeFi Services
    logger.info('Initializing DeFi protocol adapters...');
    await initializeDeFiServices();
    logger.info('✅ DeFi services initialized');
    
    // Start HTTP server
    const server = app.listen(config.server.port, config.server.host, () => {
      logger.info(`🚀 Crypto Data Service started successfully!`);
      logger.info(`📍 Server: http://${config.server.host}:${config.server.port}`);
      logger.info(`🏥 Health: http://${config.server.host}:${config.server.port}/health`);
      logger.info(`📊 Metrics: http://${config.server.host}:${config.server.port}/metrics`);
      logger.info(`🔧 Environment: ${config.server.nodeEnv}`);
      logger.info(`💰 Cost tracking: ${config.costs.trackingEnabled ? 'enabled' : 'disabled'}`);
      
      if (config.costs.trackingEnabled) {
        logger.info(`💵 Monthly budget: $${config.costs.monthlyBudget}`);
        logger.info(`⚠️  Alert threshold: $${config.costs.alertThreshold}`);
      }
      
      // Log supported chains
      const supportedChains = chainManager.getSupportedChains();
      logger.info(`🔗 Supported chains: ${supportedChains.length}`);
      const chainConfigs = {
        [1]: 'Ethereum',
        [137]: 'Polygon',
        [42161]: 'Arbitrum',
        [10]: 'Optimism',
        [8453]: 'Base',
        'solana': 'Solana'
      };
      
      supportedChains.forEach((chainId) => {
        const chainName = chainConfigs[chainId as keyof typeof chainConfigs] || chainId.toString();
        const providerStatus = healthStatus.providerStatus[chainName];
        const status = providerStatus?.healthy ? '✅' : '❌';
        logger.info(`  ${status} ${chainName} (${providerStatus?.provider || 'Unknown'})`);
      });
    });
    
    // Set server timeout
    server.timeout = 60000; // 60 seconds
    server.keepAliveTimeout = 65000; // 65 seconds
    
    // Global server reference for graceful shutdown
    global.server = server;
    
  } catch (error) {
    logger.error('Failed to start server:', { error });
    process.exit(1);
  }
}

// Start the application
startServer().catch((error) => {
  logger.error('Startup error:', { error });
  process.exit(1);
});

// Export server for testing
export { app };

// Extend global namespace for server reference
declare global {
  var server: any;
}