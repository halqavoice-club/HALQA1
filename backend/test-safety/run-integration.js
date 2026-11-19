'use strict';
/**
 * Integration test runner.
 *
 * Analogous to run-jest.js for unit tests, but for integration tests.
 * Passes the full process.env to Jest so DATABASE_URL, JWT_SECRET,
 * REDIS_URL, PAYOUT_ENCRYPTION_KEY, etc. are all available.
 *
 * Usage:
 *   node test-safety/run-integration.js [--ci] [<jest-args>...]
 *
 * Requires DATABASE_URL to be set in the environment.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const INTEGRATION_CONFIG = path.resolve(__dirname, '..', 'jest.integration.config.js');

function run() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write(
      'ERROR: DATABASE_URL is not set. Integration tests require a real database.\n' +
      'Set DATABASE_URL to a test database connection string before running test:integration.\n'
    );
    process.exit(1);
  }

  const jestBin = require.resolve('jest/bin/jest');
  const extraArgs = process.argv.slice(2);

  const args = [
    '--max-old-space-size=1024',
    jestBin,
    '--config', INTEGRATION_CONFIG,
    '--runInBand',
    '--forceExit',
    ...extraArgs,
  ];

  const result = spawnSync(process.execPath, args, {
    cwd: BACKEND_ROOT,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    process.stderr.write(`ERROR: Failed to spawn Jest: ${result.error.message}\n`);
    process.exit(1);
  }

  process.exit(typeof result.status === 'number' ? result.status : 1);
}

if (require.main === module) {
  run();
}

module.exports = { run };
