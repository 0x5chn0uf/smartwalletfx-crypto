import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ValidationError } from '@/middleware/errorHandler';
import { defiOrchestrator } from '@/services/defi/DeFiOrchestrator';
import { logger, logPerformance } from '@/utils/logger';
import { 
  ChainId, 
  validateAddress,
  CHAIN_CONFIGS,
} from '@/types/blockchain';
import {
  DeFiProtocol,
  DeFiPortfolioSummarySchema,
  DeFiPositionSchema,
  PROTOCOL_CONFIGS,
} from '@/types/defi';

const router = Router();

// Validation schemas
const AddressParamSchema = z.object({
  address: z.string().min(1, 'Address is required'),
});

const DeFiQuerySchema = z.object({
  chains: z.string().optional().transform((str) => {
    if (!str) return undefined;
    return str.split(',').map(chain => {
      const chainUpper = chain.toUpperCase();
      switch (chainUpper) {
        case 'ETHEREUM': case 'ETH': return ChainId.ETHEREUM;
        case 'POLYGON': case 'MATIC': return ChainId.POLYGON;
        case 'ARBITRUM': case 'ARB': return ChainId.ARBITRUM;
        case 'OPTIMISM': case 'OP': return ChainId.OPTIMISM;
        case 'BASE': return ChainId.BASE;
        case 'SOLANA': case 'SOL': return ChainId.SOLANA;
        default: throw new Error(`Unsupported chain: ${chain}`);
      }
    });
  }),
  protocols: z.string().optional().transform((str) => {
    if (!str) return undefined;
    return str.split(',').map(protocol => {
      const protocolLower = protocol.toLowerCase();
      switch (protocolLower) {
        case 'aave': case 'aave-v3': return DeFiProtocol.AAVE_V3;
        case 'compound': case 'compound-v3': return DeFiProtocol.COMPOUND_V3;
        case 'uniswap': case 'uniswap-v3': return DeFiProtocol.UNISWAP_V3;
        case 'curve': return DeFiProtocol.CURVE;
        case 'yearn': return DeFiProtocol.YEARN;
        case 'convex': return DeFiProtocol.CONVEX;
        case 'makerdao': case 'maker': return DeFiProtocol.MAKER_DAO;
        case 'lido': return DeFiProtocol.LIDO;
        case 'rocket-pool': case 'rocketpool': return DeFiProtocol.ROCKET_POOL;
        case 'balancer': return DeFiProtocol.BALANCER;
        default: throw new Error(`Unsupported protocol: ${protocol}`);
      }
    });
  }),
  includeInactive: z.string().optional().transform(val => val === 'true'),
  minValueUSD: z.string().optional().transform(val => val ? parseFloat(val) : undefined),
});

// GET /api/defi/:address - Get DeFi portfolio for an address
router.get('/:address', asyncHandler(async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    // Validate parameters
    const { address } = AddressParamSchema.parse(req.params);
    const queryParams = DeFiQuerySchema.parse(req.query);
    
    logger.info('DeFi portfolio request started', {
      address,
      chains: queryParams.chains?.length || 'all',
      protocols: queryParams.protocols?.length || 'all',
      requestId: req.headers['x-request-id'] || 'unknown',
    });

    // Validate address format for at least one supported chain
    const targetChains = queryParams.chains || [ChainId.ETHEREUM, ChainId.POLYGON, ChainId.ARBITRUM, ChainId.OPTIMISM];
    let validAddress = false;
    
    for (const chainId of targetChains) {
      if (validateAddress(address, chainId)) {
        validAddress = true;
        break;
      }
    }

    if (!validAddress) {
      throw new ValidationError('Invalid address format for supported chains', {
        address,
        supportedChains: targetChains.map(id => CHAIN_CONFIGS[id]?.name || id.toString()),
      });
    }

    // Fetch DeFi portfolio
    const portfolioResponse = await defiOrchestrator.getDeFiPortfolio(address, {
      chainIds: queryParams.chains,
      protocols: queryParams.protocols,
      includeInactive: queryParams.includeInactive,
    });

    if (!portfolioResponse.success) {
      return res.status(500).json({
        success: false,
        error: portfolioResponse.error,
        metadata: {
          address,
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'],
        },
      });
    }

    let portfolio = portfolioResponse.data!;

    // Apply value filter if specified
    if (queryParams.minValueUSD !== undefined) {
      portfolio.positions = portfolio.positions.filter(pos => 
        pos.totalValueUSD >= queryParams.minValueUSD!
      );
      
      // Recalculate totals after filtering
      portfolio.totalValueUSD = portfolio.positions.reduce((sum, pos) => sum + pos.totalValueUSD, 0);
      portfolio.netValueUSD = portfolio.positions.reduce((sum, pos) => sum + pos.netValueUSD, 0);
    }

    const duration = Date.now() - startTime;
    logPerformance('defi-portfolio-fetch', duration, {
      address,
      positionCount: portfolio.positions.length,
      protocolCount: portfolio.protocolDistribution.length,
      totalValueUSD: portfolio.totalValueUSD,
    });

    // Validate response schema
    const validatedPortfolio = DeFiPortfolioSummarySchema.parse(portfolio);

    res.json({
      success: true,
      data: validatedPortfolio,
      metadata: {
        address,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'],
        duration: `${duration}ms`,
        cacheStatus: portfolioResponse.metadata.cacheHit ? 'hit' : 'miss',
        supportedProtocols: defiOrchestrator.getRegisteredProtocols(),
      },
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    
    if (error instanceof z.ZodError) {
      throw new ValidationError('Invalid request parameters', error.errors);
    }

    logger.error('DeFi portfolio request failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      address: req.params.address,
      duration,
    });

    throw error;
  }
}));

