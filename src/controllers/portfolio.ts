import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ValidationError } from '@/middleware/errorHandler';
import { chainManager } from '@/services/ChainManager';
import { logger, logPerformance } from '@/utils/logger';
import { 
  ChainId, 
  validateAddress,
  CHAIN_CONFIGS,
  MultiChainPortfolioSchema,
  PortfolioSummarySchema 
} from '@/types/blockchain';

const router = Router();

// Validation schemas
const AddressParamSchema = z.object({
  address: z.string().min(1, 'Address is required'),
});

const ChainQuerySchema = z.object({
  chains: z.string().optional().transform((str) => {
    if (!str) return undefined;
    return str.split(',').map(chain => {
      const chainUpper = chain.toUpperCase();
      // Convert chain names to ChainId
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
  includeNative: z.string().optional().transform(val => val === 'true'),
  includeZeroBalances: z.string().optional().transform(val => val === 'true'),
  minBalanceUSD: z.string().optional().transform(val => val ? parseFloat(val) : undefined),
});

const BalanceQuerySchema = z.object({
  tokenAddress: z.string().optional(),
  symbol: z.string().optional(),
});

// GET /api/portfolio/:address - Multi-chain portfolio
router.get('/:address', asyncHandler(async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    // Validate parameters
    const { address } = AddressParamSchema.parse(req.params);
    const queryParams = ChainQuerySchema.parse(req.query);
    
    logger.info('Portfolio request started', {
      address,
      chains: queryParams.chains?.length || 'all',
      requestId: req.headers['x-request-id'] || 'unknown',
    });

    // Validate address format for at least one supported chain
    const supportedChains = queryParams.chains || chainManager.getHealthyChains();
    let validAddress = false;
    
    for (const chainId of supportedChains) {
      if (validateAddress(address, chainId)) {
        validAddress = true;
        break;
      }
    }

    if (!validAddress) {
      throw new ValidationError('Invalid address format for supported chains', {
        address,
        supportedChains: supportedChains.map(id => CHAIN_CONFIGS[id].name),
      });
    }

    // Fetch multi-chain portfolio
    const portfolioResponse = await chainManager.getMultiChainPortfolio(address, queryParams.chains);

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

    // Apply filters
    if (queryParams.minBalanceUSD !== undefined) {
      portfolio.chains = portfolio.chains.map(chain => ({
        ...chain,
        tokens: chain.tokens.filter(token => 
          (token.balanceUSD || 0) >= queryParams.minBalanceUSD!
        ),
      })).filter(chain => chain.tokens.length > 0);
    }

    if (!queryParams.includeZeroBalances) {
      portfolio.chains = portfolio.chains.map(chain => ({
        ...chain,
        tokens: chain.tokens.filter(token => 
          parseFloat(token.balanceFormatted) > 0
        ),
      })).filter(chain => chain.tokens.length > 0);
    }

    if (!queryParams.includeNative) {
      portfolio.chains = portfolio.chains.map(chain => ({
        ...chain,
        tokens: chain.tokens.filter(token => !token.token.isNative),
      }));
    }

    // Recalculate totals after filtering
    const totalTokens = portfolio.chains.reduce((sum, chain) => sum + chain.tokens.length, 0);
    portfolio.metadata.totalTokens = totalTokens;

    const duration = Date.now() - startTime;
    logPerformance('portfolio-fetch', duration, {
      address,
      chainCount: portfolio.chains.length,
      totalTokens,
    });

    // Validate response schema
    const validatedPortfolio = MultiChainPortfolioSchema.parse(portfolio);

    res.json({
      success: true,
      data: validatedPortfolio,
      metadata: {
        address,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'],
        duration: `${duration}ms`,
        cacheStatus: portfolio.metadata.cacheHitRate ? 'hit' : 'miss',
        supportedChains: chainManager.getSupportedChains().map(id => CHAIN_CONFIGS[id].name),
      },
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    
    if (error instanceof z.ZodError) {
      throw new ValidationError('Invalid request parameters', error.errors);
    }

    logger.error('Portfolio request failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      address: req.params.address,
      duration,
    });

    throw error;
  }
}));

// GET /api/portfolio/:address/chain/:chainId - Single chain portfolio  
router.get('/:address/chain/:chainId', asyncHandler(async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const { address, chainId } = AddressParamSchema.extend({
      chainId: z.string().transform((val) => {
        const chainUpper = val.toUpperCase();
        switch (chainUpper) {
          case 'ETHEREUM': case 'ETH': case '1': return ChainId.ETHEREUM;
          case 'POLYGON': case 'MATIC': case '137': return ChainId.POLYGON;
          case 'ARBITRUM': case 'ARB': case '42161': return ChainId.ARBITRUM;
          case 'OPTIMISM': case 'OP': case '10': return ChainId.OPTIMISM;
          case 'BASE': case '8453': return ChainId.BASE;
          case 'SOLANA': case 'SOL': return ChainId.SOLANA;
          default: throw new Error(`Unsupported chain: ${val}`);
        }
      }),
    }).parse(req.params);

    const queryParams = z.object({
      includeNative: z.string().optional().transform(val => val === 'true'),
      includeZeroBalances: z.string().optional().transform(val => val === 'true'),
    }).parse(req.query);

    // Validate address for the specific chain
    if (!validateAddress(address, chainId)) {
      throw new ValidationError(`Invalid address format for ${CHAIN_CONFIGS[chainId].name}`, {
        address,
        chain: CHAIN_CONFIGS[chainId].name,
        expectedFormat: chainId === ChainId.SOLANA ? 'Base58 (32-44 chars)' : '0x + 40 hex chars',
      });
    }

    // Fetch chain-specific balance
    const balanceResponse = await chainManager.getBalance(chainId, address);

    if (!balanceResponse.success) {
      return res.status(500).json({
        success: false,
        error: balanceResponse.error,
        metadata: {
          address,
          chainId: chainId.toString(),
          chain: CHAIN_CONFIGS[chainId].name,
          timestamp: new Date().toISOString(),
        },
      });
    }

    let tokens = balanceResponse.data!;

    // Apply filters
    if (!queryParams.includeZeroBalances) {
      tokens = tokens.filter(token => parseFloat(token.balanceFormatted) > 0);
    }

    if (!queryParams.includeNative) {
      tokens = tokens.filter(token => !token.token.isNative);
    }

    // Calculate chain summary
    const totalValueUSD = tokens.reduce((sum, token) => sum + (token.balanceUSD || 0), 0);
    const nativeBalance = tokens.find(t => t.token.isNative);

    const chainSummary: PortfolioSummary = {
      address,
      chainId,
      totalValueUSD,
      tokenCount: tokens.length,
      tokens,
      nativeBalance,
      lastUpdated: new Date(),
    };

    const duration = Date.now() - startTime;
    logPerformance('chain-portfolio-fetch', duration, {
      address,
      chainId: chainId.toString(),
      tokenCount: tokens.length,
    });

    res.json({
      success: true,
      data: chainSummary,
      metadata: {
        address,
        chainId: chainId.toString(),
        chain: CHAIN_CONFIGS[chainId].name,
        timestamp: new Date().toISOString(),
        duration: `${duration}ms`,
        provider: balanceResponse.metadata.provider,
        requestId: balanceResponse.metadata.requestId,
      },
    });

  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof z.ZodError) {
      throw new ValidationError('Invalid request parameters', error.errors);
    }

    logger.error('Chain portfolio request failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      params: req.params,
      duration,
    });

    throw error;
  }
}));

