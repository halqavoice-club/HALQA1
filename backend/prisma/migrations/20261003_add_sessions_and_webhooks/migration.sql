-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20261003_add_sessions_and_webhooks
-- Description: Add per-device session management and webhook event delivery tables
-- Strategy: ADDITIVE ONLY — no existing tables modified
-- Dependency order: users must exist (sessions FK), schools/users optional (webhooks FK)
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── sessions ───────────────────────────────────────────────────────────────
-- Tracks per-device login sessions. Used by session.middleware.js to enforce
-- MAX_SESSIONS_PER_USER and provide session termination UI.
CREATE TABLE `sessions` (
  `id`                VARCHAR(191) NOT NULL,
  `userId`            VARCHAR(191) NOT NULL,
  `deviceName`        VARCHAR(255) NULL,
  `deviceType`        VARCHAR(50)  NULL,
  `deviceFingerprint` VARCHAR(64)  NULL,
  `ipAddress`         VARCHAR(45)  NULL,
  `userAgent`         TEXT         NULL,
  `isActive`          TINYINT(1)   NOT NULL DEFAULT 1,
  `lastSeenAt`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `terminatedAt`      DATETIME(3)  NULL,
  `terminationReason` VARCHAR(50)  NULL,
  `createdAt`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`         DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `sessions_userId_idx` (`userId`),
  INDEX `sessions_userId_isActive_idx` (`userId`, `isActive`),
  INDEX `sessions_deviceFingerprint_idx` (`deviceFingerprint`),
  INDEX `sessions_lastSeenAt_isActive_idx` (`lastSeenAt`, `isActive`),

  CONSTRAINT `sessions_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE

) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── webhooks ────────────────────────────────────────────────────────────────
-- Outbound webhook endpoints for event-driven integrations.
-- Note: userId and schoolId are optional/nullable — no FK constraints needed.
CREATE TABLE `webhooks` (
  `id`          VARCHAR(191) NOT NULL,
  `url`         VARCHAR(191) NOT NULL,
  `events`      VARCHAR(191) NOT NULL,
  `secret`      VARCHAR(255) NULL,
  `headers`     LONGTEXT     NULL,
  `description` TEXT         NULL,
  `userId`      VARCHAR(191) NULL,
  `schoolId`    VARCHAR(191) NULL,
  `isActive`    TINYINT(1)   NOT NULL DEFAULT 1,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `webhooks_userId_idx` (`userId`),
  INDEX `webhooks_schoolId_idx` (`schoolId`)

) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── webhook_deliveries ──────────────────────────────────────────────────────
-- Tracks individual webhook delivery attempts for retry and audit.
CREATE TABLE `webhook_deliveries` (
  `id`         VARCHAR(191) NOT NULL,
  `webhookId`  VARCHAR(191) NOT NULL,
  `deliveryId` VARCHAR(191) NOT NULL,
  `event`      VARCHAR(191) NOT NULL,
  `success`    TINYINT(1)   NOT NULL,
  `error`      TEXT         NULL,
  `attempt`    INT          NOT NULL DEFAULT 1,
  `timestamp`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `webhook_deliveries_webhookId_idx` (`webhookId`),
  INDEX `webhook_deliveries_timestamp_idx` (`timestamp`),

  CONSTRAINT `webhook_deliveries_webhookId_fkey`
    FOREIGN KEY (`webhookId`) REFERENCES `webhooks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE

) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
