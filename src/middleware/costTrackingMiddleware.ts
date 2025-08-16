import { Request, Response, NextFunction } from 'express';
import { logger, logError, createContextualLogger } from '@/utils/logger';
import { getCostTracker } from '@/services/cost/CostTracker';
import type { Config } from '@/config';
import type { CostTrackingContext } from './interfaces';

/**
 * Cost Tracking Middleware
 *
 * Automatically tracks API costs for all requests, including:
 * - External API calls
 * - Database operations
 * - Cache operations
 * - Response time tracking
 */

// CostTrackingContext moved to '@/types/cost-monitoring'

// Extend Express Request to include cost tracking
declare global {
  namespace Express {
    interface Request {
      costTracking?: CostTrackingContext;
    }
  }
}

const costTracker = getCostTracker();
const contextLogger = createContextualLogger({ component: 'CostTrackingMiddleware' });

/**
 * Initialize cost tracking for a request
 */
export const initializeCostTracking = (req: Request, res: Response, next: NextFunction): void => {
  try {
    req.costTracking = {
      startTime: Date.now(),
      metadata: {
        method: req.method,
        path: req.path,
        userAgent: req.get('User-Agent'),
        origin: req.get('Origin'),
        requestId:
          req.get('X-Request-ID') || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      },
    };

    // Add request ID to response headers
    res.set('X-Request-ID', req.costTracking?.metadata?.requestId || '');

    next();
  } catch (error) {
    logError(error as Error, { operation: 'initializeCostTracking' });
    next(error);
  }
};

/**
 * Finalize cost tracking and record costs
 */
export const finalizeCostTracking = (req: Request, res: Response, next: NextFunction): void => {
  res.on('finish', () => {
    try {
      const ctx = req.costTracking;
      if (!ctx) return;
      const responseTime = Date.now() - ctx.startTime;
      const success = res.statusCode < 400;
      const estimatedCost = calculateRequestCost(req, res, responseTime);
      if (estimatedCost > 0) {
        costTracker
          .trackCost(ctx.provider || 'internal', ctx.endpoint || req.path, estimatedCost, {
            requestType: ctx.operationType || getOperationType(req),
            success,
          })
          .catch(error => {
            logError(error, { operation: 'trackAPICall', path: req.path });
          });
      }
      contextLogger.debug('Request cost tracked', {
        path: req.path,
        method: req.method,
        responseTime,
        estimatedCost,
        statusCode: res.statusCode,
        requestId: ctx.metadata?.requestId,
      });
    } catch (error) {
      logError(error as Error, { operation: 'finalizeCostTracking' });
    }
  });
  next();
};

/**
 * Track external API call costs
 */
export const trackExternalAPICost = (
  provider: string,
  endpoint: string,
  cost: number,
  options: {
    req?: Request;
    computeUnits?: number;
    cacheHit?: boolean;
    batchSize?: number;
    responseTime?: number;
    success?: boolean;
    metadata?: Record<string, any>;
  } = {}
): void => {
  try {
    // Update request context if available
    if (options.req?.costTracking) {
      options.req.costTracking.provider = provider;
      options.req.costTracking.endpoint = endpoint;
      options.req.costTracking.estimatedCost = (options.req.costTracking.estimatedCost || 0) + cost;
    }

    // Track the cost immediately for external APIs
    costTracker
      .trackCost(provider, endpoint, cost, {
        cacheHit: options.cacheHit,
        success: options.success,
        requestType: 'external_api',
      })
      .catch(error => {
        logError(error, { operation: 'trackExternalAPICost', provider, endpoint });
      });

    contextLogger.debug('External API cost tracked', {
      provider,
      endpoint,
      cost,
      cacheHit: options.cacheHit,
      success: options.success,
    });
  } catch (error) {
    logError(error as Error, {
      operation: 'trackExternalAPICost',
      provider,
      endpoint,
      cost,
    });
  }
};

/**
 * Create a wrapper for provider methods to automatically track costs
 */
export const createCostTrackingWrapper = <T extends (...args: any[]) => Promise<any>>(
  originalMethod: T,
  provider: string,
  methodName: string,
  baseCost: number = 0.001
): T => {
  return (async (...args: any[]) => {
    const startTime = Date.now();
    let success = false;
    let error: Error | null = null;

    try {
      const result = await originalMethod(...args);
      success = true;
      return result;
    } catch (err) {
      error = err as Error;
      throw err;
    } finally {
      const responseTime = Date.now() - startTime;
      const cost = calculateMethodCost(provider, methodName, baseCost, responseTime, success);

      trackExternalAPICost(provider, methodName, cost, {
        responseTime,
        success,
        metadata: {
          methodName,
          argumentCount: args.length,
          error: error?.message,
        },
      });
    }
  }) as T;
};

// Private helper functions

/**
 * Calculate estimated cost for a request
 */
