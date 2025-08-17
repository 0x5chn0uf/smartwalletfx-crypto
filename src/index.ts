import http from 'http';
import app from './app';
import { initializeConfig } from './config';
import { logger } from './utils/logger';
import { getRuntime } from './app/runtime';
import type { RuntimeInterface as Runtime } from './app/runtime';
import { ChainId } from './types/blockchain';

// Module-scoped references for lifecycle management
let server: http.Server | null = null;
let runtime: Runtime | null = null;

// Graceful shutdown handler
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  try {
    // Stop accepting new connections
    if (server) {
      server.close(async () => {
        logger.info('HTTP server closed');

        // Stop runtime (this handles all service cleanup)
        if (runtime) {
          await runtime.stop();
        }

        logger.info('Graceful shutdown completed');
        process.exit(0);
      });
    } else {
      logger.warn('HTTP server not initialized; proceeding with runtime cleanup');

      // Stop runtime even without HTTP server
      if (runtime) {
        await runtime.stop();
      }

      logger.info('Graceful shutdown completed');
      process.exit(0);
    }
  } catch (error) {
    logger.error('Error during graceful shutdown:', { error });
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', error => {
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

    const config = await initializeConfig();

    // Initialize runtime and all services
    runtime = getRuntime();
    await runtime.start(config);

    // Start HTTP server with dependencies from runtime
    const dependencies = runtime.dependencies;
    const expressApp = app(config);
    server = expressApp.listen(config.server.port, config.server.host, async () => {
      logger.info(`🚀 Crypto Data Service started successfully!`);
      logger.info(`📍 Server: http://${config.server.host}:${config.server.port}`);
      logger.info(`🏥 Health: http://${config.server.host}:${config.server.port}/health`);
      logger.info(`📊 Metrics: http://${config.server.host}:${config.server.port}/metrics`);
      logger.info(`🔧 Environment: ${config.server.nodeEnv}`);
      logger.info(`💰 Cost tracking: ${config.costs.trackingEnabled ? 'enabled' : 'disabled'}`);
      // Auth summary
      logger.info(`🔐 API key auth enabled: ${config.security.validApiKeys.length > 0}`);
      logger.info(`🔑 Configured API keys: ${config.security.validApiKeys.length}`);
      logger.info(
        `🛡️  Metrics protection: ${config.server.isProduction ? 'API key or internal header' : 'dev mode (no auth)'}`
      );

      if (config.costs.trackingEnabled) {
        logger.info(`💵 Monthly budget: $${config.costs.monthlyBudget}`);
        logger.info(`⚠️  Alert threshold: $${config.costs.alertThreshold}`);
      }

      try {
        // Get runtime health status
        const runtimeHealth = runtime!.getHealthStatus();
        logger.info(`📊 Runtime status: ${runtimeHealth.status}`);

        // Log service health
        Object.entries(runtimeHealth.services).forEach(([service, healthy]) => {
          const status = healthy ? '✅' : '❌';
          logger.info(`  ${status} ${service}`);
        });

        // Log supported chains
        const supportedChains = dependencies.chainManager.getSupportedChains();
        logger.info(`🔗 Supported chains: ${supportedChains.length}`);

        const chainHealth = dependencies.chainManager.getHealthStatus();
        supportedChains.forEach((chainId: ChainId) => {
          const providerStatus = (chainHealth as any).providerStatus[chainId as any];
          const status = providerStatus?.healthy ? '✅' : '❌';
          const chainName = (config.chains as any)[chainId]?.name || String(chainId);
          logger.info(`  ${status} ${chainName} (${providerStatus?.provider || 'Unknown'})`);
        });

        logger.info('🎯 System ready for high-performance portfolio computations!');
        logger.info(`📊 Expected throughput: ≥100 portfolio computations/minute`);
        logger.info(`⏱️  Runtime uptime: ${Math.round((runtime as any).uptime / 1000)}s`);
      } catch (error) {
        logger.error('Error during server startup logging:', { error });
      }
    });

    // Set server timeout
    server.timeout = 60000; // 60 seconds
    server.keepAliveTimeout = 65000; // 65 seconds
  } catch (error) {
    logger.error('Failed to start server:', { error });

    // Clean up runtime on startup failure
    if (runtime) {
      try {
        await runtime.stop();
      } catch (cleanupError) {
        logger.error('Error during startup cleanup:', { error: cleanupError });
      }
    }

    process.exit(1);
  }
}

// Start the application
startServer().catch(error => {
  logger.error('Startup error:', { error });
  process.exit(1);
});

// Export server for testing
export { server };

// Extend global namespace for server reference
declare global {
  var server: any;
}