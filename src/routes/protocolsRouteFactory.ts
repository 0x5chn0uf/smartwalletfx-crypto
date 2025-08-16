import { Router, Request, Response, NextFunction } from 'express';
import { BaseRouteFactory } from './routeFactory';
import type { ServiceDeps as ServiceDependencies } from '@/app/runtime';
import { logger } from '@/utils/logger';
import { ProtocolsUseCase } from '@/app/usecases/ProtocolsUseCase';

export function createProtocolsRoutes(dependencies: ServiceDependencies): Router {
  const factory = new ProtocolsRouteFactory(dependencies);
  return factory.createRoutes();
}

class ProtocolsRouteFactory extends BaseRouteFactory {
  private readonly usecase: ProtocolsUseCase;
  constructor(deps: ServiceDependencies) {
    super(deps, {});
    this.usecase = new ProtocolsUseCase(deps);
  }

  createRoutes(): Router {
    const router = Router();
    const { chainManager, runtimeConfig } = this.dependencies;

    // Swagger for /api/protocols endpoints is externalized in src/docs/paths/protocols.yaml
    // GET /api/protocols
    router.get('/', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const overview = this.usecase.getOverview();
        res.json({
          success: true,
          data: {
            ...overview,
            capabilities: {
              portfolioAggregation: true,
              crossChainSupport: true,
              realTimeData: true,
              historicalData: false,
              priceTracking: true,
              riskAssessment: true,
              yieldOptimization: false,
              taxonomyClassification: true,
              marketplaceIntegration: true,
              metadataEnrichment: true,
            },
            apiFeatures: {
              rateLimiting: true,
              caching: true,
              compression: true,
              swagger: runtimeConfig.features.swagger,
              cors: true,
              authentication: true,
              monitoring: true,
              costTracking: true,
            },
          },
          metadata: {
            timestamp: new Date().toISOString(),
            requestId: (req as any).requestId,
            version: '1.0.0',
          },
        });
      } catch (error) {
        logger.error('Protocols information request failed:', {
          error: error instanceof Error ? error.message : 'Unknown error',
          requestId: (req as any).requestId,
        });
        next(error);
      }
    });

    // GET /api/protocols/defi
    router.get('/defi', (req: Request, res: Response, next: NextFunction) => {
      try {
        const protocols = this.dependencies.defiPort.getRegisteredProtocols();
        const healthStatus = this.dependencies.defiPort.getHealthStatus();

        const protocolDetails = (protocols as any[]).map(protocol => {
          const health = (healthStatus as any)[protocol];
          return {
            name: protocol,
            category: getProtocolCategory(protocol),
            description: getProtocolDescription(protocol),
            supportedChains: getProtocolSupportedChains(protocol),
            features: getProtocolFeatures(protocol),
            health: {
              isHealthy: health?.isHealthy || false,
              lastChecked: health?.lastCheckedAt || null,
              issues: health?.issues || [],
              responseTime: health?.responseTime || null,
            },
            documentation: {
              website: getProtocolWebsite(protocol),
              docs: getProtocolDocs(protocol),
            },
          };
        });

        res.json({
          success: true,
          data: {
            protocols: protocolDetails,
            summary: {
              total: protocols.length,
              healthy: Object.values(healthStatus).filter((h: any) => h.isHealthy).length,
              categories: [...new Set(protocolDetails.map((p: any) => p.category))],
            },
          },
          metadata: {
            timestamp: new Date().toISOString(),
            requestId: (req as any).requestId,
          },
        });
      } catch (error) {
        logger.error('DeFi protocols request failed:', {
          error: error instanceof Error ? error.message : 'Unknown error',
          requestId: (req as any).requestId,
        });
        next(error);
      }
    });

    // GET /api/protocols/nft
    router.get('/nft', (req: Request, res: Response, next: NextFunction) => {
      try {
        const detectors = this.dependencies.nftPort.getRegisteredDetectors();
        const enrichers = this.dependencies.nftPort.getRegisteredEnrichers();
        const healthStatus = this.dependencies.nftPort.getHealthStatus();

        const serviceData = {
          detectors: (detectors as any[]).map(detector => ({
            name: detector,
            type: 'detector',
            description: getNFTServiceDescription(detector as any, 'detector'),
            supportedChains: getNFTServiceSupportedChains(detector as any),
            supportedStandards: getNFTServiceSupportedStandards(detector as any),
            capabilities: getNFTServiceCapabilities(detector as any, 'detector'),
            health: (healthStatus as any).detectors[detector] || { isHealthy: false },
          })),
          enrichers: (enrichers as any[]).map(enricher => ({
            name: enricher,
            type: 'enricher',
            description: getNFTServiceDescription(enricher as any, 'enricher'),
            priority: getNFTServicePriority(enricher as any),
            capabilities: getNFTServiceCapabilities(enricher as any, 'enricher'),
            health: (healthStatus as any).enrichers[enricher] || { isHealthy: false },
          })),
        };

        res.json({
          success: true,
          data: {
            services: serviceData,
            summary: {
              totalDetectors: detectors.length,
              totalEnrichers: enrichers.length,
              healthyDetectors: Object.values((healthStatus as any).detectors).filter(
                (d: any) => d.isHealthy
              ).length,
              healthyEnrichers: Object.values((healthStatus as any).enrichers).filter(
                (e: any) => e.isHealthy
              ).length,
              overallHealth: (healthStatus as any).isHealthy,
            },
            supportedStandards: ['ERC721', 'ERC1155', 'SPL'],
            supportedCategories: [
              'art',
              'collectibles',
              'gaming',
              'metaverse',
              'music',
              'photography',
              'sports',
              'utility',
            ],
          },
          metadata: {
            timestamp: new Date().toISOString(),
            requestId: (req as any).requestId,
          },
        });
      } catch (error) {
        logger.error('NFT services request failed:', {
          error: error instanceof Error ? error.message : 'Unknown error',
          requestId: (req as any).requestId,
        });
        next(error);
      }
    });

    // GET /api/protocols/chains
    router.get('/chains', (req: Request, res: Response, next: NextFunction) => {
      try {
        const healthStatus = chainManager.getHealthStatus();
        const supportedChains = (Object.entries(runtimeConfig.chains) as [string, any][])
          .filter(([, cfg]) => cfg.enabled)
          .map(([chainId, cfg]) => ({
            id: chainId,
            name: cfg.name,
            symbol: cfg.symbol,
            chainId: cfg.id,
            nativeCurrency: cfg.nativeCurrency,
            blockTime: cfg.blockTime,
            gasMultiplier: cfg.gasMultiplier,
            enabled: cfg.enabled,
            features: getChainFeatures(chainId as string),
            endpoints: { rpc: !!cfg.rpcUrl },
          }));

        res.json({
          success: true,
          data: {
            supported: supportedChains,
            healthStatus,
          },
          metadata: {
            timestamp: new Date().toISOString(),
            requestId: (req as any).requestId,
          },
        });
      } catch (error) {
        logger.error('Chains info request failed:', {
          error: error instanceof Error ? error.message : 'Unknown error',
          requestId: (req as any).requestId,
        });
        next(error);
      }
    });

    return router;
  }
}

