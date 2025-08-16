import { env, parseCommaSeparated, loadSensitiveSecrets, SensitiveSecrets } from './env/validation';
import { buildChainsConfig } from './env/chains';

export const initializeConfig = async () => {
  const loadedSecrets = await loadSensitiveSecrets();

  const config = {
    // Server Configuration
    nodeEnv: env.NODE_ENV,
    server: {
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
      host: env.HOST,
      timeout: env.SERVER_TIMEOUT,
      bodyLimit: env.BODY_LIMIT,
      isDevelopment: env.NODE_ENV === 'development',
      isStaging: env.NODE_ENV === 'staging',
      isProduction: env.NODE_ENV === 'production',
      gracefulShutdownTimeout: env.GRACEFUL_SHUTDOWN_TIMEOUT,
    },
    // Solana configuration
    solana: {
      rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      heliusApiKey: loadedSecrets.heliusApiKey || '',
      jupiterApiUrl: process.env.JUPITER_API_URL || 'https://quote-api.jup.ag/v6',
      marinadeApiUrl: process.env.MARINADE_API_URL || 'https://api.marinade.finance/v1',
      orcaApiUrl: process.env.ORCA_API_URL || 'https://api.orca.so/v1',
      enabledProtocols: (process.env.SOLANA_ENABLED_PROTOCOLS || 'jupiter,marinade,orca').split(
        ','
      ),
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

    // Database Configuration
    database: {
      url: loadedSecrets.databaseUrl,
      poolSize: env.DATABASE_POOL_SIZE,
      timeout: env.DATABASE_TIMEOUT,
      ssl: env.DATABASE_SSL,
    },

    // Redis Configuration
    redis: {
      url: loadedSecrets.redisUrl,
      maxRetries: env.REDIS_MAX_RETRIES,
      retryDelay: env.REDIS_RETRY_DELAY,
      commandTimeout: env.REDIS_COMMAND_TIMEOUT,
      maxMemory: env.REDIS_MAX_MEMORY,
      keyPrefix: env.REDIS_KEY_PREFIX,
    },

    // API Keys - Primary and secondary
    apiKeys: {
      alchemy: loadedSecrets.alchemyApiKey,
      moralis: loadedSecrets.moralisApiKey,
      quicknode: loadedSecrets.quicknodeApiKey,
      ankr: loadedSecrets.ankrApiKey,
      helius: loadedSecrets.heliusApiKey,
      infura: loadedSecrets.infuraApiKey,
      openSea: loadedSecrets.openseaApiKey,
      magicEden: loadedSecrets.magicEdenApiKey,
      reservoir: loadedSecrets.reservoirApiKey,
      nftGo: loadedSecrets.nftgoApiKey,
      defiLlama: loadedSecrets.defiLlamaApiKey,
      coinGecko: loadedSecrets.coingeckoApiKey,
      dune: loadedSecrets.duneApiKey,
      theGraph: loadedSecrets.theGraphApiKey,
    },

    // RPC URLs
    rpcUrls: {
      ethereum: loadedSecrets.ethereumRpcUrl,
      polygon: loadedSecrets.polygonRpcUrl,
      arbitrum: loadedSecrets.arbitrumRpcUrl,
      optimism: loadedSecrets.optimismRpcUrl,
      base: loadedSecrets.baseRpcUrl,
      bsc: loadedSecrets.bscRpcUrl,
      avalanche: loadedSecrets.avalancheRpcUrl,
      fantom: loadedSecrets.fantomRpcUrl,
    },

    // Security
    security: {
      jwtSecret: loadedSecrets.jwtSecret,
      jwtExpiresIn: loadedSecrets.jwtExpiresIn,
      jwtRefreshExpiresIn: loadedSecrets.jwtRefreshExpiresIn,
      encryptionKey: loadedSecrets.encryptionKey,
      encryptionAlgorithm: loadedSecrets.encryptionAlgorithm,
      apiKeySalt: loadedSecrets.apiKeySalt,
      validApiKeys: env.VALID_API_KEYS ? parseCommaSeparated(env.VALID_API_KEYS) : [],
      apiKeyRateLimit: env.API_KEY_RATE_LIMIT,
    },

    // Rate Limiting
    rateLimit: {
      window: env.RATE_LIMIT_WINDOW,
      max: env.RATE_LIMIT_MAX,
      skipSuccessfulRequests: env.RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS,
      store: env.RATE_LIMIT_STORE,
    },

    // Cache
    cache: {
      ttl: {
        short: env.CACHE_TTL_SHORT,
        medium: env.CACHE_TTL_MEDIUM,
        long: env.CACHE_TTL_LONG,
        static: env.CACHE_TTL_STATIC,
      },
      compression: env.CACHE_COMPRESSION,
    },

    // Pricing
    pricing: {
      ttl: {
        native: env.PRICING_NATIVE_TTL,
        token: env.PRICING_TOKEN_TTL,
      },
    },

    // CORS
    cors: {
      origins: env.CORS_ORIGINS
        ? parseCommaSeparated(env.CORS_ORIGINS)
        : env.NODE_ENV === 'production'
          ? ['https://app.smartwalletfx.com', 'https://smartwalletfx.com']
          : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'],
      credentials: env.CORS_CREDENTIALS,
      maxAge: env.CORS_MAX_AGE,
    },

    // Monitoring and Observability
    metrics: {
      enabled: env.ENABLE_METRICS,
      port: env.METRICS_PORT,
      path: env.METRICS_PATH,
    },

    // Logging
    logging: {
      level: env.LOG_LEVEL,
      format: env.LOG_FORMAT,
      fileEnabled: env.LOG_FILE_ENABLED,
      filePath: env.LOG_FILE_PATH,
      maxFileSize: env.LOG_MAX_FILE_SIZE,
      maxFiles: env.LOG_MAX_FILES,
    },

    // Error Tracking
    errorTracking: {
      sentryDsn: loadedSecrets.sentryDsn,
      sentryEnvironment: env.SENTRY_ENVIRONMENT || env.NODE_ENV,
      sentrySampleRate: env.SENTRY_SAMPLE_RATE,
    },

    // Health Check
    healthCheck: {
      timeout: env.HEALTH_CHECK_TIMEOUT,
      interval: env.HEALTH_CHECK_INTERVAL,
    },

    // Cost Management
    costs: {
      monthlyBudget: env.MONTHLY_API_BUDGET,
      alertThreshold: env.COST_ALERT_THRESHOLD,
      trackingEnabled: env.ENABLE_COST_TRACKING,
      reportingInterval: env.COST_REPORTING_INTERVAL,
    },

    // Performance
    performance: {
      maxConcurrentRequests: env.MAX_CONCURRENT_REQUESTS,
      requestTimeout: env.REQUEST_TIMEOUT,
      slowQueryThreshold: env.SLOW_QUERY_THRESHOLD,
    },

    // Concurrency Control
    concurrency: {
      enabled: env.ENABLE_CONCURRENCY_LIMITING,
      chainManagerConcurrency: env.CHAIN_MANAGER_CONCURRENCY,
      retryConfig: {
        maxAttempts: env.PROVIDER_RETRY_ATTEMPTS,
        initialDelayMs: env.PROVIDER_RETRY_INITIAL_DELAY,
        maxDelayMs: env.PROVIDER_RETRY_MAX_DELAY,
        backoffMultiplier: env.PROVIDER_RETRY_BACKOFF_MULTIPLIER,
        jitterFactor: env.PROVIDER_RETRY_JITTER_FACTOR,
      },
      rateLimits: {
        perSecond: env.PROVIDER_RATE_LIMIT_PER_SECOND,
        perMinute: env.PROVIDER_RATE_LIMIT_PER_MINUTE,
        burstAllowance: env.PROVIDER_BURST_ALLOWANCE,
      },
    },

    // Feature Flags
    features: {
      websockets: env.ENABLE_WEBSOCKETS,
      graphql: env.ENABLE_GRAPHQL,
      swagger: env.ENABLE_SWAGGER,
      cacheWarming: env.ENABLE_CACHE_WARMING,
      asyncPortfolio: env.ENABLE_ASYNC_PORTFOLIO,
      asyncPortfolioMaxRequests: env.ASYNC_PORTFOLIO_MAX_REQUESTS,
      experimental: {},
    },

    // Event Bus Configuration
    eventBus: {
      type: process.env.EVENT_BUS_TYPE || 'memory', // 'memory' | 'bullmq'
      redis: {
        url: loadedSecrets.redisUrl,
        keyPrefix: env.REDIS_KEY_PREFIX + ':events:',
      },
      bullmq: {
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: 10,
          removeOnFail: 5,
        },
      },
    },

    // Development
    development: {
      debugMode: env.DEBUG_MODE,
      mockExternalApis: env.MOCK_EXTERNAL_APIS,
    },

    // Chains
    chains: buildChainsConfig(loadedSecrets),
  };
  return config;
};

export const isProductionEnvironment = (config: Config) => config.server.isProduction;
export const isDevelopmentEnvironment = (config: Config) => config.server.isDevelopment;
export const isStagingEnvironment = (config: Config) => config.server.isStaging;

export type Config = Awaited<ReturnType<typeof initializeConfig>>;
