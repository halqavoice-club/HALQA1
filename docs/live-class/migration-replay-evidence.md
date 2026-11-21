# Migration 20261030/20261115/20261116 — Replay Evidence

**Generated:** 2026-11-21
**Branch:** fix/migration-20261030-follow-up
**Purpose:** Documents the authoritative CI evidence and fault-injection design for issue #163 (trigger idempotency migration 20261115).

---

## 1. Authoritative CI Evidence (MariaDB 10.11)

| Item | Value |
|---|---|
| CI Run ID | 44913839633 |
| CI Job ID | 44913914537 |
| MariaDB version (CI) | 10.11.19 |
| Total migrations deployed | 109 |
| Integration test suites | 12/12 passed |
| Integration tests total | 337 passed, 0 failed |
| `liveclass-microphone-triggers` suite | PASS (12 tests) |
| `liveclass-microphone-default` suite | PASS (4 tests) |
| Backup/restore tables verified | 143 |
| Voice Consent E2E (web) | 1 passed, 1 conditionally skipped |
| Mobile consent jobs | Skipped (workflow_dispatch only — by design) |

The CI run is authoritative for MariaDB 10.11 compatibility. The local environment has neither Docker nor a local MariaDB/MySQL installation available; Docker-based local rehearsal is BLOCKED (see Section 2).

---

## 2. Local Replay Results

**Docker available:** NO
`docker` command not found in PATH. Docker Desktop is not installed or not running on this machine.

**Local MariaDB available:** NO
Neither `mysql` nor `mariadb` commands are available in PATH.

**Result:** Docker-based local rehearsal is BLOCKED. No local database environment is available for replay.

**Authoritative evidence source:** CI run 44913839633 (MariaDB 10.11.19) is the sole authoritative replay result. All 109 migrations deployed successfully against MariaDB 10.11.19 in CI. The fault-injection methodology is documented in Section 3 below; the recovery matrix in Section 4 is derived from analysis of the migration SQL and Prisma 5.22.0 engine behavior.

---

## 3. Fault-Injection Design — Scenario B (20261115)

The fault-injection methodology uses a **disposable migration copy** (`.fault-b` reference file) with a deliberately failing SQL statement injected between the DROP and CREATE statements. This reference file is never committed.

**Reference file:** `backend/prisma/migrations/20261115_harden_microphone_trigger_idempotency/migration.sql.fault-b`

**Injected fault position:** After both `DROP TRIGGER IF EXISTS` statements succeed, before either `CREATE TRIGGER` executes. This simulates the most hazardous partial-execution state: both triggers have been dropped but neither has been recreated.

**Expected state after fault injection:**
- `_prisma_migrations` row for `20261115_harden_microphone_trigger_idempotency`: FAILED (`finished_at IS NULL AND rolled_back_at IS NULL`)
- `live_classes_microphone_mode_guard`: ABSENT (dropped by step 1)
- `live_classes_legacy_start_guard`: ABSENT (dropped by step 2)
- Authorization invariants: **UNENFORCED** at the database level

**Recovery path:**
```bash
npx prisma migrate resolve --rolled-back 20261115_harden_microphone_trigger_idempotency
npx prisma migrate deploy
```

**Expected recovery outcome:** Both triggers recreated. `migrate deploy` applies the real `20261115` migration (DROP IF EXISTS × 2, CREATE × 2). No MariaDB error 1359 because the triggers are already absent.

**Why no MariaDB 1359 for 20261115:** Migration 20261115 begins with `DROP TRIGGER IF EXISTS` for BOTH triggers before creating them. Even if the triggers exist (from a prior successful `20261030` application), the DROPs remove them before the CREATEs run. This is the idempotency fix that 20261115 delivers.

---

## 4. Partial-Failure Recovery Matrix (20261115)

| Fault point | Objects present after fault | Recovery |
|---|---|---|
| Before Step 1 (DROP MG) | MG present, SG present | `--rolled-back` + `migrate deploy` (idempotent) |
| After Step 1, before Step 2 (DROP SG) | MG absent, SG present | `--rolled-back` + `migrate deploy` (Step 2 DROP SG, then CREATE both) |
| After Step 2, before Step 3 (CREATE MG) | MG absent, SG absent | `--rolled-back` + `migrate deploy` (critical: unguarded window; both DROPs are no-ops, both CREATEs succeed) |
| After Step 3, before Step 4 (CREATE SG) | MG present (new), SG absent | `--rolled-back` + `migrate deploy` (DROP MG drops it, DROP SG is no-op, CREATE MG recreates, CREATE SG creates) |
| After Step 4 (all done, Prisma failed) | MG present (new), SG present (new) | `--applied` (scenario E) |

**Key insight for 20261115 vs 20261030:** Unlike 20261030 (which had no DROP before the SG CREATE, making scenario E `--rolled-back` dangerous), 20261115 precedes each CREATE with a DROP IF EXISTS. This means `--rolled-back` + `migrate deploy` is safe for ALL partial states of 20261115, including scenario E — both DROPs are idempotent. `--applied` can also be used for 20261115 scenario E if the operator prefers.

---

## 5. Idempotency Verification (20261115 Re-execution Test)

From CI run 44913839633: migration 20261115 was applied successfully against MariaDB 10.11.19. The CI run confirmed:
- Both trigger definitions match the expected bodies.
- All 12 `liveclass-microphone-triggers` tests passed after 20261115 was applied.
- No MariaDB error 1359 was produced during the apply.

The DROP TRIGGER IF EXISTS guards in 20261115 mean that re-executing the migration against a database where both triggers already exist will: (1) silently drop both triggers, (2) recreate them with identical definitions. No error is produced.

---

## 6. Historical Checksum Verification

Migration `20261030_fix_live_class_microphone_triggers/migration.sql`:
- **SHA-256:** `4fc783645ef9efbe181412e5abe32f3174a746ab9e1d585209ce26408c71cc80`
- Status: UNCHANGED — this file must not be edited.
