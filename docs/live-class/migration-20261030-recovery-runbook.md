# Migration 20261030 — Production Recovery Runbook

**Migration:** `20261030_fix_live_class_microphone_triggers`
**Applies to:** `backend/prisma/migrations/20261030_fix_live_class_microphone_triggers/migration.sql`
**Engine:** MariaDB 10.11 (production) — Prisma 5.22.0
**Audience:** On-call operators during a production incident involving this migration.

---

## Executive Summary

Migration `20261030_fix_live_class_microphone_triggers` executes four SQL statements, in order: (1) **ALTER DEFAULT** — set `live_classes.microphone_authorization_mode` default to `LEGACY`; (2) **DROP MG** — `DROP TRIGGER IF EXISTS live_classes_microphone_mode_guard`; (3) **CREATE MG** — recreate the mode-change guard trigger; (4) **CREATE SG** — create `live_classes_legacy_start_guard`. Each DDL statement implicitly commits on MariaDB, so a failure between statements leaves a partially applied state that Prisma records as a failed migration row. **Never edit the historical migration file** — any change breaks its checksum and causes drift. **All recovery goes through `npx prisma migrate resolve`**, never a manual `INSERT INTO _prisma_migrations`.

Every command below is labeled either:

- **READ-ONLY DIAGNOSTIC — may run at any time**, or
- **STATE-CHANGING — verify prerequisites before executing.**

No command in this runbook is unconditionally safe. Every state-changing operation is gated on a prior read-only diagnostic.

---

## `_prisma_migrations` Schema Reference (Prisma 5.22.0, MySQL/MariaDB)

The table has exactly eight columns:

| Column | Nullable | Meaning |
|---|---|---|
| `id` | NO | Primary key (varchar 36) |
| `checksum` | NO | SHA-256 of the migration file — **NOT NULL** |
| `finished_at` | YES | Timestamp when the migration fully applied |
| `migration_name` | NO | Directory name of the migration |
| `logs` | YES | Error output from a failed run |
| `rolled_back_at` | YES | Timestamp when marked for re-application |
| `started_at` | NO | Timestamp when execution started |
| `applied_steps_count` | NO | Deprecated in Prisma 5.x — the engine still writes it (DEFAULT 0) but it is no longer meaningful as a step counter. NOT NULL. |

> **Note:** the column `migration_type` **does not exist** in Prisma 5.22.0's `_prisma_migrations`. Any SQL or guidance referencing it is invalid.

### Three row states for migration 20261030

| State | `finished_at` | `rolled_back_at` | Meaning |
|---|---|---|---|
| **Failed** | NULL | NULL | Partially applied; unresolved — blocks `migrate deploy` |
| **Rolled-back** | NULL | NOT NULL | Marked for re-application by the next `migrate deploy` |
| **Applied** | NOT NULL | NULL | Fully applied; no action needed |

SQL signatures:

```sql
-- READ-ONLY DIAGNOSTIC — may run at any time
-- Failed row:
SELECT * FROM _prisma_migrations
WHERE migration_name = '20261030_fix_live_class_microphone_triggers'
  AND finished_at IS NULL AND rolled_back_at IS NULL;

-- Rolled-back row:
SELECT * FROM _prisma_migrations
WHERE migration_name = '20261030_fix_live_class_microphone_triggers'
  AND rolled_back_at IS NOT NULL;

-- Applied row:
SELECT * FROM _prisma_migrations
WHERE migration_name = '20261030_fix_live_class_microphone_triggers'
  AND finished_at IS NOT NULL;
```

---

## Key Behavior: `migrate deploy` Refusal

> **`npx prisma migrate deploy` REFUSES to advance (it does NOT re-execute SQL) when an unresolved failed migration row exists.** It prints a "migration ... failed" / "recover it" message and exits without running any pending migration. The duplicate-trigger error (MariaDB 1359, "Trigger already exists") only appears if the operator chooses `--rolled-back` for a scenario-E state and then runs `migrate deploy` — because deploy then re-executes all four statements and Step 4's `CREATE TRIGGER live_classes_legacy_start_guard` collides with the trigger already created by the first (complete) execution.

A naive retry of `migrate deploy` against a failed row is therefore **not** a re-run of the SQL — it is a refusal. Resolve the row state first (see the decision tree below).

