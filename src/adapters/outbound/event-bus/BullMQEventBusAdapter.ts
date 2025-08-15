import { Queue, Worker, Job, QueueOptions, WorkerOptions, JobsOptions } from 'bullmq';
import { EventBusPort, EventHandler, SubscriptionOptions, EventBusHealth, EventBusConfig } from '@/ports/EventBusPort';
import { DomainEvent, EventMetadata } from '@/events/types';
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
  private subscriptions: Map<string, SubscriptionInfo> = new Map();
  private config: EventBusConfig;
  private isShuttingDown = false;
  private readonly redisConnection;

  constructor(config: Partial<EventBusConfig> = {}) {
    this.config = {
      defaultRetries: 3,
      defaultRetryDelay: 5000,
      defaultConcurrency: 5,
      enableDLQ: true,
      healthCheckInterval: 30000,
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

  async publish<T extends DomainEvent>(event: T, metadata?: EventMetadata): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Event bus is shutting down');
    }

    const eventMetadata: EventMetadata = {
      source: 'BullMQEventBus',
      correlationId: uuidv4(),
      priority: 'medium',
      retryCount: 0,
      ...metadata,
    };

    const queueName = this.getQueueName(event.type);
    let queue = this.queues.get(queueName);
    
    if (!queue) {
      queue = await this.createQueue(queueName);
    }

    try {
      const jobOptions: JobsOptions = {
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 50, // Keep last 50 failed jobs
        attempts: this.config.defaultRetries + 1,
        backoff: {
          type: 'exponential',
          delay: this.config.defaultRetryDelay,
        },
        priority: this.getPriority(eventMetadata.priority),
      };

      if (eventMetadata.ttl) {
        (jobOptions as any).ttl = eventMetadata.ttl * 1000; // Convert to milliseconds
      }

      await queue.add(
        event.type,
        {
          event,
          metadata: eventMetadata,
        },
        jobOptions
      );

      logger.debug('Event published to BullMQ', {
        eventType: event.type,
        eventId: event.id,
        queueName,
        metadata: eventMetadata,
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

  async subscribe<T extends DomainEvent>(
    eventType: string,
    handler: EventHandler<T>,
    options: SubscriptionOptions = {}
  ): Promise<string> {
    if (this.isShuttingDown) {
      throw new Error('Event bus is shutting down');
    }

    const subscriptionId = uuidv4();
    const queueName = options.queue || this.getQueueName(eventType);
    const subscriptionOptions = {
      maxRetries: this.config.defaultRetries,
      retryDelay: this.config.defaultRetryDelay,
      concurrency: this.config.defaultConcurrency,
      enableDLQ: this.config.enableDLQ,
      queue: queueName,
      ...options,
    };

    // Ensure queue exists
    let queue = this.queues.get(queueName);
    if (!queue) {
      queue = await this.createQueue(queueName);
    }

    // Create worker for this subscription
    const worker = await this.createWorker(
      queueName,
      eventType,
      handler,
      subscriptionOptions
    );

    // Store subscription info
    this.subscriptions.set(subscriptionId, {
      eventType,
      queueName,
      worker,
      options: subscriptionOptions,
      subscribedAt: new Date(),
    });

    logger.info('BullMQ subscription created', {
      subscriptionId,
      eventType,
      queueName,
      options: subscriptionOptions,
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

  async healthCheck(): Promise<EventBusHealth> {
    const errors: string[] = [];
    const queueSizes: Record<string, number> = {};
    let totalLatency = 0;
    let healthyQueues = 0;

    // Check all queues
    for (const [queueName, queue] of this.queues) {
      try {
        const [waiting, active, completed, failed] = await Promise.all([
          queue.getWaiting(),
          queue.getActive(),
          queue.getCompleted(),
          queue.getFailed(),
        ]);

        queueSizes[queueName] = waiting.length + active.length;
        healthyQueues++;

        // Simple latency check
        const start = Date.now();
        await (queue.client as any).ping?.();
        totalLatency += Date.now() - start;

      } catch (error) {
        errors.push(`Queue ${queueName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    const averageLatency = this.queues.size > 0 ? totalLatency / this.queues.size : 0;

    return {
      status: isHealthy ? 'healthy' : errors.length === this.queues.size ? 'unhealthy' : 'degraded',
      connected: redisConnected,
      latency: averageLatency,
      queueSizes,
      errors: errors.length > 0 ? errors : undefined,
      lastCheckTime: new Date(),
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
        attempts: this.config.defaultRetries + 1,
        backoff: {
          type: 'exponential',
          delay: this.config.defaultRetryDelay,
        },
      },
    };

    const queue = new Queue(queueName, queueOptions);
    this.queues.set(queueName, queue);

    // Set up queue event handlers
    queue.on('error', (error) => {
      logger.error(`Queue ${queueName} error:`, { error: error.message });
    });

    queue.on('waiting', (job) => {
      logger.debug(`Job waiting in queue ${queueName}:`, { jobId: job.id });
    });

    logger.info(`Created BullMQ queue: ${queueName}`);
    return queue;
  }

  /**
   * Create a new worker
   */
  private async createWorker<T extends DomainEvent>(
    queueName: string,
    eventType: string,
    handler: EventHandler<T>,
    options: SubscriptionOptions
  ): Promise<Worker> {
    const workerOptions: WorkerOptions = {
      connection: this.redisConnection,
      concurrency: options.concurrency || this.config.defaultConcurrency,
    };

    const processJob = async (job: Job) => {
      const { event, metadata } = job.data;
      
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

        await handler(event, metadata);

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
    worker.on('completed', (job) => {
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

    worker.on('error', (error) => {
      logger.error(`Worker error in queue ${queueName}:`, { error: error.message });
    });

    // Handle dead letter queue
    if (options.enableDLQ) {
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
      'DeFiPositionsRequestedV1': 'portfolio',
      'DeFiPositionsFetchedV1': 'portfolio',
      'PortfolioComputedV1': 'portfolio',
      'CacheWarmingRequestedV1': 'cache-warm',
      'PortfolioComputationFailedV1': 'portfolio',
    };

    return queueMap[eventType] || 'default';
  }

  /**
   * Convert priority to BullMQ priority number
   */
  private getPriority(priority?: string): number {
    const priorityMap: Record<string, number> = {
      'critical': 10,
      'high': 5,
      'medium': 0,
      'low': -5,
    };

    return priorityMap[priority || 'medium'];
  }
}

/**
 * Subscription information for BullMQ
 */
interface SubscriptionInfo {
  eventType: string;
  queueName: string;
  worker: Worker;
  options: SubscriptionOptions;
  subscribedAt: Date;
}

/**
 * Factory function to create BullMQEventBusAdapter
 */
export const createBullMQEventBus = (config?: Partial<EventBusConfig>): BullMQEventBusAdapter => {
  return new BullMQEventBusAdapter(config);
};
