import { EventBusPort, createIntegrationEvent } from '@/app/ports/EventBusPort';
import { PortfolioAggregationRequestV1, PORTFOLIO_EVENT_TYPES } from '@/app/events/PortfolioEvents';
import { redisManager } from '@/utils/redis';
import { logger } from '@/utils/logger';
import { ChainId } from '@/types/blockchain';
import { config } from '../config';

/**
 * Async Portfolio Service
 *
 * Manages asynchronous portfolio detail requests using the event bus system.
 * Provides request tracking, status monitoring, and result retrieval.
 */
export class AsyncPortfolioService {
  private eventBus: EventBusPort;
  private activeRequests = new Map<string, AsyncRequestMetadata>();
  private readonly maxConcurrentRequests: number;

  constructor(eventBus: EventBusPort) {
    this.eventBus = eventBus;
    this.maxConcurrentRequests = config.features.asyncPortfolioMaxRequests;

    logger.info('AsyncPortfolioService initialized', {
      maxConcurrentRequests: this.maxConcurrentRequests,
    });
  }

  /**
   * Submit an async portfolio aggregation request
   */
  async submitPortfolioRequest(
    address: string,
    options: {
      chains?: ChainId[];
      includeDefi?: boolean;
      includeNfts?: boolean;
      includeMetadata?: boolean;
      includeAnalytics?: boolean;
      forceRefresh?: boolean;
      minDefiValue?: number;
      minNftValue?: number;
    },
    context: {
      userId?: string;
      sessionId?: string;
      clientType: 'web' | 'mobile' | 'api';
      priority?: 'low' | 'medium' | 'high' | 'urgent';
    },
    requestId: string
  ): Promise<AsyncPortfolioRequestResult> {
    // Check if we've hit the concurrent request limit
    if (this.activeRequests.size >= this.maxConcurrentRequests) {
      throw new Error('Maximum concurrent async requests exceeded');
    }

    // Check for duplicate request
    const existingRequest = await this.getRequestStatus(requestId);
    if (existingRequest) {
      return {
        requestId,
        status: existingRequest.status,
        submittedAt: existingRequest.submittedAt,
        estimatedCompletionTime: existingRequest.estimatedCompletionTime,
      };
    }

    const requestMetadata: AsyncRequestMetadata = {
      requestId,
      address,
      status: 'queued',
      submittedAt: new Date().toISOString(),
      estimatedCompletionTime: this.calculateEstimatedCompletion(options),
      options,
      context,
    };

    // Store request metadata
    await this.storeRequestMetadata(requestMetadata);
    this.activeRequests.set(requestId, requestMetadata);

    // Create and publish the aggregation request event
    const aggregationEvent = createIntegrationEvent<PortfolioAggregationRequestV1['data']>(
      PORTFOLIO_EVENT_TYPES.AGGREGATION_REQUEST,
      {
        address,
        components: {
          includeDefi: options.includeDefi ?? true,
          includeNft: options.includeNfts ?? true,
          includeBalances: true,
          includeTransactions: false,
        },
        chains: options.chains,
        options: {
          includeMetadata: options.includeMetadata ?? true,
          includeAnalytics: options.includeAnalytics ?? false,
          forceRefresh: options.forceRefresh ?? false,
          minDefiValue: options.minDefiValue,
          minNftValue: options.minNftValue,
          maxStalenessMs: options.forceRefresh ? 0 : 300000, // 5 minutes
        },
        context: {
          ...context,
          priority: context.priority ?? 'medium',
        },
        requestedAt: new Date().toISOString(),
      },
      {
        requestId,
        source: 'AsyncPortfolioService',
        version: '1.0.0',
        metadata: {
          originalRequestId: requestId,
          estimatedDuration: this.getEstimatedDuration(options),
        },
      }
    );

    try {
      await this.eventBus.publish(aggregationEvent, {
        priority: this.mapPriorityToNumber(context.priority ?? 'medium'),
        routingKey: `portfolio.${address}`,
      });

      logger.info('Async portfolio request submitted', {
        requestId,
        address,
        estimatedCompletion: requestMetadata.estimatedCompletionTime,
      });

      return {
        requestId,
        status: 'queued',
        submittedAt: requestMetadata.submittedAt,
        estimatedCompletionTime: requestMetadata.estimatedCompletionTime,
      };
    } catch (error) {
      // Clean up on failure
      await this.removeRequestMetadata(requestId);
      this.activeRequests.delete(requestId);

      logger.error('Failed to submit async portfolio request', {
        requestId,
        address,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw new Error('Failed to submit async portfolio request');
    }
  }

  /**
   * Get the status of an async request
   */
  async getRequestStatus(requestId: string): Promise<AsyncRequestStatus | null> {
    // Check in-memory cache first
    const inMemory = this.activeRequests.get(requestId);
    if (inMemory) {
      return {
        requestId,
        status: inMemory.status,
        submittedAt: inMemory.submittedAt,
        estimatedCompletionTime: inMemory.estimatedCompletionTime,
        progress: await this.calculateProgress(inMemory),
      };
    }

    // Check Redis for completed/failed requests
    try {
      const statusKey = `async-portfolio:status:${requestId}`;
      const cached = await redisManager.get(statusKey);

      if (cached) {
        return cached as AsyncRequestStatus;
      }
    } catch (error) {
      logger.warn('Failed to get request status from cache', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return null;
  }

  /**
   * Get the result of a completed async request
   */
  async getRequestResult(requestId: string): Promise<AsyncPortfolioResult | null> {
    try {
      const resultKey = `async-portfolio:result:${requestId}`;
      const result = await redisManager.get(resultKey);

      if (result) {
        logger.debug('Retrieved async portfolio result', {
          requestId,
          resultSize: JSON.stringify(result).length,
        });

        return result as AsyncPortfolioResult;
      }
    } catch (error) {
      logger.error('Failed to get request result', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return null;
  }

  /**
   * Update request status (called by event handlers)
   */
  async updateRequestStatus(
    requestId: string,
    status: AsyncRequestStatus['status'],
    result?: any,
    error?: string
  ): Promise<void> {
    const inMemory = this.activeRequests.get(requestId);
    if (inMemory) {
      inMemory.status = status;
      inMemory.updatedAt = new Date().toISOString();

      if (status === 'completed' || status === 'failed') {
        // Move to persistent storage and remove from active
        await this.archiveRequest(requestId, status, result, error);
        this.activeRequests.delete(requestId);
      } else {
        // Update in-place for processing status
        await this.storeRequestMetadata(inMemory);
      }
    }
  }

  /**
   * Get statistics about async requests
   */
  getRequestStats(): AsyncPortfolioStats {
    const activeCount = this.activeRequests.size;
    const statusCounts = {
      queued: 0,
      processing: 0,
    };

    for (const request of this.activeRequests.values()) {
      statusCounts[request.status as keyof typeof statusCounts]++;
    }

    return {
      activeRequests: activeCount,
      maxConcurrentRequests: this.maxConcurrentRequests,
      queuedRequests: statusCounts.queued,
      processingRequests: statusCounts.processing,
      utilizationPercent: (activeCount / this.maxConcurrentRequests) * 100,
    };
  }

  /**
   * Clean up expired requests
   */
  async cleanup(): Promise<void> {
    const now = Date.now();
    const expiredRequests: string[] = [];

    for (const [requestId, metadata] of this.activeRequests.entries()) {
      const submittedAt = new Date(metadata.submittedAt).getTime();
      const maxAge = 30 * 60 * 1000; // 30 minutes max

      if (now - submittedAt > maxAge) {
        expiredRequests.push(requestId);
      }
    }

    for (const requestId of expiredRequests) {
      await this.updateRequestStatus(requestId, 'failed', null, 'Request expired');
      logger.warn('Cleaned up expired async request', { requestId });
    }
  }

  /**
   * Private helper methods
   */
  private calculateEstimatedCompletion(options: any): string {
    const baseDuration = this.getEstimatedDuration(options);
    const queuePosition = this.activeRequests.size;
    const estimatedStart = queuePosition * 2000; // 2 seconds per queue position

    const estimatedCompletion = new Date(Date.now() + estimatedStart + baseDuration);
    return estimatedCompletion.toISOString();
  }

  private getEstimatedDuration(options: any): number {
    let duration = 5000; // Base 5 seconds

    if (options.includeDefi) duration += 3000;
    if (options.includeNfts) duration += 4000;
    if (options.includeAnalytics) duration += 2000;
    if (options.forceRefresh) duration += 2000;

    return duration;
  }

  private async calculateProgress(metadata: AsyncRequestMetadata): Promise<number> {
    if (metadata.status === 'queued') return 0;
    if (metadata.status === 'completed') return 100;
    if (metadata.status === 'failed') return 0;

    // For processing, estimate based on time elapsed
    const now = Date.now();
    const startTime = new Date(metadata.submittedAt).getTime();
    const elapsed = now - startTime;
    const estimated = this.getEstimatedDuration(metadata.options);

    return Math.min(90, Math.floor((elapsed / estimated) * 100));
  }

  private mapPriorityToNumber(priority: string): number {
    const priorities = { urgent: 4, high: 3, medium: 2, low: 1 };
    return priorities[priority as keyof typeof priorities] || 2;
  }

  private async storeRequestMetadata(metadata: AsyncRequestMetadata): Promise<void> {
    try {
      const key = `async-portfolio:metadata:${metadata.requestId}`;
      await redisManager.set(key, metadata, 1800); // 30 minutes TTL
    } catch (error) {
      logger.error('Failed to store request metadata', {
        requestId: metadata.requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async removeRequestMetadata(requestId: string): Promise<void> {
    try {
      const key = `async-portfolio:metadata:${requestId}`;
      await redisManager.del(key);
    } catch (error) {
      logger.warn('Failed to remove request metadata', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async archiveRequest(
    requestId: string,
    status: 'completed' | 'failed',
    result?: any,
    error?: string
  ): Promise<void> {
    try {
      const statusData: AsyncRequestStatus = {
        requestId,
        status,
        submittedAt: this.activeRequests.get(requestId)?.submittedAt || new Date().toISOString(),
        completedAt: new Date().toISOString(),
        error,
      };

      // Store status
      const statusKey = `async-portfolio:status:${requestId}`;
      await redisManager.set(statusKey, statusData, 3600); // 1 hour TTL

      // Store result if successful
      if (status === 'completed' && result) {
        const resultKey = `async-portfolio:result:${requestId}`;
        await redisManager.set(resultKey, result, 3600); // 1 hour TTL
      }

      // Clean up metadata
      await this.removeRequestMetadata(requestId);
    } catch (error) {
      logger.error('Failed to archive request', {
        requestId,
        status,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

/**
 * Type definitions
 */
export interface AsyncPortfolioRequestResult {
  requestId: string;
  status: 'queued';
  submittedAt: string;
  estimatedCompletionTime: string;
}

export interface AsyncRequestStatus {
  requestId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  submittedAt: string;
  estimatedCompletionTime?: string;
  completedAt?: string;
  progress?: number;
  error?: string;
}

export interface AsyncPortfolioResult {
  requestId: string;
  data: any;
  completedAt: string;
  metadata: {
    processingTime: number;
    cacheHitRate: number;
    dataQuality: number;
  };
}

export interface AsyncPortfolioStats {
  activeRequests: number;
  maxConcurrentRequests: number;
  queuedRequests: number;
  processingRequests: number;
  utilizationPercent: number;
}

interface AsyncRequestMetadata {
  requestId: string;
  address: string;
  status: 'queued' | 'processing';
  submittedAt: string;
  updatedAt?: string;
  estimatedCompletionTime: string;
  options: any;
  context: any;
}

/**
 * Singleton instance
 */
let asyncPortfolioServiceInstance: AsyncPortfolioService | null = null;

export const getAsyncPortfolioService = (eventBus: EventBusPort): AsyncPortfolioService => {
  if (!asyncPortfolioServiceInstance) {
    asyncPortfolioServiceInstance = new AsyncPortfolioService(eventBus);
  }
  return asyncPortfolioServiceInstance;
};
