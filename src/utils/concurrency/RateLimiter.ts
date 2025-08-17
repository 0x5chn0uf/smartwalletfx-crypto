/**
 * Rate Limiter
 * 
 * Handles per-second and per-minute rate limiting for provider requests.
 * Separated from concurrency control for better maintainability.
 */

import { logger } from '../logger';
import { ChainId } from '@/types/blockchain';

export interface RateLimitConfig {
  rateLimitPerSecond: number;
  rateLimitPerMinute: number;
  burstAllowance: number;
}

interface RateLimiterState {
  requests: number[];
  lastMinuteRequests: number[];
}

export class RateLimiter {
  private rateLimiters = new Map<string, RateLimiterState>();

  constructor(private defaultConfig: RateLimitConfig) {}

  /**
   * Check if request should be rate limited
   */
  isRateLimited(provider: string, chainId?: ChainId, config?: RateLimitConfig): boolean {
    const effectiveConfig = config || this.defaultConfig;
    const rateLimiter = this.getRateLimiter(provider, chainId);
    const now = Date.now();

    // Clean old requests (older than 1 second)
    rateLimiter.requests = rateLimiter.requests.filter(timestamp => now - timestamp < 1000);

    // Clean old minute requests (older than 1 minute)
    rateLimiter.lastMinuteRequests = rateLimiter.lastMinuteRequests.filter(
      timestamp => now - timestamp < 60000
    );

    // Check per-second limit
    if (rateLimiter.requests.length >= effectiveConfig.rateLimitPerSecond) {
      return true;
    }

    // Check per-minute limit
    if (rateLimiter.lastMinuteRequests.length >= effectiveConfig.rateLimitPerMinute) {
      return true;
    }

    return false;
  }

  /**
   * Record a request
   */
  recordRequest(provider: string, chainId?: ChainId): void {
    const rateLimiter = this.getRateLimiter(provider, chainId);
    const now = Date.now();

    rateLimiter.requests.push(now);
    rateLimiter.lastMinuteRequests.push(now);
  }

  /**
   * Get or create rate limiter state
   */
  private getRateLimiter(provider: string, chainId?: ChainId): RateLimiterState {
    const key = chainId ? `${provider}:${chainId}` : provider;

    if (!this.rateLimiters.has(key)) {
      this.rateLimiters.set(key, {
        requests: [],
        lastMinuteRequests: [],
      });
    }

    return this.rateLimiters.get(key)!;
  }

  /**
   * Get current rate limiter statistics
   */
  getStats(): Record<string, { recentRequests: number; minuteRequests: number }> {
    const stats: Record<string, { recentRequests: number; minuteRequests: number }> = {};
    const now = Date.now();

    for (const [key, state] of this.rateLimiters.entries()) {
      const recentRequests = state.requests.filter(timestamp => now - timestamp < 1000).length;
      const minuteRequests = state.lastMinuteRequests.filter(
        timestamp => now - timestamp < 60000
      ).length;

      stats[key] = {
        recentRequests,
        minuteRequests,
      };
    }

    return stats;
  }

  /**
   * Clean up old rate limiter state (called periodically)
   */
  cleanup(): void {
    const now = Date.now();

    for (const [key, state] of this.rateLimiters.entries()) {
      // Remove requests older than 1 minute
      state.requests = state.requests.filter(timestamp => now - timestamp < 60000);
      state.lastMinuteRequests = state.lastMinuteRequests.filter(
        timestamp => now - timestamp < 60000
      );

      // Remove empty rate limiters
      if (state.requests.length === 0 && state.lastMinuteRequests.length === 0) {
        this.rateLimiters.delete(key);
      }
    }
  }

  /**
   * Clear all rate limiters (useful for testing)
   */
  clear(): void {
    this.rateLimiters.clear();
  }
}