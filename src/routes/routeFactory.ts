import { Router } from 'express';
import { ServiceDeps as ServiceDependencies } from '@/app/runtime';

/**
 * Route factory interface for dependency injection
 */
export interface RouteFactory {
  (dependencies: ServiceDependencies): Router;
}

/**
 * Route factory configuration
 */
export interface RouteFactoryConfig {
  // Add any shared configuration for routes
  enableMetrics?: boolean;
  enableCaching?: boolean;
  enableValidation?: boolean;
}

/**
 * Base route factory utility with common functionality
 */
export abstract class BaseRouteFactory {
  protected dependencies: ServiceDependencies;
  protected config: RouteFactoryConfig;

  constructor(dependencies: ServiceDependencies, config: RouteFactoryConfig = {}) {
    this.dependencies = dependencies;
    this.config = {
      enableMetrics: true,
      enableCaching: true,
      enableValidation: true,
      ...config,
    };
  }

  abstract createRoutes(): Router;

  /**
   * Create standardized error response
   */
  protected createErrorResponse(code: string, message: string, details?: any) {
    return {
      success: false,
      error: {
        code,
        message,
        details,
      },
      metadata: {
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Create standardized success response
   */
  protected createSuccessResponse(data: any, metadata: any = {}) {
    return {
      success: true,
      data,
      metadata: {
        timestamp: new Date().toISOString(),
        ...metadata,
      },
    };
  }

  /**
   * Log request with context
   */
  protected logRequest(req: any, context: any = {}) {
    return {
      requestId: req.requestId,
      path: req.path,
      method: req.method,
      userAgent: req.get('User-Agent'),
      ...context,
    };
  }
}

export type { ServiceDependencies as ServiceDeps };