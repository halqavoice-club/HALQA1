-- Add fileName and duration to group_messages
ALTER TABLE `group_messages`
  ADD COLUMN `fileName` VARCHAR(255) NULL AFTER `fileSize`,
  ADD COLUMN `duration` INT NULL AFTER `fileName`,
  MODIFY COLUMN `mimeType` VARCHAR(128) NULL;

-- Add new enum values to GroupMessageType
-- MySQL: ALTER TABLE to expand ENUM
ALTER TABLE `group_messages`
  MODIFY COLUMN `type` ENUM('TEXT','IMAGE','VIDEO','GIF','AUDIO','VOICE','FILE','DOCUMENT','POLL','SYSTEM') NOT NULL DEFAULT 'TEXT';
