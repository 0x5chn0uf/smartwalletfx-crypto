import { ConfigOrchestrator, OrchestatedConfig } from './modules/ConfigOrchestrator';
import { logger } from '../utils/logger';

// Legacy config items that haven't been modularized yet
import { env, parseCommaSeparated, loadSensitiveSecrets } from './env/validation';
import { buildChainsConfig } from './chains';

// Global config orchestrator instance
let orchestrator: ConfigOrchestrator | null = null;
let legacyConfig: any = null;

/**
 * Initialize the modular configuration system
 */
export const initializeModularConfig = async (): Promise<ModularConfig> => {
  if (!orchestrator) {
    orchestrator = new ConfigOrchestrator();
  }

  // Initialize orchestrated config modules
  const coreConfig = await orchestrator.initialize();

  // Load remaining legacy config items (to be modularized later)
  const secrets = await loadSensitiveSecrets();
  
  legacyConfig = {
    // API Keys - TODO: Move to ApiKeyConfig module
    apiKeys: {
      alchemy: secrets.alchemyApiKey,
      moralis: secrets.moralisApiKey,
      quicknode: secrets.quicknodeApiKey,
      ankr: secrets.ankrApiKey,
      helius: secrets.heliusApiKey,
      infura: secrets.infuraApiKey,
      openSea: secrets.openseaApiKey,
      magicEden: secrets.magicEdenApiKey,
      reservoir: secrets.reservoirApiKey,
      nftGo: secrets.nftgoApiKey,
      defiLlama: secrets.defiLlamaApiKey,
      coinGecko: secrets.coingeckoApiKey,
      dune: secrets.duneApiKey,
      theGraph: secrets.theGraphApiKey,
    },

    // Redis - TODO: Move to RedisConfig module
    redis: {
      url: secrets.redisUrl,
      maxRetries: env.REDIS_MAX_RETRIES,
      retryDelay: env.REDIS_RETRY_DELAY,
      commandTimeout: env.REDIS_COMMAND_TIMEOUT,
      maxMemory: env.REDIS_MAX_MEMORY,
      keyPrefix: env.REDIS_KEY_PREFIX,
    },

    // Rate Limiting - TODO: Move to RateLimitConfig module
    rateLimit: {
      window: env.RATE_LIMIT_WINDOW,
      max: env.RATE_LIMIT_MAX,
      skipSuccessfulRequests: env.RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS,
      store: env.RATE_LIMIT_STORE,
    },

    // CORS - TODO: Move to CorsConfig module
    cors: {
      origins: env.CORS_ORIGINS
        ? parseCommaSeparated(env.CORS_ORIGINS)
        : coreConfig.server.nodeEnv === 'production'
          ? ['https://app.smartwalletfx.com', 'https://smartwalletfx.com']
          : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'],
      credentials: env.CORS_CREDENTIALS,
      maxAge: env.CORS_MAX_AGE,
    },

    // Performance - TODO: Move to PerformanceConfig module
    performance: {
      maxConcurrentRequests: env.MAX_CONCURRENT_REQUESTS,
      requestTimeout: env.REQUEST_TIMEOUT,
      slowQueryThreshold: env.SLOW_QUERY_THRESHOLD,
    },

    // Feature Flags - TODO: Move to FeatureConfig module
    features: {
      websockets: env.ENABLE_WEBSOCKETS,
      graphql: env.ENABLE_GRAPHQL,
      swagger: env.ENABLE_SWAGGER,
      cacheWarming: env.ENABLE_CACHE_WARMING,
      asyncPortfolio: env.ENABLE_ASYNC_PORTFOLIO,
      asyncPortfolioMaxRequests: env.ASYNC_PORTFOLIO_MAX_REQUESTS,
      experimental: {},
    },

    // Chains - TODO: Move to ChainConfig module
    chains: buildChainsConfig(secrets),

    // Event Bus - TODO: Move to EventBusConfig module
    eventBus: {
      type: process.env.EVENT_BUS_TYPE || 'memory',
      redis: {
        url: secrets.redisUrl,
        keyPrefix: env.REDIS_KEY_PREFIX + ':events:',
      },
      bullmq: {
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 10,
          removeOnFail: 5,
        },
      },
    },

    // Health Check - TODO: Move to HealthConfig module
    healthCheck: {
      timeout: env.HEALTH_CHECK_TIMEOUT,
      interval: env.HEALTH_CHECK_INTERVAL,
    },

    // Costs - TODO: Move to CostConfig module
    costs: {
      monthlyBudget: env.MONTHLY_API_BUDGET,
      alertThreshold: env.COST_ALERT_THRESHOLD,
      trackingEnabled: env.ENABLE_COST_TRACKING,
      reportingInterval: env.COST_REPORTING_INTERVAL,
    },

    // Logging - TODO: Move to LoggingConfig module
    logging: {
      level: env.LOG_LEVEL,
      format: env.LOG_FORMAT,
      fileEnabled: env.LOG_FILE_ENABLED,
      filePath: env.LOG_FILE_PATH,
      maxFileSize: env.LOG_MAX_FILE_SIZE,
      maxFiles: env.LOG_MAX_FILES,
    },

    // Metrics - TODO: Move to MetricsConfig module
    metrics: {
      enabled: env.ENABLE_METRICS,
      port: env.METRICS_PORT,
      path: env.METRICS_PATH,
    },

    // Pricing - TODO: Move to PricingConfig module
    pricing: {
      ttl: {
        native: env.PRICING_NATIVE_TTL,
        token: env.PRICING_TOKEN_TTL,
      },
    },

    // Solana - TODO: Move to SolanaConfig module
    solana: {
      rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      heliusApiKey: secrets.heliusApiKey || '',
      jupiterApiUrl: process.env.JUPITER_API_URL || 'https://quote-api.jup.ag/v6',
      marinadeApiUrl: process.env.MARINADE_API_URL || 'https://api.marinade.finance/v1',
      orcaApiUrl: process.env.ORCA_API_URL || 'https://api.orca.so/v1',
      enabledProtocols: (process.env.SOLANA_ENABLED_PROTOCOLS || 'jupiter,marinade,orca').split(','),
      cacheSettings: {
        portfolio: parseInt(process.env.SOLANA_CACHE_PORTFOLIO || '300'),
        analytics: parseInt(process.env.SOLANA_CACHE_ANALYTICS || '600'),
        crossChain: parseInt(process.env.SOLANA_CACHE_CROSS_CHAIN || '900'),
      },
      performance: {
        maxConcurrentRequests: parseInt(process.env.SOLANA_MAX_CONCURRENT || '5'),
        timeoutMs: parseInt(process.env.SOLANA_TIMEOUT_MS || '15000'),
        retryAttempts: parseInt(process.env.SOLANA_RETRY_ATTEMPTS || '3'),
      },
    },
  };

  const modularConfig: ModularConfig = {
    // Orchestrated modules
    server: coreConfig.server,
    database: coreConfig.database,
    cache: coreConfig.cache,
    security: coreConfig.security,
    
    // Legacy config (temporary)
    ...legacyConfig,
  };

  logger.info('🎯 Modular configuration system initialized');
  logger.info(`📊 Orchestrated modules: ${Object.keys(coreConfig).join(', ')}`);
  logger.info(`⚠️  Legacy config items: ${Object.keys(legacyConfig).length} remaining`);

  return modularConfig;
};

