import { z } from 'zod';

// Helpers
export const stringToBoolean = (value: string) => value.toLowerCase() === 'true';
export const parseCommaSeparated = (value: string) =>
  value
    ? value
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : [];

// Validation schema for environment variables
export const envSchema = z.object({
  // Server Configuration
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  HOST: z.string().default('0.0.0.0'),
  SERVER_TIMEOUT: z.string().transform(Number).default('30000'),
  BODY_LIMIT: z.string().default('10mb'),

  DATABASE_POOL_SIZE: z.string().transform(Number).default('10'),
  DATABASE_TIMEOUT: z.string().transform(Number).default('60000'),
  DATABASE_SSL: z.string().transform(stringToBoolean).default('false'),

  // Redis Configuration

  REDIS_MAX_RETRIES: z.string().transform(Number).default('3'),
  REDIS_RETRY_DELAY: z.string().transform(Number).default('1000'),
  REDIS_COMMAND_TIMEOUT: z.string().transform(Number).default('5000'),
  REDIS_MAX_MEMORY: z.string().default('512mb'),
  REDIS_KEY_PREFIX: z.string().default('smartwallet:crypto:'),

  // Solana
  SOLANA_RPC_URL: z.string().url().optional(),
  SOLANA_COMMITMENT: z.enum(['processed', 'confirmed', 'finalized']).default('confirmed'),

  // Security

  // API Keys Management
  VALID_API_KEYS: z.string().optional(),
  API_KEY_RATE_LIMIT: z.string().transform(Number).default('1000'),

  // Rate Limiting
  RATE_LIMIT_WINDOW: z.string().transform(Number).default('15'),
  RATE_LIMIT_MAX: z.string().transform(Number).default('100'),
  RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS: z.string().transform(stringToBoolean).default('false'),
  RATE_LIMIT_STORE: z.enum(['memory', 'redis']).default('redis'),

  // Cache
  CACHE_TTL_SHORT: z.string().transform(Number).default('300'),
  CACHE_TTL_MEDIUM: z.string().transform(Number).default('3600'),
  CACHE_TTL_LONG: z.string().transform(Number).default('86400'),
  CACHE_TTL_STATIC: z.string().transform(Number).default('604800'),
  CACHE_COMPRESSION: z.string().transform(stringToBoolean).default('true'),

  // Pricing TTLs
  PRICING_NATIVE_TTL: z.string().transform(Number).default('60'),
  PRICING_TOKEN_TTL: z.string().transform(Number).default('300'),

  // CORS
  CORS_ORIGINS: z.string().optional(),
  CORS_CREDENTIALS: z.string().transform(stringToBoolean).default('true'),
  CORS_MAX_AGE: z.string().transform(Number).default('86400'),

  // Monitoring
  ENABLE_METRICS: z.string().transform(stringToBoolean).default('true'),
  METRICS_PORT: z.string().transform(Number).default('9090'),
  METRICS_PATH: z.string().default('/metrics'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
  LOG_FILE_ENABLED: z.string().transform(stringToBoolean).default('false'),
  LOG_FILE_PATH: z.string().default('./logs/crypto-data.log'),
  LOG_MAX_FILE_SIZE: z.string().default('100m'),
  LOG_MAX_FILES: z.string().transform(Number).default('5'),

  // Error tracking

  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_SAMPLE_RATE: z.string().transform(Number).default('0.1'),

  // Health
  HEALTH_CHECK_TIMEOUT: z.string().transform(Number).default('5000'),
  HEALTH_CHECK_INTERVAL: z.string().transform(Number).default('30000'),

  // Cost
  MONTHLY_API_BUDGET: z.string().transform(Number).default('200'),
  COST_ALERT_THRESHOLD: z.string().transform(Number).default('150'),
  ENABLE_COST_TRACKING: z.string().transform(stringToBoolean).default('true'),
  COST_REPORTING_INTERVAL: z.string().transform(Number).default('86400000'),

  // Performance
  MAX_CONCURRENT_REQUESTS: z.string().transform(Number).default('100'),
  REQUEST_TIMEOUT: z.string().transform(Number).default('30000'),
  SLOW_QUERY_THRESHOLD: z.string().transform(Number).default('1000'),
  GRACEFUL_SHUTDOWN_TIMEOUT: z.string().transform(Number).default('10000'),

  // Concurrency Control & Rate Limiting
  ENABLE_CONCURRENCY_LIMITING: z.string().transform(stringToBoolean).default('true'),
  CHAIN_MANAGER_CONCURRENCY: z.string().transform(Number).default('10'),
  PROVIDER_RETRY_ATTEMPTS: z.string().transform(Number).default('3'),
  PROVIDER_RETRY_INITIAL_DELAY: z.string().transform(Number).default('1000'),
  PROVIDER_RETRY_MAX_DELAY: z.string().transform(Number).default('30000'),
  PROVIDER_RETRY_BACKOFF_MULTIPLIER: z.string().transform(Number).default('2.0'),
  PROVIDER_RETRY_JITTER_FACTOR: z.string().transform(Number).default('0.1'),
  PROVIDER_RATE_LIMIT_PER_SECOND: z.string().transform(Number).default('10'),
  PROVIDER_RATE_LIMIT_PER_MINUTE: z.string().transform(Number).default('600'),
  PROVIDER_BURST_ALLOWANCE: z.string().transform(Number).default('5'),

  // Flags
  ENABLE_WEBSOCKETS: z.string().transform(stringToBoolean).default('false'),
  ENABLE_GRAPHQL: z.string().transform(stringToBoolean).default('false'),
  ENABLE_SWAGGER: z.string().transform(stringToBoolean).default('true'),
  ENABLE_CACHE_WARMING: z.string().transform(stringToBoolean).default('true'),
  ENABLE_ASYNC_PORTFOLIO: z.string().transform(stringToBoolean).default('true'),
  ASYNC_PORTFOLIO_MAX_REQUESTS: z.string().transform(Number).default('1000'),

  // Dev/Debug
  DEBUG_MODE: z.string().transform(stringToBoolean).default('false'),
  MOCK_EXTERNAL_APIS: z.string().transform(stringToBoolean).default('false'),
});

// Parse and validate env
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  const fieldErrors = parsed.error.flatten().fieldErrors;
  Object.entries(fieldErrors).forEach(([field, errors]) =>
    console.error(`  ${field}: ${errors?.join(', ')}`)
  );
  process.exit(1);
}

