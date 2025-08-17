/**
 * CircuitBreaker Unit Tests
 * 
 * Tests for the circuit breaker pattern implementation including:
 * - State transitions (CLOSED -> OPEN -> HALF_OPEN -> CLOSED)
 * - Failure threshold detection
 * - Recovery timeout behavior
 * - Statistics tracking
 * - Circuit breaker factory
 */

import { CircuitBreaker, CircuitBreakerFactory, CircuitState } from '../../../src/utils/circuitBreaker';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;
  
  beforeEach(() => {
    circuitBreaker = new CircuitBreaker('test-service', {
      failureThreshold: 3,
      recoveryTimeoutMs: 1000,
      monitoringWindowMs: 5000,
      halfOpenMaxCalls: 2
    });
  });

  afterEach(() => {
    circuitBreaker.reset();
  });

  describe('Initialization', () => {
    it('should start in CLOSED state', () => {
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should have zero statistics initially', () => {
      const stats = circuitBreaker.getStats();
      expect(stats.totalCalls).toBe(0);
      expect(stats.totalFailures).toBe(0);
      expect(stats.totalSuccesses).toBe(0);
      expect(stats.failureRate).toBe(0);
    });
  });

  describe('CLOSED State Behavior', () => {
    it('should execute successful calls normally', async () => {
      const mockFn = vi.fn().mockResolvedValue('success');
      
      const result = await circuitBreaker.execute(mockFn);
      
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should track successful calls in statistics', async () => {
      const mockFn = vi.fn().mockResolvedValue('success');
      
      await circuitBreaker.execute(mockFn);
      await circuitBreaker.execute(mockFn);
      
      const stats = circuitBreaker.getStats();
      expect(stats.totalCalls).toBe(2);
      expect(stats.totalSuccesses).toBe(2);
      expect(stats.totalFailures).toBe(0);
      expect(stats.failureRate).toBe(0);
    });

    it('should handle failed calls and track failures', async () => {
      const mockFn = vi.fn().mockRejectedValue(new Error('Service unavailable'));
      
      await expect(circuitBreaker.execute(mockFn)).rejects.toThrow('Service unavailable');
      
      const stats = circuitBreaker.getStats();
      expect(stats.totalCalls).toBe(1);
      expect(stats.totalFailures).toBe(1);
      expect(stats.failureRate).toBe(1);
    });

    it('should transition to OPEN when failure threshold is reached', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('Service down'));
      
      // Trigger 3 failures (threshold)
      for (let i = 0; i < 3; i++) {
        await expect(circuitBreaker.execute(mockFn)).rejects.toThrow();
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    });
  });

  describe('OPEN State Behavior', () => {
    beforeEach(async () => {
      // Trigger circuit to open
      const mockFn = jest.fn().mockRejectedValue(new Error('Service down'));
      for (let i = 0; i < 3; i++) {
        await expect(circuitBreaker.execute(mockFn)).rejects.toThrow();
      }
    });

    it('should reject calls immediately without executing function', async () => {
      const mockFn = vi.fn().mockResolvedValue('success');
      
      await expect(circuitBreaker.execute(mockFn)).rejects.toThrow('Circuit breaker is OPEN');
      expect(mockFn).not.toHaveBeenCalled();
    });

    it('should transition to HALF_OPEN after recovery timeout', async () => {
      // Wait for recovery timeout
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      expect(circuitBreaker.getState()).toBe(CircuitState.HALF_OPEN);
    });
  });

  describe('HALF_OPEN State Behavior', () => {
    beforeEach(async () => {
      // Trigger circuit to open, then wait for half-open
      const mockFn = jest.fn().mockRejectedValue(new Error('Service down'));
      for (let i = 0; i < 3; i++) {
        await expect(circuitBreaker.execute(mockFn)).rejects.toThrow();
      }
      await new Promise(resolve => setTimeout(resolve, 1100));
    });

    it('should allow limited calls through', async () => {
      const mockFn = vi.fn().mockResolvedValue('success');
      
      const result = await circuitBreaker.execute(mockFn);
      
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should transition back to CLOSED on successful calls', async () => {
      const mockFn = vi.fn().mockResolvedValue('success');
      
      // Execute successful calls up to halfOpenMaxCalls
      await circuitBreaker.execute(mockFn);
      await circuitBreaker.execute(mockFn);
      
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should transition back to OPEN on any failure', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('Still failing'));
      
      await expect(circuitBreaker.execute(mockFn)).rejects.toThrow('Still failing');
      
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should reject excess calls beyond halfOpenMaxCalls', async () => {
      const mockFn = vi.fn().mockResolvedValue('success');
      
      // Execute max allowed calls
      await circuitBreaker.execute(mockFn);
      await circuitBreaker.execute(mockFn);
      
      // This should be rejected
      await expect(circuitBreaker.execute(mockFn)).rejects.toThrow('Circuit breaker is HALF_OPEN');
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should track failure rate correctly', async () => {
      const successFn = jest.fn().mockResolvedValue('success');
      const failFn = jest.fn().mockRejectedValue(new Error('fail'));
      
      // 2 successes, 1 failure = 33% failure rate
      await circuitBreaker.execute(successFn);
      await circuitBreaker.execute(successFn);
      await expect(circuitBreaker.execute(failFn)).rejects.toThrow();
      
      const stats = circuitBreaker.getStats();
      expect(stats.totalCalls).toBe(3);
      expect(stats.totalSuccesses).toBe(2);
      expect(stats.totalFailures).toBe(1);
      expect(stats.failureRate).toBeCloseTo(0.333, 2);
    });

    it('should track state transition times', async () => {
      const startTime = Date.now();
      const mockFn = jest.fn().mockRejectedValue(new Error('fail'));
      
      // Trigger state transition
      for (let i = 0; i < 3; i++) {
        await expect(circuitBreaker.execute(mockFn)).rejects.toThrow();
      }
      
      const stats = circuitBreaker.getStats();
      expect(stats.lastStateChange).toBeGreaterThanOrEqual(startTime);
      expect(stats.state).toBe(CircuitState.OPEN);
    });
  });

  describe('Reset Functionality', () => {
    it('should reset to initial state', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('fail'));
      
      // Trigger some activity
      for (let i = 0; i < 3; i++) {
        await expect(circuitBreaker.execute(mockFn)).rejects.toThrow();
      }
      
      circuitBreaker.reset();
      
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
      const stats = circuitBreaker.getStats();
      expect(stats.totalCalls).toBe(0);
      expect(stats.totalFailures).toBe(0);
    });
  });
});

