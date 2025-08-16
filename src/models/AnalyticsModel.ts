// Analytics Model
// Database operations for analytics events and metrics tracking

import { Prisma } from '@prisma/client';
import { prisma, dbUtils } from '@/utils/database';
import { logger } from '@/utils/logger';
import { AnalyticsEventCreateSchema } from './validators';
import { QueryOptions, DatabaseError, NotFoundError, BatchResult } from './types';

export class AnalyticsModel {
  /**
   * Create a new analytics event
   */
  static async create(data: typeof AnalyticsEventCreateSchema._input): Promise<any> {
    try {
      const validatedData = AnalyticsEventCreateSchema.parse(data);

      const event = await prisma.analyticsEvent.create({
        data: {
          ...validatedData,
          createdAt: new Date(),
        },
      });

      logger.debug('Analytics event created', {
        eventId: event.id,
        eventType: event.eventType,
        walletId: event.walletId,
        success: event.success,
      });

      return event;
    } catch (error) {
      logger.error('Failed to create analytics event', { data, error });
      throw new DatabaseError(
        'Failed to create analytics event',
        'create',
        'analytics_events',
        error
      );
    }
  }

  /**
   * Find analytics event by ID
   */
  static async findById(id: string): Promise<any> {
    try {
      return await prisma.analyticsEvent.findUnique({
        where: { id },
      });
    } catch (error) {
      logger.error('Failed to find analytics event by ID', { id, error });
      throw new DatabaseError(
        'Failed to find analytics event',
        'findById',
        'analytics_events',
        error
      );
    }
  }

