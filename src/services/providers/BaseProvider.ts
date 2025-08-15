import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { logger, logApiCall, logCost } from '@/utils/logger';
import { recordProviderCall } from '@/utils/metrics';
import { redisManager } from '@/utils/redis';
import { getCostMonitoringService } from '@/services/CostMonitoringService';
import {
  ChainProvider,
  ChainId,
  ProviderConfig,
  ProviderResponse,
  ChainProviderError,
  RateLimitError,
  NetworkError,
  validateAddress,
  formatAddress,
  CHAIN_CONFIGS,
} from '@/types/blockchain';

export abstract class BaseProvider implements ChainProvider {
  protected readonly axios: AxiosInstance;
  protected readonly config: ProviderConfig;
  protected requestCount = 0;
  protected lastRequestTime = 0;
  protected healthy = true;

  constructor(
    public readonly chainId: ChainId,
    public readonly name: string,
    config: ProviderConfig
  ) {
    this.config = config;
    
    this.axios = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SmartWalletFX-Crypto-Data-Service/1.0.0',
      },
    });

    this.setupInterceptors();
  }

  get isHealthy(): boolean {
    return this.healthy;
  }

  // Abstract methods to be implemented by specific providers
  abstract initialize(): Promise<void>;
  protected abstract buildAuthHeaders(): Record<string, string>;
  protected abstract handleProviderError(error: any): ChainProviderError;
  protected abstract parseBalanceResponse(response: any): any;
  protected abstract parseTransactionResponse(response: any): any;

  // Rate limiting
  protected async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minInterval = 1000 / this.config.rateLimit.requestsPerSecond;

    if (timeSinceLastRequest < minInterval) {
      const delay = minInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  // Setup axios interceptors
  private setupInterceptors(): void {
    // Request interceptor
    this.axios.interceptors.request.use(
      async (config) => {
        await this.enforceRateLimit();
        
        // Add auth headers
        const authHeaders = this.buildAuthHeaders();
        config.headers = { ...config.headers, ...authHeaders };
        
        // Add request ID for tracking
        const requestId = `${this.name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        config.metadata = { requestId, startTime: Date.now() };
        config.headers['X-Request-ID'] = requestId;

        logger.debug(`API Request: ${this.name} ${config.method?.toUpperCase()} ${config.url}`, {
          provider: this.name,
          chainId: this.chainId,
          requestId,
        });

        return config;
      },
      (error) => {
        logger.error(`Request setup failed: ${this.name}`, { error });
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.axios.interceptors.response.use(
      (response) => {
        const duration = Date.now() - response.config.metadata.startTime;
        const requestId = response.config.metadata.requestId;

        logApiCall(this.name, response.config.url || '', duration, 'success', {
          requestId,
          statusCode: response.status,
        });
        recordProviderCall(this.name, this.chainId as any, true, duration);

        logCost(this.name, response.config.url || '', this.config.costPerRequest, {
          requestId,
        });

        this.healthy = true;
        return response;
      },
      (error: AxiosError) => {
        const duration = error.config?.metadata?.startTime 
          ? Date.now() - error.config.metadata.startTime 
          : 0;
        const requestId = error.config?.metadata?.requestId || 'unknown';

        logApiCall(this.name, error.config?.url || '', duration, 'error', {
          requestId,
          statusCode: error.response?.status,
          errorMessage: error.message,
        });
        recordProviderCall(this.name, this.chainId as any, false, duration);

        // Update health status based on error type
        if (error.response?.status && error.response.status >= 500) {
          this.healthy = false;
        }

        return Promise.reject(this.handleAxiosError(error));
      }
    );
  }

  // Handle axios errors and convert to provider errors
  private handleAxiosError(error: AxiosError): ChainProviderError {
    if (error.response?.status === 429) {
      return new RateLimitError(this.name, this.chainId);
    }

    if (!error.response) {
      return new NetworkError(this.name, this.chainId, error);
    }

    return this.handleProviderError(error);
  }

  // Protected API request method with retry logic
  protected async makeRequest<T>(
    config: AxiosRequestConfig,
    retries: number = this.config.retries,
    customCost?: number
  ): Promise<ProviderResponse<T>> {
    const requestId = `${this.name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        const response = await this.axios.request({
          ...config,
          metadata: { requestId, startTime },
        });

        const responseTime = Date.now() - startTime;
        const cost = customCost ?? this.config.costPerRequest;

        // Track the cost for successful requests (decoupled from Express middleware)
        try {
          await getCostMonitoringService().trackAPICall(
            this.name,
            config.url || config.method || 'unknown',
            cost,
            {
              responseTime,
              success: true,
              metadata: {
                requestId,
                statusCode: response.status,
                chainId: this.chainId,
                attempt,
              },
            }
          );
        } catch (e) {
          logger.warn('Cost monitoring failed for provider request', {
            provider: this.name,
            error: e instanceof Error ? e.message : String(e),
          });
        }

        return {
          success: true,
          data: response.data as T,
          metadata: {
            provider: this.name,
            chainId: this.chainId,
            timestamp: Date.now(),
            requestId,
            cost: cost,
            cacheTtl: this.config.cacheTtl.balance,
          },
        };
      } catch (error) {
        const isLastAttempt = attempt === retries + 1;
        const providerError = error instanceof ChainProviderError 
          ? error 
          : this.handleProviderError(error);

        if (isLastAttempt || !providerError.isRetryable) {
          const responseTime = Date.now() - startTime;
          const cost = (customCost ?? this.config.costPerRequest) * 0.1; // Failed requests cost less

          // Track the cost for failed requests (decoupled)
          try {
            await getCostMonitoringService().trackAPICall(
              this.name,
              config.url || config.method || 'unknown',
              cost,
              {
                responseTime,
                success: false,
                metadata: {
                  requestId,
                  statusCode: (error as any)?.response?.status,
                  chainId: this.chainId,
                  attempt,
                  errorMessage: providerError.message,
                },
              }
            );
          } catch (e) {
            logger.warn('Cost monitoring failed for provider error', {
              provider: this.name,
              error: e instanceof Error ? e.message : String(e),
            });
          }

          logger.error(`API request failed after ${attempt} attempts:`, {
            provider: this.name,
            chainId: this.chainId,
            error: providerError.message,
            requestId,
            endpoint: config.url,
            statusCode: error.response?.status,
          });

          return {
            success: false,
            error: {
              code: providerError.code,
              message: providerError.message,
              details: { 
                attempt, 
                totalAttempts: retries + 1,
                statusCode: error.response?.status,
                endpoint: config.url 
              },
            },
            metadata: {
              provider: this.name,
              chainId: this.chainId,
              timestamp: Date.now(),
              requestId,
            },
          };
        }

        // Exponential backoff for retries
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        logger.warn(`Retrying request in ${delay}ms (attempt ${attempt}/${retries + 1}):`, {
          provider: this.name,
          error: providerError.message,
          requestId,
          statusCode: error.response?.status,
        });

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // This shouldn't be reached, but TypeScript requires a return
    throw new Error('Unexpected error in request retry logic');
  }

  // Caching utilities
  protected getCacheKey(method: string, params: Record<string, any>): string {
    const paramStr = Object.keys(params)
      .sort()
      .map(key => `${key}:${params[key]}`)
      .join('|');
    return `${this.name}:${this.chainId}:${method}:${paramStr}`;
  }

  protected async getCached<T>(
    cacheKey: string,
    fetchFunction: () => Promise<ProviderResponse<T>>,
    ttl: number
  ): Promise<ProviderResponse<T>> {
    try {
      const cached = await redisManager.get<ProviderResponse<T>>(cacheKey);
      if (cached && cached.success) {
        logger.debug(`Cache hit: ${cacheKey}`, {
          provider: this.name,
          chainId: this.chainId,
        });
        return {
          ...cached,
          metadata: {
            ...cached.metadata,
            timestamp: Date.now(), // Update timestamp but keep original data
          },
        };
      }
    } catch (error) {
      logger.warn(`Cache read failed for ${cacheKey}:`, { error });
    }

    // Cache miss - fetch fresh data
    const fresh = await fetchFunction();
    
    if (fresh.success) {
      try {
        await redisManager.set(cacheKey, fresh, ttl);
        logger.debug(`Cached data: ${cacheKey}`, {
          provider: this.name,
          chainId: this.chainId,
          ttl,
        });
      } catch (error) {
        logger.warn(`Cache write failed for ${cacheKey}:`, { error });
      }
    }

    return fresh;
  }

  // Health check implementation
  async healthCheck(): Promise<boolean> {
    try {
      // Use a simple, low-cost request for health check
      const testResponse = await this.performHealthCheckRequest();
      this.healthy = testResponse;
      
      if (!this.healthy) {
        logger.warn(`Health check failed for ${this.name}`);
      }
      
      return this.healthy;
    } catch (error) {
      this.healthy = false;
      logger.error(`Health check failed for ${this.name}:`, { error });
      return false;
    }
  }

  // Abstract method for provider-specific health checks
  protected abstract performHealthCheckRequest(): Promise<boolean>;

  // Address validation
  isValidAddress(address: string): boolean {
    return validateAddress(address, this.chainId);
  }

  formatAddress(address: string): string {
    return formatAddress(address, this.chainId);
  }

  // Explorer URL
  getExplorerUrl(hash: string): string {
    const config = CHAIN_CONFIGS[this.chainId];
    return `${config.explorerUrl}/tx/${hash}`;
  }

  // Get current request statistics
  getRequestStats() {
    return {
      requestCount: this.requestCount,
      isHealthy: this.healthy,
      lastRequestTime: this.lastRequestTime,
      rateLimit: this.config.rateLimit,
    };
  }

  // Reset request statistics (useful for testing)
  resetStats(): void {
    this.requestCount = 0;
    this.lastRequestTime = 0;
    this.healthy = true;
  }
}
