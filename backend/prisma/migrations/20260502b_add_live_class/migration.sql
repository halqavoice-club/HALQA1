-- ─── LIVE CLASS SYSTEM ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `live_classes` (
  `id`              VARCHAR(191) NOT NULL,
  `schoolId`        VARCHAR(191) NOT NULL,
  `classId`         VARCHAR(191) NOT NULL,
  `teacherId`       VARCHAR(191) NOT NULL,
  `title`           VARCHAR(255) NOT NULL,
  `description`     TEXT,
  `scheduledAt`     DATETIME(3),
  `duration`        INT NOT NULL DEFAULT 60,
  `status`          ENUM('SCHEDULED','LIVE','ENDED','CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
  `livekitRoomName` VARCHAR(255),
  `recordingUrl`    VARCHAR(500),
  `coverImageUrl`   VARCHAR(500),
  `maxParticipants` INT NOT NULL DEFAULT 100,
  `isRecorded`      TINYINT(1) NOT NULL DEFAULT 0,
  `chatEnabled`     TINYINT(1) NOT NULL DEFAULT 1,
  `handRaiseEnabled` TINYINT(1) NOT NULL DEFAULT 1,
  `whiteboardEnabled` TINYINT(1) NOT NULL DEFAULT 1,
  `quranPanelEnabled` TINYINT(1) NOT NULL DEFAULT 0,
  `isOpenMic`       TINYINT(1) NOT NULL DEFAULT 0,
  `startedAt`       DATETIME(3),
  `endedAt`         DATETIME(3),
  `deletedAt`       DATETIME(3),
  `createdAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `live_classes_schoolId_idx` (`schoolId`),
  INDEX `live_classes_classId_idx` (`classId`),
  INDEX `live_classes_teacherId_idx` (`teacherId`),
  INDEX `live_classes_status_idx` (`status`),
  INDEX `live_classes_scheduledAt_idx` (`scheduledAt`),
  CONSTRAINT `live_classes_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `live_classes_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `classes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `live_classes_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `teachers` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `live_class_participants` (
  `id`            VARCHAR(191) NOT NULL,
  `liveClassId`   VARCHAR(191) NOT NULL,
  `userId`        VARCHAR(191) NOT NULL,
  `role`          ENUM('HOST','STUDENT','OBSERVER') NOT NULL DEFAULT 'STUDENT',
  `isMuted`       TINYINT(1) NOT NULL DEFAULT 1,
  `isVideoOn`     TINYINT(1) NOT NULL DEFAULT 0,
  `handRaised`    TINYINT(1) NOT NULL DEFAULT 0,
  `handRaisedAt`  DATETIME(3),
  `joinedAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `leftAt`        DATETIME(3),
  `totalDuration` INT NOT NULL DEFAULT 0,
  `isActive`      TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `live_class_participants_liveClassId_userId_key` (`liveClassId`, `userId`),
  INDEX `live_class_participants_liveClassId_idx` (`liveClassId`),
  INDEX `live_class_participants_userId_idx` (`userId`),
  INDEX `live_class_participants_isActive_idx` (`isActive`),
  CONSTRAINT `live_class_participants_liveClassId_fkey` FOREIGN KEY (`liveClassId`) REFERENCES `live_classes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `live_class_participants_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `live_class_messages` (
  `id`          VARCHAR(191) NOT NULL,
  `liveClassId` VARCHAR(191) NOT NULL,
  `userId`      VARCHAR(191) NOT NULL,
  `body`        TEXT NOT NULL,
  `type`        ENUM('TEXT','SYSTEM','POLL','QUESTION') NOT NULL DEFAULT 'TEXT',
  `deletedAt`   DATETIME(3),
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `live_class_messages_liveClassId_idx` (`liveClassId`),
  INDEX `live_class_messages_userId_idx` (`userId`),
  CONSTRAINT `live_class_messages_liveClassId_fkey` FOREIGN KEY (`liveClassId`) REFERENCES `live_classes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `live_class_messages_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `live_class_hand_queue` (
  `id`          VARCHAR(191) NOT NULL,
  `liveClassId` VARCHAR(191) NOT NULL,
  `userId`      VARCHAR(191) NOT NULL,
  `raisedAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `status`      ENUM('WAITING','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'WAITING',
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `live_class_hand_queue_liveClassId_userId_key` (`liveClassId`, `userId`),
  INDEX `live_class_hand_queue_liveClassId_idx` (`liveClassId`),
  CONSTRAINT `live_class_hand_queue_liveClassId_fkey` FOREIGN KEY (`liveClassId`) REFERENCES `live_classes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `live_class_hand_queue_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `live_class_attendance` (
  `id`            VARCHAR(191) NOT NULL,
  `liveClassId`   VARCHAR(191) NOT NULL,
  `studentId`     VARCHAR(191) NOT NULL,
  `joinedAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `leftAt`        DATETIME(3),
  `totalMinutes`  INT NOT NULL DEFAULT 0,
  `status`        ENUM('PRESENT','PARTIAL','ABSENT') NOT NULL DEFAULT 'PRESENT',
  `createdAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `live_class_attendance_liveClassId_studentId_key` (`liveClassId`, `studentId`),
  INDEX `live_class_attendance_liveClassId_idx` (`liveClassId`),
  INDEX `live_class_attendance_studentId_idx` (`studentId`),
  CONSTRAINT `live_class_attendance_liveClassId_fkey` FOREIGN KEY (`liveClassId`) REFERENCES `live_classes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `live_class_attendance_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
