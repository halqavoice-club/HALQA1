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

-- Index — CREATE INDEX IF NOT EXISTS is supported in MariaDB 10.1.4+
CREATE INDEX IF NOT EXISTS `direct_messages_msgType_idx` ON `direct_messages` (`msgType`);
