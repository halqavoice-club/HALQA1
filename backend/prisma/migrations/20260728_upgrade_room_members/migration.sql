-- Upgrade voice_room_members with full member management fields
ALTER TABLE `voice_room_members`
  ADD COLUMN `role`         ENUM('OWNER','CO_OWNER','ADMIN','MODERATOR','VIP','OFFICIAL','MEMBER','BLOCKED') NOT NULL DEFAULT 'MEMBER' AFTER `memberLevel`,
  ADD COLUMN `status`       ENUM('PENDING','ACTIVE','REMOVED') NOT NULL DEFAULT 'ACTIVE' AFTER `role`,
  ADD COLUMN `nickname`     VARCHAR(100) NULL AFTER `status`,
  ADD COLUMN `lastActiveAt` DATETIME(3) NULL AFTER `nickname`,
  ADD COLUMN `isOnline`     TINYINT(1) NOT NULL DEFAULT 0 AFTER `lastActiveAt`,
  ADD COLUMN `contribution` INT NOT NULL DEFAULT 0 AFTER `isOnline`,
  ADD COLUMN `invitedBy`    VARCHAR(191) NULL AFTER `contribution`;

-- Indexes for performance
ALTER TABLE `voice_room_members`
  ADD INDEX `voice_room_members_roomId_status_idx` (`roomId`, `status`),
  ADD INDEX `voice_room_members_roomId_role_idx` (`roomId`, `role`),
  ADD INDEX `voice_room_members_roomId_isOnline_idx` (`roomId`, `isOnline`),
  ADD INDEX `voice_room_members_lastActiveAt_idx` (`lastActiveAt`);

-- Pending join requests: set first member (owner) to OWNER role
-- (can't know which is owner here, handled in application logic)
