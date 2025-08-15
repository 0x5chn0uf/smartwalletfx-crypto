import { PrismaClient } from '@prisma/client';
import { config } from '@/config';
import { logger } from './logger';

// Prisma client configuration
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: config.database.url,
    },
  },
  log: config.server.isDevelopment
    ? [
        { level: 'query', emit: 'event' },
        { level: 'error', emit: 'event' },
        { level: 'info', emit: 'event' },
        { level: 'warn', emit: 'event' },
      ]
    : [
        { level: 'error', emit: 'event' },
        { level: 'warn', emit: 'event' },
      ],
});

// Enhanced logging for database operations
if (config.server.isDevelopment) {
  prisma.$on('query', e => {
    logger.debug(
      {
        query: e.query,
        params: e.params,
        duration: e.duration,
        target: e.target,
      },
      `Database Query: ${e.duration}ms`
    );
  });
}

prisma.$on('error', e => {
  logger.error(
    {
      message: e.message,
      target: e.target,
    },
    'Database Error'
  );
});

prisma.$on('info', e => {
  logger.info(
    {
      message: e.message,
      target: e.target,
    },
    'Database Info'
  );
});

prisma.$on('warn', e => {
  logger.warn(
    {
      message: e.message,
      target: e.target,
    },
    'Database Warning'
  );
});

// Database utility functions
export const dbUtils = {
  // Health check
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; latency?: number }> {
    try {
      const start = Date.now();
      await prisma.$queryRaw`SELECT 1 as health_check`;
      const latency = Date.now() - start;

      return {
        status: 'healthy',
        latency,
      };
    } catch (error) {
      logger.error('Database health check failed:', { error });
      return {
        status: 'unhealthy',
      };
    }
  },

  // Connection info
  async getConnectionInfo() {
    try {
      const result = (await prisma.$queryRaw`
        SELECT 
          current_database() as database,
          current_user as user,
          version() as version,
          NOW() as current_time
      `) as any[];

      return result[0];
    } catch (error) {
      logger.error('Failed to get database connection info:', { error });
      return null;
    }
  },

  // Performance metrics
  async getPerformanceMetrics() {
    try {
      const activeConnections = (await prisma.$queryRaw`
        SELECT count(*) as active_connections
        FROM pg_stat_activity
        WHERE state = 'active'
      `) as any[];

      const dbSize = (await prisma.$queryRaw`
        SELECT pg_size_pretty(pg_database_size(current_database())) as database_size
      `) as any[];

      return {
        activeConnections: activeConnections[0]?.active_connections,
        databaseSize: dbSize[0]?.database_size,
      };
    } catch (error) {
      logger.error('Failed to get performance metrics:', { error });
      return null;
    }
  },

  // Transaction wrapper with retry logic
  async withRetry<T>(operation: (tx: any) => Promise<T>, maxRetries: number = 3): Promise<T> {
    let attempt = 1;

    while (attempt <= maxRetries) {
      try {
        return await prisma.$transaction(operation, {
          maxWait: 5000, // 5 seconds
          timeout: 30000, // 30 seconds
        });
      } catch (error: any) {
        logger.warn(`Transaction attempt ${attempt} failed:`, {
          error: error.message,
          attempt,
          maxRetries,
        });

        if (attempt === maxRetries || !this.isRetryableError(error)) {
          throw error;
        }

        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
        attempt++;
      }
    }

    throw new Error('Transaction failed after all retry attempts');
  },

  // Check if error is retryable
  isRetryableError(error: any): boolean {
    if (!error.code) return false;

    // PostgreSQL error codes that are typically retryable
    const retryableCodes = [
      '40001', // serialization_failure
      '40P01', // deadlock_detected
      '53000', // insufficient_resources
      '53100', // disk_full
      '53200', // out_of_memory
      '53300', // too_many_connections
    ];

    return retryableCodes.includes(error.code);
  },

  // Bulk operations with batching
  async batchInsert<T>(model: string, data: T[], batchSize: number = 1000): Promise<number> {
    let totalInserted = 0;

    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);

      try {
        const result = await (prisma as any)[model].createMany({
          data: batch,
          skipDuplicates: true,
        });

        totalInserted += result.count || 0;
        logger.debug(`Batch insert: ${result.count || 0} records inserted to ${model}`);
      } catch (error) {
        logger.error(`Batch insert failed for ${model}:`, { error, batchIndex: i / batchSize });
        throw error;
      }
    }

    return totalInserted;
  },

  // Query optimization helpers
  async analyze(table: string): Promise<void> {
    try {
      await prisma.$executeRawUnsafe(`ANALYZE ${table}`);
      logger.info(`Database table ${table} analyzed`);
    } catch (error) {
      logger.error(`Failed to analyze table ${table}:`, { error });
    }
  },

  async vacuum(table: string): Promise<void> {
    try {
      await prisma.$executeRawUnsafe(`VACUUM ANALYZE ${table}`);
      logger.info(`Database table ${table} vacuumed`);
    } catch (error) {
      logger.error(`Failed to vacuum table ${table}:`, { error });
    }
  },
};

// Graceful shutdown handler
process.on('beforeExit', async () => {
  logger.info('Disconnecting from database...');
  await prisma.$disconnect();
});

export { prisma };
export default prisma;
