-- CreateTable: scheduled_jobs
CREATE TABLE IF NOT EXISTS `scheduled_jobs` (
    `id`          VARCHAR(191) NOT NULL,
    `name`        VARCHAR(191) NOT NULL,
    `type`        VARCHAR(50)  NOT NULL,
    `schedule`    VARCHAR(100) NOT NULL,
    `timezone`    VARCHAR(50)  NULL,
    `isActive`    BOOLEAN      NOT NULL DEFAULT true,
    `lastRunAt`   DATETIME(3)  NULL,
    `nextRunAt`   DATETIME(3)  NULL,
    `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`   DATETIME(3)  NOT NULL,

    UNIQUE INDEX `scheduled_jobs_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: job_executions
CREATE TABLE IF NOT EXISTS `job_executions` (
    `id`           VARCHAR(191) NOT NULL,
    `jobId`        VARCHAR(191) NOT NULL,
    `name`         VARCHAR(191) NOT NULL,
    `status`       VARCHAR(50)  NOT NULL,
    `startedAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt`  DATETIME(3)  NULL,
    `error`        TEXT         NULL,

    INDEX `job_executions_jobId_idx`(`jobId`),
    INDEX `job_executions_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `job_executions`
    ADD CONSTRAINT `job_executions_jobId_fkey`
    FOREIGN KEY (`jobId`) REFERENCES `scheduled_jobs`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
