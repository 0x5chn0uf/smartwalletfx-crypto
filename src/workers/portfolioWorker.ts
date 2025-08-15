import { EventBusPort } from '@/ports/EventBusPort';
import {
  DeFiPositionsRequestedV1,
  DeFiPositionsFetchedV1,
  PortfolioComputedV1,
  PortfolioComputationFailedV1,
  EventTypes,
  createEvent,
} from '@/events/types';
import { DeFiOrchestrator } from '@/services/defi/DeFiOrchestrator';
import { redisManager } from '@/utils/redis';
import { logger } from '@/utils/logger';
import { ChainId } from '@/types/blockchain';
import { DeFiProtocol } from '@/types/defi';

/**
 * Portfolio Worker
 *
 * Handles DeFi portfolio computation with intelligent batching and deduplication.
 * Subscribes to DeFiPositionsRequestedV1 events and processes them efficiently.
 */
export class PortfolioWorker {
  private eventBus: EventBusPort;
  private orchestrator: DeFiOrchestrator;
  private isRunning = false;
  private subscriptionId?: string;

  // Batching configuration
  private readonly batchWindow: number; // milliseconds
  private readonly maxBatchSize: number;
  private readonly deduplicationTTL: number; // seconds

  // Batching state
  private batchTimer?: NodeJS.Timeout;
  private currentBatch: Map<string, BatchedRequest> = new Map();
  private processedRequests = new Set<string>();

  // Performance tracking
  private stats = {
    requestsReceived: 0,
    requestsProcessed: 0,
    requestsDeduplicated: 0,
    batchesProcessed: 0,
    totalComputationTime: 0,
    errors: 0,
  };

  constructor(
    eventBus: EventBusPort,
    orchestrator: DeFiOrchestrator,
    config: PortfolioWorkerConfig = {}
  ) {
    this.eventBus = eventBus;
    this.orchestrator = orchestrator;

    // Apply configuration with defaults
    this.batchWindow = config.batchWindowMs ?? 100; // 100ms default batching window
    this.maxBatchSize = config.maxBatchSize ?? 10;
    this.deduplicationTTL = config.deduplicationTTLSeconds ?? 300; // 5 minutes

    logger.info('PortfolioWorker initialized', {
      batchWindow: this.batchWindow,
      maxBatchSize: this.maxBatchSize,
      deduplicationTTL: this.deduplicationTTL,
    });
  }

