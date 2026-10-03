-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20261003_add_search_and_backup
-- Description: Add search index, trending hashtags, and backup metadata tables
-- Strategy: ADDITIVE ONLY — no existing tables modified
-- Dependency order: no FKs to other application tables — standalone tables
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── search_index ────────────────────────────────────────────────────────────
-- Full-text search entity index. entityType/entityId pairs are unique.
-- schoolId/userId are informational; no FK to avoid cascade complexity.
CREATE TABLE `search_index` (
  `id`            VARCHAR(191) NOT NULL,
  `entityType`    VARCHAR(191) NOT NULL,
  `entityId`      VARCHAR(191) NOT NULL,
  `title`         VARCHAR(191) NOT NULL,
  `content`       TEXT         NULL,
  `tags`          LONGTEXT     NULL,
  `schoolId`      VARCHAR(191) NULL,
  `userId`        VARCHAR(191) NULL,
  `popularity`    DOUBLE       NOT NULL DEFAULT 0,
  `lastIndexedAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `search_index_entityType_entityId_key` (`entityType`, `entityId`),
  INDEX `search_index_entityType_idx` (`entityType`),
  INDEX `search_index_schoolId_idx` (`schoolId`),
  INDEX `search_index_userId_idx` (`userId`),
  INDEX `search_index_popularity_idx` (`popularity`)

) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── trending_hashtags ───────────────────────────────────────────────────────
CREATE TABLE `trending_hashtags` (
  `id`          VARCHAR(191) NOT NULL,
  `hashtag`     VARCHAR(191) NOT NULL,
  `count`       INT          NOT NULL DEFAULT 0,
  `rank`        INT          NOT NULL DEFAULT 0,
  `previousRank` INT         NULL,
  `period`      VARCHAR(191) NOT NULL DEFAULT 'HOURLY',
  `updatedAt`   DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `trending_hashtags_hashtag_key` (`hashtag`),
  INDEX `trending_hashtags_rank_idx` (`rank`),
  INDEX `trending_hashtags_period_idx` (`period`)

) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── backup_metadata ─────────────────────────────────────────────────────────
-- Tracks backup file metadata for operational audit and retention management.
-- createdBy is informational (nullable user ID string, not FK).
CREATE TABLE `backup_metadata` (
  `id`            VARCHAR(191) NOT NULL,
  `backupType`    VARCHAR(191) NOT NULL,
  `backupMethod`  VARCHAR(191) NOT NULL,
  `fileName`      VARCHAR(191) NOT NULL,
  `fileSize`      BIGINT       NOT NULL,
  `filePath`      VARCHAR(191) NOT NULL,
  `checksum`      VARCHAR(64)  NOT NULL,
  `status`        VARCHAR(191) NOT NULL DEFAULT 'COMPLETED',
  `startedAt`     DATETIME(3)  NOT NULL,
  `completedAt`   DATETIME(3)  NULL,
  `retentionDays` INT          NOT NULL DEFAULT 30,
  `createdBy`     VARCHAR(191) NULL,
  `notes`         TEXT         NULL,
  `deletedAt`     DATETIME(3)  NULL,
  `createdAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `backup_metadata_backupType_idx` (`backupType`),
  INDEX `backup_metadata_status_idx` (`status`),
  INDEX `backup_metadata_startedAt_idx` (`startedAt`)

) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
