-- Migration: 20260803_add_payout_and_2fa
-- Adds:
--   1. twoFactorSecret column to users table (2FA TOTP secret, AES-encrypted)
--   2. payout_requests table (diamond → cash withdrawal requests)
-- All changes are additive and backward-compatible.

-- 1. Add twoFactorSecret to users
ALTER TABLE `users`
  ADD COLUMN `twoFactorSecret` TEXT NULL
    COMMENT 'AES-256 encrypted TOTP secret. NULL = 2FA not configured.';

-- 2. Create payout_requests table
CREATE TABLE `payout_requests` (
  `id`             VARCHAR(36)   NOT NULL,
  `userId`         VARCHAR(36)   NOT NULL,
  `diamonds`       INT           NOT NULL,
  `usdAmount`      DOUBLE        NOT NULL,
  `method`         VARCHAR(30)   NOT NULL,
  `accountDetails` TEXT          NOT NULL,
  `status`         VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
  `adminNote`      VARCHAR(500)  NULL,
  `transactionRef` VARCHAR(200)  NULL,
  `processedAt`    DATETIME(3)   NULL,
  `createdAt`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3)   NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `payout_requests_userId_idx` (`userId`),
  INDEX `payout_requests_status_idx` (`status`),
  INDEX `payout_requests_createdAt_idx` (`createdAt`),

  CONSTRAINT `payout_requests_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
