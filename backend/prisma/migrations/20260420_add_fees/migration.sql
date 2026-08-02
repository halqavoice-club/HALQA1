-- Fee Management Migration
-- Run: npx prisma db push  (when MySQL is running)

CREATE TABLE IF NOT EXISTS `fee_records` (
  `id` VARCHAR(191) NOT NULL,
  `schoolId` VARCHAR(191) NULL,
  `studentId` VARCHAR(191) NOT NULL,
  `feeType` VARCHAR(191) NOT NULL DEFAULT 'TUITION',
  `amount` DECIMAL(10,2) NOT NULL,
  `description` TEXT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `dueDate` DATETIME(3) NULL,
  `paidAt` DATETIME(3) NULL,
  `notes` TEXT NULL,
  `createdBy` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `fee_records_schoolId_idx` (`schoolId`),
  INDEX `fee_records_studentId_idx` (`studentId`),
  INDEX `fee_records_status_idx` (`status`),
  CONSTRAINT `fee_records_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
