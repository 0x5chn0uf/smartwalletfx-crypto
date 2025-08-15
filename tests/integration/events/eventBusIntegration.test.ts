import { EventBusFactory, getEventBus, resetEventBus } from '@/events/EventBusFactory';
import { PortfolioWorker } from '@/workers/portfolioWorker';
import { WorkerManager } from '@/workers/WorkerManager';
import { createEvent, EventTypes } from '@/events/types';
import { DeFiOrchestrator } from '@/services/defi/DeFiOrchestrator';
import { ChainId } from '@/types/blockchain';
import { DeFiProtocol } from '@/types/defi';

// Mock Redis for testing
jest.mock('@/utils/redis', () => ({
  redisManager: {
    exists: jest.fn().mockResolvedValue(false),
    set: jest.fn().mockResolvedValue(true),
    get: jest.fn().mockResolvedValue(null),
    connect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue('PONG'),
    getClient: jest.fn().mockReturnValue({
      options: { socket: { host: 'localhost', port: 6379 } },
    }),
  },
}));

// Mock logger
jest.mock('@/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock DeFi Orchestrator
const mockDeFiOrchestrator = {
  getDeFiPortfolio: jest.fn(),
  initialize: jest.fn().mockResolvedValue(undefined),
  getRegisteredProtocols: jest.fn().mockReturnValue([DeFiProtocol.AAVE_V3]),
  getHealthStatus: jest.fn().mockReturnValue({}),
  stop: jest.fn().mockResolvedValue(undefined),
} as unknown as DeFiOrchestrator;

describe('Event Bus Integration Tests', () => {
  beforeEach(() => {
    resetEventBus();
    jest.clearAllMocks();
  });

  afterEach(() => {
    resetEventBus();
  });

  describe('EventBusFactory', () => {
    it('should create InMemory event bus for test environment', () => {
      process.env.NODE_ENV = 'test';
      const eventBus = EventBusFactory.create();
      expect(eventBus.constructor.name).toBe('InMemoryEventBusAdapter');
    });

    it('should create BullMQ event bus for production', () => {
      process.env.NODE_ENV = 'production';
      const eventBus = EventBusFactory.create();
      expect(eventBus.constructor.name).toBe('BullMQEventBusAdapter');
    });

    it('should respect explicit event bus type configuration', () => {
      process.env.EVENT_BUS_TYPE = 'memory';
      process.env.NODE_ENV = 'production';
      
      const eventBus = EventBusFactory.create();
      expect(eventBus.constructor.name).toBe('InMemoryEventBusAdapter');
    });
  });

  describe('End-to-End Portfolio Processing', () => {
    let workerManager: WorkerManager;
    let eventBus: any;

    beforeEach(async () => {
      // Use in-memory event bus for testing
      eventBus = EventBusFactory.createInMemory({
        defaultRetries: 1,
        defaultRetryDelay: 10,
        healthCheckInterval: 1000,
      });

      // Mock successful portfolio response
      (mockDeFiOrchestrator.getDeFiPortfolio as jest.Mock).mockResolvedValue({
        success: true,
        data: {
          address: '0x123456789abcdef',
          totalValueUSD: 5000,
          netValueUSD: 4800,
          totalSuppliedUSD: 5000,
          totalBorrowedUSD: 200,
          totalRewardsUSD: 0,
          positions: [
            {
              id: 'position-1',
              protocol: DeFiProtocol.AAVE_V3,
              chainId: ChainId.ETHEREUM,
              type: 'lending',
              totalValueUSD: 5000,
              suppliedTokens: [
                {
                  address: '0xA0b86a33E6441e7f6e56ff6dd9cf26ac7d6cd5e',
                  symbol: 'USDC',
                  amount: '5000000000', // 5000 USDC
                  valueUSD: 5000,
                },
              ],
              borrowedTokens: [
                {
                  address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
                  symbol: 'WETH',
                  amount: '100000000000000000', // 0.1 ETH
                  valueUSD: 200,
                },
              ],
              riskMetrics: {
                healthFactor: 2.5,
                liquidationRisk: 'LOW' as const,
                liquidationThreshold: 0.8,
              },
            },
          ],
          protocolDistribution: [
            {
              protocol: DeFiProtocol.AAVE_V3,
              valueUSD: 5000,
              percentage: 100,
              positionCount: 1,
            },
          ],
          chainDistribution: [
            {
              chainId: ChainId.ETHEREUM,
              valueUSD: 5000,
              percentage: 100,
              positionCount: 1,
            },
          ],
          typeDistribution: [
            {
              type: 'lending',
              valueUSD: 5000,
              percentage: 100,
              positionCount: 1,
            },
          ],
          riskSummary: {
            overallRisk: 'LOW' as const,
            positionsAtRisk: 0,
            totalCollateralUSD: 5000,
            averageHealthFactor: 2.5,
            liquidationThreshold: 0.8,
          },
          yieldSummary: {
            totalYieldUSD24h: 5.5,
            totalYieldUSDLifetime: 2007.5,
            averageAPY: 4.0,
          },
          lastUpdated: new Date(),
        },
        metadata: {
          provider: 'DeFiOrchestrator',
          timestamp: Date.now(),
          requestId: 'test-request-123',
          cacheHit: false,
          executionTime: 250,
        },
      });

      workerManager = new WorkerManager(eventBus, mockDeFiOrchestrator, {
        healthCheckIntervalMs: 1000,
      });

      await workerManager.start();
    });

    afterEach(async () => {
      if (workerManager) {
        await workerManager.stop();
      }
      if (eventBus) {
        await eventBus.shutdown();
      }
    });

    it('should process portfolio requests end-to-end', async () => {
      const publishedEvents: any[] = [];
      
      // Subscribe to all events to track what gets published
      await eventBus.subscribe('DeFiPositionsFetchedV1', (event: any) => {
        publishedEvents.push({ type: 'fetched', event });
      });
      
      await eventBus.subscribe('PortfolioComputedV1', (event: any) => {
        publishedEvents.push({ type: 'computed', event });
      });

      // Publish a portfolio request
      const requestEvent = createEvent.deFiPositionsRequested(
        '0x123456789abcdef',
        {
          chainIds: [ChainId.ETHEREUM],
          protocols: [DeFiProtocol.AAVE_V3],
          includeInactive: false,
        }
      );

      await eventBus.publish(requestEvent);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify DeFi orchestrator was called
      expect(mockDeFiOrchestrator.getDeFiPortfolio).toHaveBeenCalledWith(
        '0x123456789abcdef',
        {
          chainIds: [ChainId.ETHEREUM],
          protocols: [DeFiProtocol.AAVE_V3],
          includeInactive: false,
        }
      );

      // Verify events were published
      expect(publishedEvents).toHaveLength(2);
      
      const fetchedEvent = publishedEvents.find(e => e.type === 'fetched');
      const computedEvent = publishedEvents.find(e => e.type === 'computed');
      
      expect(fetchedEvent).toBeDefined();
      expect(computedEvent).toBeDefined();
      
      // Verify event data
      expect(fetchedEvent.event.payload.walletAddress).toBe('0x123456789abcdef');
      expect(fetchedEvent.event.payload.totalValueUSD).toBe(5000);
      expect(fetchedEvent.event.payload.protocolCount).toBe(1);
      
      expect(computedEvent.event.payload.walletAddress).toBe('0x123456789abcdef');
      expect(computedEvent.event.payload.portfolio.totalValueUSD).toBe(5000);
      expect(computedEvent.event.payload.positionCount).toBe(1);
    });

    it('should handle multiple concurrent requests with batching', async () => {
      const walletAddresses = [
        '0x111111111111111111111111',
        '0x222222222222222222222222',
        '0x333333333333333333333333',
      ];

      // Publish multiple requests quickly
      const requests = walletAddresses.map(address => 
        createEvent.deFiPositionsRequested(address)
      );

      for (const request of requests) {
        await eventBus.publish(request);
      }

      // Wait for batch processing
      await new Promise(resolve => setTimeout(resolve, 200));

      // All requests should have been processed
      expect(mockDeFiOrchestrator.getDeFiPortfolio).toHaveBeenCalledTimes(3);

      // Check worker stats
      const workerStats = workerManager.getDetailedStats();
      const portfolioWorkerStats = workerStats.portfolio;
      
      expect(portfolioWorkerStats.requestsReceived).toBe(3);
      expect(portfolioWorkerStats.requestsProcessed).toBe(3);
      expect(portfolioWorkerStats.batchesProcessed).toBeGreaterThanOrEqual(1);
    });

    it('should handle errors gracefully', async () => {
      // Mock an error response
      (mockDeFiOrchestrator.getDeFiPortfolio as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: {
          code: 'RPC_ERROR',
          message: 'RPC endpoint unavailable',
        },
      });

      const errorEvents: any[] = [];
      await eventBus.subscribe('PortfolioComputationFailedV1', (event: any) => {
        errorEvents.push(event);
      });

      const requestEvent = createEvent.deFiPositionsRequested('0x123456789abcdef');
      await eventBus.publish(requestEvent);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should have published error event
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].payload.error).toBe('RPC endpoint unavailable');
      expect(errorEvents[0].payload.errorCode).toBe('RPC_ERROR');
    });
  });

  describe('Worker Manager Health Monitoring', () => {
    let workerManager: WorkerManager;
    let eventBus: any;

    beforeEach(async () => {
      eventBus = EventBusFactory.createInMemory();
      workerManager = new WorkerManager(eventBus, mockDeFiOrchestrator);
      await workerManager.start();
    });

    afterEach(async () => {
      if (workerManager) {
        await workerManager.stop();
      }
      if (eventBus) {
        await eventBus.shutdown();
      }
    });

    it('should report healthy status when all workers are running', async () => {
      const health = await workerManager.getHealthStatus();
      
      expect(health.status).toBe('healthy');
      expect(health.isRunning).toBe(true);
      expect(health.totalWorkers).toBe(1); // Portfolio worker
      expect(health.healthyWorkers).toBe(1);
      expect(health.workers.portfolio).toBeDefined();
      expect(health.workers.portfolio.isHealthy).toBe(true);
    });

    it('should provide detailed worker statistics', async () => {
      const stats = workerManager.getDetailedStats();
      
      expect(stats.portfolio).toBeDefined();
      expect(stats.portfolio.name).toBe('Portfolio Worker');
      expect(stats.portfolio.status).toBe('running');
      expect(stats.portfolio.requestsReceived).toBeDefined();
      expect(stats.portfolio.requestsProcessed).toBeDefined();
    });
  });

  describe('Performance Requirements', () => {
    let workerManager: WorkerManager;
    let eventBus: any;

    beforeEach(async () => {
      eventBus = EventBusFactory.createInMemory({
        defaultRetries: 0, // No retries for performance testing
        defaultRetryDelay: 0,
        healthCheckInterval: 5000,
      });

      // Mock fast responses
      (mockDeFiOrchestrator.getDeFiPortfolio as jest.Mock).mockImplementation(
        () => new Promise(resolve => {
          setTimeout(() => resolve({
            success: true,
            data: {
              address: '0x123',
              totalValueUSD: 1000,
              positions: [],
              protocolDistribution: [],
              chainDistribution: [],
              typeDistribution: [],
              riskSummary: {},
              yieldSummary: {},
              lastUpdated: new Date(),
            },
            metadata: { cacheHit: false, executionTime: 50 },
          }), 10); // 10ms response time
        })
      );

      workerManager = new WorkerManager(eventBus, mockDeFiOrchestrator, {
        healthCheckIntervalMs: 5000,
      });
      await workerManager.start();
    });

    afterEach(async () => {
      if (workerManager) {
        await workerManager.stop();
      }
      if (eventBus) {
        await eventBus.shutdown();
      }
    });

    it('should meet performance target of ≥100 computations/minute', async () => {
      const startTime = Date.now();
      const targetComputations = 20; // Test with smaller number for speed
      
      // Generate unique wallet addresses
      const requests = Array.from({ length: targetComputations }, (_, i) => 
        createEvent.deFiPositionsRequested(`0x${'0'.repeat(36)}${i.toString().padStart(4, '0')}`)
      );

      // Publish all requests
      for (const request of requests) {
        await eventBus.publish(request);
      }

      // Wait for all processing to complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      const endTime = Date.now();
      const duration = endTime - startTime;
      const computationsPerMinute = (targetComputations / duration) * 60000;

      // Verify all requests were processed
      expect(mockDeFiOrchestrator.getDeFiPortfolio).toHaveBeenCalledTimes(targetComputations);
      
      const stats = workerManager.getDetailedStats();
      expect(stats.portfolio.requestsProcessed).toBe(targetComputations);
      
      // Performance assertion (adjusted for test scale)
      expect(computationsPerMinute).toBeGreaterThanOrEqual(100);
    }, 10000); // 10 second timeout
  });
});