// GET /api/defi/:address/protocol/:protocol - Get positions for specific protocol
router.get('/:address/protocol/:protocol', asyncHandler(async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const { address, protocol } = z.object({
      address: z.string().min(1),
      protocol: z.string().transform((val) => {
        const protocolLower = val.toLowerCase();
        switch (protocolLower) {
          case 'aave': case 'aave-v3': return DeFiProtocol.AAVE_V3;
          case 'compound': case 'compound-v3': return DeFiProtocol.COMPOUND_V3;
          case 'uniswap': case 'uniswap-v3': return DeFiProtocol.UNISWAP_V3;
          case 'curve': return DeFiProtocol.CURVE;
          case 'yearn': return DeFiProtocol.YEARN;
          case 'convex': return DeFiProtocol.CONVEX;
          case 'makerdao': case 'maker': return DeFiProtocol.MAKER_DAO;
          case 'lido': return DeFiProtocol.LIDO;
          case 'rocket-pool': case 'rocketpool': return DeFiProtocol.ROCKET_POOL;
          case 'balancer': return DeFiProtocol.BALANCER;
          default: throw new Error(`Unsupported protocol: ${val}`);
        }
      }),
    }).parse(req.params);

    const { chainId } = z.object({
      chainId: z.string().optional().transform((val) => {
        if (!val) return undefined;
        const chainUpper = val.toUpperCase();
        switch (chainUpper) {
          case 'ETHEREUM': case 'ETH': case '1': return ChainId.ETHEREUM;
          case 'POLYGON': case 'MATIC': case '137': return ChainId.POLYGON;
          case 'ARBITRUM': case 'ARB': case '42161': return ChainId.ARBITRUM;
          case 'OPTIMISM': case 'OP': case '10': return ChainId.OPTIMISM;
          case 'BASE': case '8453': return ChainId.BASE;
          default: throw new Error(`Unsupported chain: ${val}`);
        }
      }),
    }).parse(req.query);

    // Validate address
    if (chainId && !validateAddress(address, chainId)) {
      throw new ValidationError(`Invalid address format for ${CHAIN_CONFIGS[chainId]?.name || chainId}`, {
        address,
        chain: CHAIN_CONFIGS[chainId]?.name || chainId,
      });
    }

    // Fetch protocol positions
    const positionsResponse = await defiOrchestrator.getProtocolPositions(protocol, address, chainId);

    if (!positionsResponse.success) {
      return res.status(500).json({
        success: false,
        error: positionsResponse.error,
        metadata: {
          address,
          protocol,
          chainId: chainId?.toString(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const positions = positionsResponse.data!;
    
    const duration = Date.now() - startTime;
    logPerformance('protocol-positions-fetch', duration, {
      address,
      protocol,
      chainId: chainId?.toString(),
      positionCount: positions.length,
    });

    res.json({
      success: true,
      data: positions,
      metadata: {
        address,
        protocol,
        chainId: chainId?.toString(),
        protocolInfo: PROTOCOL_CONFIGS[protocol],
        timestamp: new Date().toISOString(),
        duration: `${duration}ms`,
        requestId: positionsResponse.metadata.requestId,
      },
    });

  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof z.ZodError) {
      throw new ValidationError('Invalid request parameters', error.errors);
    }

    logger.error('Protocol positions request failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      params: req.params,
      query: req.query,
      duration,
    });

    throw error;
  }
}));

// GET /api/defi/protocols - Get supported protocols and their health
router.get('/protocols', asyncHandler(async (req: Request, res: Response) => {
  try {
    const registeredProtocols = defiOrchestrator.getRegisteredProtocols();
    const healthStatus = defiOrchestrator.getHealthStatus();

    const protocols = registeredProtocols.map(protocol => ({
      id: protocol,
      ...PROTOCOL_CONFIGS[protocol],
      health: healthStatus[protocol] || {
        isHealthy: false,
        lastCheckedAt: new Date(),
        responseTime: undefined,
        errorRate: 1.0,
        uptime: 0,
        issues: ['Not registered'],
      },
    }));

    const healthySummary = {
      total: registeredProtocols.length,
      healthy: Object.values(healthStatus).filter(h => h.isHealthy).length,
      unhealthy: Object.values(healthStatus).filter(h => !h.isHealthy).length,
    };

    res.json({
      success: true,
      data: {
        protocols,
        healthySummary,
      },
      metadata: {
        timestamp: new Date().toISOString(),
        service: 'crypto-data-service',
      },
    });
  } catch (error) {
    logger.error('Failed to get protocol information', { error });
    res.status(500).json({
      success: false,
      error: {
        code: 'PROTOCOLS_ERROR',
        message: 'Failed to retrieve protocol information',
      },
    });
  }
}));

// GET /api/defi/yield-opportunities - Get yield farming opportunities
router.get('/yield-opportunities', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { chainIds, minAPY } = z.object({
      chainIds: z.string().optional().transform((str) => {
        if (!str) return undefined;
        return str.split(',').map(chain => {
          const chainUpper = chain.toUpperCase();
          switch (chainUpper) {
            case 'ETHEREUM': case 'ETH': return ChainId.ETHEREUM;
            case 'POLYGON': case 'MATIC': return ChainId.POLYGON;
            case 'ARBITRUM': case 'ARB': return ChainId.ARBITRUM;
            case 'OPTIMISM': case 'OP': return ChainId.OPTIMISM;
            case 'BASE': return ChainId.BASE;
            default: throw new Error(`Unsupported chain: ${chain}`);
          }
        });
      }),
      minAPY: z.string().optional().transform(val => val ? parseFloat(val) : 0),
    }).parse(req.query);

    const opportunitiesResponse = await defiOrchestrator.getYieldOpportunities(chainIds, minAPY);

    if (!opportunitiesResponse.success) {
      return res.status(500).json({
        success: false,
        error: opportunitiesResponse.error,
        metadata: {
          timestamp: new Date().toISOString(),
        },
      });
    }

    res.json({
      success: true,
      data: opportunitiesResponse.data,
      metadata: {
        filters: {
          chainIds: chainIds?.map(id => CHAIN_CONFIGS[id]?.name || id.toString()),
          minAPY,
        },
        timestamp: new Date().toISOString(),
        requestId: opportunitiesResponse.metadata.requestId,
      },
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError('Invalid request parameters', error.errors);
    }

    logger.error('Yield opportunities request failed', { error });
    throw error;
  }
}));

// GET /api/defi/stats - Get DeFi service statistics
router.get('/stats', asyncHandler(async (req: Request, res: Response) => {
  try {
    const healthStatus = defiOrchestrator.getHealthStatus();
    const registeredProtocols = defiOrchestrator.getRegisteredProtocols();

    const stats = {
      protocols: {
        total: registeredProtocols.length,
        healthy: Object.values(healthStatus).filter(h => h.isHealthy).length,
        averageResponseTime: Object.values(healthStatus)
          .filter(h => h.responseTime !== undefined)
          .reduce((sum, h, _, arr) => sum + (h.responseTime! / arr.length), 0),
      },
      service: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: '1.0.0',
      },
    };

    res.json({
      success: true,
      data: stats,
      metadata: {
        timestamp: new Date().toISOString(),
        service: 'crypto-data-service',
      },
    });
  } catch (error) {
    logger.error('Failed to get DeFi service stats', { error });
    res.status(500).json({
      success: false,
      error: {
        code: 'STATS_ERROR',
        message: 'Failed to retrieve service statistics',
      },
    });
  }
}));

export { router as defiRouter };