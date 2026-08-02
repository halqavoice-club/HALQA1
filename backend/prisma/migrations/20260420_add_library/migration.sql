-- Library Management Migration
-- Run: npx prisma db push  (when MySQL is running)

CREATE TABLE IF NOT EXISTS `library_books` (
  `id` VARCHAR(191) NOT NULL,
  `schoolId` VARCHAR(191) NULL,
  `title` VARCHAR(191) NOT NULL,
  `author` VARCHAR(191) NULL,
  `isbn` VARCHAR(191) NULL,
  `category` VARCHAR(191) NOT NULL DEFAULT 'Other',
  `description` TEXT NULL,
  `totalCopies` INT NOT NULL DEFAULT 1,
  `addedBy` VARCHAR(191) NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `library_books_schoolId_idx` (`schoolId`),
  INDEX `library_books_category_idx` (`category`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `library_issues` (
  `id` VARCHAR(191) NOT NULL,
  `bookId` VARCHAR(191) NOT NULL,
  `studentId` VARCHAR(191) NOT NULL,
  `issuedBy` VARCHAR(191) NULL,
  `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `dueDate` DATETIME(3) NOT NULL,
  `returnedAt` DATETIME(3) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ISSUED',
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `library_issues_bookId_idx` (`bookId`),
  INDEX `library_issues_studentId_idx` (`studentId`),
  INDEX `library_issues_status_idx` (`status`),
  CONSTRAINT `library_issues_bookId_fkey` FOREIGN KEY (`bookId`) REFERENCES `library_books` (`id`) ON DELETE CASCADE,
  CONSTRAINT `library_issues_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
