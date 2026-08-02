-- Audio Module Migration
-- Run: npx prisma db push  (when XAMPP MySQL is running)

-- Make BehaviorLog.teacherId nullable (allows admins to log behavior)
ALTER TABLE `behavior_logs` MODIFY COLUMN `teacherId` VARCHAR(191) NULL;

CREATE TABLE IF NOT EXISTS `audio_categories` (
  `id` VARCHAR(191) NOT NULL,
  `schoolId` VARCHAR(191) NULL,
  `name` VARCHAR(191) NOT NULL,
  `slug` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `isDefault` BOOLEAN NOT NULL DEFAULT false,
  `isCustom` BOOLEAN NOT NULL DEFAULT false,
  `createdBy` VARCHAR(191) NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `audio_categories_schoolId_slug_key` (`schoolId`, `slug`),
  INDEX `audio_categories_schoolId_idx` (`schoolId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `audio_courses` (
  `id` VARCHAR(191) NOT NULL,
  `schoolId` VARCHAR(191) NULL,
  `categoryId` VARCHAR(191) NOT NULL,
  `teacherId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `coverUrl` VARCHAR(191) NULL,
  `isPublished` BOOLEAN NOT NULL DEFAULT true,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `audio_courses_schoolId_idx` (`schoolId`),
  INDEX `audio_courses_categoryId_idx` (`categoryId`),
  INDEX `audio_courses_teacherId_idx` (`teacherId`),
  CONSTRAINT `audio_courses_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `audio_categories` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `audio_courses_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `teachers` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `audio_lessons` (
  `id` VARCHAR(191) NOT NULL,
  `schoolId` VARCHAR(191) NULL,
  `courseId` VARCHAR(191) NOT NULL,
  `categoryId` VARCHAR(191) NOT NULL,
  `teacherId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `audioUrl` VARCHAR(191) NOT NULL,
  `filename` VARCHAR(191) NOT NULL,
  `originalName` VARCHAR(191) NOT NULL,
  `mimeType` VARCHAR(191) NOT NULL,
  `fileSize` INTEGER NOT NULL,
  `duration` INTEGER NULL,
  `orderIndex` INTEGER NOT NULL DEFAULT 0,
  `isPublished` BOOLEAN NOT NULL DEFAULT true,
  `playCount` INTEGER NOT NULL DEFAULT 0,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `audio_lessons_schoolId_idx` (`schoolId`),
  INDEX `audio_lessons_courseId_idx` (`courseId`),
  INDEX `audio_lessons_categoryId_idx` (`categoryId`),
  INDEX `audio_lessons_teacherId_idx` (`teacherId`),
  CONSTRAINT `audio_lessons_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `audio_courses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `audio_lessons_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `audio_categories` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `audio_lessons_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `teachers` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
