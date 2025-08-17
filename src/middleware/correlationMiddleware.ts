import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { Logger } from 'pino';

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      requestId: string;
      logger: Logger;
    }
  }
}

export interface CorrelationContext {
  correlationId: string;
  requestId: string;
  timestamp: Date;
  method: string;
  path: string;
  userAgent?: string;
  ip?: string;
}

// Store correlation context for async operations
const correlationStore = new Map<string, CorrelationContext>();

/**
 * Middleware to add correlation IDs to all requests
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Generate or extract correlation ID
  const correlationId = req.headers['x-correlation-id'] as string || uuidv4();
  const requestId = uuidv4();

  // Add to request object
  req.correlationId = correlationId;
  req.requestId = requestId;

  // Set response headers
  res.setHeader('x-correlation-id', correlationId);
  res.setHeader('x-request-id', requestId);

  // Create correlation context
  const context: CorrelationContext = {
    correlationId,
    requestId,
    timestamp: new Date(),
    method: req.method,
    path: req.path,
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
  };

  // Store context for async operations
  correlationStore.set(correlationId, context);

  // Create child logger with correlation context
  req.logger = logger.child({
    correlationId,
    requestId,
    method: req.method,
    path: req.path,
  });

  // Log request start
  req.logger.info('Request started', {
    userAgent: context.userAgent,
    ip: context.ip,
  });

  // Clean up context after request
  res.on('finish', () => {
    correlationStore.delete(correlationId);
    req.logger.info('Request completed', {
      statusCode: res.statusCode,
      duration: Date.now() - context.timestamp.getTime(),
    });
  });

  next();
}

/**
 * Get correlation context for the current request
 */
export function getCorrelationContext(correlationId: string): CorrelationContext | undefined {
  return correlationStore.get(correlationId);
}

/**
 * Execute a function with correlation context
 */
export async function withCorrelationContext<T>(
  correlationId: string,
  fn: (context: CorrelationContext) => Promise<T>
): Promise<T> {
  const context = correlationStore.get(correlationId);
  if (!context) {
    throw new Error(`No correlation context found for ID: ${correlationId}`);
  }
  
  return await fn(context);
}

/**
 * Create a child logger with correlation context
 */
export function getCorrelatedLogger(correlationId: string) {
  const context = correlationStore.get(correlationId);
  if (!context) {
    return logger.child({ correlationId, warning: 'No context found' });
  }
  
  return logger.child({
    correlationId: context.correlationId,
    requestId: context.requestId,
    method: context.method,
    path: context.path,
  });
}

/**
 * Async local storage for correlation context
 */
import { AsyncLocalStorage } from 'async_hooks';

export const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

/**
 * Run function with correlation context in async local storage
 */
export function runWithCorrelation<T>(context: CorrelationContext, fn: () => T): T {
  return correlationStorage.run(context, fn);
}

/**
 * Get current correlation context from async local storage
 */
export function getCurrentCorrelation(): CorrelationContext | undefined {
  return correlationStorage.getStore();
}

/**
 * Enhanced middleware using async local storage
 */
export function enhancedCorrelationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = req.headers['x-correlation-id'] as string || uuidv4();
  const requestId = uuidv4();

  req.correlationId = correlationId;
  req.requestId = requestId;

  res.setHeader('x-correlation-id', correlationId);
  res.setHeader('x-request-id', requestId);

  const context: CorrelationContext = {
    correlationId,
    requestId,
    timestamp: new Date(),
    method: req.method,
    path: req.path,
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
  };

  // Store in both map and async local storage
  correlationStore.set(correlationId, context);

  // Run the request in correlation context
  correlationStorage.run(context, () => {
    // Create child logger
    req.logger = logger.child({
      correlationId,
      requestId,
      method: req.method,
      path: req.path,
    });

    req.logger.info('Request started', {
      userAgent: context.userAgent,
      ip: context.ip,
    });

    res.on('finish', () => {
      correlationStore.delete(correlationId);
      req.logger.info('Request completed', {
        statusCode: res.statusCode,
        duration: Date.now() - context.timestamp.getTime(),
      });
    });

    next();
  });
}