/**
 * Get the configuration orchestrator for advanced operations
 */
export const getConfigOrchestrator = (): ConfigOrchestrator => {
  if (!orchestrator) {
    throw new Error('Configuration orchestrator not initialized. Call initializeModularConfig() first.');
  }
  return orchestrator;
};

/**
 * Reload a specific configuration module
 */
export const reloadConfigModule = async (moduleName: string): Promise<void> => {
  const orch = getConfigOrchestrator();
  await orch.reloadModule(moduleName as any);
};

/**
 * Get configuration health status
 */
export const getConfigHealth = (): Record<string, { isValid: boolean; errors: string[]; warnings: string[] }> => {
  const orch = getConfigOrchestrator();
  return orch.getHealthStatus();
};

// Type definition for the modular config
export type ModularConfig = OrchestatedConfig & typeof legacyConfig;

// Singleton instance
let modularConfigInstance: ModularConfig | null = null;

export const getModularConfig = async (): Promise<ModularConfig> => {
  if (!modularConfigInstance) {
    modularConfigInstance = await initializeModularConfig();
  }
  return modularConfigInstance;
};

// Migration progress tracking
export const getMigrationProgress = (): { 
  migratedModules: string[], 
  remainingItems: string[], 
  completionPercentage: number 
} => {
  const migratedModules = ['server', 'database', 'cache', 'security'];
  const totalItems = migratedModules.length + (legacyConfig ? Object.keys(legacyConfig).length : 0);
  
  return {
    migratedModules,
    remainingItems: legacyConfig ? Object.keys(legacyConfig) : [],
    completionPercentage: totalItems > 0 ? (migratedModules.length / totalItems) * 100 : 0,
  };
};