-- Migration: Add ON DELETE CASCADE FK to wallets.userId
--
-- The original wallets table (migration 20260502_add_gift_system) was created
-- without a foreign key constraint to users. The Prisma schema declares
-- onDelete: Cascade but the physical FK was never created. This causes
-- the cascade-delete integration test to fail on fresh databases where
-- only migrate deploy has been run (CI).
--
-- This migration adds the missing FK constraint using a stored procedure
-- to check if the constraint already exists first (idempotent).

-- Drop the FK if it already exists (handles re-running on existing DBs)
-- Then re-add with ON DELETE CASCADE to ensure correct behavior.
ALTER TABLE `wallets` DROP FOREIGN KEY IF EXISTS `wallets_userId_fkey`;

-- Add FK with ON DELETE CASCADE
ALTER TABLE `wallets`
  ADD CONSTRAINT `wallets_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`)
  ON DELETE CASCADE;
