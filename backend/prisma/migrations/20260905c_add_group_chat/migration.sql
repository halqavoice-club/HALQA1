-- Migration: 20260905c_add_group_chat
-- Creates group chat tables missing from the migration history.
-- GroupConversation, GroupMember, GroupMessage, GroupMessageReaction, GroupMessageRead
-- were added to schema.prisma without a corresponding CREATE TABLE migration.
-- This migration fills that gap so subsequent ALTER TABLE migrations can apply.

CREATE TABLE IF NOT EXISTS `group_conversations` (
  `id`                       VARCHAR(191) NOT NULL,
  `schoolId`                 VARCHAR(191) NULL,
  `classId`                  VARCHAR(191) NULL,
  `name`                     VARCHAR(191) NOT NULL,
  `description`              TEXT         NULL,
  `avatarUrl`                VARCHAR(2048) NULL,
  `privacy`                  ENUM('PUBLIC','PRIVATE','SCHOOL_ONLY','CLASS_ONLY') NOT NULL DEFAULT 'PRIVATE',
  `maxMembers`               INT          NOT NULL DEFAULT 100,
  `isMuted`                  BOOLEAN      NOT NULL DEFAULT FALSE,
  `slowMode`                 BOOLEAN      NOT NULL DEFAULT FALSE,
  `onlyAdminsCanSendMessages` BOOLEAN     NOT NULL DEFAULT FALSE,
  `onlyAdminsCanSendMedia`   BOOLEAN      NOT NULL DEFAULT FALSE,
  `memberCount`              INT          NOT NULL DEFAULT 1,
  `messageCount`             INT          NOT NULL DEFAULT 0,
  `lastMessage`              TEXT         NULL,
  `lastMessageAt`            DATETIME(3)  NULL,
  `createdBy`                VARCHAR(191) NOT NULL,
  `deletedAt`                DATETIME(3)  NULL,
  `createdAt`                DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`                DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `group_conversations_schoolId_idx` (`schoolId`),
  INDEX `group_conversations_classId_idx` (`classId`),
  INDEX `group_conversations_privacy_idx` (`privacy`),
  INDEX `group_conversations_createdAt_idx` (`createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `group_members` (
  `id`             VARCHAR(191) NOT NULL,
  `conversationId` VARCHAR(191) NOT NULL,
  `userId`         VARCHAR(191) NOT NULL,
  `role`           ENUM('OWNER','ADMIN','MEMBER') NOT NULL DEFAULT 'MEMBER',
  `isMuted`        BOOLEAN      NOT NULL DEFAULT FALSE,
  `joinedAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `leftAt`         DATETIME(3)  NULL,
  `unreadCount`    INT          NOT NULL DEFAULT 0,
  `lastReadAt`     DATETIME(3)  NULL,
  `deletedAt`      DATETIME(3)  NULL,
  `createdAt`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `group_members_conversationId_userId_key` (`conversationId`, `userId`),
  INDEX `group_members_conversationId_idx` (`conversationId`),
  INDEX `group_members_userId_idx` (`userId`),
  INDEX `group_members_role_idx` (`role`),
  CONSTRAINT `group_members_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `group_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `group_members_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `group_messages` (
  `id`             VARCHAR(191) NOT NULL,
  `conversationId` VARCHAR(191) NOT NULL,
  `senderId`       VARCHAR(191) NOT NULL,
  `type`           ENUM('TEXT','IMAGE','VIDEO','GIF','AUDIO','VOICE','FILE','DOCUMENT','POLL','SYSTEM') NOT NULL DEFAULT 'TEXT',
  `body`           TEXT         NULL,
  `mediaUrl`       VARCHAR(2048) NULL,
  `mimeType`       VARCHAR(128) NULL,
  `fileSize`       INT          NULL,
  `fileName`       VARCHAR(255) NULL,
  `duration`       INT          NULL,
  `replyToId`      VARCHAR(191) NULL,
  `isPinned`       BOOLEAN      NOT NULL DEFAULT FALSE,
  `pinnedAt`       DATETIME(3)  NULL,
  `pinnedBy`       VARCHAR(191) NULL,
  `deletedBy`      JSON         NULL,
  `deletedAt`      DATETIME(3)  NULL,
  `refEntityType`  VARCHAR(50)  NULL,
  `refEntityId`    VARCHAR(36)  NULL,
  `createdAt`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `group_messages_conversationId_idx` (`conversationId`),
  INDEX `group_messages_senderId_idx` (`senderId`),
  INDEX `group_messages_createdAt_idx` (`createdAt`),
  INDEX `group_messages_conversationId_createdAt_idx` (`conversationId`, `createdAt`),
  INDEX `group_messages_conversationId_isPinned_idx` (`conversationId`, `isPinned`),
  INDEX `group_messages_refEntityType_refEntityId_idx` (`refEntityType`, `refEntityId`),
  CONSTRAINT `group_messages_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `group_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `group_messages_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `group_messages_replyToId_fkey` FOREIGN KEY (`replyToId`) REFERENCES `group_messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `group_message_reactions` (
  `id`        VARCHAR(191) NOT NULL,
  `messageId` VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `type`      VARCHAR(191) NOT NULL DEFAULT 'LIKE',
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `group_message_reactions_messageId_userId_key` (`messageId`, `userId`),
  INDEX `group_message_reactions_messageId_idx` (`messageId`),
  INDEX `group_message_reactions_userId_idx` (`userId`),
  CONSTRAINT `group_message_reactions_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `group_messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `group_message_reactions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `group_message_reads` (
  `id`        VARCHAR(191) NOT NULL,
  `messageId` VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `readAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `group_message_reads_messageId_userId_key` (`messageId`, `userId`),
  INDEX `group_message_reads_messageId_idx` (`messageId`),
  INDEX `group_message_reads_userId_idx` (`userId`),
  CONSTRAINT `group_message_reads_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `group_messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `group_message_reads_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
