'use strict';

const BLOCKED_ERROR_CODE = 'UNIT_MODE_PRISMA_CONSTRUCTION_BLOCKED';

// This setup file is loaded only by the reviewed unit-test configuration.
// Keep the real namespace intact for enums, Decimal, Prisma errors, and SQL
// helpers while replacing the one operation unit tests must never perform.
jest.mock('@prisma/client', () => {
  const actualPrismaClient = jest.requireActual('@prisma/client');

  class UnitModeBlockedPrismaClient {
    constructor() {
      const error = new Error(
        'PrismaClient construction is blocked in the approved unit-test environment.'
      );
      error.code = BLOCKED_ERROR_CODE;
      throw error;
    }
  }

  const guardedPrismaClient = Object.create(Object.getPrototypeOf(actualPrismaClient));
  Object.defineProperties(
    guardedPrismaClient,
    Object.getOwnPropertyDescriptors(actualPrismaClient)
  );
  Object.defineProperty(guardedPrismaClient, 'PrismaClient', {
    configurable: true,
    enumerable: true,
    value: UnitModeBlockedPrismaClient,
    writable: false,
  });

  return guardedPrismaClient;
});
