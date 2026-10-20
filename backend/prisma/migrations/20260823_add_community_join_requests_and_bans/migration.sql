-- ─── Community Join Requests ─────────────────────────────────────────────────
-- Replaces the Redis-only / stub implementation.
-- When a user requests to join a PRIVATE or INVITE_ONLY community, a row is
-- created here with status PENDING. Admins approve or decline via the API.
-- On approval the row is updated to ACCEPTED and a community_members row
-- is created. On decline the row is updated to DECLINED.
--
-- INVITE_ONLY join-requests are created via the invite system; PRIVATE
-- communities create them when a user calls POST /communities/:id/join.

CREATE TABLE `community_join_requests` (
  `id`          VARCHAR(191) NOT NULL,
  `communityId` VARCHAR(191) NOT NULL,
  `userId`      VARCHAR(191) NOT NULL,
  `status`      VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
  -- PENDING | ACCEPTED | DECLINED
  `message`     VARCHAR(500) NULL,
  `reviewedBy`  VARCHAR(191) NULL,
  `reviewedAt`  DATETIME(3)  NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  -- One active (PENDING) request per user per community at a time
  -- Multiple DECLINED/ACCEPTED rows are allowed (history)
  UNIQUE INDEX `community_join_requests_communityId_userId_pending_key`
    (`communityId`, `userId`, `status`),
  INDEX `community_join_requests_communityId_idx` (`communityId`),
  INDEX `community_join_requests_userId_idx`      (`userId`),
  INDEX `community_join_requests_status_idx`      (`status`),
  INDEX `community_join_requests_createdAt_idx`   (`createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `community_join_requests_communityId_fkey`
    FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE CASCADE,
  CONSTRAINT `community_join_requests_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Community Bans ───────────────────────────────────────────────────────────
-- Persistent ban records replacing the Redis-only SADD approach.
-- Redis is still used as a fast cache (community:ban:{id} SET), but this table
-- is the source of truth that survives Redis restarts.
-- On startup / cache miss, the ban is re-loaded from this table.

CREATE TABLE `community_bans` (
  `id`          VARCHAR(191) NOT NULL,
  `communityId` VARCHAR(191) NOT NULL,
  `userId`      VARCHAR(191) NOT NULL,
  `bannedBy`    VARCHAR(191) NOT NULL,
  `reason`      VARCHAR(500) NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  -- A user can only be banned once per community (upsert on re-ban)
  UNIQUE INDEX `community_bans_communityId_userId_key` (`communityId`, `userId`),
  INDEX `community_bans_communityId_idx` (`communityId`),
  INDEX `community_bans_userId_idx`      (`userId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `community_bans_communityId_fkey`
    FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE CASCADE,
  CONSTRAINT `community_bans_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
