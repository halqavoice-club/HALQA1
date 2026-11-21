> **Note:** This requirements document was generated from a workflow template. The `{{task}}` placeholder in this document refers to the original user request (PROMPT 0 — CREATE THE SIX GITHUB ISSUES) which was provided as the message body. The placeholder was not substituted at generation time; the full specification is the message body. See `.agents/tasks/migration-20261030-audit-report.md` for the authoritative context.

# Requirements: Migration 20261030 Recovery, Trigger Safety, and Microphone Authorization Consistency

**Repository:** `halqavoice-club/HALQA1`  
**Baseline:** `main` HEAD `e15dad23a8333667f895d4e3649f0f47bd3696c6` (PR #161 merged)  
**Scope:** Six narrowly scoped GitHub issues covering production recovery, trigger idempotency, database default reconciliation, Prisma default verification, HTTP error handling, and test helper hygiene — all arising from the migration `20261030_fix_live_class_microphone_triggers` audit series.

> **Note on task interpretation.** The user request is `{{task}}` — a template placeholder that was never substituted. The original message provides the complete specification as "PROMPT 0 — CREATE THE SIX GITHUB ISSUES." This requirements document treats that specification as authoritative and derives testable requirements from it. The design step will determine how these requirements are fulfilled in the codebase and in GitHub.

---

## Summary

Three independent audit reports (`migration-20261030-audit-report.md`, `migration-20261030-recovery-audit.md`, `migration-20261030-final-recovery-audit.md`, `migration-20261030-rehearsal-validation.md`) have produced a body of verified findings about migration `20261030_fix_live_class_microphone_triggers`. The findings are:

1. The migration's SQL is correct and CI-proven, but its recovery runbook is incomplete and contains errors that would lead operators into unsafe recovery paths.
2. `live_classes_legacy_start_guard` is created with a bare `CREATE TRIGGER` (no preceding `DROP TRIGGER IF EXISTS`), making the migration non-idempotent for that trigger and creating a recoverable-but-hazardous failure path in scenario E.
3. `schema.prisma` declares `@default(SFU_AUTHORITATIVE)` but `20261030` sets the DB column default to `LEGACY`; this mismatch is functionally inert for Prisma ORM creates but is observable for raw-SQL INSERTs that omit the column.
4. No executable test verifies what Prisma Client 5.22.0 actually stores when `microphoneAuthorizationMode` is omitted from a `create()` call.
5. `startLiveClass` passes database trigger `SIGNAL` errors (SQLSTATE 45000) to Express as generic 500 responses, with no business-rule-aware handling.
6. `rawInsertLC` and similar raw-SQL test helpers do not set `microphone_authorization_mode`, silently depending on the DB column default.

The six issues below address each finding. Each issue is scoped to a single concern and is independently deliverable.

---

## Issue 1 — P1: Document Migration 20261030 Production Recovery Runbook

### Context

Three audit cycles identified errors in prior recovery guidance. The final rehearsal validation audit (`migration-20261030-rehearsal-validation.md`) corrected two categories of errors: (a) the prior recovery matrix incorrectly described naive `migrate deploy` behavior against an unresolved failed migration, and (b) the prior report's proposed manual `INSERT INTO _prisma_migrations` is invalid (references a non-existent `migration_type` column and passes `NULL` for the `NOT NULL` `checksum` column). No authoritative operator reference consolidates the corrected findings.

### Functional Requirements

- **FR-1.1** The runbook must document the eight-column `_prisma_migrations` structure for Prisma 5.22.0 with MySQL/MariaDB: `id`, `checksum`, `finished_at`, `migration_name`, `logs`, `rolled_back_at`, `started_at`, `applied_steps_count`. The column `migration_type` must be explicitly noted as non-existent.
- **FR-1.2** The runbook must define three `_prisma_migrations` row states for migration 20261030 and their distinguishing SQL signatures: failed (`finished_at IS NULL AND rolled_back_at IS NULL`), rolled-back (`rolled_back_at IS NOT NULL`), and applied (`finished_at IS NOT NULL`).
- **FR-1.3** The runbook must state that `npx prisma migrate deploy` **refuses** to advance when an unresolved failed migration row exists, and does **not** re-execute the SQL. It must not describe a naive retry as re-running the SQL.
- **FR-1.4** The runbook must cover these named scenarios for migration 20261030:
  - **Scenario A:** failure before Step 1 (ALTER DEFAULT) completes — recovery: `migrate resolve --rolled-back` then `migrate deploy`.
  - **Scenario B:** failure after Step 1, before Step 2 (DROP) — recovery: `migrate resolve --rolled-back` then `migrate deploy`.
  - **Scenario C:** failure after Step 2, before Step 3 (CREATE mode-guard) — recovery: `migrate resolve --rolled-back` then `migrate deploy` as soon as possible (unguarded window risk noted).
  - **Scenario D:** failure after Step 3, before Step 4 (CREATE start-guard) — recovery: `migrate resolve --rolled-back` then `migrate deploy`.
  - **Scenario E:** all four SQL statements committed; Prisma failed to write `finished_at` (e.g. connection drop after last DDL) — recovery: **`migrate resolve --applied`** after verifying both triggers are present and correct. `migrate resolve --rolled-back` must be identified as unsafe for this scenario because it schedules re-execution which then fails on the duplicate `live_classes_legacy_start_guard`.
  - **No-row scenario:** migration SQL was applied out-of-band; no `_prisma_migrations` row exists — recovery: verify objects, then `migrate resolve --applied` as the documented baselining mechanism.
- **FR-1.5** Each recovery path must specify: prerequisite diagnostic SQL (read-only), the exact recovery command, expected outcome, and stop conditions.
- **FR-1.6** The runbook must distinguish read-only diagnostic operations from state-changing recovery operations, using explicit labels.
- **FR-1.7** The runbook must state that direct `INSERT INTO _prisma_migrations` is not recommended, citing the two defects in the prior proposal (`migration_type` column does not exist; `checksum` is `NOT NULL`).
- **FR-1.8** The runbook must state that neither `UPDATE _prisma_migrations` nor fabricated row creation should be used as a first resort; `migrate resolve` is the documented tool.
- **FR-1.9** The runbook must document trigger verification SQL: `SELECT trigger_name, action_statement FROM information_schema.triggers WHERE trigger_schema = DATABASE() AND event_object_table = 'live_classes'`.
- **FR-1.10** The runbook must document database default verification SQL: `SHOW COLUMNS FROM live_classes LIKE 'microphone_authorization_mode'` with expected output `Default: LEGACY` after 20261030.
- **FR-1.11** No recovery operation may be presented as unconditionally safe. Each write operation must be gated on a prior read-only diagnostic.
- **FR-1.12** The historical migration file `20261030_fix_live_class_microphone_triggers/migration.sql` must remain byte-for-byte unchanged; the runbook must not instruct operators to edit it.

### Acceptance Criteria

1. The runbook document exists as a file in `docs/` or `.agents/` and is linked from the issue.
2. Each of the six named scenarios (A, B, C, D, E, no-row) is covered with its own section containing: diagnostic steps, recovery command(s), expected outcome, and stop conditions.
3. No scenario's recovery section recommends `migrate resolve --rolled-back` for scenario E (all SQL correct, `finished_at NULL`).
4. No scenario's recovery section recommends a direct `INSERT INTO _prisma_migrations`.
5. The document explicitly states `migration_type` is not a column in `_prisma_migrations`.
6. The document explicitly states that naive `migrate deploy` refuses (does not re-run SQL) when a failed row exists.
7. Every SQL statement in the document is labeled either "read-only diagnostic" or "state-changing — confirm prerequisites before executing."
8. The historical migration file is not modified.

---

## Issue 2 — P2: Harden the Microphone Trigger Migration Against Re-execution

### Context

`20261030_fix_live_class_microphone_triggers/migration.sql` creates `live_classes_legacy_start_guard` (Step 4) with a bare `CREATE TRIGGER` and no preceding `DROP TRIGGER IF EXISTS live_classes_legacy_start_guard`. If the trigger already exists when Steps 1–4 re-execute (scenario E recovery via `--rolled-back`, or scenario F with orphaned trigger), Step 4 fails with MariaDB error 1359 (`Trigger already exists`). The fix requires a **new, forward-only migration** — the historical file must not be edited because editing changes its checksum and causes Prisma drift.

### Functional Requirements

- **FR-2.1** A new migration file must be created after `20261030` in the directory ordering. It must not alter the content of `20261030_fix_live_class_microphone_triggers/migration.sql`.
- **FR-2.2** The new migration must issue `DROP TRIGGER IF EXISTS live_classes_legacy_start_guard` before re-creating it, making it fully idempotent for that trigger.
- **FR-2.3** The new migration must also issue `DROP TRIGGER IF EXISTS live_classes_microphone_mode_guard` before re-creating it (it already has this in 20261030, but re-establishing it in the new migration ensures a clean, known state).
- **FR-2.4** Both trigger bodies in the new migration must be identical to those in `20261030` — the authorization invariants (no downgrade; no LIVE LEGACY upgrade; no ENDED block; no LEGACY session start) must be preserved exactly.
- **FR-2.5** The new migration must be rehearsed against a disposable MariaDB 10.11 container before merging.
- **FR-2.6** Re-execution of the new migration (simulating a retry scenario) must be tested and verified not to produce "Trigger already exists."
- **FR-2.7** Partial-execution behavior of the new migration must be documented: at which step does the migration become non-idempotent, if at all, after the new `DROP IF EXISTS` statements are added.
- **FR-2.8** The new migration must not create any period in which both triggers are absent simultaneously. The sequence must be: DROP old, CREATE new (not: DROP both, then CREATE both).
- **FR-2.9** No production authorization regression is permitted: the trigger semantics after the new migration must be functionally identical to those after `20261030`.

### Acceptance Criteria

1. A new migration file exists after `20261030` in `backend/prisma/migrations/` with a later lexicographic name.
2. The new migration includes `DROP TRIGGER IF EXISTS live_classes_legacy_start_guard` before `CREATE TRIGGER live_classes_legacy_start_guard`.
3. The historical `20261030` migration file is byte-for-byte unchanged (verified by checksum comparison).
4. Running the new migration twice against a clean MariaDB 10.11 database succeeds both times without "Trigger already exists."
5. After the new migration, `SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'live_classes'` returns exactly `live_classes_microphone_mode_guard` and `live_classes_legacy_start_guard`.
6. All 12 tests in `liveclass-microphone-triggers.integration.test.js` continue to pass after the new migration.
7. The rehearsal result (disposable container log) is attached to the PR or issue.

---

## Issue 3 — P2: Reconcile the Database Microphone Authorization Default

### Context

After `20261030`, the `live_classes.microphone_authorization_mode` column has `DEFAULT 'LEGACY'` at the database level, but `schema.prisma` declares `@default(SFU_AUTHORITATIVE)`. Prisma Client always sends `@default` in the INSERT payload so the DB default is never observed through Prisma ORM creates. However, raw-SQL INSERTs that omit the column (e.g. `rawInsertLC` in `live-class.integration.test.js`) receive `LEGACY` from the DB default, and `prisma migrate dev` reports schema drift. The mismatch is a maintenance hazard and a source of confusion.

The resolution direction must be determined by investigating all creation paths before writing the migration. Two viable options exist: align the DB default to `SFU_AUTHORITATIVE` (match the schema) or align `schema.prisma` `@default` to `LEGACY` (match the DB and the migration comment). The migration comment in `20261030` states the LEGACY default was intentional for test compatibility, suggesting alignment toward LEGACY is the safer option — but this must be confirmed.

### Functional Requirements

- **FR-3.1** Before writing the migration, audit all creation paths that could observe the DB column default: (a) Prisma Client `create()` with field omitted, (b) raw-SQL INSERTs in test helpers (`rawInsertLC` in `live-class.integration.test.js`, `live-class-real-db.test.js` if applicable, `fix-live-class-columns.js`), (c) any seed script.
- **FR-3.2** The migration must be forward-only. It must not alter the historical `20261029` or `20261030` migration files.
- **FR-3.3** The migration must not rewrite existing `microphone_authorization_mode` values in existing rows. Only the column's `DEFAULT` clause may change.
- **FR-3.4** The migration must be verified against MariaDB 10.11 (not SQLite or PostgreSQL) using `SHOW COLUMNS FROM live_classes LIKE 'microphone_authorization_mode'` to confirm the resulting default.
- **FR-3.5** If the DB default is changed to `SFU_AUTHORITATIVE`, `schema.prisma` must remain unchanged (it already declares `@default(SFU_AUTHORITATIVE)`). If the DB default is left as `LEGACY`, `schema.prisma @default` must be updated to `LEGACY` to eliminate the drift.
- **FR-3.6** Application behavior — specifically `startLiveClass`, `createLiveClass`, and `ensureProtectedScheduledMicrophoneMode` — must be verified compatible with whichever default is chosen.
- **FR-3.7** Test helpers that rely on the DB default to produce a specific mode must be updated to set the column explicitly (this overlaps with Issue 6; the two issues may cross-reference but each retains its own scope).

### Acceptance Criteria

1. A new forward-only migration exists that changes only the `DEFAULT` clause of `microphone_authorization_mode`.
2. `SHOW COLUMNS FROM live_classes LIKE 'microphone_authorization_mode'` after the migration returns a `Default` value consistent with `schema.prisma @default`.
3. `npx prisma migrate dev` reports no drift after the migration is applied.
4. No existing row's `microphone_authorization_mode` value is changed by the migration (verified by row-count query before and after).
5. The 333-test CI suite (`Backend -- Integration Tests (MariaDB 10.11)`) remains green.
6. Historical migration files `20261029` and `20261030` are byte-for-byte unchanged.

---

## Issue 4 — P2: Add an Isolated Prisma Default-Behavior Integration Test

### Context

All 12 `prisma.liveClass.create()` calls in `liveclass-microphone-triggers.integration.test.js` supply `microphoneAuthorizationMode` explicitly. No test omits the field and asserts the persisted value. The claim that "Prisma Client sends `@default` in the INSERT regardless of the DB column default" rests on a code comment (line 316–319) and Prisma documentation, but has never been verified as an executable assertion against a real database in this codebase. This test gap is a P2 evidence gap — not a production blocker, but it means the default reconciliation work in Issue 3 has no regression signal.

### Functional Requirements

- **FR-4.1** The test must run against a real MariaDB 10.11 database with both `20261029` and `20261030` applied (using `npx prisma migrate deploy` via the standard CI path, not an in-memory substitute).
- **FR-4.2** The test must use Prisma Client at the pinned version `5.22.0` (as declared in `backend/package.json`).
- **FR-4.3** The test must include exactly four cases:
  - **Case 1:** `prisma.liveClass.create()` with `microphoneAuthorizationMode` omitted — read back the persisted value and assert it equals `SFU_AUTHORITATIVE` (the Prisma `@default`).
  - **Case 2:** `prisma.liveClass.create()` with `microphoneAuthorizationMode: 'SFU_AUTHORITATIVE'` explicitly — read back and assert `SFU_AUTHORITATIVE`.
  - **Case 3:** Raw SQL INSERT omitting `microphone_authorization_mode` — read back and assert the value equals the DB column default (expected: `LEGACY` after `20261030`; expected: `SFU_AUTHORITATIVE` after the reconciliation migration from Issue 3 if that changes the default).
  - **Case 4:** Raw SQL INSERT with explicit `microphone_authorization_mode = 'SFU_AUTHORITATIVE'` — read back and assert `SFU_AUTHORITATIVE`.
- **FR-4.4** For Case 1, the test must capture or observe the emitted INSERT SQL (via Prisma query logging) and assert that the INSERT contains the literal `SFU_AUTHORITATIVE` value, confirming the default is applied client-side.
- **FR-4.5** The test must clean up all created rows in `afterEach` or `afterAll` without touching rows created by other test cases.
- **FR-4.6** The test must be deterministic: running it twice against the same database schema must produce the same result.
- **FR-4.7** The test must be located in `backend/src/tests/integration/` and must run as part of the existing `npm run test:integration` suite.

### Acceptance Criteria

1. A new test file exists in `backend/src/tests/integration/` or test cases are added to `liveclass-microphone-triggers.integration.test.js`.
2. Case 1 asserts that omitting `microphoneAuthorizationMode` from a Prisma `create()` stores `SFU_AUTHORITATIVE` (not the DB default).
3. Case 3 asserts that a raw-SQL INSERT omitting the column stores the DB column default.
4. The test passes on the first run and passes again on a second run without manual cleanup.
5. No pre-existing test data is altered by cleanup.
6. The test passes in CI against `mariadb:10.11` with both `20261029` and `20261030` applied.

---

## Issue 5 — P2: Return HTTP 409 for Microphone Trigger Authorization Rejection in `startLiveClass`

### Context

`startLiveClass` in `backend/src/controllers/live-class.controller.js` (line ~842) wraps the entire operation in `try { ... } catch (e) { next(e); }`. When `rawUpdateLiveClassStatus` triggers a database `SIGNAL SQLSTATE '45000'`, the error is passed to Express's generic error handler as an unclassified exception, producing a 500 response. The specific message text from the trigger is `'Cannot start LEGACY session; upgrade microphone_authorization_mode to SFU_AUTHORITATIVE first'`. This is a business-rule violation (the caller sent a valid request but the authorization state prevents the action), which should produce HTTP 409 Conflict, not 500.

The `ensureProtectedScheduledMicrophoneMode` function should prevent the trigger from firing in the normal path. The trigger is a defense-in-depth backstop. The 409 handling is needed for cases where `ensureProtectedScheduledMicrophoneMode` fails silently (it is wrapped in a non-fatal try/catch) or is bypassed.

### Functional Requirements

- **FR-5.1** `startLiveClass` must catch database errors from `rawUpdateLiveClassStatus` and inspect them for the specific trigger rejection message `'Cannot start LEGACY session; upgrade microphone_authorization_mode to SFU_AUTHORITATIVE first'`.
- **FR-5.2** When that specific message is detected, the controller must return HTTP 409 with a user-facing error message that does not expose the raw SQL, database internals, or the SQLSTATE code.
- **FR-5.3** All other database errors from `rawUpdateLiveClassStatus` must continue to produce HTTP 500 (via `next(e)`). The 409 path must be narrow: only the recognized trigger message maps to 409.
- **FR-5.4** The trigger message string used for detection must be extracted into a named constant (in `utils/liveClassMicrophoneContract.js` or equivalent) so that it stays in sync with the trigger definition if either changes.
- **FR-5.5** No raw SQL text, SQLSTATE value, trigger name, or database error code may appear in the HTTP response body.
- **FR-5.6** The fix must not alter the behavior of `ensureProtectedScheduledMicrophoneMode` or the success path of `startLiveClass`.

### Non-Functional Requirements

- The detection logic must be testable without a real database — a unit test may inject a fake error with the matching message.

### Acceptance Criteria

1. `startLiveClass` returns HTTP 409 when the database raises an error containing `'Cannot start LEGACY session; upgrade microphone_authorization_mode to SFU_AUTHORITATIVE first'`.
2. `startLiveClass` returns HTTP 500 (via `next(e)`) for database errors that do not contain that message.
3. The HTTP 409 response body does not contain "SQLSTATE", "45000", "trigger", or any raw SQL fragment.
4. A controller-level unit test covers the 409 path by injecting a mock error with the trigger message text.
5. A controller-level unit test covers the 500 path by injecting an unrelated database error.
6. No existing test for `startLiveClass` is broken by the change.

---

## Issue 6 — P2: Make Microphone Trigger Test Helpers Explicit

### Context

`rawInsertLC` in `backend/src/tests/integration/live-class.integration.test.js` (line ~139) performs a raw `INSERT INTO live_classes` that omits `microphone_authorization_mode`. After migration `20261030`, this produces a `LEGACY` value from the DB column default. This is currently accidental — the test helpers were not updated when the microphone authorization column was added in `20261029`. The helpers' tests depend on the DB column default being `LEGACY`, but that default may change when Issue 3 (default reconciliation) is resolved. If the default changes to `SFU_AUTHORITATIVE`, any test that relies on the implicit default for scenario setup (e.g. a test that expects to start a class and have it be LEGACY) will silently test the wrong thing.

Additionally, `live-class.integration.test.js` line ~285 creates a `SCHEDULED` class via `rawInsertLC` and then calls `POST /start`. That test goes through `ensureProtectedScheduledMicrophoneMode`, which upgrades LEGACY→SFU before starting, so the implicit LEGACY default is load-bearing for the test's setup path.

### Functional Requirements

- **FR-6.1** Every `rawInsertLC` call that creates a row used in a test scenario that depends on the microphone authorization mode must pass `microphone_authorization_mode` explicitly.
- **FR-6.2** The `rawInsertLC` function signature must accept a `microphoneAuthorizationMode` parameter. The INSERT statement must include the `microphone_authorization_mode` column when the parameter is provided.
- **FR-6.3** For test scenarios that intentionally test LEGACY behavior (e.g. the SUPER_ADMIN start test at line ~285 which exercises `ensureProtectedScheduledMicrophoneMode`), the helper call must explicitly pass `microphoneAuthorizationMode: 'LEGACY'`.
- **FR-6.4** For test scenarios that intentionally test SFU behavior, the helper call must explicitly pass `microphoneAuthorizationMode: 'SFU_AUTHORITATIVE'`.
- **FR-6.5** For test scenarios where microphone mode is irrelevant (e.g. tests covering non-start operations that do not trigger mode guards), the parameter may be omitted — but the resulting inserted value must not cause the test to fail when the DB default changes from LEGACY to SFU_AUTHORITATIVE. If the test scenario is indifferent to mode, the helper should default to `SFU_AUTHORITATIVE` (since that is what the application always creates) unless the test specifically needs LEGACY.
- **FR-6.6** No production code may be modified by this change. The scope is strictly test helpers and test call sites.
- **FR-6.7** After this change, the entire integration suite must remain green whether the DB default is `LEGACY` or `SFU_AUTHORITATIVE`.

### Acceptance Criteria

1. `rawInsertLC` accepts a `microphoneAuthorizationMode` parameter and includes it in the INSERT when provided.
2. Every `rawInsertLC` call in `live-class.integration.test.js` either (a) explicitly passes the authorization mode appropriate for the test scenario, or (b) is documented with a comment explaining why the mode is irrelevant for that test.
3. No test's intended scenario is changed by the update — tests that previously tested LEGACY behavior continue to test LEGACY behavior.
4. The full integration suite passes against MariaDB 10.11 after this change.
5. No `rawInsertLC` call relies on the implicit DB column default to establish a mode-dependent test state.
6. No production files (`controllers/`, `services/`, `routes/`, `middleware/`) are touched.

---

## Out of Scope

- Implementing any of the six items above (this document is requirements only).
- Changes to the existing `20261030_fix_live_class_microphone_triggers/migration.sql` or `20261029_add_live_class_microphone_authority/migration.sql`. Both must remain byte-for-byte unchanged.
- Changes to the Voice Club feature, live streams, social feed, or any domain outside live class microphone authorization.
- Prisma version upgrades.
- Deployment of migrations to any environment.
- Creating branches, commits, or deploying code — the GitHub issue task is issue creation only.
- Changes to LiveKit session management or the broader `startLiveClass` flow beyond the HTTP 409 handling in FR-5.

---

## Assumptions

1. **Placeholder task.** The user request contained `{{task}}` (unsubstituted template). The intent is taken from the full original message (PROMPT 0 — CREATE THE SIX GITHUB ISSUES), which is detailed and self-contained.
2. **Issue-creation vs. implementation.** PROMPT 0 explicitly scopes the immediate task to opening GitHub issues. These requirements document what each issue must cover. The design step will determine whether the deliverable is issue content, implementation code, or both.
3. **`_prisma_migrations` structure confirmed.** The eight-column structure (`id`, `checksum`, `finished_at`, `migration_name`, `logs`, `rolled_back_at`, `started_at`, `applied_steps_count`) is confirmed by the rehearsal validation report's multi-source evidence. `migration_type` does not exist.
4. **`rawInsertLC` body confirmed.** Verified by reading `live-class.integration.test.js` lines 139–157: the INSERT does not include `microphone_authorization_mode`. All calls to `rawInsertLC` confirmed by grep.
5. **`startLiveClass` error handling confirmed.** Verified by reading `live-class.controller.js` lines 842–882: the catch block is `catch (e) { next(e); }` with no SQLSTATE/trigger-error inspection.
6. **Migration SQL confirmed.** `20261030_fix_live_class_microphone_triggers/migration.sql` read in full: Step 4 is a bare `CREATE TRIGGER` with no preceding `DROP TRIGGER IF EXISTS live_classes_legacy_start_guard`.
