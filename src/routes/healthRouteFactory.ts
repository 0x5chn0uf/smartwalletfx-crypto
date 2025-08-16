import { Router, Request, Response } from 'express';
import type { ServiceDeps as ServiceDependencies } from '@/app/runtime';
import { logger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { getEnhancedMetricsMiddleware } from '@/middleware/enhancedMetricsMiddleware';

export function createHealthRoutes(dependencies: ServiceDependencies): Router {
  const factory = new HealthRouteFactory(dependencies);
  return factory.createRoutes();
}

class HealthRouteFactory {
  constructor(private readonly deps: ServiceDependencies) {}

  createRoutes(): Router {
    const router = Router();

    const metricsMiddleware = getEnhancedMetricsMiddleware();
    const handlers = metricsMiddleware.getRouteHandlers();
    router.use(handlers.trackRequest);

    router.get('/', this.handleRoot.bind(this));
    router.get('/deep', this.handleDeep.bind(this));
    router.get('/liveness', this.handleLiveness.bind(this));
    router.get('/readiness', this.handleReadiness.bind(this));
    router.get('/metrics', handlers.metrics);
    router.get('/enhanced', handlers.health);
    router.get('/dashboard', handlers.dashboard);
    router.get('/cost', handlers.cost);
    router.get('/events', handlers.events);
    router.get('/cache-warming', handlers.cacheWarming);
    router.get('/alerts', handlers.alerts);
    router.post('/force-update', handlers.forceUpdate);

    return router;
  }

  private async handleRoot(req: Request, res: Response) {
    const startTime = Date.now();
    try {
      logger.debug('Health check requested', { requestId: req.requestId });

      const redisStartTime = Date.now();
      const redisHealth = await Promise.race([
        redisManager.ping(),
        new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error('Redis timeout')), 5000)),
      ]);
      const redisResponseTime = Date.now() - redisStartTime;

      const chainStartTime = Date.now();
      const chainHealth = this.deps.chainManager.getHealthStatus();
      const chainResponseTime = Date.now() - chainStartTime;

      const defiStartTime = Date.now();
      const defiHealth: any = (this.deps.defiPort as any).getHealthStatus?.() || {};
      const defiResponseTime = Date.now() - defiStartTime;

      const nftStartTime = Date.now();
      const nftHealth: any = (this.deps.nftPort as any).getHealthStatus?.() || {};
      const nftResponseTime = Date.now() - nftStartTime;

      const costStats = this.deps.costMonitoringService.getCurrentStats();
      const memory = process.memoryUsage();
      const uptime = Math.floor(process.uptime());

      const redisScore = redisHealth ? 1 : 0;
      const chainScore = chainHealth.healthPercentage / 100;
      const defiScore =
        Object.values(defiHealth).filter((h: any) => h.isHealthy).length /
        Math.max(Object.keys(defiHealth).length, 1);
      const nftScore = nftHealth.isHealthy ? 1 : 0;

      const overallScore = redisScore * 0.3 + chainScore * 0.4 + defiScore * 0.2 + nftScore * 0.1;
      const overallStatus: 'healthy' | 'degraded' | 'unhealthy' = overallScore >= 0.8 ? 'healthy' : overallScore >= 0.5 ? 'degraded' : 'unhealthy';

      const healthData = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        uptime,
        services: {
          redis: { status: redisHealth ? 'healthy' : 'unhealthy', responseTime: redisResponseTime, lastChecked: new Date().toISOString() },
          chains: {
            status: chainHealth.healthPercentage > 75 ? 'healthy' : chainHealth.healthPercentage > 25 ? 'degraded' : 'unhealthy',
            healthyProviders: chainHealth.healthyProviders,
            totalProviders: chainHealth.totalProviders,
            healthPercentage: chainHealth.healthPercentage,
            responseTime: chainResponseTime,
            providerDetails: (chainHealth as any).providerDetails || {},
          },
          defi: {
            status: defiScore > 0.5 ? 'healthy' : 'degraded',
            healthyProtocols: Object.values(defiHealth).filter((h: any) => h.isHealthy).length,
            totalProtocols: Object.keys(defiHealth).length,
            responseTime: defiResponseTime,
            protocolDetails: defiHealth,
          },
          nft: {
            status: nftHealth.isHealthy ? 'healthy' : 'degraded',
            healthyDetectors: Object.values(nftHealth.detectors || {}).filter((d: any) => d.isHealthy).length,
            totalDetectors: Object.keys(nftHealth.detectors || {}).length,
            healthyEnrichers: Object.values(nftHealth.enrichers || {}).filter((e: any) => e.isHealthy).length,
            totalEnrichers: Object.keys(nftHealth.enrichers || {}).length,
            responseTime: nftResponseTime,
            detectorDetails: nftHealth.detectors,
            enricherDetails: nftHealth.enrichers,
          },
        },
        costs: {
          dailySpent: (costStats as any).dailyCostUSD || 0,
          monthlyBudget: (costStats as any).monthlyBudget || 200,
          utilizationPercentage: costStats.budgetUtilization || 0,
          requestsToday: (costStats as any).dailyRequests || 0,
          averageCostPerRequest: costStats.averageCostPerRequest || 0,
        },
        performance: {
          healthCheckDuration: Date.now() - startTime,
          memory: {
            used: Math.round(memory.heapUsed / 1024 / 1024),
            total: Math.round(memory.heapTotal / 1024 / 1024),
            external: Math.round(memory.external / 1024 / 1024),
            rss: Math.round(memory.rss / 1024 / 1024),
          },
          uptime,
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
        },
        metadata: { requestId: req.requestId, timestamp: new Date().toISOString(), processingTime: Date.now() - startTime },
      };

      const statusCode = overallStatus === 'healthy' ? 200 : 503;
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('X-Health-Score', overallScore.toFixed(2));
      res.setHeader('X-Service-Status', overallStatus);
      res.status(statusCode).json(healthData);
    } catch (error) {
      const processingTime = Date.now() - startTime;
      logger.error('Health check failed:', { error: error instanceof Error ? error.message : 'Unknown error', requestId: req.requestId, processingTime });
      res.status(503).json({ status: 'unhealthy', timestamp: new Date().toISOString(), error: error instanceof Error ? error.message : 'Health check failed', version: '1.0.0', metadata: { requestId: req.requestId, timestamp: new Date().toISOString(), processingTime } });
    }
  }

  private async handleDeep(req: Request, res: Response) {
    const startTime = Date.now();
    try {
      const diagnostics = await Promise.allSettled([
        (async () => { const testKey = `health-test-${Date.now()}`; await redisManager.set(testKey, 'test', 10); const value = await redisManager.get(testKey); await redisManager.del(testKey); return { redis: { read: !!value, write: true, delete: true } }; })(),
        (async () => { const results = await (this.deps.chainManager as any).testConnectivity(); return { blockchain: results }; })(),
        (async () => { const protocolTests: any = {}; const healthStatus = (this.deps.defiPort as any).getHealthStatus?.() || {}; for (const [protocol, health] of Object.entries(healthStatus)) { (protocolTests as any)[protocol] = { healthy: (health as any).isHealthy, issues: (health as any).issues || [] }; } return { defi: protocolTests }; })(),
        (async () => { const nftHealth = (this.deps.nftPort as any).getHealthStatus?.() || {}; return { nft: nftHealth }; })(),
      ]);

      const results = diagnostics.map(r => (r.status === 'fulfilled' ? r.value : { error: (r as any).reason?.message }));
      const combinedResults = Object.assign({}, ...results);
      res.json({ status: 'completed', timestamp: new Date().toISOString(), diagnostics: combinedResults, performance: { totalTime: Date.now() - startTime, memory: process.memoryUsage(), uptime: process.uptime() }, metadata: { requestId: req.requestId, timestamp: new Date().toISOString() } });
    } catch (error) {
      logger.error('Deep health check failed:', { error: error instanceof Error ? error.message : 'Unknown error', requestId: req.requestId });
      res.status(500).json({ status: 'error', timestamp: new Date().toISOString(), error: error instanceof Error ? error.message : 'Deep health check failed', metadata: { requestId: req.requestId, timestamp: new Date().toISOString() } });
    }
  }

  private handleLiveness(req: Request, res: Response) {
    res.json({ status: 'alive', timestamp: new Date().toISOString(), uptime: Math.floor(process.uptime()) });
  }

  private async handleReadiness(req: Request, res: Response) {
    try {
      const redisReady = await redisManager.ping();
      const chainReady = this.deps.chainManager.getHealthStatus().healthyProviders > 0;
      if (redisReady && chainReady) {
        res.json({ status: 'ready', timestamp: new Date().toISOString(), services: { redis: 'ready', blockchain: 'ready' } });
      } else {
        res.status(503).json({ status: 'not_ready', timestamp: new Date().toISOString(), services: { redis: redisReady ? 'ready' : 'not_ready', blockchain: chainReady ? 'ready' : 'not_ready' } });
      }
    } catch (error) {
      res.status(503).json({ status: 'not_ready', timestamp: new Date().toISOString(), error: error instanceof Error ? error.message : 'Readiness check failed' });
    }
  }
}

export default createHealthRoutes;
