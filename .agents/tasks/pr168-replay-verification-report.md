# PR #168 — Final Migration Replay Verification Report

**Branch:** `fix/migration-20261030-follow-up`  
**Head SHA (origin):** `f999d8f2c49650a152bad054c4a702c19d6758aa`  
**Head SHA (local):** `1ee242be9c6d04ef2e3a82138350402386bfbd67` (1 commit ahead of origin — not yet pushed)  
**Report generated:** 2026-11-21  
**Task:** `.agents/tasks/pr168-replay-verification/`  
**Issue:** #163

---

## 1. Executive Summary

This report covers the full Phase 7 rehearsal cycle for PR #168's migration
`20261115_harden_microphone_trigger_idempotency`. The initial migration deployment was
verified against MariaDB 10.11.19 by CI run 44913839633 (job 44913914537), with 109
migrations deployed and 337 integration tests passing. The fault-injection rehearsal
script (`backend/scripts/rehearse-migration-20261115.sh`) was added and wired into the
`backend-integration` CI job. Its first execution (CI run 44922509742, job 136901721574,
head SHA `f999d8f`) failed before any scenario could execute: the `halqa` CI user lacks
`CREATE DATABASE` privilege, so every throwaway schema creation was refused by MariaDB.
All five scenarios (A, B, C, D, N) are therefore **BLOCKED** — they were not executed,
and no scenario result (pass or fail) can be claimed. A fix (using root credentials for
schema creation/deletion while keeping `halqa` for Prisma operations) is committed locally
as `1ee242b` but has not yet been pushed to origin or run through CI. The merge verdict is
**CONDITIONAL**: the rehearsal infrastructure is correctly designed and all non-rehearsal
checks pass, but the fault-injection scenarios require a successful CI run against the
privilege-fixed script before the evidence gap identified by issue #163 is closed.

---

## 2. Results Table

| Scenario | MariaDB 10.11 executed? | Recovery passed? | Evidence |
|---|---|---|---|
| Initial migration (run 44913839633) | YES | PASS | CI run 44913839633, job 44913914537 — 109 migrations deployed, 337/337 integration tests passed |
| Normal replay (Scenario N) | NO | BLOCKED | CI run 44922509742, job 136901721574 — `halqa` user lacks `CREATE DATABASE` privilege; schema `halqa_rehearsal_n` creation refused before any step executed |
| A — After DROP MG | NO | BLOCKED | CI run 44922509742, job 136901721574 — same privilege failure; `halqa_rehearsal_a` creation refused |
| B — After CREATE MG, before DROP SG | NO | BLOCKED | CI run 44922509742, job 136901721574 — same privilege failure; `halqa_rehearsal_b` creation refused |
| C — After DROP SG, before CREATE SG | NO | BLOCKED | CI run 44922509742, job 136901721574 — same privilege failure; `halqa_rehearsal_c` creation refused |
| D — After CREATE SG (bookkeeping fail) | NO | BLOCKED | CI run 44922509742, job 136901721574 — same privilege failure; `halqa_rehearsal_d` creation refused |
| Scenario E resolution (two-row state) | NO | BLOCKED | Covered by Scenario D recovery — blocked for the same reason |

---

## 3. Detailed Scenario Findings

### Root cause applying to all scenarios (A, B, C, D, N)

The MariaDB 10.11 service in CI is provisioned with:

```
MYSQL_USER=halqa
MYSQL_PASSWORD=halqa_test_pw
MYSQL_DATABASE=halqa_test
```

MariaDB's default grant for a named user against a named database does not include
`CREATE DATABASE`. The rehearsal script called `CREATE DATABASE halqa_rehearsal_{a,b,c,d,n}`
as the `halqa` user. All five `CREATE DATABASE` calls returned an error (MariaDB access
denied), and each scenario immediately exited with:

```
[X] ERROR: Failed to create schema halqa_rehearsal_X
=== SCENARIO X RESULT: FAIL — could not create throwaway schema ===
```

No migration SQL was applied, no Prisma operations ran, and no trigger state was reached.
The failures are infrastructure failures, not scenario-logic failures.

**CI output (verbatim from log, representative for all five scenarios):**
```
[A] Creating throwaway schema: halqa_rehearsal_a
[A] ERROR: Failed to create schema halqa_rehearsal_a
=== SCENARIO A RESULT: FAIL — could not create throwaway schema ===
```

### Fix committed locally (not yet in CI)

