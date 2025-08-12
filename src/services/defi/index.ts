import { logger } from '@/utils/logger';
import { config } from '@/config/environment';
import { ChainId } from '@/types/blockchain';
import { defiOrchestrator } from './DeFiOrchestrator';
import { createAaveV3Adapter } from './adapters/AaveV3Adapter';
import { createUniswapV3Adapter } from './adapters/UniswapV3Adapter';

/**
 * Initialize all DeFi protocol adapters
 */
export async function initializeDeFiServices(): Promise<void> {
  logger.info('Initializing DeFi protocol adapters...');

  try {
    // Create RPC URL mappings from config
    const rpcUrls: Partial<Record<ChainId, string>> = {
      [ChainId.ETHEREUM]: config.rpcUrls.ethereum,
      [ChainId.POLYGON]: config.rpcUrls.polygon,
      [ChainId.ARBITRUM]: config.rpcUrls.arbitrum,
      [ChainId.OPTIMISM]: config.rpcUrls.optimism,
      [ChainId.BASE]: config.rpcUrls.base,
    };

    // Initialize Aave V3 adapter
    if (config.rpcUrls.ethereum) {
      try {
        const aaveAdapter = createAaveV3Adapter(rpcUrls);
        defiOrchestrator.registerAdapter(aaveAdapter);
        logger.info('✅ Aave V3 adapter registered');
      } catch (error) {
        logger.error('❌ Failed to initialize Aave V3 adapter', { error });
      }
    } else {
      logger.warn('⚠️  Skipping Aave V3 adapter - no Ethereum RPC URL configured');
    }

    // Initialize Uniswap V3 adapter
    if (config.rpcUrls.ethereum) {
      try {
        const uniswapAdapter = createUniswapV3Adapter(rpcUrls);
        defiOrchestrator.registerAdapter(uniswapAdapter);
        logger.info('✅ Uniswap V3 adapter registered');
      } catch (error) {
        logger.error('❌ Failed to initialize Uniswap V3 adapter', { error });
      }
    } else {
      logger.warn('⚠️  Skipping Uniswap V3 adapter - no Ethereum RPC URL configured');
    }

    // TODO: Add more protocol adapters as they are implemented
    // - Compound V3
    // - Curve Finance
    // - Yearn Finance
    // - Lido
    // - etc.

    const registeredProtocols = defiOrchestrator.getRegisteredProtocols();
    logger.info(`🚀 DeFi services initialized with ${registeredProtocols.length} protocol adapters`, {
      protocols: registeredProtocols,
    });

  } catch (error) {
    logger.error('Failed to initialize DeFi services', { error });
    throw error;
  }
}

/**
 * Shutdown DeFi services gracefully
 */
export async function shutdownDeFiServices(): Promise<void> {
  logger.info('Shutting down DeFi services...');
  
  try {
    // Stop the orchestrator
    defiOrchestrator.stop();
    
    logger.info('✅ DeFi services shut down successfully');
  } catch (error) {
    logger.error('Error during DeFi services shutdown', { error });
  }
}

// Export the orchestrator for use in controllers
export { defiOrchestrator } from './DeFiOrchestrator';