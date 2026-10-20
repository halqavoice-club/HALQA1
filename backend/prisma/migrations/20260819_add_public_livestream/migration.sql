-- Migration: 20260819_add_public_livestream
--
-- Adds "Public Stream" mode to live_classes so any authenticated user
-- (even without a school) can host a live video broadcast.
--
-- Changes (all additive / backward-compatible):
--   1. stream_type column: 'SCHOOL' (default, existing behaviour)
--                          'PUBLIC' (new — no school/class/teacher required)
--   2. schoolId, classId, teacherId become nullable so PUBLIC streams can
--      be created without a school context.
--   3. host_user_id column: for PUBLIC streams, the creator's userId is stored
--      directly (no Teacher record needed).
--   4. Indexes updated: stream_type indexed for efficient filtering.
--
-- All existing rows have stream_type = 'SCHOOL' (DEFAULT value).
-- Existing rows are not touched — full backward compatibility.

-- Step 1: Add stream_type column (defaults to 'SCHOOL' for all existing rows)
ALTER TABLE `live_classes`
  ADD COLUMN `stream_type` VARCHAR(20) NOT NULL DEFAULT 'SCHOOL'
  AFTER `id`;

-- Step 2: Make schoolId nullable (PUBLIC streams have no school)
ALTER TABLE `live_classes`
  MODIFY COLUMN `schoolId` VARCHAR(191) NULL;

-- Step 3: Make classId nullable (PUBLIC streams have no class)
ALTER TABLE `live_classes`
  MODIFY COLUMN `classId` VARCHAR(191) NULL;

-- Step 4: Make teacherId nullable (PUBLIC streams use hostUserId instead)
ALTER TABLE `live_classes`
  MODIFY COLUMN `teacherId` VARCHAR(191) NULL;

-- Step 5: Add hostUserId — the userId of the host for PUBLIC streams
-- For SCHOOL streams this is null (teacherId already carries this info)
ALTER TABLE `live_classes`
  ADD COLUMN `host_user_id` VARCHAR(191) NULL
  AFTER `teacherId`;

-- Step 6: Add foreign key for hostUserId (nullable)
ALTER TABLE `live_classes`
  ADD CONSTRAINT `fk_live_classes_host_user`
  FOREIGN KEY (`host_user_id`) REFERENCES `users`(`id`)
  ON DELETE SET NULL;

-- Step 7: Index stream_type for efficient filtering
CREATE INDEX `live_classes_stream_type_idx` ON `live_classes`(`stream_type`);

-- Step 8: Index hostUserId for quick "my streams" lookup
CREATE INDEX `live_classes_host_user_id_idx` ON `live_classes`(`host_user_id`);
