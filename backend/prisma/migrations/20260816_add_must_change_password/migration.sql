-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260816_add_must_change_password
-- Description: Add mustChangePassword flag to enforce first-login password reset
--              for users created by admins (students, teachers, guardians).
--
-- Strategy: ADDITIVE ONLY
--   - Adds mustChangePassword BOOLEAN NOT NULL DEFAULT false to users table.
--   - Existing users are NOT affected (default false = no forced reset).
--   - Only new users created via admin bulk-create get mustChangePassword = true.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `users`
  ADD COLUMN `mustChangePassword` BOOLEAN NOT NULL DEFAULT false
  COMMENT 'When true, user must change password on next login. Set for admin-created accounts.';

CREATE INDEX `users_mustChangePassword_idx` ON `users` (`mustChangePassword`);
