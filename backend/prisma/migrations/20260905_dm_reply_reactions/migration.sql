-- Add replyToId to direct_messages (reply-to / quote)
ALTER TABLE `direct_messages`
  ADD COLUMN `replyToId` VARCHAR(36) NULL,
  ADD CONSTRAINT `direct_messages_replyToId_fkey`
    FOREIGN KEY (`replyToId`) REFERENCES `direct_messages`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX `direct_messages_replyToId_idx` ON `direct_messages`(`replyToId`);

-- Create dm_reactions table (emoji reactions on DM messages)
CREATE TABLE `dm_reactions` (
  `id`        VARCHAR(36)  NOT NULL,
  `messageId` VARCHAR(36)  NOT NULL,
  `userId`    VARCHAR(36)  NOT NULL,
  `emoji`     VARCHAR(10)  NOT NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `dm_reactions_messageId_userId_emoji_key` (`messageId`, `userId`, `emoji`),
  INDEX `dm_reactions_messageId_idx` (`messageId`),
  INDEX `dm_reactions_userId_idx` (`userId`),

  CONSTRAINT `dm_reactions_messageId_fkey`
    FOREIGN KEY (`messageId`) REFERENCES `direct_messages`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT `dm_reactions_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
