## Context

`backend/prisma/migrations/20261030_fix_live_class_microphone_triggers/migration.sql` creates `live_classes_legacy_start_guard` (Step 4) with a bare `CREATE TRIGGER` and no preceding `DROP TRIGGER IF EXISTS live_classes_legacy_start_guard`. If the trigger already exists when Steps 1–4 re-execute (scenario E recovered via `--rolled-back`, or an orphaned trigger), Step 4 fails with MariaDB error 1359 (`Trigger already exists`). The `live_classes_microphone_mode_guard` trigger (Step 3) is already preceded by `DROP TRIGGER IF EXISTS` in 20261030.

The historical migration must **not** be edited: editing changes its checksum and causes Prisma drift.

**Immutable reference:** SHA-256 of `backend/prisma/migrations/20261030_fix_live_class_microphone_triggers/migration.sql` at main `e15dad23a8333667f895d4e3649f0f47bd3696c6` = `4fc783645ef9efbe181412e5abe32f3174a746ab9e1d585209ce26408c71cc80`. The PR reviewer re-runs `(Get-FileHash -Algorithm SHA256)` (or `sha256sum`) on the final branch and confirms it matches.

## Problem

The trigger-creation step of 20261030 is non-idempotent for `live_classes_legacy_start_guard`, producing a recoverable-but-hazardous failure path: any re-execution attempt fails on error 1359, and an operator recovering a scenario-E state with `--rolled-back` enters that path.

## Scope

- New forward-only migration (planned directory: `backend/prisma/migrations/20261115_harden_microphone_trigger_idempotency/migration.sql`; must sort lexicographically after `20261114_add_post_report_pending_unique`). The date is illustrative — use the current date; the invariant is the lexicographic ordering.
- Inspect both current microphone triggers; issue `DROP TRIGGER IF EXISTS live_classes_microphone_mode_guard` and `DROP TRIGGER IF EXISTS live_classes_legacy_start_guard` before re-creating them.
- Recreate both trigger bodies **identical** to those in 20261030 — all authorization invariants preserved exactly:
  - SFU_AUTHORITATIVE → LEGACY downgrade blocked.
  - LIVE LEGACY → SFU_AUTHORITATIVE upgrade blocked.
  - Mode changes outside SCHEDULED/LIVE/ENDED (and non-LIVE, non-ENDED transitions) blocked.
  - SCHEDULED LEGACY → LIVE status transition blocked.
- Sequence must be DROP old, CREATE new for each trigger in turn — **never** a window where both triggers are absent simultaneously (DROP MG → CREATE MG → DROP SG → CREATE SG).
- Account for MariaDB 10.11 DDL implicit commits: each statement is its own implicit transaction, so partial execution leaves a partial state; the new migration's re-execution at any point is safe because both CREATEs are preceded by `DROP IF EXISTS`.

## Partial-execution behavior to document

| Failure point | Resulting state | Recovery |
|---|---|---|
| After DROP MG, before CREATE MG | mode-guard absent | `--rolled-back` then `migrate deploy` (safe: DROP IF EXISTS on absent trigger is a no-op) |
| After CREATE MG, before DROP SG | MG correct, SG still from 20261030 | `--rolled-back` then `migrate deploy` |
| After DROP SG, before CREATE SG | SG absent, MG correct | `--rolled-back` then `migrate deploy` |
| All four done, `finished_at` NULL | Complete, unrecorded | `--applied` after verifying both triggers |

## Acceptance criteria

1. A new forward-only migration exists in `backend/prisma/migrations/` sorting after `20261114`.
2. The new migration includes `DROP TRIGGER IF EXISTS live_classes_legacy_start_guard` (and for `live_classes_microphone_mode_guard`) before the corresponding `CREATE TRIGGER`.
3. Historical `20261030` migration file is byte-for-byte unchanged (checksum comparison against `4fc783645ef9efbe181412e5abe32f3174a746ab9e1d585209ce26408c71cc80`).
4. Re-execution of the new migration (simulated retry) does not produce "Trigger already exists".
5. After the migration, `SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'live_classes'` returns exactly `live_classes_microphone_mode_guard` and `live_classes_legacy_start_guard`.
6. All 12 tests in `backend/src/tests/integration/liveclass-microphone-triggers.integration.test.js` pass after the migration.
7. No authorization regression: trigger semantics functionally identical to post-20261030.
8. Partial-execution behavior documented (table above) and tested; rehearsal log attached to the PR.
9. No window in which both triggers are absent.

## Rehearsal plan (disposable MariaDB 10.11)

1. `docker run -d --name mic-trig-test -e MYSQL_ROOT_PASSWORD=test -e MYSQL_DATABASE=halqa_test mariadb:10.11`
2. `npx prisma migrate deploy` through 20261030, then apply the new migration.
3. Simulate retry: in the **disposable container only** (never production/staging), `UPDATE _prisma_migrations SET finished_at = NULL, rolled_back_at = NOW() WHERE migration_name = '<new migration name>';` then `npx prisma migrate deploy` — must succeed with no error 1359.
4. Verify trigger inventory (expected exactly the two triggers).
5. Run the 12-test trigger integration suite.
6. `docker rm -f mic-trig-test`.

## Verification plan

- `SHOW COLUMNS FROM live_classes LIKE 'microphone_authorization_mode'` still reports `LEGACY` (default untouched by this migration).
- Checksum verification of 20261030 before and after the branch.
- CI job `Backend -- Integration Tests (MariaDB 10.11)` green.

## Related

- Follows the recovery runbook (#162).
- Prerequisite for the database default reconciliation issue (#164): that migration depends on a known, stable trigger state established here.
