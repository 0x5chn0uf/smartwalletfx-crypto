// Database Migration Utilities
// Tools for managing database schema changes and data migrations

import { Prisma } from '@prisma/client';
import { prisma, dbUtils } from '@/utils/database';
import { logger } from '@/utils/logger';
import type { Migration } from '@/models/interfaces';

// ============================================================================
// MIGRATION REGISTRY
// ============================================================================

export class MigrationRegistry {
  private migrations: Map<string, Migration> = new Map();

  /**
   * Register a migration
   */
  register(migration: Migration): void {
    if (this.migrations.has(migration.id)) {
      throw new Error(`Migration ${migration.id} is already registered`);
    }

    this.migrations.set(migration.id, migration);
    logger.info('Migration registered', {
      id: migration.id,
      name: migration.name,
      version: migration.version,
    });
  }

  /**
   * Get all migrations
   */
  getAll(): Migration[] {
    return Array.from(this.migrations.values()).sort((a, b) => a.version.localeCompare(b.version));
  }

  /**
   * Get migration by ID
   */
  get(id: string): Migration | undefined {
    return this.migrations.get(id);
  }

  /**
   * Check if migration exists
   */
  has(id: string): boolean {
    return this.migrations.has(id);
  }
}

// Global migration registry
export const migrationRegistry = new MigrationRegistry();

// ============================================================================
// MIGRATION EXECUTION
// ============================================================================

export class MigrationRunner {
  /**
   * Run all pending migrations
   */
  static async runPendingMigrations(): Promise<void> {
    logger.info('Starting migration process');

    try {
      // Ensure migration tracking table exists
      await this.ensureMigrationTable();

      // Get applied migrations
      const appliedMigrations = await this.getAppliedMigrations();
      const appliedIds = new Set(appliedMigrations.map(m => m.id));

      // Get all registered migrations
      const allMigrations = migrationRegistry.getAll();

      // Find pending migrations
      const pendingMigrations = allMigrations.filter(m => !appliedIds.has(m.id));

      if (pendingMigrations.length === 0) {
        logger.info('No pending migrations');
        return;
      }

      logger.info(`Found ${pendingMigrations.length} pending migrations`);

      // Run each pending migration
      for (const migration of pendingMigrations) {
        await this.runMigration(migration);
      }

      logger.info('All migrations completed successfully');
    } catch (error) {
      logger.error('Migration process failed', { error });
      throw error;
    }
  }

  /**
   * Run a specific migration
   */
  static async runMigration(migration: Migration): Promise<void> {
    logger.info('Running migration', {
      id: migration.id,
      name: migration.name,
      version: migration.version,
    });

    const startTime = Date.now();

    try {
      await dbUtils.withRetry(async tx => {
        // Run the migration
        await migration.up();

        // Record the migration as applied
        await this.recordMigration(migration);

        // Validate if validation function is provided
        if (migration.validate) {
          const isValid = await migration.validate();
          if (!isValid) {
            throw new Error(`Migration validation failed for ${migration.id}`);
          }
        }
      });

      const duration = Date.now() - startTime;
      logger.info('Migration completed', {
        id: migration.id,
        duration,
      });
    } catch (error) {
      logger.error('Migration failed', {
        id: migration.id,
        error,
      });
      throw error;
    }
  }

  /**
   * Rollback a migration
   */
  static async rollbackMigration(migrationId: string): Promise<void> {
    logger.warn('Rolling back migration', { migrationId });

    const migration = migrationRegistry.get(migrationId);
    if (!migration) {
      throw new Error(`Migration ${migrationId} not found`);
    }

    try {
      await dbUtils.withRetry(async tx => {
        // Run the rollback
        await migration.down();

        // Remove the migration record
        await this.removeMigrationRecord(migrationId);
      });

      logger.warn('Migration rolled back', { migrationId });
    } catch (error) {
      logger.error('Migration rollback failed', {
        migrationId,
        error,
      });
      throw error;
    }
  }

