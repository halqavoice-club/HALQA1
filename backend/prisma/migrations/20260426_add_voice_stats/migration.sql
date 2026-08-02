-- Voice Host Stats — tracks per-user daily hosting activity
-- Automatically updated when a room ends

CREATE TABLE `voice_host_stats` (
  `id`              VARCHAR(191) NOT NULL,
  `userId`          VARCHAR(191) NOT NULL,
  `date`            DATE NOT NULL,                    -- one row per user per day
  `roomsHosted`     INT NOT NULL DEFAULT 0,           -- rooms created that day
  `totalMinutes`    INT NOT NULL DEFAULT 0,           -- total hosting minutes
  `peakAudience`    INT NOT NULL DEFAULT 0,           -- highest audience in any room
  `totalListeners`  INT NOT NULL DEFAULT 0,           -- unique listeners across all rooms
  `totalSpeakers`   INT NOT NULL DEFAULT 0,           -- unique speakers promoted
  `totalMessages`   INT NOT NULL DEFAULT 0,           -- chat messages sent in hosted rooms
  `createdAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `voice_host_stats_userId_date_key` (`userId`, `date`),
  INDEX `voice_host_stats_userId_idx` (`userId`),
  INDEX `voice_host_stats_date_idx` (`date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `voice_host_stats`
  ADD CONSTRAINT `voice_host_stats_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
