import { logger } from '@/utils/logger';
import { config } from '@/config';
import { ChainId } from '@/types/blockchain';
import { nftOrchestrator } from './NFTOrchestrator';
import { createEVMNFTDetector } from './detectors/EVMNFTDetector';
import { createSolanaNFTDetector } from './detectors/SolanaNFTDetector';
import { IPFSMetadataEnricher } from './enrichers/IPFSMetadataEnricher';
import { PriceDataEnricher } from './enrichers/PriceDataEnricher';

/**
 * Initialize all NFT detectors and metadata enrichers
 */
export async function initializeNFTServices(): Promise<void> {
  logger.info('Initializing NFT detection services...');

  try {
    // Create RPC URL mappings from config
    const rpcUrls: Partial<Record<ChainId, string>> = {
      [ChainId.ETHEREUM]: config.rpcUrls.ethereum,
      [ChainId.POLYGON]: config.rpcUrls.polygon,
      [ChainId.ARBITRUM]: config.rpcUrls.arbitrum,
      [ChainId.OPTIMISM]: config.rpcUrls.optimism,
      [ChainId.BASE]: config.rpcUrls.base,
    };

    // Initialize EVM NFT detector with enhanced configuration
    if (config.rpcUrls.ethereum || config.rpcUrls.polygon || config.rpcUrls.arbitrum) {
      try {
        const evmDetector = createEVMNFTDetector(rpcUrls);
        nftOrchestrator.registerDetector(evmDetector);
        logger.info('✅ EVM NFT detector registered', {
          supportedChains: evmDetector.supportedChains,
          supportedStandards: evmDetector.supportedStandards,
          supportedMarketplaces: evmDetector.supportedMarketplaces,
        });
      } catch (error) {
        logger.error('❌ Failed to initialize EVM NFT detector', { error });
      }
    } else {
      logger.warn('⚠️  Skipping EVM NFT detector - no EVM RPC URLs configured');
    }

    // Initialize Solana NFT detector with enhanced configuration
    if (config.apiKeys.helius || process.env.HELIUS_API_KEY) {
      try {
        const solanaDetector = createSolanaNFTDetector(config.apiKeys.helius);
        nftOrchestrator.registerDetector(solanaDetector);
        logger.info('✅ Solana NFT detector registered', {
          supportedChains: solanaDetector.supportedChains,
          supportedStandards: solanaDetector.supportedStandards,
          supportedMarketplaces: solanaDetector.supportedMarketplaces,
        });
      } catch (error) {
        logger.error('❌ Failed to initialize Solana NFT detector', { error });
      }
    } else {
      logger.warn('⚠️  Skipping Solana NFT detector - no Helius API key configured');
    }

    // Initialize metadata enrichers
    try {
      // IPFS Metadata Enricher (priority 1 - highest priority)
      const ipfsEnricher = new IPFSMetadataEnricher();
      nftOrchestrator.registerEnricher(ipfsEnricher);
      logger.info('✅ IPFS metadata enricher registered');

      // Price Data Enricher (priority 2)
      const priceEnricher = new PriceDataEnricher({
        coinGeckoApiKey: config.apiKeys.coinGecko,
        defiLlamaApiKey: config.apiKeys.defiLlama,
      });
      nftOrchestrator.registerEnricher(priceEnricher);
      logger.info('✅ Price data enricher registered');

    } catch (error) {
      logger.error('❌ Failed to initialize metadata enrichers', { error });
    }

    // Log available API keys for debugging (without exposing actual keys)
    const availableApis = {
      openSea: !!config.apiKeys.openSea,
      magicEden: !!config.apiKeys.magicEden,
      reservoir: !!config.apiKeys.reservoir,
      nftGo: !!config.apiKeys.nftGo,
      coinGecko: !!config.apiKeys.coinGecko,
      defiLlama: !!config.apiKeys.defiLlama,
    };

    logger.info('📋 Available NFT API integrations', availableApis);

    const registeredDetectors = nftOrchestrator.getRegisteredDetectors();
    const registeredEnrichers = nftOrchestrator.getRegisteredEnrichers();
    
    logger.info(`🚀 NFT services initialized successfully`, {
      detectors: registeredDetectors.length,
      enrichers: registeredEnrichers.length,
      detectorList: registeredDetectors,
      enricherList: registeredEnrichers,
      availableIntegrations: availableApis,
    });

    // Perform initial health check
    const health = await nftOrchestrator.checkHealth();
    const healthyDetectors = Object.values(health.detectors).filter(d => d.isHealthy).length;
    const healthyEnrichers = Object.values(health.enrichers).filter(e => e.isHealthy).length;

    logger.info(`📊 NFT services health status`, {
      overallHealth: health.isHealthy,
      detectors: `${healthyDetectors}/${registeredDetectors.length} healthy`,
      enrichers: `${healthyEnrichers}/${registeredEnrichers.length} healthy`,
      lastHealthCheck: health.lastCheckedAt.toISOString(),
    });

    if (!health.isHealthy) {
      logger.warn('⚠️  Some NFT services are unhealthy', {
        unhealthyDetectors: Object.entries(health.detectors)
          .filter(([, status]) => !status.isHealthy)
          .map(([name, status]) => ({ 
            name, 
            errors: status.errors,
            lastChecked: status.lastCheckedAt,
            responseTime: status.responseTime,
          })),
        unhealthyEnrichers: Object.entries(health.enrichers)
          .filter(([, status]) => !status.isHealthy)
          .map(([name, status]) => ({ 
            name, 
            errors: status.errors,
            lastChecked: status.lastCheckedAt,
            responseTime: status.responseTime,
          })),
      });
    }

    // Start periodic health monitoring
    startHealthMonitoring();

  } catch (error) {
    logger.error('Failed to initialize NFT services', { error });
    throw error;
  }
}

