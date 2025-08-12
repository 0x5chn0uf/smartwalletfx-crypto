import pino from 'pino';
import { config } from '@/config/environment';

// Create logger instance with optimized configuration
export const logger = pino({
  level: config.logging.level,
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  
  // Production-optimized transport
  transport: config.server.isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
          singleLine: false,
        },
      }
    : undefined,

  // Base fields for structured logging
  base: {
    service: 'crypto-data-service',
    version: '1.0.0',
    environment: config.server.nodeEnv,
  },
});

// Enhanced logging functions with context
export const createContextualLogger = (context: Record<string, any>) => {
  return logger.child(context);
};

// Request ID generator for tracing
export const generateRequestId = (): string => {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Structured error logging
export const logError = (error: Error, context?: Record<string, any>) => {
  logger.error({
    err: {
      message: error.message,
      stack: error.stack,
      name: error.name,
    },
    ...context,
  });
};

// Performance logging
export const logPerformance = (
  operation: string,
  duration: number,
  context?: Record<string, any>
) => {
  logger.info({
    operation,
    duration_ms: duration,
    ...context,
  }, `Performance: ${operation} completed in ${duration}ms`);
};

// API call logging (for external services)
export const logApiCall = (
  provider: string,
  endpoint: string,
  duration: number,
  status: 'success' | 'error',
  context?: Record<string, any>
) => {
  const logLevel = status === 'error' ? 'error' : 'info';
  
  logger[logLevel]({
    api_provider: provider,
    endpoint,
    duration_ms: duration,
    status,
    ...context,
  }, `API Call: ${provider}${endpoint} - ${status} in ${duration}ms`);
};

// Cost tracking logging
export const logCost = (
  provider: string,
  operation: string,
  estimatedCost: number,
  context?: Record<string, any>
) => {
  logger.info({
    cost_provider: provider,
    operation,
    estimated_cost_usd: estimatedCost,
    ...context,
  }, `Cost: ${provider} ${operation} - $${estimatedCost.toFixed(4)}`);
};

export default logger;