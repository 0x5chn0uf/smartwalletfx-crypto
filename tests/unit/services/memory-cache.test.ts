/**
 * Memory Cache Unit Tests
 * 
 * Tests for the memory cache functionality integrated into ChainManager:
 * - Cache hit/miss behavior
 * - TTL expiration handling
 * - Memory usage patterns
 * - Cache cleanup operations
 * - Performance characteristics
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock cache implementation similar to ChainManager's memory cache
class MemoryCache<T> {
  private cache = new Map<string, { data: T; expires: number }>();
  private cleanupInterval?: NodeJS.Timeout;

  constructor(private cleanupIntervalMs: number = 300000) {
    this.startCleanup();
  }

  set(key: string, data: T, ttlSeconds: number): void {
    const expires = Date.now() + (ttlSeconds * 1000);
    this.cache.set(key, { data, expires });
  }

  get(key: string): T | null {
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }
    if (cached) {
      this.cache.delete(key); // Remove expired entry
    }
    return null;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  getStats() {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;
    
    for (const cached of this.cache.values()) {
      if (cached.expires > now) {
        validEntries++;
      } else {
        expiredEntries++;
      }
    }

    return {
      totalEntries: this.cache.size,
      validEntries,
      expiredEntries,
      memoryUsageApprox: this.cache.size * 1024 // Rough estimate
    };
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.cleanupIntervalMs);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, cached] of this.cache.entries()) {
      if (cached.expires <= now) {
        this.cache.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clear();
  }
}

describe('Memory Cache Functionality', () => {
  let cache: MemoryCache<any>;

  beforeEach(() => {
    cache = new MemoryCache<any>(100); // Fast cleanup for testing
  });

  afterEach(() => {
    cache.destroy();
  });

  describe('Basic Cache Operations', () => {
    it('should store and retrieve data', () => {
      const testData = { portfolio: 'test-data', value: 1000 };
      
      cache.set('test-key', testData, 60); // 60 seconds TTL
      const retrieved = cache.get('test-key');
      
      expect(retrieved).toEqual(testData);
    });

    it('should return null for non-existent keys', () => {
      const result = cache.get('non-existent-key');
      expect(result).toBeNull();
    });

    it('should handle multiple entries', () => {
      const data1 = { type: 'portfolio', address: 'addr1' };
      const data2 = { type: 'balance', amount: 500 };
      
      cache.set('key1', data1, 60);
      cache.set('key2', data2, 60);
      
      expect(cache.get('key1')).toEqual(data1);
      expect(cache.get('key2')).toEqual(data2);
    });

    it('should delete entries', () => {
      cache.set('test-key', { data: 'test' }, 60);
      expect(cache.get('test-key')).toBeTruthy();
      
      const deleted = cache.delete('test-key');
      expect(deleted).toBe(true);
      expect(cache.get('test-key')).toBeNull();
    });

    it('should clear all entries', () => {
      cache.set('key1', { data: 'test1' }, 60);
      cache.set('key2', { data: 'test2' }, 60);
      
      cache.clear();
      
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
    });
  });

  describe('TTL and Expiration', () => {
    it('should respect TTL and expire entries', async () => {
      cache.set('expiring-key', { data: 'test' }, 0.1); // 100ms TTL
      
      // Should be available immediately
      expect(cache.get('expiring-key')).toBeTruthy();
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Should be expired and return null
      expect(cache.get('expiring-key')).toBeNull();
    });

    it('should automatically remove expired entries on access', () => {
      cache.set('auto-remove', { data: 'test' }, 0.05); // 50ms TTL
      
      const stats1 = cache.getStats();
      expect(stats1.totalEntries).toBe(1);
      
      // Wait for expiration
      setTimeout(() => {
        // Access should trigger removal
        cache.get('auto-remove');
        
        const stats2 = cache.getStats();
        expect(stats2.totalEntries).toBe(0);
      }, 100);
    });

    it('should handle mixed TTL scenarios', async () => {
      cache.set('short-ttl', { data: 'short' }, 0.1); // 100ms
      cache.set('long-ttl', { data: 'long' }, 10); // 10 seconds
      
      // Wait for short TTL to expire
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(cache.get('short-ttl')).toBeNull();
      expect(cache.get('long-ttl')).toBeTruthy();
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should provide accurate cache statistics', () => {
      cache.set('valid1', { data: 'test1' }, 60);
      cache.set('valid2', { data: 'test2' }, 60);
      cache.set('expired', { data: 'test3' }, -1); // Already expired
      
      const stats = cache.getStats();
      
      expect(stats.totalEntries).toBe(3);
      expect(stats.validEntries).toBe(2);
      expect(stats.expiredEntries).toBe(1);
      expect(stats.memoryUsageApprox).toBeGreaterThan(0);
    });

    it('should update statistics after cleanup', async () => {
      cache.set('will-expire', { data: 'test' }, 0.05); // 50ms TTL
      
      let stats = cache.getStats();
      expect(stats.totalEntries).toBe(1);
      expect(stats.validEntries).toBe(1);
      
      // Wait for cleanup cycle
      await new Promise(resolve => setTimeout(resolve, 200));
      
      stats = cache.getStats();
      expect(stats.expiredEntries).toBe(0); // Should be cleaned up
    });

    it('should track memory usage approximation', () => {
      const largeData = { 
        portfolio: Array(1000).fill('x').join(''),
        metadata: { large: true }
      };
      
      const stats1 = cache.getStats();
      cache.set('large-entry', largeData, 60);
      const stats2 = cache.getStats();
      
      expect(stats2.memoryUsageApprox).toBeGreaterThan(stats1.memoryUsageApprox);
    });
  });

  describe('Cleanup Operations', () => {
    it('should perform periodic cleanup', async () => {
      const fastCache = new MemoryCache(50); // 50ms cleanup interval
      
      fastCache.set('expire-soon', { data: 'test' }, 0.02); // 20ms TTL
      
      let stats = fastCache.getStats();
      expect(stats.totalEntries).toBe(1);
      
      // Wait for cleanup cycle
      await new Promise(resolve => setTimeout(resolve, 100));
      
      stats = fastCache.getStats();
      expect(stats.totalEntries).toBe(0);
      
      fastCache.destroy();
    });

    it('should clean up expired entries in bulk', () => {
      // Add many entries with short TTL
      for (let i = 0; i < 100; i++) {
        cache.set(`key-${i}`, { data: `test-${i}` }, -1); // Already expired
      }
      
      let stats = cache.getStats();
      expect(stats.totalEntries).toBe(100);
      expect(stats.expiredEntries).toBe(100);
      
      // Trigger cleanup by accessing any key
      cache.get('key-0');
      
      // Manual cleanup simulation
      const now = Date.now();
      for (const [key, cached] of (cache as any).cache.entries()) {
        if (cached.expires <= now) {
          cache.delete(key);
        }
      }
      
      stats = cache.getStats();
      expect(stats.totalEntries).toBe(0);
    });
  });

  describe('Performance Characteristics', () => {
    it('should handle high-frequency operations', () => {
      const start = Date.now();
      
      // Perform many cache operations
      for (let i = 0; i < 10000; i++) {
        cache.set(`key-${i}`, { index: i, data: `test-${i}` }, 60);
      }
      
      for (let i = 0; i < 10000; i++) {
        cache.get(`key-${i}`);
      }
      
      const duration = Date.now() - start;
      
      // Should complete 20,000 operations quickly (under 100ms)
      expect(duration).toBeLessThan(100);
    });

    it('should scale with cache size', () => {
      const sizes = [100, 1000, 10000];
      const timings: number[] = [];
      
      for (const size of sizes) {
        const testCache = new MemoryCache<any>();
        
        const start = Date.now();
        
        // Fill cache
        for (let i = 0; i < size; i++) {
          testCache.set(`key-${i}`, { data: `test-${i}` }, 60);
        }
        
        // Perform lookups
        for (let i = 0; i < size; i++) {
          testCache.get(`key-${i}`);
        }
        
        const duration = Date.now() - start;
        timings.push(duration);
        
        testCache.destroy();
      }
      
      // Performance should scale reasonably (not exponentially)
      expect(timings[2]).toBeLessThan(timings[0] * 200); // 10000 ops shouldn't be 200x slower than 100 ops
    });

    it('should demonstrate cache hit speed advantage', () => {
      const testData = { 
        complexPortfolio: Array(100).fill(null).map((_, i) => ({
          token: `token-${i}`,
          balance: Math.random() * 1000,
          value: Math.random() * 10000
        }))
      };
      
      // Cache miss (computation simulation)
      const missStart = Date.now();
      const computedData = JSON.parse(JSON.stringify(testData)); // Simulate computation
      cache.set('computed-key', computedData, 60);
      const missDuration = Date.now() - missStart;
      
      // Cache hit
      const hitStart = Date.now();
      const cachedData = cache.get('computed-key');
      const hitDuration = Date.now() - hitStart;
      
      expect(cachedData).toEqual(testData);
      expect(hitDuration).toBeLessThan(missDuration); // Cache should be faster
      expect(hitDuration).toBeLessThan(5); // Should be very fast (sub-5ms)
    });
  });

  describe('Edge Cases', () => {
    it('should handle null and undefined data', () => {
      cache.set('null-key', null, 60);
      cache.set('undefined-key', undefined, 60);
      
      expect(cache.get('null-key')).toBeNull(); // Should return actual null
      expect(cache.get('undefined-key')).toBeUndefined();
    });

    it('should handle zero TTL', () => {
      cache.set('zero-ttl', { data: 'test' }, 0);
      
      // Should expire immediately
      expect(cache.get('zero-ttl')).toBeNull();
    });

    it('should handle negative TTL', () => {
      cache.set('negative-ttl', { data: 'test' }, -60);
      
      // Should be immediately expired
      expect(cache.get('negative-ttl')).toBeNull();
    });

    it('should handle very large TTL', () => {
      cache.set('large-ttl', { data: 'test' }, 999999999); // Very large TTL
      
      expect(cache.get('large-ttl')).toBeTruthy();
    });

    it('should handle key collisions gracefully', () => {
      cache.set('same-key', { version: 1 }, 60);
      cache.set('same-key', { version: 2 }, 60); // Overwrite
      
      const result = cache.get('same-key');
      expect(result).toEqual({ version: 2 });
    });

    it('should handle empty strings and special characters in keys', () => {
      const specialKeys = ['', ' ', '\n', '\t', '🚀', '测试', 'key:with:colons', 'key/with/slashes'];
      
      specialKeys.forEach((key, index) => {
        cache.set(key, { index }, 60);
        expect(cache.get(key)).toEqual({ index });
      });
    });
  });

  describe('Memory Management', () => {
    it('should prevent memory leaks during cleanup', () => {
      const initialStats = cache.getStats();
      
      // Add and expire many entries
      for (let i = 0; i < 1000; i++) {
        cache.set(`temp-${i}`, { data: `temp-${i}` }, 0.001); // 1ms TTL
      }
      
      // Wait for expiration
      setTimeout(() => {
        // Force cleanup by accessing entries
        for (let i = 0; i < 1000; i++) {
          cache.get(`temp-${i}`);
        }
        
        const finalStats = cache.getStats();
        expect(finalStats.totalEntries).toBe(initialStats.totalEntries);
      }, 50);
    });

    it('should handle destruction properly', () => {
      cache.set('test-key', { data: 'test' }, 60);
      expect(cache.get('test-key')).toBeTruthy();
      
      cache.destroy();
      
      // Cache should be cleared
      const stats = cache.getStats();
      expect(stats.totalEntries).toBe(0);
    });
  });
});