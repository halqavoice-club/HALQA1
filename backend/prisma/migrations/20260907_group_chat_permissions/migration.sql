-- Add permission fields to group_conversations
ALTER TABLE `group_conversations`
  ADD COLUMN `onlyAdminsCanSendMessages` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN `onlyAdminsCanSendMedia`    BOOLEAN NOT NULL DEFAULT FALSE;
