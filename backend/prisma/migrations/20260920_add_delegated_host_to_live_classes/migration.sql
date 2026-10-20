-- Migration: 20260920_add_delegated_host_to_live_classes
--
-- Adds delegated hosting support to live_classes.
-- A SCHOOL Live Class creator may designate one other school staff member
-- (TEACHER or SCHOOL_ADMIN) as the operational host for a session.
--
-- Changes (all additive / backward-compatible):
--   1. delegated_host_id column: nullable FK to users.id
--      NULL  = creator is the operational host (all existing rows remain unchanged)
--      Non-NULL = designated delegated operational host
--   2. FK with ON DELETE SET NULL — delegation clears automatically if user is deleted
--   3. Index on delegated_host_id for lookup efficiency
--
-- No data backfill. Existing rows remain with delegated_host_id = NULL.
-- Full backward compatibility: existing behavior unchanged when column is NULL.

-- Step 1: Add delegated_host_id column (nullable, no default needed — NULL is the default)
ALTER TABLE `live_classes`
  ADD COLUMN `delegated_host_id` VARCHAR(191) NULL
  AFTER `host_user_id`;

-- Step 2: Add foreign key (nullable — ON DELETE SET NULL clears delegation if user deleted)
ALTER TABLE `live_classes`
  ADD CONSTRAINT `fk_live_classes_delegated_host`
  FOREIGN KEY (`delegated_host_id`) REFERENCES `users`(`id`)
  ON DELETE SET NULL;

-- Step 3: Index for efficient lookup ("which live classes is user X delegated to?")
CREATE INDEX `live_classes_delegated_host_id_idx`
  ON `live_classes`(`delegated_host_id`);
