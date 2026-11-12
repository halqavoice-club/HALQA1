-- Add fileName and duration to group_messages
-- fileName and duration may already be in the CREATE TABLE of 20260905c_add_group_chat.
-- Use information_schema guard to avoid duplicate column error (1060).
SET @col_fn = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='group_messages' AND COLUMN_NAME='fileName');
SET @col_dur = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='group_messages' AND COLUMN_NAME='duration');
SET @add_fn  = IF(@col_fn=0, 'ALTER TABLE `group_messages` ADD COLUMN `fileName` VARCHAR(255) NULL AFTER `fileSize`', 'SELECT 1');
SET @add_dur = IF(@col_dur=0, 'ALTER TABLE `group_messages` ADD COLUMN `duration` INT NULL AFTER `fileName`',   'SELECT 1');
PREPARE stmt_fn  FROM @add_fn;  EXECUTE stmt_fn;  DEALLOCATE PREPARE stmt_fn;
PREPARE stmt_dur FROM @add_dur; EXECUTE stmt_dur; DEALLOCATE PREPARE stmt_dur;
-- Modify mimeType to be nullable (idempotent — MODIFY is always safe)
ALTER TABLE `group_messages` MODIFY COLUMN `mimeType` VARCHAR(128) NULL;

-- Add new enum values to GroupMessageType
-- MySQL: ALTER TABLE to expand ENUM
ALTER TABLE `group_messages`
  MODIFY COLUMN `type` ENUM('TEXT','IMAGE','VIDEO','GIF','AUDIO','VOICE','FILE','DOCUMENT','POLL','SYSTEM') NOT NULL DEFAULT 'TEXT';
