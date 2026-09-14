-- Phase 4: Add media fields to direct_messages
-- Uses conditional column addition to be idempotent (safe to re-run)

-- Make body nullable if it isn't already
ALTER TABLE `direct_messages` MODIFY COLUMN `body` TEXT NULL;

-- Add each column only if it doesn't already exist (via stored procedure)
DROP PROCEDURE IF EXISTS `add_dm_media_columns`;
DELIMITER //
CREATE PROCEDURE `add_dm_media_columns`()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'direct_messages' AND COLUMN_NAME = 'msgType') THEN
    ALTER TABLE `direct_messages` ADD COLUMN `msgType` VARCHAR(20) NOT NULL DEFAULT 'TEXT' AFTER `body`;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'direct_messages' AND COLUMN_NAME = 'mediaUrl') THEN
    ALTER TABLE `direct_messages` ADD COLUMN `mediaUrl` VARCHAR(2048) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'direct_messages' AND COLUMN_NAME = 'mimeType') THEN
    ALTER TABLE `direct_messages` ADD COLUMN `mimeType` VARCHAR(128) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'direct_messages' AND COLUMN_NAME = 'fileSize') THEN
    ALTER TABLE `direct_messages` ADD COLUMN `fileSize` INT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'direct_messages' AND COLUMN_NAME = 'fileName') THEN
    ALTER TABLE `direct_messages` ADD COLUMN `fileName` VARCHAR(255) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'direct_messages' AND COLUMN_NAME = 'duration') THEN
    ALTER TABLE `direct_messages` ADD COLUMN `duration` INT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'direct_messages' AND COLUMN_NAME = 'width') THEN
    ALTER TABLE `direct_messages` ADD COLUMN `width` INT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'direct_messages' AND COLUMN_NAME = 'height') THEN
    ALTER TABLE `direct_messages` ADD COLUMN `height` INT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'direct_messages' AND COLUMN_NAME = 'thumbnail') THEN
    ALTER TABLE `direct_messages` ADD COLUMN `thumbnail` VARCHAR(2048) NULL;
  END IF;
  -- Index (ignore error if already exists)
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'direct_messages' AND INDEX_NAME = 'direct_messages_msgType_idx') THEN
    ALTER TABLE `direct_messages` ADD INDEX `direct_messages_msgType_idx` (`msgType`);
  END IF;
END //
DELIMITER ;
CALL `add_dm_media_columns`();
DROP PROCEDURE IF EXISTS `add_dm_media_columns`;
