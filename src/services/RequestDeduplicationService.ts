import { EventEmitter } from 'events';
import { logger, logError, createContextualLogger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import { config } from '@/config';
import { ChainId } from '@/types/blockchain';
import { getEventSystem, RequestDeduplicationV1 } from './EventSystem';
import crypto from 'crypto';

/**
 * Request Deduplication Service
 *
 * Advanced deduplication system that prevents redundant API calls:
 * - Exact request matching with semantic analysis
 * - Temporal window deduplication for time-sensitive data
 * - Pattern-based coalescing for similar requests
 * - Real-time deduplication store with Redis
 */

export interface DeduplicationRequest {
  id: string;
  type: 'balance' | 'transaction' | 'token_metadata' | 'price' | 'nft' | 'defi';
  params: Record<string, any>;
  chainId?: ChainId;
  timestamp: number;
  userContext?: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  callback: (result: any, error?: Error) => void;
  estimatedCost: number;
  temporalWindow?: number; // ms - how long this data stays fresh
  semanticKey?: string; // Custom semantic grouping key
}

export interface DeduplicationResult {
  isDuplicate: boolean;
  originalRequestId?: string;
  deduplicationType: 'exact_match' | 'semantic_match' | 'temporal_window' | 'pattern_coalescing';
  costSaved: number;
  latencySaved: number;
  existingResult?: any;
  waitingRequests?: string[];
  coalesceGroup?: string;
}

export interface DeduplicationMetrics {
  totalRequests: number;
  duplicatesDetected: number;
  deduplicationRate: number;
  totalCostSaved: number;
  totalLatencySaved: number;
  averageDeduplicationTime: number;
  deduplicationsByType: Record<string, number>;
  semanticMatches: number;
  temporalMatches: number;
  patternCoalesces: number;
  activeGroups: number;
}

interface RequestGroup {
  groupId: string;
  requestType: string;
  semanticKey: string;
  firstRequestId: string;
  firstRequestTime: number;
  requestIds: string[];
  callbacks: Array<(result: any, error?: Error) => void>;
  totalCostSaved: number;
  coalesceStrategy: 'immediate' | 'window' | 'batch';
  processingStarted: boolean;
  result?: any;
  error?: Error;
}

export class RequestDeduplicationService extends EventEmitter {
  private contextLogger = createContextualLogger({ component: 'RequestDeduplicationService' });
  private eventSystem = getEventSystem();

  // Active request tracking
  private activeRequests = new Map<string, DeduplicationRequest>();
  private requestGroups = new Map<string, RequestGroup>();
  private semanticGroups = new Map<string, string[]>(); // semantic key -> request IDs

  // Configuration
  private enabled = true;
  private maxActiveRequests = 50000;
  private defaultTemporalWindow = 30000; // 30 seconds
  private maxCoalesceWindow = 5000; // 5 seconds max wait for coalescing
  private patternDetectionEnabled = true;
  private semanticMatchingEnabled = true;

  // Metrics
  private metrics: DeduplicationMetrics = {
    totalRequests: 0,
    duplicatesDetected: 0,
    deduplicationRate: 0,
    totalCostSaved: 0,
    totalLatencySaved: 0,
    averageDeduplicationTime: 0,
    deduplicationsByType: {},
    semanticMatches: 0,
    temporalMatches: 0,
    patternCoalesces: 0,
    activeGroups: 0,
  };

  // Advanced deduplication patterns
  private semanticPatterns = new Map<
    string,
    {
      pattern: RegExp;
      normalize: (params: any) => string;
      temporal: boolean;
      coalesceWindow: number;
    }
  >();

  constructor() {
    super();
    this.initializeSemanticPatterns();
    this.startCleanupProcess();
    this.startMetricsCollection();
  }

  /**
   * Check if request can be deduplicated and handle accordingly
   */
  async deduplicateRequest(request: DeduplicationRequest): Promise<DeduplicationResult> {
    if (!this.enabled) {
      return {
        isDuplicate: false,
        deduplicationType: 'exact_match',
        costSaved: 0,
        latencySaved: 0,
      };
    }

    const startTime = Date.now();
    this.metrics.totalRequests++;

    try {
      // Clean up old requests if we're at capacity
      if (this.activeRequests.size >= this.maxActiveRequests) {
        await this.cleanupExpiredRequests();
      }

      // Generate request signature for exact matching
      const requestSignature = this.generateRequestSignature(request);

      // Check for exact match first (fastest)
      const exactMatch = await this.checkExactMatch(requestSignature, request);
      if (exactMatch.isDuplicate) {
        await this.recordDeduplication(request, exactMatch, startTime);
        return exactMatch;
      }

      // Check semantic matching if enabled
      if (this.semanticMatchingEnabled) {
        const semanticMatch = await this.checkSemanticMatch(request);
        if (semanticMatch.isDuplicate) {
          await this.recordDeduplication(request, semanticMatch, startTime);
          return semanticMatch;
        }
      }

      // Check temporal window deduplication
      const temporalMatch = await this.checkTemporalMatch(request);
      if (temporalMatch.isDuplicate) {
        await this.recordDeduplication(request, temporalMatch, startTime);
        return temporalMatch;
      }

      // Check pattern coalescing if enabled
      if (this.patternDetectionEnabled) {
        const coalesceResult = await this.checkPatternCoalescing(request);
        if (coalesceResult.isDuplicate) {
          await this.recordDeduplication(request, coalesceResult, startTime);
          return coalesceResult;
        }
      }

      // No deduplication possible - store request for future matching
      await this.storeActiveRequest(request, requestSignature);

      return {
        isDuplicate: false,
        deduplicationType: 'exact_match',
        costSaved: 0,
        latencySaved: 0,
      };
    } catch (error) {
      logError(error as Error, {
        operation: 'deduplicateRequest',
        requestId: request.id,
        requestType: request.type,
      });

      return {
        isDuplicate: false,
        deduplicationType: 'exact_match',
        costSaved: 0,
        latencySaved: 0,
      };
    }
  }

  /**
   * Complete a request and notify all waiting duplicates
   */
  async completeRequest(requestId: string, result: any, error?: Error): Promise<void> {
    const request = this.activeRequests.get(requestId);
    if (!request) return;

    try {
      // Find all requests waiting for this result
      const waitingRequests = await this.findWaitingRequests(requestId);

      // Notify the original request
      try {
        if (error) {
          request.callback(null, error);
        } else {
          request.callback(result);
        }
      } catch (callbackError) {
        this.contextLogger.warn('Request callback failed', {
          requestId,
          error: (callbackError as Error).message,
        });
      }

      // Notify all waiting duplicates
      for (const waitingId of waitingRequests) {
        const waitingRequest = this.activeRequests.get(waitingId);
        if (waitingRequest) {
          try {
            if (error) {
              waitingRequest.callback(null, error);
            } else {
              waitingRequest.callback(result);
            }
          } catch (callbackError) {
            this.contextLogger.warn('Duplicate request callback failed', {
              requestId: waitingId,
              originalRequestId: requestId,
              error: (callbackError as Error).message,
            });
          }
        }
      }

      // Complete coalesced groups
      await this.completeCoalescedGroups(requestId, result, error);

      // Clean up
      this.activeRequests.delete(requestId);
      for (const waitingId of waitingRequests) {
        this.activeRequests.delete(waitingId);
      }

      // Remove from Redis
      await this.removeRequestFromStore(requestId);
    } catch (error) {
      logError(error as Error, {
        operation: 'completeRequest',
        requestId,
        hasResult: !!result,
      });
    }
  }

  /**
   * Generate unique signature for exact request matching
   */
  private generateRequestSignature(request: DeduplicationRequest): string {
    const sigData = {
      type: request.type,
      params: this.normalizeParams(request.params),
      chainId: request.chainId,
      userContext: request.userContext,
    };

    const sigString = JSON.stringify(sigData, Object.keys(sigData).sort());
    return crypto.createHash('sha256').update(sigString).digest('hex');
  }

  /**
   * Normalize parameters for consistent comparison
   */
  private normalizeParams(params: Record<string, any>): Record<string, any> {
    const normalized: Record<string, any> = {};

    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        normalized[key] = value.toLowerCase().trim();
      } else if (Array.isArray(value)) {
        normalized[key] = value
          .map(item => (typeof item === 'string' ? item.toLowerCase().trim() : item))
          .sort();
      } else {
        normalized[key] = value;
      }
    }

    return normalized;
  }

  /**
   * Check for exact request match
   */
  private async checkExactMatch(
    signature: string,
    request: DeduplicationRequest
  ): Promise<DeduplicationResult> {
    try {
      const key = `${config.redis.keyPrefix}dedup_exact:${signature}`;
      const existingData = await redisManager.get<{
        requestId: string;
        timestamp: number;
        result?: any;
        pending: boolean;
      }>(key);

      if (!existingData) {
        return {
          isDuplicate: false,
          deduplicationType: 'exact_match',
          costSaved: 0,
          latencySaved: 0,
        };
      }

      // Check if the existing request is still valid (within temporal window)
      const temporalWindow = request.temporalWindow || this.defaultTemporalWindow;
      if (Date.now() - existingData.timestamp > temporalWindow) {
        // Expired - remove and allow new request
        await redisManager.del(key);
        return {
          isDuplicate: false,
          deduplicationType: 'exact_match',
          costSaved: 0,
          latencySaved: 0,
        };
      }

      // Calculate savings
      const costSaved = request.estimatedCost;
      const latencySaved = this.estimateLatencySaved(request.type);

      return {
        isDuplicate: true,
        originalRequestId: existingData.requestId,
        deduplicationType: 'exact_match',
        costSaved,
        latencySaved,
        existingResult: existingData.pending ? undefined : existingData.result,
      };
    } catch (error) {
      this.contextLogger.warn('Error checking exact match', {
        signature,
        error: (error as Error).message,
      });

      return {
        isDuplicate: false,
        deduplicationType: 'exact_match',
        costSaved: 0,
        latencySaved: 0,
      };
    }
  }

  /**
   * Check for semantic request match
   */
  private async checkSemanticMatch(request: DeduplicationRequest): Promise<DeduplicationResult> {
    if (!request.semanticKey) {
      // Try to generate semantic key from request patterns
      request.semanticKey = this.generateSemanticKey(request) ?? undefined;
    }

    if (!request.semanticKey) {
      return {
        isDuplicate: false,
        deduplicationType: 'semantic_match',
        costSaved: 0,
        latencySaved: 0,
      };
    }

    try {
      const key = `${config.redis.keyPrefix}dedup_semantic:${request.semanticKey}`;
      const existingRequests = await redisManager.get<string[]>(key);

      if (!existingRequests || existingRequests.length === 0) {
        return {
          isDuplicate: false,
          deduplicationType: 'semantic_match',
          costSaved: 0,
          latencySaved: 0,
        };
      }

      // Find the most recent valid request
      for (const existingId of existingRequests.reverse()) {
        const existingRequest = this.activeRequests.get(existingId);
        if (existingRequest) {
          const timeDiff = request.timestamp - existingRequest.timestamp;
          const temporalWindow = request.temporalWindow || this.defaultTemporalWindow;

          if (timeDiff <= temporalWindow) {
            const costSaved = request.estimatedCost;
            const latencySaved = this.estimateLatencySaved(request.type);

            return {
              isDuplicate: true,
              originalRequestId: existingId,
              deduplicationType: 'semantic_match',
              costSaved,
              latencySaved,
            };
          }
        }
      }

      // Clean up expired semantic matches
      await redisManager.del(key);

      return {
        isDuplicate: false,
        deduplicationType: 'semantic_match',
        costSaved: 0,
        latencySaved: 0,
      };
    } catch (error) {
      this.contextLogger.warn('Error checking semantic match', {
        semanticKey: request.semanticKey,
        error: (error as Error).message,
      });

      return {
        isDuplicate: false,
        deduplicationType: 'semantic_match',
        costSaved: 0,
        latencySaved: 0,
      };
    }
  }

  /**
   * Check for temporal window deduplication
   */
  private async checkTemporalMatch(request: DeduplicationRequest): Promise<DeduplicationResult> {
    const temporalWindow = request.temporalWindow || this.defaultTemporalWindow;
    const windowKey = `${request.type}_${request.chainId || 'any'}`;

    try {
      const key = `${config.redis.keyPrefix}dedup_temporal:${windowKey}`;
      const recentRequests = await redisManager.get<
        Array<{
          id: string;
          timestamp: number;
          signature: string;
          params: any;
        }>
      >(key);

      if (!recentRequests) {
        return {
          isDuplicate: false,
          deduplicationType: 'temporal_window',
          costSaved: 0,
          latencySaved: 0,
        };
      }

      const currentTime = request.timestamp;
      const validRequests = recentRequests.filter(
        req => currentTime - req.timestamp <= temporalWindow
      );

      // Check for similar requests within the temporal window
      for (const existingReq of validRequests) {
        if (this.areParametersSimilar(request.params, existingReq.params, request.type)) {
          const costSaved = request.estimatedCost * 0.8; // Temporal matches save ~80%
          const latencySaved = this.estimateLatencySaved(request.type) * 0.6;

          return {
            isDuplicate: true,
            originalRequestId: existingReq.id,
            deduplicationType: 'temporal_window',
            costSaved,
            latencySaved,
          };
        }
      }

      return {
        isDuplicate: false,
        deduplicationType: 'temporal_window',
        costSaved: 0,
        latencySaved: 0,
      };
    } catch (error) {
      this.contextLogger.warn('Error checking temporal match', {
        windowKey,
        error: (error as Error).message,
      });

      return {
        isDuplicate: false,
        deduplicationType: 'temporal_window',
        costSaved: 0,
        latencySaved: 0,
      };
    }
  }

  /**
   * Check for pattern coalescing opportunities
   */
  private async checkPatternCoalescing(
    request: DeduplicationRequest
  ): Promise<DeduplicationResult> {
    const coalesceKey = this.generateCoalesceKey(request);
    if (!coalesceKey) {
      return {
        isDuplicate: false,
        deduplicationType: 'temporal_window' as const,
        costSaved: 0,
        latencySaved: 0,
      };
    }

    try {
      let group = this.requestGroups.get(coalesceKey);

      if (!group) {
        // Create new coalesce group
        group = {
          groupId: coalesceKey,
          requestType: request.type,
          semanticKey: coalesceKey,
          firstRequestId: request.id,
          firstRequestTime: request.timestamp,
          requestIds: [request.id],
          callbacks: [request.callback],
          totalCostSaved: 0,
          coalesceStrategy: 'window',
          processingStarted: false,
        };

        this.requestGroups.set(coalesceKey, group);

        // Schedule processing after coalesce window
        setTimeout(async () => {
          await this.processCoalescedGroup(coalesceKey);
        }, this.maxCoalesceWindow);

        return {
          isDuplicate: false,
          deduplicationType: 'temporal_window' as const,
          costSaved: 0,
          latencySaved: 0,
          coalesceGroup: coalesceKey,
        };
      }

      // Add to existing group if within window
      const timeDiff = request.timestamp - group.firstRequestTime;
      if (timeDiff <= this.maxCoalesceWindow && !group.processingStarted) {
        group.requestIds.push(request.id);
        group.callbacks.push(request.callback);

        const costSaved = request.estimatedCost * 0.7; // Coalescing saves ~70%
        const latencySaved = this.estimateLatencySaved(request.type) * 0.5;
        group.totalCostSaved += costSaved;

        return {
          isDuplicate: true,
          originalRequestId: group.firstRequestId,
          deduplicationType: 'temporal_window' as const,
          costSaved,
          latencySaved,
          coalesceGroup: coalesceKey,
          waitingRequests: group.requestIds.slice(1),
        };
      }

      return {
        isDuplicate: false,
        deduplicationType: 'temporal_window' as const,
        costSaved: 0,
        latencySaved: 0,
      };
    } catch (error) {
      this.contextLogger.warn('Error checking pattern coalescing', {
        coalesceKey,
        error: (error as Error).message,
      });

      return {
        isDuplicate: false,
        deduplicationType: 'temporal_window' as const,
        costSaved: 0,
        latencySaved: 0,
      };
    }
  }

  /**
   * Generate semantic key from request patterns
   */
  private generateSemanticKey(request: DeduplicationRequest): string | null {
    const pattern = this.semanticPatterns.get(request.type);
    if (!pattern) return null;

    try {
      return pattern.normalize(request.params);
    } catch (error) {
      this.contextLogger.warn('Error generating semantic key', {
        requestType: request.type,
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Generate coalesce key for pattern-based grouping
   */
  private generateCoalesceKey(request: DeduplicationRequest): string | null {
    // Generate keys based on request patterns that can be coalesced
    switch (request.type) {
      case 'balance':
        // Coalesce balance requests for same user/chain
        return `balance_${request.chainId}_${request.userContext}`;

      case 'token_metadata':
        // Coalesce token metadata requests by chain
        return `token_metadata_${request.chainId}`;

      case 'price':
        // Coalesce price requests (can batch multiple tokens)
        return `price_${request.chainId || 'any'}`;

      case 'transaction':
        // Coalesce transaction queries for same address
        if (request.params.address) {
          return `transaction_${request.chainId}_${request.params.address}`;
        }
        break;

      default:
        return null;
    }

    return null;
  }

  /**
   * Check if parameters are similar for temporal matching
   */
  private areParametersSimilar(params1: any, params2: any, requestType: string): boolean {
    switch (requestType) {
      case 'balance':
        // Similar if same address and similar token lists
        return (
          params1.address === params2.address &&
          this.arraysOverlap(params1.contractAddresses || [], params2.contractAddresses || [], 0.8)
        );

      case 'price':
        // Similar if token lists overlap significantly
        return this.arraysOverlap(
          params1.tokenAddresses || [params1.tokenAddress],
          params2.tokenAddresses || [params2.tokenAddress],
          0.6
        );

      case 'token_metadata':
        // Similar if same contract or related contracts
        return params1.contractAddress === params2.contractAddress;

      default:
        // Default exact match for other types
        return (
          JSON.stringify(this.normalizeParams(params1)) ===
          JSON.stringify(this.normalizeParams(params2))
        );
    }
  }

  /**
   * Check if two arrays have significant overlap
   */
  private arraysOverlap(arr1: any[], arr2: any[], threshold: number): boolean {
    if (!arr1.length && !arr2.length) return true;
    if (!arr1.length || !arr2.length) return false;

    const set1 = new Set(arr1);
    const set2 = new Set(arr2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));

    const overlapRatio = intersection.size / Math.min(set1.size, set2.size);
    return overlapRatio >= threshold;
  }

  /**
   * Estimate latency saved by deduplication
   */
  private estimateLatencySaved(requestType: string): number {
    const baseLatencies = {
      balance: 500,
      transaction: 800,
      token_metadata: 300,
      price: 200,
      nft: 1000,
      defi: 1200,
    };

    return baseLatencies[requestType as keyof typeof baseLatencies] || 500;
  }

  /**
   * Store active request for future matching
   */
  private async storeActiveRequest(
    request: DeduplicationRequest,
    signature: string
  ): Promise<void> {
    try {
      // Store in memory
      this.activeRequests.set(request.id, request);

      // Store exact match signature in Redis
      const exactKey = `${config.redis.keyPrefix}dedup_exact:${signature}`;
      await redisManager.set(
        exactKey,
        {
          requestId: request.id,
          timestamp: request.timestamp,
          pending: true,
        },
        request.temporalWindow || this.defaultTemporalWindow
      );

      // Store in semantic group if applicable
      if (request.semanticKey) {
        const semanticKey = `${config.redis.keyPrefix}dedup_semantic:${request.semanticKey}`;
        await (redisManager as any).lpush?.(semanticKey, request.id);
        await (redisManager as any).expire?.(
          semanticKey,
          request.temporalWindow || this.defaultTemporalWindow
        );
      }

      // Store in temporal window
      const windowKey = `${request.type}_${request.chainId || 'any'}`;
      const temporalKey = `${config.redis.keyPrefix}dedup_temporal:${windowKey}`;
      const temporalData = {
        id: request.id,
        timestamp: request.timestamp,
        signature,
        params: request.params,
      };

      await (redisManager as any).lpush?.(temporalKey, temporalData);
      await (redisManager as any).expire?.(
        temporalKey,
        request.temporalWindow || this.defaultTemporalWindow
      );
    } catch (error) {
      this.contextLogger.warn('Error storing active request', {
        requestId: request.id,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Find all requests waiting for a specific request to complete
   */
  private async findWaitingRequests(requestId: string): Promise<string[]> {
    const waitingRequests: string[] = [];

    for (const [id, req] of this.activeRequests) {
      if (id !== requestId) {
        // Check if this request is waiting for the completed one
        // This would be based on the deduplication logic used
        const signature = this.generateRequestSignature(req);
        const originalSignature = this.generateRequestSignature(
          this.activeRequests.get(requestId)!
        );

        if (signature === originalSignature) {
          waitingRequests.push(id);
        }
      }
    }

    return waitingRequests;
  }

  /**
   * Complete all requests in coalesced groups
   */
  private async completeCoalescedGroups(
    requestId: string,
    result: any,
    error?: Error
  ): Promise<void> {
    for (const [groupId, group] of this.requestGroups) {
      if (group.requestIds.includes(requestId)) {
        // Mark as completed
        group.result = result;
        group.error = error;

        // Notify all callbacks in the group
        for (const callback of group.callbacks) {
          try {
            if (error) {
              callback(null, error);
            } else {
              callback(result);
            }
          } catch (callbackError) {
            this.contextLogger.warn('Coalesced group callback failed', {
              groupId,
              error: (callbackError as Error).message,
            });
          }
        }

        // Remove the group
        this.requestGroups.delete(groupId);
        break;
      }
    }
  }

  /**
   * Process a coalesced group after the window expires
   */
  private async processCoalescedGroup(groupId: string): Promise<void> {
    const group = this.requestGroups.get(groupId);
    if (!group || group.processingStarted) return;

    group.processingStarted = true;

    try {
      // Get the first request to process
      const firstRequest = this.activeRequests.get(group.firstRequestId);
      if (!firstRequest) {
        this.requestGroups.delete(groupId);
        return;
      }

      this.contextLogger.info('Processing coalesced group', {
        groupId,
        requestCount: group.requestIds.length,
        totalCostSaved: group.totalCostSaved,
      });

      // The actual processing would be handled by the calling system
      // Here we just emit an event to signal the group is ready
      this.emit('coalescedGroupReady', {
        groupId,
        requests: group.requestIds.map(id => this.activeRequests.get(id)).filter(Boolean),
        callbacks: group.callbacks,
      });
    } catch (error) {
      logError(error as Error, {
        operation: 'processCoalescedGroup',
        groupId,
      });

      // Clean up on error
      this.requestGroups.delete(groupId);
    }
  }

  /**
   * Record successful deduplication
   */
  private async recordDeduplication(
    request: DeduplicationRequest,
    result: DeduplicationResult,
    startTime: number
  ): Promise<void> {
    const processingTime = Date.now() - startTime;

    // Update metrics
    this.metrics.duplicatesDetected++;
    this.metrics.totalCostSaved += result.costSaved;
    this.metrics.totalLatencySaved += result.latencySaved;
    this.metrics.averageDeduplicationTime =
      (this.metrics.averageDeduplicationTime + processingTime) / 2;
    this.metrics.deduplicationRate =
      (this.metrics.duplicatesDetected / this.metrics.totalRequests) * 100;

    if (!this.metrics.deduplicationsByType[result.deduplicationType]) {
      this.metrics.deduplicationsByType[result.deduplicationType] = 0;
    }
    this.metrics.deduplicationsByType[result.deduplicationType]++;

    // Update type-specific metrics
    switch (result.deduplicationType) {
      case 'semantic_match':
        this.metrics.semanticMatches++;
        break;
      case 'temporal_window':
        this.metrics.temporalMatches++;
        break;
      case 'pattern_coalescing':
        this.metrics.patternCoalesces++;
        break;
    }

    // Emit deduplication event
    const deduplicationEvent: RequestDeduplicationV1 = {
      type: 'RequestDeduplicationV1',
      timestamp: Date.now(),
      originalRequestId: result.originalRequestId || '',
      duplicateRequestIds: [request.id],
      deduplicationType: result.deduplicationType,
      dataType: request.type,
      chainId: request.chainId,
      costSaved: result.costSaved,
      latencySaved: result.latencySaved,
      metadata: {
        processingTime,
        userContext: request.userContext,
        priority: request.priority,
      },
    };

    await this.eventSystem.emitEvent(deduplicationEvent);

    this.contextLogger.info('Request deduplicated', {
      requestId: request.id,
      originalRequestId: result.originalRequestId,
      deduplicationType: result.deduplicationType,
      costSaved: result.costSaved,
      latencySaved: result.latencySaved,
      processingTime,
    });
  }

  /**
   * Remove request from store
   */
  private async removeRequestFromStore(requestId: string): Promise<void> {
    try {
      const request = this.activeRequests.get(requestId);
      if (!request) return;

      const signature = this.generateRequestSignature(request);

      // Remove exact match
      const exactKey = `${config.redis.keyPrefix}dedup_exact:${signature}`;
      await redisManager.del(exactKey);

      // Remove from semantic group
      if (request.semanticKey) {
        const semanticKey = `${config.redis.keyPrefix}dedup_semantic:${request.semanticKey}`;
        await (redisManager as any).lrem?.(semanticKey, 1, requestId);
      }

      // Remove from temporal window (Redis will clean up with TTL)
    } catch (error) {
      this.contextLogger.warn('Error removing request from store', {
        requestId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Initialize semantic patterns for request matching
   */
  private initializeSemanticPatterns(): void {
    // Balance request patterns
    this.semanticPatterns.set('balance', {
      pattern: /address|balance/i,
      normalize: params => `${params.address}_${(params.contractAddresses || []).sort().join(',')}`,
      temporal: true,
      coalesceWindow: 5000,
    });

    // Token metadata patterns
    this.semanticPatterns.set('token_metadata', {
      pattern: /token|metadata/i,
      normalize: params => params.contractAddress,
      temporal: true,
      coalesceWindow: 30000, // Metadata changes less frequently
    });

    // Price request patterns
    this.semanticPatterns.set('price', {
      pattern: /price|quote/i,
      normalize: params => (params.tokenAddresses || [params.tokenAddress]).sort().join(','),
      temporal: true,
      coalesceWindow: 3000,
    });

    // Transaction patterns
    this.semanticPatterns.set('transaction', {
      pattern: /transaction|tx/i,
      normalize: params => `${params.address}_${params.maxCount || 10}`,
      temporal: true,
      coalesceWindow: 10000,
    });
  }

  /**
   * Clean up expired requests
   */
  private async cleanupExpiredRequests(): Promise<void> {
    const cutoff = Date.now() - this.defaultTemporalWindow;
    const expiredIds: string[] = [];

    for (const [id, request] of this.activeRequests) {
      if (request.timestamp < cutoff) {
        expiredIds.push(id);
      }
    }

    for (const id of expiredIds) {
      this.activeRequests.delete(id);
    }

    // Clean up expired groups
    const expiredGroups: string[] = [];
    for (const [groupId, group] of this.requestGroups) {
      if (group.firstRequestTime < cutoff) {
        expiredGroups.push(groupId);
      }
    }

    for (const groupId of expiredGroups) {
      this.requestGroups.delete(groupId);
    }

    if (expiredIds.length > 0 || expiredGroups.length > 0) {
      this.contextLogger.info('Cleaned up expired requests', {
        expiredRequests: expiredIds.length,
        expiredGroups: expiredGroups.length,
      });
    }
  }

  /**
   * Start cleanup and monitoring processes
   */
  private startCleanupProcess(): void {
    // Clean up every 2 minutes
    setInterval(
      async () => {
        await this.cleanupExpiredRequests();
      },
      2 * 60 * 1000
    );
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    // Update metrics every 30 seconds
    setInterval(() => {
      this.metrics.activeGroups = this.requestGroups.size;

      this.emit('deduplicationMetrics', {
        timestamp: Date.now(),
        metrics: { ...this.metrics },
      });
    }, 30000);
  }

  // Public API methods

  /**
   * Get current deduplication metrics
   */
  getMetrics(): DeduplicationMetrics {
    return { ...this.metrics };
  }

  /**
   * Get active coalesce groups
   */
  getActiveGroups(): Array<{
    groupId: string;
    requestCount: number;
    totalCostSaved: number;
    age: number;
  }> {
    return Array.from(this.requestGroups.values()).map(group => ({
      groupId: group.groupId,
      requestCount: group.requestIds.length,
      totalCostSaved: group.totalCostSaved,
      age: Date.now() - group.firstRequestTime,
    }));
  }

  /**
   * Enable/disable deduplication
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.contextLogger.info(`Request deduplication ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Enable/disable semantic matching
   */
  setSemanticMatchingEnabled(enabled: boolean): void {
    this.semanticMatchingEnabled = enabled;
    this.contextLogger.info(`Semantic matching ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Enable/disable pattern detection
   */
  setPatternDetectionEnabled(enabled: boolean): void {
    this.patternDetectionEnabled = enabled;
    this.contextLogger.info(`Pattern detection ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Force cleanup of all stored data
   */
  async forceCleanup(): Promise<void> {
    this.activeRequests.clear();
    this.requestGroups.clear();
    this.semanticGroups.clear();

    // Clean up Redis keys
    const pattern = `${config.redis.keyPrefix}dedup_*`;
    // Implementation would depend on Redis client capabilities

    this.contextLogger.info('Force cleanup completed');
  }
}

// Export singleton instance
let deduplicationServiceInstance: RequestDeduplicationService | null = null;

export const getDeduplicationService = (): RequestDeduplicationService => {
  if (!deduplicationServiceInstance) {
    deduplicationServiceInstance = new RequestDeduplicationService();
  }
  return deduplicationServiceInstance;
};

export default getDeduplicationService;
