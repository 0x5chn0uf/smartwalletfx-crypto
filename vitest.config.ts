import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',
    
    // Global test setup
    setupFiles: ['tests/vitest.setup.ts'],
    
    // Test patterns - only include our new performance tests
    include: [
      'tests/unit/utils/circuitBreaker.test.ts',
      'tests/unit/utils/batchProcessor.test.ts',
      'tests/unit/services/memory-cache.test.ts',
      'tests/integration/optimized-chain-manager.integration.test.ts',
      'tests/performance/**/*.bench.ts'
    ],
    exclude: [
      'node_modules',
      'dist',
      'tests/e2e/**/*',
      'tests/mocks/**/*'
    ],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json', 'lcov'],
      reportsDirectory: 'coverage',
      exclude: [
        'node_modules/**',
        'dist/**',
        'tests/**',
        'scripts/**',
        '**/*.d.ts',
        '**/*.config.*',
        'src/types/**',
        'src/docs/**',
        'src/models/migrations.ts'
      ],
      include: [
        'src/**/*.ts'
      ],
      // Coverage thresholds
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        },
        // Specific thresholds for new performance features
        'src/utils/batchProcessor.ts': {
          branches: 90,
          functions: 90,
          lines: 90,
          statements: 90
        },
        'src/utils/circuitBreaker.ts': {
          branches: 90,
          functions: 90,
          lines: 90,
          statements: 90
        },
        'src/services/ChainManager.ts': {
          branches: 75,
          functions: 80,
          lines: 75,
          statements: 75
        }
      }
    },

    // Test timeout
    testTimeout: 10000,
    
    // Parallel execution
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: 4,
        minThreads: 1
      }
    },

    // Performance monitoring
    benchmark: {
      include: ['tests/performance/**/*.bench.ts'],
      exclude: ['node_modules']
    },

    // Watch mode configuration
    watch: {
      clearScreen: false
    },

    // Silent console logs during tests
    silent: false,
    
    // Report configuration
    reporters: ['verbose', 'html'],
    
    // Globals (if needed)
    globals: false
  },

  // Path resolution
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@tests': path.resolve(__dirname, 'tests')
    }
  }
});