/**
 * Jest Test Setup - Unit/Integration Tests
 * 
 * Global setup for all test environments including:
 * - Mock implementations
 * - Test utilities
 * - Global configuration
 */

import { beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/crypto_data_test';
process.env.REDIS_URL = 'redis://localhost:6379/15'; // Use test DB
process.env.LOG_LEVEL = 'error';

// Mock external dependencies
jest.mock('@/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  logPerformance: jest.fn(),
}));

jest.mock('@/utils/redis', () => ({
  redisManager: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    flushdb: jest.fn(),
    disconnect: jest.fn(),
  },
}));

// Mock Prisma Client
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => ({
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $transaction: jest.fn(),
  })),
}));

// Mock ethers providers
jest.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: jest.fn(() => ({
      getBlockNumber: jest.fn(() => Promise.resolve(12345678)),
      call: jest.fn(),
      getNetwork: jest.fn(() => Promise.resolve({ chainId: 1, name: 'mainnet' })),
    })),
    Contract: jest.fn(() => ({
      getUserReservesData: jest.fn(),
      getUserAccountData: jest.fn(),
      getReservesData: jest.fn(),
      balanceOf: jest.fn(),
      tokenOfOwnerByIndex: jest.fn(),
      positions: jest.fn(),
      getPool: jest.fn(),
      slot0: jest.fn(),
      liquidity: jest.fn(),
      symbol: jest.fn(),
      name: jest.fn(),
      decimals: jest.fn(),
    })),
    ZeroAddress: '0x0000000000000000000000000000000000000000',
  },
}));

// Global test utilities
global.testUtils = {
  sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
  mockTimestamp: Date.now(),
  resetMocks: () => {
    jest.clearAllMocks();
  },
};

// Global setup
beforeAll(async () => {
  // Set consistent timestamps for tests
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
});

afterAll(async () => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.clearAllMocks();
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