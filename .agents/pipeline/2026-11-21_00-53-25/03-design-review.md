# Design Review — Migration 20261030 Recovery, Trigger Safety, and Microphone Authorization Consistency

**Design under review:** `02-design.md` (revision addressing 13 prior findings + 3 loop-back findings)
**Requirements:** `01-requirements.md`
**Method:** Each load-bearing claim about existing code was verified against the actual source in this repository. Findings below cite file + line where a claim was checked.

**Verdict: CHANGES_REQUESTED** — 1 MEDIUM finding. (Verdict is mechanical: any HIGH or MEDIUM ⇒ CHANGES_REQUESTED.)

---

## Findings

### Finding 1 — MEDIUM — Issue 5 controller-dispatch unit test specifies an infeasible mocking mechanism and is under-specified

**Location:** Issue 5, "Controller dispatch unit tests" snippet.

**Problem.** The test sketch says *"Arrange: mock `rawUpdateLiveClassStatus` to throw the trigger error"* and *"... mock `rawFindLiveClass`, `assertSchoolAccess`, etc. to reach the catch block."* That mechanism is infeasible as written: `rawFindLiveClass` (line 109), `rawUpdateLiveClassStatus` (line 182), `ensureProtectedScheduledMicrophoneMode` (line 210), and `assertSchoolAccess` (line 324) are all defined **inside** `backend/src/controllers/live-class.controller.js`. They are not separately importable modules, so `jest.mock` cannot replace them individually — you cannot "mock `rawUpdateLiveClassStatus`" directly.

The design then defers the real setup to "the existing mocking patterns in the controller's existing unit test files." Such a pattern does exist (`live-class-ownership.test.js`, `live-class-stage-lifecycle.test.js`, `live-class-p0-security.test.js`, etc.), and it works by mocking the **`prisma` singleton**, not the same-file helpers. Because the design's stated mechanism contradicts the only feasible one, an implementer following the design literally would try to `jest.mock` a local function and stall.

A second defect in the same snippet: it `jest.mock`s `isTriggerLegacyStartRejection` to `mockReturnValue(true)`. If the helper is mocked, the injected error's message text is irrelevant, so the test no longer exercises "injecting a mock error **with the trigger message text**" as AC 4/5 require — it only exercises the controller's `if`-branch against a canned boolean.

**Concrete fix.** Replace the sketch with the established pattern from `live-class-ownership.test.js`:

```js
jest.mock('../utils/prisma', () => ({
  $queryRawUnsafe: jest.fn(),
  $executeRawUnsafe: jest.fn(),
  liveClassParticipant: { findFirst: jest.fn(), count: jest.fn(), upsert: jest.fn(), findMany: jest.fn() },
  // ...only the methods startLiveClass reaches before the throw...
}));
jest.mock('../sockets',          () => ({ getIo: jest.fn(() => null) }));
jest.mock('../utils/feedLive',   () => ({ broadcastLiveStart: jest.fn(), broadcastLiveEnd: jest.fn() }));
jest.mock('../services/queue.service', () => ({ queueBulkNotifications: jest.fn() }));
jest.mock('../utils/logger',     () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
// Do NOT mock ../utils/liveClassMicrophoneContract — let the real isTriggerLegacyStartRejection run.

const prisma = require('../utils/prisma');
const { LEGACY_SESSION_START_REJECTION_MESSAGE } = require('../utils/liveClassMicrophoneContract');
const { startLiveClass } = require('../controllers/live-class.controller');

function makeRes() { /* status/json recording impl as in live-class-ownership.test.js */ }

function stubPublicScheduledLc() {
  // PUBLIC stream ⇒ assertSchoolAccess is skipped (controller guards it behind `lc.streamType !== 'PUBLIC'`)
  prisma.$queryRawUnsafe.mockResolvedValueOnce([{
    id: 'lc-1', stream_type: 'PUBLIC', streamType: 'PUBLIC', schoolId: null,
    classId: null, teacherId: null, host_user_id: 'host-1', hostUserId: 'host-1',
    title: 'T', status: 'SCHEDULED', /* ...remaining scalar fields... */
  }]);
}

test('409 path: trigger message ⇒ HTTP 409, no internals leaked', async () => {
  stubPublicScheduledLc();                                   // rawFindLiveClass
  prisma.$executeRawUnsafe.mockRejectedValueOnce(             // rawUpdateLiveClassStatus throws
    new Error(LEGACY_SESSION_START_REJECTION_MESSAGE)
  );
  const res = makeRes(); const next = jest.fn();
  await startLiveClass({ params: { id: 'lc-1' }, user: { id: 'host-1' } }, res, next);
  expect(res._status).toBe(409);
  expect(JSON.stringify(res._json)).not.toMatch(/SQLSTATE|45000|trigger|INSERT|UPDATE/i);
  expect(next).not.toHaveBeenCalled();
});

test('500 path: unrelated DB error ⇒ next(e)', async () => {
  stubPublicScheduledLc();
  prisma.$executeRawUnsafe.mockRejectedValueOnce(new Error('Connection refused'));
  const res = makeRes(); const next = jest.fn();
  await startLiveClass({ params: { id: 'lc-1' }, user: { id: 'host-1' } }, res, next);
  expect(next).toHaveBeenCalledWith(expect.any(Error));
  expect(res._status).not.toBe(409);
});
```

