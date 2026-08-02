-- Phase B-4: Communities
-- Additive only. No existing tables modified.

CREATE TABLE `communities` (
  `id`          VARCHAR(191) NOT NULL,
  `slug`        VARCHAR(100) NOT NULL,
  `name`        VARCHAR(120) NOT NULL,
  `description` TEXT         NULL,
  `avatarUrl`   VARCHAR(2048) NULL,
  `coverUrl`    VARCHAR(2048) NULL,
  `privacy`     VARCHAR(20)  NOT NULL DEFAULT 'PUBLIC',
  -- PUBLIC | PRIVATE | INVITE_ONLY
  `ownerId`     VARCHAR(191) NOT NULL,
  `memberCount` INT          NOT NULL DEFAULT 1,
  `postCount`   INT          NOT NULL DEFAULT 0,
  `isVerified`  BOOLEAN      NOT NULL DEFAULT false,
  `rules`       TEXT         NULL,
  `category`    VARCHAR(50)  NULL,
  -- education | religion | technology | sports | arts | other
  `deletedAt`   DATETIME(3)  NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `communities_slug_key` (`slug`),
  INDEX `communities_ownerId_idx`  (`ownerId`),
  INDEX `communities_privacy_idx`  (`privacy`),
  INDEX `communities_category_idx` (`category`),
  INDEX `communities_createdAt_idx`(`createdAt`),
  CONSTRAINT `communities_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `community_members` (
  `id`          VARCHAR(191) NOT NULL,
  `communityId` VARCHAR(191) NOT NULL,
  `userId`      VARCHAR(191) NOT NULL,
  `role`        VARCHAR(20)  NOT NULL DEFAULT 'MEMBER',
  -- OWNER | ADMIN | MODERATOR | MEMBER
  `joinedAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `invitedBy`   VARCHAR(191) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `community_members_communityId_userId_key` (`communityId`, `userId`),
  INDEX `community_members_communityId_idx` (`communityId`),
  INDEX `community_members_userId_idx`      (`userId`),
  INDEX `community_members_role_idx`        (`role`),
  CONSTRAINT `community_members_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE CASCADE,
  CONSTRAINT `community_members_userId_fkey`      FOREIGN KEY (`userId`)      REFERENCES `users`(`id`)        ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Add communityId to posts (nullable — existing posts unaffected)
ALTER TABLE `posts`
  ADD COLUMN `communityId` VARCHAR(191) NULL,
  ADD INDEX  `posts_communityId_idx` (`communityId`),
  ADD CONSTRAINT `posts_communityId_fkey`
    FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE SET NULL;