// --- Helpers copied from legacy implementation ---
function getProtocolCategory(protocol: string): string {
  const categories: Record<string, string> = {
    AAVE_V3: 'lending',
    COMPOUND_V3: 'lending',
    UNISWAP_V3: 'dex',
    CURVE: 'dex',
    YEARN: 'yield',
    LIDO: 'staking',
  };
  return categories[protocol] || 'other';
}

function getProtocolDescription(protocol: string): string {
  const descriptions: Record<string, string> = {
    AAVE_V3: 'Aave V3 lending and borrowing protocol',
    COMPOUND_V3: 'Compound V3 lending protocol',
    UNISWAP_V3: 'Uniswap V3 decentralized exchange',
    CURVE: 'Curve stablecoin AMM protocol',
    YEARN: 'Yearn yield aggregation vaults',
    LIDO: 'Lido liquid staking protocol',
  };
  return descriptions[protocol] || 'DeFi protocol';
}

function getProtocolSupportedChains(protocol: string): string[] {
  const support: Record<string, string[]> = {
    AAVE_V3: ['ethereum', 'polygon', 'arbitrum', 'optimism'],
    COMPOUND_V3: ['ethereum'],
    UNISWAP_V3: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'],
    CURVE: ['ethereum', 'polygon', 'arbitrum', 'optimism'],
    YEARN: ['ethereum'],
    LIDO: ['ethereum'],
  };
  return support[protocol] || [];
}

