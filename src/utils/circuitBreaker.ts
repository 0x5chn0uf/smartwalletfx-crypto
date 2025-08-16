/**
 * Circuit Breaker Pattern Implementation
 * 
 * Prevents cascading failures by monitoring failure rates and temporarily
 * blocking requests to failing services.
 */

import { logger } from './logger';

export enum CircuitState {
  CLOSED = 'CLOSED',     // Normal operation
  OPEN = 'OPEN',         // Blocking requests
  HALF_OPEN = 'HALF_OPEN' // Testing if service recovered
}

export interface CircuitBreakerConfig {
  failureThreshold: number;    // Number of failures before opening
  recoveryTimeout: number;     // Time to wait before trying again (ms)
  successThreshold: number;    // Successes needed to close circuit
  timeout: number;            // Request timeout (ms)
  monitoringPeriod: number;   // Time window for failure counting (ms)
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  totalRequests: number;
  lastFailure?: Date;
  lastSuccess?: Date;
  nextAttempt?: Date;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private totalRequests: number = 0;
  private lastFailure?: Date;
  private lastSuccess?: Date;
  private nextAttempt?: Date;
  private recentFailures: Date[] = [];

  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig
  ) {}

  /**
   * Execute function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitState.HALF_OPEN;
        logger.info(`Circuit breaker ${this.name} attempting reset`);
      } else {
        throw new Error(`Circuit breaker ${this.name} is OPEN`);
      }
    }

    this.totalRequests++;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Circuit breaker timeout')), this.config.timeout);
      });

      const result = await Promise.race([fn(), timeoutPromise]);
      
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.successes++;
    this.lastSuccess = new Date();
    
    if (this.state === CircuitState.HALF_OPEN) {
      if (this.successes >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.failures = 0;
        this.recentFailures = [];
        logger.info(`Circuit breaker ${this.name} CLOSED after recovery`);
      }
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = new Date();
    this.recentFailures.push(new Date());
    
    // Clean old failures outside monitoring period
    const cutoff = Date.now() - this.config.monitoringPeriod;
    this.recentFailures = this.recentFailures.filter(date => date.getTime() > cutoff);

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.nextAttempt = new Date(Date.now() + this.config.recoveryTimeout);
      logger.warn(`Circuit breaker ${this.name} OPEN after failed recovery attempt`);
    } else if (this.recentFailures.length >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttempt = new Date(Date.now() + this.config.recoveryTimeout);
      logger.warn(`Circuit breaker ${this.name} OPEN due to failure threshold`, {
        failures: this.recentFailures.length,
        threshold: this.config.failureThreshold
      });
    }
  }

  private shouldAttemptReset(): boolean {
    return this.nextAttempt ? Date.now() >= this.nextAttempt.getTime() : false;
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      totalRequests: this.totalRequests,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      nextAttempt: this.nextAttempt
    };
  }

  /**
   * Force reset circuit breaker (for testing/manual intervention)
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.recentFailures = [];
    this.lastFailure = undefined;
    this.nextAttempt = undefined;
    logger.info(`Circuit breaker ${this.name} manually reset`);
  }
}

/**
 * Circuit breaker factory with sensible defaults
 */
export class CircuitBreakerFactory {
  private static breakers = new Map<string, CircuitBreaker>();

  static create(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    if (this.breakers.has(name)) {
      return this.breakers.get(name)!;
    }

    const defaultConfig: CircuitBreakerConfig = {
      failureThreshold: 5,
      recoveryTimeout: 60000, // 1 minute
      successThreshold: 3,
      timeout: 30000, // 30 seconds
      monitoringPeriod: 300000, // 5 minutes
    };

    const finalConfig = { ...defaultConfig, ...config };
    const breaker = new CircuitBreaker(name, finalConfig);
    
    this.breakers.set(name, breaker);
    return breaker;
  }

  static get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  static getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    Array.from(this.breakers.entries()).forEach(([name, breaker]) => {
      stats[name] = breaker.getStats();
    });
    return stats;
  }

  static reset(name?: string): void {
    if (name) {
      const breaker = this.breakers.get(name);
      if (breaker) {
        breaker.reset();
      }
    } else {
      // Reset all breakers
      Array.from(this.breakers.values()).forEach(breaker => {
        breaker.reset();
      });
    }
  }
}