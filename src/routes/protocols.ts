import { Router, Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger';
import { defiOrchestrator } from '@/services/defi/DeFiOrchestrator';
import { nftOrchestrator } from '@/services/nft/NFTOrchestrator';
import { getChainManager } from '@/services/ChainManager';
import { config } from '@/config';

const router = Router();

/**
 * @swagger
 * /api/protocols:
 *   get:
 *     summary: Get all supported protocols and services
 *     description: Returns comprehensive information about all supported DeFi protocols, NFT services, and blockchain networks
 *     tags: [Protocols]
 *     responses:
 *       200:
 *         description: Supported protocols and services
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     defi:
 *                       type: object
 *                       properties:
 *                         protocols:
 *                           type: array
 *                           items:
 *                             type: string
 *                         healthStatus:
 *                           type: object
 *                         summary:
 *                           type: object
 *                     nft:
 *                       type: object
 *                       properties:
 *                         detectors:
 *                           type: array
 *                           items:
 *                             type: string
 *                         enrichers:
 *                           type: array
 *                           items:
 *                             type: string
 *                         healthStatus:
 *                           type: object
 *                         summary:
 *                           type: object
 *                     chains:
 *                       type: object
 *                       properties:
 *                         supported:
 *                           type: array
 *                         healthStatus:
 *                           type: object
 *                     capabilities:
 *                       type: object
 *                 metadata:
 *                   type: object
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info('Protocols information request', {
      requestId: req.requestId,
      userAgent: req.get('User-Agent'),
    });

    // Get DeFi protocol information
    const defiProtocols = defiOrchestrator.getRegisteredProtocols();
    const defiHealthStatus = defiOrchestrator.getHealthStatus();

    // Get NFT service information
    const nftDetectors = nftOrchestrator.getRegisteredDetectors();
    const nftEnrichers = nftOrchestrator.getRegisteredEnrichers();
    const nftHealthStatus = nftOrchestrator.getHealthStatus();

    // Get blockchain network information
    const chainHealthStatus = getChainManager().getHealthStatus();
    const supportedChains = Object.entries(config.chains)
      .filter(([, chainConfig]) => chainConfig.enabled)
      .map(([chainId, chainConfig]) => ({
        id: chainId,
        name: chainConfig.name,
        symbol: chainConfig.symbol,
        chainId: chainConfig.id,
        enabled: chainConfig.enabled,
        blockTime: chainConfig.blockTime,
        nativeCurrency: chainConfig.nativeCurrency,
      }));

    // Calculate health summaries
    const defiHealthy = Object.values(defiHealthStatus).filter(h => h.isHealthy).length;
    const nftDetectorsHealthy = Object.values(nftHealthStatus.detectors).filter(
      d => d.isHealthy
    ).length;
    const nftEnrichersHealthy = Object.values(nftHealthStatus.enrichers).filter(
      e => e.isHealthy
    ).length;

    const protocolData = {
      defi: {
        protocols: defiProtocols,
        healthStatus: defiHealthStatus,
        summary: {
          total: defiProtocols.length,
          healthy: defiHealthy,
          healthPercentage:
            defiProtocols.length > 0 ? (defiHealthy / defiProtocols.length) * 100 : 0,
          capabilities: [
            'Position tracking',
            'Yield farming detection',
            'Lending/borrowing monitoring',
            'Liquidity provision tracking',
            'Risk assessment',
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
          capabilities: [
            'Multi-chain NFT detection',
            'Metadata enrichment',
            'Marketplace integration',
            'Collection analytics',
            'Price estimation',
          ],
        },
      },
      chains: {
        supported: supportedChains,
        healthStatus: chainHealthStatus,
        summary: {
          totalChains: supportedChains.length,
          healthyProviders: chainHealthStatus.healthyProviders,
          totalProviders: chainHealthStatus.totalProviders,
          healthPercentage: chainHealthStatus.healthPercentage,
        },
      },
      capabilities: {
        portfolioAggregation: true,
        crossChainSupport: true,
        realTimeData: true,
        historicalData: false, // Not implemented yet
        priceTracking: true,
        riskAssessment: true,
        yieldOptimization: false, // Not implemented yet
        taxonomyClassification: true,
        marketplaceIntegration: true,
        metadataEnrichment: true,
      },
      apiFeatures: {
        rateLimiting: true,
        caching: true,
        compression: true,
        swagger: config.features.swagger,
        cors: true,
        authentication: true,
        monitoring: true,
        costTracking: true,
      },
    };

    res.json({
      success: true,
      data: protocolData,
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
        version: '1.0.0',
      },
    });
  } catch (error) {
    logger.error('Protocols information request failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.requestId,
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/protocols/defi:
 *   get:
 *     summary: Get DeFi protocols information
 *     description: Returns detailed information about supported DeFi protocols and their health status
 *     tags: [Protocols]
 *     responses:
 *       200:
 *         description: DeFi protocols information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     protocols:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           category:
 *                             type: string
 *                           description:
 *                             type: string
 *                           supportedChains:
 *                             type: array
 *                           features:
 *                             type: array
 *                           health:
 *                             type: object
 *                 metadata:
 *                   type: object
 */
router.get('/defi', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const protocols = defiOrchestrator.getRegisteredProtocols();
    const healthStatus = defiOrchestrator.getHealthStatus();

    // Enhanced protocol information with descriptions and capabilities
    const protocolDetails = protocols.map(protocol => {
      const health = healthStatus[protocol];

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
          healthy: Object.values(healthStatus).filter(h => h.isHealthy).length,
          categories: [...new Set(protocolDetails.map(p => p.category))],
        },
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  } catch (error) {
    logger.error('DeFi protocols request failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.requestId,
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/protocols/nft:
 *   get:
 *     summary: Get NFT services information
 *     description: Returns detailed information about NFT detection and enrichment services
 *     tags: [Protocols]
 *     responses:
 *       200:
 *         description: NFT services information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     services:
 *                       type: object
 *                       properties:
 *                         detectors:
 *                           type: array
 *                         enrichers:
 *                           type: array
 *                 metadata:
 *                   type: object
 */
router.get('/nft', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const detectors = nftOrchestrator.getRegisteredDetectors();
    const enrichers = nftOrchestrator.getRegisteredEnrichers();
    const healthStatus = nftOrchestrator.getHealthStatus();

    const serviceData = {
      detectors: detectors.map(detector => ({
        name: detector,
        type: 'detector',
        description: getNFTServiceDescription(detector, 'detector'),
        supportedChains: getNFTServiceSupportedChains(detector),
        supportedStandards: getNFTServiceSupportedStandards(detector),
        capabilities: getNFTServiceCapabilities(detector, 'detector'),
        health: healthStatus.detectors[detector] || { isHealthy: false },
      })),
      enrichers: enrichers.map(enricher => ({
        name: enricher,
        type: 'enricher',
        description: getNFTServiceDescription(enricher, 'enricher'),
        priority: getNFTServicePriority(enricher),
        capabilities: getNFTServiceCapabilities(enricher, 'enricher'),
        health: healthStatus.enrichers[enricher] || { isHealthy: false },
      })),
    };

    res.json({
      success: true,
      data: {
        services: serviceData,
        summary: {
          totalDetectors: detectors.length,
          totalEnrichers: enrichers.length,
          healthyDetectors: Object.values(healthStatus.detectors).filter(d => d.isHealthy).length,
          healthyEnrichers: Object.values(healthStatus.enrichers).filter(e => e.isHealthy).length,
          overallHealth: healthStatus.isHealthy,
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
        requestId: req.requestId,
      },
    });
  } catch (error) {
    logger.error('NFT services request failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.requestId,
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/protocols/chains:
 *   get:
 *     summary: Get blockchain networks information
 *     description: Returns detailed information about supported blockchain networks
 *     tags: [Protocols]
 *     responses:
 *       200:
 *         description: Blockchain networks information
 */
router.get('/chains', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const healthStatus = getChainManager().getHealthStatus();
    const supportedChains = Object.entries(config.chains)
      .filter(([, chainConfig]) => chainConfig.enabled)
      .map(([chainId, chainConfig]) => ({
        id: chainId,
        name: chainConfig.name,
        symbol: chainConfig.symbol,
        chainId: chainConfig.id,
        nativeCurrency: chainConfig.nativeCurrency,
        blockTime: chainConfig.blockTime,
        gasMultiplier: chainConfig.gasMultiplier,
        enabled: chainConfig.enabled,
        features: getChainFeatures(chainId),
        endpoints: {
          rpc: !!chainConfig.rpcUrl,
        },
      }));

    res.json({
      success: true,
      data: {
        chains: supportedChains,
        healthStatus,
        summary: {
          totalSupported: supportedChains.length,
          totalEnabled: supportedChains.filter(c => c.enabled).length,
          healthyProviders: healthStatus.healthyProviders,
          totalProviders: healthStatus.totalProviders,
          healthPercentage: healthStatus.healthPercentage,
        },
        capabilities: {
          defiSupport: supportedChains.filter(c => c.features.includes('defi')).length,
          nftSupport: supportedChains.filter(c => c.features.includes('nft')).length,
          evmCompatible: supportedChains.filter(c => c.features.includes('evm')).length,
        },
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  } catch (error) {
    logger.error('Chains information request failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.requestId,
    });
    next(error);
  }
});

// Helper functions for protocol information

function getProtocolCategory(protocol: string): string {
  const categories: Record<string, string> = {
    AAVE_V3: 'Lending',
    COMPOUND_V3: 'Lending',
    UNISWAP_V3: 'DEX',
    CURVE: 'DEX',
    YEARN: 'Yield Farming',
    LIDO: 'Staking',
  };
  return categories[protocol] || 'Other';
}

function getProtocolDescription(protocol: string): string {
  const descriptions: Record<string, string> = {
    AAVE_V3: 'Decentralized lending and borrowing protocol with variable and stable interest rates',
    COMPOUND_V3: 'Algorithmic money market protocol for lending and borrowing crypto assets',
    UNISWAP_V3: 'Automated market maker with concentrated liquidity and multiple fee tiers',
    CURVE: 'Decentralized exchange optimized for stablecoin and similar asset swaps',
    YEARN: 'Yield optimization platform that automatically moves funds between DeFi protocols',
    LIDO: 'Liquid staking protocol for Ethereum and other proof-of-stake networks',
  };
  return descriptions[protocol] || 'DeFi protocol integration';
}

function getProtocolSupportedChains(protocol: string): string[] {
  const chainSupport: Record<string, string[]> = {
    AAVE_V3: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'avalanche'],
    COMPOUND_V3: ['ethereum', 'polygon', 'arbitrum', 'base'],
    UNISWAP_V3: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc'],
    CURVE: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'fantom'],
    YEARN: ['ethereum', 'polygon', 'arbitrum', 'optimism'],
    LIDO: ['ethereum'],
  };
  return chainSupport[protocol] || [];
}

function getProtocolFeatures(protocol: string): string[] {
  const features: Record<string, string[]> = {
    AAVE_V3: ['lending', 'borrowing', 'flash loans', 'variable rates', 'stable rates'],
    COMPOUND_V3: ['lending', 'borrowing', 'algorithmic rates'],
    UNISWAP_V3: ['swapping', 'liquidity provision', 'concentrated liquidity', 'fee tiers'],
    CURVE: ['swapping', 'liquidity provision', 'low slippage', 'stablecoin optimization'],
    YEARN: ['yield optimization', 'auto-compounding', 'strategy execution'],
    LIDO: ['liquid staking', 'staking rewards', 'derivative tokens'],
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

export default router;
