-- Migration: 20260818_add_auth_providers
-- Adds a provider-account table for OAuth (Google, Apple, Facebook, etc.)
-- Additive only — no existing columns or tables are modified.

-- AuthProvider table: stores OAuth identity links per user.
-- A user can have multiple providers (Google + password, etc.)
-- provider: GOOGLE | APPLE | FACEBOOK (extensible)
-- providerAccountId: the provider's subject/user ID (e.g. Google sub claim)
-- email: the verified email from the provider (informational only — NOT trusted for auth)
-- NOTE: We never store provider access tokens or refresh tokens here.
CREATE TABLE `auth_providers` (
  `id`                  VARCHAR(191) NOT NULL,
  `userId`              VARCHAR(191) NOT NULL,
  `provider`            VARCHAR(50)  NOT NULL,
  `providerAccountId`   VARCHAR(255) NOT NULL,
  `email`               VARCHAR(255) NULL,
  `displayName`         VARCHAR(255) NULL,
  `avatarUrl`           VARCHAR(512) NULL,
  `createdAt`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  CONSTRAINT `auth_providers_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  -- Unique: one record per provider+account combination (prevents duplicate linking)
  UNIQUE INDEX `auth_providers_provider_providerAccountId_key` (`provider`, `providerAccountId`),
  -- Unique: a user can only link one account per provider (e.g. one Google account)
  UNIQUE INDEX `auth_providers_userId_provider_key` (`userId`, `provider`),
  INDEX `auth_providers_userId_idx` (`userId`),
  INDEX `auth_providers_provider_idx` (`provider`),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Make passwordHash nullable to support OAuth-only accounts
-- (Google users who never set a password will have NULL passwordHash)
ALTER TABLE `users` MODIFY COLUMN `passwordHash` VARCHAR(191) NULL;
