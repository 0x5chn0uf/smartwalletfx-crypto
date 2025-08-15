import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load environment variables (default + optional .env.local)
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Helpers
export const stringToBoolean = (value: string) => value.toLowerCase() === 'true';
export const parseCommaSeparated = (value: string) =>
  value ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];

// Validation schema for environment variables
export const envSchema = z.object({
  // Server Configuration
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  HOST: z.string().default('0.0.0.0'),
  SERVER_TIMEOUT: z.string().transform(Number).default('30000'),
  BODY_LIMIT: z.string().default('10mb'),

  // Database Configuration
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_SIZE: z.string().transform(Number).default('10'),
  DATABASE_TIMEOUT: z.string().transform(Number).default('60000'),
  DATABASE_SSL: z.string().transform(stringToBoolean).default('false'),

  // Redis Configuration
  REDIS_URL: z.string().url(),
  REDIS_MAX_RETRIES: z.string().transform(Number).default('3'),
  REDIS_RETRY_DELAY: z.string().transform(Number).default('1000'),
  REDIS_COMMAND_TIMEOUT: z.string().transform(Number).default('5000'),
  REDIS_MAX_MEMORY: z.string().default('512mb'),
  REDIS_KEY_PREFIX: z.string().default('smartwallet:crypto:'),

  // Primary API Keys (Required)
  ALCHEMY_API_KEY: z.string().min(1),

  // Secondary API Keys (Optional)
  MORALIS_API_KEY: z.string().min(1).optional(),
  QUICKNODE_API_KEY: z.string().min(1).optional(),
  ANKR_API_KEY: z.string().min(1).optional(),
  HELIUS_API_KEY: z.string().min(1).optional(),
  INFURA_API_KEY: z.string().min(1).optional(),

  // NFT Marketplace APIs
  OPENSEA_API_KEY: z.string().min(1).optional(),
  MAGIC_EDEN_API_KEY: z.string().min(1).optional(),
  RESERVOIR_API_KEY: z.string().min(1).optional(),
  NFTGO_API_KEY: z.string().min(1).optional(),

  // DeFi Data Providers
  DEFI_LLAMA_API_KEY: z.string().min(1).optional(),
  COINGECKO_API_KEY: z.string().min(1).optional(),
  DUNE_API_KEY: z.string().min(1).optional(),
  THE_GRAPH_API_KEY: z.string().min(1).optional(),

  // Blockchain RPC URLs
  ETHEREUM_RPC_URL: z.string().url(),
  POLYGON_RPC_URL: z.string().url().optional(),
  ARBITRUM_RPC_URL: z.string().url().optional(),
  OPTIMISM_RPC_URL: z.string().url().optional(),
  BASE_RPC_URL: z.string().url().optional(),
  BSC_RPC_URL: z.string().url().optional(),
  AVALANCHE_RPC_URL: z.string().url().optional(),
  FANTOM_RPC_URL: z.string().url().optional(),

  // Solana
  SOLANA_RPC_URL: z.string().url().optional(),
  SOLANA_COMMITMENT: z.enum(['processed', 'confirmed', 'finalized']).default('confirmed'),

  // Security
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('24h'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  ENCRYPTION_KEY: z.string().min(32),
  ENCRYPTION_ALGORITHM: z.string().default('aes-256-gcm'),
  API_KEY_SALT: z.string().min(16).optional(),

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
  SENTRY_DSN: z.string().url().optional(),
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
  Object.entries(fieldErrors).forEach(([field, errors]) => console.error(`  ${field}: ${errors?.join(', ')}`));
  process.exit(1);
}

export const env = parsed.data;

// Additional production-time validations
if (env.NODE_ENV === 'production') {
  const required = ['JWT_SECRET', 'ENCRYPTION_KEY', 'DATABASE_URL', 'REDIS_URL'] as const;
  const missing = required.filter((key) => {
    const v = (env as any)[key];
    return !v || (typeof v === 'string' && v.length === 0);
  });
  if (missing.length > 0) {
    console.error('🚨 Production deployment requires these fields:');
    missing.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }
  if (env.JWT_SECRET.length < 64) {
    console.error('🚨 JWT_SECRET must be at least 64 characters in production');
    process.exit(1);
  }
  if (env.ENCRYPTION_KEY.length < 32) {
    console.error('🚨 ENCRYPTION_KEY must be at least 32 characters in production');
    process.exit(1);
  }
}
