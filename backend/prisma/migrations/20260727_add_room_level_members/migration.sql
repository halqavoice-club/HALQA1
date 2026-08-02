-- Add roomLevel to voice_rooms (1-10, default 1)
ALTER TABLE `voice_rooms` ADD COLUMN `roomLevel` INT NOT NULL DEFAULT 1;

-- Create voice_room_members table
CREATE TABLE `voice_room_members` (
  `id`          VARCHAR(191) NOT NULL,
  `roomId`      VARCHAR(191) NOT NULL,
  `userId`      VARCHAR(191) NOT NULL,
  `memberLevel` INT NOT NULL DEFAULT 1,
  `isBanned`    TINYINT(1) NOT NULL DEFAULT 0,
  `joinedAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `upgradedAt`  DATETIME(3) NULL,
  `note`        VARCHAR(191) NULL,

  UNIQUE INDEX `voice_room_members_roomId_userId_key` (`roomId`, `userId`),
  INDEX `voice_room_members_roomId_idx` (`roomId`),
  INDEX `voice_room_members_userId_idx` (`userId`),
  INDEX `voice_room_members_roomId_memberLevel_idx` (`roomId`, `memberLevel`),
  INDEX `voice_room_members_roomId_isBanned_idx` (`roomId`, `isBanned`),

  PRIMARY KEY (`id`),
  CONSTRAINT `voice_room_members_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `voice_rooms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `voice_room_members_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