describe('CircuitBreakerFactory', () => {
  afterEach(() => {
    CircuitBreakerFactory.reset();
  });

  describe('Circuit Breaker Creation and Management', () => {
    it('should create new circuit breaker with default config', () => {
      const breaker = CircuitBreakerFactory.getOrCreate('test-service');
      
      expect(breaker).toBeInstanceOf(CircuitBreaker);
      expect(breaker.getName()).toBe('test-service');
    });

    it('should return same instance for same service name', () => {
      const breaker1 = CircuitBreakerFactory.getOrCreate('test-service');
      const breaker2 = CircuitBreakerFactory.getOrCreate('test-service');
      
      expect(breaker1).toBe(breaker2);
    });

    it('should create different instances for different service names', () => {
      const breaker1 = CircuitBreakerFactory.getOrCreate('service-1');
      const breaker2 = CircuitBreakerFactory.getOrCreate('service-2');
      
      expect(breaker1).not.toBe(breaker2);
      expect(breaker1.getName()).toBe('service-1');
      expect(breaker2.getName()).toBe('service-2');
    });

    it('should use custom config when provided', () => {
      const customConfig = {
        failureThreshold: 5,
        recoveryTimeoutMs: 2000,
        monitoringWindowMs: 10000,
        halfOpenMaxCalls: 3
      };
      
      const breaker = CircuitBreakerFactory.getOrCreate('custom-service', customConfig);
      
      // Test that custom config is used (we'll need to expose config or test behavior)
      expect(breaker.getName()).toBe('custom-service');
    });
  });

  describe('Global Statistics', () => {
    it('should return stats for all circuit breakers', async () => {
      const breaker1 = CircuitBreakerFactory.getOrCreate('service-1');
      const breaker2 = CircuitBreakerFactory.getOrCreate('service-2');
      
      // Generate some activity
      const mockFn = vi.fn().mockResolvedValue('success');
      await breaker1.execute(mockFn);
      await breaker2.execute(mockFn);
      
      const allStats = CircuitBreakerFactory.getAllStats();
      
      expect(allStats).toHaveProperty('service-1');
      expect(allStats).toHaveProperty('service-2');
      expect(allStats['service-1'].totalCalls).toBe(1);
      expect(allStats['service-2'].totalCalls).toBe(1);
    });
  });

  describe('Global Reset', () => {
    it('should reset all circuit breakers', async () => {
      const breaker1 = CircuitBreakerFactory.getOrCreate('service-1');
      const breaker2 = CircuitBreakerFactory.getOrCreate('service-2');
      
      // Generate activity
      const mockFn = vi.fn().mockResolvedValue('success');
      await breaker1.execute(mockFn);
      await breaker2.execute(mockFn);
      
      CircuitBreakerFactory.reset();
      
      // Should reset all breakers
      const allStats = CircuitBreakerFactory.getAllStats();
      expect(allStats['service-1'].totalCalls).toBe(0);
      expect(allStats['service-2'].totalCalls).toBe(0);
    });

    it('should reset specific circuit breaker by name', async () => {
      const breaker1 = CircuitBreakerFactory.getOrCreate('service-1');
      const breaker2 = CircuitBreakerFactory.getOrCreate('service-2');
      
      // Generate activity
      const mockFn = vi.fn().mockResolvedValue('success');
      await breaker1.execute(mockFn);
      await breaker2.execute(mockFn);
      
      CircuitBreakerFactory.reset('service-1');
      
      const allStats = CircuitBreakerFactory.getAllStats();
      expect(allStats['service-1'].totalCalls).toBe(0);
      expect(allStats['service-2'].totalCalls).toBe(1); // Should remain unchanged
    });
  });
});