---

## Read-Only Diagnostic SQL Block

Run all three before choosing any recovery path:

```sql
-- READ-ONLY DIAGNOSTIC — may run at any time

-- 1. Migration record state (multi-row aware — handles multiple rows for the same migration)
SELECT migration_name, started_at, finished_at, rolled_back_at,
       CASE
         WHEN finished_at IS NOT NULL AND rolled_back_at IS NULL THEN 'APPLIED'
         WHEN rolled_back_at IS NOT NULL AND finished_at IS NULL THEN 'ROLLED_BACK'
         WHEN finished_at IS NULL AND rolled_back_at IS NULL THEN 'FAILED'
         ELSE 'UNKNOWN'
       END AS state
FROM _prisma_migrations
WHERE migration_name LIKE '2026103%'
ORDER BY started_at DESC;

-- 2. Trigger inventory (must return both rows in a healthy state)
SELECT trigger_name, action_timing, event_manipulation, action_statement
FROM information_schema.triggers
WHERE trigger_schema = DATABASE() AND event_object_table = 'live_classes';

-- 3. Column default
SHOW COLUMNS FROM live_classes LIKE 'microphone_authorization_mode';
```

**Multiple-row decision table:**

| Row count | States present | Action |
|---|---|---|
| 0 | (none) | Migration never attempted — verify triggers/default, then `resolve --applied` to baseline |
| 1 | FAILED | Partial execution — classify scenario (A–D or E), then resolve |
| 1 | ROLLED_BACK | Marked for re-deploy — check for orphaned SG trigger, then `migrate deploy` |
| 1 | APPLIED | Migration complete — no action needed |
| 2+ | ROLLED_BACK + APPLIED | Normal post-resolve --applied state — verify APPLIED row's `finished_at IS NOT NULL AND rolled_back_at IS NULL` |
| 2+ | FAILED + FAILED (or other) | Multiple failed attempts — escalate; do not retry without DBA review |

> **Important:** An operator who sees a ROLLED_BACK row must check whether there is ALSO an APPLIED row before attempting any recovery. A ROLLED_BACK row alone does not mean the migration is not applied — it may be the original failed attempt from a prior `resolve --applied` run.

Expected healthy results:

1. Query 1: one row with `finished_at` populated (applied), or no row (no-row scenario).
2. Query 2: exactly two triggers — `live_classes_microphone_mode_guard` (mode-change guard: blocks SFU→LEGACY downgrade, blocks LIVE LEGACY upgrade, restricts mode changes to SCHEDULED/ENDED) and `live_classes_legacy_start_guard` (blocks SCHEDULED→LIVE while mode is LEGACY). Verify each `action_statement` matches the definitions in the migration file (Step 3 and Step 4 respectively).
3. Query 3: `Default: LEGACY` after 20261030. (The FEAT-006 reconciliation migration `20261116_reconcile_microphone_authorization_default` changes this default to `SFU_AUTHORITATIVE` once applied — after that migration, expect `Default: SFU_AUTHORITATIVE`.)

For deeper trigger-definition verification:

```sql
-- READ-ONLY DIAGNOSTIC — may run at any time
SELECT trigger_name, action_statement
FROM information_schema.triggers
WHERE trigger_schema = DATABASE() AND event_object_table = 'live_classes';
```

---

## Scenario A — Failure before Step 1 (ALTER DEFAULT) completes

**What happened:** the migration failed before the `ALTER TABLE ... SET DEFAULT 'LEGACY'` statement committed. Nothing (or only a no-op) was applied.

**Prerequisite diagnostic (read-only):**
- Query 1: failed row (`finished_at IS NULL AND rolled_back_at IS NULL`).
- Query 2: **no** `live_classes_microphone_mode_guard` of the new definition; the old (20261029, broken) trigger may still exist.
- Query 3: default still `SFU_AUTHORITATIVE` (from 20261029).

**Recovery (STATE-CHANGING — verify prerequisites before executing):**

```bash
npx prisma migrate resolve --rolled-back 20261030_fix_live_class_microphone_triggers
npx prisma migrate deploy
```

**Expected outcome:** the row is marked rolled-back; deploy re-executes all four statements from scratch; after deploy, both triggers exist with the new definitions and the default is `LEGACY`. The ALTER is idempotent; re-run is safe.

