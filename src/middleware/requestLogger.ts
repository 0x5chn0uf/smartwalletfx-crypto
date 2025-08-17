import { Request, Response, NextFunction } from 'express';
import { logger, generateRequestId } from '@/utils/logger';
import type { RequestLogContext } from '@/middleware/interfaces';

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      startTime: number;
      requestId: string;
      logContext: RequestLogContext;
    }
  }
}

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();
  const requestId = (req.headers['x-request-id'] as string) || generateRequestId();

  // Add request context to request object
  req.startTime = startTime;
  req.requestId = requestId;
  req.logContext = {
    requestId,
    method: req.method,
    url: req.originalUrl,
    userAgent: req.get('user-agent'),
    ip: req.ip || req.connection.remoteAddress || 'unknown',
    startTime,
  };

  // Set request ID header for response
  res.setHeader('X-Request-ID', requestId);

  // Log incoming request
  logger.info('Request started', {
    ...req.logContext,
    headers: {
      'content-type': req.get('content-type'),
      'content-length': req.get('content-length'),
      authorization: req.get('authorization') ? 'Bearer ***' : undefined,
      'x-api-key': req.get('x-api-key') ? '***' : undefined,
    },
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    bodySize: req.get('content-length') || 0,
  });

  // Capture response finish
  const originalSend = res.send;
  const originalJson = res.json;
  let responseBody: any;
  let responseSent = false;

  // Override res.send to capture response
  res.send = function (body) {
    if (!responseSent) {
      responseBody = body;
      logResponse();
      responseSent = true;
    }
    return originalSend.call(this, body);
  };

  // Override res.json to capture response
  res.json = function (body) {
    if (!responseSent) {
      responseBody = body;
      logResponse();
      responseSent = true;
    }
    return originalJson.call(this, body);
  };

  // Log response
  const logResponse = () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Update log context with user info if available
    if (req.user) {
      req.logContext.userId = req.user.userId;
    }

    // Determine log level based on status code and duration
    let logLevel: 'info' | 'warn' | 'error' = 'info';
    if (statusCode >= 500) {
      logLevel = 'error';
    } else if (statusCode >= 400 || duration > 5000) {
      logLevel = 'warn';
    }

    // Prepare response log data
    const responseLogData: any = {
      ...req.logContext,
      response: {
        statusCode,
        statusMessage: res.statusMessage,
        contentType: res.get('content-type'),
        contentLength: res.get('content-length'),
        headers: {
          'cache-control': res.get('cache-control'),
          'x-ratelimit-limit': res.get('x-ratelimit-limit'),
          'x-ratelimit-remaining': res.get('x-ratelimit-remaining'),
        },
      },
      duration,
      success: statusCode < 400,
    };

    // Add response body for errors (truncated)
    if (statusCode >= 400 && responseBody) {
      try {
        const bodyStr =
          typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);

        responseLogData.response.body =
          bodyStr.length > 1000 ? bodyStr.substring(0, 1000) + '...[truncated]' : bodyStr;
      } catch (error) {
        responseLogData.response.body = '[Unable to serialize response body]';
      }
    }

    // Log the response
    logger[logLevel]('Request completed', responseLogData);

    // Log slow requests separately
    if (duration > 2000) {
      logger.warn('Slow request detected', {
        requestId,
        method: req.method,
        url: req.originalUrl,
        duration,
        statusCode,
        userId: req.user?.userId,
      });
    }

    // Log high traffic patterns
    if (req.originalUrl.includes('/portfolio/') && duration < 500) {
      logger.debug('Fast portfolio request', {
        requestId,
        url: req.originalUrl,
        duration,
        cacheHit: res.get('x-cache-status') === 'HIT',
      });
    }
  };

  next();
};
