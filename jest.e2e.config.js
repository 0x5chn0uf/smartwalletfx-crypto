module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/e2e'],
  testMatch: [
    '**/e2e/**/*.test.ts',
    '**/e2e/**/*.spec.ts'
  ],
  transform: {
    '^.+\.ts$': 'ts-jest'
  },
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  setupFilesAfterEnv: [
    '<rootDir>/tests/setup.e2e.ts'
  ],
  testTimeout: 60000,
  maxWorkers: 2,
  verbose: true,
  detectOpenHandles: true,
  forceExit: true
};