function calculateRequestCost(req: Request, res: Response, responseTime: number): number {
  let baseCost = 0;

  // Base cost for processing
  baseCost += 0.0001; // $0.0001 base cost

  // Add cost based on response time (computing resources)
  if (responseTime > 1000) baseCost += 0.0002; // Slow requests cost more
  if (responseTime > 5000) baseCost += 0.0005; // Very slow requests

  // Add cost based on response size
  const responseSize = parseInt(res.get('Content-Length') || '0', 10);
  if (responseSize > 1024 * 100) baseCost += 0.0001; // Large responses (>100KB)
  if (responseSize > 1024 * 1024) baseCost += 0.0005; // Very large responses (>1MB)

  // Add cost based on operation complexity
  const operationType = getOperationType(req);
  switch (operationType) {
    case 'balance_query':
    case 'transaction_history':
      baseCost += 0.0005;
      break;
    case 'portfolio_analysis':
    case 'defi_data':
      baseCost += 0.001;
      break;
    case 'nft_data':
      baseCost += 0.0008;
      break;
    case 'real_time_data':
      baseCost += 0.0003;
      break;
    default:
      baseCost += 0.0001;
  }

  // Error responses cost less (no successful computation)
  if (res.statusCode >= 400) {
    baseCost *= 0.1;
  }

  return Math.round(baseCost * 10000) / 10000; // Round to 4 decimal places
}

/**
 * Calculate cost for a provider method call
 */
function calculateMethodCost(
  provider: string,
  methodName: string,
  baseCost: number,
  responseTime: number,
  success: boolean
): number {
  let cost = baseCost;

  // Provider-specific cost multipliers
  const providerMultipliers: Record<string, number> = {
    alchemy: 1.0,
    moralis: 0.8,
    quicknode: 1.2,
    infura: 0.9,
    ankr: 0.7,
  };

  cost *= providerMultipliers[provider.toLowerCase()] || 1.0;

  // Method-specific cost adjustments
  if (methodName.includes('getBalance')) cost *= 1.0;
  else if (methodName.includes('getTransaction')) cost *= 1.5;
  else if (methodName.includes('getTokenMetadata')) cost *= 0.5;
  else if (methodName.includes('getAssetTransfers')) cost *= 2.0;
  else if (methodName.includes('getNFTs')) cost *= 1.8;

  // Response time adjustment
  if (responseTime > 2000) cost *= 1.2; // Slow responses might indicate complex queries
  if (responseTime > 5000) cost *= 1.5;

  // Failed requests cost less
  if (!success) cost *= 0.1;

  return Math.round(cost * 10000) / 10000; // Round to 4 decimal places
}

/**
 * Determine operation type from request
 */
function getOperationType(req: Request): string {
  const path = req.path.toLowerCase();
  const method = req.method.toLowerCase();

  if (path.includes('/balance')) return 'balance_query';
  if (path.includes('/transaction')) return 'transaction_history';
  if (path.includes('/portfolio')) return 'portfolio_analysis';
  if (path.includes('/defi')) return 'defi_data';
  if (path.includes('/nft')) return 'nft_data';
  if (path.includes('/price')) return 'price_data';
  if (path.includes('/real-time') || path.includes('/live')) return 'real_time_data';
  if (method === 'post') return 'data_write';
  if (method === 'get') return 'data_read';

  return 'unknown';
}

/**
 * Middleware to track database operation costs
 */
export const trackDatabaseCost = (
  operationType: 'read' | 'write' | 'update' | 'delete',
  tableName: string,
  recordCount: number = 1,
  responseTime: number
): void => {
  try {
    const baseCosts = {
      read: 0.00005,
      write: 0.0001,
      update: 0.00008,
      delete: 0.00006,
    };

    let cost = baseCosts[operationType] * recordCount;

    // Add cost for response time (expensive queries)
    if (responseTime > 500) cost += 0.00002;
    if (responseTime > 2000) cost += 0.00005;

    trackExternalAPICost('database', tableName, cost, {
      responseTime,
      success: true,
      metadata: {
        operationType,
        recordCount,
        tableName,
      },
    });
  } catch (error) {
    logError(error as Error, {
      operation: 'trackDatabaseCost',
      operationType,
      tableName,
    });
  }
};

/**
 * Middleware to track cache operation costs
 */
export const trackCacheCost = (
  operationType: 'hit' | 'miss' | 'set' | 'delete',
  cacheKey: string,
  dataSize: number = 0
): void => {
  try {
    const baseCosts = {
      hit: 0.000001, // Cache hits are very cheap
      miss: 0.00001, // Cache misses cost more due to fallback operations
      set: 0.00002, // Setting cache has some cost
      delete: 0.00001, // Deleting is relatively cheap
    };

    let cost = baseCosts[operationType];

    // Add cost based on data size for set operations
    if (operationType === 'set' && dataSize > 1024) {
      cost += (dataSize / (1024 * 1024)) * 0.000001; // Per MB
    }

    trackExternalAPICost('cache', `cache_${operationType}`, cost, {
      success: true,
      metadata: {
        operationType,
        cacheKey: cacheKey.substring(0, 100), // Truncate long keys
        dataSize,
      },
    });
  } catch (error) {
    logError(error as Error, {
      operation: 'trackCacheCost',
      operationType,
      cacheKey,
    });
  }
};

/**
 * Express middleware wrapper that combines all cost tracking functionality
 */
export const costTrackingMiddleware = [initializeCostTracking, finalizeCostTracking];

export default costTrackingMiddleware;
