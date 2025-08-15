import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { redisManager } from '@/utils/redis';
import { logger } from '@/utils/logger';

interface LimiterOptions {
  points: number; // Number of points
  duration: number; // Per duration in seconds
  keyPrefix: string;
}

// Create a Redis-backed rate limiter instance
export const createRedisRateLimiter = (options: LimiterOptions) => {
  const client = redisManager.getClient();
  const limiter = new RateLimiterRedis({
    storeClient: client as any,
    keyPrefix: options.keyPrefix,
    points: options.points,
    duration: options.duration,
    execEvenly: false,
    insuranceLimiter: undefined,
  });

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const apiKey = (req.headers['x-api-key'] as string) || '';
      const key = apiKey || req.ip || 'anonymous';

      const consumed = await limiter.consume(key, 1);

      // Expose standard rate limit headers
      res.setHeader('X-RateLimit-Limit', String(options.points));
      res.setHeader('X-RateLimit-Remaining', String(consumed.remainingPoints));
      res.setHeader(
        'X-RateLimit-Reset',
        String(Math.floor((Date.now() + consumed.msBeforeNext) / 1000))
      );

      next();
    } catch (rejRes: any) {
      // Too many requests
      const msBeforeNext = rejRes?.msBeforeNext ?? 0;
      res.setHeader('Retry-After', String(Math.ceil(msBeforeNext / 1000)));
      res.setHeader('X-RateLimit-Limit', String(options.points));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(Math.floor((Date.now() + msBeforeNext) / 1000)));

      logger.warn('Rate limit exceeded', {
        keyPrefix: options.keyPrefix,
        ip: req.ip,
        path: req.path,
        apiKey: (req.headers['x-api-key'] as string)?.slice(0, 6) || 'none',
      });

      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests, please try again later.',
          retryAfter: Math.ceil(msBeforeNext / 1000),
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    }
  };
};
