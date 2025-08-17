// Price Cache Model
// Database operations for token price caching

import { Prisma } from '@prisma/client';
import { prisma, dbUtils } from '@/utils/database';
import { logger } from '@/utils/logger';
import { PriceCacheCreateSchema } from './validators';
import { QueryOptions, DatabaseError, NotFoundError, BatchResult } from './types';

export class PriceCacheModel {
  /**
   * Create or update price cache entry
   */
  static async upsert(data: typeof PriceCacheCreateSchema._input): Promise<any> {
    try {
      const validatedData = PriceCacheCreateSchema.parse(data);

      const priceCache = await prisma.priceCache.upsert({
        where: {
          tokenId_source: {
            tokenId: validatedData.tokenId,
            source: validatedData.source,
          },
        },
        create: {
          ...validatedData,
        },
        update: {
          ...validatedData,
          updatedAt: new Date(),
        },
        include: {
          token: true,
        },
      });

      logger.info('Price cache updated', {
        cacheId: priceCache.id,
        tokenId: priceCache.tokenId,
        priceUSD: priceCache.priceUSD,
        source: priceCache.source,
      });

      return priceCache;
    } catch (error) {
      logger.error('Failed to upsert price cache', { data, error });
      throw new DatabaseError('Failed to upsert price cache', 'upsert', 'price_cache', error);
    }
  }

