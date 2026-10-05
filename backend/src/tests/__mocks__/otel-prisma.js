'use strict';
// Global Jest stub for @opentelemetry/instrumentation-prisma
// This package is not installed (optional observability dep).
// The moduleNameMapper in package.json redirects all requires of this
// module here so every test suite gets a silent no-op stub without needing
// individual jest.mock() calls.
module.exports = {
  PrismaInstrumentation: function PrismaInstrumentation() {
    return {};
  },
};
