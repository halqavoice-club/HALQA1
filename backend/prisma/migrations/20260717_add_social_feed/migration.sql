-- ─── Phase B-1: Social Feed ────────────────────────────────────────────────
-- Additive only. No existing tables modified.
-- New tables: posts, post_media, post_reactions, post_comments,
--             comment_reactions, post_hashtags, hashtags,
--             post_bookmarks, post_mentions, post_views

-- ─── Hashtags ───────────────────────────────────────────────────────────────
CREATE TABLE `hashtags` (
  `id`          VARCHAR(191) NOT NULL,
  `name`        VARCHAR(100) NOT NULL,
  `postCount`   INT          NOT NULL DEFAULT 0,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `hashtags_name_key` (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Posts ──────────────────────────────────────────────────────────────────
CREATE TABLE `posts` (
  `id`              VARCHAR(191) NOT NULL,
  `authorId`        VARCHAR(191) NOT NULL,
  `body`            TEXT         NULL,
  `type`            VARCHAR(50)  NOT NULL DEFAULT 'TEXT',
  -- type: TEXT | IMAGE | VIDEO | AUDIO | DOCUMENT | POLL | MULTI_IMAGE
  --       LIVE_ROOM_SHARE | LIVE_CLASS_SHARE | VOICE_CLUB_SHARE | REPOST | QUOTE
  `visibility`      VARCHAR(30)  NOT NULL DEFAULT 'PUBLIC',
  -- visibility: PUBLIC | FOLLOWERS | PRIVATE | SCHOOL_ONLY
  `schoolId`        VARCHAR(191) NULL,
  -- non-null when visibility = SCHOOL_ONLY
  `likeCount`       INT          NOT NULL DEFAULT 0,
  `commentCount`    INT          NOT NULL DEFAULT 0,
  `shareCount`      INT          NOT NULL DEFAULT 0,
  `viewCount`       INT          NOT NULL DEFAULT 0,
  `bookmarkCount`   INT          NOT NULL DEFAULT 0,
  `isPinned`        BOOLEAN      NOT NULL DEFAULT false,
  `isArchived`      BOOLEAN      NOT NULL DEFAULT false,
  `isDraft`         BOOLEAN      NOT NULL DEFAULT false,
  `scheduledAt`     DATETIME(3)  NULL,
  -- share/repost/quote references
  `originalPostId`  VARCHAR(191) NULL,
  `quotedBody`      TEXT         NULL,
  -- rich link preview
  `linkUrl`         VARCHAR(2048) NULL,
  `linkTitle`       VARCHAR(512)  NULL,
  `linkDescription` TEXT          NULL,
  `linkImage`       VARCHAR(2048) NULL,
  -- poll data (JSON when type=POLL)
  `pollData`        JSON         NULL,
  -- reference to shared entity (voice room, live class, etc.)
  `refEntityType`   VARCHAR(50)  NULL,
  `refEntityId`     VARCHAR(191) NULL,
  `deletedAt`       DATETIME(3)  NULL,
  `createdAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `posts_authorId_idx`       (`authorId`),
  INDEX `posts_visibility_idx`     (`visibility`),
  INDEX `posts_schoolId_idx`       (`schoolId`),
  INDEX `posts_createdAt_idx`      (`createdAt`),
  INDEX `posts_isDraft_idx`        (`isDraft`),
  INDEX `posts_scheduledAt_idx`    (`scheduledAt`),
  INDEX `posts_originalPostId_idx` (`originalPostId`),
  INDEX `posts_deletedAt_idx`      (`deletedAt`),
  CONSTRAINT `posts_authorId_fkey`       FOREIGN KEY (`authorId`)       REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `posts_originalPostId_fkey` FOREIGN KEY (`originalPostId`) REFERENCES `posts`(`id`) ON DELETE SET NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Post Media ─────────────────────────────────────────────────────────────
CREATE TABLE `post_media` (
  `id`          VARCHAR(191) NOT NULL,
  `postId`      VARCHAR(191) NOT NULL,
  `url`         VARCHAR(2048) NOT NULL,
  `type`        VARCHAR(20)  NOT NULL DEFAULT 'IMAGE',
  -- IMAGE | VIDEO | AUDIO | DOCUMENT
  `mimeType`    VARCHAR(100) NULL,
  `size`        INT          NULL,
  `width`       INT          NULL,
  `height`      INT          NULL,
  `duration`    INT          NULL,
  `thumbnail`   VARCHAR(2048) NULL,
  `orderIndex`  INT          NOT NULL DEFAULT 0,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `post_media_postId_idx` (`postId`),
  CONSTRAINT `post_media_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Post Reactions ─────────────────────────────────────────────────────────
-- Reaction types: LIKE | LOVE | CELEBRATE | SUPPORT | INSIGHTFUL | FUNNY
CREATE TABLE `post_reactions` (
  `id`        VARCHAR(191) NOT NULL,
  `postId`    VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `type`      VARCHAR(20)  NOT NULL DEFAULT 'LIKE',
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `post_reactions_postId_userId_key` (`postId`, `userId`),
  INDEX `post_reactions_postId_idx` (`postId`),
  INDEX `post_reactions_userId_idx` (`userId`),
  CONSTRAINT `post_reactions_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE CASCADE,
  CONSTRAINT `post_reactions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Post Comments ──────────────────────────────────────────────────────────
CREATE TABLE `post_comments` (
  `id`           VARCHAR(191) NOT NULL,
  `postId`       VARCHAR(191) NOT NULL,
  `authorId`     VARCHAR(191) NOT NULL,
  `parentId`     VARCHAR(191) NULL,
  -- null = top-level comment, non-null = reply
  `body`         TEXT         NOT NULL,
  `likeCount`    INT          NOT NULL DEFAULT 0,
  `replyCount`   INT          NOT NULL DEFAULT 0,
  `deletedAt`    DATETIME(3)  NULL,
  `createdAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `post_comments_postId_idx`    (`postId`),
  INDEX `post_comments_authorId_idx`  (`authorId`),
  INDEX `post_comments_parentId_idx`  (`parentId`),
  INDEX `post_comments_createdAt_idx` (`createdAt`),
  CONSTRAINT `post_comments_postId_fkey`   FOREIGN KEY (`postId`)   REFERENCES `posts`(`id`) ON DELETE CASCADE,
  CONSTRAINT `post_comments_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `post_comments_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `post_comments`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Comment Reactions ──────────────────────────────────────────────────────
CREATE TABLE `comment_reactions` (
  `id`          VARCHAR(191) NOT NULL,
  `commentId`   VARCHAR(191) NOT NULL,
  `userId`      VARCHAR(191) NOT NULL,
  `type`        VARCHAR(20)  NOT NULL DEFAULT 'LIKE',
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `comment_reactions_commentId_userId_key` (`commentId`, `userId`),
  INDEX `comment_reactions_commentId_idx` (`commentId`),
  CONSTRAINT `comment_reactions_commentId_fkey` FOREIGN KEY (`commentId`) REFERENCES `post_comments`(`id`) ON DELETE CASCADE,
  CONSTRAINT `comment_reactions_userId_fkey`    FOREIGN KEY (`userId`)    REFERENCES `users`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Post Hashtags (junction) ────────────────────────────────────────────────
CREATE TABLE `post_hashtags` (
  `postId`     VARCHAR(191) NOT NULL,
  `hashtagId`  VARCHAR(191) NOT NULL,
  PRIMARY KEY (`postId`, `hashtagId`),
  CONSTRAINT `post_hashtags_postId_fkey`    FOREIGN KEY (`postId`)    REFERENCES `posts`(`id`)    ON DELETE CASCADE,
  CONSTRAINT `post_hashtags_hashtagId_fkey` FOREIGN KEY (`hashtagId`) REFERENCES `hashtags`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Post Mentions ──────────────────────────────────────────────────────────
CREATE TABLE `post_mentions` (
  `id`        VARCHAR(191) NOT NULL,
  `postId`    VARCHAR(191) NULL,
  `commentId` VARCHAR(191) NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `post_mentions_postId_idx`    (`postId`),
  INDEX `post_mentions_commentId_idx` (`commentId`),
  INDEX `post_mentions_userId_idx`    (`userId`),
  CONSTRAINT `post_mentions_postId_fkey`    FOREIGN KEY (`postId`)    REFERENCES `posts`(`id`)         ON DELETE CASCADE,
  CONSTRAINT `post_mentions_commentId_fkey` FOREIGN KEY (`commentId`) REFERENCES `post_comments`(`id`) ON DELETE CASCADE,
  CONSTRAINT `post_mentions_userId_fkey`    FOREIGN KEY (`userId`)    REFERENCES `users`(`id`)         ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Post Bookmarks ─────────────────────────────────────────────────────────
CREATE TABLE `post_bookmarks` (
  `id`        VARCHAR(191) NOT NULL,
  `postId`    VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `post_bookmarks_postId_userId_key` (`postId`, `userId`),
  INDEX `post_bookmarks_userId_idx` (`userId`),
  CONSTRAINT `post_bookmarks_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE CASCADE,
  CONSTRAINT `post_bookmarks_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Post Views ─────────────────────────────────────────────────────────────
CREATE TABLE `post_views` (
  `id`        VARCHAR(191) NOT NULL,
  `postId`    VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `post_views_postId_userId_key` (`postId`, `userId`),
  INDEX `post_views_postId_idx` (`postId`),
  CONSTRAINT `post_views_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE CASCADE,
  CONSTRAINT `post_views_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
