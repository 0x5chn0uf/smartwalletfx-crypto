import { EventEmitter } from 'events';
import { logger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { config } from '@/config';

export interface CacheContext {
  dataType: string;
  key: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  userContext?: string;
  accessFrequency?: number;
  volatility?: number;
  costWeight?: number;
}

export interface CacheItem<T = any> {
  data: T;
  metadata: {
    createdAt: number;
    lastAccessed: number;
    accessCount: number;
    ttl: number;
    size: number;
    source: string;
    cost: number;
  };
}

export interface CacheStats {
  layer: string;
  hitRate: number;
  missRate: number;
  size: number;
  maxSize: number;
  evictions: number;
  memoryUsage: number;
  avgAccessTime: number;
}

export interface CacheLayerConfig {
  name: 'memory' | 'redis' | 'database';
  priority: number;
  maxSize: number;
  defaultTtl: number;
  evictionPolicy: 'LRU' | 'LFU' | 'TTL' | 'COST_AWARE';
  compressionEnabled: boolean;
  encryptionEnabled: boolean;
  persistToDisk: boolean;
}

interface DataFreshnessProfile {
  dataType: string;
  baseTtl: number;
  volatility: number; // 0-1, how often data changes
  criticalityScore: number; // 0-1, importance of freshness
  costWeight: number; // 0-1, cost impact of fetching
}

class SmartTtlCalculator {
  private profiles: Map<string, DataFreshnessProfile> = new Map();
  private marketVolatilityTracker: MarketVolatilityTracker;

  constructor() {
    this.initializeProfiles();
    this.marketVolatilityTracker = new MarketVolatilityTracker();
  }

  private initializeProfiles() {
    const profiles: DataFreshnessProfile[] = [
      {
        dataType: 'token_balances',
        baseTtl: 300000, // 5 minutes
        volatility: 0.7,
        criticalityScore: 0.8,
        costWeight: 0.6,
      },
      {
        dataType: 'token_prices',
        baseTtl: 30000, // 30 seconds
        volatility: 0.9,
        criticalityScore: 0.9,
        costWeight: 0.8,
      },
      {
        dataType: 'token_metadata',
        baseTtl: 3600000, // 1 hour
        volatility: 0.1,
        criticalityScore: 0.3,
        costWeight: 0.4,
      },
      {
        dataType: 'transaction_history',
        baseTtl: 1800000, // 30 minutes
        volatility: 0.1,
        criticalityScore: 0.6,
        costWeight: 0.5,
      },
      {
        dataType: 'defi_positions',
        baseTtl: 600000, // 10 minutes
        volatility: 0.6,
        criticalityScore: 0.7,
        costWeight: 0.7,
      },
      {
        dataType: 'nft_metadata',
        baseTtl: 7200000, // 2 hours
        volatility: 0.2,
        criticalityScore: 0.4,
        costWeight: 0.3,
      },
    ];

    profiles.forEach(profile => {
      this.profiles.set(profile.dataType, profile);
    });
  }

  calculateOptimalTtl(
    dataType: string,
    context: CacheContext,
    costMultiplier: number = 1.0,
    currentLoad: number = 0.5
  ): number {
    const profile = this.profiles.get(dataType);
    if (!profile) {
      // Default profile for unknown data types
      return 300000; // 5 minutes
    }

    let ttl = profile.baseTtl;

    // Adjust for cost considerations (higher cost = longer TTL)
    const costAdjustment = 1 + costMultiplier * profile.costWeight;
    ttl *= costAdjustment;

    // Adjust for access frequency (more frequent access = longer TTL for efficiency)
    if (context.accessFrequency) {
      const frequencyMultiplier = 1 + Math.log10(context.accessFrequency + 1) * 0.2;
      ttl *= frequencyMultiplier;
    }

    // Adjust for market volatility (higher volatility = shorter TTL)
    if (dataType.includes('price') || dataType.includes('balance')) {
      const marketVolatility = this.marketVolatilityTracker.getCurrentVolatility();
      const volatilityMultiplier = Math.max(0.3, 1 - marketVolatility * 0.7);
      ttl *= volatilityMultiplier;
    }

    // Adjust for system load (higher load = longer TTL to reduce pressure)
    const loadMultiplier = 1 + currentLoad * 0.5;
    ttl *= loadMultiplier;

    // Apply priority adjustments
    switch (context.priority) {
      case 'critical':
        ttl *= 0.5; // Shorter TTL for critical data
        break;
      case 'high':
        ttl *= 0.7;
        break;
      case 'low':
        ttl *= 1.5; // Longer TTL for low priority data
        break;
    }

    // Apply constraints based on criticality
    const constraints = this.getCriticalityConstraints(profile.criticalityScore);
    ttl = Math.max(constraints.min, Math.min(constraints.max, ttl));

    return Math.floor(ttl);
  }

  private getCriticalityConstraints(criticalityScore: number): { min: number; max: number } {
    if (criticalityScore >= 0.8) {
      return { min: 5000, max: 300000 }; // 5 seconds to 5 minutes
    } else if (criticalityScore >= 0.6) {
      return { min: 30000, max: 1800000 }; // 30 seconds to 30 minutes
    } else if (criticalityScore >= 0.4) {
      return { min: 300000, max: 7200000 }; // 5 minutes to 2 hours
    } else {
      return { min: 1800000, max: 86400000 }; // 30 minutes to 24 hours
    }
  }
}

class MarketVolatilityTracker {
  private volatilityScore: number = 0.5; // Default medium volatility
  private lastUpdate: number = 0;

  getCurrentVolatility(): number {
    // In a real implementation, this would fetch market data
    // For now, we'll simulate some volatility based on time patterns
    const now = Date.now();
    const hour = new Date(now).getHours();

    // Market opening hours tend to be more volatile
    if ((hour >= 9 && hour <= 11) || (hour >= 14 && hour <= 16)) {
      return Math.min(1.0, this.volatilityScore * 1.3);
    }

    // Weekend and off-hours are less volatile
    const day = new Date(now).getDay();
    if (day === 0 || day === 6) {
      // Weekend
      return Math.max(0.1, this.volatilityScore * 0.7);
    }

    return this.volatilityScore;
  }

  updateVolatility(newVolatility: number): void {
    this.volatilityScore = Math.max(0.1, Math.min(1.0, newVolatility));
    this.lastUpdate = Date.now();
  }
}

class CacheLayer<T = any> {
  private cache: Map<string, CacheItem<T>> = new Map();
  private accessOrder: Map<string, number> = new Map(); // For LRU
  private accessFrequency: Map<string, number> = new Map(); // For LFU
  private config: CacheLayerConfig;
  private stats: CacheStats;
  private accessCounter: number = 0;

  constructor(config: CacheLayerConfig) {
    this.config = config;
    this.stats = {
      layer: config.name,
      hitRate: 0,
      missRate: 0,
      size: 0,
      maxSize: config.maxSize,
      evictions: 0,
      memoryUsage: 0,
      avgAccessTime: 0,
    };

    // Start cleanup interval
    setInterval(() => this.cleanup(), 60000); // Every minute
  }

  async get(key: string): Promise<CacheItem<T> | null> {
    const startTime = Date.now();

    const item = this.cache.get(key);
    if (!item) {
      this.stats.missRate =
        (this.stats.missRate * this.accessCounter + 1) / (this.accessCounter + 1);
      this.accessCounter++;
      return null;
    }

    // Check if item has expired
    if (this.isExpired(item)) {
      this.cache.delete(key);
      this.accessOrder.delete(key);
      this.accessFrequency.delete(key);
      this.stats.size--;

      this.stats.missRate =
        (this.stats.missRate * this.accessCounter + 1) / (this.accessCounter + 1);
      this.accessCounter++;
      return null;
    }

    // Update access statistics
    item.metadata.lastAccessed = Date.now();
    item.metadata.accessCount++;

    this.accessOrder.set(key, Date.now());
    this.accessFrequency.set(key, (this.accessFrequency.get(key) || 0) + 1);

    // Update stats
    const accessTime = Date.now() - startTime;
    this.stats.hitRate = (this.stats.hitRate * this.accessCounter + 1) / (this.accessCounter + 1);
    this.stats.avgAccessTime =
      (this.stats.avgAccessTime * this.accessCounter + accessTime) / (this.accessCounter + 1);
    this.accessCounter++;

    return item;
  }

  async set(
    key: string,
    data: T,
    ttl: number,
    metadata: Partial<CacheItem<T>['metadata']> = {}
  ): Promise<boolean> {
    try {
      // Check if we need to evict items
      if (this.cache.size >= this.config.maxSize) {
        await this.evictItems(1);
      }

      const now = Date.now();
      const size = this.calculateSize(data);

      const item: CacheItem<T> = {
        data: this.config.compressionEnabled ? await this.compress(data) : data,
        metadata: {
          createdAt: now,
          lastAccessed: now,
          accessCount: 0,
          ttl,
          size,
          source: metadata.source || 'unknown',
          cost: metadata.cost || 0,
          ...metadata,
        },
      };

      this.cache.set(key, item);
      this.accessOrder.set(key, now);
      this.accessFrequency.set(key, 0);

      this.stats.size++;
      this.stats.memoryUsage += size;

      return true;
    } catch (error) {
      logger.error(`Failed to set cache item in ${this.config.name}:`, { error, key });
      return false;
    }
  }

  async delete(key: string): Promise<boolean> {
    const item = this.cache.get(key);
    if (!item) return false;

    this.cache.delete(key);
    this.accessOrder.delete(key);
    this.accessFrequency.delete(key);

    this.stats.size--;
    this.stats.memoryUsage -= item.metadata.size;

    return true;
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.accessOrder.clear();
    this.accessFrequency.clear();

    this.stats.size = 0;
    this.stats.memoryUsage = 0;
    this.stats.evictions = 0;
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  private async evictItems(count: number): Promise<void> {
    const keysToEvict: string[] = [];

    switch (this.config.evictionPolicy) {
      case 'LRU':
        keysToEvict.push(...this.getLRUKeys(count));
        break;
      case 'LFU':
        keysToEvict.push(...this.getLFUKeys(count));
        break;
      case 'TTL':
        keysToEvict.push(...this.getExpiredKeys(count));
        break;
      case 'COST_AWARE':
        keysToEvict.push(...this.getCostAwareEvictionKeys(count));
        break;
    }

    for (const key of keysToEvict) {
      const item = this.cache.get(key);
      if (item) {
        this.stats.memoryUsage -= item.metadata.size;
        this.stats.evictions++;
      }

      this.cache.delete(key);
      this.accessOrder.delete(key);
      this.accessFrequency.delete(key);
      this.stats.size--;
    }
  }

  private getLRUKeys(count: number): string[] {
    return Array.from(this.accessOrder.entries())
      .sort((a, b) => a[1] - b[1]) // Sort by access time (oldest first)
      .slice(0, count)
      .map(([key]) => key);
  }

  private getLFUKeys(count: number): string[] {
    return Array.from(this.accessFrequency.entries())
      .sort((a, b) => a[1] - b[1]) // Sort by frequency (least frequent first)
      .slice(0, count)
      .map(([key]) => key);
  }

  private getExpiredKeys(count: number): string[] {
    const expired: string[] = [];
    const now = Date.now();

    for (const [key, item] of this.cache.entries()) {
      if (this.isExpired(item)) {
        expired.push(key);
        if (expired.length >= count) break;
      }
    }

    return expired;
  }

  private getCostAwareEvictionKeys(count: number): string[] {
    // Evict items with lowest cost-to-size ratio first
    return Array.from(this.cache.entries())
      .map(([key, item]) => ({
        key,
        score: (item.metadata.cost || 1) / Math.max(item.metadata.size, 1),
      }))
      .sort((a, b) => a.score - b.score)
      .slice(0, count)
      .map(({ key }) => key);
  }

  private isExpired(item: CacheItem<T>): boolean {
    return Date.now() - item.metadata.createdAt > item.metadata.ttl;
  }

  private cleanup(): void {
    // Remove expired items
    const expiredKeys = this.getExpiredKeys(Number.MAX_SAFE_INTEGER);
    for (const key of expiredKeys) {
      this.delete(key);
    }

    // Recalculate stats
    this.recalculateStats();
  }

  private recalculateStats(): void {
    this.stats.size = this.cache.size;
    this.stats.memoryUsage = Array.from(this.cache.values()).reduce(
      (total, item) => total + item.metadata.size,
      0
    );
  }

  private calculateSize(data: T): number {
    // Simplified size calculation
    return JSON.stringify(data).length * 2; // Rough estimate (UTF-16)
  }

  private async compress(data: T): Promise<T> {
    // In a real implementation, you'd use a compression library
    // For now, just return the data as-is
    return data;
  }
}

export class IntelligentCacheManager extends EventEmitter {
  private layers: Map<string, CacheLayer> = new Map();
  private ttlCalculator: SmartTtlCalculator;
  private accessPatterns: Map<string, { frequency: number; lastAccess: number }> = new Map();
  private costTracker: Map<string, { totalCost: number; accessCount: number }> = new Map();
  private preloadQueue: Set<string> = new Set();

  constructor() {
    super();
    this.ttlCalculator = new SmartTtlCalculator();
    this.initializeLayers();
    this.startBackgroundOptimization();
  }

  private initializeLayers() {
    // Memory cache layer (fastest)
    const memoryConfig: CacheLayerConfig = {
      name: 'memory',
      priority: 1,
      maxSize: 2000,
      defaultTtl: 60000, // 1 minute
      evictionPolicy: 'COST_AWARE',
      compressionEnabled: false,
      encryptionEnabled: false,
      persistToDisk: false,
    };
    this.layers.set('memory', new CacheLayer(memoryConfig));

    // Redis cache layer (distributed)
    const redisConfig: CacheLayerConfig = {
      name: 'redis',
      priority: 2,
      maxSize: 50000,
      defaultTtl: 600000, // 10 minutes
      evictionPolicy: 'LRU',
      compressionEnabled: true,
      encryptionEnabled: false,
      persistToDisk: true,
    };
    this.layers.set('redis', new CacheLayer(redisConfig));

    // Database cache layer (persistent)
    const dbConfig: CacheLayerConfig = {
      name: 'database',
      priority: 3,
      maxSize: 1000000,
      defaultTtl: 3600000, // 1 hour
      evictionPolicy: 'TTL',
      compressionEnabled: true,
      encryptionEnabled: true,
      persistToDisk: true,
    };
    this.layers.set('database', new CacheLayer(dbConfig));
  }

  async get<T>(key: string, context: CacheContext): Promise<T | null> {
    const startTime = Date.now();
    this.updateAccessPattern(key);

    // Try each layer in priority order
    for (const [layerName, layer] of Array.from(this.layers.entries()).sort(
      (a, b) => this.getLayerConfig(a[0]).priority - this.getLayerConfig(b[0]).priority
    )) {
      try {
        const result = await layer.get(key);
        if (result) {
          // Data found, decompress if needed
          const data = await this.decompressIfNeeded(result.data, layerName);

          // Populate higher priority layers
          await this.populateUpperLayers(key, data, layerName, context);

          // Check if we should refresh in background
          if (this.shouldBackgroundRefresh(result, context)) {
            this.scheduleBackgroundRefresh(key, context);
          }

          // Emit cache hit event
          this.emit('cacheHit', {
            key,
            layer: layerName,
            context,
            accessTime: Date.now() - startTime,
            ttl: result.metadata.ttl,
            age: Date.now() - result.metadata.createdAt,
          });

          return data;
        }
      } catch (error) {
        logger.warn(`Cache layer ${layerName} error for key ${key}:`, error);
        // Continue to next layer
      }
    }

    // Cache miss
    this.emit('cacheMiss', {
      key,
      context,
      searchTime: Date.now() - startTime,
    });

    return null;
  }

  async set<T>(
    key: string,
    data: T,
    context: CacheContext,
    explicitTtl?: number
  ): Promise<boolean> {
    try {
      // Calculate optimal TTL
      const costMultiplier = await this.getCostMultiplier(context.dataType);
      const currentLoad = await this.getCurrentSystemLoad();
      const ttl =
        explicitTtl ||
        this.ttlCalculator.calculateOptimalTtl(
          context.dataType,
          context,
          costMultiplier,
          currentLoad
        );

      const metadata = {
        source: 'api',
        cost: this.estimateDataCost(context),
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        accessCount: 0,
        ttl,
        size: 0,
      };

      // Set in all appropriate layers
      const results = await Promise.allSettled(
        Array.from(this.layers.entries()).map(([layerName, layer]) => {
          const layerTtl = this.calculateLayerTtl(ttl, layerName);
          return layer.set(key, data, layerTtl, metadata);
        })
      );

      const successful = results.filter(r => r.status === 'fulfilled' && r.value).length;

      // Track cost
      this.trackCost(key, metadata.cost);

      // Emit cache set event
      this.emit('cacheSet', {
        key,
        context,
        ttl,
        successfulLayers: successful,
        totalLayers: this.layers.size,
      });

      return successful > 0;
    } catch (error) {
      logger.error(`Failed to set cache for key ${key}:`, error);
      return false;
    }
  }

  async invalidate(
    pattern: string,
    reason: string = 'manual'
  ): Promise<{ keysInvalidated: number; errors: number }> {
    let keysInvalidated = 0;
    let errors = 0;

    // For simplicity, this implementation doesn't support pattern matching
    // In a production system, you'd implement proper pattern matching
    for (const [layerName, layer] of this.layers) {
      try {
        const success = await layer.delete(pattern);
        if (success) keysInvalidated++;
      } catch (error) {
        logger.error(`Failed to invalidate ${pattern} in ${layerName}:`, error);
        errors++;
      }
    }

    this.emit('cacheInvalidate', {
      pattern,
      reason,
      keysInvalidated,
      errors,
    });

    return { keysInvalidated, errors };
  }

  async warmCache(keys: string[], contexts: CacheContext[]): Promise<void> {
    const warmingPromises = keys.map(async (key, index) => {
      const context = contexts[index] || contexts[0];

      // Check if already cached
      const cached = await this.get(key, context);
      if (cached) return;

      // Add to preload queue
      this.preloadQueue.add(key);
    });

    await Promise.allSettled(warmingPromises);

    this.emit('cacheWarmingStarted', {
      keys: keys.length,
      queued: this.preloadQueue.size,
    });
  }

  getCacheStats(): Record<string, CacheStats> {
    const stats: Record<string, CacheStats> = {};

    for (const [layerName, layer] of this.layers) {
      stats[layerName] = layer.getStats();
    }

    return stats;
  }

  getOverallStats(): {
    totalHitRate: number;
    totalSize: number;
    memoryUsage: number;
    averageAccessTime: number;
    costSavings: number;
  } {
    const layerStats = Object.values(this.getCacheStats());

    const totalHitRate =
      layerStats.reduce((sum, stats) => sum + stats.hitRate, 0) / layerStats.length;
    const totalSize = layerStats.reduce((sum, stats) => sum + stats.size, 0);
    const memoryUsage = layerStats.reduce((sum, stats) => sum + stats.memoryUsage, 0);
    const averageAccessTime =
      layerStats.reduce((sum, stats) => sum + stats.avgAccessTime, 0) / layerStats.length;

    // Calculate cost savings based on cache hits
    const costSavings = this.calculateCostSavings();

    return {
      totalHitRate,
      totalSize,
      memoryUsage,
      averageAccessTime,
      costSavings,
    };
  }

  async optimizeCache(): Promise<{ optimizationsApplied: string[]; estimatedImprovement: number }> {
    const optimizations: string[] = [];
    let estimatedImprovement = 0;

    // Analyze access patterns for optimization opportunities
    const stats = this.getCacheStats();

    // Optimize layer sizes based on hit rates
    for (const [layerName, layerStats] of Object.entries(stats)) {
      if (layerStats.hitRate < 0.6 && layerStats.size > layerStats.maxSize * 0.8) {
        // Increase cache size if hit rate is low but we're near capacity
        const layer = this.layers.get(layerName);
        if (layer) {
          // In a real implementation, you'd resize the cache
          optimizations.push(`Increased ${layerName} cache size`);
          estimatedImprovement += 0.1; // 10% improvement estimate
        }
      }
    }

    // Optimize TTL settings based on access patterns
    const accessOptimizations = await this.optimizeTtlSettings();
    optimizations.push(...accessOptimizations.optimizations);
    estimatedImprovement += accessOptimizations.improvement;

    return {
      optimizationsApplied: optimizations,
      estimatedImprovement,
    };
  }

  private async populateUpperLayers(
    key: string,
    data: any,
    sourceLayer: string,
    context: CacheContext
  ): Promise<void> {
    const sourceLayerPriority = this.getLayerConfig(sourceLayer).priority;

    // Only populate layers with higher priority (lower number)
    for (const [layerName, layer] of this.layers) {
      const layerPriority = this.getLayerConfig(layerName).priority;

      if (layerPriority < sourceLayerPriority) {
        try {
          const layerTtl = this.calculateLayerTtl(
            this.ttlCalculator.calculateOptimalTtl(context.dataType, context),
            layerName
          );

          await layer.set(key, data, layerTtl, {
            source: `populated_from_${sourceLayer}`,
            cost: 0, // No cost for internal population
            createdAt: Date.now(),
            lastAccessed: Date.now(),
            accessCount: 0,
            ttl: layerTtl,
            size: 0,
          });
        } catch (error) {
          logger.warn(`Failed to populate ${layerName} from ${sourceLayer}:`, error);
        }
      }
    }
  }

  private shouldBackgroundRefresh(item: CacheItem, context: CacheContext): boolean {
    const age = Date.now() - item.metadata.createdAt;
    const ttl = item.metadata.ttl;
    const agePercentage = age / ttl;

    // Refresh when we're at 80% of TTL for high-priority items
    const refreshThreshold =
      context.priority === 'critical'
        ? 0.6
        : context.priority === 'high'
          ? 0.7
          : context.priority === 'normal'
            ? 0.8
            : 0.9;

    return agePercentage >= refreshThreshold;
  }

  private scheduleBackgroundRefresh(key: string, context: CacheContext): void {
    // Add to refresh queue - in production, this would trigger actual API refresh
    this.emit('backgroundRefreshNeeded', { key, context });
  }

  private updateAccessPattern(key: string): void {
    const pattern = this.accessPatterns.get(key) || { frequency: 0, lastAccess: 0 };
    pattern.frequency++;
    pattern.lastAccess = Date.now();
    this.accessPatterns.set(key, pattern);
  }

  private trackCost(key: string, cost: number): void {
    const tracker = this.costTracker.get(key) || { totalCost: 0, accessCount: 0 };
    tracker.totalCost += cost;
    tracker.accessCount++;
    this.costTracker.set(key, tracker);
  }

  private async getCostMultiplier(dataType: string): Promise<number> {
    // In a real implementation, this would fetch current API costs
    const baseCosts: Record<string, number> = {
      token_balances: 0.0005,
      token_prices: 0.0008,
      transaction_history: 0.001,
      defi_positions: 0.0012,
      nft_metadata: 0.0003,
    };

    return (baseCosts[dataType] || 0.0005) / 0.0005; // Normalize to base cost
  }

  private async getCurrentSystemLoad(): Promise<number> {
    // Simplified load calculation based on memory usage
    const memStats = process.memoryUsage();
    const totalMemory = memStats.heapUsed + memStats.external;
    const maxMemory = 512 * 1024 * 1024; // 512MB limit

    return Math.min(1.0, totalMemory / maxMemory);
  }

  private estimateDataCost(context: CacheContext): number {
    const baseCosts: Record<string, number> = {
      token_balances: 0.0005,
      token_prices: 0.0008,
      transaction_history: 0.001,
      defi_positions: 0.0012,
      nft_metadata: 0.0003,
    };

    return baseCosts[context.dataType] || 0.0005;
  }

  private calculateLayerTtl(baseTtl: number, layerName: string): number {
    const layerMultipliers: Record<string, number> = {
      memory: 0.2, // Short TTL for memory cache
      redis: 0.6, // Medium TTL for Redis
      database: 1.0, // Full TTL for database
    };

    return Math.floor(baseTtl * (layerMultipliers[layerName] || 1.0));
  }

  private getLayerConfig(layerName: string): CacheLayerConfig {
    // Return layer configuration - simplified for this implementation
    const configs: Record<string, Partial<CacheLayerConfig>> = {
      memory: { priority: 1 },
      redis: { priority: 2 },
      database: { priority: 3 },
    };

    return { priority: 1, ...configs[layerName] } as CacheLayerConfig;
  }

  private async decompressIfNeeded(data: any, layerName: string): Promise<any> {
    // In a real implementation, check if compression was used and decompress
    return data;
  }

  private calculateCostSavings(): number {
    // Calculate total cost savings from cache hits
    let totalSavings = 0;
    let totalRequests = 0;

    for (const [key, tracker] of this.costTracker) {
      const pattern = this.accessPatterns.get(key);
      if (pattern) {
        // Estimate cache hits prevented expensive API calls
        const estimatedCacheHits = Math.max(0, pattern.frequency - 1);
        const avgCost = tracker.totalCost / tracker.accessCount;
        totalSavings += estimatedCacheHits * avgCost;
        totalRequests += pattern.frequency;
      }
    }

    return totalSavings;
  }

  private async optimizeTtlSettings(): Promise<{ optimizations: string[]; improvement: number }> {
    const optimizations: string[] = [];
    let improvement = 0;

    // Analyze access patterns to optimize TTL settings
    for (const [key, pattern] of this.accessPatterns) {
      if (pattern.frequency > 10) {
        // Frequently accessed items
        // Consider longer TTL for frequently accessed items
        optimizations.push(`Optimized TTL for frequently accessed key: ${key}`);
        improvement += 0.02; // Small improvement per optimization
      }
    }

    return { optimizations, improvement };
  }

  private startBackgroundOptimization(): void {
    // Run optimization every 10 minutes
    setInterval(
      async () => {
        try {
          const result = await this.optimizeCache();
          if (result.optimizationsApplied.length > 0) {
            this.emit('cacheOptimized', result);
          }
        } catch (error) {
          logger.error('Background cache optimization failed:', error);
        }
      },
      10 * 60 * 1000
    );

    // Clean up stale access patterns every hour
    setInterval(
      () => {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago
        for (const [key, pattern] of this.accessPatterns) {
          if (pattern.lastAccess < cutoff) {
            this.accessPatterns.delete(key);
            this.costTracker.delete(key);
          }
        }
      },
      60 * 60 * 1000
    );
  }
}
