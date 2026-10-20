-- Migration: Add BANNED to UserStatus enum
-- This status was used in application code but missing from the DB enum.
-- Safe: additive change, no existing data affected.

ALTER TABLE `users`
  MODIFY COLUMN `status` ENUM('ACTIVE','INACTIVE','SUSPENDED','PENDING','BANNED') NOT NULL DEFAULT 'PENDING';