**Stop conditions:** stop and escalate if deploy fails again after `--rolled-back` — a second consecutive failure at the same step indicates an environmental problem (permissions, metadata lock), not a state problem. Do not retry a third time without a new diagnostic.

---

## Scenario B — Step 1 done, Step 2 (DROP MG) fails

**What happened:** the default was reverted to `LEGACY`; the `DROP TRIGGER IF EXISTS live_classes_microphone_mode_guard` failed.

**Prerequisite diagnostic (read-only):**
- Query 1: failed row.
- Query 3: `Default: LEGACY` (confirms Step 1 committed).
- Query 2: old mode-guard trigger still present.

**Recovery (STATE-CHANGING — verify prerequisites before executing):**

```bash
npx prisma migrate resolve --rolled-back 20261030_fix_live_class_microphone_triggers
npx prisma migrate deploy
```

**Expected outcome:** re-execution re-runs the ALTER (idempotent), then `DROP TRIGGER IF EXISTS` removes the old MG regardless of its state, then both CREATEs succeed. `DROP IF EXISTS` makes the MG drop idempotent.

**Stop conditions:** stop if the DROP fails again — a metadata lock on `live_classes` (long-running transaction) is likely; identify and terminate the blocking session first (read-only: `SELECT * FROM information_schema.processlist WHERE state LIKE '%metadata lock%'`).

---

## Scenario C — Step 2 done, Step 3 (CREATE mode-guard) fails

**What happened:** the old mode-guard trigger was dropped; the new one was not created. **The `live_classes` table currently has NO mode-change guard — production authorization invariants are not enforced by the database.**

**Prerequisite diagnostic (read-only):**
- Query 1: failed row.
- Query 2: **no** `live_classes_microphone_mode_guard` at all (or only `live_classes_legacy_start_guard` absent too, since Step 4 never ran).
- Query 3: `Default: LEGACY`.

**Recovery (STATE-CHANGING — verify prerequisites before executing):**

```bash
# Run AS SOON AS POSSIBLE — every minute without the mode-guard trigger is an
# unguarded window in which a microphone_authorization_mode downgrade or
# active-LIVE upgrade can be written directly to the database.
npx prisma migrate resolve --rolled-back 20261030_fix_live_class_microphone_triggers
npx prisma migrate deploy
```

**Expected outcome:** deploy re-runs all four statements; both triggers created; guarded state restored.

**Risk note:** during the unguarded window, the application-level `ensureProtectedScheduledMicrophoneMode` (in `live-class.controller.js`) is the only defense-in-depth — it upgrades SCHEDULED LEGACY classes to `SFU_AUTHORITATIVE` on start. Raw SQL writes bypass it.

**Stop conditions:** stop if CREATE TRIGGER fails with a syntax/permission error; escalate to the DBA. Do not attempt manual `CREATE TRIGGER` out-of-band unless you are prepared to then follow the **No-row scenario** baselining procedure below.

---

## Scenario D — Step 3 done, Step 4 (CREATE start-guard) fails

**What happened:** the new mode-guard trigger exists; `live_classes_legacy_start_guard` was never created.

**Prerequisite diagnostic (read-only):**
- Query 1: failed row.
- Query 2: exactly one trigger — `live_classes_microphone_mode_guard` (new definition); **no** `live_classes_legacy_start_guard`.
- Query 3: `Default: LEGACY`.

**Recovery (STATE-CHANGING — verify prerequisites before executing):**

```bash
npx prisma migrate resolve --rolled-back 20261030_fix_live_class_microphone_triggers
npx prisma migrate deploy
```

**Expected outcome:** SG was never created, so re-execution drops MG (`DROP TRIGGER IF EXISTS`), re-creates MG, then creates SG. Both triggers present; guarded state complete.

**Stop conditions:** stop if the re-run fails at Step 4 for a reason other than "Trigger already exists" (that error belongs to scenario E, below).

---

## Scenario E — All four SQL statements completed, but Prisma recorded a failed row

**What happened:** every DDL committed (e.g. the connection dropped after the last DDL, before Prisma wrote `finished_at`). The database is fully correct; the migration-history record is wrong.

