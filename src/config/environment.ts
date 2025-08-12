import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

// Validation schema for environment variables
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  HOST: z.string().default('0.0.0.0'),

  // Database
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // API Keys
  ALCHEMY_API_KEY: z.string().min(1),
  MORALIS_API_KEY: z.string().min(1).optional(),
  QUICKNODE_API_KEY: z.string().min(1).optional(),
  ANKR_API_KEY: z.string().min(1).optional(),
  HELIUS_API_KEY: z.string().min(1).optional(),

  // RPC URLs
  ETHEREUM_RPC_URL: z.string().url(),
  POLYGON_RPC_URL: z.string().url().optional(),
  ARBITRUM_RPC_URL: z.string().url().optional(),
  OPTIMISM_RPC_URL: z.string().url().optional(),
  BASE_RPC_URL: z.string().url().optional(),

  // Security
  JWT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(32),

  // Rate Limiting
  RATE_LIMIT_WINDOW: z.string().transform(Number).default('15'),
  RATE_LIMIT_MAX: z.string().transform(Number).default('100'),

  // Caching
  CACHE_TTL_SHORT: z.string().transform(Number).default('300'),
  CACHE_TTL_MEDIUM: z.string().transform(Number).default('3600'),
  CACHE_TTL_LONG: z.string().transform(Number).default('86400'),

  // Monitoring
  ENABLE_METRICS: z.string().transform(v => v === 'true').default('true'),
  METRICS_PORT: z.string().transform(Number).default('9090'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  // Cost Management
  MONTHLY_API_BUDGET: z.string().transform(Number).default('200'),
  COST_ALERT_THRESHOLD: z.string().transform(Number).default('150'),
  ENABLE_COST_TRACKING: z.string().transform(v => v === 'true').default('true'),
});

// Parse and validate environment variables
const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsedEnv.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsedEnv.data;

// Export configuration object
export const config = {
  server: {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    isDevelopment: env.NODE_ENV === 'development',
    isProduction: env.NODE_ENV === 'production',
  },

  database: {
    url: env.DATABASE_URL,
  },

  redis: {
    url: env.REDIS_URL,
  },

  apiKeys: {
    alchemy: env.ALCHEMY_API_KEY,
    moralis: env.MORALIS_API_KEY,
    quicknode: env.QUICKNODE_API_KEY,
    ankr: env.ANKR_API_KEY,
    helius: env.HELIUS_API_KEY,
  },

  rpcUrls: {
    ethereum: env.ETHEREUM_RPC_URL,
    polygon: env.POLYGON_RPC_URL,
    arbitrum: env.ARBITRUM_RPC_URL,
    optimism: env.OPTIMISM_RPC_URL,
    base: env.BASE_RPC_URL,
  },

  security: {
    jwtSecret: env.JWT_SECRET,
    encryptionKey: env.ENCRYPTION_KEY,
  },

  rateLimit: {
    window: env.RATE_LIMIT_WINDOW,
    max: env.RATE_LIMIT_MAX,
  },

  cache: {
    ttl: {
      short: env.CACHE_TTL_SHORT,
      medium: env.CACHE_TTL_MEDIUM,
      long: env.CACHE_TTL_LONG,
    },
  },

  cors: {
    origins: env.NODE_ENV === 'production' 
      ? ['https://app.smartwalletfx.com', 'https://smartwalletfx.com']
      : ['http://localhost:3000', 'http://localhost:3001'],
  },

  metrics: {
    enabled: env.ENABLE_METRICS,
    port: env.METRICS_PORT,
  },

  logging: {
    level: env.LOG_LEVEL,
  },

  costs: {
    monthlyBudget: env.MONTHLY_API_BUDGET,
    alertThreshold: env.COST_ALERT_THRESHOLD,
    trackingEnabled: env.ENABLE_COST_TRACKING,
  },

  // Chain configuration
  chains: {
    ethereum: {
      id: 1,
      name: 'Ethereum',
      rpcUrl: env.ETHEREUM_RPC_URL,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    },
    polygon: {
      id: 137,
      name: 'Polygon',
      rpcUrl: env.POLYGON_RPC_URL,
      nativeCurrency: { name: 'Matic', symbol: 'MATIC', decimals: 18 },
    },
    arbitrum: {
      id: 42161,
      name: 'Arbitrum One',
      rpcUrl: env.ARBITRUM_RPC_URL,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    },
    optimism: {
      id: 10,
      name: 'Optimism',
      rpcUrl: env.OPTIMISM_RPC_URL,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    },
    base: {
      id: 8453,
      name: 'Base',
      rpcUrl: env.BASE_RPC_URL,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    },
  },
} as const;

// Type exports
export type Config = typeof config;
export type ChainId = keyof typeof config.chains;