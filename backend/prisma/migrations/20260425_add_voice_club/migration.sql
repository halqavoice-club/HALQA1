-- Voice Club Feature Migration

-- Enum for room privacy
-- (MySQL doesn't support ALTER TYPE, so we use VARCHAR with CHECK or just VARCHAR)

CREATE TABLE `voice_rooms` (
  `id`           VARCHAR(191) NOT NULL,
  `schoolId`     VARCHAR(191) NULL,
  `hostId`       VARCHAR(191) NOT NULL,
  `title`        VARCHAR(255) NOT NULL,
  `description`  TEXT NULL,
  `privacy`      ENUM('PUBLIC','PRIVATE','INVITE_ONLY') NOT NULL DEFAULT 'PUBLIC',
  `status`       ENUM('LIVE','ENDED','SCHEDULED') NOT NULL DEFAULT 'LIVE',
  `maxSpeakers`  INT NOT NULL DEFAULT 10,
  `coverEmoji`   VARCHAR(10) NULL DEFAULT '🎙️',
  `topic`        VARCHAR(255) NULL,
  `scheduledAt`  DATETIME(3) NULL,
  `startedAt`    DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
  `endedAt`      DATETIME(3) NULL,
  `recordingUrl` VARCHAR(500) NULL,
  `deletedAt`    DATETIME(3) NULL,
  `createdAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `voice_rooms_schoolId_idx` (`schoolId`),
  INDEX `voice_rooms_hostId_idx` (`hostId`),
  INDEX `voice_rooms_status_idx` (`status`),
  INDEX `voice_rooms_privacy_idx` (`privacy`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `voice_participants` (
  `id`          VARCHAR(191) NOT NULL,
  `roomId`      VARCHAR(191) NOT NULL,
  `userId`      VARCHAR(191) NOT NULL,
  `role`        ENUM('HOST','SPEAKER','AUDIENCE') NOT NULL DEFAULT 'AUDIENCE',
  `isMuted`     BOOLEAN NOT NULL DEFAULT TRUE,
  `handRaised`  BOOLEAN NOT NULL DEFAULT FALSE,
  `handRaisedAt` DATETIME(3) NULL,
  `joinedAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `leftAt`      DATETIME(3) NULL,
  `isActive`    BOOLEAN NOT NULL DEFAULT TRUE,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `voice_participants_roomId_userId_key` (`roomId`, `userId`),
  INDEX `voice_participants_roomId_idx` (`roomId`),
  INDEX `voice_participants_userId_idx` (`userId`),
  INDEX `voice_participants_isActive_idx` (`isActive`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `voice_messages` (
  `id`        VARCHAR(191) NOT NULL,
  `roomId`    VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `body`      TEXT NOT NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `voice_messages_roomId_idx` (`roomId`),
  INDEX `voice_messages_userId_idx` (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Foreign keys
ALTER TABLE `voice_rooms`
  ADD CONSTRAINT `voice_rooms_hostId_fkey`
    FOREIGN KEY (`hostId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `voice_participants`
  ADD CONSTRAINT `voice_participants_roomId_fkey`
    FOREIGN KEY (`roomId`) REFERENCES `voice_rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `voice_participants_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `voice_messages`
  ADD CONSTRAINT `voice_messages_roomId_fkey`
    FOREIGN KEY (`roomId`) REFERENCES `voice_rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `voice_messages_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