export const env = parsed.data;

import { EnvSecretManagerAdapter } from '@/adapters/EnvSecretManagerAdapter';
import { SecretManagerPort } from '@/ports/SecretManagerPort';

let secretManager: SecretManagerPort;

export const initializeSecretManager = (adapter: SecretManagerPort) => {
  secretManager = adapter;
};

export const getSecretManager = (): SecretManagerPort => {
  if (!secretManager) {
    // Default to EnvSecretManagerAdapter if not explicitly set
    secretManager = new EnvSecretManagerAdapter();
  }
  return secretManager;
};

// SECURITY FIX: Enhanced production-time validations
if (env.NODE_ENV === 'production') {
  const required = ['DATABASE_URL', 'REDIS_URL'] as const; // JWT_SECRET and ENCRYPTION_KEY are now fetched via secret manager
  const missing = required.filter(key => {
    const v = (env as any)[key];
    return !v || (typeof v === 'string' && v.length === 0);
  });
  if (missing.length > 0) {
    console.error('🚨 Production deployment requires these fields:');
    missing.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  }

  // SECURITY FIX: Production security warnings and validations
  if (env.ENABLE_SWAGGER === true) {
    console.warn('🚨 WARNING: Swagger UI is enabled in production environment');
    console.warn('  Ensure SWAGGER_ALLOWED_IPS is configured for IP restrictions');
    console.warn('  API documentation will require valid API key authentication');

    // Check if IP whitelist is configured
    if (!process.env.SWAGGER_ALLOWED_IPS) {
      console.warn('  Consider setting SWAGGER_ALLOWED_IPS for additional security');
    }
  }

  // Validate CORS origins in production
  if (env.CORS_ORIGINS?.includes('localhost') || env.CORS_ORIGINS?.includes('*')) {
    console.warn('🚨 WARNING: Insecure CORS origins detected in production');
    console.warn('  Remove localhost and wildcard origins from CORS_ORIGINS');
  }

  // Ensure rate limiting is properly configured
  if (env.RATE_LIMIT_MAX > 1000) {
    console.warn('🚨 WARNING: Rate limit seems high for production (>1000 requests)');
  }

  // Security contact validation
  if (!process.env.SECURITY_CONTACT_EMAIL) {
    console.warn('⚠️  Consider setting SECURITY_CONTACT_EMAIL for security incident reporting');
  }
}