  /**
   * Find price by token ID
   */
  static async findByTokenId(tokenId: string, source?: string): Promise<any> {
    try {
      const where: Prisma.PriceCacheWhereInput = {
        tokenId,
        expiresAt: {
          gt: new Date(),
        },
      };

      if (source) {
        where.source = source;
      }

      return await prisma.priceCache.findFirst({
        where,
        include: {
          token: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });
    } catch (error) {
      logger.error('Failed to find price cache by token ID', { tokenId, source, error });
      throw new DatabaseError('Failed to find price cache', 'findByTokenId', 'price_cache', error);
    }
  }

  /**
   * Find latest prices for multiple tokens
   */
  static async findLatestPrices(tokenIds: string[], source?: string): Promise<any[]> {
    try {
      const where: Prisma.PriceCacheWhereInput = {
        tokenId: {
          in: tokenIds,
        },
        expiresAt: {
          gt: new Date(),
        },
      };

      if (source) {
        where.source = source;
      }

      return await prisma.priceCache.findMany({
        where,
        include: {
          token: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
        distinct: ['tokenId'],
      });
    } catch (error) {
      logger.error('Failed to find latest prices', { tokenIds, source, error });
      throw new DatabaseError(
        'Failed to find latest prices',
        'findLatestPrices',
        'price_cache',
        error
      );
    }
  }

  /**
   * List price cache entries with pagination
   */
  static async list(
    options: QueryOptions & {
      tokenId?: string;
      source?: string;
      includeExpired?: boolean;
    } = {}
  ): Promise<{
    prices: any[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const {
        page = 1,
        limit = 50,
        sortBy = 'updatedAt',
        sortOrder = 'desc',
        tokenId,
        source,
        includeExpired = false,
      } = options;

      const skip = (page - 1) * limit;

      const where: Prisma.PriceCacheWhereInput = {};

      if (tokenId) where.tokenId = tokenId;
      if (source) where.source = source;
      if (!includeExpired) {
        where.expiresAt = {
          gt: new Date(),
        };
      }

      const [prices, total] = await Promise.all([
        prisma.priceCache.findMany({
          where,
          include: {
            token: true,
          },
          orderBy: {
            [sortBy]: sortOrder,
          },
          skip,
          take: limit,
        }),
        prisma.priceCache.count({ where }),
      ]);

      return {
        prices,
        total,
        page,
        limit,
      };
    } catch (error) {
      logger.error('Failed to list price cache', { options, error });
      throw new DatabaseError('Failed to list price cache', 'list', 'price_cache', error);
    }
  }

  /**
   * Update price cache entry
   */
  static async update(
    id: string,
    data: Partial<typeof PriceCacheCreateSchema._input>
  ): Promise<any> {
    try {
      const priceCache = await prisma.priceCache.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
        include: {
          token: true,
        },
      });

      logger.info('Price cache updated', {
        cacheId: id,
        updatedFields: Object.keys(data),
      });

      return priceCache;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundError('PriceCache', id);
      }

      logger.error('Failed to update price cache', { id, data, error });
      throw new DatabaseError('Failed to update price cache', 'update', 'price_cache', error);
    }
  }

  /**
   * Delete expired cache entries
   */
  static async deleteExpired(): Promise<{ count: number }> {
    try {
      const result = await prisma.priceCache.deleteMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
        },
      });

      logger.info('Expired price cache entries deleted', { count: result.count });

      return { count: result.count };
    } catch (error) {
      logger.error('Failed to delete expired price cache', { error });
      throw new DatabaseError(
        'Failed to delete expired price cache',
        'deleteExpired',
        'price_cache',
        error
      );
    }
  }

  /**
   * Bulk upsert price cache entries
   */
  static async bulkUpsert(
    pricesData: Array<typeof PriceCacheCreateSchema._input>
  ): Promise<BatchResult<any>> {
    const startTime = Date.now();
    const results: any[] = [];
    const errors: Array<{ index: number; error: string }> = [];

    try {
      await dbUtils.withRetry(async tx => {
        for (let i = 0; i < pricesData.length; i++) {
          try {
            const validatedData = PriceCacheCreateSchema.parse(pricesData[i]);

            const priceCache = await tx.priceCache.upsert({
              where: {
                tokenId_source: {
                  tokenId: validatedData.tokenId,
                  source: validatedData.source,
                },
              },
              create: {
                ...validatedData,
              },
              update: {
                ...validatedData,
                updatedAt: new Date(),
              },
              include: {
                token: true,
              },
            });

            results.push(priceCache);
          } catch (error) {
            errors.push({
              index: i,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }
      });

      const duration = Date.now() - startTime;

      logger.info('Bulk price cache upsert completed', {
        total: pricesData.length,
        successful: results.length,
        failed: errors.length,
        duration,
      });

      return {
        success: errors.length === 0,
        results,
        errors,
        metrics: {
          total: pricesData.length,
          successful: results.length,
          failed: errors.length,
          duration,
        },
      };
    } catch (error) {
      logger.error('Bulk price cache upsert failed', { error });
      throw new DatabaseError('Bulk price cache upsert failed', 'bulkUpsert', 'price_cache', error);
    }
  }

  /**
   * Get price statistics
   */
  static async getStatistics(): Promise<{
    total: number;
    valid: number;
    expired: number;
    sourceDistribution: Array<{ source: string; count: number }>;
    averageAge: number;
  }> {
    try {
      const now = new Date();

      const [total, valid, expired, sourceStats, avgAgeResult] = await Promise.all([
        prisma.priceCache.count(),
        prisma.priceCache.count({
          where: {
            expiresAt: {
              gt: now,
            },
          },
        }),
        prisma.priceCache.count({
          where: {
            expiresAt: {
              lte: now,
            },
          },
        }),
        prisma.priceCache.groupBy({
          by: ['source'],
          _count: { source: true },
        }),
        prisma.priceCache.aggregate({
          _avg: {
            priceUSD: true,
          },
        }),
      ]);

      const averageAge = 0; // Simplified for now - would need proper timestamp calculation

      return {
        total,
        valid,
        expired,
        sourceDistribution: sourceStats.map(stat => ({
          source: stat.source,
          count: stat._count.source,
        })),
        averageAge,
      };
    } catch (error) {
      logger.error('Failed to get price cache statistics', { error });
      throw new DatabaseError(
        'Failed to get price cache statistics',
        'getStatistics',
        'price_cache',
        error
      );
    }
  }

  /**
   * Get price history for a token
   */
  static async getPriceHistory(
    tokenId: string,
    days: number = 30,
    source?: string
  ): Promise<any[]> {
    try {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);

      const where: Prisma.PriceCacheWhereInput = {
        tokenId,
        createdAt: {
          gte: fromDate,
        },
      };

      if (source) {
        where.source = source;
      }

      return await prisma.priceCache.findMany({
        where,
        include: {
          token: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });
    } catch (error) {
      logger.error('Failed to get price history', { tokenId, days, source, error });
      throw new DatabaseError(
        'Failed to get price history',
        'getPriceHistory',
        'price_cache',
        error
      );
    }
  }
}
