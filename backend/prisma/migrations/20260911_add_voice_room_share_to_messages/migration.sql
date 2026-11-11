-- Phase 5: Add structured entity reference fields to DM and Group Chat messages
-- for VOICE_ROOM_SHARE support.
--
-- Safety guarantees:
--   - All new columns are nullable (NULL default) — zero impact on existing rows.
--   - MODIFY COLUMN on group_messages.type only APPENDS a new enum value;
--     existing values (TEXT, IMAGE, VIDEO, GIF, AUDIO, VOICE, FILE, DOCUMENT,
--     POLL, SYSTEM) are preserved in their original positions.
--   - No tables are dropped, truncated, or recreated.
--   - No existing columns are removed or renamed.
--   - Migration is fully reversible (DROP COLUMN / MODIFY COLUMN to remove).

-- ── direct_messages ────────────────────────────────────────────────────────────
-- refEntityType and refEntityId may already exist in the CREATE TABLE of
-- 20260905c_add_group_chat. Use information_schema guards to avoid error 1060.
SET @col_re1 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='direct_messages' AND COLUMN_NAME='refEntityType');
SET @col_re2 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='direct_messages' AND COLUMN_NAME='refEntityId');
SET @add_re1 = IF(@col_re1=0, 'ALTER TABLE `direct_messages` ADD COLUMN `refEntityType` VARCHAR(50) NULL', 'SELECT 1');
SET @add_re2 = IF(@col_re2=0, 'ALTER TABLE `direct_messages` ADD COLUMN `refEntityId`   VARCHAR(36) NULL', 'SELECT 1');
PREPARE stmt_re1 FROM @add_re1; EXECUTE stmt_re1; DEALLOCATE PREPARE stmt_re1;
PREPARE stmt_re2 FROM @add_re2; EXECUTE stmt_re2; DEALLOCATE PREPARE stmt_re2;

-- Index: enables efficient lookup of all VOICE_ROOM_SHARE messages for a given room
SET @idx_dm_re = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='direct_messages' AND INDEX_NAME='direct_messages_refEntityType_refEntityId_idx');
SET @sql_dm_re = IF(@idx_dm_re=0, 'CREATE INDEX `direct_messages_refEntityType_refEntityId_idx` ON `direct_messages` (`refEntityType`, `refEntityId`)', 'SELECT 1');
PREPARE stmt_dm_re FROM @sql_dm_re; EXECUTE stmt_dm_re; DEALLOCATE PREPARE stmt_dm_re;

-- ── group_messages ─────────────────────────────────────────────────────────────
-- Same guard for group_messages (columns may already exist in CREATE TABLE)
SET @col_gre1 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='group_messages' AND COLUMN_NAME='refEntityType');
SET @col_gre2 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='group_messages' AND COLUMN_NAME='refEntityId');
SET @add_gre1 = IF(@col_gre1=0, 'ALTER TABLE `group_messages` ADD COLUMN `refEntityType` VARCHAR(50) NULL', 'SELECT 1');
SET @add_gre2 = IF(@col_gre2=0, 'ALTER TABLE `group_messages` ADD COLUMN `refEntityId`   VARCHAR(36) NULL', 'SELECT 1');
PREPARE stmt_gre1 FROM @add_gre1; EXECUTE stmt_gre1; DEALLOCATE PREPARE stmt_gre1;
PREPARE stmt_gre2 FROM @add_gre2; EXECUTE stmt_gre2; DEALLOCATE PREPARE stmt_gre2;

-- Index: enables efficient lookup of all VOICE_ROOM_SHARE messages for a given room
-- IF NOT EXISTS: 20260905c_add_group_chat creates group_messages with this index
-- already defined in the CREATE TABLE statement. On a fresh database the CREATE TABLE
-- runs first, making this a duplicate. Use information_schema guard.
SET @idx_vrs = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='group_messages' AND INDEX_NAME='group_messages_refEntityType_refEntityId_idx');
SET @sql_vrs = IF(@idx_vrs=0, 'CREATE INDEX `group_messages_refEntityType_refEntityId_idx` ON `group_messages` (`refEntityType`, `refEntityId`)', 'SELECT 1');
PREPARE stmt_vrs FROM @sql_vrs; EXECUTE stmt_vrs; DEALLOCATE PREPARE stmt_vrs;

-- ── group_messages.type enum: append VOICE_ROOM_SHARE ─────────────────────────
-- MySQL 8 enum extension is online-safe: appending a value does not rebuild the table.
-- Existing rows retain their current enum value unchanged.

ALTER TABLE `group_messages`
  MODIFY COLUMN `type` ENUM(
    'TEXT',
    'IMAGE',
    'VIDEO',
    'GIF',
    'AUDIO',
    'VOICE',
    'FILE',
    'DOCUMENT',
    'POLL',
    'SYSTEM',
    'VOICE_ROOM_SHARE'
  ) NOT NULL DEFAULT 'TEXT';
