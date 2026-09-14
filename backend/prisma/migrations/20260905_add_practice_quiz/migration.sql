-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260905_add_practice_quiz
-- Description: Add Practice Quiz feature tables
-- Strategy: ADDITIVE ONLY — no existing tables modified, no columns dropped
-- Tables created in dependency order:
--   quizzes → quiz_questions → quiz_options → quiz_attempts → quiz_answers
-- All FK constraints include ON DELETE CASCADE where appropriate.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── quizzes ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `quizzes` (
  `id`           VARCHAR(191) NOT NULL,
  `schoolId`     VARCHAR(191) NOT NULL,
  `classId`      VARCHAR(191) NOT NULL,
  `teacherId`    VARCHAR(191) NOT NULL,
  `title`        VARCHAR(200) NOT NULL,
  `description`  TEXT         NULL,
  `status`       VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
  `timeLimitMin` INT          NULL,
  `openAt`       DATETIME(3)  NULL,
  `closeAt`      DATETIME(3)  NULL,
  `deletedAt`    DATETIME(3)  NULL,
  `createdAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `quizzes_schoolId_idx` (`schoolId`),
  INDEX `quizzes_classId_idx` (`classId`),
  INDEX `quizzes_teacherId_idx` (`teacherId`),
  INDEX `quizzes_classId_status_idx` (`classId`, `status`),
  CONSTRAINT `fk_quizzes_school`
    FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_quizzes_class`
    FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_quizzes_teacher`
    FOREIGN KEY (`teacherId`) REFERENCES `teachers`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── quiz_questions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `quiz_questions` (
  `id`           VARCHAR(191) NOT NULL,
  `quizId`       VARCHAR(191) NOT NULL,
  `position`     INT          NOT NULL,
  `questionType` VARCHAR(30)  NOT NULL,
  `prompt`       TEXT         NOT NULL,
  `modelAnswer`  TEXT         NULL,
  `createdAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `quiz_questions_quizId_idx` (`quizId`),
  INDEX `quiz_questions_quizId_position_idx` (`quizId`, `position`),
  CONSTRAINT `fk_quiz_questions_quiz`
    FOREIGN KEY (`quizId`) REFERENCES `quizzes`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── quiz_options ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `quiz_options` (
  `id`         VARCHAR(191) NOT NULL,
  `questionId` VARCHAR(191) NOT NULL,
  `text`       VARCHAR(500) NOT NULL,
  `isCorrect`  BOOLEAN      NOT NULL DEFAULT false,
  `position`   INT          NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `quiz_options_questionId_idx` (`questionId`),
  CONSTRAINT `fk_quiz_options_question`
    FOREIGN KEY (`questionId`) REFERENCES `quiz_questions`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── quiz_attempts ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `quiz_attempts` (
  `id`          VARCHAR(191) NOT NULL,
  `quizId`      VARCHAR(191) NOT NULL,
  `studentId`   VARCHAR(191) NOT NULL,
  `userId`      VARCHAR(191) NOT NULL,
  `status`      VARCHAR(20)  NOT NULL DEFAULT 'IN_PROGRESS',
  `score`       DOUBLE       NULL,
  `feedback`    TEXT         NULL,
  `startedAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `submittedAt` DATETIME(3)  NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `quiz_attempts_quizId_studentId_key` (`quizId`, `studentId`),
  INDEX `quiz_attempts_quizId_idx` (`quizId`),
  INDEX `quiz_attempts_studentId_idx` (`studentId`),
  INDEX `quiz_attempts_quizId_status_idx` (`quizId`, `status`),
  CONSTRAINT `fk_quiz_attempts_quiz`
    FOREIGN KEY (`quizId`) REFERENCES `quizzes`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_quiz_attempts_student`
    FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── quiz_answers ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `quiz_answers` (
  `id`               VARCHAR(191) NOT NULL,
  `attemptId`        VARCHAR(191) NOT NULL,
  `questionId`       VARCHAR(191) NOT NULL,
  `selectedOptionId` VARCHAR(191) NULL,
  `answerText`       TEXT         NULL,
  `isCorrect`        BOOLEAN      NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `quiz_answers_attemptId_questionId_key` (`attemptId`, `questionId`),
  INDEX `quiz_answers_attemptId_idx` (`attemptId`),
  CONSTRAINT `fk_quiz_answers_attempt`
    FOREIGN KEY (`attemptId`) REFERENCES `quiz_attempts`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_quiz_answers_question`
    FOREIGN KEY (`questionId`) REFERENCES `quiz_questions`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