// GET /api/portfolio/:address/balance/:tokenAddress?chainId=:chainId - Specific token balance
router.get('/:address/balance/:tokenAddress', asyncHandler(async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const { address, tokenAddress } = AddressParamSchema.extend({
      tokenAddress: z.string().min(1, 'Token address is required'),
    }).parse(req.params);

    const { chainId } = z.object({
      chainId: z.string().transform((val) => {
        const chainUpper = val.toUpperCase();
        switch (chainUpper) {
          case 'ETHEREUM': case 'ETH': case '1': return ChainId.ETHEREUM;
          case 'POLYGON': case 'MATIC': case '137': return ChainId.POLYGON;
          case 'ARBITRUM': case 'ARB': case '42161': return ChainId.ARBITRUM;
          case 'OPTIMISM': case 'OP': case '10': return ChainId.OPTIMISM;
          case 'BASE': case '8453': return ChainId.BASE;
          case 'SOLANA': case 'SOL': return ChainId.SOLANA;
          default: throw new Error(`Unsupported chain: ${val}`);
        }
      }),
    }).parse(req.query);

    // Validate address
    if (!validateAddress(address, chainId)) {
      throw new ValidationError(`Invalid address format for ${CHAIN_CONFIGS[chainId].name}`);
    }

    // Get specific token balance
    const balanceResponse = await chainManager.getBalance(chainId, address);

    if (!balanceResponse.success) {
      return res.status(500).json({
        success: false,
        error: balanceResponse.error,
        metadata: {
          address,
          tokenAddress,
          chainId: chainId.toString(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Find the specific token
    const token = balanceResponse.data!.find(t => 
      t.token.address.toLowerCase() === tokenAddress.toLowerCase() ||
      t.token.symbol.toLowerCase() === tokenAddress.toLowerCase()
    );

    if (!token) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TOKEN_NOT_FOUND',
          message: `Token ${tokenAddress} not found in wallet`,
        },
        metadata: {
          address,
          tokenAddress,
          chainId: chainId.toString(),
          availableTokens: balanceResponse.data!.map(t => ({
            address: t.token.address,
            symbol: t.token.symbol,
          })),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const duration = Date.now() - startTime;
    logPerformance('token-balance-fetch', duration, {
      address,
      tokenAddress,
      chainId: chainId.toString(),
    });

    res.json({
      success: true,
      data: token,
      metadata: {
        address,
        tokenAddress,
        chainId: chainId.toString(),
        chain: CHAIN_CONFIGS[chainId].name,
        timestamp: new Date().toISOString(),
        duration: `${duration}ms`,
        provider: balanceResponse.metadata.provider,
      },
    });

  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof z.ZodError) {
      throw new ValidationError('Invalid request parameters', error.errors);
    }

    logger.error('Token balance request failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      params: req.params,
      query: req.query,
      duration,
    });

    throw error;
  }
}));

// GET /api/portfolio/chains - Get supported chains
router.get('/chains', asyncHandler(async (req: Request, res: Response) => {
  const healthStatus = chainManager.getHealthStatus();
  const supportedChains = chainManager.getSupportedChains();

  const chains = supportedChains.map(chainId => ({
    id: chainId,
    name: CHAIN_CONFIGS[chainId].name,
    symbol: CHAIN_CONFIGS[chainId].symbol,
    healthy: healthStatus.providerStatus[CHAIN_CONFIGS[chainId].name]?.healthy || false,
    provider: healthStatus.providerStatus[CHAIN_CONFIGS[chainId].name]?.provider,
    explorerUrl: CHAIN_CONFIGS[chainId].explorerUrl,
    features: CHAIN_CONFIGS[chainId].features,
  }));

  res.json({
    success: true,
    data: {
      supportedChains: chains,
      healthySummary: {
        total: healthStatus.totalProviders,
        healthy: healthStatus.healthyProviders,
        healthPercentage: healthStatus.healthPercentage,
      },
    },
    metadata: {
      timestamp: new Date().toISOString(),
      service: 'crypto-data-service',
    },
  });
}));

// GET /api/portfolio/stats - Get service statistics
router.get('/stats', asyncHandler(async (req: Request, res: Response) => {
  const healthStatus = chainManager.getHealthStatus();
  const costStats = chainManager.getCostStatistics();

  res.json({
    success: true,
    data: {
      health: healthStatus,
      costs: costStats,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    },
    metadata: {
      timestamp: new Date().toISOString(),
      service: 'crypto-data-service',
      version: '1.0.0',
    },
  });
}));

export { router as portfolioRouter };