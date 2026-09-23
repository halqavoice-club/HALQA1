---
inclusion: fileMatch
fileMatchPattern: "**/*.test.js,**/*.test.ts,**/*.spec.ts,**/*.pbt.test.ts,**/tests/**"
description: Test naming conventions, unit/integration/PBT categories, mock patterns, assertion rules
---

# Testing Rules & Conventions

> Tests are evidence. Do not delete tests because they expose a problem. Do not weaken assertions to get green results. If a test is wrong, document why and fix it deliberately.
> See `tech.md` for Jest/Supertest/Playwright versions and test runner commands.

---

## Three Test Categories

### 1. Unit Tests
- Mock **all** external dependencies — Prisma, Redis, JWT, Socket.IO
- No real database or network required
- Run with: `npm run test:unit` (backend), `npm test` (frontend/mobile)

Standard mock setup:
```javascript
jest.mock('../utils/prisma');
jest.mock('../utils/redis', () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn() }));
jest.mock('../utils/jwt', () => ({ verifyAccessToken: jest.fn() }));
jest.mock('../sockets', () => ({ io: { to: jest.fn().mockReturnValue({ emit: jest.fn() }) } }));
```

### 2. Integration Tests
- Require live MySQL + (optionally) Redis
- Placed in `backend/src/tests/integration/`
- Tagged `@integration` in the test name or file
- Run with: `npm run test:integration`
- Must be skipped with `test.skip` or a guard when DB is unavailable — prevents CI failure on unit-only runs

```javascript
// Guard pattern
beforeAll(async () => { await prisma.$connect(); });
afterAll(async () => { await prisma.$disconnect(); });
```

### 3. PBT — Property-Based Tests
- Use `fast-check`: `fc.assert(fc.property(arbitrary, (value) => { /* assertions */ }))`
- File extension: `*.pbt.test.ts`
- Default `numRuns`: **100** (CI speed); use 200–400 for critical invariants
- The property function must **not throw** — use `expect()` assertions inside
- TypeScript/frontend PBT runs under vitest; backend PBT runs under Jest

---

## File Naming Convention

| Type | Pattern | Example |
|------|---------|---------|
| Unit / integration | `{domain}-{concern}.test.js` | `live-class-p0-security.test.js` |
| Security / admin scope | `{domain}-scope.test.js` | `super-admin-scope.test.js` |
| Idempotency | `{concern}.test.js` | `idempotency.test.js` |
| PBT | `{domain}.pbt.test.ts` | `computeLayout.pbt.test.ts` |

---

## `describe` / `test` Naming Convention

```javascript
// describe: {FIX-ID or CATEGORY}: {plain-English description}
describe('SA-FIX-02: updateRoom — SUPER_ADMIN cannot edit room without room role', () => {

  // test: state the expected behavior in plain English
  test('SUPER_ADMIN (non-participant) gets 403 on PATCH /voice/:id', async () => { ... });

});
```

---

## Standard Mock Helpers

Define these in a shared test utility or inline at the top of each test file:

```javascript
const { verifyAccessToken } = require('../utils/jwt');
const prisma = require('../utils/prisma');

// asUser: sets up JWT mock + Prisma user lookup mock together
function asUser(id, role, status = 'ACTIVE', schoolId = null) {
  verifyAccessToken.mockReturnValue({ userId: id, role, schoolId });
  prisma.user.findUnique.mockResolvedValue({ id, role, status, schoolId });
}

// tok: returns a Bearer token string for the given user ID
const tok = (id) => `Bearer t-${id}`;

// Standard beforeEach
beforeEach(() => {
  jest.clearAllMocks();
  // Reset Redis mock to unavailable (graceful fallback testing)
  redis.get.mockRejectedValue(new Error('Redis unavailable'));
});
```

---

## Security Test Requirements

Security-related tests **must** include all three:

1. **Positive path** — permitted user succeeds (2xx response)
2. **Negative path** — denied user gets 403 or 401
3. **Source-level verification** — assert the guard is implemented at the code level

```javascript
// Source-level verification pattern (use when middleware ordering
// or mock depth prevents runtime testing of the guard directly)
const fs = require('fs');
const src = fs.readFileSync(
  path.join(__dirname, '../controllers/live-class.controller.js'), 'utf8'
);
test('joinLiveClass does not include SUPER_ADMIN in isTeacher check', () => {
  // Confirm the fix is present in source
  expect(src).not.toMatch(/isTeacher.*SUPER_ADMIN/);
});
```

---

## PBT Configuration

```typescript
import fc from 'fast-check';

fc.assert(
  fc.property(
    fc.integer({ min: 1, max: 20 }),  // arbitrary
    (speakerCount) => {
      const layout = computeLayout(speakerCount);
      // Property: layout must always have exactly speakerCount slots
      expect(layout.slots).toHaveLength(speakerCount);
    }
  ),
  { numRuns: 100 }  // default; increase to 200-400 for critical invariants
);
```

---

## Baseline Rule

The established passing test baseline must be verified from the repository before making any changes. Never reduce, weaken, delete, bypass, or conceal an established passing test without an explicit justified decision.

The last documented unit-test count was **985 passing tests** (unit tests only, excluding integration tests, per the repository's Jest configuration in `backend/package.json`). This number is historical documentation — not a permanent fixed count. The test suite grows as features are added.

Before making changes that affect tests:
1. Run `npm run test:unit` in `backend/` to determine the current verified baseline
2. Ensure no change reduces the count below the current verified baseline
3. Integration tests (in `backend/src/tests/integration/`) are excluded from `npm test` and `npm run test:unit` — they run separately via `npm run test:integration`

Do not claim 985 is the current count unless it is actually verified by running the suite.

---

## Cross-References

- Test runner commands → `tech.md` (Common Commands section)
- SUPER_ADMIN regression suite → `backend/src/tests/platform-admin-scope.test.js`
- Security test examples → `backend/src/tests/p0-security-fixes.test.js`, `backend/src/tests/super-admin-scope.test.js`
- PBT example → `src/lib/layout/__tests__/computeLayout.pbt.test.ts`