Commit `1ee242be9c6d04ef2e3a82138350402386bfbd67` (local HEAD, not pushed):
- Adds `MYSQL_ROOT_USER` / `MYSQL_ROOT_PASSWORD` config vars (default `root`/`root`,
  matching the CI MariaDB service's `MYSQL_ROOT_PASSWORD`).
- Adds `mysql_root_schema()` helper that connects as root.
- Steps that `CREATE DATABASE` and `DROP DATABASE` (steps 2 and 12 of each scenario)
  now use `mysql_root_schema()`.
- After creating the schema, the script issues a `GRANT ALL PRIVILEGES ON halqa_rehearsal_X.*
  TO 'halqa'@'%'` so all Prisma operations still run under the `halqa` user.
- All application queries and Prisma migrations continue to use `mysql_cmd()` / `mysql_no_db()`
  with the `halqa` user.

This fix requires a CI run to confirm that all five scenarios execute and pass.

### Per-scenario expected states (design — not yet observed in execution)

| Scenario | Fault position | State after fault (expected) | Recovery command |
|---|---|---|---|
| A | After DROP MG (step 1), before CREATE MG (step 2) | MG absent, SG present, Prisma row: FAILED | `migrate resolve --rolled-back` + `migrate deploy` |
| B | After CREATE MG (step 2), before DROP SG (step 3) | MG present (new), SG present (old), Prisma row: FAILED | `migrate resolve --rolled-back` + `migrate deploy` |
| C | After DROP SG (step 3), before CREATE SG (step 4) | MG present (new), SG absent, Prisma row: FAILED | `migrate resolve --rolled-back` + `migrate deploy` |
| D | After CREATE SG (step 4), before Prisma records success | MG present (new), SG present (new), Prisma row: FAILED | `migrate resolve --applied` |
| N | No fault — normal apply then replay | Both triggers present | `migrate resolve --rolled-back` + `migrate deploy`, verify no error 1359 |

These states are based on the actual interleaved SQL order: DROP MG → CREATE MG → DROP SG → CREATE SG.

---

## 4. Authorization Invariant Verification

The integration test suite `liveclass-microphone-triggers` (12 tests) passed in CI run
44913839633, verifying the following invariants against the final trigger state:

| Invariant | Outcome (run 44913839633) |
|---|---|
| SFU_AUTHORITATIVE → LEGACY downgrade rejected | PASS |
| LIVE LEGACY → SFU_AUTHORITATIVE upgrade rejected | PASS |
| SCHEDULED LEGACY → SFU_AUTHORITATIVE allowed | PASS |
| ENDED LEGACY → SFU_AUTHORITATIVE allowed | PASS |
| SCHEDULED LEGACY → LIVE rejected | PASS |
| SCHEDULED SFU_AUTHORITATIVE → LIVE allowed | PASS |
| LIVE LEGACY → ENDED allowed | PASS |

**Per-scenario invariant verification (A–D, N):** Not executed. The rehearsal script
explicitly skips row-level trigger behavior tests because the throwaway schemas have no
seed data (foreign-key constraints on `live_classes` are unsatisfied). The integration
test suite above covers trigger behavior against the main test schema.

**Gap in trigger presence during migration (design analysis — unexecuted):**

| Migration step interval | MG present? | SG present? | Both absent? |
|---|---|---|---|
| Before step 1 (baseline) | YES (old) | YES (old) | Never |
| Step 1–2 interval (DROP MG done, CREATE MG pending) | NO | YES | No — SG guards during this interval |
| Step 2–3 interval (CREATE MG done, DROP SG pending) | YES (new) | YES (old) | Never |
| Step 3–4 interval (DROP SG done, CREATE SG pending) | YES (new) | NO | No — MG guards during this interval |
| After step 4 | YES (new) | YES (new) | Never |

Both triggers are never simultaneously absent at any point in the migration execution.

---

## 5. Files Changed in This PR Branch Addition

| File | Status | Notes |
|---|---|---|
| `backend/scripts/rehearse-migration-20261115.sh` | NEW — 517 lines | Fault-injection rehearsal script for 5 scenarios (A, B, C, D, N) |
| `.github/workflows/ci.yml` | MODIFIED | Rehearsal step added after drift-detection, before integration tests; `if: always()` cleanup step added |
| `docs/live-class/migration-replay-evidence.md` | MODIFIED | Corrected scenario boundaries, removed false PASSED claims, all execution results marked PENDING, Section 5 added |
| `docs/live-class/migration-20261030-recovery-runbook.md` | MODIFIED | Added 20261115 cross-reference section with recovery commands and diagnostic query |

**Additional local commit (not yet in CI):**

| File | Status | Notes |
|---|---|---|
| `backend/scripts/rehearse-migration-20261115.sh` | MODIFIED — `1ee242b` | Added root credential support for CREATE/DROP DATABASE; 21 lines added, 4 changed |

---

## 6. Immutability Verification

| File | Status | SHA-256 |
|---|---|---|
| `backend/prisma/migrations/20261115_harden_microphone_trigger_idempotency/migration.sql` | UNCHANGED | (not modified in any PR commit) |
| `backend/prisma/migrations/20261030_fix_live_class_microphone_triggers/migration.sql` | UNCHANGED | `4fc783645ef9efbe181412e5abe32f3174a746ab9e1d585209ce26408c71cc80` |

Both migration SQL files are confirmed unmodified by the review (`.agents/tasks/pr168-replay-verification/review.json` and `review.md`) and by `git show` inspection. Neither file appears in the diffs for commits `f999d8f` or `1ee242b`.

---

## 7. Final Verdict

### CONDITIONAL

**The merge is not yet ready.** The evidence gap described in issue #163 is not closed.

**What passes:**
- Initial migration deployment: MariaDB 10.11.19, 109 migrations, 337 integration tests — PASS (run 44913839633)
- Drift detection: clean (run 44922509742)
- Unit tests, lint, TypeScript, mobile TypeScript: all pass (run 44922509742)
- Regression — Selected Groups: pass (run 44922509742)
- Voice Consent E2E: pass (run 44922509838)
- Rehearsal infrastructure design: correct — fault boundaries match actual interleaved statement order, trap handler in place, cleanup step present
- Both historical migration SQL files: UNCHANGED, 20261030 checksum confirmed

**What is blocked:**
- Scenarios A, B, C, D, N: all BLOCKED (CI run 44922509742, job 136901721574)
  - Root cause: `halqa` CI user lacks `CREATE DATABASE` privilege
  - Fix committed locally as `1ee242b` — not pushed, not CI-verified

**Merge gate:**
1. Push `1ee242b` to `origin/fix/migration-20261030-follow-up`
2. CI must run the rehearsal step and all five scenarios must report PASS
3. Update `docs/live-class/migration-replay-evidence.md` Section 5 table with the passing run ID and job ID
4. Only after step 3 is the evidence gap closed and the branch ready for merge review

---

## Appendix A — CI Run Registry

| Run ID | Head SHA | Workflow | Conclusion | Purpose |
|---|---|---|---|---|
| 44913839633 | `741f9cc` | HALQA CI | success | Initial migration baseline — 109 migrations, 337 integration tests |
| 44913914537 | `741f9cc` | HALQA CI | success | Same run, job: `Backend -- Integration Tests (MariaDB 10.11)` |
| 44918521786 | `3641bac` | HALQA CI | success | Pre-rehearsal state |
| 44922509742 | `f999d8f` | HALQA CI | **failure** | First rehearsal run — all scenarios BLOCKED (privilege issue) |
| 44922509742 / job 136901721574 | `f999d8f` | Backend -- Integration Tests (MariaDB 10.11) | **failure** | Rehearsal step BLOCKED |

## Appendix B — Open Issues from Review

The peer review (`.agents/tasks/pr168-replay-verification/review.md`) identified three issues:

1. **CI cleanup comment lie** — The `Cleanup rehearsal throwaway schemas` CI step includes a comment claiming it restores `migration.sql` on crash, but the code only runs `echo "Cleanup complete"`. If the runner is killed (OOM/timeout) before `trap EXIT` fires, `migration.sql` is left modified. Resolution required before merge.

2. **Scenario D history not asserted** — The script prints `_prisma_migrations` row states but sets no failure flag if the two-record structure (one ROLLED_BACK, one APPLIED) is not present. A wrong row count still reports PASS as long as `migrate status` is clean.

3. **Prisma checksum assumption unverified** — The script assumes `resolve --rolled-back` allows re-deploy with a different on-disk checksum (the fault SQL differs from the original). If Prisma 5.22.0 compares the new checksum against the previously-failed row's stored checksum, the fault deploy step would fail for the wrong reason. This would be detected on the first successful rehearsal run.

Issues 1 and 2 should be addressed in a follow-up commit before merge. Issue 3 will be revealed by the first successful CI rehearsal run.
