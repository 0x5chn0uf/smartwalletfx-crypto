import { env, parseCommaSeparated } from './env/validation';
import { buildChainsConfig } from './env/chains';

export const config = {
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
    heliusApiKey: process.env.HELIUS_API_KEY || '',
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

  // Database Configuration
  database: {
    url: env.DATABASE_URL,
    poolSize: env.DATABASE_POOL_SIZE,
    timeout: env.DATABASE_TIMEOUT,
    ssl: env.DATABASE_SSL,
  },

  // Redis Configuration
  redis: {
    url: env.REDIS_URL,
    maxRetries: env.REDIS_MAX_RETRIES,
    retryDelay: env.REDIS_RETRY_DELAY,
    commandTimeout: env.REDIS_COMMAND_TIMEOUT,
    maxMemory: env.REDIS_MAX_MEMORY,
    keyPrefix: env.REDIS_KEY_PREFIX,
  },

  // API Keys - Primary and secondary
  apiKeys: {
    alchemy: env.ALCHEMY_API_KEY,
    moralis: env.MORALIS_API_KEY,
    quicknode: env.QUICKNODE_API_KEY,
    ankr: env.ANKR_API_KEY,
    helius: env.HELIUS_API_KEY,
    infura: env.INFURA_API_KEY,
    openSea: env.OPENSEA_API_KEY,
    magicEden: env.MAGIC_EDEN_API_KEY,
    reservoir: env.RESERVOIR_API_KEY,
    nftGo: env.NFTGO_API_KEY,
    defiLlama: env.DEFI_LLAMA_API_KEY,
    coinGecko: env.COINGECKO_API_KEY,
    dune: env.DUNE_API_KEY,
    theGraph: env.THE_GRAPH_API_KEY,
  },

  // RPC URLs
  rpcUrls: {
    ethereum: env.ETHEREUM_RPC_URL,
    polygon: env.POLYGON_RPC_URL,
    arbitrum: env.ARBITRUM_RPC_URL,
    optimism: env.OPTIMISM_RPC_URL,
    base: env.BASE_RPC_URL,
    bsc: env.BSC_RPC_URL,
    avalanche: env.AVALANCHE_RPC_URL,
    fantom: env.FANTOM_RPC_URL,
  },

  // Security
  security: {
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    jwtRefreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    encryptionKey: env.ENCRYPTION_KEY,
    encryptionAlgorithm: env.ENCRYPTION_ALGORITHM,
    apiKeySalt: env.API_KEY_SALT,
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
    sentryDsn: env.SENTRY_DSN,
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

  // Feature Flags
  features: {
    websockets: env.ENABLE_WEBSOCKETS,
    graphql: env.ENABLE_GRAPHQL,
    swagger: env.ENABLE_SWAGGER,
    cacheWarming: env.ENABLE_CACHE_WARMING,
    asyncPortfolio: env.ENABLE_ASYNC_PORTFOLIO,
    asyncPortfolioMaxRequests: env.ASYNC_PORTFOLIO_MAX_REQUESTS,
  },

  // Development
  development: {
    debugMode: env.DEBUG_MODE,
    mockExternalApis: env.MOCK_EXTERNAL_APIS,
  },

  // Chains
  chains: buildChainsConfig(),
} as const;

export const isProductionEnvironment = () => config.server.isProduction;
export const isDevelopmentEnvironment = () => config.server.isDevelopment;
export const isStagingEnvironment = () => config.server.isStaging;
