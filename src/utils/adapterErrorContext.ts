import { logCorrelatedError, logCorrelatedPerformance } from './logger';
import { ChainId } from '../types/blockchain';

export interface AdapterErrorContext {
  adapter: string;
  operation: string;
  address?: string;
  chainId?: ChainId | string;
  positionId?: string;
  tokenAddress?: string;
  protocolVersion?: string;
  attempt?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  [key: string]: any;
}

export interface AdapterOperationContext extends AdapterErrorContext {
  startTime: number;
}

/**
 * Standardized error logging for DeFi adapters
 */
export const logAdapterError = (
  error: Error | unknown,
  context: AdapterErrorContext,
  correlationId?: string
): void => {
  const errorInstance = error instanceof Error ? error : new Error(String(error));
  
  logCorrelatedError(errorInstance, correlationId, {
    ...context,
    adapterType: 'defi',
    timestamp: new Date().toISOString(),
  });
};

/**
 * Standardized performance logging for DeFi adapters
 */
export const logAdapterPerformance = (
  context: AdapterOperationContext,
  correlationId?: string
): void => {
  const duration = Date.now() - context.startTime;
  
  logCorrelatedPerformance(
    `${context.adapter}.${context.operation}`,
    duration,
    correlationId,
    {
      adapter: context.adapter,
      operation: context.operation,
      address: context.address,
      chainId: context.chainId,
      positionId: context.positionId,
      adapterType: 'defi',
      timestamp: new Date().toISOString(),
    }
  );
};

/**
 * Wrapper function for adapter operations with standardized error handling and performance tracking
 */
export const executeAdapterOperation = async <T>(
  operation: () => Promise<T>,
  context: AdapterErrorContext,
  correlationId?: string
): Promise<T | null> => {
  const operationContext: AdapterOperationContext = {
    ...context,
    startTime: Date.now(),
  };

  try {
    const result = await operation();
    logAdapterPerformance(operationContext, correlationId);
    return result;
  } catch (error) {
    logAdapterError(error, context, correlationId);
    return null;
  }
};

/**
 * Retry wrapper for adapter operations
 */
export const retryAdapterOperation = async <T>(
  operation: () => Promise<T>,
  context: AdapterErrorContext,
  maxAttempts: number = 3,
  delayMs: number = 1000,
  correlationId?: string
): Promise<T | null> => {
  let lastError: Error | unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptContext: AdapterOperationContext = {
      ...context,
      attempt,
      maxAttempts,
      startTime: Date.now(),
    };

    try {
      const result = await operation();
      logAdapterPerformance(attemptContext, correlationId);
      return result;
    } catch (error) {
      lastError = error;
      
      if (attempt === maxAttempts) {
        logAdapterError(error, { ...context, attempt, maxAttempts, finalAttempt: true }, correlationId);
      } else {
        logAdapterError(error, { ...context, attempt, maxAttempts, retrying: true }, correlationId);
        
        // Wait before retry with exponential backoff
        const backoffDelay = delayMs * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }
  }

  return null;
};

/**
 * Health check wrapper for adapters
 */
export const checkAdapterHealth = async (
  adapter: string,
  healthCheckFn: () => Promise<boolean>,
  correlationId?: string
): Promise<{ isHealthy: boolean; responseTime: number; error?: Error }> => {
  const startTime = Date.now();
  
  try {
    const isHealthy = await healthCheckFn();
    const responseTime = Date.now() - startTime;
    
    logAdapterPerformance({
      adapter,
      operation: 'healthCheck',
      startTime,
    }, correlationId);
    
    return { isHealthy, responseTime };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorInstance = error instanceof Error ? error : new Error(String(error));
    
    logAdapterError(error, {
      adapter,
      operation: 'healthCheck',
      responseTime,
    }, correlationId);
    
    return { isHealthy: false, responseTime, error: errorInstance };
  }
};

/**
 * Standard adapter error types for categorization
 */
export enum AdapterErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  PARSING_ERROR = 'PARSING_ERROR',
  CONTRACT_ERROR = 'CONTRACT_ERROR',
  INSUFFICIENT_DATA_ERROR = 'INSUFFICIENT_DATA_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Categorize errors for better handling
 */
export const categorizeAdapterError = (error: Error | unknown): AdapterErrorType => {
  const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  
  if (errorMessage.includes('network') || errorMessage.includes('connection')) {
    return AdapterErrorType.NETWORK_ERROR;
  }
  
  if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
    return AdapterErrorType.TIMEOUT_ERROR;
  }
  
  if (errorMessage.includes('rate limit') || errorMessage.includes('too many requests')) {
    return AdapterErrorType.RATE_LIMIT_ERROR;
  }
  
  if (errorMessage.includes('unauthorized') || errorMessage.includes('forbidden') || errorMessage.includes('api key')) {
    return AdapterErrorType.AUTHENTICATION_ERROR;
  }
  
  if (errorMessage.includes('invalid') || errorMessage.includes('validation')) {
    return AdapterErrorType.VALIDATION_ERROR;
  }
  
  if (errorMessage.includes('parse') || errorMessage.includes('json') || errorMessage.includes('decode')) {
    return AdapterErrorType.PARSING_ERROR;
  }
  
  if (errorMessage.includes('contract') || errorMessage.includes('revert') || errorMessage.includes('execution reverted')) {
    return AdapterErrorType.CONTRACT_ERROR;
  }
  
  if (errorMessage.includes('no data') || errorMessage.includes('not found') || errorMessage.includes('empty response')) {
    return AdapterErrorType.INSUFFICIENT_DATA_ERROR;
  }
  
  return AdapterErrorType.UNKNOWN_ERROR;
};