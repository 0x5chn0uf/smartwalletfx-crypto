import { Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger';

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
  details?: any;
  isOperational?: boolean;
}

export class AppError extends Error implements ApiError {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly details?: any;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = 'INTERNAL_ERROR',
    isOperational: boolean = true,
    details?: any
  ) {
    super(message);
    
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.details = details;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

// Predefined error classes
export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 400, 'VALIDATION_ERROR', true, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND', true);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized access') {
    super(message, 401, 'UNAUTHORIZED', true);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED', true);
  }
}

export class ExternalApiError extends AppError {
  constructor(provider: string, details?: any) {
    super(`External API error: ${provider}`, 503, 'EXTERNAL_API_ERROR', true, details);
  }
}

export class BlockchainError extends AppError {
  constructor(chain: string, operation: string, details?: any) {
    super(`Blockchain error on ${chain}: ${operation}`, 503, 'BLOCKCHAIN_ERROR', true, details);
  }
}

// Error handler middleware
export const errorHandler = (
  error: ApiError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const {
    statusCode = 500,
    message = 'Internal Server Error',
    code = 'INTERNAL_ERROR',
    details,
  } = error;

  // Enhanced logging with context
  const errorLog = {
    error: {
      message: error.message,
      stack: error.stack,
      code: error.code,
      statusCode: error.statusCode,
    },
    request: {
      method: req.method,
      url: req.originalUrl,
      headers: {
        'user-agent': req.get('user-agent'),
        'x-forwarded-for': req.get('x-forwarded-for'),
        'x-request-id': req.get('x-request-id'),
      },
      ip: req.ip,
    },
    details,
  };

  // Log based on severity
  if (statusCode >= 500) {
    logger.error('Server Error:', errorLog);
  } else if (statusCode >= 400) {
    logger.warn('Client Error:', errorLog);
  } else {
    logger.info('Request Error:', errorLog);
  }

  // Prepare response
  const response: any = {
    success: false,
    error: {
      code,
      message,
    },
  };

  // Add details in development
  if (process.env.NODE_ENV === 'development') {
    response.error.details = details;
    response.error.stack = error.stack;
  }

  // Add retry information for retryable errors
  if (isRetryableError(error)) {
    response.error.retryable = true;
    response.error.retryAfter = getRetryAfter(error);
  }

  res.status(statusCode).json(response);
};

// Async error wrapper
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Check if error is retryable
const isRetryableError = (error: ApiError): boolean => {
  const retryableCodes = [
    'EXTERNAL_API_ERROR',
    'BLOCKCHAIN_ERROR',
    'RATE_LIMIT_EXCEEDED',
  ];
  
  return retryableCodes.includes(error.code || '');
};

// Get retry after time
const getRetryAfter = (error: ApiError): number => {
  switch (error.code) {
    case 'RATE_LIMIT_EXCEEDED':
      return 60; // 1 minute
    case 'EXTERNAL_API_ERROR':
      return 30; // 30 seconds
    case 'BLOCKCHAIN_ERROR':
      return 15; // 15 seconds
    default:
      return 5; // 5 seconds
  }
};

// Unhandled route handler
export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.originalUrl} not found`,
    },
  });
};

// Validation error handler for Zod
export const handleZodError = (error: any): ValidationError => {
  const details = error.errors?.map((err: any) => ({
    field: err.path.join('.'),
    message: err.message,
    code: err.code,
  }));

  return new ValidationError('Validation failed', details);
};

export default errorHandler;