  /**
   * Find events by type
   */
  static async findByEventType(
    eventType: string,
    options: {
      limit?: number;
      walletId?: string;
      chainId?: string;
      fromDate?: Date;
      toDate?: Date;
    } = {}
  ): Promise<any[]> {
    try {
      const { limit = 100, walletId, chainId, fromDate, toDate } = options;

      const where: Prisma.AnalyticsEventWhereInput = {
        eventType,
      };

      if (walletId) where.walletId = walletId;
      if (chainId) where.chainId = chainId;

      if (fromDate || toDate) {
        where.createdAt = {};
        if (fromDate) where.createdAt.gte = fromDate;
        if (toDate) where.createdAt.lte = toDate;
      }

      return await prisma.analyticsEvent.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        take: limit,
      });
    } catch (error) {
      logger.error('Failed to find events by type', { eventType, options, error });
      throw new DatabaseError(
        'Failed to find events',
        'findByEventType',
        'analytics_events',
        error
      );
    }
  }

  /**
   * Find events by wallet
   */
  static async findByWallet(
    walletId: string,
    options: {
      limit?: number;
      eventType?: string;
      fromDate?: Date;
      toDate?: Date;
    } = {}
  ): Promise<any[]> {
    try {
      const { limit = 100, eventType, fromDate, toDate } = options;

      const where: Prisma.AnalyticsEventWhereInput = {
        walletId,
      };

      if (eventType) where.eventType = eventType;

      if (fromDate || toDate) {
        where.createdAt = {};
        if (fromDate) where.createdAt.gte = fromDate;
        if (toDate) where.createdAt.lte = toDate;
      }

      return await prisma.analyticsEvent.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        take: limit,
      });
    } catch (error) {
      logger.error('Failed to find events by wallet', { walletId, options, error });
      throw new DatabaseError('Failed to find events', 'findByWallet', 'analytics_events', error);
    }
  }

  /**
   * List analytics events with pagination
   */
  static async list(
    options: QueryOptions & {
      eventType?: string;
      walletId?: string;
      chainId?: string;
      success?: boolean;
      fromDate?: Date;
      toDate?: Date;
    } = {}
  ): Promise<{
    events: any[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const {
        page = 1,
        limit = 100,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        eventType,
        walletId,
        chainId,
        success,
        fromDate,
        toDate,
      } = options;

      const skip = (page - 1) * limit;

      const where: Prisma.AnalyticsEventWhereInput = {};

      if (eventType) where.eventType = eventType;
      if (walletId) where.walletId = walletId;
      if (chainId) where.chainId = chainId;
      if (success !== undefined) where.success = success;

      if (fromDate || toDate) {
        where.createdAt = {};
        if (fromDate) where.createdAt.gte = fromDate;
        if (toDate) where.createdAt.lte = toDate;
      }

      const [events, total] = await Promise.all([
        prisma.analyticsEvent.findMany({
          where,
          orderBy: {
            [sortBy]: sortOrder,
          },
          skip,
          take: limit,
        }),
        prisma.analyticsEvent.count({ where }),
      ]);

      return {
        events,
        total,
        page,
        limit,
      };
    } catch (error) {
      logger.error('Failed to list analytics events', { options, error });
      throw new DatabaseError('Failed to list analytics events', 'list', 'analytics_events', error);
    }
  }

  /**
   * Bulk create analytics events
   */
  static async bulkCreate(
    eventsData: Array<typeof AnalyticsEventCreateSchema._input>
  ): Promise<BatchResult<any>> {
    const startTime = Date.now();
    const results: any[] = [];
    const errors: Array<{ index: number; error: string }> = [];

    try {
      await dbUtils.withRetry(async tx => {
        for (let i = 0; i < eventsData.length; i++) {
          try {
            const validatedData = AnalyticsEventCreateSchema.parse(eventsData[i]);

            const event = await tx.analyticsEvent.create({
              data: {
                ...validatedData,
                createdAt: new Date(),
              },
            });

            results.push(event);
          } catch (error) {
            errors.push({
              index: i,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }
      });

      const duration = Date.now() - startTime;

      logger.info('Bulk analytics events creation completed', {
        total: eventsData.length,
        successful: results.length,
        failed: errors.length,
        duration,
      });

      return {
        success: errors.length === 0,
        results,
        errors,
        metrics: {
          total: eventsData.length,
          successful: results.length,
          failed: errors.length,
          duration,
        },
      };
    } catch (error) {
      logger.error('Bulk analytics events creation failed', { error });
      throw new DatabaseError(
        'Bulk analytics events creation failed',
        'bulkCreate',
        'analytics_events',
        error
      );
    }
  }

  /**
   * Get event type statistics
   */
  static async getEventTypeStats(
    fromDate?: Date,
    toDate?: Date
  ): Promise<
    Array<{
      eventType: string;
      count: number;
      successCount: number;
      failureCount: number;
      successRate: number;
      averageDuration: number;
    }>
  > {
    try {
      const where: Prisma.AnalyticsEventWhereInput = {};

      if (fromDate || toDate) {
        where.createdAt = {};
        if (fromDate) where.createdAt.gte = fromDate;
        if (toDate) where.createdAt.lte = toDate;
      }

      const stats = await prisma.analyticsEvent.groupBy({
        by: ['eventType'],
        _count: {
          id: true,
        },
        _avg: {
          duration: true,
        },
        where,
      });

      const detailedStats = await Promise.all(
        stats.map(async stat => {
          const [successCount, failureCount] = await Promise.all([
            prisma.analyticsEvent.count({
              where: {
                ...where,
                eventType: stat.eventType,
                success: true,
              },
            }),
            prisma.analyticsEvent.count({
              where: {
                ...where,
                eventType: stat.eventType,
                success: false,
              },
            }),
          ]);

          const totalCount = stat._count.id;
          const successRate = totalCount > 0 ? (successCount / totalCount) * 100 : 0;

          return {
            eventType: stat.eventType,
            count: totalCount,
            successCount,
            failureCount,
            successRate,
            averageDuration: stat._avg.duration || 0,
          };
        })
      );

      return detailedStats.sort((a, b) => b.count - a.count);
    } catch (error) {
      logger.error('Failed to get event type statistics', { fromDate, toDate, error });
      throw new DatabaseError(
        'Failed to get event type statistics',
        'getEventTypeStats',
        'analytics_events',
        error
      );
    }
  }

  /**
   * Get wallet activity metrics
   */
  static async getWalletActivityMetrics(
    walletId: string,
    days: number = 30
  ): Promise<{
    totalEvents: number;
    uniqueEventTypes: number;
    successRate: number;
    averageDuration: number;
    eventsByDay: Array<{ date: string; count: number }>;
    topEventTypes: Array<{ eventType: string; count: number }>;
    errorPatterns: Array<{ errorCode: string; count: number }>;
  }> {
    try {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);

      const where: Prisma.AnalyticsEventWhereInput = {
        walletId,
        createdAt: {
          gte: fromDate,
        },
      };

      const [totalEvents, successCount, eventTypeStats, avgDuration, errorStats] =
        await Promise.all([
          prisma.analyticsEvent.count({ where }),
          prisma.analyticsEvent.count({
            where: {
              ...where,
              success: true,
            },
          }),
          prisma.analyticsEvent.groupBy({
            by: ['eventType'],
            _count: { eventType: true },
            where,
            orderBy: {
              _count: {
                eventType: 'desc',
              },
            },
            take: 10,
          }),
          prisma.analyticsEvent.aggregate({
            _avg: {
              duration: true,
            },
            where,
          }),
          prisma.analyticsEvent.groupBy({
            by: ['errorCode'],
            _count: { errorCode: true },
            where: {
              ...where,
              success: false,
              errorCode: {
                not: null,
              },
            },
            orderBy: {
              _count: {
                errorCode: 'desc',
              },
            },
            take: 5,
          }),
        ]);

      // Get daily event counts
      const events = await prisma.analyticsEvent.findMany({
        where,
        select: {
          createdAt: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      const eventsByDay = this.groupEventsByDay(events, days);

      return {
        totalEvents,
        uniqueEventTypes: eventTypeStats.length,
        successRate: totalEvents > 0 ? (successCount / totalEvents) * 100 : 0,
        averageDuration: avgDuration._avg.duration || 0,
        eventsByDay,
        topEventTypes: eventTypeStats.map(stat => ({
          eventType: stat.eventType,
          count: stat._count.eventType,
        })),
        errorPatterns: errorStats.map(stat => ({
          errorCode: stat.errorCode || 'unknown',
          count: stat._count.errorCode,
        })),
      };
    } catch (error) {
      logger.error('Failed to get wallet activity metrics', { walletId, days, error });
      throw new DatabaseError(
        'Failed to get wallet activity metrics',
        'getWalletActivityMetrics',
        'analytics_events',
        error
      );
    }
  }

  /**
   * Get system performance metrics
   */
  static async getSystemPerformanceMetrics(
    fromDate?: Date,
    toDate?: Date
  ): Promise<{
    totalEvents: number;
    totalErrors: number;
    overallSuccessRate: number;
    averageResponseTime: number;
    eventVolumeByHour: Array<{ hour: number; count: number }>;
    errorRateByEventType: Array<{ eventType: string; errorRate: number }>;
    performanceTrends: Array<{ date: string; avgDuration: number; errorRate: number }>;
  }> {
    try {
      const where: Prisma.AnalyticsEventWhereInput = {};

      if (fromDate || toDate) {
        where.createdAt = {};
        if (fromDate) where.createdAt.gte = fromDate;
        if (toDate) where.createdAt.lte = toDate;
      }

      const [totalEvents, totalErrors, avgDuration, eventTypePerformance] = await Promise.all([
        prisma.analyticsEvent.count({ where }),
        prisma.analyticsEvent.count({
          where: {
            ...where,
            success: false,
          },
        }),
        prisma.analyticsEvent.aggregate({
          _avg: {
            duration: true,
          },
          where,
        }),
        prisma.analyticsEvent.groupBy({
          by: ['eventType'],
          _count: {
            id: true,
          },
          where,
        }),
      ]);

      const errorRateByEventType = await Promise.all(
        eventTypePerformance.map(async stat => {
          const errorCount = await prisma.analyticsEvent.count({
            where: {
              ...where,
              eventType: stat.eventType,
              success: false,
            },
          });

          return {
            eventType: stat.eventType,
            errorRate: stat._count.id > 0 ? (errorCount / stat._count.id) * 100 : 0,
          };
        })
      );

      // Get hourly event volume for the last 24 hours
      const last24Hours = new Date();
      last24Hours.setHours(last24Hours.getHours() - 24);

      const recentEvents = await prisma.analyticsEvent.findMany({
        where: {
          createdAt: {
            gte: last24Hours,
          },
        },
        select: {
          createdAt: true,
        },
      });

      const eventVolumeByHour = this.groupEventsByHour(recentEvents);

      return {
        totalEvents,
        totalErrors,
        overallSuccessRate: totalEvents > 0 ? ((totalEvents - totalErrors) / totalEvents) * 100 : 0,
        averageResponseTime: avgDuration._avg.duration || 0,
        eventVolumeByHour,
        errorRateByEventType: errorRateByEventType.sort((a, b) => b.errorRate - a.errorRate),
        performanceTrends: [], // Would require more complex time-series aggregation
      };
    } catch (error) {
      logger.error('Failed to get system performance metrics', { fromDate, toDate, error });
      throw new DatabaseError(
        'Failed to get system performance metrics',
        'getSystemPerformanceMetrics',
        'analytics_events',
        error
      );
    }
  }

  /**
   * Delete old analytics events
   */
  static async deleteOldEvents(daysToKeep: number = 90): Promise<{ count: number }> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const result = await prisma.analyticsEvent.deleteMany({
        where: {
          createdAt: {
            lt: cutoffDate,
          },
        },
      });

      logger.info('Old analytics events deleted', {
        count: result.count,
        cutoffDate,
        daysToKeep,
      });

      return { count: result.count };
    } catch (error) {
      logger.error('Failed to delete old analytics events', { daysToKeep, error });
      throw new DatabaseError(
        'Failed to delete old analytics events',
        'deleteOldEvents',
        'analytics_events',
        error
      );
    }
  }

  /**
   * Helper method to group events by day
   */
  private static groupEventsByDay(
    events: Array<{ createdAt: Date }>,
    days: number
  ): Array<{ date: string; count: number }> {
    const result: { [key: string]: number } = {};

    // Initialize all days with 0 count
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      result[dateStr] = 0;
    }

    // Count events by day
    events.forEach(event => {
      const dateStr = event.createdAt.toISOString().split('T')[0];
      if (result.hasOwnProperty(dateStr)) {
        result[dateStr]++;
      }
    });

    return Object.entries(result)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Helper method to group events by hour
   */
  private static groupEventsByHour(
    events: Array<{ createdAt: Date }>
  ): Array<{ hour: number; count: number }> {
    const result: { [key: number]: number } = {};

    // Initialize all hours with 0 count
    for (let i = 0; i < 24; i++) {
      result[i] = 0;
    }

    // Count events by hour
    events.forEach(event => {
      const hour = event.createdAt.getHours();
      result[hour]++;
    });

    return Object.entries(result)
      .map(([hour, count]) => ({ hour: parseInt(hour), count }))
      .sort((a, b) => a.hour - b.hour);
  }

  /**
   * Track API endpoint usage
   */
  static async trackApiUsage(
    endpoint: string,
    method: string,
    statusCode: number,
    duration: number,
    userAgent?: string,
    ipAddress?: string
  ): Promise<void> {
    try {
      await this.create({
        eventType: 'api_request',
        eventData: {
          endpoint,
          method,
          statusCode,
        },
        duration,
        success: statusCode >= 200 && statusCode < 400,
        userAgent,
        ipAddress,
      });
    } catch (error) {
      // Don't throw errors for analytics tracking to avoid breaking main functionality
      logger.error('Failed to track API usage', { endpoint, method, statusCode, error });
    }
  }

  /**
   * Track user action
   */
  static async trackUserAction(
    walletId: string,
    action: string,
    metadata: Record<string, any> = {},
    chainId?: string
  ): Promise<void> {
    try {
      await this.create({
        eventType: 'user_action',
        walletId,
        chainId,
        eventData: {
          action,
          ...metadata,
        },
        success: true,
      });
    } catch (error) {
      // Don't throw errors for analytics tracking
      logger.error('Failed to track user action', { walletId, action, error });
    }
  }

  /**
   * Track error event
   */
  static async trackError(
    eventType: string,
    errorCode: string,
    errorMessage: string,
    walletId?: string,
    chainId?: string,
    additionalData: Record<string, any> = {}
  ): Promise<void> {
    try {
      await this.create({
        eventType,
        walletId,
        chainId,
        eventData: additionalData,
        success: false,
        errorCode,
        errorMessage: errorMessage.substring(0, 500), // Limit error message length
      });
    } catch (error) {
      // Don't throw errors for analytics tracking
      logger.error('Failed to track error event', { eventType, errorCode, error });
    }
  }
}
