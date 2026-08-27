-- Migration: Add isEdited and editedAt fields to direct_messages
-- CHAT-GAP-002: DM message editing support
-- isEdited: boolean flag visible in the UI ("edited" indicator)
-- editedAt: timestamp of last edit for display

ALTER TABLE `direct_messages`
  ADD COLUMN `isEdited`  BOOLEAN  NOT NULL DEFAULT FALSE,
  ADD COLUMN `editedAt`  DATETIME(3) NULL;
