-- ─── DIRECT MESSAGES ─────────────────────────────────────────────────────────

CREATE TABLE `dm_conversations` (
  `id`            VARCHAR(191) NOT NULL,
  `userAId`       VARCHAR(191) NOT NULL,
  `userBId`       VARCHAR(191) NOT NULL,
  `lastMessage`   TEXT         NULL,
  `lastMessageAt` DATETIME(3)  NULL,
  `lastSenderId`  VARCHAR(191) NULL,
  `unreadA`       INT          NOT NULL DEFAULT 0,
  `unreadB`       INT          NOT NULL DEFAULT 0,
  `createdAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3)  NOT NULL,

  UNIQUE INDEX `dm_conversations_userAId_userBId_key` (`userAId`, `userBId`),
  INDEX `dm_conversations_userAId_idx`      (`userAId`),
  INDEX `dm_conversations_userBId_idx`      (`userBId`),
  INDEX `dm_conversations_lastMessageAt_idx`(`lastMessageAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `dm_conversations`
  ADD CONSTRAINT `dm_conversations_userAId_fkey` FOREIGN KEY (`userAId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `dm_conversations_userBId_fkey` FOREIGN KEY (`userBId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `direct_messages` (
  `id`                  VARCHAR(191) NOT NULL,
  `conversationId`      VARCHAR(191) NOT NULL,
  `senderId`            VARCHAR(191) NOT NULL,
  `receiverId`          VARCHAR(191) NOT NULL,
  `body`                TEXT         NOT NULL,
  `status`              ENUM('SENT','DELIVERED','READ') NOT NULL DEFAULT 'SENT',
  `deliveredAt`         DATETIME(3)  NULL,
  `readAt`              DATETIME(3)  NULL,
  `deletedBySender`     BOOLEAN      NOT NULL DEFAULT FALSE,
  `deletedByReceiver`   BOOLEAN      NOT NULL DEFAULT FALSE,
  `createdAt`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`           DATETIME(3)  NOT NULL,

  INDEX `direct_messages_conversationId_idx`(`conversationId`),
  INDEX `direct_messages_senderId_idx`      (`senderId`),
  INDEX `direct_messages_receiverId_idx`    (`receiverId`),
  INDEX `direct_messages_createdAt_idx`     (`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `direct_messages`
  ADD CONSTRAINT `direct_messages_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `dm_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `direct_messages_senderId_fkey`       FOREIGN KEY (`senderId`)       REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `direct_messages_receiverId_fkey`     FOREIGN KEY (`receiverId`)     REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
