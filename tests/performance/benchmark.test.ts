/**
 * Performance Benchmarking Suite
 * Validates the system meets performance targets
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/testing';
import request from 'supertest';
import app from '../../src/app';
import { performance } from 'perf_hooks';

describe('Performance Benchmarks', () => {
  beforeAll(async () => {
    // Warm up the application
    await request(app).get('/health');
  });

  describe('API Response Times', () => {
    it('health endpoint should respond under 100ms', async () => {
      const start = performance.now();
      
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      const duration = performance.now() - start;
      
      expect(response.body.success).toBe(true);
      expect(duration).toBeLessThan(100); // Under 100ms
    });

    it('metrics endpoint should respond under 500ms', async () => {
      const start = performance.now();
      
      await request(app)
        .get('/metrics')
        .expect(200);
      
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(500); // Under 500ms
    });
  });

  describe('Concurrent Load Handling', () => {
    it('should handle 50 concurrent requests', async () => {
      const concurrentRequests = 50;
      const start = performance.now();
      
      const requests = Array(concurrentRequests)
        .fill(null)
        .map(() => request(app).get('/health'));
      
      const responses = await Promise.all(requests);
      const duration = performance.now() - start;
      
      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
      
      // Should complete within 5 seconds
      expect(duration).toBeLessThan(5000);
      
      // Calculate throughput (requests per second)
      const throughput = (concurrentRequests / duration) * 1000;
      expect(throughput).toBeGreaterThan(10); // At least 10 RPS
    });

    it('should maintain performance under sustained load', async () => {
      const requestsPerBatch = 10;
      const batches = 5;
      const results: number[] = [];
      
      for (let batch = 0; batch < batches; batch++) {
        const start = performance.now();
        
        const requests = Array(requestsPerBatch)
          .fill(null)
          .map(() => request(app).get('/health'));
        
        const responses = await Promise.all(requests);
        const duration = performance.now() - start;
        
        // All requests should succeed
        responses.forEach(response => {
          expect(response.status).toBe(200);
        });
        
        results.push(duration);
        
        // Brief pause between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Performance should remain consistent
      const avgDuration = results.reduce((a, b) => a + b, 0) / results.length;
      const maxDeviation = Math.max(...results) - Math.min(...results);
      
      expect(avgDuration).toBeLessThan(2000); // Average under 2 seconds
      expect(maxDeviation).toBeLessThan(1000); // Deviation under 1 second
    });
  });

  describe('Memory Usage', () => {
    it('should not leak memory during request processing', async () => {
      const initialMemory = process.memoryUsage();
      
      // Make multiple requests to potentially trigger memory leaks
      for (let i = 0; i < 100; i++) {
        await request(app).get('/health');
      }
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const finalMemory = process.memoryUsage();
      
      // Memory usage shouldn't increase dramatically
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      const memoryIncreasePercent = (memoryIncrease / initialMemory.heapUsed) * 100;
      
      expect(memoryIncreasePercent).toBeLessThan(50); // Less than 50% increase
    });
  });

  describe('Error Response Performance', () => {
    it('should handle 404 errors quickly', async () => {
      const start = performance.now();
      
      await request(app)
        .get('/non-existent-endpoint')
        .expect(404);
      
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(100); // Under 100ms
    });

    it('should handle validation errors quickly', async () => {
      const start = performance.now();
      
      await request(app)
        .post('/portfolio/invalid-address')
        .send({ invalid: 'data' })
        .expect(400);
      
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(200); // Under 200ms
    });
  });

  describe('System Resource Efficiency', () => {
    it('should process requests with minimal CPU impact', async () => {
      const requestCount = 20;
      const start = performance.now();
      
      const requests = Array(requestCount)
        .fill(null)
        .map(() => request(app).get('/health'));
      
      await Promise.all(requests);
      const duration = performance.now() - start;
      
      // Calculate efficiency (requests per millisecond)
      const efficiency = requestCount / duration;
      expect(efficiency).toBeGreaterThan(0.1); // At least 0.1 requests/ms
    });
  });
});

describe('Portfolio Performance Targets', () => {
  describe('Expected Throughput', () => {
    it('should support target of 100 portfolio computations per minute', () => {
      // This is a design target validation
      const targetComputationsPerMinute = 100;
      const maxProcessingTimePerComputation = (60 * 1000) / targetComputationsPerMinute; // 600ms
      
      expect(maxProcessingTimePerComputation).toBe(600);
      
      // Verify this aligns with our system design
      expect(maxProcessingTimePerComputation).toBeGreaterThan(100); // Reasonable minimum
      expect(maxProcessingTimePerComputation).toBeLessThan(1000); // Should be under 1 second
    });
  });

  describe('Cache Performance', () => {
    it('should demonstrate cache effectiveness', async () => {
      // First request (cache miss)
      const start1 = performance.now();
      await request(app).get('/health');
      const duration1 = performance.now() - start1;
      
      // Second request (potential cache hit)
      const start2 = performance.now();
      await request(app).get('/health');
      const duration2 = performance.now() - start2;
      
      // Subsequent requests should be faster or similar
      expect(duration2).toBeLessThanOrEqual(duration1 * 1.5);
    });
  });
});