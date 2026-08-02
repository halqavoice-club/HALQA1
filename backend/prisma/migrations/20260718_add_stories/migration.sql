-- Phase B-3: Stories
-- Additive only. No existing tables modified.
-- New tables: stories, story_views, story_reactions

CREATE TABLE `stories` (
  `id`           VARCHAR(191) NOT NULL,
  `authorId`     VARCHAR(191) NOT NULL,
  `type`         VARCHAR(20)  NOT NULL DEFAULT 'IMAGE',
  -- IMAGE | VIDEO | TEXT
  `mediaUrl`     VARCHAR(2048) NULL,
  `mimeType`     VARCHAR(100) NULL,
  `thumbnail`    VARCHAR(2048) NULL,
  -- Text story fields
  `text`         VARCHAR(500) NULL,
  `textColor`    VARCHAR(20)  NULL DEFAULT '#ffffff',
  `bgColor`      VARCHAR(20)  NULL DEFAULT '#6366f1',
  `bgGradient`   VARCHAR(100) NULL,
  -- Caption overlay on media stories
  `caption`      VARCHAR(280) NULL,
  -- Duration (seconds): 5 for images, up to 15 for videos
  `duration`     INT          NOT NULL DEFAULT 5,
  -- Story expires 24 hours after creation
  `expiresAt`    DATETIME(3)  NOT NULL,
  `viewCount`    INT          NOT NULL DEFAULT 0,
  `reactionCount` INT         NOT NULL DEFAULT 0,
  `deletedAt`    DATETIME(3)  NULL,
  `createdAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `stories_authorId_idx`   (`authorId`),
  INDEX `stories_expiresAt_idx`  (`expiresAt`),
  INDEX `stories_createdAt_idx`  (`createdAt`),
  INDEX `stories_deletedAt_idx`  (`deletedAt`),
  CONSTRAINT `stories_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `story_views` (
  `id`        VARCHAR(191) NOT NULL,
  `storyId`   VARCHAR(191) NOT NULL,
  `viewerId`  VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `story_views_storyId_viewerId_key` (`storyId`, `viewerId`),
  INDEX `story_views_storyId_idx` (`storyId`),
  CONSTRAINT `story_views_storyId_fkey`  FOREIGN KEY (`storyId`)  REFERENCES `stories`(`id`) ON DELETE CASCADE,
  CONSTRAINT `story_views_viewerId_fkey` FOREIGN KEY (`viewerId`) REFERENCES `users`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `story_reactions` (
  `id`        VARCHAR(191) NOT NULL,
  `storyId`   VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `type`      VARCHAR(20)  NOT NULL DEFAULT 'LIKE',
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `story_reactions_storyId_userId_key` (`storyId`, `userId`),
  INDEX `story_reactions_storyId_idx` (`storyId`),
  CONSTRAINT `story_reactions_storyId_fkey` FOREIGN KEY (`storyId`) REFERENCES `stories`(`id`) ON DELETE CASCADE,
  CONSTRAINT `story_reactions_userId_fkey` FOREIGN KEY (`userId`)  REFERENCES `users`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