**Actual `migrate resolve --applied` engine behavior (Prisma 5.22.0 `MigrateResolve.ts`):**
This command does NOT simply set `finished_at` on the original failed row. The engine:
1. **Marks the existing failed row as rolled back** — sets `rolled_back_at` on the original failed row.
2. **Creates a NEW row** for the same migration name with `finished_at` populated (the "applied" record).
3. The original failed attempt's row is preserved with `rolled_back_at` set.

Result: **two rows** in `_prisma_migrations` for `20261030_fix_live_class_microphone_triggers` after `resolve --applied` on a failed row:
- Row 1 (original): `finished_at IS NULL, rolled_back_at IS NOT NULL` → state: ROLLED_BACK
- Row 2 (new): `finished_at IS NOT NULL, rolled_back_at IS NULL` → state: APPLIED

This matters for diagnostic queries: when checking if a migration is applied, the operator must look for a row with `finished_at IS NOT NULL AND rolled_back_at IS NULL`, not just any row.

**Prerequisite diagnostic (read-only) — MUST all be true before recovery:**
- Both `live_classes_microphone_mode_guard` AND `live_classes_legacy_start_guard` exist in `information_schema.triggers`.
- Each trigger's `action_statement` body matches the `20261030` migration SQL exactly (definition comparison required, not just name check). Use `SHOW COLUMNS FROM live_classes LIKE 'microphone_authorization_mode'` to verify default = `LEGACY`.
- `_prisma_migrations` has a row for `20261030_fix_live_class_microphone_triggers` with `finished_at IS NULL AND rolled_back_at IS NULL`.
- A naive `migrate deploy` REFUSES with a "failed migration — recover first" message (confirms the failed-row state).

**Recovery (OPERATOR-AUTHORIZED — verify ALL prerequisites before executing):**

```bash
# OPERATOR-AUTHORIZED ACTION — verify ALL prerequisites above first
npx prisma migrate resolve --applied 20261030_fix_live_class_microphone_triggers
```

**Post-recovery verification:**

```sql
-- READ-ONLY DIAGNOSTIC — may run at any time
-- Expect TWO rows: original failed row (rolled_back_at set) + new applied row (finished_at set)
SELECT migration_name, started_at, finished_at, rolled_back_at,
       CASE
         WHEN finished_at IS NOT NULL AND rolled_back_at IS NULL THEN 'APPLIED'
         WHEN rolled_back_at IS NOT NULL AND finished_at IS NULL THEN 'ROLLED_BACK'
         WHEN finished_at IS NULL AND rolled_back_at IS NULL THEN 'FAILED'
         ELSE 'UNKNOWN'
       END AS state
FROM _prisma_migrations
WHERE migration_name = '20261030_fix_live_class_microphone_triggers'
ORDER BY started_at;
```

Expect: two rows — one ROLLED_BACK (the original failed attempt) and one APPLIED (the new record). Then run:
```bash
npx prisma migrate status
```
Confirm no unapplied migrations remain.

**Expected outcome:** Prisma marks the original row as rolled back and creates a new applied row. `migrate deploy` subsequently recognizes the migration as applied and advances normally.

> **Do NOT use `--rolled-back` for this scenario.** `--rolled-back` marks the migration for re-application. `migrate deploy` will then re-execute all four statements and fail at Step 4 (`CREATE TRIGGER live_classes_legacy_start_guard`) with **MariaDB error 1359 "Trigger already exists"**, because that trigger was already created in Step 4 of the first (complete) execution and is not idempotently dropped by this migration. If `--rolled-back` was mistakenly used, see the error-handling note below.

**Stop conditions:** stop and do NOT run `--applied` if either trigger is missing or its definition does not match the migration — that is a partial state (scenarios A–D), not scenario E.

---

## No-Row Scenario — SQL applied out-of-band, no `_prisma_migrations` row

**What happened:** the four statements were executed manually or by a tool other than Prisma (for example, a DBA applying the triggers during an incident), so the objects exist but no migration row records them.

**Prerequisite diagnostic (read-only):**
- Query 1: **no row** for `20261030_fix_live_class_microphone_triggers`.
- Query 2: **both** triggers present with definitions matching the migration file.
- Query 3: `Default: LEGACY`.

**Recovery (STATE-CHANGING — verify prerequisites before executing):**

```bash
npx prisma migrate resolve --applied 20261030_fix_live_class_microphone_triggers
```

