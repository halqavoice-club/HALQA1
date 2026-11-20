## Context

`startLiveClass` in `backend/src/controllers/live-class.controller.js` (line ~842) wraps the operation in `try { ... } catch (e) { next(e); }`. When `rawUpdateLiveClassStatus` fires the `live_classes_legacy_start_guard` trigger's `SIGNAL SQLSTATE '45000'`, the error reaches Express's generic handler as an unclassified exception and the client gets HTTP 500. The trigger message text is:

`Cannot start LEGACY session; upgrade microphone_authorization_mode to SFU_AUTHORITATIVE first`

This is a business-rule violation (valid request, blocked by authorization state) and should map to HTTP 409 Conflict. `ensureProtectedScheduledMicrophoneMode` normally prevents the trigger from firing; the trigger is a defense-in-depth backstop, and the 409 path covers cases where that function fails silently (non-fatal try/catch) or is bypassed.

## Problem

A recognized business-rule rejection is indistinguishable from an unexpected failure: clients receive 500, operators see noise, and the response carries no actionable signal.

## Scope

Three files:

1. `backend/src/utils/liveClassMicrophoneContract.js` — add:
   - `LEGACY_SESSION_START_REJECTION_MESSAGE` constant (exact trigger text above), so detection stays in sync with the trigger definition.
   - `isTriggerLegacyStartRejection(err)` helper: `Boolean(err && err.message && err.message.includes(LEGACY_SESSION_START_REJECTION_MESSAGE))`. Substring match (not equality) handles Prisma raw-SQL errors that wrap the MariaDB message.
2. `backend/src/controllers/live-class.controller.js` — in `startLiveClass`'s catch block (line ~889), before `next(e)`: if `isTriggerLegacyStartRejection(e)`, return `errorResponse(res, 'The microphone authorization mode must be upgraded before starting this class.', 409)` (using `errorResponse` from `backend/src/utils/response.js`). All other errors pass through unchanged to `next(e)` → 500.
3. `backend/src/tests/live-class-microphone-unit-a.test.js` — extend (do not create a new unit file) with:
   - Helper tests: true for the trigger message (including wrapped), false for `Connection refused`, `ER_ROW_IS_REFERENCED_2`, `null`, `{}`.
   - Controller dispatch tests: 409 path (mock dependencies so the catch is reached with the trigger error; assert `res.status(409)`, `next` not called) and 500 path (unrelated DB error; assert `next(e)` called, no 409). Mocking pattern: `jest.mock('../utils/liveClassMicrophoneContract')` to control `isTriggerLegacyStartRejection`, and mock `../utils/prisma` (the controller-internal `rawFindLiveClass`/`rawUpdateLiveClassStatus` closures cannot be mocked directly).

## Constraints

- The 409 path must be narrow: only the recognized trigger message maps to 409. Unrelated SQL errors must remain 500 via `next(e)`.
- The response body must not contain SQLSTATE, `45000`, trigger names, raw SQL, or database internals.
- No change to `ensureProtectedScheduledMicrophoneMode` or the success path.
- New test code must not require classification changes (the unit file is already in the safe manifest) — verify.

## Acceptance criteria

1. `startLiveClass` returns HTTP 409 when the database error contains the trigger rejection message.
2. `startLiveClass` returns HTTP 500 (via `next(e)`) for database errors that do not contain it.
3. The 409 response body contains none of: "SQLSTATE", "45000", "trigger", raw SQL fragments.
4. A unit test covers the 409 path via injected mock error with the trigger message.
5. A unit test covers the 500 path with an unrelated database error.
6. No existing `startLiveClass` test breaks.

## Verification plan

- `cd backend; node --check src/controllers/live-class.controller.js; node --check src/utils/liveClassMicrophoneContract.js`
- `npm run test:unit` (safe suite) — all green.
- Focused: `node test-safety/run-jest.js src/tests/live-class-microphone-unit-a.test.js`
- Integration confirmation optional (the 409 path is already exercised by trigger-integration tests' expectations of the trigger firing; those must remain green in CI).

## Related

- Independent of the migration issues (2/3); can proceed in parallel.
- The trigger was introduced by migration `20261030_fix_live_class_microphone_triggers`.
