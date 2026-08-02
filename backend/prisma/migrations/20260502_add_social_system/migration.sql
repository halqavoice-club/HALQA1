-- ─── SOCIAL SYSTEM ────────────────────────────────────────────────────────────

-- Follow table (one-way, TikTok style)
CREATE TABLE `follows` (
  `id`          VARCHAR(191) NOT NULL,
  `followerId`  VARCHAR(191) NOT NULL,
  `followingId` VARCHAR(191) NOT NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `follows_followerId_followingId_key` (`followerId`, `followingId`),
  INDEX `follows_followerId_idx`  (`followerId`),
  INDEX `follows_followingId_idx` (`followingId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `follows`
  ADD CONSTRAINT `follows_followerId_fkey`  FOREIGN KEY (`followerId`)  REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `follows_followingId_fkey` FOREIGN KEY (`followingId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- FriendRequest table (two-way, IMO style)
CREATE TABLE `friend_requests` (
  `id`         VARCHAR(191) NOT NULL,
  `senderId`   VARCHAR(191) NOT NULL,
  `receiverId` VARCHAR(191) NOT NULL,
  `status`     ENUM('PENDING','ACCEPTED','REJECTED') NOT NULL DEFAULT 'PENDING',
  `createdAt`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`  DATETIME(3) NOT NULL,

  UNIQUE INDEX `friend_requests_senderId_receiverId_key` (`senderId`, `receiverId`),
  INDEX `friend_requests_senderId_idx`  (`senderId`),
  INDEX `friend_requests_receiverId_idx`(`receiverId`),
  INDEX `friend_requests_status_idx`    (`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `friend_requests`
  ADD CONSTRAINT `friend_requests_senderId_fkey`   FOREIGN KEY (`senderId`)   REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `friend_requests_receiverId_fkey` FOREIGN KEY (`receiverId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