**Expected outcome:** `migrate resolve --applied` inserts a new applied row (this is the documented Prisma baselining mechanism — **no prior failed row is required** for this command). Prisma state now matches database state; future `migrate deploy` runs proceed.

**Stop conditions:** stop if any object is missing or wrong — baselining a partially applied migration produces drift that a later `migrate deploy` cannot resolve automatically.

---

## Anti-Patterns — Do Not Do These

- **`INSERT INTO _prisma_migrations` (manual row fabrication).** Invalid: the column `migration_type` does not exist in Prisma 5.22.0's `_prisma_migrations` table, and `checksum` is `NOT NULL` — prior proposals using this form are broken on both counts.
- **`UPDATE _prisma_migrations SET finished_at = ...` as a first resort.** `migrate resolve` is the documented tool; direct row updates bypass its state invariants.
- **Editing `backend/prisma/migrations/20261030_fix_live_class_microphone_triggers/migration.sql`.** Any change alters the file's checksum and causes Prisma drift on every environment where the original was applied. The historical migration is immutable.
- **Blindly retrying a partially executed migration.** `migrate deploy` refuses on an unresolved failed row; and an unclassified partial state may make re-execution fail (scenario E) or leave guards absent longer (scenario C). Always run the read-only diagnostics and classify the scenario first.

---

## Decision Tree

```
START: does a 20261030 row exist in _prisma_migrations?
│
├─ NO → verify triggers and default → resolve --applied (baselining; inserts new row)
│
└─ YES → check finished_at and rolled_back_at
         │
         ├─ finished_at IS NOT NULL AND rolled_back_at IS NULL → migration APPLIED; no action needed
         │
         ├─ rolled_back_at IS NOT NULL → already marked for re-apply
         │   └─ check whether an APPLIED row also exists (finished_at IS NOT NULL AND rolled_back_at IS NULL)
         │       ├─ APPLIED row exists → migration is applied; the ROLLED_BACK row is the prior failed attempt; no action needed
         │       └─ no APPLIED row → check for orphaned SG trigger → if SG exists, DROP it → migrate deploy
         │
         └─ both NULL (failed row)
             │
             ├─ verify: are BOTH triggers correct AND default is LEGACY?
             │   └─ YES → resolve --applied (scenario E)
             │
             └─ NO (partial state) → resolve --rolled-back → migrate deploy (scenarios A–D)
```

> After `resolve --applied` on a failed row, the query returns TWO rows: a ROLLED_BACK row (original failed attempt) and an APPLIED row. This is normal. Only the APPLIED row (`finished_at IS NOT NULL AND rolled_back_at IS NULL`) determines the migration state.

Recovery-evidence requirements: before and after any state-changing command, capture the output of the read-only diagnostic block (row state, trigger inventory, column default) and attach it to the incident record. The "after" capture is the proof the recovery reached a guarded, consistent state.

---

## Error-Handling Notes (per mutating command)

- **`npx prisma migrate resolve` fails** — check that the migration name is spelled exactly `20261030_fix_live_class_microphone_triggers` (the directory name, not the file name); check that the row exists in the expected state (`--rolled-back` expects a failed/rolled-back row; `--applied` for baselining expects no row, `--applied` for scenario E expects a failed row).
- **`npx prisma migrate deploy` fails at Step 4 with "Trigger already exists" (MariaDB error 1359)** — the operator chose `--rolled-back` for what was actually a scenario-E state. The SG trigger is orphaned. Remediation (STATE-CHANGING — verify with Query 2 first that MG matches the new definition and the default is `LEGACY`, i.e. the full SQL had indeed executed):

  ```sql
  -- STATE-CHANGING — verify prerequisites before executing
  DROP TRIGGER IF EXISTS live_classes_legacy_start_guard;
  ```

  then re-run `npx prisma migrate deploy`. Deploy re-executes the full migration (ALTER idempotent, MG dropped and recreated, SG created) and records a clean applied row.

---

## Immutable File Notice

`backend/prisma/migrations/20261030_fix_live_class_microphone_triggers/migration.sql` must remain byte-for-byte unchanged (SHA-256 `4fc783645ef9efbe181412e5abe32f3174a746ab9e1d585209ce26408c71cc80`). No instruction in this runbook, and no recovery path, authorizes editing it.
