'use strict';

const net = require('net');
const {
  SAFE_UNIT_TESTS,
  DESTRUCTIVE_TESTS,
} = require('../../../test-safety/safe-test-manifest');
const {
  auditClassification,
  discoverTestFiles,
} = require('../../../test-safety/run-jest');

const BLOCKED_ERROR_CODE = 'UNIT_MODE_PRISMA_CONSTRUCTION_BLOCKED';

function expectConstructionBlocked(PrismaClient) {
  let thrown;

  try {
    new PrismaClient();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toEqual(expect.objectContaining({ code: BLOCKED_ERROR_CODE }));
  expect(thrown.message).not.toMatch(/mysql:\/\//i);
}

describe('approved unit-mode PrismaClient construction guard', () => {
  test('blocks direct PrismaClient construction before any socket connection', () => {
    const connectSpy = jest.spyOn(net.Socket.prototype, 'connect');
    const { PrismaClient } = require('@prisma/client');

    expectConstructionBlocked(PrismaClient);
    expect(connectSpy).not.toHaveBeenCalled();
  });

  test('preserves Prisma namespace enums required by application modules', () => {
    const { Prisma } = require('@prisma/client');

    expect(Prisma.TransactionIsolationLevel.ReadCommitted).toBe('ReadCommitted');
  });

  test('preserves Decimal, Prisma errors, and SQL helpers', () => {
    const prismaPackage = require('@prisma/client');

    expect(prismaPackage.Prisma.Decimal).toBeDefined();
    expect(prismaPackage.Prisma.PrismaClientKnownRequestError).toBeDefined();
    expect(prismaPackage.Prisma.sql).toEqual(expect.any(Function));
  });

  test('preserves the shared Prisma manual mock', () => {
    jest.mock('../../utils/prisma');
    const prisma = require('../../utils/prisma');

    expect(prisma.user.findUnique).toEqual(expect.any(Function));
    expect(jest.isMockFunction(prisma.user.findUnique)).toBe(true);
  });

  test('jest.resetModules does not bypass the construction guard', () => {
    jest.resetModules();
    const { PrismaClient } = require('@prisma/client');

    expectConstructionBlocked(PrismaClient);
  });

  test('jest.isolateModules does not bypass the construction guard', () => {
    jest.isolateModules(() => {
      const { PrismaClient } = require('@prisma/client');
      expectConstructionBlocked(PrismaClient);
    });
  });

  test('discovery remains complete and all destructive suites remain excluded', () => {
    const discovered = discoverTestFiles(process.cwd());

    expect(() => auditClassification(discovered)).not.toThrow();
    expect(SAFE_UNIT_TESTS).toHaveLength(163);
    expect(DESTRUCTIVE_TESTS).toHaveLength(18);
    expect(discovered).toHaveLength(181);
    expect(SAFE_UNIT_TESTS).toContain(
      'src/tests/test-safety/prisma-client-unit-guard.test.js'
    );
    expect(SAFE_UNIT_TESTS).not.toEqual(expect.arrayContaining(DESTRUCTIVE_TESTS));
  });
});
