import { Queue, Worker, Job, QueueOptions, WorkerOptions, JobsOptions } from 'bullmq';
import {
  EventBusPort,
  EventHandler,
  EventBusConfig,
  IntegrationEvent,
  PublishOptions,
  EventSubscription,
} from '@/ports/EventBusPort';
import { redisManager } from '@/utils/redis';
import { logger } from '@/utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * BullMQ Event Bus Adapter
 *
 * Production-ready event bus implementation using BullMQ and Redis.
 * Provides persistent queues, retry policies, dead letter queues,
 * and distributed processing capabilities.
 */
export class BullMQEventBusAdapter implements EventBusPort {
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  private subscriptions: Map<string, any> = new Map();
  private config: EventBusConfig;
  private isShuttingDown = false;
  private readonly redisConnection;

  constructor(config: Partial<EventBusConfig> = {}) {
    this.config = {
      adapter: 'bullmq',
      ...config,
    };

    // Use existing Redis connection
    const redisOptions = redisManager.getClient().options;
    this.redisConnection = {
      host: (redisOptions?.socket as any)?.host || 'localhost',
      port: (redisOptions?.socket as any)?.port || 6379,
      maxRetriesPerRequest: null, // BullMQ requirement
    };

    logger.info('BullMQEventBusAdapter initialized', {
      config: this.config,
      redisConnection: this.redisConnection,
    });
  }

  async initialize(): Promise<void> {
    // Nothing to do here, connection is handled by redisManager
  }

