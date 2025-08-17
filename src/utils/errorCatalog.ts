/**
 * Essential Error Catalog for Crypto-Data Service
 *
 * REFACTORED: Follows YAGNI principle - only includes errors that are actually needed.
 * Additional error codes can be added as requirements emerge.
 */

/**
 * Core error codes - only the essential ones
 */
export enum ErrorCode {
  // Client Errors (4xx) - Core set
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  INVALID_CHAIN_ID = 'INVALID_CHAIN_ID',
  RATE_LIMITED = 'RATE_LIMITED',

  // Provider Errors (5xx) - Essential for external APIs
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  PROVIDER_TIMEOUT = 'PROVIDER_TIMEOUT',
  PROVIDER_ERROR = 'PROVIDER_ERROR',

  // Service Errors (5xx) - Core infrastructure
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  DATABASE_ERROR = 'DATABASE_ERROR',

  // Business Logic Errors - Essential for crypto services
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  PORTFOLIO_EMPTY = 'PORTFOLIO_EMPTY',
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
 * Essential error catalog - only commonly used errors
 */
export const ERROR_CATALOG: Record<ErrorCode, ErrorDefinition> = {
  // Client Errors
  [ErrorCode.BAD_REQUEST]: {
    code: ErrorCode.BAD_REQUEST,
    message: 'Bad request - invalid parameters',
    httpStatus: 400,
    category: 'client',
    retryable: false,
  },

  [ErrorCode.UNAUTHORIZED]: {
    code: ErrorCode.UNAUTHORIZED,
    message: 'Unauthorized - authentication required',
    httpStatus: 401,
    category: 'client',
    retryable: false,
  },

  [ErrorCode.FORBIDDEN]: {
    code: ErrorCode.FORBIDDEN,
    message: 'Forbidden - insufficient permissions',
    httpStatus: 403,
    category: 'client',
    retryable: false,
  },

  [ErrorCode.NOT_FOUND]: {
    code: ErrorCode.NOT_FOUND,
    message: 'Resource not found',
    httpStatus: 404,
    category: 'client',
    retryable: false,
  },

  [ErrorCode.INVALID_ADDRESS]: {
    code: ErrorCode.INVALID_ADDRESS,
    message: 'Invalid wallet address format',
    httpStatus: 400,
    category: 'client',
    retryable: false,
  },

  [ErrorCode.INVALID_CHAIN_ID]: {
    code: ErrorCode.INVALID_CHAIN_ID,
    message: 'Invalid or unsupported chain ID',
    httpStatus: 400,
    category: 'client',
    retryable: false,
  },

  [ErrorCode.RATE_LIMITED]: {
    code: ErrorCode.RATE_LIMITED,
    message: 'Rate limit exceeded',
    httpStatus: 429,
    category: 'client',
    retryable: true,
  },

  // Provider Errors
  [ErrorCode.PROVIDER_UNAVAILABLE]: {
    code: ErrorCode.PROVIDER_UNAVAILABLE,
    message: 'External provider temporarily unavailable',
    httpStatus: 503,
    category: 'provider',
    retryable: true,
  },

  [ErrorCode.PROVIDER_TIMEOUT]: {
    code: ErrorCode.PROVIDER_TIMEOUT,
    message: 'Provider request timeout',
    httpStatus: 504,
    category: 'provider',
    retryable: true,
  },

  [ErrorCode.PROVIDER_ERROR]: {
    code: ErrorCode.PROVIDER_ERROR,
    message: 'External provider error',
    httpStatus: 502,
    category: 'provider',
    retryable: true,
  },

  // Service Errors
  [ErrorCode.INTERNAL_ERROR]: {
    code: ErrorCode.INTERNAL_ERROR,
    message: 'Internal server error',
    httpStatus: 500,
    category: 'server',
    retryable: false,
  },

  [ErrorCode.SERVICE_UNAVAILABLE]: {
    code: ErrorCode.SERVICE_UNAVAILABLE,
    message: 'Service temporarily unavailable',
    httpStatus: 503,
    category: 'server',
    retryable: true,
  },

  [ErrorCode.DATABASE_ERROR]: {
    code: ErrorCode.DATABASE_ERROR,
    message: 'Database connection error',
    httpStatus: 503,
    category: 'server',
    retryable: true,
  },

  // Business Logic Errors
  [ErrorCode.INSUFFICIENT_BALANCE]: {
    code: ErrorCode.INSUFFICIENT_BALANCE,
    message: 'Insufficient balance for operation',
    httpStatus: 400,
    category: 'business',
    retryable: false,
  },

  [ErrorCode.PORTFOLIO_EMPTY]: {
    code: ErrorCode.PORTFOLIO_EMPTY,
    message: 'Portfolio has no assets',
    httpStatus: 404,
    category: 'business',
    retryable: false,
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
export function getErrorsByCategory(
  category: 'client' | 'server' | 'provider' | 'business'
): ErrorDefinition[] {
  return Object.values(ERROR_CATALOG).filter(error => error.category === category);
}

/**
 * Create a custom error with proper classification
 */
export class CatalogError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly category: string;
  public readonly retryable: boolean;

  constructor(code: ErrorCode, details?: string) {
    const definition = getErrorDefinition(code);
    const message = details ? `${definition.message}: ${details}` : definition.message;
    
    super(message);
    
    this.name = 'CatalogError';
    this.code = code;
    this.httpStatus = definition.httpStatus;
    this.category = definition.category;
    this.retryable = definition.retryable;
  }
}

/**
 * Utility to add new error codes dynamically (for future expansion)
 */
export function addErrorCode(
  code: string,
  definition: Omit<ErrorDefinition, 'code'>
): void {
  // This allows adding new error codes without breaking existing code
  const newCode = code as ErrorCode;
  (ERROR_CATALOG as any)[newCode] = {
    code: newCode,
    ...definition
  };
}

// Commonly used error creation shortcuts
export const createBadRequestError = (details?: string) => new CatalogError(ErrorCode.BAD_REQUEST, details);
export const createNotFoundError = (details?: string) => new CatalogError(ErrorCode.NOT_FOUND, details);
export const createProviderError = (details?: string) => new CatalogError(ErrorCode.PROVIDER_ERROR, details);
export const createInternalError = (details?: string) => new CatalogError(ErrorCode.INTERNAL_ERROR, details);