Notes for the implementer: (a) stub a **PUBLIC** stream so `assertSchoolAccess` is skipped and the flow reaches `rawUpdateLiveClassStatus`; (b) `assertProtectedRuntimeReady` is wrapped in a soft try/catch that logs and continues, so it does not block reaching the throw — mock `../services/liveclass-microphone-authority.service` only if you want to suppress its `logger.warn`; (c) the 409 path throws at `rawUpdateLiveClassStatus`, which is **before** `getIo()`/`broadcastLiveStart`, so those mocks are belt-and-suspenders for import-time safety, not for the throw path. Consider placing these runtime-mock tests in a separate file (e.g. `live-class-microphone-409-dispatch.test.js`) to keep `live-class-microphone-unit-a.test.js` (pure source-string assertions) and the runtime-mock suite in distinct paradigms — though hoisting the above `jest.mock` calls into `live-class-microphone-unit-a.test.js` is harmless to its existing source-string tests because those tests do not call `prisma` at runtime.

---

### Finding 2 — NIT — Issue 2 "byte-for-byte copies" claim is inaccurate

**Location:** Issue 2, "SQL content" → *"The trigger bodies are byte-for-byte copies of the bodies in `20261030_fix_live_class_microphone_triggers/migration.sql` (Steps 3 and 4)."*

**Problem.** The proposed trigger bodies omit the inline `-- Block: …` comments that exist in 20261030 Steps 3 and 4 (e.g. `-- Block: downgrade from SFU_AUTHORITATIVE back to LEGACY (always forbidden)`, `-- Block: transitioning to LIVE while microphone mode is still LEGACY`). The `IF` conditions, `SIGNAL SQLSTATE '45000'`, and `MESSAGE_TEXT` strings are identical, so FR-2.4's authorization invariants are preserved exactly — but the bodies are not byte-for-byte.

**Concrete fix.** Either (a) retain the inline comments so the bodies are genuinely byte-for-byte, or (b) reword the claim to: *"functionally identical to 20261030 Steps 3 and 4 — every `IF` condition and `MESSAGE_TEXT` string is preserved exactly; only the explanatory inline comments are omitted."*

---

### Finding 3 — NIT — Issue 3 overstates `rawCreateLiveClass` as "always SFU_AUTHORITATIVE"

**Location:** Issue 3, "Decision on direction" → *"the production create path (`rawCreateLiveClass` at `live-class.controller.js:50–52,90`) always sets `microphone_authorization_mode` explicitly to `MICROPHONE_AUTHORIZATION_MODES.SFU_AUTHORITATIVE`."*

