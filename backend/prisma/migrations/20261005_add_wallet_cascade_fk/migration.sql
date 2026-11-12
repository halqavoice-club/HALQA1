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

-- Drop the FK if it already exists (information_schema guard — DROP FOREIGN KEY IF EXISTS
-- is MySQL 8.0.19+ syntax, not supported on all mysql:8.0 builds)
SET @fk_wallet = (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'wallets'
    AND COLUMN_NAME  = 'userId'
    AND CONSTRAINT_NAME = 'wallets_userId_fkey'
  LIMIT 1
);
SET @sql_drop_fk = IF(@fk_wallet IS NOT NULL,
  'ALTER TABLE `wallets` DROP FOREIGN KEY `wallets_userId_fkey`',
  'SELECT 1'
);
PREPARE stmt_drop_fk FROM @sql_drop_fk; EXECUTE stmt_drop_fk; DEALLOCATE PREPARE stmt_drop_fk;

-- Add FK with ON DELETE CASCADE
ALTER TABLE `wallets`
  ADD CONSTRAINT `wallets_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`)
  ON DELETE CASCADE;
