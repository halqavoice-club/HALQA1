'use strict';

module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src/tests/integration'],
  testMatch: ['**/*.integration.test.js'],
  testTimeout: 60000,
  setupFiles: ['<rootDir>/test-safety/jest-integration.setup.js'],
  moduleNameMapper: {
    '@opentelemetry/instrumentation-prisma': '<rootDir>/src/tests/__mocks__/otel-prisma.js',
    '@opentelemetry/instrumentation-redis': '<rootDir>/src/tests/__mocks__/otel-redis.js',
    '^livekit-server-sdk$': '<rootDir>/src/tests/__mocks__/livekit-server-sdk.js',
    '^file-type$': '<rootDir>/src/tests/__mocks__/file-type.js',
  },
  transformIgnorePatterns: ['node_modules/(?!(livekit-server-sdk|@livekit)/)'],
  forceExit: true,
  detectOpenHandles: false,
};
