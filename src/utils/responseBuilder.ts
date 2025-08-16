/**
 * Standardized Response Builder for Crypto-Data Service
 *
 * Provides consistent response structures and error handling
 * across all routes and services as specified in PRD section 6.
 */

import { ErrorCode, getErrorDefinition } from './errorCatalog';

/**
 * Standard success response interface
 */
export interface SuccessResponse<T = any> {
  success: true;
  data: T;
  metadata: ResponseMetadata;
}

/**
 * Standard error response interface
 */
export interface ErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: any;
    provider?: string;
    retryable?: boolean;
  };
  metadata: ResponseMetadata;
}

/**
 * Response metadata interface
 */
export interface ResponseMetadata {
  timestamp: string;
  requestId?: string;
  processingTime?: number;
  cacheHit?: boolean;
  cost?: number;
  provider?: string;
  chainId?: string | number;
  [key: string]: any;
}

/**
 * Union type for all responses
 */
export type ApiResponse<T = any> = SuccessResponse<T> | ErrorResponse;

/**
 * Response builder class with fluent interface
 */
export class ResponseBuilder {
  private metadata: ResponseMetadata;

  constructor(requestId?: string) {
    this.metadata = {
      timestamp: new Date().toISOString(),
    };

    if (requestId) {
      this.metadata.requestId = requestId;
    }
  }

  /**
   * Add processing time to metadata
   */
  withProcessingTime(startTime: number): this {
    this.metadata.processingTime = Date.now() - startTime;
    return this;
  }

  /**
   * Add cache status to metadata
   */
  withCacheStatus(hit: boolean): this {
    this.metadata.cacheHit = hit;
    return this;
  }

  /**
   * Add cost information to metadata
   */
  withCost(cost: number): this {
    this.metadata.cost = cost;
    return this;
  }

  /**
   * Add provider information to metadata
   */
  withProvider(provider: string): this {
    this.metadata.provider = provider;
    return this;
  }

  /**
   * Add chain ID to metadata
   */
  withChain(chainId: string | number): this {
    this.metadata.chainId = chainId;
    return this;
  }

  /**
   * Add custom metadata field
   */
  withMetadata(key: string, value: any): this {
    this.metadata[key] = value;
    return this;
  }

  /**
   * Build a success response
   */
  success<T>(data: T): SuccessResponse<T> {
    return {
      success: true,
      data,
      metadata: { ...this.metadata },
    };
  }

  /**
   * Build an error response from error code
   */
  error(code: ErrorCode, details?: any): ErrorResponse {
    const definition = getErrorDefinition(code);

    return {
      success: false,
      error: {
        code,
        message: definition.message,
        details,
        retryable: definition.retryable,
      },
      metadata: { ...this.metadata },
    };
  }

  /**
   * Build an error response with custom message
   */
  errorWithMessage(code: ErrorCode, message: string, details?: any): ErrorResponse {
    const definition = getErrorDefinition(code);

    return {
      success: false,
      error: {
        code,
        message,
        details,
        retryable: definition.retryable,
      },
      metadata: { ...this.metadata },
    };
  }

  /**
   * Build a provider error response
   */
  providerError(code: ErrorCode, provider: string, details?: any): ErrorResponse {
    const definition = getErrorDefinition(code);

    return {
      success: false,
      error: {
        code,
        message: definition.message,
        details,
        provider,
        retryable: definition.retryable,
      },
      metadata: {
        ...this.metadata,
        provider,
      },
    };
  }
}

/**
 * Utility functions for common response patterns
 */

/**
 * Create a success response with minimal metadata
 */
export function createSuccessResponse<T>(
  data: T,
  requestId?: string,
  additionalMetadata?: Partial<ResponseMetadata>
): SuccessResponse<T> {
  const builder = new ResponseBuilder(requestId);

  if (additionalMetadata) {
    Object.entries(additionalMetadata).forEach(([key, value]) => {
      builder.withMetadata(key, value);
    });
  }

  return builder.success(data);
}

/**
 * Create an error response with minimal metadata
 */
export function createErrorResponse(
  code: ErrorCode,
  requestId?: string,
  details?: any,
  additionalMetadata?: Partial<ResponseMetadata>
): ErrorResponse {
  const builder = new ResponseBuilder(requestId);

  if (additionalMetadata) {
    Object.entries(additionalMetadata).forEach(([key, value]) => {
      builder.withMetadata(key, value);
    });
  }

  return builder.error(code, details);
}

/**
 * Create a provider error response
 */
export function createProviderErrorResponse(
  code: ErrorCode,
  provider: string,
  requestId?: string,
  details?: any,
  additionalMetadata?: Partial<ResponseMetadata>
): ErrorResponse {
  const builder = new ResponseBuilder(requestId);

  if (additionalMetadata) {
    Object.entries(additionalMetadata).forEach(([key, value]) => {
      builder.withMetadata(key, value);
    });
  }

  return builder.providerError(code, provider, details);
}

/**
 * Express.js response helper for success responses
 */
export function sendSuccess<T>(
  res: any,
  data: T,
  statusCode: number = 200,
  headers?: Record<string, string>
): void {
  if (headers) {
    Object.entries(headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
  }

  const response = createSuccessResponse(data, res.locals?.requestId);
  res.status(statusCode).json(response);
}

/**
 * Express.js response helper for error responses
 */
export function sendError(
  res: any,
  code: ErrorCode,
  details?: any,
  headers?: Record<string, string>
): void {
  const definition = getErrorDefinition(code);

  if (headers) {
    Object.entries(headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
  }

  const response = createErrorResponse(code, res.locals?.requestId, details);
  res.status(definition.httpStatus).json(response);
}

/**
 * Express.js response helper for provider errors
 */
export function sendProviderError(
  res: any,
  code: ErrorCode,
  provider: string,
  details?: any,
  headers?: Record<string, string>
): void {
  const definition = getErrorDefinition(code);

  if (headers) {
    Object.entries(headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
  }

  const response = createProviderErrorResponse(code, provider, res.locals?.requestId, details);
  res.status(definition.httpStatus).json(response);
}

/**
 * Validation helper for request parameters
 */
export function validateAndRespond<T>(
  res: any,
  validationResult: { success: boolean; data?: T; error?: any },
  errorCode: ErrorCode = ErrorCode.BAD_REQUEST
): T | null {
  if (!validationResult.success) {
    sendError(res, errorCode, validationResult.error);
    return null;
  }

  return validationResult.data!;
}

/**
 * Async operation wrapper with consistent error handling
 */
export async function withErrorHandling<T>(
  res: any,
  operation: () => Promise<T>,
  errorCode: ErrorCode = ErrorCode.INTERNAL_ERROR
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    const details =
      error instanceof Error
        ? {
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
          }
        : error;

    sendError(res, errorCode, details);
    return null;
  }
}

/**
 * Cache-aware response builder
 */
export function createCachedResponse<T>(
  data: T,
  cacheHit: boolean,
  processingTime: number,
  requestId?: string
): SuccessResponse<T> {
  return new ResponseBuilder(requestId)
    .withCacheStatus(cacheHit)
    .withProcessingTime(processingTime)
    .success(data);
}

/**
 * Provider response wrapper
 */
export function createProviderResponse<T>(
  data: T,
  provider: string,
  chainId: string | number,
  cost?: number,
  requestId?: string
): SuccessResponse<T> {
  const builder = new ResponseBuilder(requestId).withProvider(provider).withChain(chainId);

  if (cost !== undefined) {
    builder.withCost(cost);
  }

  return builder.success(data);
}