**Problem.** The actual code is `const microphoneAuthorizationMode = data.microphoneAuthorizationMode || MICROPHONE_AUTHORIZATION_MODES.SFU_AUTHORITATIVE;` — a caller passing `microphoneAuthorizationMode: 'LEGACY'` gets `LEGACY`. So it does not "always" set SFU. The load-bearing claim — the column is always present in the INSERT column list and parameter list, so the DB column default is never observed through this path — is **correct** (verified: the INSERT explicitly lists `microphone_authorization_mode` and binds `microphoneAuthorizationMode`). Only the "always SFU" phrasing is imprecise.

**Concrete fix.** Reword to: *"`rawCreateLiveClass` always includes `microphone_authorization_mode` explicitly in the INSERT (defaulting to `SFU_AUTHORITATIVE` when the caller omits it), so the DB column default is never observed through the production create path."* Issue 3's chosen direction (align DB default to `SFU_AUTHORITATIVE`) does not depend on the "always SFU" phrasing, so the decision stands.

---

### Finding 4 — NIT — Overview framing contradicts Issue 3's committed direction

**Location:** Overview → *"the Prisma default test (Issue 4) produces evidence that informs whether Issue 3 changes `SFU_AUTHORITATIVE` → `LEGACY` or the reverse."*

**Problem.** Issue 3's section has already decided the direction (align the DB default to `SFU_AUTHORITATIVE`), justified independently of Issue 4 by the production-path reasoning, and the "Dependency Order and Merge Sequence" table lists Issue 3's prerequisites as Issue 2 + Issue 6 (not Issue 4). The Overview implies the direction is undecided pending Issue 4 — a cross-section inconsistency.

**Concrete fix.** Reword the Overview to: *"the Prisma default test (Issue 4) provides regression evidence for Issue 3's chosen direction (align the DB default to `SFU_AUTHORITATIVE`);"* — i.e., Issue 4 confirms rather than decides.

---

### Finding 5 — NIT — Issue 6 should explicitly classify `fix-live-class-columns.js` as a non-production diagnostic

**Location:** Issue 6, "Files to modify" (item 3) and the R4-3 response.

**Problem.** FR-6.6 says *"No production code may be modified… The scope is strictly test helpers and test call sites."* `backend/fix-live-class-columns.js` is neither a test helper nor production runtime code — it is a standalone diagnostic/repair script in the `backend/` root, not imported by the application and not part of the test suite. The design includes it (justified by FR-3.1, which names it as an affected creation path) but does not explicitly state why editing it does not violate FR-6.6's "strictly test helpers" wording.

**Concrete fix.** Add one sentence to the Issue 6 "Files to modify" item 3: *"`fix-live-class-columns.js` is a standalone, manually-run diagnostic script — it is not imported by the application and is not part of the test suite — so editing its Step 10 INSERT does not modify production runtime code; it is included here because FR-3.1 names it as an affected creation path."*

---

## Verified Assumptions

The following design claims were checked against source and confirmed:

