export interface CommonEventMetadata {
  correlationId?: string;
  userId?: string;
  sessionId?: string;
  clientType?: 'web' | 'mobile' | 'api' | 'worker' | 'system';
  priority?: number;
  retryCount?: number;
  maxRetries?: number;
  tags?: string[];
  performance?: {
    startedAt?: string;
    processingTimeMs?: number;
    queueTimeMs?: number;
  };
}

