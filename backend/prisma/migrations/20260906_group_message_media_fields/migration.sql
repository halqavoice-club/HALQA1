-- Add fileName and duration to group_messages
-- Uses IF NOT EXISTS because 20260905c_add_group_chat already includes these
-- columns in the CREATE TABLE statement. On a fresh database the CREATE TABLE
-- runs first, so plain ADD COLUMN would fail with error 1060 (duplicate column).
ALTER TABLE `group_messages`
  ADD COLUMN IF NOT EXISTS `fileName` VARCHAR(255) NULL AFTER `fileSize`,
  ADD COLUMN IF NOT EXISTS `duration` INT NULL AFTER `fileName`,
  MODIFY COLUMN `mimeType` VARCHAR(128) NULL;

-- Add new enum values to GroupMessageType
-- MySQL: ALTER TABLE to expand ENUM
ALTER TABLE `group_messages`
  MODIFY COLUMN `type` ENUM('TEXT','IMAGE','VIDEO','GIF','AUDIO','VOICE','FILE','DOCUMENT','POLL','SYSTEM') NOT NULL DEFAULT 'TEXT';
