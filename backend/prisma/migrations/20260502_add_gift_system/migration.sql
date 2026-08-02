-- ─── VIRTUAL GIFT SYSTEM ─────────────────────────────────────────────────────
-- Wallets: coins (spend) + diamonds (earn)
CREATE TABLE `wallets` (
  `id`         VARCHAR(191) NOT NULL,
  `userId`     VARCHAR(191) NOT NULL,
  `coins`      INT          NOT NULL DEFAULT 0,
  `diamonds`   INT          NOT NULL DEFAULT 0,
  `totalSpent` INT          NOT NULL DEFAULT 0,
  `totalEarned` INT         NOT NULL DEFAULT 0,
  `createdAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`  DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `wallets_userId_key` (`userId`),
  INDEX `wallets_userId_idx` (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Coin packages (purchasable bundles)
CREATE TABLE `coin_packages` (
  `id`          VARCHAR(191) NOT NULL,
  `name`        VARCHAR(191) NOT NULL,
  `coins`       INT          NOT NULL,
  `priceUsd`    DECIMAL(10,2) NOT NULL,
  `bonusCoins`  INT          NOT NULL DEFAULT 0,
  `isActive`    BOOLEAN      NOT NULL DEFAULT true,
  `sortOrder`   INT          NOT NULL DEFAULT 0,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Gift catalog
CREATE TABLE `gifts` (
  `id`            VARCHAR(191) NOT NULL,
  `name`          VARCHAR(191) NOT NULL,
  `emoji`         VARCHAR(191) NOT NULL DEFAULT '🎁',
  `imageUrl`      VARCHAR(191),
  `animationType` VARCHAR(191) NOT NULL DEFAULT 'overlay',  -- overlay | banner | spotlight | fullscreen
  `soundEffect`   VARCHAR(191),
  `priceCoins`    INT          NOT NULL,
  `rarity`        VARCHAR(191) NOT NULL DEFAULT 'common',   -- common | rare | epic | legendary
  `comboEnabled`  BOOLEAN      NOT NULL DEFAULT true,
  `isActive`      BOOLEAN      NOT NULL DEFAULT true,
  `sortOrder`     INT          NOT NULL DEFAULT 0,
  `createdAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `gifts_isActive_idx` (`isActive`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Gift transactions (ledger)
CREATE TABLE `gift_transactions` (
  `id`              VARCHAR(191) NOT NULL,
  `roomId`          VARCHAR(191) NOT NULL,
  `senderId`        VARCHAR(191) NOT NULL,
  `receiverId`      VARCHAR(191) NOT NULL,
  `giftId`          VARCHAR(191) NOT NULL,
  `count`           INT          NOT NULL DEFAULT 1,
  `combo`           INT          NOT NULL DEFAULT 1,
  `coinsSpent`      INT          NOT NULL,
  `diamondsEarned`  INT          NOT NULL,
  `idempotencyKey`  VARCHAR(191) NOT NULL,
  `createdAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `gift_transactions_idempotencyKey_key` (`idempotencyKey`),
  INDEX `gift_transactions_roomId_idx` (`roomId`),
  INDEX `gift_transactions_senderId_idx` (`senderId`),
  INDEX `gift_transactions_receiverId_idx` (`receiverId`),
  INDEX `gift_transactions_createdAt_idx` (`createdAt`),
  CONSTRAINT `gift_transactions_roomId_fkey`     FOREIGN KEY (`roomId`)     REFERENCES `voice_rooms`(`id`) ON DELETE CASCADE,
  CONSTRAINT `gift_transactions_senderId_fkey`   FOREIGN KEY (`senderId`)   REFERENCES `users`(`id`)       ON DELETE CASCADE,
  CONSTRAINT `gift_transactions_receiverId_fkey` FOREIGN KEY (`receiverId`) REFERENCES `users`(`id`)       ON DELETE CASCADE,
  CONSTRAINT `gift_transactions_giftId_fkey`     FOREIGN KEY (`giftId`)     REFERENCES `gifts`(`id`)       ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Room leaderboard (top gifters per room session)
CREATE TABLE `room_gift_leaderboard` (
  `id`           VARCHAR(191) NOT NULL,
  `roomId`       VARCHAR(191) NOT NULL,
  `userId`       VARCHAR(191) NOT NULL,
  `totalCoins`   INT          NOT NULL DEFAULT 0,
  `giftCount`    INT          NOT NULL DEFAULT 0,
  `updatedAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `room_gift_leaderboard_roomId_userId_key` (`roomId`, `userId`),
  INDEX `room_gift_leaderboard_roomId_idx` (`roomId`),
  INDEX `room_gift_leaderboard_totalCoins_idx` (`totalCoins`),
  CONSTRAINT `room_gift_leaderboard_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `voice_rooms`(`id`) ON DELETE CASCADE,
  CONSTRAINT `room_gift_leaderboard_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`)       ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed default coin packages
INSERT INTO `coin_packages` (`id`, `name`, `coins`, `priceUsd`, `bonusCoins`, `isActive`, `sortOrder`, `createdAt`, `updatedAt`) VALUES
  (UUID(), 'Starter',   100,  0.99,  0,   true, 1, NOW(), NOW()),
  (UUID(), 'Popular',   500,  4.99,  50,  true, 2, NOW(), NOW()),
  (UUID(), 'Value',     1000, 9.99,  150, true, 3, NOW(), NOW()),
  (UUID(), 'Pro',       5000, 49.99, 1000,true, 4, NOW(), NOW()),
  (UUID(), 'Elite',     10000,99.99, 3000,true, 5, NOW(), NOW());

-- Seed default gift catalog
INSERT INTO `gifts` (`id`, `name`, `emoji`, `animationType`, `priceCoins`, `rarity`, `comboEnabled`, `isActive`, `sortOrder`, `createdAt`, `updatedAt`) VALUES
  (UUID(), 'Rose',        '🌹', 'overlay',    5,    'common',    true, true, 1,  NOW(), NOW()),
  (UUID(), 'Heart',       '❤️', 'overlay',    10,   'common',    true, true, 2,  NOW(), NOW()),
  (UUID(), 'Clap',        '👏', 'overlay',    10,   'common',    true, true, 3,  NOW(), NOW()),
  (UUID(), 'Fire',        '🔥', 'overlay',    20,   'common',    true, true, 4,  NOW(), NOW()),
  (UUID(), 'Star',        '⭐', 'overlay',    50,   'rare',      true, true, 5,  NOW(), NOW()),
  (UUID(), 'Diamond',     '💎', 'banner',     100,  'rare',      true, true, 6,  NOW(), NOW()),
  (UUID(), 'Crown',       '👑', 'banner',     200,  'epic',      true, true, 7,  NOW(), NOW()),
  (UUID(), 'Rocket',      '🚀', 'spotlight',  500,  'epic',      true, true, 8,  NOW(), NOW()),
  (UUID(), 'Galaxy',      '🌌', 'fullscreen', 1000, 'legendary', true, true, 9,  NOW(), NOW()),
  (UUID(), 'Trophy',      '🏆', 'fullscreen', 2000, 'legendary', true, true, 10, NOW(), NOW());
