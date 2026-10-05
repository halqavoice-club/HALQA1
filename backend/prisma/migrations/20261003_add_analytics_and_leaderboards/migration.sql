-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20261003_add_analytics_and_leaderboards
-- Description: Add daily analytics aggregation and pre-computed leaderboard tables
-- Strategy: ADDITIVE ONLY — no existing tables modified
-- CRITICAL: daily_user_stats is written by voice.controller.js on every
--           participant leave — this table is required for Voice Club to function.
-- Dependency order:
--   users must exist (global_leaderboard FK, daily_user_stats userId)
--   schools must exist (daily_school_stats schoolId, school_leaderboard schoolId)
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── daily_school_stats ──────────────────────────────────────────────────────
CREATE TABLE `daily_school_stats` (
  `id`             VARCHAR(191) NOT NULL,
  `schoolId`       VARCHAR(191) NOT NULL,
  `date`           DATE         NOT NULL,
  `studentCount`   INT          NOT NULL DEFAULT 0,
  `teacherCount`   INT          NOT NULL DEFAULT 0,
  `classCount`     INT          NOT NULL DEFAULT 0,
  `attendanceRate` DOUBLE       NULL,
  `averageGrade`   DOUBLE       NULL,
  `behaviorScore`  DOUBLE       NULL,
  `totalPosts`     INT          NOT NULL DEFAULT 0,
  `totalMessages`  INT          NOT NULL DEFAULT 0,
  `totalGifts`     INT          NOT NULL DEFAULT 0,
  `totalCoins`     INT          NOT NULL DEFAULT 0,
  `createdAt`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `daily_school_stats_schoolId_date_key` (`schoolId`, `date`),
  INDEX `daily_school_stats_schoolId_idx` (`schoolId`),
  INDEX `daily_school_stats_date_idx` (`date`)

) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── daily_user_stats ────────────────────────────────────────────────────────
-- Written by voice.controller.js on participant leave — hot path.
-- No FK on userId to avoid cascade issues; userId must be application-verified.
CREATE TABLE `daily_user_stats` (
  `id`              VARCHAR(191) NOT NULL,
  `userId`          VARCHAR(191) NOT NULL,
  `date`            DATE         NOT NULL,
  `loginCount`      INT          NOT NULL DEFAULT 0,
  `postsCreated`    INT          NOT NULL DEFAULT 0,
  `commentsCreated` INT          NOT NULL DEFAULT 0,
  `likesGiven`      INT          NOT NULL DEFAULT 0,
  `likesReceived`   INT          NOT NULL DEFAULT 0,
  `messagesSent`    INT          NOT NULL DEFAULT 0,
  `voiceMinutes`    INT          NOT NULL DEFAULT 0,
  `giftsSent`       INT          NOT NULL DEFAULT 0,
  `giftsReceived`   INT          NOT NULL DEFAULT 0,
  `coinsSpent`      INT          NOT NULL DEFAULT 0,
  `coinsEarned`     INT          NOT NULL DEFAULT 0,
  `createdAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `daily_user_stats_userId_date_key` (`userId`, `date`),
  INDEX `daily_user_stats_userId_idx` (`userId`),
  INDEX `daily_user_stats_date_idx` (`date`)

) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── global_leaderboard ──────────────────────────────────────────────────────
CREATE TABLE `global_leaderboard` (
  `id`            VARCHAR(191) NOT NULL,
  `userId`        VARCHAR(191) NOT NULL,
  `totalCoins`    INT          NOT NULL DEFAULT 0,
  `totalDiamonds` INT          NOT NULL DEFAULT 0,
  `totalGifts`    INT          NOT NULL DEFAULT 0,
  `totalPosts`    INT          NOT NULL DEFAULT 0,
  `totalFollowers` INT         NOT NULL DEFAULT 0,
  `rank`          INT          NOT NULL DEFAULT 0,
  `previousRank`  INT          NULL,
  `period`        VARCHAR(191) NOT NULL DEFAULT 'ALL_TIME',
  `updatedAt`     DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `global_leaderboard_userId_key` (`userId`),
  INDEX `global_leaderboard_rank_idx` (`rank`),
  INDEX `global_leaderboard_period_idx` (`period`),
  INDEX `global_leaderboard_period_rank_idx` (`period`, `rank`),

  CONSTRAINT `global_leaderboard_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE

) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── school_leaderboard ──────────────────────────────────────────────────────
CREATE TABLE `school_leaderboard` (
  `id`            VARCHAR(191) NOT NULL,
  `schoolId`      VARCHAR(191) NOT NULL,
  `userId`        VARCHAR(191) NOT NULL,
  `totalCoins`    INT          NOT NULL DEFAULT 0,
  `totalDiamonds` INT          NOT NULL DEFAULT 0,
  `totalGifts`    INT          NOT NULL DEFAULT 0,
  `totalPosts`    INT          NOT NULL DEFAULT 0,
  `rank`          INT          NOT NULL DEFAULT 0,
  `previousRank`  INT          NULL,
  `period`        VARCHAR(191) NOT NULL DEFAULT 'ALL_TIME',
  `updatedAt`     DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `school_leaderboard_schoolId_userId_period_key` (`schoolId`, `userId`, `period`),
  INDEX `school_leaderboard_schoolId_idx` (`schoolId`),
  INDEX `school_leaderboard_rank_idx` (`rank`),
  INDEX `school_leaderboard_period_idx` (`period`),

  CONSTRAINT `school_leaderboard_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE

) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
