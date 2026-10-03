-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20261003_add_assignment_exam_submissions
-- Description: Add student assignment and exam submission tables (Phase C-2, C-3)
-- Strategy: ADDITIVE ONLY — no existing tables modified
-- Dependency order:
--   schools, classes, grades, students must exist before these tables.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── assignment_submissions ──────────────────────────────────────────────────
CREATE TABLE `assignment_submissions` (
  `id`          VARCHAR(191)                                                  NOT NULL,
  `schoolId`    VARCHAR(191)                                                  NULL,
  `classId`     VARCHAR(191)                                                  NOT NULL,
  `gradeId`     VARCHAR(191)                                                  NULL,
  `studentId`   VARCHAR(191)                                                  NOT NULL,
  `teacherId`   VARCHAR(191)                                                  NULL,
  `title`       VARCHAR(191)                                                  NOT NULL,
  `description` TEXT                                                          NULL,
  `attachments` LONGTEXT                                                      NULL,
  `textContent` TEXT                                                          NULL,
  `status`      ENUM('DRAFT','SUBMITTED','REVIEWED','GRADED','REJECTED','LATE') NOT NULL DEFAULT 'DRAFT',
  `submittedAt` DATETIME(3)                                                   NULL,
  `reviewedAt`  DATETIME(3)                                                   NULL,
  `gradedAt`    DATETIME(3)                                                   NULL,
  `feedback`    TEXT                                                          NULL,
  `score`       DOUBLE                                                        NULL,
  `maxScore`    DOUBLE                                                        NULL,
  `percentage`  DOUBLE                                                        NULL,
  `isLate`      TINYINT(1)                                                    NOT NULL DEFAULT 0,
  `deletedAt`   DATETIME(3)                                                   NULL,
  `createdAt`   DATETIME(3)                                                   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)                                                   NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `assignment_submissions_schoolId_idx` (`schoolId`),
  INDEX `assignment_submissions_classId_idx` (`classId`),
  INDEX `assignment_submissions_gradeId_idx` (`gradeId`),
  INDEX `assignment_submissions_studentId_idx` (`studentId`),
  INDEX `assignment_submissions_status_idx` (`status`),
  INDEX `assignment_submissions_submittedAt_idx` (`submittedAt`),

  CONSTRAINT `assignment_submissions_schoolId_fkey`
    FOREIGN KEY (`schoolId`) REFERENCES `schools` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `assignment_submissions_classId_fkey`
    FOREIGN KEY (`classId`) REFERENCES `classes` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `assignment_submissions_gradeId_fkey`
    FOREIGN KEY (`gradeId`) REFERENCES `grades` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `assignment_submissions_studentId_fkey`
    FOREIGN KEY (`studentId`) REFERENCES `students` (`id`) ON DELETE CASCADE ON UPDATE CASCADE

) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── exam_submissions ────────────────────────────────────────────────────────
CREATE TABLE `exam_submissions` (
  `id`          VARCHAR(191)                                                  NOT NULL,
  `schoolId`    VARCHAR(191)                                                  NULL,
  `classId`     VARCHAR(191)                                                  NOT NULL,
  `gradeId`     VARCHAR(191)                                                  NULL,
  `studentId`   VARCHAR(191)                                                  NOT NULL,
  `teacherId`   VARCHAR(191)                                                  NULL,
  `title`       VARCHAR(191)                                                  NOT NULL,
  `answers`     LONGTEXT                                                      NULL,
  `attachments` LONGTEXT                                                      NULL,
  `status`      ENUM('DRAFT','SUBMITTED','REVIEWED','GRADED','REJECTED','LATE') NOT NULL DEFAULT 'DRAFT',
  `submittedAt` DATETIME(3)                                                   NULL,
  `reviewedAt`  DATETIME(3)                                                   NULL,
  `gradedAt`    DATETIME(3)                                                   NULL,
  `feedback`    TEXT                                                          NULL,
  `score`       DOUBLE                                                        NULL,
  `maxScore`    DOUBLE                                                        NULL,
  `percentage`  DOUBLE                                                        NULL,
  `autoGraded`  TINYINT(1)                                                    NOT NULL DEFAULT 0,
  `deletedAt`   DATETIME(3)                                                   NULL,
  `createdAt`   DATETIME(3)                                                   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)                                                   NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `exam_submissions_schoolId_idx` (`schoolId`),
  INDEX `exam_submissions_classId_idx` (`classId`),
  INDEX `exam_submissions_gradeId_idx` (`gradeId`),
  INDEX `exam_submissions_studentId_idx` (`studentId`),
  INDEX `exam_submissions_status_idx` (`status`),
  INDEX `exam_submissions_submittedAt_idx` (`submittedAt`),

  CONSTRAINT `exam_submissions_schoolId_fkey`
    FOREIGN KEY (`schoolId`) REFERENCES `schools` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `exam_submissions_classId_fkey`
    FOREIGN KEY (`classId`) REFERENCES `classes` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `exam_submissions_gradeId_fkey`
    FOREIGN KEY (`gradeId`) REFERENCES `grades` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `exam_submissions_studentId_fkey`
    FOREIGN KEY (`studentId`) REFERENCES `students` (`id`) ON DELETE CASCADE ON UPDATE CASCADE

) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
