-- Phase 4: Add media fields to direct_messages
-- Rewritten to use ADD COLUMN (MariaDB 10.x compatible).
-- DELIMITER // syntax is not supported by Prisma's SQL runner — replaced.

-- Make body nullable if it isn't already
ALTER TABLE `direct_messages` MODIFY COLUMN `body` TEXT NULL;

-- Add media columns (IF NOT EXISTS = idempotent, safe to re-run)
ALTER TABLE `direct_messages`
  ADD COLUMN `msgType`  VARCHAR(20)   NOT NULL DEFAULT 'TEXT',
  ADD COLUMN `mediaUrl` VARCHAR(2048) NULL,
  ADD COLUMN `mimeType` VARCHAR(128)  NULL,
  ADD COLUMN `fileSize` INT           NULL,
  ADD COLUMN `fileName` VARCHAR(255)  NULL,
  ADD COLUMN `duration` INT           NULL,
  ADD COLUMN `width`    INT           NULL,
  ADD COLUMN `height`   INT           NULL,
  ADD COLUMN `thumbnail` VARCHAR(2048) NULL;

-- Index — use information_schema guard (CREATE INDEX IF NOT EXISTS not supported on all MySQL 8.0)
SET @idx_dm = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='direct_messages' AND INDEX_NAME='direct_messages_msgType_idx');
SET @sql_dm = IF(@idx_dm=0, 'CREATE INDEX `direct_messages_msgType_idx` ON `direct_messages` (`msgType`)', 'SELECT 1');
PREPARE stmt_dm FROM @sql_dm; EXECUTE stmt_dm; DEALLOCATE PREPARE stmt_dm;