  async publish(event: IntegrationEvent, options?: PublishOptions): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Event bus is shutting down');
    }

    const queueName = this.getQueueName(event.type);
    let queue = this.queues.get(queueName);

    if (!queue) {
      queue = await this.createQueue(queueName);
    }

    try {
      const jobOptions: JobsOptions = {
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 50, // Keep last 50 failed jobs
        attempts: options?.maxRetries ? options.maxRetries + 1 : 4,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        priority: options?.priority,
        jobId: options?.idempotencyKey,
      };

      await queue.add(
        event.type,
        {
          event,
        },
        jobOptions
      );

      logger.debug('Event published to BullMQ', {
        eventType: event.type,
        eventId: event.id,
        queueName,
      });
    } catch (error) {
      logger.error('Failed to publish event to BullMQ', {
        eventType: event.type,
        eventId: event.id,
        queueName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async publishBatch(events: IntegrationEvent[], options?: PublishOptions): Promise<void> {
    for (const event of events) {
      await this.publish(event, options);
    }
  }

  async subscribe(
    eventType: string,
    handler: EventHandler,
    options?: EventSubscription['options']
  ): Promise<string> {
    if (this.isShuttingDown) {
      throw new Error('Event bus is shutting down');
    }

    const subscriptionId = uuidv4();
    const queueName = this.getQueueName(eventType);

    // Ensure queue exists
    let queue = this.queues.get(queueName);
    if (!queue) {
      queue = await this.createQueue(queueName);
    }

    // Create worker for this subscription
    const worker = await this.createWorker(queueName, eventType, handler, options);

    // Store subscription info
    this.subscriptions.set(subscriptionId, {
      eventType,
      queueName,
      worker,
      options,
      subscribedAt: new Date(),
    });

    logger.info('BullMQ subscription created', {
      subscriptionId,
      eventType,
      queueName,
      options: options,
    });

    return subscriptionId;
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      logger.warn('Attempted to unsubscribe from non-existent subscription', {
        subscriptionId,
      });
      return;
    }

    try {
      // Close the worker
      await subscription.worker.close();

      // Remove from workers map
      this.workers.delete(`${subscription.queueName}-${subscriptionId}`);

      // Remove from subscriptions
      this.subscriptions.delete(subscriptionId);

      logger.info('BullMQ subscription removed', {
        subscriptionId,
        eventType: subscription.eventType,
        queueName: subscription.queueName,
      });
    } catch (error) {
      logger.error('Error during unsubscribe', {
        subscriptionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async getHealth() {
    const errors: string[] = [];
    let healthyQueues = 0;

    // Check all queues
    for (const [queueName, queue] of this.queues) {
      try {
        await (queue.client as any).ping?.();
        healthyQueues++;
      } catch (error) {
        errors.push(
          `Queue ${queueName}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    // Check Redis connection
    let redisConnected = false;
    try {
      await redisManager.ping();
      redisConnected = true;
    } catch (error) {
      errors.push(`Redis: ${error instanceof Error ? error.message : 'Connection failed'}`);
    }

    const isHealthy = errors.length === 0 && redisConnected;

    return {
      isHealthy: isHealthy,
      stats: {
        publishedCount: 0,
        consumedCount: 0,
        errorCount: 0,
        activeSubscriptions: this.subscriptions.size,
      },
      adapter: 'bullmq',
      lastCheckedAt: new Date(),
    };
  }

  async getMetrics() {
    return {
      publishedEvents: {},
      consumedEvents: {},
      averageLatencyMs: {},
      errorRate: {},
      throughputPerSecond: 0,
    };
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down BullMQEventBusAdapter...');
    this.isShuttingDown = true;

    const shutdownPromises: Promise<void>[] = [];

    // Close all workers first
    for (const [workerId, worker] of this.workers) {
      shutdownPromises.push(
        worker.close().catch(error => {
          logger.error(`Error closing worker ${workerId}:`, {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        })
      );
    }

    // Close all queues
    for (const [queueName, queue] of this.queues) {
      shutdownPromises.push(
        queue.close().catch(error => {
          logger.error(`Error closing queue ${queueName}:`, {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        })
      );
    }

    await Promise.all(shutdownPromises);

    // Clear all maps
    this.workers.clear();
    this.queues.clear();
    this.subscriptions.clear();

    logger.info('BullMQEventBusAdapter shutdown complete');
  }

  /**
   * Create a new queue
   */
  private async createQueue(queueName: string): Promise<Queue> {
    const queueOptions: QueueOptions = {
      connection: this.redisConnection,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 4,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    };

    const queue = new Queue(queueName, queueOptions);
    this.queues.set(queueName, queue);

    // Set up queue event handlers
    queue.on('error', error => {
      logger.error(`Queue ${queueName} error:`, { error: error.message });
    });

    queue.on('waiting', job => {
      logger.debug(`Job waiting in queue ${queueName}:`, { jobId: job.id });
    });

    logger.info(`Created BullMQ queue: ${queueName}`);
    return queue;
  }

  /**
   * Create a new worker
   */
  private async createWorker(
    queueName: string,
    eventType: string,
    handler: EventHandler,
    options?: EventSubscription['options']
  ): Promise<Worker> {
    const workerOptions: WorkerOptions = {
      connection: this.redisConnection,
      concurrency: 10,
    };

    const processJob = async (job: Job) => {
      const { event } = job.data;

      // Only process events of the subscribed type
      if (event.type !== eventType) {
        return; // Skip this job
      }

      try {
        logger.debug(`Processing event in BullMQ worker`, {
          eventType: event.type,
          eventId: event.id,
          jobId: job.id,
          attempt: job.attemptsMade + 1,
        });

        await handler(event);

        logger.debug(`Event processed successfully`, {
          eventType: event.type,
          eventId: event.id,
          jobId: job.id,
        });
      } catch (error) {
        logger.error(`Event processing failed in BullMQ worker`, {
          eventType: event.type,
          eventId: event.id,
          jobId: job.id,
          attempt: job.attemptsMade + 1,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        throw error; // Let BullMQ handle retries
      }
    };

    const workerId = `${queueName}-${uuidv4()}`;
    const worker = new Worker(queueName, processJob, workerOptions);
    this.workers.set(workerId, worker);

    // Set up worker event handlers
    worker.on('completed', job => {
      logger.debug(`Job completed in queue ${queueName}:`, {
        jobId: job.id,
        duration: Date.now() - job.timestamp,
      });
    });

    worker.on('failed', (job, error) => {
      logger.warn(`Job failed in queue ${queueName}:`, {
        jobId: job?.id,
        error: error.message,
        attempts: job?.attemptsMade,
        maxAttempts: job?.opts?.attempts,
      });
    });

    worker.on('error', error => {
      logger.error(`Worker error in queue ${queueName}:`, { error: error.message });
    });

    // Handle dead letter queue
    if (options?.deadLetterQueue) {
      worker.on('failed', async (job, error) => {
        if (job && job.attemptsMade >= (job.opts?.attempts || 1)) {
          await this.handleDeadLetter(job, error);
        }
      });
    }

    logger.info(`Created BullMQ worker for queue: ${queueName}`);
    return worker;
  }

  /**
   * Handle failed jobs that exceed retry limits
   */
  private async handleDeadLetter(job: Job, error: Error): Promise<void> {
    const dlqName = `dlq-${job.queueName}`;

    try {
      let dlqQueue = this.queues.get(dlqName);
      if (!dlqQueue) {
        dlqQueue = await this.createQueue(dlqName);
      }

      await dlqQueue.add(
        'dead-letter',
        {
          originalJob: job.data,
          failureReason: error.message,
          failedAt: new Date(),
          originalJobId: job.id,
          attempts: job.attemptsMade,
        },
        {
          removeOnComplete: 1000,
          removeOnFail: 100,
        }
      );

      logger.warn('Job sent to dead letter queue', {
        originalJobId: job.id,
        dlqName,
        error: error.message,
      });
    } catch (dlqError) {
      logger.error('Failed to send job to dead letter queue', {
        originalJobId: job.id,
        error: dlqError instanceof Error ? dlqError.message : 'Unknown error',
      });
    }
  }

  /**
   * Get queue name for an event type
   */
  private getQueueName(eventType: string): string {
    // Map specific events to predefined queues
    const queueMap: Record<string, string> = {
      DeFiPositionsRequestedV1: 'portfolio',
      DeFiPositionsFetchedV1: 'portfolio',
      PortfolioComputedV1: 'portfolio',
      CacheWarmingRequestedV1: 'cache-warm',
      PortfolioComputationFailedV1: 'portfolio',
    };

    return queueMap[eventType] || 'default';
  }

  /**
   * Convert priority to BullMQ priority number
   */
  private getPriority(priority?: number): number {
    return priority || 0;
  }
}

/**
 * Factory function to create BullMQEventBusAdapter
 */
export const createBullMQEventBus = (config?: Partial<EventBusConfig>): BullMQEventBusAdapter => {
  return new BullMQEventBusAdapter(config);
};
