/**
 * Standardized Error Catalog for Crypto-Data Service
 * 
 * Provides consistent error codes, messages, and response structures
 * across all routes and services as specified in PRD section 6.
 */

export enum ErrorCode {
  // Client Errors (4xx)
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  INVALID_CHAIN_ID = 'INVALID_CHAIN_ID',
  INVALID_QUERY_PARAMETERS = 'INVALID_QUERY_PARAMETERS',
  INVALID_REQUEST_ID = 'INVALID_REQUEST_ID',
  RATE_LIMITED = 'RATE_LIMITED',
  REQUEST_TIMEOUT = 'REQUEST_TIMEOUT',
  
  // Provider Errors (5xx)
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  PROVIDER_TIMEOUT = 'PROVIDER_TIMEOUT',
  PROVIDER_RATE_LIMITED = 'PROVIDER_RATE_LIMITED',
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  
  // Service Errors (5xx)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  DATABASE_ERROR = 'DATABASE_ERROR',
  CACHE_ERROR = 'CACHE_ERROR',
  EVENT_BUS_ERROR = 'EVENT_BUS_ERROR',
  WORKER_ERROR = 'WORKER_ERROR',
  
  // Feature Errors
  FEATURE_DISABLED = 'FEATURE_DISABLED',
  FEATURE_NOT_AVAILABLE = 'FEATURE_NOT_AVAILABLE',
  
  // Business Logic Errors
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  POSITION_NOT_FOUND = 'POSITION_NOT_FOUND',
  NFT_NOT_FOUND = 'NFT_NOT_FOUND',
  PORTFOLIO_EMPTY = 'PORTFOLIO_EMPTY',
  
  // Async Processing Errors
  REQUEST_NOT_FOUND = 'REQUEST_NOT_FOUND',
  RESULT_NOT_READY = 'RESULT_NOT_READY',
  RESULT_EXPIRED = 'RESULT_EXPIRED',
  PROCESSING_FAILED = 'PROCESSING_FAILED',
  
  // CORS and Security
  CORS_NOT_ALLOWED = 'CORS_NOT_ALLOWED',
  API_KEY_REQUIRED = 'API_KEY_REQUIRED',
  API_KEY_INVALID = 'API_KEY_INVALID',
  
  // Endpoint and Resource Errors
  ENDPOINT_NOT_FOUND = 'ENDPOINT_NOT_FOUND',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
}

export interface ErrorDefinition {
  code: ErrorCode;
  message: string;
  httpStatus: number;
  category: 'client' | 'server' | 'provider' | 'business';
  retryable: boolean;
  description?: string;
}

/**
 * Comprehensive error catalog with standardized definitions
 */
