import { EventBusPort } from '@/ports/EventBusPort';
import { PortfolioWorker, PortfolioWorkerConfig, createPortfolioWorker } from './portfolioWorker';
import { DeFiOrchestrator } from '@/services/defi/DeFiOrchestrator';
import { logger } from '@/utils/logger';
import { 
  updateWorkerHealth, 
  updateQueueDepth, 
  recordWorkerJob,
  updateMonthlyCost,
  updateProviderBudgetUtilization 
} from '@/utils/metrics';

/**
 * Worker Manager
 *
 * Manages all worker processes with health monitoring and graceful shutdown.
 * Provides centralized control over worker lifecycle and monitoring.
 */
export class WorkerManager {
  private workers: Map<string, WorkerInfo> = new Map();
  private eventBus: EventBusPort;
  private orchestrator: DeFiOrchestrator;
  private isRunning = false;
  private healthCheckInterval?: NodeJS.Timeout;
  private readonly healthCheckIntervalMs: number;

  constructor(
    eventBus: EventBusPort,
    orchestrator: DeFiOrchestrator,
    config: WorkerManagerConfig = {}
  ) {
    this.eventBus = eventBus;
    this.orchestrator = orchestrator;
    this.healthCheckIntervalMs = config.healthCheckIntervalMs ?? 30000; // 30 seconds

    logger.info('WorkerManager initialized', {
      healthCheckInterval: this.healthCheckIntervalMs,
    });
  }

  /**
   * Start all workers and health monitoring
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('WorkerManager is already running');
      return;
    }

    try {
      logger.info('Starting WorkerManager...');

      // Initialize portfolio worker
      await this.createPortfolioWorker();

      // Start all workers
      const startPromises = Array.from(this.workers.values()).map(async workerInfo => {
        try {
          await workerInfo.worker.start();
          workerInfo.status = 'running';
          workerInfo.startedAt = new Date();
          
          // Update worker health metrics
          updateWorkerHealth(workerInfo.name, 'default', true);
          
          logger.info(`Worker ${workerInfo.name} started successfully`);
        } catch (error) {
          workerInfo.status = 'failed';
          workerInfo.lastError = error instanceof Error ? error.message : 'Unknown error';
          
          // Update worker health metrics
          updateWorkerHealth(workerInfo.name, 'default', false);
          
          logger.error(`Failed to start worker ${workerInfo.name}:`, {
            error: workerInfo.lastError,
          });
          throw error;
        }
      });

      await Promise.all(startPromises);

      // Start health monitoring
      this.startHealthMonitoring();

      this.isRunning = true;
      logger.info('WorkerManager started successfully', {
        workerCount: this.workers.size,
        workers: Array.from(this.workers.keys()),
      });
    } catch (error) {
      logger.error('Failed to start WorkerManager', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Cleanup on failure
      await this.stop();
      throw error;
    }
  }

  /**
   * Stop all workers and health monitoring
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping WorkerManager...');
    this.isRunning = false;

    // Stop health monitoring
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    // Stop all workers
    const stopPromises = Array.from(this.workers.values()).map(async workerInfo => {
      try {
        await workerInfo.worker.stop();
        workerInfo.status = 'stopped';
        workerInfo.stoppedAt = new Date();
        
        // Update worker health metrics
        updateWorkerHealth(workerInfo.name, 'default', false);
        
        logger.info(`Worker ${workerInfo.name} stopped successfully`);
      } catch (error) {
        workerInfo.status = 'failed';
        workerInfo.lastError = error instanceof Error ? error.message : 'Unknown error';
        
        // Update worker health metrics
        updateWorkerHealth(workerInfo.name, 'default', false);
        
        logger.error(`Error stopping worker ${workerInfo.name}:`, {
          error: workerInfo.lastError,
        });
      }
    });

    await Promise.allSettled(stopPromises);

    logger.info('WorkerManager stopped', {
      workerCount: this.workers.size,
    });
  }

  /**
   * Get health status of all workers
   */
  async getHealthStatus(): Promise<WorkerManagerHealth> {
    const workerHealthStatuses: Record<string, WorkerHealthStatus> = {};
    let healthyWorkers = 0;
    let totalWorkers = this.workers.size;

    for (const [workerId, workerInfo] of this.workers) {
      try {
        const stats = workerInfo.worker.getStats();
        const isHealthy = workerInfo.status === 'running' && stats.isRunning;

        workerHealthStatuses[workerId] = {
          name: workerInfo.name,
          status: workerInfo.status,
          isHealthy,
          stats,
          startedAt: workerInfo.startedAt,
          lastError: workerInfo.lastError,
          uptime: workerInfo.startedAt ? Date.now() - workerInfo.startedAt.getTime() : 0,
        };

        if (isHealthy) {
          healthyWorkers++;
        }
        
        // Update Prometheus metrics for worker health
        updateWorkerHealth(workerId, 'default', isHealthy);
        
        // Update queue depth metrics if available from worker stats
        if (stats && typeof stats === 'object') {
          const waiting = (stats as any).queueLength || 0;
          const active = (stats as any).activeJobs || 0;
          const completed = (stats as any).completedJobs || 0;
          const failed = (stats as any).failedJobs || 0;
          
          updateQueueDepth(workerInfo.name, waiting, active, completed, failed);
        }
      } catch (error) {
        workerHealthStatuses[workerId] = {
          name: workerInfo.name,
          status: 'failed',
          isHealthy: false,
          stats: null,
          lastError: error instanceof Error ? error.message : 'Health check failed',
          uptime: 0,
        };
      }
    }

    const overallStatus = this.determineOverallStatus(healthyWorkers, totalWorkers);

    return {
      status: overallStatus,
      isRunning: this.isRunning,
      totalWorkers,
      healthyWorkers,
      workers: workerHealthStatuses,
      lastHealthCheck: new Date(),
    };
  }