describe('CircuitBreaker Edge Cases', () => {
  let circuitBreaker: CircuitBreaker;
  
  beforeEach(() => {
    circuitBreaker = new CircuitBreaker('edge-test', {
      failureThreshold: 2,
      recoveryTimeoutMs: 500,
      monitoringWindowMs: 2000,
      halfOpenMaxCalls: 1
    });
  });

  it('should handle async function that throws synchronously', async () => {
    const mockFn = vi.fn(() => {
      throw new Error('Sync error');
    });
    
    await expect(circuitBreaker.execute(mockFn)).rejects.toThrow('Sync error');
    
    const stats = circuitBreaker.getStats();
    expect(stats.totalFailures).toBe(1);
  });

  it('should handle concurrent calls correctly', async () => {
    const mockFn = jest.fn().mockResolvedValue('success');
    
    // Execute multiple concurrent calls
    const promises = Array(5).fill(null).map(() => circuitBreaker.execute(mockFn));
    const results = await Promise.all(promises);
    
    expect(results).toEqual(['success', 'success', 'success', 'success', 'success']);
    expect(mockFn).toHaveBeenCalledTimes(5);
    
    const stats = circuitBreaker.getStats();
    expect(stats.totalCalls).toBe(5);
    expect(stats.totalSuccesses).toBe(5);
  });

  it('should handle mixed success/failure patterns', async () => {
    let callCount = 0;
    const mockFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount % 2 === 0) {
        throw new Error('Every other call fails');
      }
      return 'success';
    });
    
    // Pattern: success, fail, success, fail
    await circuitBreaker.execute(mockFn); // success
    await expect(circuitBreaker.execute(mockFn)).rejects.toThrow(); // fail
    await circuitBreaker.execute(mockFn); // success  
    await expect(circuitBreaker.execute(mockFn)).rejects.toThrow(); // fail (threshold reached)
    
    expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    
    const stats = circuitBreaker.getStats();
    expect(stats.totalCalls).toBe(4);
    expect(stats.totalSuccesses).toBe(2);
    expect(stats.totalFailures).toBe(2);
    expect(stats.failureRate).toBe(0.5);
  });
});