function getProtocolFeatures(protocol: string): string[] {
  const features: Record<string, string[]> = {
    AAVE_V3: ['lending', 'borrowing', 'collateral', 'flash-loans'],
    COMPOUND_V3: ['lending', 'borrowing', 'collateral'],
    UNISWAP_V3: ['swaps', 'lp-positions', 'concentrated-liquidity'],
    CURVE: ['stable-swaps', 'pooling', 'lp-positions'],
    YEARN: ['vaults', 'yield-strategies'],
    LIDO: ['staking', 'liquid-staking'],
  };
  return features[protocol] || [];
}

function getProtocolWebsite(protocol: string): string {
  const websites: Record<string, string> = {
    AAVE_V3: 'https://aave.com',
    COMPOUND_V3: 'https://compound.finance',
    UNISWAP_V3: 'https://uniswap.org',
    CURVE: 'https://curve.fi',
    YEARN: 'https://yearn.finance',
    LIDO: 'https://lido.fi',
  };
  return websites[protocol] || '';
}

function getProtocolDocs(protocol: string): string {
  const docs: Record<string, string> = {
    AAVE_V3: 'https://docs.aave.com',
    COMPOUND_V3: 'https://docs.compound.finance',
    UNISWAP_V3: 'https://docs.uniswap.org',
    CURVE: 'https://curve.readthedocs.io',
    YEARN: 'https://docs.yearn.finance',
    LIDO: 'https://docs.lido.fi',
  };
  return docs[protocol] || '';
}

function getNFTServiceDescription(serviceName: string, type: 'detector' | 'enricher'): string {
  if (type === 'detector') {
    const detectorDescriptions: Record<string, string> = {
      EVM: 'EVM-compatible blockchain NFT detection service',
      Solana: 'Solana blockchain NFT detection service',
    };
    return detectorDescriptions[serviceName] || 'NFT detection service';
  } else {
    const enricherDescriptions: Record<string, string> = {
      IPFS: 'IPFS metadata enrichment service',
      Price: 'Price data enrichment service',
    };
    return enricherDescriptions[serviceName] || 'NFT metadata enrichment service';
  }
}

function getNFTServiceSupportedChains(serviceName: string): string[] {
  const chainSupport: Record<string, string[]> = {
    EVM: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc', 'avalanche'],
    Solana: ['solana'],
  };
  return chainSupport[serviceName] || [];
}

function getNFTServiceSupportedStandards(serviceName: string): string[] {
  const standardSupport: Record<string, string[]> = {
    EVM: ['ERC721', 'ERC1155'],
    Solana: ['SPL'],
  };
  return standardSupport[serviceName] || [];
}

function getNFTServiceCapabilities(serviceName: string, type: 'detector' | 'enricher'): string[] {
  if (type === 'detector') {
    return ['NFT detection', 'Metadata retrieval', 'Collection information'];
  } else {
    const enricherCapabilities: Record<string, string[]> = {
      IPFS: ['IPFS metadata resolution', 'Image URL processing'],
      Price: ['Floor price estimation', 'Market value calculation'],
    };
    return enricherCapabilities[serviceName] || ['Metadata enrichment'];
  }
}

function getNFTServicePriority(serviceName: string): number {
  const priorities: Record<string, number> = {
    IPFS: 1,
    Price: 2,
  };
  return priorities[serviceName] || 10;
}

function getChainFeatures(chainId: string): string[] {
  const features: Record<string, string[]> = {
    ethereum: ['defi', 'nft', 'evm', 'smart-contracts'],
    polygon: ['defi', 'nft', 'evm', 'smart-contracts', 'low-fees'],
    arbitrum: ['defi', 'nft', 'evm', 'smart-contracts', 'layer2'],
    optimism: ['defi', 'nft', 'evm', 'smart-contracts', 'layer2'],
    base: ['defi', 'nft', 'evm', 'smart-contracts', 'layer2'],
    bsc: ['defi', 'nft', 'evm', 'smart-contracts'],
    avalanche: ['defi', 'nft', 'evm', 'smart-contracts'],
    fantom: ['defi', 'nft', 'evm', 'smart-contracts'],
    solana: ['defi', 'nft', 'smart-contracts', 'high-throughput'],
  };
  return features[chainId] || [];
}