export const ERROR_CATALOG: Record<ErrorCode, ErrorDefinition> = {
  // Client Errors (4xx)
  [ErrorCode.BAD_REQUEST]: {
    code: ErrorCode.BAD_REQUEST,
    message: 'Bad request - invalid parameters or malformed request',
    httpStatus: 400,
    category: 'client',
    retryable: false,
    description: 'The request is malformed or contains invalid parameters',
  },
  
  [ErrorCode.UNAUTHORIZED]: {
    code: ErrorCode.UNAUTHORIZED,
    message: 'Unauthorized - authentication required',
    httpStatus: 401,
    category: 'client',
    retryable: false,
    description: 'Valid authentication credentials are required',
  },
  
  [ErrorCode.FORBIDDEN]: {
    code: ErrorCode.FORBIDDEN,
    message: 'Forbidden - insufficient permissions',
    httpStatus: 403,
    category: 'client',
    retryable: false,
    description: 'The request is authenticated but not authorized',
  },
  
  [ErrorCode.NOT_FOUND]: {
    code: ErrorCode.NOT_FOUND,
    message: 'Resource not found',
    httpStatus: 404,
    category: 'client',
    retryable: false,
    description: 'The requested resource does not exist',
  },
  
  [ErrorCode.METHOD_NOT_ALLOWED]: {
    code: ErrorCode.METHOD_NOT_ALLOWED,
    message: 'HTTP method not allowed for this endpoint',
    httpStatus: 405,
    category: 'client',
    retryable: false,
    description: 'The HTTP method is not supported for this endpoint',
  },
  
  [ErrorCode.INVALID_ADDRESS]: {
    code: ErrorCode.INVALID_ADDRESS,
    message: 'Invalid wallet address format',
    httpStatus: 400,
    category: 'client',
    retryable: false,
    description: 'The provided wallet address is not in a valid format',
  },
  
  [ErrorCode.INVALID_CHAIN_ID]: {
    code: ErrorCode.INVALID_CHAIN_ID,
    message: 'Invalid or unsupported chain ID',
    httpStatus: 400,
    category: 'client',
    retryable: false,
    description: 'The specified chain ID is not supported by this service',
  },
  
  [ErrorCode.INVALID_QUERY_PARAMETERS]: {
    code: ErrorCode.INVALID_QUERY_PARAMETERS,
    message: 'Invalid query parameters',
    httpStatus: 400,
    category: 'client',
    retryable: false,
    description: 'One or more query parameters are invalid or malformed',
  },
  
  [ErrorCode.INVALID_REQUEST_ID]: {
    code: ErrorCode.INVALID_REQUEST_ID,
    message: 'Invalid request ID format',
    httpStatus: 400,
    category: 'client',
    retryable: false,
    description: 'The request ID must be a valid UUID',
  },
  
  [ErrorCode.RATE_LIMITED]: {
    code: ErrorCode.RATE_LIMITED,
    message: 'Rate limit exceeded',
    httpStatus: 429,
    category: 'client',
    retryable: true,
    description: 'Too many requests have been made in a short period',
  },
  
  [ErrorCode.REQUEST_TIMEOUT]: {
    code: ErrorCode.REQUEST_TIMEOUT,
    message: 'Request timeout',
    httpStatus: 408,
    category: 'client',
    retryable: true,
    description: 'The request took too long to process',
  },
  
  // Provider Errors (5xx)
  [ErrorCode.PROVIDER_UNAVAILABLE]: {
    code: ErrorCode.PROVIDER_UNAVAILABLE,
    message: 'External provider temporarily unavailable',
    httpStatus: 503,
    category: 'provider',
    retryable: true,
    description: 'The external data provider is currently unavailable',
  },
  
  [ErrorCode.PROVIDER_TIMEOUT]: {
    code: ErrorCode.PROVIDER_TIMEOUT,
    message: 'Provider request timeout',
    httpStatus: 504,
    category: 'provider',
    retryable: true,
    description: 'The external provider did not respond within the timeout period',
  },
  
  [ErrorCode.PROVIDER_RATE_LIMITED]: {
    code: ErrorCode.PROVIDER_RATE_LIMITED,
    message: 'Provider rate limit exceeded',
    httpStatus: 503,
    category: 'provider',
    retryable: true,
    description: 'The external provider has rate limited our requests',
  },
  
  [ErrorCode.PROVIDER_ERROR]: {
    code: ErrorCode.PROVIDER_ERROR,
    message: 'External provider error',
    httpStatus: 502,
    category: 'provider',
    retryable: true,
    description: 'The external provider returned an error',
  },
  
  // Service Errors (5xx)
  [ErrorCode.INTERNAL_ERROR]: {
    code: ErrorCode.INTERNAL_ERROR,
    message: 'Internal server error',
    httpStatus: 500,
    category: 'server',
    retryable: false,
    description: 'An unexpected error occurred while processing the request',
  },
  
  [ErrorCode.SERVICE_UNAVAILABLE]: {
    code: ErrorCode.SERVICE_UNAVAILABLE,
    message: 'Service temporarily unavailable',
    httpStatus: 503,
    category: 'server',
    retryable: true,
    description: 'The service is temporarily unavailable due to maintenance or overload',
  },
  
  [ErrorCode.DATABASE_ERROR]: {
    code: ErrorCode.DATABASE_ERROR,
    message: 'Database connection error',
    httpStatus: 503,
    category: 'server',
    retryable: true,
    description: 'Unable to connect to or query the database',
  },
  
  [ErrorCode.CACHE_ERROR]: {
    code: ErrorCode.CACHE_ERROR,
    message: 'Cache service error',
    httpStatus: 503,
    category: 'server',
    retryable: true,
    description: 'The cache service is experiencing issues',
  },
  
  [ErrorCode.EVENT_BUS_ERROR]: {
    code: ErrorCode.EVENT_BUS_ERROR,
    message: 'Event bus service error',
    httpStatus: 503,
    category: 'server',
    retryable: true,
    description: 'The event bus service is not responding',
  },
  
  [ErrorCode.WORKER_ERROR]: {
    code: ErrorCode.WORKER_ERROR,
    message: 'Background worker error',
    httpStatus: 503,
    category: 'server',
    retryable: true,
    description: 'Background workers are not processing tasks',
  },
  
  // Feature Errors
  [ErrorCode.FEATURE_DISABLED]: {
    code: ErrorCode.FEATURE_DISABLED,
    message: 'Feature is disabled',
    httpStatus: 404,
    category: 'business',
    retryable: false,
    description: 'The requested feature is currently disabled via feature flags',
  },
  
  [ErrorCode.FEATURE_NOT_AVAILABLE]: {
    code: ErrorCode.FEATURE_NOT_AVAILABLE,
    message: 'Feature not available in this environment',
    httpStatus: 404,
    category: 'business',
    retryable: false,
    description: 'The requested feature is not available in the current environment',
  },
  
  // Business Logic Errors
  [ErrorCode.INSUFFICIENT_BALANCE]: {
    code: ErrorCode.INSUFFICIENT_BALANCE,
    message: 'Insufficient balance for operation',
    httpStatus: 400,
    category: 'business',
    retryable: false,
    description: 'The wallet does not have sufficient balance for this operation',
  },
  
  [ErrorCode.POSITION_NOT_FOUND]: {
    code: ErrorCode.POSITION_NOT_FOUND,
    message: 'DeFi position not found',
    httpStatus: 404,
    category: 'business',
    retryable: false,
    description: 'No DeFi position found for the specified criteria',
  },
  
  [ErrorCode.NFT_NOT_FOUND]: {
    code: ErrorCode.NFT_NOT_FOUND,
    message: 'NFT not found',
    httpStatus: 404,
    category: 'business',
    retryable: false,
    description: 'No NFT found for the specified criteria',
  },
  
  [ErrorCode.PORTFOLIO_EMPTY]: {
    code: ErrorCode.PORTFOLIO_EMPTY,
    message: 'Portfolio has no assets',
    httpStatus: 404,
    category: 'business',
    retryable: false,
    description: 'The wallet contains no detectable assets',
  },
  
  // Async Processing Errors
  [ErrorCode.REQUEST_NOT_FOUND]: {
    code: ErrorCode.REQUEST_NOT_FOUND,
    message: 'Request not found or expired',
    httpStatus: 404,
    category: 'business',
    retryable: false,
    description: 'The async request was not found or has expired',
  },
  
  [ErrorCode.RESULT_NOT_READY]: {
    code: ErrorCode.RESULT_NOT_READY,
    message: 'Result not ready yet',
    httpStatus: 202,
    category: 'business',
    retryable: true,
    description: 'The async request is still being processed',
  },
  
  [ErrorCode.RESULT_EXPIRED]: {
    code: ErrorCode.RESULT_EXPIRED,
    message: 'Result has expired and is no longer available',
    httpStatus: 410,
    category: 'business',
    retryable: false,
    description: 'The result was available but has now expired',
  },
  
  [ErrorCode.PROCESSING_FAILED]: {
    code: ErrorCode.PROCESSING_FAILED,
    message: 'Async processing failed',
    httpStatus: 500,
    category: 'server',
    retryable: false,
    description: 'The async request failed during processing',
  },
  
  // CORS and Security
  [ErrorCode.CORS_NOT_ALLOWED]: {
    code: ErrorCode.CORS_NOT_ALLOWED,
    message: 'CORS origin not allowed',
    httpStatus: 403,
    category: 'client',
    retryable: false,
    description: 'The request origin is not allowed by CORS policy',
  },
  
  [ErrorCode.API_KEY_REQUIRED]: {
    code: ErrorCode.API_KEY_REQUIRED,
    message: 'API key required',
    httpStatus: 401,
    category: 'client',
    retryable: false,
    description: 'A valid API key is required for this endpoint',
  },
  
  [ErrorCode.API_KEY_INVALID]: {
    code: ErrorCode.API_KEY_INVALID,
    message: 'Invalid API key',
    httpStatus: 401,
    category: 'client',
    retryable: false,
    description: 'The provided API key is invalid or expired',
  },
  
  // Endpoint and Resource Errors
  [ErrorCode.ENDPOINT_NOT_FOUND]: {
    code: ErrorCode.ENDPOINT_NOT_FOUND,
    message: 'API endpoint not found',
    httpStatus: 404,
    category: 'client',
    retryable: false,
    description: 'The requested API endpoint does not exist',
  },
  
  [ErrorCode.RESOURCE_NOT_FOUND]: {
    code: ErrorCode.RESOURCE_NOT_FOUND,
    message: 'Resource not found',
    httpStatus: 404,
    category: 'client',
    retryable: false,
    description: 'The requested resource was not found',
  },
};

/**
 * Helper function to get error definition by code
 */
export function getErrorDefinition(code: ErrorCode): ErrorDefinition {
  const definition = ERROR_CATALOG[code];
  if (!definition) {
    throw new Error(`Unknown error code: ${code}`);
  }
  return definition;
}

/**
 * Helper function to check if an error is retryable
 */
export function isRetryableError(code: ErrorCode): boolean {
  const definition = getErrorDefinition(code);
  return definition.retryable;
}

/**
 * Helper function to get HTTP status code for an error
 */
export function getHttpStatusForError(code: ErrorCode): number {
  const definition = getErrorDefinition(code);
  return definition.httpStatus;
}

/**
 * Helper function to get all errors by category
 */
export function getErrorsByCategory(category: 'client' | 'server' | 'provider' | 'business'): ErrorDefinition[] {
  return Object.values(ERROR_CATALOG).filter(error => error.category === category);
}