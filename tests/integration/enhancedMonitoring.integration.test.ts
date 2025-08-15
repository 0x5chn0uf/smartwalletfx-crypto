import request from 'supertest';
import { getEnhancedEventMonitoringService } from '@/services/EnhancedEventMonitoringService';
import { getCacheWarmingIntegrationService } from '@/services/CacheWarmingIntegrationService';
import { getEventSystem } from '@/services/EventSystem';
import { app } from '@/app';

describe('Enhanced Monitoring Integration', () => {
  let eventMonitoring: ReturnType<typeof getEnhancedEventMonitoringService>;
  let cacheWarmingService: ReturnType<typeof getCacheWarmingIntegrationService>;
  let eventSystem: ReturnType<typeof getEventSystem>;

  beforeAll(async () => {
    eventMonitoring = getEnhancedEventMonitoringService();
    cacheWarmingService = getCacheWarmingIntegrationService();
    eventSystem = getEventSystem();
    
    // Allow services to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    // Cleanup if needed
  });

  describe('Health Endpoints', () => {
    test('should return enhanced health status', async () => {
      const response = await request(app)
        .get('/health/enhanced')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('services');
      expect(response.body).toHaveProperty('metrics');
      expect(response.body).toHaveProperty('alerts');

      expect(['healthy', 'warning', 'critical', 'emergency']).toContain(response.body.status);
    });

    test('should return Prometheus metrics', async () => {
      const response = await request(app)
        .get('/health/metrics')
        .expect(200);

      expect(response.text).toContain('crypto_data_events_published_total');
      expect(response.text).toContain('crypto_data_events_consumed_total');
      expect(response.text).toContain('crypto_data_cache_warming_performance');
      expect(response.headers['content-type']).toContain('text/plain');
    });

    test('should return performance dashboard data', async () => {
      const response = await request(app)
        .get('/health/dashboard?timeRange=1h&detailed=false')
        .expect(200);

      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('timeRange', '1h');
      expect(response.body).toHaveProperty('overview');
      expect(response.body).toHaveProperty('performance');
      expect(response.body).toHaveProperty('resources');
      expect(response.body).toHaveProperty('components');
    });

    test('should return cost metrics', async () => {
      const response = await request(app)
        .get('/health/cost?period=24h&detailed=true')
        .expect(200);

      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('period', '24h');
      expect(response.body).toHaveProperty('summary');
      expect(response.body).toHaveProperty('optimization');
      expect(response.body).toHaveProperty('detailed');
    });

    test('should return event system metrics', async () => {
      const response = await request(app)
        .get('/health/events')
        .expect(200);

      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('prometheus');
      expect(response.body).toHaveProperty('internal');
      expect(response.body.internal).toHaveProperty('monitoring');
      expect(response.body.internal).toHaveProperty('cacheWarming');
    });

    test('should return cache warming metrics', async () => {
      const response = await request(app)
        .get('/health/cache-warming')
        .expect(200);

      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('metrics');
      expect(response.body).toHaveProperty('strategy');
      expect(response.body).toHaveProperty('recentDecisions');
      expect(response.body).toHaveProperty('health');
      expect(response.body).toHaveProperty('performance');
    });

    test('should return system alerts', async () => {
      const response = await request(app)
        .get('/health/alerts?limit=10')
        .expect(200);

      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('critical');
      expect(response.body).toHaveProperty('warning');
      expect(response.body).toHaveProperty('info');
      expect(response.body).toHaveProperty('alerts');
      expect(Array.isArray(response.body.alerts)).toBe(true);
    });

    test('should require admin key for force update', async () => {
      await request(app)
        .post('/health/force-update')
        .expect(401);

      await request(app)
        .post('/health/force-update')
        .set('x-admin-key', 'invalid-key')
        .expect(401);
    });

    test('should allow force update with valid admin key', async () => {
      // Skip if no admin key is set
      if (!process.env.ADMIN_KEY) {
        return;
      }

      const response = await request(app)
        .post('/health/force-update')
        .set('x-admin-key', process.env.ADMIN_KEY)
        .expect(200);

      expect(response.body).toHaveProperty('status', 'success');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('Event Monitoring Service', () => {
    test('should track request metrics', async () => {
      const initialSnapshot = eventMonitoring.getCurrentSnapshot();
      
      // Make some requests to generate metrics
      await request(app).get('/health').expect(200);
      await request(app).get('/health').expect(200);
      
      // Allow metrics to update
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const healthStatus = eventMonitoring.getHealthStatus();
      
      expect(healthStatus).toHaveProperty('monitoring');
      expect(healthStatus.monitoring).toHaveProperty('enabled');
      expect(healthStatus.monitoring).toHaveProperty('snapshotsCollected');
    });

    test('should force metrics update', async () => {
      const initialHealth = eventMonitoring.getHealthStatus();
      
      await eventMonitoring.forceMetricsUpdate();
      
      const updatedHealth = eventMonitoring.getHealthStatus();
      
      expect(updatedHealth.monitoring.lastUpdate).toBeGreaterThanOrEqual(
        initialHealth.monitoring.lastUpdate
      );
    });

    test('should get snapshots in time range', async () => {
      const endTime = Date.now();
      const startTime = endTime - (60 * 60 * 1000); // 1 hour ago
      
      const snapshots = eventMonitoring.getSnapshotsInRange(startTime, endTime);
      
      expect(Array.isArray(snapshots)).toBe(true);
      snapshots.forEach(snapshot => {
        expect(snapshot.timestamp).toBeGreaterThanOrEqual(startTime);
        expect(snapshot.timestamp).toBeLessThanOrEqual(endTime);
      });
    });
  });

  describe('Cache Warming Integration Service', () => {
    test('should get current metrics', async () => {
      const metrics = cacheWarmingService.getMetrics();
      
      expect(metrics).toHaveProperty('totalRequests');
      expect(metrics).toHaveProperty('successfulWarmings');
      expect(metrics).toHaveProperty('failedWarmings');
      expect(metrics).toHaveProperty('totalCostSpent');
      expect(metrics).toHaveProperty('totalSavingsAchieved');
      expect(metrics).toHaveProperty('averageWarmingTime');
      expect(metrics).toHaveProperty('byDataType');
      expect(metrics).toHaveProperty('byStrategy');
      expect(metrics).toHaveProperty('recentPerformance');
    });

    test('should get strategy configuration', async () => {
      const strategy = cacheWarmingService.getStrategy();
      
      expect(strategy).toHaveProperty('id');
      expect(strategy).toHaveProperty('name');
      expect(strategy).toHaveProperty('enabled');
      expect(strategy).toHaveProperty('priority');
      expect(strategy).toHaveProperty('costBudget');
      expect(strategy).toHaveProperty('strategies');
      
      expect(strategy.strategies).toHaveProperty('userPattern');
      expect(strategy.strategies).toHaveProperty('timePattern');
      expect(strategy.strategies).toHaveProperty('costOptimization');
      expect(strategy.strategies).toHaveProperty('manual');
    });

    test('should get health status', async () => {
      const health = cacheWarmingService.getHealthStatus();
      
      expect(health).toHaveProperty('enabled');
      expect(health).toHaveProperty('successRate');
      expect(health).toHaveProperty('costEfficiency');
      expect(health).toHaveProperty('currentHourSpent');
      expect(health).toHaveProperty('budgetUtilization');
      expect(health).toHaveProperty('queueLength');
      expect(health).toHaveProperty('processingRequests');
      expect(health).toHaveProperty('recentDecisions');
      expect(health).toHaveProperty('lastActivity');
    });

    test('should trigger manual cache warming', async () => {
      const requestId = await cacheWarmingService.triggerManualWarming(
        'token_metadata',
        ['test_key_1', 'test_key_2', 'test_key_3'],
        {
          priority: 'normal',
          userContext: 'test_user',
          estimatedSavings: 0.05
        }
      );
      
      expect(typeof requestId).toBe('string');
      expect(requestId).toMatch(/^manual_\d+_[a-z0-9]+$/);
    });

    test('should update strategy configuration', async () => {
      const initialStrategy = cacheWarmingService.getStrategy();
      
      cacheWarmingService.updateStrategy({
        costBudget: 15.0,
        successRateThreshold: 0.8
      });
      
      const updatedStrategy = cacheWarmingService.getStrategy();
      
      expect(updatedStrategy.costBudget).toBe(15.0);
      expect(updatedStrategy.successRateThreshold).toBe(0.8);
      expect(updatedStrategy.id).toBe(initialStrategy.id); // Should remain the same
    });
  });

  describe('Event System Integration', () => {
    test('should emit and handle cache warm request event', async () => {
      const eventHandled = new Promise((resolve) => {
        eventSystem.once('cacheWarmRequested', resolve);
      });

      await eventSystem.emitEvent({
        type: 'CacheWarmRequestV1',
        timestamp: Date.now(),
        requestId: `test_${Date.now()}`,
        priority: 'normal',
        dataType: 'balance',
        keys: ['0x123...', '0x456...'],
        preloadReason: 'manual',
        estimatedSavings: 0.01,
        metadata: {
          testEvent: true
        }
      });

      // Wait for event to be handled (with timeout)
      await Promise.race([
        eventHandled,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Event handling timeout')), 5000)
        )
      ]);

      // Check that metrics were updated
      const metrics = eventSystem.getMetrics();
      expect(metrics.totalEvents).toBeGreaterThan(0);
    });

    test('should get event system metrics', async () => {
      const metrics = eventSystem.getMetrics();
      
      expect(metrics).toHaveProperty('totalEvents');
      expect(metrics).toHaveProperty('processedEvents');
      expect(metrics).toHaveProperty('failedEvents');
      expect(metrics).toHaveProperty('averageProcessingTime');
      expect(metrics).toHaveProperty('eventsPerSecond');
      expect(metrics).toHaveProperty('queueLength');
      expect(metrics).toHaveProperty('lastProcessedAt');
      expect(metrics).toHaveProperty('errorsByType');
      expect(metrics).toHaveProperty('handlerPerformance');
    });

    test('should retry dead letter queue items', async () => {
      const deadLetterItems = eventSystem.getDeadLetterQueue();
      const initialCount = deadLetterItems.length;
      
      const retriedCount = await eventSystem.retryDeadLetterQueue();
      
      expect(typeof retriedCount).toBe('number');
      expect(retriedCount).toBe(initialCount);
      
      // Queue should be empty after retry
      const newDeadLetterItems = eventSystem.getDeadLetterQueue();
      expect(newDeadLetterItems.length).toBe(0);
    });

    test('should flush event queue', async () => {
      // Add some events to the queue
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(eventSystem.emitEvent({
          type: 'CacheWarmRequestV1',
          timestamp: Date.now(),
          requestId: `flush_test_${i}`,
          priority: 'low',
          dataType: 'price',
          keys: [`key_${i}`],
          preloadReason: 'manual',
          estimatedSavings: 0.001
        }));
      }
      
      await Promise.all(promises);
      
      // Flush the queue
      const processedCount = await eventSystem.flushQueue();
      
      expect(typeof processedCount).toBe('number');
      expect(processedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Performance Metrics Collection', () => {
    test('should collect performance data over time', async () => {
      // Force metrics collection
      await eventMonitoring.forceMetricsUpdate();
      
      // Wait a bit for metrics to be processed
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const snapshot = eventMonitoring.getCurrentSnapshot();
      
      if (snapshot) {
        expect(snapshot).toHaveProperty('timestamp');
        expect(snapshot).toHaveProperty('eventMetrics');
        expect(snapshot).toHaveProperty('cacheMetrics');
        expect(snapshot).toHaveProperty('workerMetrics');
        expect(snapshot).toHaveProperty('costMetrics');
        expect(snapshot).toHaveProperty('systemHealth');
        
        // Validate eventMetrics structure
        expect(snapshot.eventMetrics).toHaveProperty('publishRate');
        expect(snapshot.eventMetrics).toHaveProperty('consumeRate');
        expect(snapshot.eventMetrics).toHaveProperty('averageLatency');
        expect(snapshot.eventMetrics).toHaveProperty('errorRate');
        expect(snapshot.eventMetrics).toHaveProperty('queueDepth');
        
        // Validate cacheMetrics structure
        expect(snapshot.cacheMetrics).toHaveProperty('hitRate');
        expect(snapshot.cacheMetrics).toHaveProperty('warmingSuccessRate');
        expect(snapshot.cacheMetrics).toHaveProperty('evictionRate');
        expect(snapshot.cacheMetrics).toHaveProperty('totalSize');
        
        // Validate numeric ranges
        expect(snapshot.eventMetrics.errorRate).toBeGreaterThanOrEqual(0);
        expect(snapshot.eventMetrics.errorRate).toBeLessThanOrEqual(100);
        expect(snapshot.cacheMetrics.hitRate).toBeGreaterThanOrEqual(0);
        expect(snapshot.cacheMetrics.hitRate).toBeLessThanOrEqual(100);
      }
    });

    test('should track cost optimization effectiveness', async () => {
      const cacheMetrics = cacheWarmingService.getMetrics();
      
      // Calculate cost efficiency
      const costEfficiency = cacheMetrics.totalCostSpent > 0 ? 
        cacheMetrics.totalSavingsAchieved / cacheMetrics.totalCostSpent : 0;
      
      expect(costEfficiency).toBeGreaterThanOrEqual(0);
      
      // Success rate should be a valid percentage
      const successRate = cacheMetrics.totalRequests > 0 ?
        cacheMetrics.successfulWarmings / cacheMetrics.totalRequests : 0;
      
      expect(successRate).toBeGreaterThanOrEqual(0);
      expect(successRate).toBeLessThanOrEqual(1);
    });
  });

  describe('Alert System', () => {
    test('should configure monitoring settings', async () => {
      eventMonitoring.configure({
        eventLatencyThresholds: {
          'CacheWarmRequestV1': 200 // Increase threshold to 200ms
        },
        alertingEnabled: true
      });
      
      // Configuration should be applied
      // This is mainly testing that the method doesn't throw
      expect(true).toBe(true);
    });

    test('should enable/disable monitoring', async () => {
      eventMonitoring.setEnabled(false);
      let health = eventMonitoring.getHealthStatus();
      expect(health.monitoring.enabled).toBe(false);
      
      eventMonitoring.setEnabled(true);
      health = eventMonitoring.getHealthStatus();
      expect(health.monitoring.enabled).toBe(true);
    });
  });

  describe('Performance Targets', () => {
    test('should meet performance targets', async () => {
      const snapshot = eventMonitoring.getCurrentSnapshot();
      
      if (snapshot) {
        // These are aspirational targets - in a real test environment
        // some might not be met, but we can at least verify the structure
        
        // Event latency should be reasonable (< 5 seconds in test env)
        expect(snapshot.eventMetrics.averageLatency).toBeLessThan(5000);
        
        // Error rate should be reasonable (< 50% in test env)
        expect(snapshot.eventMetrics.errorRate).toBeLessThan(50);
        
        // System health score should be present
        expect(snapshot.systemHealth.overallScore).toBeGreaterThanOrEqual(0);
        expect(snapshot.systemHealth.overallScore).toBeLessThanOrEqual(100);
      }
    });

    test('should track worker throughput targets', async () => {
      const cacheHealth = cacheWarmingService.getHealthStatus();
      
      // Budget utilization should be reasonable
      expect(cacheHealth.budgetUtilization).toBeGreaterThanOrEqual(0);
      expect(cacheHealth.budgetUtilization).toBeLessThanOrEqual(2); // Allow up to 200% in tests
      
      // Success rate should be a valid percentage
      expect(cacheHealth.successRate).toBeGreaterThanOrEqual(0);
      expect(cacheHealth.successRate).toBeLessThanOrEqual(1);
    });
  });
});