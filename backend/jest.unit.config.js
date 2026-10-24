'use strict';

const { SAFE_UNIT_TESTS, DESTRUCTIVE_TESTS } = require('./test-safety/safe-test-manifest');
const { auditClassification, discoverTestFiles } = require('./test-safety/run-jest');

// Direct use of this config must fail closed too; the launcher is not the only
// place where an unreviewed test file is detected.
auditClassification(discoverTestFiles(__dirname));

module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src/tests'],
  testMatch: SAFE_UNIT_TESTS.map((file) => `<rootDir>/${file}`),
  testPathIgnorePatterns: [
    '/node_modules/',
    ...DESTRUCTIVE_TESTS.map((file) => `<rootDir>/${file}`),
  ],
  setupFiles: ['<rootDir>/test-safety/jest-unit.setup.js'],
  setupFilesAfterEnv: ['<rootDir>/test-safety/prisma-client-unit-guard.setup.js'],
  clearMocks: true,
  restoreMocks: false,
  moduleNameMapper: {
    '@opentelemetry/instrumentation-prisma': '<rootDir>/src/tests/__mocks__/otel-prisma.js',
    '@opentelemetry/instrumentation-redis': '<rootDir>/src/tests/__mocks__/otel-redis.js',
    '^livekit-server-sdk$': '<rootDir>/src/tests/__mocks__/livekit-server-sdk.js',
    '^file-type$': '<rootDir>/src/tests/__mocks__/file-type.js',
  },
  transformIgnorePatterns: ['node_modules/(?!(livekit-server-sdk|@livekit)/)'],
  testTimeout: 30000,
};
