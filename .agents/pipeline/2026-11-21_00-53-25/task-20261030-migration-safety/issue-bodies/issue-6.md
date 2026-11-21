## Context

`rawInsertLC` in `backend/src/tests/integration/live-class.integration.test.js` (line ~139) performs a raw `INSERT INTO live_classes` that omits `microphone_authorization_mode`; after `20261030` the DB column default supplies `LEGACY`. This dependency is accidental — the helpers predate the column (added in `20261029`). If the default-reconciliation migration changes the DB default to `SFU_AUTHORITATIVE`, any test relying on the implicit `LEGACY` would silently test the wrong thing. The `SCHEDULED` class created at line ~285 flows through `ensureProtectedScheduledMicrophoneMode` (LEGACY→SFU upgrade on start), so the implicit default is load-bearing for setup paths.

## Problem

Test scenarios depend on an implicit database default rather than explicit intent, making the suite fragile against the planned default migration and obscuring what each test actually exercises.

## Scope (three files; strictly tests + a diagnostic script — no production code)

1. `backend/src/tests/integration/live-class.integration.test.js` — extend `rawInsertLC` to accept `microphoneAuthorizationMode` (conditionally include the column/placeholder, preserving the literal `1,1,0,0` for screenShare/whiteboard/quranPanel/isRecorded and existing parameter positions; omitted mode keeps byte-identical SQL). Update the nine call sites (~233, ~266, ~285, ~324, ~355, ~407, ~441, ~490, ~551): each passes `microphoneAuthorizationMode: 'SFU_AUTHORITATIVE'` (the application-consistent value) or, where the scenario specifically tests LEGACY behavior, `'LEGACY'` with a comment. The GATE-F02 SUPER_ADMIN SCHEDULED site (~285) uses `SFU_AUTHORITATIVE` with a comment: `assertSchoolAccess` fires 403 before any microphone check, so the mode is irrelevant.
2. `backend/src/tests/live-class-real-db.test.js` — extend `createTestLC` (~lines 88–122) with the same conditional mode column (spliced before `now, now`; the inline `1,1,0,0` literals preserved). All ~12 call sites pass `SFU_AUTHORITATIVE` (no call site depends on LEGACY for a passing assertion; POST /start sites expect 403 before any microphone check) or `LEGACY` with a comment where a LEGACY path is intentionally exercised.
3. `backend/fix-live-class-columns.js` — the Step 10 diagnostic INSERT (~line 140) sets `microphone_authorization_mode = 'SFU_AUTHORITATIVE'` explicitly (the `_test_` row is SCHEDULED and immediately deleted; the explicit value mirrors `rawCreateLiveClass`).

## Rules

- FR-6.5 policy: mode-indifferent scenarios use `SFU_AUTHORITATIVE` (what the application always creates) unless the test specifically needs LEGACY.
- No production files (`controllers/`, `services/`, `routes/`, `middleware/`) touched.
- Test scenarios retain their intended meaning; tests that tested LEGACY behavior still test LEGACY behavior (explicitly).
- After the change the suite must be green whether the DB default is `LEGACY` or `SFU_AUTHORITATIVE`.

## Acceptance criteria

1. `rawInsertLC` and `createTestLC` accept a microphone-authorization-mode parameter and include the column in the INSERT when provided.
2. Every call site either passes the mode appropriate to its scenario or carries a comment explaining why the mode is irrelevant.
3. No `rawInsertLC`/`createTestLC` call relies on the implicit DB default for mode-dependent state.
4. The full integration suite passes against MariaDB 10.11 with either DB default.
5. No production files modified.
6. The `fix-live-class-columns.js` Step 10 run reports `[OK] Test creation succeeded` in both default states.

## Verification plan

- `npm run test:unit` (unchanged safe suite, must stay green).
- On disposable `halqa_test`: `npx prisma migrate deploy`; `npm run test:integration` — green with the current (LEGACY) default; then apply the reconciliation migration and run again — green with `SFU_AUTHORITATIVE`.
- `node --check fix-live-class-columns.js`; run the script once against the disposable DB.
- `git diff --stat` confirms only test files and the diagnostic script changed.

## Related

- Prerequisite (or same-PR companion) for the database default reconciliation issue (#164): that migration must not merge until these helpers are explicit.
- Coordinate with the trigger-idempotency migration issue (#163) for migration ordering.
