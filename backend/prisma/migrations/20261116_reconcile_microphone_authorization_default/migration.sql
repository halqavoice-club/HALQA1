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
