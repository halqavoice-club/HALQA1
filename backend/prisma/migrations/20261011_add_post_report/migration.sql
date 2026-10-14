-- Migration: add_post_report
-- Adds the post_reports table to persist post report submissions for
-- admin moderation. Mirrors the user_reports pattern.
-- One PENDING report per reporter+post pair is enforced in application code.

CREATE TABLE `post_reports` (
  `id`          VARCHAR(191) NOT NULL,
  `reporterId`  VARCHAR(191) NOT NULL,
  `postId`      VARCHAR(191) NOT NULL,
  `reason`      VARCHAR(191) NOT NULL,
  `description` LONGTEXT     NULL,
  `status`      VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `reviewedBy`  VARCHAR(191) NULL,
  `reviewedAt`  DATETIME(3)  NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `post_reports_reporterId_idx` (`reporterId`),
  INDEX `post_reports_postId_idx` (`postId`),
  INDEX `post_reports_reporterId_postId_status_idx` (`reporterId`, `postId`, `status`),
  INDEX `post_reports_status_idx` (`status`),
  INDEX `post_reports_createdAt_idx` (`createdAt`),

  CONSTRAINT `post_reports_reporterId_fkey`
    FOREIGN KEY (`reporterId`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT `post_reports_postId_fkey`
    FOREIGN KEY (`postId`) REFERENCES `posts` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
