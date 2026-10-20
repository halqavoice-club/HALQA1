-- Add permission fields to group_conversations
ALTER TABLE `group_conversations`
  ADD COLUMN IF NOT EXISTS `onlyAdminsCanSendMessages` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS `onlyAdminsCanSendMedia`    BOOLEAN NOT NULL DEFAULT FALSE;
