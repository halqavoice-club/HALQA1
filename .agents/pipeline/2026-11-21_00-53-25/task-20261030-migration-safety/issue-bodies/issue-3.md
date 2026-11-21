## Context

After `20261030`, `live_classes.microphone_authorization_mode` has `DEFAULT 'LEGACY'` at the database level, but `backend/prisma/schema.prisma` declares `@default(SFU_AUTHORITATIVE)`. Prisma Client sends `@default` in the INSERT payload, so the DB default is never observed through Prisma ORM creates. However, raw-SQL INSERTs that omit the column receive `LEGACY` from the DB default, and `prisma migrate dev` reports schema drift.

## Direction decision (to be stated in the implementation PR)

**Align the DB column default to `SFU_AUTHORITATIVE`** (match `schema.prisma`). Rationale:

- The production create path (`rawCreateLiveClass` in `backend/src/controllers/live-class.controller.js`) always sets `microphone_authorization_mode` explicitly to `SFU_AUTHORITATIVE`; the DB default is never observed for new rows through the application.
- `schema.prisma @default(SFU_AUTHORITATIVE)` reflects product intent (all new classes SFU-ready) and must remain unchanged.
- Changing `schema.prisma @default` to `LEGACY` would require Prisma client regeneration and diverge from product intent without a customer-facing reason.
- The only consumers of the implicit `LEGACY` default are raw-SQL test helpers — which the raw-SQL helpers issue makes explicit, so nothing depends on `LEGACY` after that lands.

Existing row values must **not** be rewritten; only the column's `DEFAULT` clause changes.

## Dependencies

- Depends on the trigger-idempotency issue (#163) (stable trigger state must be established first; the reconciliation migration must sort lexicographically after that migration — verify migration directory names before creating the PR; the trigger migration must have `finished_at IS NOT NULL` in rehearsal before applying this one).
- Depends on the raw-SQL test-helpers issue (#167) (helpers must no longer depend on the `LEGACY` implicit default before or alongside this migration).

## Scope

- New forward-only migration (planned directory: `backend/prisma/migrations/20261116_reconcile_microphone_authorization_default/migration.sql`; filename illustrative — use the current date; must sort after the trigger-hardening migration): a single `ALTER TABLE live_classes ALTER COLUMN microphone_authorization_mode SET DEFAULT 'SFU_AUTHORITATIVE';`
- `backend/prisma/schema.prisma`: **no change** (already `@default(SFU_AUTHORITATIVE)`).
- Investigate all creation paths before writing the migration: Prisma `create()` (field omitted), raw-SQL INSERTs in `backend/src/tests/integration/live-class.integration.test.js` (`rawInsertLC`), `backend/src/tests/live-class-real-db.test.js` (`createTestLC`), `backend/fix-live-class-columns.js` (Step 10 diagnostic INSERT), and any seed script.

## Acceptance criteria

1. A new forward-only migration changes only the `DEFAULT` clause of `microphone_authorization_mode`.
2. `SHOW COLUMNS FROM live_classes LIKE 'microphone_authorization_mode'` returns `Default: SFU_AUTHORITATIVE`, consistent with `schema.prisma @default`.
3. `npx prisma migrate dev` reports no drift after the migration is applied.
4. No existing row's `microphone_authorization_mode` value is changed (row-count comparison before/after: `SELECT microphone_authorization_mode, COUNT(*) FROM live_classes GROUP BY microphone_authorization_mode;`).
5. Application behavior (`startLiveClass`, `createLiveClass`, `ensureProtectedScheduledMicrophoneMode`) verified compatible.
6. Historical migrations `20261029` and `20261030` remain byte-for-byte unchanged.
7. The integration CI suite (`Backend -- Integration Tests (MariaDB 10.11)`) stays green.
8. The migration is verified on MariaDB 10.11 (not SQLite/PostgreSQL).

## Verification plan

- Pre/post snapshot of `microphone_authorization_mode` distribution (must be identical).
- `SHOW COLUMNS` confirmation after migration.
- `npx prisma migrate dev` drift check.
- Full integration suite against MariaDB 10.11 with the new default.

## Related

- Cross-references: trigger-idempotency issue #163 (prerequisite), raw-SQL helpers issue #167 (prerequisite), Prisma default-behavior integration test issue #165 (evidence for the direction decision).
