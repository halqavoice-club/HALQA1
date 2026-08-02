-- ─── User Reports ────────────────────────────────────────────────────────────
CREATE TABLE `user_reports` (
    `id`           VARCHAR(191) NOT NULL,
    `reporterId`   VARCHAR(191) NOT NULL,
    `reportedId`   VARCHAR(191) NOT NULL,
    `roomId`       VARCHAR(191) NULL,
    `reason`       VARCHAR(191) NOT NULL,
    `description`  TEXT NULL,
    `status`       VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `reviewedBy`   VARCHAR(191) NULL,
    `reviewedAt`   DATETIME(3) NULL,
    `createdAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`    DATETIME(3) NOT NULL,

    INDEX `user_reports_reporterId_idx`(`reporterId`),
    INDEX `user_reports_reportedId_idx`(`reportedId`),
    INDEX `user_reports_status_idx`(`status`),
    INDEX `user_reports_createdAt_idx`(`createdAt`),
    UNIQUE INDEX `user_reports_reporterId_reportedId_key`(`reporterId`, `reportedId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── User Blocks ──────────────────────────────────────────────────────────────
CREATE TABLE `user_blocks` (
    `id`          VARCHAR(191) NOT NULL,
    `blockerId`   VARCHAR(191) NOT NULL,
    `blockedId`   VARCHAR(191) NOT NULL,
    `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_blocks_blockerId_idx`(`blockerId`),
    INDEX `user_blocks_blockedId_idx`(`blockedId`),
    UNIQUE INDEX `user_blocks_blockerId_blockedId_key`(`blockerId`, `blockedId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Foreign keys
ALTER TABLE `user_reports` ADD CONSTRAINT `user_reports_reporterId_fkey`  FOREIGN KEY (`reporterId`)  REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `user_reports` ADD CONSTRAINT `user_reports_reportedId_fkey`  FOREIGN KEY (`reportedId`)  REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `user_reports` ADD CONSTRAINT `user_reports_roomId_fkey`      FOREIGN KEY (`roomId`)      REFERENCES `voice_rooms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `user_blocks` ADD CONSTRAINT `user_blocks_blockerId_fkey` FOREIGN KEY (`blockerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `user_blocks` ADD CONSTRAINT `user_blocks_blockedId_fkey` FOREIGN KEY (`blockedId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
