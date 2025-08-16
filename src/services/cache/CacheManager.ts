import { EventEmitter } from 'events';
import { logger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { config } from '@/config';

export interface CacheItem<T = any> {
  data: T;
  createdAt: number;
  expiresAt: number;
  accessCount: number;
  lastAccessed: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalKeys: number;
  memoryUsage: number;
}

export interface CacheOptions {
  ttl?: number;
  tags?: string[];
  compress?: boolean;
}

/**
 * Simplified Cache Manager
 * 
 * Single-layer Redis cache with basic functionality:
 * - Get/Set with TTL
 * - Simple invalidation
 * - Basic statistics
 * - Memory cache for frequently accessed items
 */
export class CacheManager extends EventEmitter {
  private memoryCache = new Map<string, CacheItem>();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    hitRate: 0,
    totalKeys: 0,
    memoryUsage: 0,
  };

  // Memory cache configuration
  private readonly maxMemoryItems = 1000;
  private readonly memoryTtl = 60000; // 1 minute for memory cache

  constructor() {
    super();
    this.startCleanup();
  }

  /**
   * Get value from cache (memory first, then Redis)
   */
  async get<T>(key: string): Promise<T | null> {
    const startTime = Date.now();

    try {
      // Check memory cache first
      const memoryItem = this.memoryCache.get(key);
      if (memoryItem && memoryItem.expiresAt > Date.now()) {
        memoryItem.accessCount++;
        memoryItem.lastAccessed = Date.now();
        this.stats.hits++;
        this.updateHitRate();

        this.emit('cacheHit', {
          key,
          source: 'memory',
          accessTime: Date.now() - startTime,
        });

        return memoryItem.data as T;
      }

      // Remove expired memory item
      if (memoryItem) {
        this.memoryCache.delete(key);
      }

      // Check Redis cache
      const redisKey = this.buildRedisKey(key);
      const redisItem = await redisManager.get<CacheItem<T>>(redisKey);

      if (redisItem && redisItem.expiresAt > Date.now()) {
        // Update access stats
        redisItem.accessCount++;
        redisItem.lastAccessed = Date.now();
        
        // Store back in Redis with updated stats
        await redisManager.set(redisKey, redisItem, Math.floor((redisItem.expiresAt - Date.now()) / 1000));
        
        // Store in memory cache for faster future access
        this.setMemoryCache(key, redisItem.data, this.memoryTtl);

        this.stats.hits++;
        this.updateHitRate();

        this.emit('cacheHit', {
          key,
          source: 'redis',
          accessTime: Date.now() - startTime,
        });

        return redisItem.data;
      }

      // Cache miss
      this.stats.misses++;
      this.updateHitRate();

      this.emit('cacheMiss', {
        key,
        searchTime: Date.now() - startTime,
      });

      return null;
    } catch (error) {
      logger.error('Cache get error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        key,
      });
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }
  }

  /**
   * Set value in cache (both Redis and memory)
   */
  async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<boolean> {
    try {
      const ttl = options.ttl || config.cache.ttl.medium;
      const now = Date.now();
      const expiresAt = now + (ttl * 1000);

      const cacheItem: CacheItem<T> = {
        data: value,
        createdAt: now,
        expiresAt,
        accessCount: 0,
        lastAccessed: now,
      };

      // Set in Redis
      const redisKey = this.buildRedisKey(key);
      await redisManager.set(redisKey, cacheItem, ttl);

      // Set in memory cache if it's likely to be accessed frequently
      this.setMemoryCache(key, value, Math.min(ttl * 1000, this.memoryTtl));

      this.emit('cacheSet', {
        key,
        ttl,
        size: this.estimateSize(value),
      });

      return true;
    } catch (error) {
      logger.error('Cache set error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        key,
      });
      return false;
    }
  }

  /**
   * Delete value from cache
   */
  async delete(key: string): Promise<boolean> {
    try {
      // Remove from memory cache
      this.memoryCache.delete(key);

      // Remove from Redis
      const redisKey = this.buildRedisKey(key);
      await redisManager.del(redisKey);

      this.emit('cacheDelete', { key });
      return true;
    } catch (error) {
      logger.error('Cache delete error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        key,
      });
      return false;
    }
  }

  /**
   * Invalidate cache by pattern (simplified - exact match only)
   */
  async invalidate(pattern: string): Promise<number> {
    let deleted = 0;

    try {
      // Remove from memory cache
      for (const key of this.memoryCache.keys()) {
        if (key.includes(pattern)) {
          this.memoryCache.delete(key);
          deleted++;
        }
      }

      // Note: Redis pattern deletion would require scanning keys
      // For simplicity, we only handle exact matches here
      const redisKey = this.buildRedisKey(pattern);
      const result = await redisManager.del(redisKey);
      deleted += result;

      this.emit('cacheInvalidate', { pattern, deleted });
      return deleted;
    } catch (error) {
      logger.error('Cache invalidate error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        pattern,
      });
      return 0;
    }
  }

  /**
   * Warm cache with pre-computed values
   */
  async warm(keys: Array<{ key: string; value: any; ttl?: number }>): Promise<void> {
    const warmingPromises = keys.map(({ key, value, ttl }) => 
      this.set(key, value, { ttl })
    );

    await Promise.allSettled(warmingPromises);

    this.emit('cacheWarmed', {
      keys: keys.length,
      timestamp: Date.now(),
    });
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return {
      ...this.stats,
      totalKeys: this.memoryCache.size,
      memoryUsage: this.calculateMemoryUsage(),
    };
  }

  /**
   * Clear all caches
   */
  async clear(): Promise<void> {
    try {
      this.memoryCache.clear();
      // Note: Would need Redis pattern scan to clear all keys
      // For now, just clear memory cache
      
      this.stats = {
        hits: 0,
        misses: 0,
        hitRate: 0,
        totalKeys: 0,
        memoryUsage: 0,
      };

      this.emit('cacheCleared');
    } catch (error) {
      logger.error('Cache clear error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Private helper methods

  private setMemoryCache<T>(key: string, value: T, ttl: number): void {
    // Evict oldest items if we're at capacity
    if (this.memoryCache.size >= this.maxMemoryItems) {
      this.evictOldestMemoryItems(Math.floor(this.maxMemoryItems * 0.1)); // Remove 10%
    }

    const expiresAt = Date.now() + ttl;
    this.memoryCache.set(key, {
      data: value,
      createdAt: Date.now(),
      expiresAt,
      accessCount: 0,
      lastAccessed: Date.now(),
    });
  }

  private evictOldestMemoryItems(count: number): void {
    const entries = Array.from(this.memoryCache.entries())
      .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

    for (let i = 0; i < count && i < entries.length; i++) {
      this.memoryCache.delete(entries[i][0]);
    }
  }

  private buildRedisKey(key: string): string {
    return `${config.redis.keyPrefix}cache:${key}`;
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  private estimateSize(value: any): number {
    try {
      return JSON.stringify(value).length * 2; // Rough UTF-16 estimate
    } catch {
      return 0;
    }
  }

  private calculateMemoryUsage(): number {
    let total = 0;
    for (const item of this.memoryCache.values()) {
      total += this.estimateSize(item);
    }
    return total;
  }

  private startCleanup(): void {
    // Clean expired memory items every 5 minutes
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;

      for (const [key, item] of this.memoryCache.entries()) {
        if (item.expiresAt <= now) {
          this.memoryCache.delete(key);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        logger.debug('Memory cache cleanup', { itemsRemoved: cleaned });
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Stop the cache manager and cleanup resources
   */
  stop(): void {
    this.memoryCache.clear();
    this.removeAllListeners();
    logger.info('Cache manager stopped');
  }
}

// Export singleton instance
let cacheManagerInstance: CacheManager | null = null;

export const getCacheManager = (): CacheManager => {
  if (!cacheManagerInstance) {
    cacheManagerInstance = new CacheManager();
  }
  return cacheManagerInstance;
};

export default getCacheManager;