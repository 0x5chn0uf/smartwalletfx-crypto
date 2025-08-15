import http from 'http';
import app from './app';
import { config } from '@/config';
import { logger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { getChainManager } from '@/services/ChainManager';
import { CHAIN_CONFIGS, CHAIN_RPC_URLS } from '@/types/blockchain';
import { initializeDeFiServices, shutdownDeFiServices } from '@/services/defi';
import { initializeNFTServices, shutdownNFTServices } from '@/services/nft';
import { getEventBus } from '@/events/EventBusFactory';
import { createWorkerManager, WorkerManager } from '@/workers/WorkerManager';
import { createDeFiOrchestrator } from '@/services/defi/DeFiOrchestrator';

// Module-scoped references for lifecycle management
let server: http.Server | null = null;
let workerManager: WorkerManager | null = null;

// Graceful shutdown handler
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  try {
    // Stop accepting new connections
    if (server) {
      server.close(async () => {
        logger.info('HTTP server closed');
        
        // Stop ChainManager (clear timers, stop providers)
        try {
          await getChainManager().stop();
          logger.info('ChainManager stopped');
        } catch (error) {
          logger.error('Error stopping ChainManager:', { error });
        }

        // Shutdown DeFi services
        try {
          await shutdownDeFiServices();
          logger.info('DeFi services shutdown');
        } catch (error) {
          logger.error('Error shutting down DeFi services:', { error });
        }
        
        // Shutdown NFT services
        try {
          await shutdownNFTServices();
          logger.info('NFT services shutdown');
        } catch (error) {
          logger.error('Error shutting down NFT services:', { error });
        }

        // Shutdown worker manager and event bus
        try {
          if (workerManager) {
            await workerManager.stop();
            logger.info('Worker manager shutdown');
          }
          
          const eventBus = getEventBus();
          await eventBus.shutdown();
          logger.info('Event bus shutdown');
        } catch (error) {
          logger.error('Error shutting down event system:', { error });
        }
        
        // Close Redis connections (graceful quit)
        try {
          await redisManager.quit();
          logger.info('Redis connection quit');
        } catch (error) {
          logger.error('Error closing Redis connection:', { error });
        }
        
        // Perform any additional cleanup here
        logger.info('Graceful shutdown completed');
        process.exit(0);
      });
    } else {
      logger.warn('HTTP server not initialized; proceeding with cleanup');
      await getChainManager().stop().catch((error) => logger.error('Error stopping ChainManager:', { error }));
      await shutdownDeFiServices().catch((error) => logger.error('Error shutting down DeFi services:', { error }));
      await shutdownNFTServices().catch((error) => logger.error('Error shutting down NFT services:', { error }));
      
      // Shutdown event system
      if (workerManager) {
        await workerManager.stop().catch((error) => logger.error('Error stopping worker manager:', { error }));
      }
      const eventBus = getEventBus();
      await eventBus.shutdown().catch((error) => logger.error('Error shutting down event bus:', { error }));
      
      await redisManager.quit().catch((error) => logger.error('Error closing Redis connection:', { error }));
      logger.info('Graceful shutdown completed');
      process.exit(0);
    }
    
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
    await getChainManager().initialize();
    
    const healthStatus = getChainManager().getHealthStatus();
    logger.info(`✅ Chain providers initialized: ${healthStatus.healthyProviders}/${healthStatus.totalProviders} healthy`);
    
    if (healthStatus.healthyProviders === 0) {
      logger.warn('⚠️  No healthy providers available. Service may have limited functionality.');
    }

    // Initialize DeFi Services
    logger.info('Initializing DeFi protocol adapters...');
    await initializeDeFiServices();
    logger.info('✅ DeFi services initialized');

    // Initialize NFT Services
    logger.info('Initializing NFT detection services...');
    await initializeNFTServices();
    logger.info('✅ NFT services initialized');

    // Initialize Event Bus and Workers
    logger.info('Initializing event bus and workers...');
    const eventBus = getEventBus();
    await eventBus.healthCheck(); // Ensure event bus is ready
    
    // Create DeFi orchestrator for workers
    const rpcUrls = Object.fromEntries(
      Object.entries(CHAIN_CONFIGS).map(([chainId, config]) => [
        parseInt(chainId) || chainId, // Handle both numeric and string chain IDs
        config.rpcUrl
      ])
    );
    const deFiOrchestrator = createDeFiOrchestrator(rpcUrls);
    await deFiOrchestrator.initialize();
    
    // Initialize worker manager
    workerManager = createWorkerManager(eventBus, deFiOrchestrator, {
      healthCheckIntervalMs: 30000, // 30 seconds
    });
    
    await workerManager.start();
    logger.info('✅ Event bus and workers initialized');
    
    // Start HTTP server
    server = app.listen(config.server.port, config.server.host, async () => {
      logger.info(`🚀 Crypto Data Service started successfully!`);
      logger.info(`📍 Server: http://${config.server.host}:${config.server.port}`);
      logger.info(`🏥 Health: http://${config.server.host}:${config.server.port}/health`);
      logger.info(`📊 Metrics: http://${config.server.host}:${config.server.port}/metrics`);
      logger.info(`🔧 Environment: ${config.server.nodeEnv}`);
      logger.info(`💰 Cost tracking: ${config.costs.trackingEnabled ? 'enabled' : 'disabled'}`);
      // Auth summary
      logger.info(`🔐 API key auth enabled: ${config.security.validApiKeys.length > 0}`);
      logger.info(`🔑 Configured API keys: ${config.security.validApiKeys.length}`);
      logger.info(`🛡️  Metrics protection: ${config.server.isProduction ? 'API key or internal header' : 'dev mode (no auth)'}`);

      if (config.costs.trackingEnabled) {
        logger.info(`💵 Monthly budget: $${config.costs.monthlyBudget}`);
        logger.info(`⚠️  Alert threshold: $${config.costs.alertThreshold}`);
      }
      
      try {
        // Log event system status
        const eventBusHealth = await eventBus.healthCheck();
        const workerHealth = await workerManager!.getHealthStatus();
        logger.info(`📨 Event bus: ${eventBusHealth.status}`);
        logger.info(`⚙️  Workers: ${workerHealth.healthyWorkers}/${workerHealth.totalWorkers} healthy`);
        
        // Log supported chains
        const supportedChains = getChainManager().getSupportedChains();
        logger.info(`🔗 Supported chains: ${supportedChains.length}`);

        supportedChains.forEach((chainId) => {
          const providerStatus = (healthStatus as any).providerStatus[chainId as any];
          const status = providerStatus?.healthy ? '✅' : '❌';
          const chainName = (CHAIN_CONFIGS as any)[chainId as any]?.name || String(chainId);
          logger.info(`  ${status} ${chainName} (${providerStatus?.provider || 'Unknown'})`);
        });
        
        logger.info('🎯 System ready for high-performance portfolio computations!');
        logger.info(`📊 Expected throughput: ≥100 portfolio computations/minute`);
      } catch (error) {
        logger.error('Error during server startup logging:', { error });
      }
    });
    
    // Set server timeout
    server.timeout = 60000; // 60 seconds
    server.keepAliveTimeout = 65000; // 65 seconds
    
    // Server is stored in module scope for graceful shutdown
    
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
