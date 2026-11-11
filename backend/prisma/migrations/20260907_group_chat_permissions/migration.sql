-- Add permission fields to group_conversations
-- onlyAdminsCanSendMessages and onlyAdminsCanSendMedia are already defined
-- in the CREATE TABLE of 20260905c_add_group_chat. Use information_schema
-- guard to avoid duplicate column error (1060) on fresh databases.
SET @col_admins_msg = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='group_conversations' AND COLUMN_NAME='onlyAdminsCanSendMessages');
SET @col_admins_med = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='group_conversations' AND COLUMN_NAME='onlyAdminsCanSendMedia');
SET @add_admins_msg = IF(@col_admins_msg=0, 'ALTER TABLE `group_conversations` ADD COLUMN `onlyAdminsCanSendMessages` BOOLEAN NOT NULL DEFAULT FALSE', 'SELECT 1');
SET @add_admins_med = IF(@col_admins_med=0, 'ALTER TABLE `group_conversations` ADD COLUMN `onlyAdminsCanSendMedia`    BOOLEAN NOT NULL DEFAULT FALSE', 'SELECT 1');
PREPARE stmt_am FROM @add_admins_msg; EXECUTE stmt_am; DEALLOCATE PREPARE stmt_am;
PREPARE stmt_ad FROM @add_admins_med; EXECUTE stmt_ad; DEALLOCATE PREPARE stmt_ad;