/**
 * Start periodic health monitoring for NFT services
 */
function startHealthMonitoring(): void {
  // Check health every 5 minutes
  setInterval(async () => {
    try {
      const health = await nftOrchestrator.checkHealth();
      
      if (!health.isHealthy) {
        logger.warn('NFT services health check failed', {
          timestamp: health.lastCheckedAt,
          unhealthyServices: [
            ...Object.entries(health.detectors)
              .filter(([, status]) => !status.isHealthy)
              .map(([name]) => `detector:${name}`),
            ...Object.entries(health.enrichers)
              .filter(([, status]) => !status.isHealthy)
              .map(([name]) => `enricher:${name}`)
          ],
        });
      }
    } catch (error) {
      logger.error('Health monitoring check failed', { error });
    }
  }, 5 * 60 * 1000); // 5 minutes
}

/**
 * Get comprehensive NFT service status
 */
export async function getNFTServiceStatus(): Promise<{
  isHealthy: boolean;
  services: {
    detectors: Array<{
      name: string;
      isHealthy: boolean;
      supportedChains: ChainId[];
      supportedStandards: string[];
      supportedMarketplaces: string[];
      responseTime?: number;
      lastChecked: Date;
      errors?: string[];
    }>;
    enrichers: Array<{
      name: string;
      isHealthy: boolean;
      priority: number;
      responseTime?: number;
      lastChecked: Date;
      errors?: string[];
    }>;
  };
  integrations: Record<string, boolean>;
  lastHealthCheck: Date;
}> {
  const health = await nftOrchestrator.checkHealth();
  const registeredDetectors = nftOrchestrator.getRegisteredDetectors();
  const registeredEnrichers = nftOrchestrator.getRegisteredEnrichers();

  // Get detector details
  const detectorInstances = Array.from((nftOrchestrator as any).detectors.values());
  const enricherInstances = Array.from((nftOrchestrator as any).enrichers.values());

  return {
    isHealthy: health.isHealthy,
    services: {
      detectors: registeredDetectors.map(name => {
        const detector = detectorInstances.find((d: any) => d.name === name);
        const healthInfo = health.detectors[name];
        
        return {
          name,
          isHealthy: healthInfo?.isHealthy || false,
          supportedChains: detector?.supportedChains || [],
          supportedStandards: detector?.supportedStandards || [],
          supportedMarketplaces: detector?.supportedMarketplaces || [],
          responseTime: healthInfo?.responseTime,
          lastChecked: healthInfo?.lastCheckedAt || new Date(),
          errors: healthInfo?.errors,
        };
      }),
      enrichers: registeredEnrichers.map(name => {
        const enricher = enricherInstances.find((e: any) => e.name === name);
        const healthInfo = health.enrichers[name];
        
        return {
          name,
          isHealthy: healthInfo?.isHealthy || false,
          priority: enricher?.priority || 999,
          responseTime: healthInfo?.responseTime,
          lastChecked: healthInfo?.lastCheckedAt || new Date(),
          errors: healthInfo?.errors,
        };
      }),
    },
    integrations: {
      openSea: !!config.apiKeys.openSea,
      magicEden: !!config.apiKeys.magicEden,
      reservoir: !!config.apiKeys.reservoir,
      nftGo: !!config.apiKeys.nftGo,
      coinGecko: !!config.apiKeys.coinGecko,
      defiLlama: !!config.apiKeys.defiLlama,
      helius: !!config.apiKeys.helius,
    },
    lastHealthCheck: health.lastCheckedAt,
  };
}

/**
 * Shutdown NFT services gracefully
 */
export async function shutdownNFTServices(): Promise<void> {
  logger.info('Shutting down NFT services...');
  
  try {
    // Stop the orchestrator
    nftOrchestrator.stop();
    
    logger.info('✅ NFT services shut down successfully');
  } catch (error) {
    logger.error('Error during NFT services shutdown', { error });
  }
}

// Export types and interfaces
export type { NFTDetector, NFTMetadataEnricher } from './NFTOrchestrator';
export type { NFTPortfolioOptions } from './NFTOrchestrator';

// Export the orchestrator for use in controllers
export { nftOrchestrator } from './NFTOrchestrator';

// Export individual services for direct use if needed
export { createEVMNFTDetector } from './detectors/EVMNFTDetector';
export { createSolanaNFTDetector } from './detectors/SolanaNFTDetector';
