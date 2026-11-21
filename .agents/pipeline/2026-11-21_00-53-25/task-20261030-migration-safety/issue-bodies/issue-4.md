## Context

All 12 `prisma.liveClass.create()` calls in `backend/src/tests/integration/liveclass-microphone-triggers.integration.test.js` supply `microphoneAuthorizationMode` explicitly. No test omits the field and asserts the persisted value. The claim that Prisma Client 5.22.0 sends `@default` in the INSERT regardless of the DB column default rests on a code comment and Prisma documentation, but has never been verified as an executable assertion against a real database in this codebase. This leaves the default-reconciliation work without a regression signal.

## Problem

There is no executable evidence distinguishing Prisma schema defaults from database column defaults in this codebase.

## Scope

New test file: `backend/src/tests/integration/liveclass-microphone-default.integration.test.js` (follows the existing `*.integration.test.js` convention; runs under `npm run test:integration` via `jest.integration.config.js`). Must be added to the DESTRUCTIVE_TESTS list in `backend/test-safety/safe-test-manifest.js` in the same commit.

Required four cases:

1. **Case 1** — `prisma.liveClass.create()` with `microphoneAuthorizationMode` omitted: read back the persisted value and assert `SFU_AUTHORITATIVE` (the Prisma `@default`). Additionally capture the emitted INSERT via Prisma query logging and assert the parameter values contain the literal `SFU_AUTHORITATIVE`, confirming the default is applied client-side. Note: in Prisma 5.x, `e.query` is the parameterized template with `?` placeholders; the literal value appears in `e.params` — assert against `e.params`.
2. **Case 2** — `prisma.liveClass.create()` with `microphoneAuthorizationMode: 'SFU_AUTHORITATIVE'` explicit: read back, assert `SFU_AUTHORITATIVE`.
3. **Case 3** — Raw SQL INSERT omitting `microphone_authorization_mode`: read back and assert the value equals the **DB column default**. The expected value must be derived from the applied migration state (query `_prisma_migrations` for a `reconcile_microphone_authorization_default` migration with `finished_at IS NOT NULL`): `LEGACY` before the reconciliation migration, `SFU_AUTHORITATIVE` after. `SHOW COLUMNS` is a secondary confirmation only — the assertion must not be a tautology of `SHOW COLUMNS`.
4. **Case 4** — Raw SQL INSERT with explicit `microphone_authorization_mode = 'SFU_AUTHORITATIVE'`: read back, assert `SFU_AUTHORITATIVE`.

Implementation pattern: self-contained `PrismaClient` created in `beforeAll` (never import the `utils/prisma` singleton). Fixtures: `school.create` with `name`, unique `slug`, `country: 'MY'`; `user.create` with `firstName`/`lastName` (required), `passwordHash` (column name), `role: 'TEACHER'`, `status: 'ACTIVE'`, `emailVerified: true`. Track every created live-class id in a `createdLcIds` array; `afterAll` deletes live classes first, then user, then school (FK-safe order). Case 1 uses a second short-lived `PrismaClient` with `log: [{ emit: 'event', level: 'query' }]` for event capture, disconnected within the test.

## Acceptance criteria

1. Test runs against real MariaDB 10.11 with all migrations applied via `npx prisma migrate deploy` (standard CI path).
2. Uses the pinned Prisma version from `backend/package.json` (5.22.0).
3. Case 1 asserts `SFU_AUTHORITATIVE` stored and present in the emitted INSERT parameters.
4. Case 3 asserts the DB column default was applied, with expected value derived from `_prisma_migrations` state (deterministic, non-tautological).
5. Test passes on a first and second run without manual cleanup (deterministic; cleanup deletes only rows it created).
6. No pre-existing test data altered by cleanup.
7. Test classified in `backend/test-safety/safe-test-manifest.js` (DESTRUCTIVE_TESTS) so the safe unit run is not aborted.

## Verification plan

- Local: disposable DB `halqa_test` on XAMPP MariaDB (`npx prisma migrate deploy` then `npm run test:integration -- <file>`), run twice.
- CI: `Backend -- Integration Tests (MariaDB 10.11)` job green.

## Related

- Provides the evidence base for the default-reconciliation migration (#164) (which default the DB should carry).
