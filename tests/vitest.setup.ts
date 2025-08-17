/**
 * Vitest Test Setup - Performance & New Feature Tests
 * 
 * Global setup for Vitest-based tests including:
 * - Mock implementations
 * - Test utilities
 * - Global configuration
 */

import { beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/crypto_data_test';
process.env.REDIS_URL = 'redis://localhost:6379/15'; // Use test DB
process.env.LOG_LEVEL = 'error';
process.env.ALCHEMY_API_KEY = 'test-key';
process.env.HELIUS_API_KEY = 'test-key';

// Global test utilities
globalThis.testUtils = {
  sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
  mockTimestamp: Date.now(),
  resetMocks: () => {
    vi.clearAllMocks();
  },
};

// Global setup
beforeAll(async () => {
  // Set consistent timestamps for tests
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
});

afterAll(async () => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  // Clean up any test artifacts
});

// Types for global test utilities
declare global {
  var testUtils: {
    sleep: (ms: number) => Promise<void>;
    mockTimestamp: number;
    resetMocks: () => void;
  };
}

export {};