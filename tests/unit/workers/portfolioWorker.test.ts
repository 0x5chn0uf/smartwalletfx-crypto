import { PortfolioWorker } from '@/workers/portfolioWorker';
import { InMemoryEventBusAdapter } from '@/adapters/outbound/event-bus/InMemoryEventBusAdapter';
import { DeFiOrchestrator } from '@/services/defi/DeFiOrchestrator';
import { createEvent, EventTypes } from '@/events/types';
import { ChainId } from '@/types/blockchain';
import { DeFiProtocol } from '@/types/defi';
import { redisManager } from '@/utils/redis';

// Mock dependencies
jest.mock('@/utils/redis', () => ({
  redisManager: {
    exists: jest.fn(),
    set: jest.fn(),
    get: jest.fn(),
  },
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock DeFi Orchestrator
const mockOrchestrator = {
  getDeFiPortfolio: jest.fn(),
  initialize: jest.fn(),
} as unknown as DeFiOrchestrator;

describe('PortfolioWorker', () => {
  let eventBus: InMemoryEventBusAdapter;
  let portfolioWorker: PortfolioWorker;

  beforeEach(() => {
    eventBus = new InMemoryEventBusAdapter({
      defaultRetries: 1,
      defaultRetryDelay: 10,
      healthCheckInterval: 1000,
    });

    portfolioWorker = new PortfolioWorker(
      eventBus,
      mockOrchestrator,
      {
        batchWindowMs: 50, // Short window for testing
        maxBatchSize: 3,
        deduplicationTTLSeconds: 10,
      }
    );

    // Reset mocks
    jest.clearAllMocks();
    (redisManager.exists as jest.Mock).mockResolvedValue(false);
    (redisManager.set as jest.Mock).mockResolvedValue(true);
  });

  afterEach(async () => {
    await portfolioWorker.stop();
    await eventBus.shutdown();
  });

  describe('start and stop', () => {
    it('should start and stop successfully', async () => {
      await expect(portfolioWorker.start()).resolves.toBeUndefined();
      
      const stats = portfolioWorker.getStats();
      expect(stats.isRunning).toBe(true);

      await expect(portfolioWorker.stop()).resolves.toBeUndefined();
    });

    it('should not start twice', async () => {
      await portfolioWorker.start();
      await expect(portfolioWorker.start()).resolves.toBeUndefined(); // Should not throw
    });

    it('should handle stop when not running', async () => {
      await expect(portfolioWorker.stop()).resolves.toBeUndefined();
    });
  });

  describe('event processing', () => {
    beforeEach(async () => {
      // Mock successful portfolio response
      (mockOrchestrator.getDeFiPortfolio as jest.Mock).mockResolvedValue({
        success: true,
        data: {
          address: '0x123',
          totalValueUSD: 1000,
          positions: [
            {
              protocol: DeFiProtocol.AAVE_V3,
              totalValueUSD: 1000,
              suppliedTokens: [],
              chainId: ChainId.ETHEREUM,
            },
          ],
          protocolDistribution: [{ protocol: DeFiProtocol.AAVE_V3 }],
          chainDistribution: [{ chainId: ChainId.ETHEREUM }],
        },
        metadata: {
          cacheHit: false,
          executionTime: 100,
        },
      });

      await portfolioWorker.start();
    });

    it('should process DeFi positions requested events', async () => {
      const publishSpy = jest.spyOn(eventBus, 'publish');

      const event = createEvent.deFiPositionsRequested('0x123', {
        chainIds: [ChainId.ETHEREUM],
        protocols: [DeFiProtocol.AAVE_V3],
      });

      await eventBus.publish(event);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockOrchestrator.getDeFiPortfolio).toHaveBeenCalledWith(
        '0x123',
        {
          chainIds: [ChainId.ETHEREUM],
          protocols: [DeFiProtocol.AAVE_V3],
          includeInactive: undefined,
        }
      );

      // Should publish both fetched and computed events
      expect(publishSpy).toHaveBeenCalledTimes(3); // Original + 2 new events
    });

    it('should handle batch processing', async () => {
      const publishSpy = jest.spyOn(eventBus, 'publish');

      // Publish multiple events quickly
      const events = [
        createEvent.deFiPositionsRequested('0x123'),
        createEvent.deFiPositionsRequested('0x456'),
        createEvent.deFiPositionsRequested('0x789'),
      ];

      for (const event of events) {
        await eventBus.publish(event);
      }

      // Wait for batch processing
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(mockOrchestrator.getDeFiPortfolio).toHaveBeenCalledTimes(3);
      
      const stats = portfolioWorker.getStats();
      expect(stats.batchesProcessed).toBeGreaterThanOrEqual(1);
      expect(stats.requestsProcessed).toBe(3);
    });

    it('should deduplicate identical requests', async () => {
      // Mock Redis to return true for exists check (indicating duplicate)
      (redisManager.exists as jest.Mock)
        .mockResolvedValueOnce(false) // First request not duplicate
        .mockResolvedValueOnce(true); // Second request is duplicate

      const event1 = createEvent.deFiPositionsRequested('0x123', {
        chainIds: [ChainId.ETHEREUM],
        protocols: [DeFiProtocol.AAVE_V3],
      });
      
      const event2 = createEvent.deFiPositionsRequested('0x123', {
        chainIds: [ChainId.ETHEREUM],
        protocols: [DeFiProtocol.AAVE_V3],
      });

      await eventBus.publish(event1);
      await eventBus.publish(event2);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      const stats = portfolioWorker.getStats();
      expect(stats.requestsDeduplicated).toBe(1);
      expect(mockOrchestrator.getDeFiPortfolio).toHaveBeenCalledTimes(1);
    });

    it('should handle orchestrator errors', async () => {
      (mockOrchestrator.getDeFiPortfolio as jest.Mock).mockResolvedValue({
        success: false,
        error: {
          message: 'Test error',
          code: 'TEST_ERROR',
        },
      });

      const publishSpy = jest.spyOn(eventBus, 'publish');
      const event = createEvent.deFiPositionsRequested('0x123');

      await eventBus.publish(event);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      const stats = portfolioWorker.getStats();
      expect(stats.errors).toBe(1);
      
      // Should publish failure event
      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EventTypes.PORTFOLIO_COMPUTATION_FAILED_V1,
        }),
        expect.any(Object)
      );
    });

    it('should handle orchestrator exceptions', async () => {
      (mockOrchestrator.getDeFiPortfolio as jest.Mock).mockRejectedValue(
        new Error('Connection failed')
      );

      const event = createEvent.deFiPositionsRequested('0x123');
      await eventBus.publish(event);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      const stats = portfolioWorker.getStats();
      expect(stats.errors).toBe(1);
    });
  });

  describe('batching logic', () => {
    beforeEach(async () => {
      (mockOrchestrator.getDeFiPortfolio as jest.Mock).mockResolvedValue({
        success: true,
        data: {
          address: '0x123',
          totalValueUSD: 1000,
          positions: [],
          protocolDistribution: [],
          chainDistribution: [],
        },
        metadata: { cacheHit: false, executionTime: 50 },
      });

      await portfolioWorker.start();
    });

    it('should process batch when max size is reached', async () => {
      // Publish exactly maxBatchSize events
      for (let i = 0; i < 3; i++) {
        const event = createEvent.deFiPositionsRequested(`0x${i}`);
        await eventBus.publish(event);
      }

      // Should process immediately without waiting for batch window
      await new Promise(resolve => setTimeout(resolve, 10));

      const stats = portfolioWorker.getStats();
      expect(stats.batchesProcessed).toBe(1);
      expect(stats.requestsProcessed).toBe(3);
    });

    it('should process batch after window timeout', async () => {
      // Publish fewer than maxBatchSize events
      const event1 = createEvent.deFiPositionsRequested('0x123');
      const event2 = createEvent.deFiPositionsRequested('0x456');

      await eventBus.publish(event1);
      await eventBus.publish(event2);

      // Wait for batch window to expire
      await new Promise(resolve => setTimeout(resolve, 100));

      const stats = portfolioWorker.getStats();
      expect(stats.batchesProcessed).toBe(1);
      expect(stats.requestsProcessed).toBe(2);
    });
  });

  describe('statistics', () => {
    it('should track performance statistics', async () => {
      (mockOrchestrator.getDeFiPortfolio as jest.Mock).mockResolvedValue({
        success: true,
        data: {
          address: '0x123',
          totalValueUSD: 1000,
          positions: [],
          protocolDistribution: [],
          chainDistribution: [],
        },
        metadata: { cacheHit: false, executionTime: 100 },
      });

      await portfolioWorker.start();

      const event = createEvent.deFiPositionsRequested('0x123');
      await eventBus.publish(event);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      const stats = portfolioWorker.getStats();
      expect(stats.requestsReceived).toBe(1);
      expect(stats.requestsProcessed).toBe(1);
      expect(stats.totalComputationTime).toBeGreaterThan(0);
      expect(stats.averageComputationTime).toBeGreaterThan(0);
      expect(stats.batchesProcessed).toBe(1);
    });
  });
});