  /**
   * Start the portfolio worker
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('PortfolioWorker is already running');
      return;
    }

    try {
      // Subscribe to DeFi positions requested events
      this.subscriptionId = await this.eventBus.subscribe(
        EventTypes.DEFI_POSITIONS_REQUESTED_V1,
        this.handlePositionsRequested.bind(this),
        {
          queue: 'portfolio',
          maxRetries: 3,
          retryDelay: 2000,
          concurrency: 1, // Single worker to maintain batching
        }
      );

      this.isRunning = true;
      logger.info('PortfolioWorker started successfully', {
        subscriptionId: this.subscriptionId,
      });
    } catch (error) {
      logger.error('Failed to start PortfolioWorker', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Stop the portfolio worker
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping PortfolioWorker...');
    this.isRunning = false;

    // Clear any pending batch timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }

    // Process any remaining requests in the current batch
    if (this.currentBatch.size > 0) {
      logger.info('Processing remaining batch before shutdown', {
        batchSize: this.currentBatch.size,
      });
      await this.processBatch();
    }

    // Unsubscribe from events
    if (this.subscriptionId) {
      await this.eventBus.unsubscribe(this.subscriptionId);
      this.subscriptionId = undefined;
    }

    logger.info('PortfolioWorker stopped', {
      finalStats: this.stats,
    });
  }

  /**
   * Get worker statistics
   */
  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      currentBatchSize: this.currentBatch.size,
      averageComputationTime:
        this.stats.requestsProcessed > 0
          ? this.stats.totalComputationTime / this.stats.requestsProcessed
          : 0,
    };
  }

  /**
   * Handle incoming DeFi positions requested events
   */
  private async handlePositionsRequested(event: DeFiPositionsRequestedV1): Promise<void> {
    this.stats.requestsReceived++;

    const { walletAddress, chainIds, protocols, includeInactive } = event.payload;
    const requestKey = this.generateRequestKey(walletAddress, chainIds, protocols, includeInactive);

    logger.debug('Received DeFi positions request', {
      eventId: event.id,
      walletAddress,
      requestKey,
      chainIds,
      protocols,
    });

    // Check for deduplication
    if (await this.isDuplicateRequest(requestKey)) {
      this.stats.requestsDeduplicated++;
      logger.debug('Request deduplicated', {
        eventId: event.id,
        requestKey,
        walletAddress,
      });
      return;
    }

    // Add to current batch
    this.currentBatch.set(requestKey, {
      event,
      requestKey,
      addedAt: Date.now(),
    });

    logger.debug('Added request to batch', {
      eventId: event.id,
      requestKey,
      batchSize: this.currentBatch.size,
    });

    // Mark as processed for deduplication
    await this.markRequestProcessed(requestKey);

    // Schedule batch processing if not already scheduled
    this.scheduleBatchProcessing();
  }

  /**
   * Generate a unique key for request deduplication
   */
  private generateRequestKey(
    walletAddress: string,
    chainIds?: ChainId[],
    protocols?: string[],
    includeInactive?: boolean
  ): string {
    const chainIdStr = chainIds?.sort().join(',') || 'all';
    const protocolStr = protocols?.sort().join(',') || 'all';
    const includeInactiveStr = includeInactive ? 'true' : 'false';

    return `${walletAddress}:${chainIdStr}:${protocolStr}:${includeInactiveStr}`;
  }

  /**
   * Check if a request is a duplicate within the TTL window
   */
  private async isDuplicateRequest(requestKey: string): Promise<boolean> {
    try {
      const cacheKey = `portfolio-worker:dedup:${requestKey}`;
      const exists = await redisManager.exists(cacheKey);
      return exists;
    } catch (error) {
      logger.warn('Failed to check for duplicate request', {
        requestKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false; // If Redis fails, don't block processing
    }
  }

  /**
   * Mark a request as processed for deduplication
   */
  private async markRequestProcessed(requestKey: string): Promise<void> {
    try {
      const cacheKey = `portfolio-worker:dedup:${requestKey}`;
      await redisManager.set(cacheKey, true, this.deduplicationTTL);
    } catch (error) {
      logger.warn('Failed to mark request as processed', {
        requestKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Non-fatal error, continue processing
    }
  }

  /**
   * Schedule batch processing
   */
  private scheduleBatchProcessing(): void {
    // If we've reached max batch size, process immediately
    if (this.currentBatch.size >= this.maxBatchSize) {
      if (this.batchTimer) {
        clearTimeout(this.batchTimer);
        this.batchTimer = undefined;
      }
      setImmediate(() => this.processBatch());
      return;
    }

    // If timer is already running, don't schedule another one
    if (this.batchTimer) {
      return;
    }

    // Schedule batch processing after the batch window
    this.batchTimer = setTimeout(() => {
      this.batchTimer = undefined;
      this.processBatch();
    }, this.batchWindow);
  }

  /**
   * Process the current batch of requests
   */
  private async processBatch(): Promise<void> {
    if (this.currentBatch.size === 0) {
      return;
    }

    const batchToProcess = new Map(this.currentBatch);
    this.currentBatch.clear();
    this.stats.batchesProcessed++;

    const batchStartTime = Date.now();
    logger.info('Processing portfolio batch', {
      batchSize: batchToProcess.size,
      batchId: `batch-${Date.now()}`,
    });

    // Process each request in the batch
    const processingPromises = Array.from(batchToProcess.values()).map(async batchedRequest =>
      this.processIndividualRequest(batchedRequest)
    );

    try {
      await Promise.allSettled(processingPromises);

      const batchDuration = Date.now() - batchStartTime;
      logger.info('Batch processing completed', {
        batchSize: batchToProcess.size,
        duration: batchDuration,
      });
    } catch (error) {
      logger.error('Batch processing failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        batchSize: batchToProcess.size,
      });
    }
  }

  /**
   * Process an individual request
   */
  private async processIndividualRequest(batchedRequest: BatchedRequest): Promise<void> {
    const { event } = batchedRequest;
    const { walletAddress, chainIds, protocols, includeInactive } = event.payload;

    const requestStartTime = Date.now();

    try {
      logger.debug('Processing individual portfolio request', {
        eventId: event.id,
        walletAddress,
        requestKey: batchedRequest.requestKey,
      });

      // Call the DeFi orchestrator to get portfolio data
      const portfolioResponse = await this.orchestrator.getDeFiPortfolio(walletAddress, {
        chainIds,
        protocols: protocols as DeFiProtocol[] | undefined,
        includeInactive,
      });

      const requestDuration = Date.now() - requestStartTime;
      this.stats.totalComputationTime += requestDuration;
      this.stats.requestsProcessed++;

      if (portfolioResponse.success && portfolioResponse.data) {
        // Publish DeFi positions fetched event
        const positionsFetchedEvent = createEvent.deFiPositionsFetched(
          walletAddress,
          portfolioResponse.data.positions,
          {
            cacheHit: portfolioResponse.metadata.cacheHit || false,
            executionTimeMs: requestDuration,
          }
        );

        await this.eventBus.publish(positionsFetchedEvent, {
          correlationId: event.id,
          source: 'PortfolioWorker',
          priority: 'medium',
        });

        // Publish portfolio computed event
        const portfolioComputedEvent = createEvent.portfolioComputed(
          walletAddress,
          portfolioResponse.data,
          requestDuration
        );

        await this.eventBus.publish(portfolioComputedEvent, {
          correlationId: event.id,
          source: 'PortfolioWorker',
          priority: 'medium',
        });

        logger.info('Portfolio computation completed successfully', {
          eventId: event.id,
          walletAddress,
          duration: requestDuration,
          positionCount: portfolioResponse.data.positions.length,
          totalValueUSD: portfolioResponse.data.totalValueUSD,
        });
      } else {
        // Handle error case
        await this.handleComputationError(
          event,
          portfolioResponse.error?.message || 'Unknown error',
          portfolioResponse.error?.code || 'COMPUTATION_ERROR',
          requestDuration
        );
      }
    } catch (error) {
      const requestDuration = Date.now() - requestStartTime;
      this.stats.errors++;

      await this.handleComputationError(
        event,
        error instanceof Error ? error.message : 'Unknown error',
        'WORKER_ERROR',
        requestDuration
      );
    }
  }

  /**
   * Handle computation errors
   */
  private async handleComputationError(
    originalEvent: DeFiPositionsRequestedV1,
    error: string,
    errorCode: string,
    duration: number
  ): Promise<void> {
    logger.error('Portfolio computation failed', {
      eventId: originalEvent.id,
      walletAddress: originalEvent.payload.walletAddress,
      error,
      errorCode,
      duration,
    });

    const failureEvent = createEvent.portfolioComputationFailed(
      originalEvent.payload.walletAddress,
      error,
      errorCode,
      0, // retry count - would be managed by the event bus
      false // will retry - would be determined by retry policy
    );

    try {
      await this.eventBus.publish(failureEvent, {
        correlationId: originalEvent.id,
        source: 'PortfolioWorker',
        priority: 'high', // High priority for error handling
      });
    } catch (publishError) {
      logger.error('Failed to publish computation failure event', {
        originalEventId: originalEvent.id,
        error: publishError instanceof Error ? publishError.message : 'Unknown error',
      });
    }
  }
}

/**
 * Configuration for the Portfolio Worker
 */
export interface PortfolioWorkerConfig {
  /**
   * Batching window in milliseconds (50-150ms range recommended)
   */
  batchWindowMs?: number;
  /**
   * Maximum batch size before forcing processing
   */
  maxBatchSize?: number;
  /**
   * TTL for deduplication cache in seconds
   */
  deduplicationTTLSeconds?: number;
}

/**
 * Batched request information
 */
interface BatchedRequest {
  event: DeFiPositionsRequestedV1;
  requestKey: string;
  addedAt: number;
}

/**
 * Factory function to create Portfolio Worker
 */
export const createPortfolioWorker = (
  eventBus: EventBusPort,
  orchestrator: DeFiOrchestrator,
  config?: PortfolioWorkerConfig
): PortfolioWorker => {
  return new PortfolioWorker(eventBus, orchestrator, config);
};
