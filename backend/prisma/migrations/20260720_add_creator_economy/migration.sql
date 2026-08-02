-- Phase B-6: Creator Economy
-- Additive only. New tables: creator_profiles, creator_tiers, creator_subscriptions, creator_tips
-- One nullable additive column on posts: isExclusive, tierRequired

-- ─── Creator profile extension ───────────────────────────────────────────────
-- One row per user who activates creator mode
CREATE TABLE `creator_profiles` (
  `id`            VARCHAR(191) NOT NULL,
  `userId`        VARCHAR(191) NOT NULL,
  `displayName`   VARCHAR(120) NULL,
  `tagline`       VARCHAR(280) NULL,
  `isActive`      BOOLEAN      NOT NULL DEFAULT true,
  `isVerified`    BOOLEAN      NOT NULL DEFAULT false,
  `totalEarned`   INT          NOT NULL DEFAULT 0,    -- lifetime diamonds earned from tips+subs
  `subscriberCount` INT        NOT NULL DEFAULT 0,
  `tipCount`      INT          NOT NULL DEFAULT 0,
  `links`         JSON         NULL,                  -- { website, twitter, youtube, ... }
  `createdAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `creator_profiles_userId_key` (`userId`),
  CONSTRAINT `creator_profiles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Creator subscription tiers ──────────────────────────────────────────────
CREATE TABLE `creator_tiers` (
  `id`            VARCHAR(191) NOT NULL,
  `creatorId`     VARCHAR(191) NOT NULL,   -- FK → creator_profiles.id
  `name`          VARCHAR(80)  NOT NULL,
  `description`   VARCHAR(500) NULL,
  `priceCoins`    INT          NOT NULL DEFAULT 100,  -- monthly cost in coins
  `sortOrder`     INT          NOT NULL DEFAULT 0,
  `isActive`      BOOLEAN      NOT NULL DEFAULT true,
  `perks`         JSON         NULL,                  -- ["Exclusive posts", "Early access", ...]
  `createdAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `creator_tiers_creatorId_idx` (`creatorId`),
  CONSTRAINT `creator_tiers_creatorId_fkey` FOREIGN KEY (`creatorId`) REFERENCES `creator_profiles`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Active subscriptions ─────────────────────────────────────────────────────
CREATE TABLE `creator_subscriptions` (
  `id`          VARCHAR(191) NOT NULL,
  `subscriberId` VARCHAR(191) NOT NULL,
  `creatorId`   VARCHAR(191) NOT NULL,   -- FK → creator_profiles.id
  `tierId`      VARCHAR(191) NOT NULL,
  `status`      VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | EXPIRED | CANCELLED
  `startedAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt`   DATETIME(3)  NOT NULL,                   -- startedAt + 30 days
  `renewedAt`   DATETIME(3)  NULL,
  `coinsCharged` INT         NOT NULL DEFAULT 0,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `creator_subscriptions_subscriberId_creatorId_key` (`subscriberId`, `creatorId`),
  INDEX `creator_subscriptions_creatorId_idx`   (`creatorId`),
  INDEX `creator_subscriptions_subscriberId_idx` (`subscriberId`),
  INDEX `creator_subscriptions_expiresAt_idx`   (`expiresAt`),
  INDEX `creator_subscriptions_status_idx`      (`status`),
  CONSTRAINT `creator_subscriptions_subscriberId_fkey` FOREIGN KEY (`subscriberId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `creator_subscriptions_creatorId_fkey`    FOREIGN KEY (`creatorId`)    REFERENCES `creator_profiles`(`id`) ON DELETE CASCADE,
  CONSTRAINT `creator_subscriptions_tierId_fkey`       FOREIGN KEY (`tierId`)       REFERENCES `creator_tiers`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Tips (direct coin transfer to creator) ───────────────────────────────────
CREATE TABLE `creator_tips` (
  `id`             VARCHAR(191) NOT NULL,
  `senderId`       VARCHAR(191) NOT NULL,
  `creatorId`      VARCHAR(191) NOT NULL,   -- FK → creator_profiles.id
  `amount`         INT          NOT NULL,   -- coins sent
  `diamondsEarned` INT          NOT NULL,   -- diamonds credited to creator (50% cut)
  `message`        VARCHAR(280) NULL,       -- optional tip message
  `postId`         VARCHAR(191) NULL,       -- optional: tip on a specific post
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `createdAt`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `creator_tips_idempotencyKey_key` (`idempotencyKey`),
  INDEX `creator_tips_senderId_idx`  (`senderId`),
  INDEX `creator_tips_creatorId_idx` (`creatorId`),
  INDEX `creator_tips_createdAt_idx` (`createdAt`),
  CONSTRAINT `creator_tips_senderId_fkey`  FOREIGN KEY (`senderId`)  REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `creator_tips_creatorId_fkey` FOREIGN KEY (`creatorId`) REFERENCES `creator_profiles`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Additive post columns (exclusive content) ────────────────────────────────
ALTER TABLE `posts`
  ADD COLUMN `isExclusive`  BOOLEAN      NULL DEFAULT false,
  ADD COLUMN `tierRequired` VARCHAR(191) NULL,
  ADD INDEX  `posts_isExclusive_idx`  (`isExclusive`),
  ADD CONSTRAINT `posts_tierRequired_fkey`
    FOREIGN KEY (`tierRequired`) REFERENCES `creator_tiers`(`id`) ON DELETE SET NULL;
