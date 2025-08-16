// Authentication
export interface JWTPayload {
  userId: string;
  email?: string;
  roles?: string[];
  iat: number;
  exp: number;
}

// Request logging
export interface RequestLogContext {
  requestId: string;
  method: string;
  url: string;
  userAgent?: string;
  ip: string;
  userId?: string;
  startTime: number;
}

// Enhanced metrics health result
export interface HealthCheckResult {
  status: 'healthy' | 'warning' | 'critical' | 'emergency';
  timestamp: number;
  version: string;
  uptime: number;
  environment: string;
  services: {
    eventMonitoring: any;
    cacheWarming: any;
    costMonitoring: any;
    performanceTracking: any;
  };
  metrics: {
    requests: { total: number; perSecond: number; errorRate: number };
    performance: { responseTimeP95: number; memoryUsage: number; cpuUsage: number };
    cost: {
      hourlySpend: number;
      projectedDaily: number;
      savingsRate: number;
      budgetUtilization: number;
    };
    events: { publishRate: number; consumeRate: number; queueDepth: number; errorRate: number };
    cache: { hitRate: number; warmingSuccessRate: number; evictionRate: number };
  };
  alerts: { critical: number; warning: number; total: number; recent: any[] };
}

// Rate limiter options
export interface LimiterOptions {
  points: number; // Number of points
  duration: number; // Per duration in seconds
  keyPrefix: string;
}

// HTTP error shape
export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
  details?: any;
  isOperational?: boolean;
}

// Cost tracking per-request context
export interface CostTrackingContext {
  startTime: number;
  provider?: string;
  endpoint?: string;
  operationType?: string;
  estimatedCost?: number;
  metadata?: Record<string, any>;
}
