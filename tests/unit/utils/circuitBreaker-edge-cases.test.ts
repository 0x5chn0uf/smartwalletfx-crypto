/**
 * CircuitBreaker Edge Cases and Advanced Scenarios
 * 
 * Comprehensive edge case testing to achieve 100% code coverage:
 * - Error scenarios and failure modes
 * - Concurrent access patterns
 * - Resource exhaustion scenarios
 * - Configuration edge cases
 * - Memory leak prevention
 */

import { CircuitBreaker, CircuitBreakerFactory, CircuitState } from '../../../src/utils/circuitBreaker';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('CircuitBreaker Edge Cases', () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker('edge-test', {
      failureThreshold: 2,
      recoveryTimeoutMs: 100,
      monitoringWindowMs: 1000,
      halfOpenMaxCalls: 1
    });
  });

  afterEach(() => {
    CircuitBreakerFactory.reset();
  });

  describe('Configuration Edge Cases', () => {
    it('should handle zero failure threshold', () => {
      const zeroThresholdBreaker = new CircuitBreaker('zero-threshold', {
        failureThreshold: 0,
        recoveryTimeoutMs: 100,
        monitoringWindowMs: 1000,
        halfOpenMaxCalls: 1
      });

      expect(zeroThresholdBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should handle very short recovery timeout', async () => {
      const shortTimeoutBreaker = new CircuitBreaker('short-timeout', {
        failureThreshold: 1,
        recoveryTimeoutMs: 1, // 1ms
        monitoringWindowMs: 1000,
        halfOpenMaxCalls: 1
      });

      const mockFn = vi.fn().mockRejectedValue(new Error('fail'));
      await expect(shortTimeoutBreaker.execute(mockFn)).rejects.toThrow();
      
      expect(shortTimeoutBreaker.getState()).toBe(CircuitState.OPEN);
      
      // Advance time to trigger recovery
      vi.advanceTimersByTime(5);
      expect(shortTimeoutBreaker.getState()).toBe(CircuitState.HALF_OPEN);
    });

    it('should handle zero half-open max calls', async () => {
      const zeroHalfOpenBreaker = new CircuitBreaker('zero-half-open', {
        failureThreshold: 1,
        recoveryTimeoutMs: 100,
        monitoringWindowMs: 1000,
        halfOpenMaxCalls: 0
      });

      const mockFn = vi.fn().mockRejectedValue(new Error('fail'));
      await expect(zeroHalfOpenBreaker.execute(mockFn)).rejects.toThrow();
      
      expect(zeroHalfOpenBreaker.getState()).toBe(CircuitState.OPEN);
      
      vi.advanceTimersByTime(150);
      expect(zeroHalfOpenBreaker.getState()).toBe(CircuitState.HALF_OPEN);
      
      // Should immediately reject due to zero max calls
      const successFn = vi.fn().mockResolvedValue('success');
      await expect(zeroHalfOpenBreaker.execute(successFn)).rejects.toThrow('Circuit breaker is HALF_OPEN');
    });
  });

  describe('Function Execution Edge Cases', () => {
    it('should handle function that returns undefined', async () => {
      const undefinedFn = vi.fn().mockResolvedValue(undefined);
      
      const result = await circuitBreaker.execute(undefinedFn);
      
      expect(result).toBeUndefined();
      expect(circuitBreaker.getStats().totalSuccesses).toBe(1);
    });

    it('should handle function that returns null', async () => {
      const nullFn = vi.fn().mockResolvedValue(null);
      
      const result = await circuitBreaker.execute(nullFn);
      
      expect(result).toBeNull();
      expect(circuitBreaker.getStats().totalSuccesses).toBe(1);
    });

    it('should handle function that returns primitive values', async () => {
      const primitiveFn = vi.fn()
        .mockResolvedValueOnce(42)
        .mockResolvedValueOnce('string')
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(false);

      expect(await circuitBreaker.execute(primitiveFn)).toBe(42);
      expect(await circuitBreaker.execute(primitiveFn)).toBe('string');
      expect(await circuitBreaker.execute(primitiveFn)).toBe(true);
      expect(await circuitBreaker.execute(primitiveFn)).toBe(0);
      expect(await circuitBreaker.execute(primitiveFn)).toBe(false);
      
      expect(circuitBreaker.getStats().totalSuccesses).toBe(5);
    });

    it('should handle non-Error rejections', async () => {
      const stringRejectFn = vi.fn().mockRejectedValue('string error');
      const numberRejectFn = vi.fn().mockRejectedValue(404);
      const objectRejectFn = vi.fn().mockRejectedValue({ code: 'ERR_CUSTOM' });

      await expect(circuitBreaker.execute(stringRejectFn)).rejects.toBe('string error');
      await expect(circuitBreaker.execute(numberRejectFn)).rejects.toBe(404);
      await expect(circuitBreaker.execute(objectRejectFn)).rejects.toEqual({ code: 'ERR_CUSTOM' });
      
      expect(circuitBreaker.getStats().totalFailures).toBe(2); // Only 2 because it opens after threshold
    });
  });

  describe('Concurrent Access Patterns', () => {
    it('should handle concurrent executions in CLOSED state', async () => {
      const mockFn = vi.fn().mockImplementation(async (id: number) => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
        return `result-${id}`;
      });

      const promises = Array(20).fill(null).map((_, i) => 
        circuitBreaker.execute(() => mockFn(i))
      );

      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(20);
      results.forEach((result, i) => {
        expect(result).toBe(`result-${i}`);
      });
      expect(circuitBreaker.getStats().totalSuccesses).toBe(20);
    });

    it('should handle concurrent executions when transitioning to OPEN', async () => {
      let callCount = 0;
      const mockFn = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          throw new Error(`Failure ${callCount}`);
        }
        return 'success';
      });

      // Start many concurrent calls
      const promises = Array(10).fill(null).map(() => 
        circuitBreaker.execute(mockFn).catch(err => ({ error: err.message }))
      );

      const results = await Promise.all(promises);
      
      // Some should fail with actual errors, others with circuit breaker errors
      const actualFailures = results.filter(r => 
        typeof r === 'object' && r.error && r.error.startsWith('Failure')
      ).length;
      const circuitBreakerFailures = results.filter(r => 
        typeof r === 'object' && r.error && r.error.includes('Circuit breaker')
      ).length;

      expect(actualFailures).toBeGreaterThan(0);
      expect(circuitBreakerFailures).toBeGreaterThan(0);
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should handle race conditions in HALF_OPEN state', async () => {
      // First, trigger OPEN state
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));
      await expect(circuitBreaker.execute(failFn)).rejects.toThrow();
      await expect(circuitBreaker.execute(failFn)).rejects.toThrow();
      
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
      
      // Advance time to HALF_OPEN
      vi.advanceTimersByTime(150);
      expect(circuitBreaker.getState()).toBe(CircuitState.HALF_OPEN);
      
      // Race multiple calls
      const successFn = vi.fn().mockResolvedValue('success');
      const promises = Array(5).fill(null).map(() =>
        circuitBreaker.execute(successFn).catch(err => ({ error: err.message }))
      );

      const results = await Promise.all(promises);
      
      // Only maxCalls should succeed, others should be rejected
      const successes = results.filter(r => r === 'success').length;
      const rejections = results.filter(r => 
        typeof r === 'object' && r.error
      ).length;

      expect(successes).toBe(1); // halfOpenMaxCalls = 1
      expect(rejections).toBe(4);
    });
  });

  describe('State Transition Edge Cases', () => {
    it('should handle rapid state transitions', async () => {
      const variableFn = vi.fn()
        .mockRejectedValueOnce(new Error('fail1'))
        .mockRejectedValueOnce(new Error('fail2')) // Should trigger OPEN
        .mockResolvedValueOnce('success'); // For HALF_OPEN test

      // Trigger failures to open circuit
      await expect(circuitBreaker.execute(variableFn)).rejects.toThrow('fail1');
      await expect(circuitBreaker.execute(variableFn)).rejects.toThrow('fail2');
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);

      // Advance time to HALF_OPEN
      vi.advanceTimersByTime(150);
      expect(circuitBreaker.getState()).toBe(CircuitState.HALF_OPEN);

      // Success should close circuit
      const result = await circuitBreaker.execute(variableFn);
      expect(result).toBe('success');
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should handle failure in HALF_OPEN state', async () => {
      // Trigger OPEN state
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));
      await expect(circuitBreaker.execute(failFn)).rejects.toThrow();
      await expect(circuitBreaker.execute(failFn)).rejects.toThrow();
      
      // Advance to HALF_OPEN
      vi.advanceTimersByTime(150);
      expect(circuitBreaker.getState()).toBe(CircuitState.HALF_OPEN);
      
      // Failure should go back to OPEN
      await expect(circuitBreaker.execute(failFn)).rejects.toThrow('fail');
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    });
  });

  describe('Memory and Resource Management', () => {
    it('should not leak memory with many state transitions', async () => {
      const alternatingFn = vi.fn();
      
      for (let i = 0; i < 100; i++) {
        circuitBreaker.reset(); // Reset to CLOSED
        
        if (i % 2 === 0) {
          alternatingFn.mockRejectedValueOnce(new Error('fail1'))
                     .mockRejectedValueOnce(new Error('fail2'));
          
          await expect(circuitBreaker.execute(alternatingFn)).rejects.toThrow();
          await expect(circuitBreaker.execute(alternatingFn)).rejects.toThrow();
        } else {
          alternatingFn.mockResolvedValueOnce('success');
          await circuitBreaker.execute(alternatingFn);
        }
      }
      
      // Should still function normally
      alternatingFn.mockResolvedValueOnce('final-success');
      const result = await circuitBreaker.execute(alternatingFn);
      expect(result).toBe('final-success');
    });

    it('should handle statistics calculation edge cases', () => {
      const stats = circuitBreaker.getStats();
      
      // Initially no calls
      expect(stats.failureRate).toBe(0);
      expect(stats.currentWindowCalls).toBe(0);
      
      // After reset, stats should be clean
      circuitBreaker.reset();
      const resetStats = circuitBreaker.getStats();
      expect(resetStats.totalCalls).toBe(0);
      expect(resetStats.totalFailures).toBe(0);
      expect(resetStats.totalSuccesses).toBe(0);
    });
  });

  describe('Factory Edge Cases', () => {
    it('should handle factory with different configurations', () => {
      const breaker1 = CircuitBreakerFactory.getOrCreate('service-1', {
        failureThreshold: 5,
        recoveryTimeoutMs: 1000,
        monitoringWindowMs: 5000,
        halfOpenMaxCalls: 3
      });

      const breaker2 = CircuitBreakerFactory.getOrCreate('service-2', {
        failureThreshold: 1,
        recoveryTimeoutMs: 100,
        monitoringWindowMs: 1000,
        halfOpenMaxCalls: 1
      });

      expect(breaker1.getName()).toBe('service-1');
      expect(breaker2.getName()).toBe('service-2');
      expect(breaker1).not.toBe(breaker2);
    });

    it('should handle factory reset with partial reset', () => {
      const breaker1 = CircuitBreakerFactory.getOrCreate('service-1');
      const breaker2 = CircuitBreakerFactory.getOrCreate('service-2');
      
      // Reset only service-1
      CircuitBreakerFactory.reset('service-1');
      
      const allStats = CircuitBreakerFactory.getAllStats();
      expect(allStats['service-1'].totalCalls).toBe(0);
      expect(allStats).toHaveProperty('service-2');
    });

    it('should handle empty service names and special characters', () => {
      const specialNames = ['', ' ', '🚀', '服务-1', 'service:with:colons'];
      
      specialNames.forEach(name => {
        const breaker = CircuitBreakerFactory.getOrCreate(name);
        expect(breaker.getName()).toBe(name);
      });
      
      const allStats = CircuitBreakerFactory.getAllStats();
      specialNames.forEach(name => {
        expect(allStats).toHaveProperty(name);
      });
    });
  });

  describe('Error Message Formatting', () => {
    it('should provide descriptive error messages in different states', async () => {
      const mockFn = vi.fn().mockResolvedValue('success');
      
      // Trigger OPEN state
      const failFn = vi.fn().mockRejectedValue(new Error('service down'));
      await expect(circuitBreaker.execute(failFn)).rejects.toThrow();
      await expect(circuitBreaker.execute(failFn)).rejects.toThrow();
      
      // OPEN state error
      await expect(circuitBreaker.execute(mockFn))
        .rejects.toThrow('Circuit breaker is OPEN for service: edge-test');
      
      // Transition to HALF_OPEN
      vi.advanceTimersByTime(150);
      
      // Exhaust HALF_OPEN calls
      await circuitBreaker.execute(mockFn);
      
      // HALF_OPEN state error
      await expect(circuitBreaker.execute(mockFn))
        .rejects.toThrow('Circuit breaker is HALF_OPEN for service: edge-test');
    });
  });

  describe('Time-based Monitoring Window', () => {
    it('should reset failure count outside monitoring window', async () => {
      const shortWindowBreaker = new CircuitBreaker('short-window', {
        failureThreshold: 3,
        recoveryTimeoutMs: 1000,
        monitoringWindowMs: 100, // Very short window
        halfOpenMaxCalls: 1
      });

      const failFn = vi.fn().mockRejectedValue(new Error('fail'));
      
      // One failure
      await expect(shortWindowBreaker.execute(failFn)).rejects.toThrow();
      expect(shortWindowBreaker.getStats().totalFailures).toBe(1);
      
      // Advance time beyond monitoring window
      vi.advanceTimersByTime(150);
      
      // Failure count in current window should be reset
      const stats = shortWindowBreaker.getStats();
      expect(stats.currentWindowCalls).toBe(0);
      
      // Should still be in CLOSED state despite previous failure
      expect(shortWindowBreaker.getState()).toBe(CircuitState.CLOSED);
    });
  });
});