  /**
   * Ensure migration tracking table exists
   */
  private static async ensureMigrationTable(): Promise<void> {
    try {
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS _migrations (
          id VARCHAR(255) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          version VARCHAR(50) NOT NULL,
          description TEXT,
          applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          checksum VARCHAR(255)
        )
      `;
    } catch (error) {
      logger.error('Failed to create migration table', { error });
      throw error;
    }
  }

  /**
   * Get applied migrations
   */
  private static async getAppliedMigrations(): Promise<
    Array<{
      id: string;
      name: string;
      version: string;
      appliedAt: Date;
    }>
  > {
    try {
      const result = (await prisma.$queryRaw`
        SELECT id, name, version, applied_at as "appliedAt"
        FROM _migrations
        ORDER BY applied_at ASC
      `) as any[];

      return result;
    } catch (error) {
      logger.error('Failed to get applied migrations', { error });
      throw error;
    }
  }

  /**
   * Record a migration as applied
   */
  private static async recordMigration(migration: Migration): Promise<void> {
    try {
      await prisma.$executeRaw`
        INSERT INTO _migrations (id, name, version, description)
        VALUES (${migration.id}, ${migration.name}, ${migration.version}, ${migration.description})
      `;
    } catch (error) {
      logger.error('Failed to record migration', {
        migrationId: migration.id,
        error,
      });
      throw error;
    }
  }

  /**
   * Remove migration record
   */
  private static async removeMigrationRecord(migrationId: string): Promise<void> {
    try {
      await prisma.$executeRaw`
        DELETE FROM _migrations WHERE id = ${migrationId}
      `;
    } catch (error) {
      logger.error('Failed to remove migration record', {
        migrationId,
        error,
      });
      throw error;
    }
  }
}

// ============================================================================
// BUILT-IN MIGRATIONS
// ============================================================================

// Initial schema migration
migrationRegistry.register({
  id: 'initial_schema',
  name: 'Initial Schema',
  description: 'Create initial database schema',
  version: '1.0.0',
  up: async () => {
    // This migration is handled by Prisma's initial migration
    logger.info('Initial schema migration - handled by Prisma');
  },
  down: async () => {
    throw new Error('Cannot rollback initial schema migration');
  },
});

// Add full-text search indexes
migrationRegistry.register({
  id: 'add_fulltext_indexes',
  name: 'Add Full-Text Search Indexes',
  description: 'Add full-text search capabilities to tokens and NFTs',
  version: '1.1.0',
  up: async () => {
    try {
      // Add full-text indexes for PostgreSQL
      await prisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS tokens_fulltext_idx 
        ON tokens USING gin(to_tsvector('english', name || ' ' || symbol))
      `;

      await prisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS nft_tokens_fulltext_idx 
        ON nft_tokens USING gin(to_tsvector('english', name || ' ' || description))
      `;

      await prisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS nft_collections_fulltext_idx 
        ON nft_collections USING gin(to_tsvector('english', name || ' ' || symbol || ' ' || description))
      `;

      logger.info('Full-text search indexes created');
    } catch (error) {
      logger.error('Failed to create full-text indexes', { error });
      throw error;
    }
  },
  down: async () => {
    try {
      await prisma.$executeRaw`DROP INDEX IF EXISTS tokens_fulltext_idx`;
      await prisma.$executeRaw`DROP INDEX IF EXISTS nft_tokens_fulltext_idx`;
      await prisma.$executeRaw`DROP INDEX IF EXISTS nft_collections_fulltext_idx`;

      logger.info('Full-text search indexes dropped');
    } catch (error) {
      logger.error('Failed to drop full-text indexes', { error });
      throw error;
    }
  },
  validate: async () => {
    try {
      // Check if indexes exist
      const result = (await prisma.$queryRaw`
        SELECT indexname FROM pg_indexes 
        WHERE indexname IN ('tokens_fulltext_idx', 'nft_tokens_fulltext_idx', 'nft_collections_fulltext_idx')
      `) as any[];

      return result.length === 3;
    } catch {
      return false;
    }
  },
});

