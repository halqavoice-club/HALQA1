## Context

Three audit cycles (`migration-20261030-audit-report.md`, `migration-20261030-recovery-audit.md`, `migration-20261030-final-recovery-audit.md`, `migration-20261030-rehearsal-validation.md`, all under `.agents/tasks/`) reviewed the recovery posture of migration `20261030_fix_live_class_microphone_triggers`. The final rehearsal validation audit corrected two categories of errors in prior guidance: (a) the prior recovery matrix incorrectly described naive `migrate deploy` behavior against an unresolved failed migration, and (b) a proposed manual `INSERT INTO _prisma_migrations` is invalid (references a non-existent `migration_type` column and passes `NULL` for the `NOT NULL` `checksum` column). No authoritative operator reference consolidates the corrected findings.

## Problem

There is no single, correct, incident-ready runbook for diagnosing and recovering failures during `20261030_fix_live_class_microphone_triggers`. Operators following the superseded guidance could take unsafe recovery paths (blind retries, fabricated `_prisma_migrations` rows, `--rolled-back` for a scenario-E state).

## Scope

New document: `docs/live-class/migration-20261030-recovery-runbook.md`.

The runbook must cover, at minimum:

- **`_prisma_migrations` actual eight-column structure** for Prisma 5.22.0 on MySQL/MariaDB: `id`, `checksum`, `finished_at`, `migration_name`, `logs`, `rolled_back_at`, `started_at`, `applied_steps_count`. It must explicitly note that `migration_type` does **not** exist.
- The three row states for 20261030 and their SQL signatures: failed (`finished_at IS NULL AND rolled_back_at IS NULL`), rolled-back (`rolled_back_at IS NOT NULL`), applied (`finished_at IS NOT NULL`).
- `npx prisma migrate deploy` **refuses** to advance when an unresolved failed migration row exists — it does not re-execute the SQL.
- Correct use of `prisma migrate resolve --applied` (scenarios E and no-row).
- Correct use of `prisma migrate resolve --rolled-back` (scenarios A–D).
- The six named scenarios:
  - **Scenario A** — failure before Step 1 (ALTER DEFAULT) completes → `--rolled-back` then `migrate deploy`.
  - **Scenario B** — failure after Step 1, before Step 2 (DROP MG) → `--rolled-back` then `migrate deploy`.
  - **Scenario C** — failure after Step 2, before Step 3 (CREATE mode-guard) → `--rolled-back` then `migrate deploy` ASAP (unguarded window risk noted).
  - **Scenario D** — failure after Step 3, before Step 4 (CREATE start-guard) → `--rolled-back` then `migrate deploy`.
  - **Scenario E** — all four SQL statements committed, Prisma recorded a failed row (`finished_at` NULL) → `--applied` **after** verifying both triggers are present and correct. `--rolled-back` is unsafe here: re-execution fails at Step 4 with MariaDB error 1359 (Trigger already exists).
  - **No-row scenario** — SQL applied out-of-band, no `_prisma_migrations` row → verify objects, then `--applied` (documented Prisma baselining mechanism; no failed row required).
- Trigger existence/definition verification: `SELECT trigger_name, action_statement FROM information_schema.triggers WHERE trigger_schema = DATABASE() AND event_object_table = 'live_classes'`.
- Database default verification: `SHOW COLUMNS FROM live_classes LIKE 'microphone_authorization_mode'` (expected `LEGACY` after 20261030).
- An operator decision tree (row state → recovery path) with recovery-evidence requirements.
- Every SQL statement labeled either **read-only diagnostic** or **state-changing — confirm prerequisites before executing**.

## Anti-patterns (must be stated explicitly)

- Never fabricate `_prisma_migrations` rows with manual `INSERT` (`migration_type` does not exist; `checksum` is NOT NULL).
- Never use `UPDATE _prisma_migrations` as a first resort — `migrate resolve` is the documented tool.
- Never edit the historical migration file (checksum drift).
- Never blindly retry a partially executed migration.
- No recovery operation presented as universally safe; every write gated on a prior read-only diagnostic.

## Acceptance criteria

1. The runbook exists as a file in `docs/` (the plan places it at `docs/live-class/migration-20261030-recovery-runbook.md`) and is suitable for use by an operator during a production incident.
2. Each of the six scenarios (A–E, no-row) has its own section with: diagnostic steps, recovery command(s), expected outcome, and stop conditions.
3. Scenario E's recovery is `migrate resolve --applied`, never `--rolled-back`.
4. No scenario recommends a direct `INSERT INTO _prisma_migrations` or `UPDATE`.
5. The document explicitly states `migration_type` is not a column, and that naive `migrate deploy` refuses (does not re-run SQL) on a failed row.
6. Commands distinguish read-only diagnostics from state-changing recovery operations.
7. The historical migration `backend/prisma/migrations/20261030_fix_live_class_microphone_triggers/migration.sql` remains byte-for-byte unchanged (SHA-256 `4fc783645ef9efbe181412e5abe32f3174a746ab9e1d585209ce26408c71cc80`), and the runbook never instructs editing it.

## Verification plan

- Review the document against this issue's FR list (FR-1.1 through FR-1.12 in the pipeline requirements doc).
- Dry-run each read-only diagnostic SQL against a disposable MariaDB 10.11 instance with 20261030 applied.
- Confirm `git diff` shows no change to any migration file.

## Related

- Implements the P1 deliverable from the Migration 20261030 master prompt pack (PROMPT 0, Issue 1).