  /**
   * Get detailed statistics for all workers
   */
  getDetailedStats(): Record<string, any> {
    const stats: Record<string, any> = {};

    for (const [workerId, workerInfo] of this.workers) {
      try {
        stats[workerId] = {
          name: workerInfo.name,
          status: workerInfo.status,
          ...workerInfo.worker.getStats(),
          startedAt: workerInfo.startedAt,
          stoppedAt: workerInfo.stoppedAt,
          lastError: workerInfo.lastError,
        };
      } catch (error) {
        stats[workerId] = {
          name: workerInfo.name,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }

    return stats;
  }

  /**
   * Restart a specific worker
   */
  async restartWorker(workerId: string): Promise<void> {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) {
      throw new Error(`Worker ${workerId} not found`);
    }

    logger.info(`Restarting worker ${workerId}...`);

    try {
      // Stop the worker
      await workerInfo.worker.stop();
      workerInfo.status = 'restarting';

      // Wait a moment before restarting
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Start the worker
      await workerInfo.worker.start();
      workerInfo.status = 'running';
      workerInfo.startedAt = new Date();
      workerInfo.lastError = undefined;
      
      // Update worker health metrics
      updateWorkerHealth(workerId, 'default', true);

      logger.info(`Worker ${workerId} restarted successfully`);
    } catch (error) {
      workerInfo.status = 'failed';
      workerInfo.lastError = error instanceof Error ? error.message : 'Unknown error';
      
      // Update worker health metrics
      updateWorkerHealth(workerId, 'default', false);

      logger.error(`Failed to restart worker ${workerId}:`, {
        error: workerInfo.lastError,
      });

      throw error;
    }
  }

  /**
   * Create the portfolio worker
   */
  private async createPortfolioWorker(): Promise<void> {
    const config: PortfolioWorkerConfig = {
      batchWindowMs: 100, // 100ms batching window
      maxBatchSize: 15, // Max 15 requests per batch
      deduplicationTTLSeconds: 300, // 5 minutes deduplication
    };

    const portfolioWorker = createPortfolioWorker(this.eventBus, this.orchestrator, config);

    this.workers.set('portfolio', {
      name: 'Portfolio Worker',
      worker: portfolioWorker,
      status: 'initializing',
      createdAt: new Date(),
    });

    logger.info('Portfolio worker created');
  }

  /**
   * Start health monitoring for all workers
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.getHealthStatus();

        // Log health status
        if (health.status !== 'healthy') {
          logger.warn('Worker health check detected issues', {
            status: health.status,
            healthyWorkers: health.healthyWorkers,
            totalWorkers: health.totalWorkers,
          });
        } else {
          logger.debug('Worker health check passed', {
            healthyWorkers: health.healthyWorkers,
            totalWorkers: health.totalWorkers,
          });
        }

        // Auto-restart failed workers if configured
        for (const [workerId, workerHealth] of Object.entries(health.workers)) {
          if (!workerHealth.isHealthy && workerHealth.status === 'failed') {
            logger.warn(`Auto-restarting failed worker: ${workerId}`);
            try {
              await this.restartWorker(workerId);
            } catch (error) {
              logger.error(`Failed to auto-restart worker ${workerId}:`, {
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }
        }
      } catch (error) {
        logger.error('Worker health monitoring failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }, this.healthCheckIntervalMs);
  }

  /**
   * Determine overall health status
   */
  private determineOverallStatus(
    healthyWorkers: number,
    totalWorkers: number
  ): 'healthy' | 'degraded' | 'unhealthy' {
    if (totalWorkers === 0) {
      return 'unhealthy';
    }

    const healthyRatio = healthyWorkers / totalWorkers;

    if (healthyRatio === 1.0) {
      return 'healthy';
    } else if (healthyRatio >= 0.5) {
      return 'degraded';
    } else {
      return 'unhealthy';
    }
  }
}

/**
 * Worker Manager Configuration
 */
export interface WorkerManagerConfig {
  healthCheckIntervalMs?: number;
}

/**
 * Worker information for tracking
 */
interface WorkerInfo {
  name: string;
  worker: PortfolioWorker; // Could be extended to support other worker types
  status: WorkerStatus;
  createdAt: Date;
  startedAt?: Date;
  stoppedAt?: Date;
  lastError?: string;
}

/**
 * Worker status enumeration
 */
type WorkerStatus = 'initializing' | 'running' | 'stopped' | 'failed' | 'restarting';

/**
 * Worker Manager Health Status
 */
export interface WorkerManagerHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  isRunning: boolean;
  totalWorkers: number;
  healthyWorkers: number;
  workers: Record<string, WorkerHealthStatus>;
  lastHealthCheck: Date;
}

/**
 * Individual Worker Health Status
 */
export interface WorkerHealthStatus {
  name: string;
  status: WorkerStatus;
  isHealthy: boolean;
  stats: any | null;
  startedAt?: Date;
  lastError?: string;
  uptime: number;
}

/**
 * Factory function to create Worker Manager
 */
export const createWorkerManager = (
  eventBus: EventBusPort,
  orchestrator: DeFiOrchestrator,
  config?: WorkerManagerConfig
): WorkerManager => {
  return new WorkerManager(eventBus, orchestrator, config);
};
