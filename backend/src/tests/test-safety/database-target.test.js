'use strict';

const fs = require('fs');
const path = require('path');

const validatorPath = path.resolve(__dirname, '../../../test-safety/validate-test-database-target.js');
const environmentBeforeImport = { ...process.env };
const modulesBeforeImport = new Set(Object.keys(require.cache));
const validator = require(validatorPath);
const modulesLoadedByImport = Object.keys(require.cache).filter(
  (modulePath) => !modulesBeforeImport.has(modulePath)
);

const trustedProfile = Object.freeze({
  protocol: 'mysql:',
  host: '127.0.0.1',
  port: '3307',
  databaseName: 'halqa_destructive_tests',
  username: 'halqa_destructive_test_runner',
});
const validUrl =
  'mysql://halqa_destructive_test_runner:test-password@127.0.0.1:3307/halqa_destructive_tests';

function validate(overrides = {}) {
  return validator.validateTestDatabaseTarget({
    testDatabaseUrl: validUrl,
    trustedProfile,
    authorization: validator.DESTRUCTIVE_TEST_AUTHORIZATION,
    ...overrides,
  });
}

describe('Phase 3A destructive-test database target safety', () => {
  test('accepts an exact trusted profile without connecting', () => {
    expect(validate()).toEqual({
      protocol: 'mysql:', hostname: '127.0.0.1', port: '3307',
      databaseName: 'halqa_destructive_tests', username: 'halqa_destructive_test_runner',
    });
  });

  test.each([
    ['development database', 'mysql://halqa_app:secret@127.0.0.1:3307/halqa_db'],
    ['production database', 'mysql://halqa_app:secret@db.internal:3306/halqa_production'],
    ['root identity', 'mysql://root:secret@127.0.0.1:3307/halqa_destructive_tests'],
    ['application username', 'mysql://halqa_user:secret@127.0.0.1:3307/halqa_destructive_tests'],
  ])('rejects a %s', (_label, testDatabaseUrl) => {
    expect(() => validate({ testDatabaseUrl })).toThrow('Unsafe test database target');
  });

  test.each([undefined, '', 'not-a-url', 'postgresql://user:pass@127.0.0.1:5432/test'])(
    'rejects a missing or invalid TEST_DATABASE_URL: %p', (testDatabaseUrl) => {
      expect(() => validate({ testDatabaseUrl })).toThrow('Unsafe test database target');
    }
  );

  test.each([
    ['host', 'mysql://halqa_destructive_test_runner:test-password@localhost:3307/halqa_destructive_tests'],
    ['port', 'mysql://halqa_destructive_test_runner:test-password@127.0.0.1:3308/halqa_destructive_tests'],
    ['database', 'mysql://halqa_destructive_test_runner:test-password@127.0.0.1:3307/other_test'],
    ['username', 'mysql://other_test_user:test-password@127.0.0.1:3307/halqa_destructive_tests'],
  ])('rejects the wrong %s', (_field, testDatabaseUrl) => {
    expect(() => validate({ testDatabaseUrl })).toThrow('does not match the trusted profile');
  });

  test('rejects missing destructive-test authorization', () => {
    expect(() => validate({ authorization: undefined })).toThrow(
      'explicit destructive-test authorization is required'
    );
  });

  test.each([
    'mysql://halqa_destructive_test_runner@127.0.0.1:3307/halqa_destructive_tests',
    'mysql://halqa_destructive_test_runner:test-password@127.0.0.1/halqa_destructive_tests',
    'mysql://halqa_destructive_test_runner:test-password@127.0.0.1:3307/halqa_destructive_tests?socket=/tmp/mysql.sock',
    'mysql://halqa_destructive_test_runner:test-password@127.0.0.1:3307/halqa_destructive_tests#fragment',
    'mysql://halqa_destructive_test_runner:test-password@127.0.0.1:3307/halqa%5fdestructive%5ftests',
  ])('rejects incomplete or ambiguous URL configuration', (testDatabaseUrl) => {
    expect(() => validate({ testDatabaseUrl })).toThrow('Unsafe test database target');
  });

  test('never includes credentials in validation errors', () => {
    const secret = 'UNIQUE_DATABASE_PASSWORD_DO_NOT_LEAK';
    const testDatabaseUrl = `mysql://wrong-user:${secret}@wrong-host:3308/wrong_database?ssl=true`;
    try {
      validate({ testDatabaseUrl });
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error.message).not.toContain(secret);
      expect(error.message).not.toContain(testDatabaseUrl);
    }
  });

  test('has no import-time environment, Prisma, database, or application side effects', () => {
    expect(process.env).toEqual(environmentBeforeImport);
    expect(modulesLoadedByImport).toEqual([validatorPath]);
    const source = fs.readFileSync(validatorPath, 'utf8');
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/require\s*\(\s*['"](?:@prisma|\.\.?\/.*(?:app|prisma))/);
    expect(source).not.toMatch(/new\s+PrismaClient|\$connect\s*\(/);
  });
});
