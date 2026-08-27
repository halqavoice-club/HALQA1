-- Migration: 20260824_add_community_invites
-- Adds the community_invites table for the Community Invite System (Phase B-4 extension).
--
-- Design notes:
--   - token is a UUID v4 (36 chars), UNIQUE — used as the secret invite link key
--   - status: PENDING | ACCEPTED | DECLINED | EXPIRED
--   - expiresAt: set to 7 days from creation by default (enforced at app layer)
--   - @@unique([communityId, invitedUserId, status]) prevents duplicate PENDING invites
--     per user per community (MySQL doesn't index NULL the same way, status is always set)
--   - Cascades on community/user delete so orphan rows are never left behind

CREATE TABLE `community_invites` (
  `id`            VARCHAR(36)  NOT NULL,
  `communityId`   VARCHAR(36)  NOT NULL,
  `invitedBy`     VARCHAR(36)  NOT NULL,
  `invitedUserId` VARCHAR(36)  NOT NULL,
  `token`         VARCHAR(36)  NOT NULL,
  `status`        VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
  `expiresAt`     DATETIME(3)  NOT NULL,
  `createdAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `community_invites_token_key` (`token`),
  -- Prevents two PENDING invites for the same user in the same community
  UNIQUE KEY `community_invites_communityId_invitedUserId_status_key` (`communityId`, `invitedUserId`, `status`),
  INDEX `community_invites_communityId_idx` (`communityId`),
  INDEX `community_invites_invitedUserId_idx` (`invitedUserId`),
  INDEX `community_invites_token_idx` (`token`),
  INDEX `community_invites_expiresAt_idx` (`expiresAt`),

  CONSTRAINT `community_invites_communityId_fkey`
    FOREIGN KEY (`communityId`) REFERENCES `communities` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `community_invites_invitedBy_fkey`
    FOREIGN KEY (`invitedBy`)   REFERENCES `users` (`id`)        ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `community_invites_invitedUserId_fkey`
    FOREIGN KEY (`invitedUserId`) REFERENCES `users` (`id`)      ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
