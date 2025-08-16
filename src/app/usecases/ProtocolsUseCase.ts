import { ServiceDeps as ServiceDependencies } from '@/app/runtime';

export class ProtocolsUseCase {
  constructor(private readonly deps: ServiceDependencies) {}

  getOverview() {
    const defiProtocols = this.deps.defiPort.getRegisteredProtocols();
    const defiHealthStatus = this.deps.defiPort.getHealthStatus();
    const nftDetectors = this.deps.nftPort.getRegisteredDetectors();
    const nftEnrichers = this.deps.nftPort.getRegisteredEnrichers();
    const nftHealthStatus = this.deps.nftPort.getHealthStatus();
    const chainsHealth = this.deps.chainManager.getHealthStatus();
    const cfg = this.deps.runtimeConfig;

    const supportedChains = Object.entries(cfg.chains)
      .filter(([, c]: any) => (c as any).enabled)
      .map(([id, c]: any) => ({ id, name: c.name, symbol: c.symbol, chainId: c.id, enabled: c.enabled }));

    const defiHealthy = Object.values(defiHealthStatus).filter((h: any) => h.isHealthy).length;
    const nftDetectorsHealthy = Object.values(nftHealthStatus.detectors).filter((d: any) => d.isHealthy).length;
    const nftEnrichersHealthy = Object.values(nftHealthStatus.enrichers).filter((e: any) => e.isHealthy).length;

    return {
      defi: {
        protocols: defiProtocols,
        healthStatus: defiHealthStatus,
        summary: {
          total: defiProtocols.length,
          healthy: defiHealthy,
          healthPercentage: defiProtocols.length > 0 ? (defiHealthy / defiProtocols.length) * 100 : 0,
          capabilities: [
            'Position tracking', 'Yield farming detection', 'Lending/borrowing monitoring', 'Liquidity provision tracking', 'Risk assessment'
          ],
        },
      },
      nft: {
        detectors: nftDetectors,
        enrichers: nftEnrichers,
        healthStatus: nftHealthStatus,
        summary: {
          totalDetectors: nftDetectors.length,
          totalEnrichers: nftEnrichers.length,
          healthyDetectors: nftDetectorsHealthy,
          healthyEnrichers: nftEnrichersHealthy,
          overallHealth: nftHealthStatus.isHealthy,
        },
      },
      chains: {
        supported: supportedChains,
        healthStatus: chainsHealth,
        summary: {
          totalChains: supportedChains.length,
          healthyProviders: chainsHealth.healthyProviders,
          totalProviders: chainsHealth.totalProviders,
          healthPercentage: chainsHealth.healthPercentage,
        },
      },
    };
  }
}
