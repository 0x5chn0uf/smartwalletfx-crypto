import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { Config } from '@/config';
import { logger } from '@/utils/logger';
import { UnauthorizedError } from '@/middleware/errorHandler';
import type { JWTPayload } from '@/middleware/interfaces';

// Extend Express Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid authorization header');
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || '') as JWTPayload;

    // Add user info to request
    req.user = decoded;

    logger.debug('User authenticated', {
      userId: decoded.userId,
      requestPath: req.path,
      requestId: req.headers['x-request-id'],
    });

    next();
  } catch (error) {
    logger.warn('Authentication failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestPath: req.path,
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });

    if (error instanceof jwt.JsonWebTokenError) {
      throw new UnauthorizedError('Invalid token');
    } else if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Token expired');
    }

    throw new UnauthorizedError('Authentication failed');
  }
};

// Optional auth middleware - doesn't throw if no token provided
export const optionalAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(); // Continue without auth
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET || '') as JWTPayload;
    req.user = decoded;

    logger.debug('Optional auth: User authenticated', {
      userId: decoded.userId,
      requestPath: req.path,
    });
  } catch (error) {
    // Log but don't throw - continue without auth
    logger.debug('Optional auth: Invalid token provided', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestPath: req.path,
    });
  }

  next();
};

// Role-based authorization middleware
export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    const userRoles = req.user.roles || [];
    const hasRequiredRole = roles.some(role => userRoles.includes(role));

    if (!hasRequiredRole) {
      throw new UnauthorizedError(`Insufficient permissions. Required roles: ${roles.join(', ')}`);
    }

    next();
  };
};

// API key authentication (alternative to JWT)
export const apiKeyAuth = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    throw new UnauthorizedError('API key required');
  }

  // Validate against centrally-validated config
  const validApiKeys = (process.env.VALID_API_KEYS || '').split(',').filter(Boolean) || [];

  if (!validApiKeys.includes(apiKey)) {
    logger.warn('Invalid API key used', {
      apiKey: apiKey.substring(0, 8) + '...',
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    throw new UnauthorizedError('Invalid API key');
  }

  logger.debug('API key authentication successful', {
    apiKey: apiKey.substring(0, 8) + '...',
    requestPath: req.path,
  });

  next();
};