// We will fetch sensitive secrets here and export them
export const loadSensitiveSecrets = async () => {
  const sm = getSecretManager();
  const secrets = {
    databaseUrl: await sm.getRequiredSecret('DATABASE_URL'),
    redisUrl: await sm.getRequiredSecret('REDIS_URL'),
    alchemyApiKey: await sm.getRequiredSecret('ALCHEMY_API_KEY'),
    moralisApiKey: await sm.getSecret('MORALIS_API_KEY'),
    quicknodeApiKey: await sm.getSecret('QUICKNODE_API_KEY'),
    ankrApiKey: await sm.getSecret('ANKR_API_KEY'),
    heliusApiKey: await sm.getSecret('HELIUS_API_KEY'),
    infuraApiKey: await sm.getSecret('INFURA_API_KEY'),
    openseaApiKey: await sm.getSecret('OPENSEA_API_KEY'),
    magicEdenApiKey: await sm.getSecret('MAGIC_EDEN_API_KEY'),
    reservoirApiKey: await sm.getSecret('RESERVOIR_API_KEY'),
    nftgoApiKey: await sm.getSecret('NFTGO_API_KEY'),
    defiLlamaApiKey: await sm.getSecret('DEFI_LLAMA_API_KEY'),
    coingeckoApiKey: await sm.getSecret('COINGECKO_API_KEY'),
    duneApiKey: await sm.getSecret('DUNE_API_KEY'),
    theGraphApiKey: await sm.getSecret('THE_GRAPH_API_KEY'),
    ethereumRpcUrl: await sm.getRequiredSecret('ETHEREUM_RPC_URL'),
    polygonRpcUrl: await sm.getSecret('POLYGON_RPC_URL'),
    arbitrumRpcUrl: await sm.getSecret('ARBITRUM_RPC_URL'),
    optimismRpcUrl: await sm.getSecret('OPTIMISM_RPC_URL'),
    baseRpcUrl: await sm.getSecret('BASE_RPC_URL'),
    bscRpcUrl: await sm.getSecret('BSC_RPC_URL'),
    avalancheRpcUrl: await sm.getSecret('AVALANCHE_RPC_URL'),
    fantomRpcUrl: await sm.getSecret('FANTOM_RPC_URL'),
    jwtSecret: await sm.getRequiredSecret('JWT_SECRET'),
    encryptionKey: await sm.getRequiredSecret('ENCRYPTION_KEY'),
    apiKeySalt: await sm.getSecret('API_KEY_SALT'),
    sentryDsn: await sm.getSecret('SENTRY_DSN'),
    solanaRpcUrl: await sm.getSecret('SOLANA_RPC_URL'),
    jwtExpiresIn: await sm.getSecret('JWT_EXPIRES_IN'),
    jwtRefreshExpiresIn: await sm.getSecret('JWT_REFRESH_EXPIRES_IN'),
    encryptionAlgorithm: await sm.getSecret('ENCRYPTION_ALGORITHM'),
  };

  // Production-time validations for secrets
  if (env.NODE_ENV === 'production') {
    if (secrets.jwtSecret.length < 64) {
      console.error('🚨 JWT_SECRET must be at least 64 characters in production');
      process.exit(1);
    }
    if (secrets.encryptionKey.length < 32) {
      console.error('🚨 ENCRYPTION_KEY must be at least 32 characters in production');
      process.exit(1);
    }
  }

  return secrets;
};

export type SensitiveSecrets = Awaited<ReturnType<typeof loadSensitiveSecrets>>;
