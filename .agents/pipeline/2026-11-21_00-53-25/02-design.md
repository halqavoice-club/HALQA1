# Technical Design: Migration 20261030 Recovery, Trigger Safety, and Microphone Authorization Consistency

**Repository:** `halqavoice-club/HALQA1`  
**Baseline:** `main` HEAD `e15dad23a8333667f895d4e3649f0f47bd3696c6` (PR #161)  
**Requirement document:** `01-requirements.md` in this pipeline run  
**Design scope:** Six GitHub issues covering production recovery runbook, trigger idempotency migration, database default reconciliation migration, Prisma default integration test, HTTP 409 handling, and test helper hygiene.  
**Revision:** This document addresses all 13 findings from the first design-review pass and the 3 findings from the current loop-back review (`design-review.json`, `03-design-review.md`).

---

## Overview

The six issues all stem from the same migration audit chain. Each is independently deliverable, but they share dependencies: the runbook (Issue 1) must be written before operators act; the trigger-hardening migration (Issue 2) must land before the default-reconciliation migration (Issue 3), because Issue 3 depends on a known, stable trigger state; the Prisma default test (Issue 4) produces evidence that informs whether Issue 3 changes `SFU_AUTHORITATIVE` → `LEGACY` or the reverse; the HTTP 409 fix (Issue 5) is independent of all migrations; and the test-helper fix (Issue 6) must be coordinated with whichever default Issue 3 chooses so test scenarios remain valid.

The deliverable for all six issues is **GitHub issue content** (bodies, labels, referenced file paths). The design below specifies the exact implementation each issue should describe: the files to touch, the SQL to write, the code changes to make, and the test assertions to add. This level of concreteness enables an implementer to act on each issue without making architectural decisions.

---

## Issue 1 — Production Recovery Runbook

### Where the file lives

The runbook is a new Markdown file at `docs/live-class/migration-20261030-recovery-runbook.md`. This path fits the existing `docs/live-class/` subdirectory used for live class documentation. It is not placed under `.agents/tasks/` because `.agents/` holds audit artifacts rather than operator references.

### Structure

The file opens with a one-paragraph executive summary stating: (a) the migration name, (b) what it does (four SQL statements in order: ALTER DEFAULT, DROP MG, CREATE MG, CREATE SG), (c) that historical migration files must not be edited, and (d) that all recovery uses `migrate resolve`, never a direct `INSERT INTO _prisma_migrations`.

It then has these sections in order:

**`_prisma_migrations` schema reference.** A table of the eight actual columns: `id`, `checksum`, `finished_at`, `migration_name`, `logs`, `rolled_back_at`, `started_at`, `applied_steps_count`. An explicit note that `migration_type` does **not** exist. A table of the three row states for 20261030:

| State | `finished_at` | `rolled_back_at` | Meaning |
|---|---|---|---|
| Failed | NULL | NULL | Partially applied; unresolved |
| Rolled-back | NULL | NOT NULL | Marked for re-application |
| Applied | NOT NULL | NULL | Fully applied |

**Key behavior.** A boxed note stating: "`npx prisma migrate deploy` **refuses** (does not re-execute SQL) when an unresolved failed migration row exists. It prints a 'migration failed — recover it' message. The duplicate-trigger error only appears if the operator chooses `--rolled-back` for a scenario-E state and then runs `migrate deploy`."

**Read-only diagnostic SQL block.** Two queries labeled "READ-ONLY DIAGNOSTIC — may run at any time":

```sql
-- 1. Migration record state
SELECT migration_name, finished_at, rolled_back_at, started_at, logs
FROM _prisma_migrations
WHERE migration_name = '20261030_fix_live_class_microphone_triggers';

-- 2. Trigger inventory (must return both rows in a healthy state)
SELECT trigger_name, action_timing, event_manipulation, action_statement
FROM information_schema.triggers
WHERE trigger_schema = DATABASE() AND event_object_table = 'live_classes';

-- 3. Column default
SHOW COLUMNS FROM live_classes LIKE 'microphone_authorization_mode';
```

**Scenario sections A–E plus No-Row**, each containing: prerequisite diagnostic (which query to run and what result to expect), recovery command (labeled "STATE-CHANGING — verify prerequisites before executing"), expected outcome, and stop conditions.

| Scenario | Recovery command | Notes |
|---|---|---|
| A (fails before Step 1 completes) | `--rolled-back` then `migrate deploy` | ALTER is idempotent; re-run is safe |
| B (Step 1 done, Step 2 fails) | `--rolled-back` then `migrate deploy` | DROP IF EXISTS handles MG idempotently |
| C (Step 2 done, Step 3 fails) | `--rolled-back` then `migrate deploy` **ASAP** | Mode-guard trigger absent; risk window noted; `ensureProtectedScheduledMicrophoneMode` is defense-in-depth |
| D (Step 3 done, Step 4 fails) | `--rolled-back` then `migrate deploy` | SG was never created; DROP IF EXISTS drops MG; CREATE MG, CREATE SG succeed |
| E (all SQL done, `finished_at` NULL) | `--applied` **after** verifying both triggers present and correct | Do **not** use `--rolled-back`; it schedules re-execution that fails at Step 4 |
| No-row (SQL applied out-of-band) | `--applied` as a baselining operation | No failed row is required; `migrate resolve --applied` inserts a new row (documented Prisma baselining mechanism). No prior failed row is needed for this command. |

Scenario E explicitly states: "Do not use `--rolled-back` for this scenario. `--rolled-back` marks the migration for re-application. `migrate deploy` will then re-execute all four statements and fail at Step 4 (`CREATE TRIGGER live_classes_legacy_start_guard`) with MariaDB error 1359 'Trigger already exists', because that trigger was already created in Step 4 of the first (complete) execution and is not idempotently dropped."

**Anti-patterns box.** States that the following are not recommended:
- `INSERT INTO _prisma_migrations` — the column `migration_type` does not exist in Prisma 5.22.0's `_prisma_migrations` table, and `checksum` is NOT NULL; prior proposals using this form are invalid.
- `UPDATE _prisma_migrations SET finished_at = ...` as a first resort — `migrate resolve` is the documented tool.
- Editing `20261030_fix_live_class_microphone_triggers/migration.sql` — changes the checksum, causes Prisma drift.

**Decision tree diagram.** A compact ASCII decision tree:

```
START: does a 20261030 row exist in _prisma_migrations?
│
├─ NO → verify triggers and default → resolve --applied (baselining; inserts new row)
│
└─ YES → check finished_at and rolled_back_at
         │
         ├─ finished_at IS NOT NULL → migration already applied; no action needed
         │
         ├─ rolled_back_at IS NOT NULL → already marked for re-apply
         │   └─ check for orphaned SG trigger → if SG exists, DROP it → migrate deploy
         │
         └─ both NULL (failed row)
             │
             ├─ verify: are BOTH triggers correct AND default is LEGACY?
             │   └─ YES → resolve --applied (scenario E)
             │
             └─ NO (partial state) → resolve --rolled-back → migrate deploy (scenarios A–D)
```

### Error handling in the runbook

Each command that mutates state has an "if this command fails" note:
- `migrate resolve` failure: check that the migration name is spelled exactly right; check that the row exists in the failed state.
- `migrate deploy` failure at Step 4 "Trigger already exists": operator chose `--rolled-back` for a scenario-E state; drop the orphaned SG trigger with `DROP TRIGGER IF EXISTS live_classes_legacy_start_guard`, then re-run `migrate deploy`.

---

## Issue 2 — Trigger-Hardening Migration

### Migration file placement and naming

New file: `backend/prisma/migrations/20261115_harden_microphone_trigger_idempotency/migration.sql`.

The date `20261115` is chosen as a value lexicographically after `20261114_add_post_report_pending_unique` (the current last migration) and before any future migrations. The implementer should use whatever date is current on their branch; the invariant is that the new migration's directory name sorts after `20261114`. The historical `20261030` file must not be touched.

### SQL content

```sql
-- Migration: 20261115_harden_microphone_trigger_idempotency
--
-- Adds DROP TRIGGER IF EXISTS guards before each trigger CREATE so that the
-- trigger creation step is fully idempotent. Historical migration 20261030 is
-- not modified; this migration is forward-only.
--
-- Authorization invariants are preserved identically:
--   - SFU_AUTHORITATIVE → LEGACY downgrade is blocked.
--   - LIVE LEGACY → SFU_AUTHORITATIVE upgrade is blocked.
--   - Non-SCHEDULED, non-ENDED, non-LIVE mode changes are blocked.
--   - SCHEDULED LEGACY → LIVE status transition is blocked.

-- ─── Trigger 1: mode-change guard ────────────────────────────────────────────
DROP TRIGGER IF EXISTS `live_classes_microphone_mode_guard`;

CREATE TRIGGER `live_classes_microphone_mode_guard`
BEFORE UPDATE ON `live_classes`
FOR EACH ROW
BEGIN
  IF OLD.`microphone_authorization_mode` = 'SFU_AUTHORITATIVE'
     AND NEW.`microphone_authorization_mode` = 'LEGACY' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Cannot downgrade from SFU_AUTHORITATIVE to LEGACY';
  END IF;

  IF OLD.`status` = 'LIVE'
     AND OLD.`microphone_authorization_mode` = 'LEGACY'
     AND NEW.`microphone_authorization_mode` <> 'LEGACY' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Cannot upgrade active LIVE session microphone_authorization_mode';
  END IF;

  IF OLD.`status` NOT IN ('SCHEDULED', 'LIVE', 'ENDED')
     AND OLD.`microphone_authorization_mode` <> NEW.`microphone_authorization_mode` THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'microphone_authorization_mode can only be changed in SCHEDULED or ENDED status';
  END IF;
END;

-- ─── Trigger 2: start guard ───────────────────────────────────────────────────
DROP TRIGGER IF EXISTS `live_classes_legacy_start_guard`;

CREATE TRIGGER `live_classes_legacy_start_guard`
BEFORE UPDATE ON `live_classes`
FOR EACH ROW
BEGIN
  IF NEW.`status` = 'LIVE'
     AND OLD.`status` <> 'LIVE'
     AND NEW.`microphone_authorization_mode` = 'LEGACY' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Cannot start LEGACY session; upgrade microphone_authorization_mode to SFU_AUTHORITATIVE first';
  END IF;
END;
```

The trigger bodies are byte-for-byte copies of the bodies in `20261030_fix_live_class_microphone_triggers/migration.sql` (Steps 3 and 4). The only additions are the two `DROP TRIGGER IF EXISTS` lines.

### Partial-execution behavior

The new migration has four statements: DROP MG, CREATE MG, DROP SG, CREATE SG.

- If it fails after DROP MG and before CREATE MG: the mode-guard is absent. Recovery is `--rolled-back` then `migrate deploy` (re-execution is safe: DROP IF EXISTS on an absent trigger is a no-op; CREATE MG and the subsequent DROP SG / CREATE SG succeed).
- If it fails after CREATE MG and before DROP SG: MG is correct, SG still exists from 20261030. Recovery is `--rolled-back` then `migrate deploy` (DROP SG drops it; CREATE SG recreates it).
- If it fails after DROP SG and before CREATE SG: SG absent, MG correct. Recovery is `--rolled-back` then `migrate deploy`.
- If all four complete but `finished_at` is not set (scenario E for this migration): `--applied` after verifying both triggers.

Crucially, **re-execution at any point is fully safe** because both CREATE statements are preceded by DROP IF EXISTS. This is the core property this migration adds.

### Rehearsal requirement in the issue

The issue must require a rehearsal log attached to the PR. The rehearsal procedure is:

1. `docker run -d --name mic-trig-test -e MYSQL_ROOT_PASSWORD=test -e MYSQL_DATABASE=halqa_test mariadb:10.11`
2. `npx prisma migrate deploy` to apply all migrations through `20261030`.
3. Apply the new migration.
4. Simulate re-execution by marking the migration for re-application. Because this manipulates `_prisma_migrations` directly, it must only be done in a **disposable rehearsal container** — this exact operation must never be used on a production or staging database. On real databases use `prisma migrate resolve` as documented in Issue 1.

   ```sql
   -- DISPOSABLE REHEARSAL CONTAINER ONLY. Never run on production or staging.
   UPDATE _prisma_migrations
   SET finished_at = NULL, rolled_back_at = NOW()
   WHERE migration_name = '20261115_harden_microphone_trigger_idempotency';
   ```

   Then run `npx prisma migrate deploy`. Verify success and no "Trigger already exists" error.

5. Run `SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'live_classes'` — expect exactly `live_classes_microphone_mode_guard` and `live_classes_legacy_start_guard`.
6. Run the 12-test suite `src/tests/integration/liveclass-microphone-triggers.integration.test.js` — all tests must pass.
7. `docker rm -f mic-trig-test`.

### Checksum verification

The issue must require a checksum comparison to confirm `20261030` is unchanged. Before creating the branch, the implementer runs:

```bash
sha256sum backend/prisma/migrations/20261030_fix_live_class_microphone_triggers/migration.sql
```

on `main` HEAD `e15dad23a8333667f895d4e3649f0f47bd3696c6` and pastes the result into the issue body. The PR reviewer re-runs the same command on the final branch and confirms it matches. The reference checksum lives in the **issue body** (not in a migration comment) so it is immutable once the issue is filed.

---

## Issue 3 — Database Default Reconciliation

### Decision on direction

The requirements identify two options (align DB default to `SFU_AUTHORITATIVE` or change `schema.prisma @default` to `LEGACY`) and state the migration comment in `20261030` says the LEGACY default was intentional for test compatibility. The final-recovery-audit also confirms the production create path (`rawCreateLiveClass` at `live-class.controller.js:50–52,90`) always sets `microphone_authorization_mode` explicitly to `MICROPHONE_AUTHORIZATION_MODES.SFU_AUTHORITATIVE`, so the DB default is never observed in the production path. The correct direction is therefore **align the DB default to `SFU_AUTHORITATIVE`** (match `schema.prisma`), because:

1. The production path explicitly sets the value; the DB default is not load-bearing for new rows.
2. `schema.prisma @default(SFU_AUTHORITATIVE)` reflects the product intent (all new classes should be SFU-ready).
3. Changing `schema.prisma @default` to `LEGACY` would require Prisma client regeneration and would diverge from the product's intent without a customer-facing reason.
4. The only consumer of the LEGACY DB default is raw-SQL test helpers that omit the column — which Issue 6 fixes by making those helpers explicit. After Issue 6, nothing depends on the DB default being LEGACY.

This decision must be noted in the issue, with the dependency on Issue 6 called out.

### Migration file

New file: `backend/prisma/migrations/20261116_reconcile_microphone_authorization_default/migration.sql`.

The filename `20261116` is illustrative. The implementer must use the current date when creating the migration; the invariant is that this migration sorts lexicographically after Issue 2's migration (which itself sorts after `20261114`).

```sql
-- Migration: 20261116_reconcile_microphone_authorization_default
--
-- Aligns the database column default for microphone_authorization_mode with
-- the Prisma schema @default(SFU_AUTHORITATIVE). This eliminates the drift
-- reported by `prisma migrate dev`.
--
-- Existing row values are NOT changed — only the column's DEFAULT clause.
-- This migration is safe to apply to production:
--   - The production create path (rawCreateLiveClass) always sets the column
--     explicitly to SFU_AUTHORITATIVE; the DB default is never observed for
--     new rows through the application.
--   - Raw-SQL test helpers that relied on the implicit LEGACY default must be
--     updated (see Issue 6) before or alongside this migration.
--
-- Prerequisite: Issue 2's migration (20261115_harden_microphone_trigger_idempotency)
-- must be merged and applied before this migration. Prisma enforces this ordering
-- lexicographically as long as this migration's directory name sorts after Issue 2's.
-- The implementer must verify the directory names before creating the PR.

ALTER TABLE `live_classes`
  ALTER COLUMN `microphone_authorization_mode` SET DEFAULT 'SFU_AUTHORITATIVE';
```

The issue body must also explicitly state: "This migration must not be merged until `20261115_harden_microphone_trigger_idempotency` is merged and applied. Prisma enforces this ordering lexicographically as long as this migration's directory name sorts after Issue 2's. Verify the migration directory names before creating the PR."

The rehearsal procedure for Issue 3 must include a CI verification step: confirm Issue 2's migration `finished_at IS NOT NULL` before applying this migration in the rehearsal container.

### Validation

The issue must specify these post-migration verification queries:

```sql
-- Confirm default changed
SHOW COLUMNS FROM live_classes LIKE 'microphone_authorization_mode';
-- Expected: Default = SFU_AUTHORITATIVE

-- Confirm no existing row values changed
SELECT microphone_authorization_mode, COUNT(*) AS cnt
FROM live_classes
GROUP BY microphone_authorization_mode;
-- Compare with pre-migration snapshot; row counts must be identical
```

`npx prisma migrate dev` after this migration must report no drift.

### schema.prisma

No change required — `@default(SFU_AUTHORITATIVE)` is already correct.

### Error handling

The only failure mode is the `ALTER TABLE` failing. That is non-destructive (it only changes the default clause, not existing data). Recovery is `--rolled-back` then `migrate deploy`.

---

## Issue 4 — Prisma Default-Behavior Integration Test

### File location

New file: `backend/src/tests/integration/liveclass-microphone-default.integration.test.js`.

This follows the naming convention of other integration tests in that directory (`liveclass-microphone-triggers.integration.test.js`, `live-class.integration.test.js`).

### Import and client pattern

The test follows the **self-contained `PrismaClient` instance pattern** used by `liveclass-microphone-triggers.integration.test.js` — a single `PrismaClient` instance created in `beforeAll`, never importing the shared singleton from `utils/prisma`. This avoids connection-pool conflicts between the shared singleton and any per-test logging client. `bcrypt` is not imported; it is not needed for this test.

```js
'use strict';
const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

let prisma;

describe('SEC01-G-BE02 Prisma @default vs DB column default', () => {
  let testSchoolId, testTeacherId;
  const createdLcIds = [];
  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  beforeAll(async () => {
    prisma = new PrismaClient();
    // Create minimum fixtures: school + teacher.
    // School: `slug` is a required field (no @default) and unique; `country`
    // matches the working pattern in liveclass-microphone-triggers.integration.test.js.
    const school = await prisma.school.create({
      data: {
        name: `mic-default-test-school-${uid()}`,
        slug: `mic-default-${uid()}`,
        country: 'MY',
      },
    });
    testSchoolId = school.id;
    // Teacher: the User model uses `firstName`/`lastName` (both required String)
    // and `passwordHash` (the column name) — there is no `name` or `password`
    // field, so those would be rejected at the Prisma ORM layer before any
    // INSERT runs. `status` defaults to PENDING; ACTIVE + emailVerified are set
    // explicitly so any raw-SQL authorization path that checks `status = 'ACTIVE'`
    // does not reject the host.
    const teacher = await prisma.user.create({
      data: {
        firstName: 'MicDefault',
        lastName: 'Teacher',
        email: `mic-default-teacher-${uid()}@test.local`,
        passwordHash: 'hashed-not-real',
        role: 'TEACHER',
        status: 'ACTIVE',
        emailVerified: true,
      },
    });
    testTeacherId = teacher.id;
  }, 30000);

  afterAll(async () => {
    // Delete live class rows first (FK-safe order: live classes before users/schools)
    for (const id of createdLcIds) {
      await prisma.liveClass.delete({ where: { id } }).catch(() => {});
    }
    if (testTeacherId) await prisma.user.delete({ where: { id: testTeacherId } }).catch(() => {});
    if (testSchoolId) await prisma.school.delete({ where: { id: testSchoolId } }).catch(() => {});
    await prisma.$disconnect();
  });
```

The `createdLcIds` array is populated by every test case that creates a live class row. This prevents FK constraint violations in `afterAll` if a test's inline cleanup fails silently.

### Case 1 — Prisma create, field omitted

A second `PrismaClient` instance with query logging is created for Case 1 only, within the test body. This instance is disconnected within the test before the outer `prisma` client continues. The instances operate on separate connections but against the same database; this is the standard Prisma pattern for observing emitted SQL and does not conflict with the outer client.

Prisma 5.x query events expose the parameterized query template on `e.query` and the actual parameter values as a JSON string on `e.params`. The design captures and asserts against **`e.params`**, not `e.query`, because `e.query` contains placeholder `?` markers — the literal value `'SFU_AUTHORITATIVE'` appears in `e.params`. This satisfies FR-4.4 (confirm the INSERT contains the literal value client-side).

```js
  test('Case 1: Prisma create omitting microphoneAuthorizationMode stores SFU_AUTHORITATIVE', async () => {
    const capturedEvents = [];
    const loggingPrisma = new PrismaClient({
      log: [{ emit: 'event', level: 'query' }],
    });
    loggingPrisma.$on('query', (e) => capturedEvents.push({ query: e.query, params: e.params }));

    const lc = await loggingPrisma.liveClass.create({
      data: {
        title: `Default Test ${uid()}`,
        livekitRoomName: `default-test-${Date.now()}`,
        maxParticipants: 50,
        streamType: 'CLASS',
        status: 'SCHEDULED',
        schoolId: testSchoolId,
        hostUserId: testTeacherId,
        // microphoneAuthorizationMode intentionally omitted
      },
    });
    createdLcIds.push(lc.id);

    // Assert persisted value is SFU_AUTHORITATIVE (Prisma @default applied client-side)
    expect(lc.microphoneAuthorizationMode).toBe('SFU_AUTHORITATIVE');

    // Assert the Prisma client sent 'SFU_AUTHORITATIVE' as a parameter — it did not
    // leave the value to the DB column default.
    // e.params is a JSON string in Prisma 5.x, e.g. '["<uuid>","SFU_AUTHORITATIVE",...]'
    const insertEvent = capturedEvents.find(
      e => e.query.toLowerCase().includes('insert') && e.query.toLowerCase().includes('live_classes')
    );
    expect(insertEvent).toBeDefined();
    expect(insertEvent.params).toContain('SFU_AUTHORITATIVE');

    // Read back from DB via raw SQL to confirm storage independently of ORM return value
    const rows = await prisma.$queryRawUnsafe(
      'SELECT microphone_authorization_mode FROM live_classes WHERE id = ?', lc.id
    );
    expect(rows[0].microphone_authorization_mode).toBe('SFU_AUTHORITATIVE');

    await loggingPrisma.$disconnect();
  });
```

### Case 2 — Prisma create, field explicit

```js
  test('Case 2: Prisma create with explicit SFU_AUTHORITATIVE stores SFU_AUTHORITATIVE', async () => {
    const lc = await prisma.liveClass.create({
      data: {
        title: `Explicit SFU Test ${uid()}`,
        livekitRoomName: `explicit-sfu-${Date.now()}`,
        maxParticipants: 50,
        streamType: 'CLASS',
        status: 'SCHEDULED',
        schoolId: testSchoolId,
        hostUserId: testTeacherId,
        microphoneAuthorizationMode: 'SFU_AUTHORITATIVE',
      },
    });
    createdLcIds.push(lc.id);
    expect(lc.microphoneAuthorizationMode).toBe('SFU_AUTHORITATIVE');
    const rows = await prisma.$queryRawUnsafe(
      'SELECT microphone_authorization_mode FROM live_classes WHERE id = ?', lc.id
    );
    expect(rows[0].microphone_authorization_mode).toBe('SFU_AUTHORITATIVE');
  });
```

### Case 3 — Raw SQL INSERT, column omitted

Case 3 asserts the stored value against a **known expected value determined by which migrations are applied**, not against whatever `SHOW COLUMNS` returns. This prevents the tautological trap where the test adapts to any default and can never fail. The expected value is derived by checking whether the reconciliation migration (Issue 3) has been applied:

```js
  test('Case 3: raw SQL INSERT omitting column stores DB column default', async () => {
    // Determine the expected DB default based on which migrations have been applied.
    // - After 20261030 only: DB default is LEGACY.
    // - After Issue 3's reconciliation migration: DB default is SFU_AUTHORITATIVE.
    // This assertion is deterministic: it fails if the INSERT stored the wrong value
    // relative to the applied migrations.
    const reconMigRows = await prisma.$queryRawUnsafe(
      "SELECT migration_name FROM _prisma_migrations WHERE migration_name LIKE '%reconcile_microphone_authorization_default%' AND finished_at IS NOT NULL"
    );
    const expectedDefault = reconMigRows.length > 0 ? 'SFU_AUTHORITATIVE' : 'LEGACY';

    const id = uuidv4();
    const now = new Date().toISOString().slice(0, 23).replace('T', ' ');
    await prisma.$executeRawUnsafe(
      `INSERT INTO live_classes
         (id, stream_type, host_user_id, schoolId, title, status, maxSpeakers,
          chatEnabled, handRaiseEnabled, isOpenMic, screenShareEnabled,
          whiteboardEnabled, quranPanelEnabled, isRecorded, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, 'CLASS', testTeacherId, testSchoolId, `Raw Insert Test ${uid()}`,
      'SCHEDULED', 2, 1, 1, 0, 1, 1, 0, 0, now, now
    );
    createdLcIds.push(id);

    const rows = await prisma.$queryRawUnsafe(
      'SELECT microphone_authorization_mode FROM live_classes WHERE id = ?', id
    );
    // Assert the DB default was applied — not an adaptive tautology.
    // If the INSERT stored a value that does not match the applied migrations,
    // this test fails, which is the desired regression signal.
    expect(rows[0].microphone_authorization_mode).toBe(expectedDefault);

    // Secondary confirmation: SHOW COLUMNS must agree
    const colInfo = await prisma.$queryRawUnsafe(
      "SHOW COLUMNS FROM live_classes LIKE 'microphone_authorization_mode'"
    );
    expect(colInfo[0].Default).toBe(expectedDefault);
  });