1. **20261030 migration structure** — `backend/prisma/migrations/20261030_fix_live_class_microphone_triggers/migration.sql`: Step 1 `ALTER COLUMN … SET DEFAULT 'LEGACY'`, Step 2 `DROP TRIGGER IF EXISTS live_classes_microphone_mode_guard`, Step 3 `CREATE TRIGGER live_classes_microphone_mode_guard` (with inline comments), Step 4 bare `CREATE TRIGGER live_classes_legacy_start_guard` with **no** preceding `DROP TRIGGER IF EXISTS`. Confirms FR-2.2 (start-guard needs the DROP guard) and the trigger message text.
2. **Trigger message text** — `'Cannot start LEGACY session; upgrade microphone_authorization_mode to SFU_AUTHORITATIVE first'` matches 20261030 Step 4 `MESSAGE_TEXT` exactly. Validates the `LEGACY_SESSION_START_REJECTION_MESSAGE` constant proposed for Issue 5.
3. **`liveClassMicrophoneContract.js`** — exports `MICROPHONE_AUTHORIZATION_MODES` with `SFU_AUTHORITATIVE: 'SFU_AUTHORITATIVE'` (plus `LIVE_CLASS_MICROPHONE_API_CONTRACT`, `MICROPHONE_AUTHORIZATION_REASONS`, `normalizeMicrophoneAuthorizationMode`, `isSfuAuthoritativeMode`, `classifyMicrophoneAuthorization`). Adding `LEGACY_SESSION_START_REJECTION_MESSAGE` + `isTriggerLegacyStartRejection` to `module.exports` is feasible.
4. **`startLiveClass` catch block** — `backend/src/controllers/live-class.controller.js`: `startLiveClass` at line 842; catch is `} catch (e) { next(e); }` at line 889, with no SQLSTATE/trigger inspection. Confirms FR-5.1/FR-5.3's starting point.
5. **`ensureProtectedScheduledMicrophoneMode`** — defined at line 210, wrapped in a non-fatal try/catch (`logger.warn` + continue), and called at line 859 **before** `rawUpdateLiveClassStatus` (line 863). Confirms the design's "defense-in-depth, runs before the throw point" claim.
6. **`rawCreateLiveClass`** — includes `microphone_authorization_mode` in the INSERT column list and binds `microphoneAuthorizationMode` (`data.microphoneAuthorizationMode || SFU_AUTHORITATIVE`). The DB column default is never observed through this path. (See Finding 3 for the "always SFU" phrasing nuance.)
7. **`errorResponse` signature** — `backend/src/utils/response.js`: `errorResponse(res, message = 'An error occurred', statusCode = 500, errors = null)`. The proposed `errorResponse(res, '…', 409)` call is valid.
8. **Trigger-test fixture pattern** — `liveclass-microphone-triggers.integration.test.js` uses `new PrismaClient()` in `beforeAll` (self-contained, not the shared singleton); school fixture `{ name, slug, country: "MY" }`; user fixture `{ email, passwordHash, firstName, lastName, role: 'TEACHER', status: 'ACTIVE', emailVerified: true }`. Confirms the Issue 4 fixture pattern (R4-1/R4-2 fixes).
9. **`rawInsertLC`** — `live-class.integration.test.js` line 139; omits `microphone_authorization_mode`; pushes to `createdLcIds`. Exactly **nine** call sites at lines 233, 266, 285, 324, 355, 407, 441, 490, 551. Confirms the Issue 6 call-site table count and line numbers.
10. **GATE-F02 SUPER_ADMIN SCHEDULED test (line 285)** — `streamType: 'SCHOOL'`, requesting user is `superAdmin` (SUPER_ADMIN, no school membership) → `assertSchoolAccess` fires 403 before `ensureProtectedScheduledMicrophoneMode` or any trigger path. Confirms the design's rationale for using `SFU_AUTHORITATIVE` (not `LEGACY`) there.
11. **GATE-10 test (line 441)** — creator (`host`) successfully `POST /start`s a SCHEDULED PUBLIC class; with `SFU_AUTHORITATIVE` set explicitly, `ensureProtectedScheduledMicrophoneMode` is a no-op and the start succeeds. Confirms the line-441 table entry.
12. **`createTestLC`** — `live-class-real-db.test.js` ~line 88; omits `microphone_authorization_mode`; hardcodes `TEACHER_ID`/`SCHOOL_ID`; inline literals `1,1,0,0` for `screenShareEnabled, whiteboardEnabled, quranPanelEnabled, isRecorded`. The proposed extension (splice `modeColumn`/`modePlaceholder`/`modeValue` before `now, now`) is backward-compatible (byte-identical SQL when the mode is omitted) and correct (column/placeholder/param counts reconcile in both branches).
13. **`rawInsertLC` extension** — the proposed conditional column/placeholder splice reconciles to 19 columns/15 params (mode omitted) and 20/16 (mode provided). Backward-compatible.
14. **`fix-live-class-columns.js` Step 10** — ~line 158; raw INSERT of a `SCHEDULED` `_test_` row, omits `microphone_authorization_mode`, checks `maxParticipants IS NULL`, deletes the row. Confirms the Issue 6 edit target.
15. **`schema.prisma`** — `microphoneAuthorizationMode … @default(SFU_AUTHORITATIVE) @map("microphone_authorization_mode")` (line 1818). `User`: `firstName String` (required), `lastName String` (required), `passwordHash String?` (nullable), `username String? @unique` (nullable — so the Issue 4 fixture may omit it), `status UserStatus @default(PENDING)`, `emailVerified Boolean @default(false)`, `email String @unique`. `School`: `slug String @unique` (required, no `@default`), `country String @default("US")`. Confirms the Issue 4 fixture field choices.
16. **LiveClass NOT-NULL constraints** — the only NOT-NULL scalar without a default is `title` (provided in every Issue 4 case). `livekitRoomName`, `classId`, `teacherId`, `maxParticipants`, `description`, `scheduledAt`, `duration`, `delegatedHostId`, `recordingUrl`, `coverImageUrl`, `startedAt`, `endedAt`, `deletedAt`, `recordingStartedAt`, `microphoneModeEstablishedAt` are all nullable; `streamType`/`status`/`maxSpeakers` and the booleans have `@default`. Confirms the Issue 4 Case 3/4 raw INSERTs (which omit many of these) are feasible.
17. **Prisma version** — `backend/package.json`: `@prisma/client` and `prisma` both pinned at `5.22.0`. Confirms FR-4.2.
18. **Migration ordering** — last migration is `20261114_add_post_report_pending_unique`; `20261115`/`20261116` sort lexicographically after it (and after `20261030`). Confirms FR-2.1/FR-3.2 ordering invariants.
19. **Established controller unit-test pattern** — `live-class-ownership.test.js` (and ~12 sibling files) do `jest.mock('../utils/prisma', () => ({ $queryRawUnsafe: jest.fn(), $executeRawUnsafe: jest.fn(), … }))` + `jest.mock('../sockets', …)` + `jest.mock('../utils/feedLive', …)` + `jest.mock('../services/queue.service', …)` + `jest.mock('../utils/logger', …)` + `require('../controllers/live-class.controller')` + a `makeRes()` helper + a `stubPublicLc()` that sets `prisma.$queryRawUnsafe.mockResolvedValue([{ stream_type: 'PUBLIC', … }])`. Confirms the Issue 5 controller-dispatch test is **feasible** via this pattern (Finding 1 is about under-specification, not infeasibility).
20. **`_prisma_migrations` structure / `migrate deploy` behavior** — the eight-column structure (`id`, `checksum`, `finished_at`, `migration_name`, `logs`, `rolled_back_at`, `started_at`, `applied_steps_count`), the absence of `migration_type`, `checksum` being NOT NULL, and `migrate deploy` refusing (not re-executing SQL) on an unresolved failed row are all consistent with the requirements' confirmed findings (FR-1.1, FR-1.3, Assumption 3) and standard Prisma 5.22.0 behavior; not independently re-derived against a running database.

