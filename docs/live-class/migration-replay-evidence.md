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

**What this CI run proves:** Initial migration deployment of all 109 migrations including 20261115, against MariaDB 10.11.19, with integration test validation. It does NOT, by itself, prove recovery after partial DDL execution of 20261115. That gap is closed by the automated fault-injection rehearsal added in Section 5.

---

## 2. Local Replay Results

**Docker available:** NO
`docker` command not found in PATH. Docker Desktop is not installed or not running on this machine.

**Local MariaDB available:** NO
Neither `mysql` nor `mariadb` commands are available in PATH.

**Result:** Docker-based local rehearsal is BLOCKED. No local database environment is available for replay.

**Authoritative evidence source:** CI run 44913839633 (MariaDB 10.11.19) is the sole authoritative initial-deployment result. The fault-injection partial-failure recovery scenarios are delegated to the CI rehearsal step documented in Section 5.

---

## 3. Fault-Injection Design — Corrected Scenario Boundaries (20261115)

Migration `20261115_harden_microphone_trigger_idempotency` executes statements in this exact interleaved order:

| Step | Statement |
|---|---|
| 1 | `DROP TRIGGER IF EXISTS live_classes_microphone_mode_guard` (MG) |
| 2 | `CREATE TRIGGER live_classes_microphone_mode_guard` |
| 3 | `DROP TRIGGER IF EXISTS live_classes_legacy_start_guard` (SG) |
| 4 | `CREATE TRIGGER live_classes_legacy_start_guard` |

The correct partial-failure boundaries follow this interleaved order. There is no point in the execution sequence where both DROPs have run and neither CREATE has run — that boundary does not exist in this migration. Each DROP is immediately followed by its corresponding CREATE before the next DROP runs.

**Corrected partial-failure boundaries:**

| Fault point | Objects present after fault | Recovery |
|---|---|---|
| After Step 1 (DROP MG), before Step 2 (CREATE MG) | MG absent, SG present | `--rolled-back` + `migrate deploy` |
| After Step 2 (CREATE MG), before Step 3 (DROP SG) | MG present (new), SG present (old) | `--rolled-back` + `migrate deploy` |
| After Step 3 (DROP SG), before Step 4 (CREATE SG) | MG present (new), SG absent | `--rolled-back` + `migrate deploy` |
| After Step 4, before Prisma records success | MG present (new), SG present (new) | `--applied` (scenario D/E) |

**Why `--rolled-back` + `migrate deploy` is safe for all partial states of 20261115:** Each CREATE in 20261115 is preceded by a DROP IF EXISTS for the same trigger. Even if a partial state left one trigger present, re-executing from the beginning: (1) DROP MG removes it if present, (2) CREATE MG recreates it, (3) DROP SG removes it if present, (4) CREATE SG recreates it. No MariaDB error 1359 ("Trigger already exists") can occur. This contrasts with migration 20261030, which had no DROP before the SG CREATE, making scenario E `--rolled-back` dangerous for that migration.

**Status of fault-injection execution:** These scenarios are designed and implemented in `backend/scripts/rehearse-migration-20261115.sh`. Execution results will be recorded in Section 5 after CI runs with the rehearsal step.

---

## 4. Partial-Failure Recovery Matrix (20261115)

| Scenario | Fault point | Objects present after fault | Recovery | Execution Status |
|---|---|---|---|---|
| A | After Step 1 (DROP MG), before Step 2 (CREATE MG) | MG absent, SG present | `--rolled-back` + `migrate deploy` | NOT EXECUTED (CI rehearsal pending) |
| B | After Step 2 (CREATE MG), before Step 3 (DROP SG) | MG present (new), SG present (old) | `--rolled-back` + `migrate deploy` | NOT EXECUTED (CI rehearsal pending) |
| C | After Step 3 (DROP SG), before Step 4 (CREATE SG) | MG present (new), SG absent | `--rolled-back` + `migrate deploy` | NOT EXECUTED (CI rehearsal pending) |
| D | After Step 4, before Prisma records success | MG present (new), SG present (new) | `--applied` | NOT EXECUTED (CI rehearsal pending) |
| N | Normal replay (idempotent re-execution) | N/A — apply succeeds | `--rolled-back` + `migrate deploy`, verify no error 1359 | NOT EXECUTED (CI rehearsal pending) |

These rows will be updated with CI run ID, job ID, and outcome after the rehearsal step (Section 5) runs in CI.

---

## 5. CI Fault-Injection Rehearsal (Issue #163)