// Optimize performance indexes
migrationRegistry.register({
  id: 'optimize_performance_indexes',
  name: 'Optimize Performance Indexes',
  description: 'Add additional indexes for common query patterns',
  version: '1.2.0',
  up: async () => {
    try {
      // Composite indexes for common queries
      await prisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS token_balances_wallet_value_idx 
        ON token_balances (wallet_id, balance_usd DESC) 
        WHERE balance_usd > 0
      `;

      await prisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS defi_positions_wallet_protocol_idx 
        ON defi_positions (wallet_id, protocol, total_value_usd DESC)
      `;

      await prisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS nft_tokens_collection_owner_idx 
        ON nft_tokens (collection_id, owner, last_sale_price_usd DESC)
      `;

      await prisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS transactions_wallet_timestamp_idx 
        ON transactions (wallet_id, timestamp DESC, status)
      `;

      // Partial indexes for active records
      await prisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS user_wallets_active_idx 
        ON user_wallets (address, chain_id) 
        WHERE is_active = true AND is_deleted = false
      `;

      await prisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS tokens_active_idx 
        ON tokens (chain_id, symbol) 
        WHERE is_active = true AND is_deleted = false
      `;

      logger.info('Performance indexes created');
    } catch (error) {
      logger.error('Failed to create performance indexes', { error });
      throw error;
    }
  },
  down: async () => {
    try {
      await prisma.$executeRaw`DROP INDEX IF EXISTS token_balances_wallet_value_idx`;
      await prisma.$executeRaw`DROP INDEX IF EXISTS defi_positions_wallet_protocol_idx`;
      await prisma.$executeRaw`DROP INDEX IF EXISTS nft_tokens_collection_owner_idx`;
      await prisma.$executeRaw`DROP INDEX IF EXISTS transactions_wallet_timestamp_idx`;
      await prisma.$executeRaw`DROP INDEX IF EXISTS user_wallets_active_idx`;
      await prisma.$executeRaw`DROP INDEX IF EXISTS tokens_active_idx`;

      logger.info('Performance indexes dropped');
    } catch (error) {
      logger.error('Failed to drop performance indexes', { error });
      throw error;
    }
  },
});

// ============================================================================
// MIGRATION UTILITIES
// ============================================================================

/**
 * Create a new migration
 */
export const createMigration = (
  id: string,
  name: string,
  description: string,
  version: string,
  up: () => Promise<void>,
  down: () => Promise<void>,
  validate?: () => Promise<boolean>
): Migration => {
  const migration: Migration = {
    id,
    name,
    description,
    version,
    up,
    down,
    validate,
  };

  migrationRegistry.register(migration);
  return migration;
};

/**
 * Get migration status
 */
export const getMigrationStatus = async (): Promise<{
  total: number;
  applied: number;
  pending: number;
  appliedMigrations: Array<{
    id: string;
    name: string;
    version: string;
    appliedAt: Date;
  }>;
  pendingMigrations: Array<{
    id: string;
    name: string;
    version: string;
  }>;
}> => {
  try {
    await MigrationRunner['ensureMigrationTable']();

    const appliedMigrations = await MigrationRunner['getAppliedMigrations']();
    const appliedIds = new Set(appliedMigrations.map(m => m.id));

    const allMigrations = migrationRegistry.getAll();
    const pendingMigrations = allMigrations
      .filter(m => !appliedIds.has(m.id))
      .map(m => ({
        id: m.id,
        name: m.name,
        version: m.version,
      }));

    return {
      total: allMigrations.length,
      applied: appliedMigrations.length,
      pending: pendingMigrations.length,
      appliedMigrations,
      pendingMigrations,
    };
  } catch (error) {
    logger.error('Failed to get migration status', { error });
    throw error;
  }
};

/**
 * Initialize migrations on startup
 */
export const initializeMigrations = async (): Promise<void> => {
  try {
    logger.info('Initializing database migrations');
    await MigrationRunner.runPendingMigrations();
    logger.info('Database migrations initialized');
  } catch (error) {
    logger.error('Failed to initialize migrations', { error });
    throw error;
  }
};

// ============================================================================
// MIGRATION CLI UTILITIES
// ============================================================================

/**
 * Generate migration template
 */
export const generateMigrationTemplate = (name: string): string => {
  const id = `${Date.now()}_${name.toLowerCase().replace(/\s+/g, '_')}`;
  const version = new Date().toISOString().split('T')[0].replace(/-/g, '.');

  return `
// Migration: ${name}
// Generated on: ${new Date().toISOString()}

import { createMigration } from '@/models/migrations';

export const ${name.replace(/\s+/g, '')}Migration = createMigration(
  '${id}',
  '${name}',
  'Description of what this migration does',
  '${version}',
  // Up migration
  async () => {
    // Add your migration logic here
    // Example:
    // await prisma.$executeRaw\`
    //   ALTER TABLE example_table 
    //   ADD COLUMN new_column VARCHAR(255)
    // \`;
  },
  // Down migration
  async () => {
    // Add your rollback logic here
    // Example:
    // await prisma.$executeRaw\`
    //   ALTER TABLE example_table 
    //   DROP COLUMN new_column
    // \`;
  },
  // Optional validation
  async () => {
    // Add validation logic here
    // Return true if migration was applied correctly
    return true;
  }
);
`.trim();
};

export default {
  MigrationRegistry,
  MigrationRunner,
  migrationRegistry,
  createMigration,
  getMigrationStatus,
  initializeMigrations,
  generateMigrationTemplate,
};
