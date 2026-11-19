'use strict';
/**
 * Jest setup file for integration test mode.
 *
 * Runs before each test file (via setupFiles in jest.integration.config.js).
 * Verifies the environment is suitable for running against a real database.
 */

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    'Integration tests require DATABASE_URL to be set. Run against a real database, not a mock.'
  );
}

// Guard against accidentally running against a default local dev database.
// CI uses mysql://halqa:halqa_test_pw@localhost:3306/halqa_test which does NOT match.
if (/mysql:\/\/root:password@localhost/i.test(DATABASE_URL) ||
    /mysql:\/\/root:root@localhost/i.test(DATABASE_URL)) {
  throw new Error(
    'Integration tests must not run against a default dev database. Use an isolated test database.'
  );
}

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}

process.env.HALQA_TEST_MODE = 'integration';