## Unverified / Wrong Assumptions

1. **WRONG — "byte-for-byte copies" (Issue 2).** The proposed trigger bodies are not byte-for-byte with 20261030; the inline `-- Block:` comments are stripped. Invariants are preserved. → Finding 2.
2. **WRONG/UNDER-SPECIFIED — "mock `rawUpdateLiveClassStatus` to throw" (Issue 5).** `rawUpdateLiveClassStatus` (and `rawFindLiveClass`, `ensureProtectedScheduledMicrophoneMode`, `assertSchoolAccess`) are same-file functions, not mockable modules; the feasible mechanism is to mock the `prisma` singleton. Mocking `isTriggerLegacyStartRejection` also makes the test vacuous vs AC 4/5. → Finding 1.
3. **IMPRECISE — "`rawCreateLiveClass` always sets … SFU_AUTHORITATIVE" (Issue 3).** It uses `||`, so a caller may pass `LEGACY`. The load-bearing claim (column always explicit) is correct. → Finding 3.

---

## Verdict

**CHANGES_REQUESTED** — 1 MEDIUM finding (Issue 5 controller-dispatch unit test). The remaining findings are NITs. Once Finding 1 is resolved with the concrete prisma-mock approach (and the helper is left un-mocked so the real detection path is exercised), the design is implementable as written; the other four items are accuracy/clarity fixes that do not block.