```

### Case 4 — Raw SQL INSERT, explicit value

```js
  test('Case 4: raw SQL INSERT with explicit SFU_AUTHORITATIVE stores SFU_AUTHORITATIVE', async () => {
    const id = uuidv4();
    const now = new Date().toISOString().slice(0, 23).replace('T', ' ');
    await prisma.$executeRawUnsafe(
      `INSERT INTO live_classes
         (id, stream_type, host_user_id, schoolId, title, status, maxSpeakers,
          microphone_authorization_mode,
          chatEnabled, handRaiseEnabled, isOpenMic, screenShareEnabled,
          whiteboardEnabled, quranPanelEnabled, isRecorded, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, 'CLASS', testTeacherId, testSchoolId, `Raw Explicit Test ${uid()}`,
      'SCHEDULED', 2, 'SFU_AUTHORITATIVE', 1, 1, 0, 1, 1, 0, 0, now, now
    );
    createdLcIds.push(id);
    const rows = await prisma.$queryRawUnsafe(
      'SELECT microphone_authorization_mode FROM live_classes WHERE id = ?', id
    );
    expect(rows[0].microphone_authorization_mode).toBe('SFU_AUTHORITATIVE');
  });
});
```

### Testability notes

Cases 1 and 2 are deterministic regardless of the DB default; they only exercise the Prisma client path. Case 3 is deterministic because its assertion is derived from the applied migration state rather than from the current `SHOW COLUMNS` value. Case 4 is always deterministic. All created rows are tracked in `createdLcIds` and cleaned up in `afterAll` before user/school deletion, preventing FK constraint violations.

---

## Issue 5 — HTTP 409 for Trigger Rejection in `startLiveClass`

### Files to modify

- `backend/src/utils/liveClassMicrophoneContract.js` — add one constant and one helper function.
- `backend/src/controllers/live-class.controller.js` — narrow the catch block in `startLiveClass`.
- `backend/src/tests/live-class-microphone-unit-a.test.js` — add unit tests for the helper **and** for the controller's catch branch dispatch logic.

### Constant and helper in `liveClassMicrophoneContract.js`

Add to the existing exports:

```js
/**
 * Exact trigger message text emitted by `live_classes_legacy_start_guard`
 * (20261030_fix_live_class_microphone_triggers, Step 4).
 * Used to detect a business-rule rejection and return HTTP 409.
 * Must stay in sync with the trigger's MESSAGE_TEXT if either changes.
 */
const LEGACY_SESSION_START_REJECTION_MESSAGE =
  'Cannot start LEGACY session; upgrade microphone_authorization_mode to SFU_AUTHORITATIVE first';

/**
 * Returns true if the error originates from the live_classes_legacy_start_guard
 * trigger rejection. Used by startLiveClass to distinguish business-rule
 * violations (→ 409) from unexpected failures (→ 500).
 * @param {unknown} err
 * @returns {boolean}
 */
function isTriggerLegacyStartRejection(err) {
  return Boolean(
    err &&
    err.message &&
    err.message.includes(LEGACY_SESSION_START_REJECTION_MESSAGE)
  );
}
```

Export both in `module.exports`.

### Controller change in `startLiveClass`

The current catch block is `catch (e) { next(e); }`. Replace it with a targeted handler that only maps the known trigger message to 409 and passes everything else through unchanged:

```js
// In live-class.controller.js, add to the existing destructured import:
const {
  MICROPHONE_AUTHORIZATION_MODES,
  LEGACY_SESSION_START_REJECTION_MESSAGE,  // new
  isTriggerLegacyStartRejection,           // new
} = require('../utils/liveClassMicrophoneContract');

// Replace the catch in startLiveClass:
  } catch (e) {
    // SEC01-G-BE02: The live_classes_legacy_start_guard trigger (20261030)
    // signals SQLSTATE 45000 with a known message when a LEGACY session tries
    // to start. This is a business-rule violation → HTTP 409.
    // All other errors pass through to the generic handler → HTTP 500.
    if (isTriggerLegacyStartRejection(e)) {
      return errorResponse(
        res,
        'The microphone authorization mode must be upgraded before starting this class.',
        409
      );
    }
    next(e);
  }
```

The `errorResponse(res, message, statusCode)` signature is confirmed from `backend/src/utils/response.js`. The user-facing message does not contain "SQLSTATE", "45000", "trigger", or any raw SQL fragment, satisfying FR-5.5.

The check uses `isTriggerLegacyStartRejection(e)` which calls `e.message.includes(LEGACY_SESSION_START_REJECTION_MESSAGE)`. The `.includes()` match (not strict equality) handles cases where the Prisma raw-SQL error wraps the MariaDB message text inside a larger error string — consistent with how the trigger integration tests match by pattern rather than exact string.

The 409 path does not change `ensureProtectedScheduledMicrophoneMode` behavior or the success path. `ensureProtectedScheduledMicrophoneMode` is wrapped in its own non-fatal try/catch and runs before `rawUpdateLiveClassStatus`, so a failure there does not reach this catch block.

### Unit tests to add

The unit tests cover two distinct layers: (1) the helper function `isTriggerLegacyStartRejection` in isolation, and (2) the controller's catch-branch dispatch logic. Both are needed to satisfy AC 1 and AC 2 from the requirements.

**Helper unit tests** (go in `live-class-microphone-unit-a.test.js`):

```js
const { isTriggerLegacyStartRejection, LEGACY_SESSION_START_REJECTION_MESSAGE } =
  require('../utils/liveClassMicrophoneContract');

test('isTriggerLegacyStartRejection returns true for exact trigger message', () => {
  const err = new Error('some wrapper text: ' + LEGACY_SESSION_START_REJECTION_MESSAGE);
  expect(isTriggerLegacyStartRejection(err)).toBe(true);
});

test('isTriggerLegacyStartRejection returns false for unrelated database error', () => {
  expect(isTriggerLegacyStartRejection(new Error('Connection refused'))).toBe(false);
  expect(isTriggerLegacyStartRejection(new Error('ER_ROW_IS_REFERENCED_2'))).toBe(false);
  expect(isTriggerLegacyStartRejection(null)).toBe(false);
  expect(isTriggerLegacyStartRejection({})).toBe(false);
});
```

**Controller dispatch unit tests** (also in `live-class-microphone-unit-a.test.js`). These mock the controller's dependencies to exercise the catch branch directly:

```js
// Mock the contract module to control isTriggerLegacyStartRejection
jest.mock('../utils/liveClassMicrophoneContract', () => ({
  ...jest.requireActual('../utils/liveClassMicrophoneContract'),
  isTriggerLegacyStartRejection: jest.fn(),
}));

const { isTriggerLegacyStartRejection } = require('../utils/liveClassMicrophoneContract');
const { startLiveClass } = require('../controllers/live-class.controller');

describe('startLiveClass error dispatch', () => {
  let req, res, next;
  beforeEach(() => {
    req = { params: { id: 'test-id' }, user: { id: 'user-id', schoolId: 'school-id' } };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    next = jest.fn();
    jest.clearAllMocks();
  });

  test('returns HTTP 409 when isTriggerLegacyStartRejection is true', async () => {
    // Arrange: mock rawUpdateLiveClassStatus to throw the trigger error
    // and isTriggerLegacyStartRejection to return true
    isTriggerLegacyStartRejection.mockReturnValue(true);
    // ... mock rawFindLiveClass, assertSchoolAccess, etc. to reach the catch block
    // then verify:
    expect(res.status).toHaveBeenCalledWith(409);
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next(e) with HTTP 500 when isTriggerLegacyStartRejection is false', async () => {
    isTriggerLegacyStartRejection.mockReturnValue(false);
    // ... mock dependencies ...
    // then verify:
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalledWith(409);
  });
});
```

The issue must state that the full mock setup (for `rawFindLiveClass`, `assertSchoolAccess`, `ensureProtectedScheduledMicrophoneMode`, `rawUpdateLiveClassStatus`) follows the existing mocking patterns in the controller's existing unit test files.

### Error handling analysis

| Failure condition | Recoverable? | Caller receives | Logged? |
|---|---|---|---|
| Trigger SQLSTATE 45000 with known message | Business rule, expected | HTTP 409, safe user message | No (not an unexpected failure) |
| Trigger SQLSTATE 45000 with different message | Unexpected | HTTP 500 via `next(e)` | Yes (default Express handler) |
| Other DB error (connection, constraint) | Unexpected | HTTP 500 via `next(e)` | Yes |
| `rawFindLiveClass` returns null | Expected | HTTP 404 | No |

---

## Issue 6 — Raw-SQL Test Helper Hygiene

### Files to modify

Three files contain raw `INSERT INTO live_classes` statements that omit `microphone_authorization_mode` and therefore depend on the DB column default. All three must be made explicit so the suite stays green against both the current default (`LEGACY`, after `20261030`) and the reconciled default (`SFU_AUTHORITATIVE`, after Issue 3). No production controller/service/route/middleware files are touched.

1. `backend/src/tests/integration/live-class.integration.test.js` — the `rawInsertLC` helper and its call sites (primary file; full call-site table below).
2. `backend/src/tests/live-class-real-db.test.js` — the `createTestLC` helper and its call sites. This file uses pre-seeded real identities (hardcoded `TEACHER_ID` / `SCHOOL_ID` UUIDs) rather than fresh fixtures, but the raw INSERT has the same column-default dependency.
3. `backend/fix-live-class-columns.js` — the Step 10 "Quick creation test (raw SQL)" diagnostic INSERT (around line 140).

### `rawInsertLC` signature change (live-class.integration.test.js)

Extend the function to accept and forward `microphoneAuthorizationMode`:

```js
async function rawInsertLC(data) {
  var id  = uuidv4();
  var now = new Date().toISOString().slice(0, 23).replace('T', ' ');

  // Build column list and values dynamically to include the mode column only when specified.
  // When omitted, the DB column default is used — after Issue 3 this will be SFU_AUTHORITATIVE.
  var modeColumns = '';
  var modeValues  = '';
  var modeParams  = [];
  if (data.microphoneAuthorizationMode !== undefined) {
    modeColumns = ', microphone_authorization_mode';
    modeValues  = ', ?';
    modeParams  = [data.microphoneAuthorizationMode];
  }

  await prisma.$executeRawUnsafe(
    'INSERT INTO live_classes (id, stream_type, host_user_id, schoolId, classId, teacherId, title, status, maxSpeakers, maxParticipants, chatEnabled, handRaiseEnabled, isOpenMic, screenShareEnabled, whiteboardEnabled, quranPanelEnabled, isRecorded' +
    modeColumns +
    ', createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,0,0' +
    modeValues +
    ',?,?)',
    id,
    data.streamType   || 'SCHOOL',
    data.hostUserId,
    data.schoolId     || null,
    data.classId      || null,
    data.teacherId    || null,
    data.title        || 'LC Integration Test',
    data.status       || 'LIVE',
    data.maxSpeakers  || 2,
    data.maxParticipants || null,
    data.chatEnabled         !== false ? 1 : 0,
    data.handRaiseEnabled    !== false ? 1 : 0,
    data.isOpenMic           ? 1 : 0,
    ...modeParams,
    now,
    now
  );
  createdLcIds.push(id);
  return id;
}
```

This design builds the SQL string and parameter array conditionally, keeping the existing parameter positions intact for all current call sites that do not pass `microphoneAuthorizationMode`.

### Call-site updates

The nine `rawInsertLC` call sites in `live-class.integration.test.js` require explicit annotation or update:

| Line | Context | Required update |
|---|---|---|
| ~233 | GATE-AUTH SCHOOL LIVE class | Add `microphoneAuthorizationMode: 'SFU_AUTHORITATIVE'` — mode is irrelevant to auth test; use the application-consistent value |
| ~266 | GATE-F02 SCHOOL LIVE class (host is TEACHER) | Add `microphoneAuthorizationMode: 'SFU_AUTHORITATIVE'` |
| ~285–289 | GATE-F02 SUPER_ADMIN SCHEDULED SCHOOL class | Add `microphoneAuthorizationMode: 'SFU_AUTHORITATIVE'` — the 403 is returned by `assertSchoolAccess` before any microphone check runs; the mode is irrelevant to this test's assertion. Comment: `// Mode is irrelevant: assertSchoolAccess fires a 403 before any microphone check. SFU_AUTHORITATIVE is used as the application-consistent default.` |
| ~324 | GATE-CROSS-SCHOOL SCHOOL LIVE class | Add `microphoneAuthorizationMode: 'SFU_AUTHORITATIVE'` |
| ~355 | GATE-11 PUBLIC LIVE class | Add `microphoneAuthorizationMode: 'SFU_AUTHORITATIVE'` |
| ~407 | GATE-9 PUBLIC LIVE class | Add `microphoneAuthorizationMode: 'SFU_AUTHORITATIVE'` |
| ~441 | GATE-10 PUBLIC SCHEDULED class | Add `microphoneAuthorizationMode: 'SFU_AUTHORITATIVE'` — the `non-creator POST /start` test calls `POST /start` via the host, which now works without `ensureProtectedScheduledMicrophoneMode` upgrading anything |
| ~490 | GATE-6 PUBLIC LIVE class | Add `microphoneAuthorizationMode: 'SFU_AUTHORITATIVE'` |
| ~551 | GATE-NO-SCHOOL SCHOOL LIVE class | Add `microphoneAuthorizationMode: 'SFU_AUTHORITATIVE'` |

The GATE-F02 SUPER_ADMIN SCHEDULED test at line ~285 is confirmed by reading the test body: `superAdmin` has no school membership, so `assertSchoolAccess` fires a 403 before the controller reaches `ensureProtectedScheduledMicrophoneMode` or any trigger path. Passing `LEGACY` to document a "LEGACY upgrade path" intent is misleading because that path is never reached. The correct annotation is `SFU_AUTHORITATIVE` with the explanatory comment above, consistent with FR-6.5's guidance that irrelevant modes should use `SFU_AUTHORITATIVE` as the application-consistent default.

The GATE-10 test at line ~441 calls `POST /start` on a SCHEDULED class. With `SFU_AUTHORITATIVE` set explicitly, `ensureProtectedScheduledMicrophoneMode` is a no-op (mode is already SFU_AUTHORITATIVE) and `rawUpdateLiveClassStatus` sets `status = 'LIVE'` without triggering `live_classes_legacy_start_guard`. This is the correct behavior — the test verifies ownership, not microphone mode.

### `createTestLC` signature change (live-class-real-db.test.js)

`createTestLC` (lines ~88–122) builds a defaults object via `...params` spread, then runs a raw INSERT whose column list omits `microphone_authorization_mode`. The existing INSERT hardcodes `screenShareEnabled, whiteboardEnabled, quranPanelEnabled, isRecorded` as the literals `1, 1, 0, 0` inside the VALUES clause. The extension must preserve those literals and only conditionally add the mode column/placeholder:

```js
async function createTestLC(params = {}) {
  const id = require('uuid').v4();
  const now = new Date().toISOString().slice(0, 23).replace('T', ' ');
  const p = {
    streamType:  'SCHOOL',
    hostUserId:  TEACHER_ID,
    schoolId:    SCHOOL_ID,
    classId:     null,
    teacherId:   null,
    title:       'Integration Test LC',
    status:      'LIVE',
    maxSpeakers: 2,
    maxParticipants: null,
    chatEnabled: 1,
    handRaiseEnabled: 1,
    isOpenMic: 0,
    ...params,
  };

  // SEC01-G-BE02: set microphone_authorization_mode explicitly when provided.
  // When omitted the DB column default is used (LEGACY after 20261030,
  // SFU_AUTHORITATIVE after the Issue 3 reconciliation migration). Call sites
  // whose scenario depends on the mode MUST pass microphoneAuthorizationMode;
  // mode-indifferent call sites default to SFU_AUTHORITATIVE (see policy below).
  const hasMode = p.microphoneAuthorizationMode !== undefined;
  const modeColumn = hasMode ? ', microphone_authorization_mode' : '';
  const modePlaceholder = hasMode ? ', ?' : '';
  const modeValue = hasMode ? [p.microphoneAuthorizationMode] : [];

  await prisma.$executeRawUnsafe(
    `INSERT INTO live_classes
      (id, stream_type, host_user_id, schoolId, classId, teacherId,
       title, status, maxSpeakers, maxParticipants, chatEnabled,
       handRaiseEnabled, isOpenMic, screenShareEnabled, whiteboardEnabled,
       quranPanelEnabled, isRecorded${modeColumn}, createdAt, updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,0,0${modePlaceholder},?,?)`,
    id, p.streamType, p.hostUserId, p.schoolId, p.classId, p.teacherId,
    p.title, p.status, p.maxSpeakers, p.maxParticipants,
    p.chatEnabled, p.handRaiseEnabled, p.isOpenMic,
    ...modeValue,
    now, now
  );
  createdLcIds.push(id);
  return id;
}
```

The parameter order is unchanged for existing call sites: the four literal columns stay inline in the VALUES clause and `...modeValue` is spliced in just before `now, now`. A call site that omits `microphoneAuthorizationMode` produces byte-for-byte the same SQL it does today (the DB default still applies), so this change is backward-compatible.

#### `createTestLC` call-site policy

There are roughly twelve `createTestLC(...)` call sites (GATE-7A, GATE-8, GATE-10, GATE-11, GATE-12, GATE-1, GATE-2, GATE-3, GATE-4, GATE-5, and the reconnect/maxSpeakers tests). Their characteristics:

- The two `POST /start` call sites (the GATE-10 non-creator case ~line 356 and the GATE-11 non-creator case ~line 431) expect **403** — `assertSchoolAccess` / ownership fires before any microphone check, so the mode is irrelevant.
- No call site in this file exercises a *successful* SCHEDULED→LIVE start that would be load-bearing on the LEGACY default. Rows are created with `status: 'LIVE'` (the helper default) or `status: 'LIVE'` explicit, so `live_classes_legacy_start_guard` (which fires only on a non-LIVE → LIVE transition with LEGACY) never fires for these rows.

Policy: every call site passes `microphoneAuthorizationMode: 'SFU_AUTHORITATIVE'` (the value `rawCreateLiveClass` always uses), or — if a test specifically wants to exercise the LEGACY start path — `microphoneAuthorizationMode: 'LEGACY'` with a comment. Because no call site currently depends on the LEGACY default for a passing assertion, the safe uniform choice is `'SFU_AUTHORITATIVE'`, making the file immune to Issue 3's default change (FR-6.7). Where a call site is genuinely mode-indifferent (a `GET /:id` authorization test), the `SFU_AUTHORITATIVE` value is harmless and the call site may carry a one-line comment noting the mode is irrelevant.

### `fix-live-class-columns.js` INSERT (Step 10)

The Step 10 "Quick creation test (raw SQL)" diagnostic (around line 140) inserts a `SCHEDULED` `_test_` row, checks `maxParticipants IS NULL`, then deletes it. It omits `microphone_authorization_mode`, relying on the DB default. The row is `SCHEDULED` and deleted immediately, so the implicit default is functionally inert here — but the script must not depend on a default Issue 3 will change. Add the column explicitly with the application-consistent value and a comment:

```js
// SEC01-G-BE02: set microphone_authorization_mode explicitly so this
// diagnostic does not depend on the DB column default (which Issue 3
// changes from LEGACY to SFU_AUTHORITATIVE). SFU_AUTHORITATIVE mirrors
// what rawCreateLiveClass always writes.
await prisma.$executeRawUnsafe(
  `INSERT INTO live_classes (id, stream_type, host_user_id, schoolId, classId, teacherId, title, description, scheduledAt, duration, status, chatEnabled, handRaiseEnabled, whiteboardEnabled, quranPanelEnabled, isOpenMic, screenShareEnabled, maxParticipants, isRecorded, microphone_authorization_mode, createdAt, updatedAt)
   VALUES (?, 'PUBLIC', ?, NULL, NULL, NULL, '_test_', NULL, NULL, NULL, 'SCHEDULED', 1, 1, 1, 0, 1, 1, NULL, 0, 'SFU_AUTHORITATIVE', ?, ?)`,
  testId, host.id, now, now
);
```

The added `microphone_authorization_mode = 'SFU_AUTHORITATIVE'` matches the production create path. No other statement in this script inserts into `live_classes` (the rest are `ALTER TABLE` / `CREATE INDEX` DDL), so this is the only edit needed in the file.

### Validation

After this change, `npm run test:integration` (which runs both `live-class.integration.test.js` and `live-class-real-db.test.js`) must pass against MariaDB 10.11:
- with the current DB default (`LEGACY`, after `20261030`), and
- with the reconciled DB default (`SFU_AUTHORITATIVE`, after Issue 3's migration).

`fix-live-class-columns.js` is not part of the test suite; it is validated by running `node fix-live-class-columns.js` once against a disposable MariaDB 10.11 instance in each default state and confirming the Step 10 "Quick creation test" still reports `[OK] Test creation succeeded`.

The two integration-suite runs can be verified sequentially in CI by running the suite before and after applying Issue 3's migration.

---

## Dependency Order and Merge Sequence

| Order | Issue | Prerequisite |
|---|---|---|
| 1 | Issue 1: Recovery runbook | None — documentation only |
| 2 | Issue 6: Test helper hygiene | None — independent test change |
| 3 | Issue 5: HTTP 409 | None — independent controller + unit test |
| 4 | Issue 4: Prisma default integration test | None — but should be run after `20261030` is applied |
| 5 | Issue 2: Trigger-hardening migration | None — but schedule after Issue 1 is merged (runbook available) |
| 6 | Issue 3: Default reconciliation migration | Issue 2 (stable trigger state), Issue 6 (helpers no longer depend on LEGACY default) |

Issues 1, 5, 6, and 4 can be worked in parallel. Issue 2 should be completed before Issue 3. Issue 3 must not be merged until Issue 6 is merged or in the same PR.

---

## Review Responses

### Finding 1 — HIGH — Mixed import patterns in Issue 4 test skeleton
**Addressed.** The revised design adopts the **self-contained `PrismaClient` pattern** exclusively, mirroring `liveclass-microphone-triggers.integration.test.js`. `PrismaClient` is instantiated in `beforeAll` and assigned to the outer `prisma` variable; the shared singleton from `utils/prisma` is never imported. The `bcrypt` import has been removed (it was unused). The Case 1 `loggingPrisma` instance is a second `PrismaClient` created within the test body for query-event capture only, then disconnected within the same test — consistent with the standard Prisma pattern for observing emitted SQL.

### Finding 2 — HIGH — Case 1 SQL-capture assertion uses `e.query` for value detection, but Prisma 5.x puts values in `e.params`
**Addressed.** The revised design captures `{ query: e.query, params: e.params }` from query events and asserts against `insertEvent.params` (not `insertEvent.query`). `e.params` is a JSON string in Prisma 5.x containing the actual parameter values including `'SFU_AUTHORITATIVE'`. The assertion `expect(insertEvent.params).toContain('SFU_AUTHORITATIVE')` is correct.

### Finding 3 — HIGH — GATE-F02 SUPER_ADMIN SCHEDULED test entry in call-site table directs `LEGACY` for a test where the mode is irrelevant (403 fires before microphone check)
**Addressed.** The revised call-site table changes the line ~285 entry to `microphoneAuthorizationMode: 'SFU_AUTHORITATIVE'` with an explanatory comment that `assertSchoolAccess` fires before any microphone check. Passing `LEGACY` for this test was misleading and contradicted FR-6.5. The revised entry is consistent with FR-6.5: mode is irrelevant, use `SFU_AUTHORITATIVE` as the application-consistent default.

### Finding 4 — HIGH — Controller 409/500 dispatch untested at unit level; only the helper is tested
**Addressed.** The revised Issue 5 unit test design now explicitly includes **controller dispatch unit tests** in addition to the helper tests. The controller tests use `jest.mock` to override `isTriggerLegacyStartRejection` and exercise the controller's catch branch directly with mock req/res/next, covering AC 1 (409 path) and AC 2 (500 path) at the unit level.

### Finding 5 — MEDIUM — Issue 2 rehearsal step 4 manipulates `_prisma_migrations` without a disclaimer
**Addressed.** The revised rehearsal procedure for Issue 2 adds an explicit scoping note before the `UPDATE` statement: "DISPOSABLE REHEARSAL CONTAINER ONLY. Never run on production or staging." This resolves the contradiction with Issue 1's runbook guidance while preserving the rehearsal procedure's utility.

### Finding 6 — MEDIUM — Case 3 assertion is tautological (queries `SHOW COLUMNS` then asserts the value matches what was returned)
**Addressed.** The revised Case 3 derives the expected value from the applied migration state (`_prisma_migrations` check for the reconciliation migration) rather than from `SHOW COLUMNS`. The assertion `expect(rows[0].microphone_authorization_mode).toBe(expectedDefault)` will fail if the INSERT stored a value inconsistent with the applied migrations. `SHOW COLUMNS` is retained as a secondary confirmation only.

### Finding 7 — MEDIUM — Design says "seven" call sites but actual count and table both show nine
**Addressed.** The revised design replaces "seven" with "nine" in the call-site table introduction.

### Finding 8 — MEDIUM — Issue 3 migration prerequisite stated only in a SQL comment with no enforcement or verification step
**Addressed.** The revised Issue 3 migration file SQL includes the prerequisite in a comment, and the design now explicitly states that the **issue body** must also state the dependency (not just the SQL comment). A CI verification step is added to the rehearsal procedure: confirm Issue 2's migration `finished_at IS NOT NULL` before applying Issue 3's migration in rehearsal.

### Finding 9 — MEDIUM — Issue 2 checksum verification location ambiguous (issue body vs. migration comment)
**Addressed.** The revised design specifies that the reference SHA-256 checksum must be recorded in the **issue body** (before the branch is created) and that the PR reviewer re-runs the command on the final branch. The migration file itself does not need the checksum. This is unambiguous.

### Finding 10 — MEDIUM — `afterAll` cleanup order violates FK constraints if inline live class cleanup fails
**Addressed.** The revised Issue 4 test skeleton adds a `createdLcIds` array populated by every test case that creates a live class row. `afterAll` deletes all tracked live class rows in a loop before deleting the user and school records, following the safety pattern from `liveclass-microphone-triggers.integration.test.js`.

### Finding 11 — NIT — `require('uuid').v4()` called inline instead of module-scope import
**Addressed.** The revised design imports `const { v4: uuidv4 } = require('uuid');` at the module scope and uses `uuidv4()` throughout.

### Finding 12 — NIT — Issue 3 hardcodes migration filename `20261116` without the "use current date" caveat
**Addressed.** The revised Issue 3 section now includes the same caveat as Issue 2: "The filename `20261116_...` is illustrative. The implementer must use the current date when creating the migration; the invariant is that this migration sorts lexicographically after Issue 2's migration."

### Finding 13 — NIT — No-row scenario's Notes column in the summary table is empty; operator could wonder why `--applied` works without a failed row
**Addressed.** The revised scenario summary table adds a note to the No-row row: "No failed row is required; `migrate resolve --applied` inserts a new row (documented Prisma baselining mechanism). No prior failed row is needed for this command."

---

## Review Responses — Current Loop-Back (Revision 4)

The current run's design review (`design-review.json`, `03-design-review.md`) raised three new findings against the revised design above. Each is addressed below.

### Finding R4-1 — HIGH — Issue 4 test fixture: `school.create()` omits required `slug` field
**Addressed.** The Issue 4 `beforeAll` fixture now creates the school with `slug` (required, no `@default`, unique) and `country: 'MY'`, mirroring the passing pattern in `liveclass-microphone-triggers.integration.test.js` (line 30). Without `slug`, `prisma.school.create()` throws a Prisma validation error before any INSERT runs. The corrected fixture is shown in the Issue 4 section above.

### Finding R4-2 — HIGH — Issue 4 test fixture: `user.create()` uses non-existent `name` and `password` fields
**Addressed.** The Issue 4 `beforeAll` fixture now uses the actual `User` model fields: `firstName`/`lastName` (required `String`) and `passwordHash` (the column name — there is no `name` or `password` field). It also sets `status: 'ACTIVE'` and `emailVerified: true` so any raw-SQL authorization path that checks `status = 'ACTIVE'` does not reject the host. This matches the working pattern in `liveclass-microphone-triggers.integration.test.js` (lines 34–44). The corrected fixture is shown in the Issue 4 section above.

### Finding R4-3 — MEDIUM — Issue 6 scope omits `live-class-real-db.test.js` and `fix-live-class-columns.js`
**Addressed.** The Issue 6 "Files to modify" section now names all three files that perform raw `INSERT INTO live_classes` without setting `microphone_authorization_mode`: `live-class.integration.test.js` (the `rawInsertLC` helper), `live-class-real-db.test.js` (the `createTestLC` helper), and `fix-live-class-columns.js` (the Step 10 diagnostic INSERT). Two new subsections specify the `createTestLC` extension (preserving its inline `1,1,0,0` literals and splicing the mode parameter before `now, now`, backward-compatible when the mode is omitted) with a call-site policy defaulting to `SFU_AUTHORITATIVE`, and the `fix-live-class-columns.js` Step 10 change (explicit `microphone_authorization_mode = 'SFU_AUTHORITATIVE'` with a comment). The Validation subsection now covers all three files and confirms `fix-live-class-columns.js` via a manual run in each default state. This satisfies FR-3.1 (which names all three files as affected) and FR-6.7 (the suite must stay green against both the `LEGACY` and `SFU_AUTHORITATIVE` defaults).
