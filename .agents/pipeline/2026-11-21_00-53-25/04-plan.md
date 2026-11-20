# Implementation Plan — Migration 20261030 Recovery, Trigger Safety, Microphone Authorization Consistency

Source: approved design `02-design.md` (this run). The plan is decomposed into six FEAT artifacts under
`.agents/pipeline/2026-11-21_00-53-25/task-20261030-migration-safety/` (see `context.json` and `features/FEAT-00*.json`).
This file is the equivalent ordered checklist and the fallback plan.

Key environment facts (verified during planning):
- Repo root = workspace root; branch `main` at `e15dad23a8333667f895d4e3649f0f47bd3696c6`; remote `halqavoice-club/HALQA1`; `gh` authenticated.
- Local DB: XAMPP MariaDB **10.4.32** at 127.0.0.1:3306 (root, no password); `halqa_db` (dev, migrations applied only through 20261113 — 20261030 NOT applied locally); CLI at `C:\xampp\mysql\bin\mysql.exe`. No Docker; CI provides MariaDB 10.11.
- Test classification: EVERY new test file under `backend/src/tests/` must be added to `backend/test-safety/safe-test-manifest.js` (SAFE_UNIT_TESTS or DESTRUCTIVE_TESTS) or the unit launcher throws `unclassified test file`.
- Unit runs strip DATABASE_URL and block `new PrismaClient`; controller unit tests must `jest.mock('../utils/prisma')` instead of mocking controller-internal helpers (fixes the design review's MEDIUM finding).
- 20261030 SHA-256: `4fc783645ef9efbe181412e5abe32f3174a746ab9e1d585209ce26408c71cc80` (must stay unchanged).
- No existing GitHub issues cover any of the six topics (searched open+closed).

- [ ] 1. **FEAT-001 (chore)** — Open the six GitHub issues on `halqavoice-club/HALQA1` (P1 runbook, P2 trigger idempotency, P2 DB default, P2 Prisma default test, P2 HTTP 409, P2 raw-SQL helpers). Bodies derived from `01-requirements.md` + `02-design.md`; priority in title; labels `documentation`/`enhancement`; Issue 2 body records the 20261030 checksum. No duplicates exist.
      Files: issue bodies only (drafted at runtime via `gh issue create --body-file`).
      Verify: `gh issue list -R halqavoice-club/HALQA1 --state open --search "microphone OR 20261030"` shows six new issues; record numbers in FEAT-001 findings.

- [ ] 2. **FEAT-002 (docs)** — Write `docs/live-class/migration-20261030-recovery-runbook.md` per the design: 8-column `_prisma_migrations` reference, three row states, scenarios A–E + no-row with diagnostics/commands/expected outcome/stop conditions, read-only vs state-changing labels, anti-patterns box, ASCII decision tree, `migrate deploy` refusal semantics, `SHOW COLUMNS`/trigger verification SQL.
      Files: `docs/live-class/migration-20261030-recovery-runbook.md` (new); optional link line in `docs/live-class/README.md`.
      Verify: document exists and covers FR-1.1…FR-1.12 (reviewer checklist); historical migration untouched (checksum step 4fc78364…).

- [ ] 3. **FEAT-003 (test)** — Test helper hygiene (Issue 6). Extend `rawInsertLC` (live-class.integration.test.js) and `createTestLC` (live-class-real-db.test.js) to conditionally include `microphone_authorization_mode`; update all 9 + ~12 call sites to pass `microphoneAuthorizationMode: 'SFU_AUTHORITATIVE'` (with the explanatory comment at the SUPER_ADMIN GATE-F02 site); make `backend/fix-live-class-columns.js` Step 10 INSERT explicit (`'SFU_AUTHORITATIVE'`). No production files touched.
      Files: `backend/src/tests/integration/live-class.integration.test.js`, `backend/src/tests/live-class-real-db.test.js`, `backend/fix-live-class-columns.js`.
      Verify: `node --check` all three; integration run of `live-class.integration.test.js` passes against `halqa_test` (created + `npx prisma migrate deploy`); optional real-db run after inserting the 8 header identities + 2 schools into `halqa_test`.

- [ ] 4. **FEAT-004 (feat)** — HTTP 409 for trigger rejection (Issue 5). Add `LEGACY_SESSION_START_REJECTION_MESSAGE` + `isTriggerLegacyStartRejection(err)` to `backend/src/utils/liveClassMicrophoneContract.js`; narrow `startLiveClass`'s catch in `backend/src/controllers/live-class.controller.js` to return `errorResponse(res, 'The microphone authorization mode must be upgraded before starting this class.', 409)` on match, else `next(e)`. Unit tests in `backend/src/tests/live-class-microphone-unit-a.test.js`: helper tests + controller dispatch tests that `jest.mock('../utils/prisma')` (mock `$queryRawUnsafe` → SCHEDULED SFU class row; `$executeRawUnsafe` → rejects trigger message / unrelated error) and mock `../sockets`, `../utils/feedLive`, `../services/liveclass-microphone-authority.service`.
      Files: the three files above.
      Verify: `cd backend; node test-safety/run-jest.js src/tests/live-class-microphone-unit-a.test.js` — all pass, including 409 and 500 dispatch cases; then `npm run test:unit` stays green.

- [ ] 5. **FEAT-005 (test)** — Prisma default integration test (Issue 4). New `backend/src/tests/integration/liveclass-microphone-default.integration.test.js` with the four cases per design (self-contained `PrismaClient`, `slug`/`country` school fixture, `firstName`/`lastName`/`passwordHash` teacher fixture, `createdLcIds` cleanup, Case 1 asserts `e.params` contains `SFU_AUTHORITATIVE`, Case 3 derives expected default from `_prisma_migrations`). **Register the file in DESTRUCTIVE_TESTS in `backend/test-safety/safe-test-manifest.js`** (alphabetical position) in the same commit.
      Files: new test file, `backend/test-safety/safe-test-manifest.js`.
      Verify: `npm run test:unit` still runs (manifest audit passes); test passes against `halqa_test` before the reconciliation migration (Case 3 expects LEGACY); re-run after FEAT-006 (Case 3 expects SFU_AUTHORITATIVE).

- [ ] 6. **FEAT-006 (feat)** — Forward-only migrations (Issues 2+3). Create `backend/prisma/migrations/20261115_harden_microphone_trigger_idempotency/migration.sql` (DROP IF EXISTS + byte-identical trigger bodies per design) and `backend/prisma/migrations/20261116_reconcile_microphone_authorization_default/migration.sql` (ALTER … SET DEFAULT 'SFU_AUTHORITATIVE'). Historical 20261030 untouched.
      Files: the two new migration dirs.
      Verify (local, MariaDB 10.4; CI is the 10.11 gate): `npx prisma migrate deploy` on `halqa_test` applies both; both triggers present via information_schema; `SHOW COLUMNS … LIKE 'microphone_authorization_mode'` → `SFU_AUTHORITATIVE`; re-execution rehearsal (UPDATE `_prisma_migrations` to rolled-back in `halqa_test`, re-deploy — no error 1359); 12-test trigger suite + `live-class.integration.test.js` + FEAT-005 test all pass; `npx prisma migrate status` clean; 20261030 checksum still `4fc78364…`.

- [ ] 7. Convergence: full backend unit suite + full integration suite against `halqa_test`; fix cross-FEAT seams; semantic review writes `…\.agents\tasks\task-20261030-migration-safety\verdict.json`.

## Digest

| File | Change | Test | Verified today |
|---|---|---|---|
| `backend/src/utils/liveClassMicrophoneContract.js` (exports `MICROPHONE_AUTHORIZATION_MODES` etc.) | add constant + `isTriggerLegacyStartRejection` | `live-class-microphone-unit-a.test.js` (already in SAFE_UNIT_TESTS) | file read in full |
| `backend/src/controllers/live-class.controller.js` — `startLiveClass` (lines ~844–890, catch at 889) | replace `catch (e) { next(e); }` with 409/500 dispatch | same unit file | catch blocks located; `errorResponse(res,msg,code)` usage confirmed (line 3 import) |
| `backend/src/tests/integration/live-class.integration.test.js` — `rawInsertLC` lines 139–160; call sites 233, 266, 285, 324, 355, 407, 441, 490, 551 | conditional mode column + call-site annotations | `npm run test:integration -- <file>` (jest.integration.config) | helper + all 9 call sites read |
| `backend/src/tests/live-class-real-db.test.js` — `createTestLC` lines 88–122; 8 identity constants lines 43–51 | conditional mode column; call sites pass SFU | direct jest run w/ fixture identities; `node --check` | helper + call sites read |
| `backend/fix-live-class-columns.js` — Step 10 INSERT (~line 140) | explicit mode `'SFU_AUTHORITATIVE'` | `node --check` | file listed |
| `backend/test-safety/safe-test-manifest.js` — DESTRUCTIVE_TESTS (lines 183–202) | add new integration test path | `npm run test:unit` (auditClassification) | manifest read |
| `backend/prisma/migrations/` | two new dirs, sort after 20261114 | migrate deploy + trigger/default queries + rehearsal | migrations dir listed; 20261030 read; checksum computed |
| `docs/live-class/migration-20261030-recovery-runbook.md` | new doc | FR-1.1–1.12 checklist | docs dir listed |

Build/test commands (verified): `cd backend; npm run test:unit` (safe manifest only), `npm run test:integration` (requires `DATABASE_URL` env; `jest.integration.config.js`), `node --check <file>`, `npx prisma migrate deploy`, `gh` CLI v2.102 authenticated.
Local DB: `halqa_test` must be created (`DROP DATABASE IF EXISTS halqa_test; CREATE DATABASE halqa_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`) before integration runs.
