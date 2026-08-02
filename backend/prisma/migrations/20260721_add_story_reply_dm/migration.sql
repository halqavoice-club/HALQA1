-- AddStoryReplyToDm
-- Additive migration: adds optional storyId FK to direct_messages.
-- When set, the DM is a story reply — client shows story preview above the message.
-- SetNull on story delete: if the story expires/is deleted, the DM remains with storyId = null.

ALTER TABLE `direct_messages`
  ADD COLUMN `storyId` VARCHAR(191) NULL AFTER `deletedByReceiver`;

ALTER TABLE `direct_messages`
  ADD CONSTRAINT `direct_messages_storyId_fkey`
  FOREIGN KEY (`storyId`) REFERENCES `stories` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX `direct_messages_storyId_idx`
  ON `direct_messages` (`storyId`);
