-- AddWalletTransactionLedger
-- Additive migration: new table only, zero changes to existing tables.
-- Provides a full audit trail for all coin credits and debits.
-- The UNIQUE constraint on stripeSessionId is the DB-level defence against
-- Stripe webhook double-credit (primary protection beyond Redis idempotency).

CREATE TABLE `wallet_transactions` (
  `id`               VARCHAR(191) NOT NULL,
  `userId`           VARCHAR(191) NOT NULL,
  `type`             VARCHAR(191) NOT NULL,
  `coins`            INT          NOT NULL,
  `description`      VARCHAR(255) NULL,
  `stripeSessionId`  VARCHAR(191) NULL,
  `packageId`        VARCHAR(191) NULL,
  `giftTxId`         VARCHAR(191) NULL,
  `tipId`            VARCHAR(191) NULL,
  `subscriptionId`   VARCHAR(191) NULL,
  `createdAt`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `wallet_transactions_stripeSessionId_key` (`stripeSessionId`),
  INDEX `wallet_transactions_userId_idx` (`userId`),
  INDEX `wallet_transactions_type_idx` (`type`),
  INDEX `wallet_transactions_createdAt_idx` (`createdAt`),
  INDEX `wallet_transactions_userId_createdAt_idx` (`userId`, `createdAt`),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Foreign key to users table
ALTER TABLE `wallet_transactions`
  ADD CONSTRAINT `wallet_transactions_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `users` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
