-- Phase 24G Economy Remediation — Consolidated Migration
-- Applies all schema changes required by the Phase 24G audit findings.
-- Safe to apply: all changes are additive (new columns nullable, new table,
-- new indexes/constraints on empty or compatible existing data).
--
-- Changes:
--   1. P2-004: WalletTransaction.idempotencyKey — nullable unique column
--   2. P1-003: PlatformRevenueEntry — unique constraint on (sourceType, sourceId)
--   3. P1-002: UserDailyGiftSpend — new table for atomic daily gift cap enforcement
--   4. P2-001: PayoutRequest — composite index (userId, status) for active-payout check
--
-- Pre-flight verified:
--   wallet_transactions: 9 rows, no existing idempotencyKey column
--   platform_revenue_entries: 0 rows, no duplicates
--   user_daily_gift_spend: does not exist
--   DB column names are camelCase (Prisma @map does not rename MySQL columns here)

-- ── 1. WalletTransaction.idempotencyKey ──────────────────────────────────────
-- Nullable so all existing rows remain valid.
-- MySQL allows multiple NULLs in a unique index.
-- NOTE: This step may already be applied if a previous partial run succeeded.
-- The IF NOT EXISTS guard on the index prevents a duplicate-index error.
ALTER TABLE `wallet_transactions`
  ADD COLUMN IF NOT EXISTS `idempotencyKey` VARCHAR(128) NULL;

-- Add unique index only if it doesn't already exist (idempotent re-run safety)
SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_transactions'
    AND INDEX_NAME = 'wallet_transactions_idempotencyKey_key'
);
SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE `wallet_transactions` ADD UNIQUE INDEX `wallet_transactions_idempotencyKey_key` (`idempotencyKey`)',
  'SELECT 1 -- index already exists, skipping'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 2. PlatformRevenueEntry unique constraint ────────────────────────────────
-- Table uses camelCase column names (sourceType, sourceId) in MySQL.
-- Table has 0 rows so no duplicate check needed.
ALTER TABLE `platform_revenue_entries`
  ADD UNIQUE INDEX `uq_platform_revenue_source` (`sourceType`, `sourceId`);

-- ── 3. UserDailyGiftSpend — new table ────────────────────────────────────────
-- Atomic daily cap counter. Updated inside the gift $transaction so the cap
-- check and spend increment are always consistent with the wallet debit.
CREATE TABLE IF NOT EXISTS `user_daily_gift_spend` (
  `id`         VARCHAR(36)  NOT NULL,
  `userId`     VARCHAR(36)  NOT NULL,
  `date`       VARCHAR(10)  NOT NULL,
  `totalSpent` INT          NOT NULL DEFAULT 0,
  `createdAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`  DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `user_daily_gift_spend_userId_date_key` (`userId`, `date`),
  INDEX `user_daily_gift_spend_userId_idx` (`userId`),
  INDEX `user_daily_gift_spend_date_idx` (`date`),
  CONSTRAINT `user_daily_gift_spend_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── 4. PayoutRequest — composite index for active-payout lookup ──────────────
-- Supports the P2-001 fix: efficient lookup of active payouts per user.
ALTER TABLE `payout_requests`
  ADD INDEX `payout_requests_userId_status_idx` (`userId`, `status`);
