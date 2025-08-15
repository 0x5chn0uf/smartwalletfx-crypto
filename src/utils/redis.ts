import { createClient, RedisClientType } from 'redis';
import { config } from '@/config';
import { logger } from './logger';
import { recordCacheEvent } from '@/utils/metrics';

class RedisManager {
  private static instance: RedisManager;
  private client: RedisClientType;
  private isConnected = false;

  private constructor() {
    this.client = createClient({
      url: config.redis.url,
      socket: {
        connectTimeout: 10000,
        reconnectStrategy: retries => {
          if (retries > 10) {
            logger.error('Redis: Max reconnection attempts reached');
            return false;
          }
          const delay = Math.min(retries * 50, 2000);
          logger.warn(`Redis: Reconnecting in ${delay}ms (attempt ${retries})`);
          return delay;
        },
      },
    });

    this.setupEventHandlers();
  }

  public static getInstance(): RedisManager {
    if (!RedisManager.instance) {
      RedisManager.instance = new RedisManager();
    }
    return RedisManager.instance;
  }

  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      logger.info('Redis: Connection established');
    });

    this.client.on('ready', () => {
      this.isConnected = true;
      logger.info('Redis: Client ready');
    });

    this.client.on('error', error => {
      this.isConnected = false;
      logger.error('Redis: Connection error', { error: error.message });
    });

    this.client.on('end', () => {
      this.isConnected = false;
      logger.info('Redis: Connection closed');
    });

    this.client.on('reconnecting', () => {
      logger.info('Redis: Reconnecting...');
    });
  }

  public async connect(): Promise<void> {
    if (!this.isConnected) {
      await this.client.connect();
    }
  }

  public async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.client.disconnect();
    }
  }

  /**
   * Gracefully quit the Redis connection
   * Called during application shutdown
   */
  public async quit(): Promise<void> {
    try {
      if (this.isConnected || this.client.isOpen) {
        logger.info('Redis: Starting graceful shutdown...');
        await this.client.quit();
        this.isConnected = false;
        logger.info('Redis: Graceful shutdown completed');
      } else {
        logger.debug('Redis: Already disconnected, skipping quit');
      }
    } catch (error) {
      logger.error('Redis: Error during graceful shutdown:', { error });
      // Force disconnect if quit fails
      try {
        await this.client.disconnect();
        this.isConnected = false;
      } catch (disconnectError) {
        logger.error('Redis: Error during forced disconnect:', { error: disconnectError });
      }
      throw error;
    }
  }

  public getClient(): RedisClientType {
    return this.client;
  }

  public async ping(): Promise<string> {
    return await this.client.ping();
  }

  // Caching utilities
  public async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);
      const hit = !!value;
      recordCacheEvent(hit, 'redis');
      return hit ? JSON.parse(value as string) : null;
    } catch (error) {
      logger.error(`Redis GET error for key ${key}:`, { error });
      return null;
    }
  }

  public async set<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
    try {
      const serialized = JSON.stringify(value);

      if (ttlSeconds) {
        await this.client.setEx(key, ttlSeconds, serialized);
      } else {
        await this.client.set(key, serialized);
      }

      return true;
    } catch (error) {
      logger.error(`Redis SET error for key ${key}:`, { error });
      return false;
    }
  }

  public async del(key: string): Promise<boolean> {
    try {
      const result = await this.client.del(key);
      return result > 0;
    } catch (error) {
      logger.error(`Redis DEL error for key ${key}:`, { error });
      return false;
    }
  }

  public async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error(`Redis EXISTS error for key ${key}:`, { error });
      return false;
    }
  }

  public async mget<T>(keys: string[]): Promise<Array<T | null>> {
    try {
      const values = await this.client.mGet(keys);
      return values.map(value => (value ? JSON.parse(value) : null));
    } catch (error) {
      logger.error(`Redis MGET error for keys ${keys.join(', ')}:`, { error });
      return keys.map(() => null);
    }
  }

  public async mset<T>(
    keyValuePairs: Array<{ key: string; value: T; ttl?: number }>
  ): Promise<boolean> {
    try {
      const pipeline = this.client.multi();

      keyValuePairs.forEach(({ key, value, ttl }) => {
        const serialized = JSON.stringify(value);
        if (ttl) {
          pipeline.setEx(key, ttl, serialized);
        } else {
          pipeline.set(key, serialized);
        }
      });

      await pipeline.exec();
      return true;
    } catch (error) {
      logger.error('Redis MSET error:', { error });
      return false;
    }
  }

  // Pattern-based operations
  public async keys(pattern: string): Promise<string[]> {
    try {
      return await this.client.keys(pattern);
    } catch (error) {
      logger.error(`Redis KEYS error for pattern ${pattern}:`, { error });
      return [];
    }
  }

  public async flushPattern(pattern: string): Promise<number> {
    try {
      const keys = await this.keys(pattern);
      if (keys.length === 0) return 0;

      const result = await this.client.del(keys);
      logger.info(`Redis: Flushed ${result} keys matching pattern ${pattern}`);
      return result;
    } catch (error) {
      logger.error(`Redis flush pattern error for ${pattern}:`, { error });
      return 0;
    }
  }

  // Cache with automatic TTL management
  public async cacheWithTTL<T>(
    key: string,
    fetchFunction: () => Promise<T>,
    ttlSeconds: number
  ): Promise<T> {
    // Try to get from cache first
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // If not in cache, fetch and store
    const fresh = await fetchFunction();
    await this.set(key, fresh, ttlSeconds);
    return fresh;
  }

  // Health check
  public async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; latency?: number }> {
    try {
      const start = Date.now();
      await this.ping();
      const latency = Date.now() - start;

      return {
        status: 'healthy',
        latency,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
      };
    }
  }
}

// Export singleton instance (connection is owned by the app lifecycle)
export const redisManager = RedisManager.getInstance();
export const redisClient = redisManager.getClient();

export default redisManager;
