import { ServiceDeps as ServiceDependencies } from '@/app/runtime';

export class SolanaUseCase {
  constructor(private readonly deps: ServiceDependencies) {}

  async getPortfolio(address: string, options: any) {
    return this.deps.solanaPort.getPortfolio(address, options);
  }

  async getAnalytics(address: string, options: any) {
    return this.deps.solanaPort.getPortfolioAnalytics(address, options);
  }

  async analyzeCrossChainPositions(solanaAddress: string, evmAddresses: string[]) {
    return this.deps.solanaPort.analyzeCrossChainPositions(solanaAddress, evmAddresses);
  }

  async getHealth() {
    const [orchestratorHealth, providerHealth] = await Promise.allSettled([
      (this.deps.solanaPort as any).getHealthStatus?.(),
      (this.deps.solanaProvider as any).getHealthStatus?.(),
    ]);

    const orchestratorData = orchestratorHealth.status === 'fulfilled' ? orchestratorHealth.value : null;
    const providerData = providerHealth.status === 'fulfilled' ? providerHealth.value : null;

    return {
      status: orchestratorData?.healthy && providerData?.healthy ? 'healthy' : 'degraded',
      services: {
        orchestrator: {
          status: orchestratorHealth.status === 'fulfilled' ? 'healthy' : 'error',
          protocols: orchestratorData?.protocols || {},
          lastCheck: orchestratorData?.timestamp,
        },
        provider: {
          status: providerHealth.status === 'fulfilled' ? 'healthy' : 'error',
          adapters: providerData?.adapters || {},
          rpcStatus: providerData?.rpcConnected,
          lastCheck: providerData?.timestamp,
        },
      },
      timestamp: new Date().toISOString(),
    };
  }

  async getStats() {
    const orchestratorStats = (this.deps.solanaPort as any).getStats
      ? await (this.deps.solanaPort as any).getStats()
      : {};
    const providerStats = (this.deps.solanaProvider as any).getStats
      ? await (this.deps.solanaProvider as any).getStats()
      : {};

    const chainConfig = (this.deps.runtimeConfig as any).chains.solana || {};
    return {
      orchestrator: orchestratorStats,
      provider: providerStats,
      configuration: {
        enabledProtocols: chainConfig.enabledProtocols || [],
        rpcUrl: chainConfig.rpcUrl || 'configured',
        hasHeliusKey: !!chainConfig.heliusApiKey,
        cacheSettings: chainConfig.cacheSettings || {},
        performance: chainConfig.performance || {},
      },
      runtime: {
        uptime: process.uptime(),
        nodeVersion: process.version,
        memoryUsage: process.memoryUsage(),
      },
      timestamp: new Date().toISOString(),
    };
  }
}
