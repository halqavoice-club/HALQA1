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

ALTER TABLE `direct_messages`
  ADD COLUMN `refEntityType` VARCHAR(50)  NULL,
  ADD COLUMN `refEntityId`   VARCHAR(36)  NULL;

-- Index: enables efficient lookup of all VOICE_ROOM_SHARE messages for a given room
CREATE INDEX `direct_messages_refEntityType_refEntityId_idx`
  ON `direct_messages` (`refEntityType`, `refEntityId`);

-- ── group_messages ─────────────────────────────────────────────────────────────

ALTER TABLE `group_messages`
  ADD COLUMN `refEntityType` VARCHAR(50)  NULL,
  ADD COLUMN `refEntityId`   VARCHAR(36)  NULL;

-- Index: enables efficient lookup of all VOICE_ROOM_SHARE messages for a given room
CREATE INDEX `group_messages_refEntityType_refEntityId_idx`
  ON `group_messages` (`refEntityType`, `refEntityId`);

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