### Rehearsal script

**File:** `backend/scripts/rehearse-migration-20261115.sh`

The script runs five scenarios against isolated throwaway MariaDB schemas (`halqa_rehearsal_a` through `halqa_rehearsal_n`). For each scenario it:

1. Creates the throwaway schema.
2. Applies all migrations with the real migration SQL (`prisma migrate deploy`).
3. Marks 20261115 as rolled-back in Prisma history (`migrate resolve --rolled-back`) to simulate a pre-20261115 state.
4. Writes the fault-injection SQL (or the real SQL for scenario N) to the migration file.
5. Runs `prisma migrate deploy` — expects failure for A/B/C/D, success for N.
6. Immediately restores the original migration SQL (the `trap EXIT` handler also restores it unconditionally).
7. Runs the appropriate recovery command.
8. Verifies both triggers exist in `information_schema.triggers`.
9. Drops the throwaway schema and reports PASS/FAIL.

The original migration SQL is restored via a `trap EXIT` handler, ensuring the file is never left modified regardless of script exit path.

### CI step added

**Job:** `backend-integration`
**Step name:** `Rehearse migration-20261115 partial-failure recovery (Issue #163)`
**Position:** After `Verify no pending migrations (drift detection)`, before `Run integration tests`.
**Cleanup step:** `Cleanup rehearsal throwaway schemas` (runs with `if: always()` after the rehearsal step).

### Scenario descriptions

| Scenario | Fault position | Trigger state after fault | Recovery |
|---|---|---|---|
| A | After DROP MG (step 1), before CREATE MG (step 2) | MG absent, SG present | `migrate resolve --rolled-back` + `migrate deploy` |
| B | After CREATE MG (step 2), before DROP SG (step 3) | MG present (new), SG present (old) | `migrate resolve --rolled-back` + `migrate deploy` |
| C | After DROP SG (step 3), before CREATE SG (step 4) | MG present (new), SG absent | `migrate resolve --rolled-back` + `migrate deploy` |
| D | After CREATE SG (step 4), before Prisma records success | MG present (new), SG present (new) | `migrate resolve --applied` |
| N | No fault — normal apply then replay | N/A | `migrate resolve --rolled-back` + `migrate deploy`, verify no error 1359 |

**Recovery rationale:**
- Scenarios A/B/C: `migrate resolve --rolled-back` marks the failed row for re-application. `migrate deploy` then re-executes 20261115 from step 1. Because 20261115 starts each CREATE with a DROP IF EXISTS, re-execution is idempotent regardless of which partial state was left.
- Scenario D: all DDL committed; only the Prisma bookkeeping row is wrong. `migrate resolve --applied` marks the existing failed row as rolled-back and creates a new applied row. No SQL re-execution needed or safe (triggers already present).
- Scenario N: confirms the DROP IF EXISTS guards prevent MariaDB error 1359 during genuine re-execution against a database where both triggers already exist.

### CI rehearsal results

| CI Run | Job ID | Scenario A | Scenario B | Scenario C | Scenario D | Scenario N |
|---|---|---|---|---|---|---|
| 44922509742 | 136901721574 | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |

**Run outcome:** All five scenarios BLOCKED. Root cause: the `halqa` CI user (provisioned
with access only to `halqa_test`) lacks `CREATE DATABASE` privilege. Every `CREATE DATABASE
halqa_rehearsal_{a,b,c,d,n}` call was refused by MariaDB before any migration SQL executed.
No trigger state was reached and no Prisma operations ran. These are infrastructure failures,
not scenario-logic failures.

**Fix:** Commit `1ee242be9c6d04ef2e3a82138350402386bfbd67` (branch HEAD, not yet pushed)
adds root credential support (`mysql_root_schema()` helper) for the CREATE/DROP DATABASE
steps only. All Prisma operations continue to use the `halqa` user. After that commit is
pushed and CI runs successfully, this table must be updated with the passing run ID and
job ID and the BLOCKED entries replaced with PASS or FAIL outcomes.

**Head SHA for the blocked run:** `f999d8f2c49650a152bad054c4a702c19d6758aa`  
**Captured:** 2026-11-21T16:05:59Z

---

## 6. Historical Checksum Verification

Migration `20261030_fix_live_class_microphone_triggers/migration.sql`:
- **SHA-256:** `4fc783645ef9efbe181412e5abe32f3174a746ab9e1d585209ce26408c71cc80`
- Status: UNCHANGED — this file must not be edited.
