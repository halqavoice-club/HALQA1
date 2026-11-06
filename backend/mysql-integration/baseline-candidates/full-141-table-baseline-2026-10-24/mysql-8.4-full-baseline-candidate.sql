-- CreateTable
CREATE TABLE `schools` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'school',
    `description` TEXT NULL,
    `address` TEXT NULL,
    `city` VARCHAR(191) NULL,
    `state` VARCHAR(191) NULL,
    `country` VARCHAR(191) NOT NULL DEFAULT 'US',
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `website` VARCHAR(191) NULL,
    `logoUrl` VARCHAR(191) NULL,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'America/New_York',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `schools_slug_key`(`slug`),
    INDEX `schools_slug_idx`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `school_settings` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `gradingScale` JSON NULL,
    `attendanceTypes` JSON NULL,
    `behaviorCategories` JSON NULL,
    `workingDays` JSON NULL,
    `schoolStartTime` VARCHAR(191) NOT NULL DEFAULT '08:00',
    `schoolEndTime` VARCHAR(191) NOT NULL DEFAULT '15:00',
    `allowSelfCheckIn` BOOLEAN NOT NULL DEFAULT true,
    `requireGpsCheckIn` BOOLEAN NOT NULL DEFAULT false,
    `parentNotifications` BOOLEAN NOT NULL DEFAULT true,
    `smsEnabled` BOOLEAN NOT NULL DEFAULT false,
    `emailEnabled` BOOLEAN NOT NULL DEFAULT true,
    `pushEnabled` BOOLEAN NOT NULL DEFAULT true,
    `maxAbsenceAlert` INTEGER NOT NULL DEFAULT 3,
    `passingGrade` DOUBLE NOT NULL DEFAULT 60.0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `school_settings_schoolId_key`(`schoolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `passwordHash` VARCHAR(191) NULL,
    `role` ENUM('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'GUARDIAN', 'REPRESENTATIVE', 'MEMBER') NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING', 'BANNED') NOT NULL DEFAULT 'PENDING',
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `avatarUrl` VARCHAR(191) NULL,
    `dateOfBirth` DATETIME(3) NULL,
    `gender` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `city` VARCHAR(191) NULL,
    `country` VARCHAR(191) NULL,
    `language` VARCHAR(191) NOT NULL DEFAULT 'en',
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'America/New_York',
    `bio` TEXT NULL,
    `username` VARCHAR(30) NULL,
    `fcmToken` VARCHAR(512) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `emailVerified` BOOLEAN NOT NULL DEFAULT false,
    `phoneVerified` BOOLEAN NOT NULL DEFAULT false,
    `twoFactorEnabled` BOOLEAN NOT NULL DEFAULT false,
    `twoFactorSecret` TEXT NULL,
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_username_key`(`username`),
    INDEX `users_email_idx`(`email`),
    INDEX `users_schoolId_idx`(`schoolId`),
    INDEX `users_role_idx`(`role`),
    INDEX `users_firstName_idx`(`firstName`),
    INDEX `users_lastName_idx`(`lastName`),
    INDEX `users_username_idx`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `school_memberships` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `invitedBy` VARCHAR(191) NULL,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `school_memberships_userId_idx`(`userId`),
    INDEX `school_memberships_schoolId_idx`(`schoolId`),
    INDEX `school_memberships_role_idx`(`role`),
    INDEX `school_memberships_status_idx`(`status`),
    INDEX `school_memberships_userId_status_idx`(`userId`, `status`),
    INDEX `school_memberships_schoolId_role_status_idx`(`schoolId`, `role`, `status`),
    UNIQUE INDEX `school_memberships_userId_schoolId_key`(`userId`, `schoolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_providers` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(50) NOT NULL,
    `providerAccountId` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NULL,
    `displayName` VARCHAR(255) NULL,
    `avatarUrl` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `auth_providers_userId_idx`(`userId`),
    INDEX `auth_providers_provider_idx`(`provider`),
    UNIQUE INDEX `auth_providers_provider_providerAccountId_key`(`provider`, `providerAccountId`),
    UNIQUE INDEX `auth_providers_userId_provider_key`(`userId`, `provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `token` VARCHAR(512) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `isRevoked` BOOLEAN NOT NULL DEFAULT false,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_token_key`(`token`),
    INDEX `refresh_tokens_userId_idx`(`userId`),
    INDEX `refresh_tokens_expiresAt_idx`(`expiresAt`),
    INDEX `refresh_tokens_isRevoked_idx`(`isRevoked`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `otp_codes` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `isUsed` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `otp_codes_userId_idx`(`userId`),
    INDEX `otp_codes_expiresAt_idx`(`expiresAt`),
    INDEX `otp_codes_isUsed_idx`(`isUsed`),
    INDEX `otp_codes_userId_type_isUsed_idx`(`userId`, `type`, `isUsed`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `terms` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `isCurrent` BOOLEAN NOT NULL DEFAULT false,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `terms_schoolId_idx`(`schoolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `classes` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `termId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `gradeLevel` VARCHAR(191) NULL,
    `room` VARCHAR(191) NULL,
    `capacity` INTEGER NOT NULL DEFAULT 30,
    `schedule` JSON NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `classes_schoolId_idx`(`schoolId`),
    INDEX `classes_termId_idx`(`termId`),
    INDEX `classes_schoolId_isActive_idx`(`schoolId`, `isActive`),
    INDEX `classes_schoolId_isDefault_idx`(`schoolId`, `isDefault`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `students` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `qrCode` VARCHAR(191) NULL,
    `gradeLevel` VARCHAR(191) NULL,
    `enrollmentDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `graduationDate` DATETIME(3) NULL,
    `medicalNotes` TEXT NULL,
    `emergencyContact` JSON NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `students_userId_key`(`userId`),
    UNIQUE INDEX `students_qrCode_key`(`qrCode`),
    INDEX `students_schoolId_idx`(`schoolId`),
    INDEX `students_qrCode_idx`(`qrCode`),
    INDEX `students_studentId_idx`(`studentId`),
    INDEX `students_gradeLevel_idx`(`gradeLevel`),
    INDEX `students_schoolId_deletedAt_idx`(`schoolId`, `deletedAt`),
    UNIQUE INDEX `students_schoolId_studentId_key`(`schoolId`, `studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teachers` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NULL,
    `department` VARCHAR(191) NULL,
    `specialization` VARCHAR(191) NULL,
    `hireDate` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `teachers_userId_key`(`userId`),
    INDEX `teachers_schoolId_idx`(`schoolId`),
    INDEX `teachers_schoolId_deletedAt_idx`(`schoolId`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `guardians` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `relationship` VARCHAR(191) NOT NULL DEFAULT 'parent',
    `occupation` VARCHAR(191) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `guardians_userId_key`(`userId`),
    INDEX `guardians_schoolId_idx`(`schoolId`),
    INDEX `guardians_schoolId_deletedAt_idx`(`schoolId`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `guardian_students` (
    `id` VARCHAR(191) NOT NULL,
    `guardianId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `guardian_students_guardianId_studentId_key`(`guardianId`, `studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teacher_classes` (
    `id` VARCHAR(191) NOT NULL,
    `teacherId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NOT NULL,
    `isLead` BOOLEAN NOT NULL DEFAULT false,
    `subject` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `teacher_classes_teacherId_classId_key`(`teacherId`, `classId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enrollments` (
    `id` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NOT NULL,
    `enrolledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `droppedAt` DATETIME(3) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `enrollments_classId_idx`(`classId`),
    INDEX `enrollments_studentId_isActive_idx`(`studentId`, `isActive`),
    INDEX `enrollments_classId_isActive_idx`(`classId`, `isActive`),
    INDEX `enrollments_studentId_classId_isActive_idx`(`studentId`, `classId`, `isActive`),
    UNIQUE INDEX `enrollments_studentId_classId_key`(`studentId`, `classId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `classId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `teacherId` VARCHAR(191) NULL,
    `date` DATE NOT NULL,
    `status` ENUM('PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'LEFT_EARLY', 'CUSTOM_1', 'CUSTOM_2', 'CUSTOM_3', 'CUSTOM_4', 'CUSTOM_5') NOT NULL DEFAULT 'PRESENT',
    `checkInTime` DATETIME(3) NULL,
    `checkOutTime` DATETIME(3) NULL,
    `checkInMethod` VARCHAR(191) NULL,
    `checkInLat` DOUBLE NULL,
    `checkInLng` DOUBLE NULL,
    `notes` TEXT NULL,
    `notifiedParent` BOOLEAN NOT NULL DEFAULT false,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `attendance_classId_idx`(`classId`),
    INDEX `attendance_studentId_idx`(`studentId`),
    INDEX `attendance_date_idx`(`date`),
    INDEX `attendance_schoolId_date_idx`(`schoolId`, `date`),
    INDEX `attendance_studentId_date_status_idx`(`studentId`, `date`, `status`),
    INDEX `attendance_classId_date_status_idx`(`classId`, `date`, `status`),
    INDEX `attendance_notifiedParent_status_date_idx`(`notifiedParent`, `status`, `date`),
    UNIQUE INDEX `attendance_classId_studentId_date_key`(`classId`, `studentId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_logs` (
    `id` VARCHAR(191) NOT NULL,
    `attendanceId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `previousStatus` VARCHAR(191) NULL,
    `newStatus` VARCHAR(191) NULL,
    `performedBy` VARCHAR(191) NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notes` TEXT NULL,

    INDEX `attendance_logs_attendanceId_idx`(`attendanceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `behavior_logs` (
    `id` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `teacherId` VARCHAR(191) NULL,
    `type` ENUM('POSITIVE', 'NEGATIVE') NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `points` INTEGER NOT NULL,
    `description` TEXT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notifiedParent` BOOLEAN NOT NULL DEFAULT false,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `behavior_logs_studentId_idx`(`studentId`),
    INDEX `behavior_logs_teacherId_idx`(`teacherId`),
    INDEX `behavior_logs_date_idx`(`date`),
    INDEX `behavior_logs_studentId_date_idx`(`studentId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `grade_categories` (
    `id` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `weight` DOUBLE NOT NULL DEFAULT 100,
    `maxPoints` DOUBLE NOT NULL DEFAULT 100,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `grade_categories_classId_idx`(`classId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `grades` (
    `id` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NOT NULL,
    `termId` VARCHAR(191) NULL,
    `teacherId` VARCHAR(191) NULL,
    `categoryId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `score` DOUBLE NOT NULL,
    `maxScore` DOUBLE NOT NULL DEFAULT 100,
    `weight` DOUBLE NOT NULL DEFAULT 1.0,
    `percentage` DOUBLE NULL,
    `letterGrade` VARCHAR(191) NULL,
    `feedback` TEXT NULL,
    `gradedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dueDate` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `grades_studentId_idx`(`studentId`),
    INDEX `grades_classId_idx`(`classId`),
    INDEX `grades_termId_idx`(`termId`),
    INDEX `grades_studentId_classId_termId_idx`(`studentId`, `classId`, `termId`),
    INDEX `grades_classId_termId_type_idx`(`classId`, `termId`, `type`),
    INDEX `grades_studentId_deletedAt_idx`(`studentId`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activities` (
    `id` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NOT NULL,
    `teacherId` VARCHAR(191) NULL,
    `type` ENUM('EXAM', 'BREAK', 'LIBRARY', 'PRAYER', 'MEMORIZATION', 'COUNSELING', 'OTHER') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `startTime` DATETIME(3) NULL,
    `endTime` DATETIME(3) NULL,
    `duration` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `activities_classId_idx`(`classId`),
    INDEX `activities_classId_deletedAt_idx`(`classId`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activity_participants` (
    `id` VARCHAR(191) NOT NULL,
    `activityId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `joinedAt` DATETIME(3) NULL,
    `leftAt` DATETIME(3) NULL,
    `duration` INTEGER NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `activity_participants_activityId_studentId_key`(`activityId`, `studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `messages` (
    `id` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NULL,
    `body` TEXT NOT NULL,
    `attachments` JSON NULL,
    `isAnnouncement` BOOLEAN NOT NULL DEFAULT false,
    `schoolId` VARCHAR(191) NULL,
    `classId` VARCHAR(191) NULL,
    `parentMessageId` VARCHAR(191) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `messages_senderId_idx`(`senderId`),
    INDEX `messages_parentMessageId_idx`(`parentMessageId`),
    INDEX `messages_senderId_deletedAt_idx`(`senderId`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_recipients` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `recipientId` VARCHAR(191) NOT NULL,
    `status` ENUM('SENT', 'DELIVERED', 'READ') NOT NULL DEFAULT 'SENT',
    `readAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `message_recipients_recipientId_idx`(`recipientId`),
    UNIQUE INDEX `message_recipients_messageId_recipientId_key`(`messageId`, `recipientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `type` ENUM('ATTENDANCE', 'GRADE', 'BEHAVIOR', 'MESSAGE', 'ANNOUNCEMENT', 'REMINDER', 'SYSTEM', 'FOLLOW', 'LIKE', 'COMMENT', 'COMMENT_REPLY', 'FRIEND_REQUEST', 'FRIEND_ACCEPTED', 'COMMUNITY_JOIN', 'COMMUNITY_INVITE', 'GIFT_RECEIVED', 'TIP_RECEIVED', 'NEW_SUBSCRIBER', 'MENTION', 'VOICE_ROOM_LIVE', 'LIVE_CLASS_START', 'COINS_PURCHASED', 'PK_INVITATION', 'PK_ACCEPTED', 'PK_STARTING', 'PK_RESULT', 'PK_ACHIEVEMENT', 'PK_MISSION', 'PK_TOURNAMENT', 'PK_SEASON') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `data` JSON NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `readAt` DATETIME(3) NULL,
    `sentVia` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_userId_idx`(`userId`),
    INDEX `notifications_isRead_idx`(`isRead`),
    INDEX `notifications_userId_isRead_createdAt_idx`(`userId`, `isRead`, `createdAt`),
    INDEX `notifications_userId_type_createdAt_idx`(`userId`, `type`, `createdAt`),
    INDEX `notifications_userId_type_isRead_idx`(`userId`, `type`, `isRead`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calendar_events` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `type` ENUM('EXAM', 'ASSIGNMENT', 'HOLIDAY', 'MEETING', 'CLASS', 'PRAYER', 'ACTIVITY', 'OTHER') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NULL,
    `allDay` BOOLEAN NOT NULL DEFAULT false,
    `location` VARCHAR(191) NULL,
    `color` VARCHAR(191) NULL,
    `isPublic` BOOLEAN NOT NULL DEFAULT true,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `calendar_events_schoolId_idx`(`schoolId`),
    INDEX `calendar_events_classId_idx`(`classId`),
    INDEX `calendar_events_startDate_idx`(`startDate`),
    INDEX `calendar_events_schoolId_startDate_endDate_idx`(`schoolId`, `startDate`, `endDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notes` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NULL,
    `studentId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `isPrivate` BOOLEAN NOT NULL DEFAULT false,
    `attachments` JSON NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `notes_userId_idx`(`userId`),
    INDEX `notes_classId_idx`(`classId`),
    INDEX `notes_userId_deletedAt_idx`(`userId`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `announcements` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `targetRoles` JSON NULL,
    `classIds` JSON NULL,
    `isPinned` BOOLEAN NOT NULL DEFAULT false,
    `publishAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `announcements_schoolId_idx`(`schoolId`),
    INDEX `announcements_publishAt_idx`(`publishAt`),
    INDEX `announcements_schoolId_isPinned_publishAt_idx`(`schoolId`, `isPinned`, `publishAt`),
    INDEX `announcements_schoolId_expiresAt_idx`(`schoolId`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `file_uploads` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `filename` VARCHAR(191) NOT NULL,
    `originalName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `size` INTEGER NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `storageType` VARCHAR(191) NOT NULL DEFAULT 'local',
    `entityType` VARCHAR(191) NULL,
    `entityId` VARCHAR(191) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `file_uploads_userId_idx`(`userId`),
    INDEX `file_uploads_schoolId_idx`(`schoolId`),
    INDEX `file_uploads_entityType_entityId_idx`(`entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reports` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `generatedBy` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `parameters` JSON NULL,
    `fileUrl` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `reports_schoolId_idx`(`schoolId`),
    INDEX `reports_status_idx`(`status`),
    INDEX `reports_generatedBy_idx`(`generatedBy`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_books` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `author` VARCHAR(191) NULL,
    `isbn` VARCHAR(191) NULL,
    `category` VARCHAR(191) NOT NULL DEFAULT 'Other',
    `description` TEXT NULL,
    `totalCopies` INTEGER NOT NULL DEFAULT 1,
    `addedBy` VARCHAR(191) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `library_books_schoolId_idx`(`schoolId`),
    INDEX `library_books_category_idx`(`category`),
    INDEX `library_books_schoolId_deletedAt_idx`(`schoolId`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_issues` (
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
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `library_issues_bookId_idx`(`bookId`),
    INDEX `library_issues_studentId_idx`(`studentId`),
    INDEX `library_issues_status_idx`(`status`),
    INDEX `library_issues_dueDate_idx`(`dueDate`),
    INDEX `library_issues_bookId_studentId_status_idx`(`bookId`, `studentId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_records` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `feeType` VARCHAR(191) NOT NULL DEFAULT 'TUITION',
    `amount` DECIMAL(10, 2) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `dueDate` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NULL,
    `stripeSessionId` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `fee_records_stripeSessionId_key`(`stripeSessionId`),
    INDEX `fee_records_schoolId_idx`(`schoolId`),
    INDEX `fee_records_studentId_idx`(`studentId`),
    INDEX `fee_records_status_idx`(`status`),
    INDEX `fee_records_dueDate_idx`(`dueDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audio_categories` (
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

    INDEX `audio_categories_schoolId_idx`(`schoolId`),
    UNIQUE INDEX `audio_categories_schoolId_slug_key`(`schoolId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audio_courses` (
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

    INDEX `audio_courses_schoolId_idx`(`schoolId`),
    INDEX `audio_courses_categoryId_idx`(`categoryId`),
    INDEX `audio_courses_teacherId_idx`(`teacherId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audio_lessons` (
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

    INDEX `audio_lessons_schoolId_idx`(`schoolId`),
    INDEX `audio_lessons_courseId_idx`(`courseId`),
    INDEX `audio_lessons_categoryId_idx`(`categoryId`),
    INDEX `audio_lessons_teacherId_idx`(`teacherId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `voice_rooms` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `hostId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `privacy` ENUM('PUBLIC', 'PRIVATE', 'INVITE_ONLY') NOT NULL DEFAULT 'PUBLIC',
    `status` ENUM('LIVE', 'IDLE', 'ENDED', 'SCHEDULED') NOT NULL DEFAULT 'IDLE',
    `maxSpeakers` INTEGER NOT NULL DEFAULT 12,
    `isOpenMic` BOOLEAN NOT NULL DEFAULT false,
    `micLocked` BOOLEAN NOT NULL DEFAULT false,
    `allMuted` BOOLEAN NOT NULL DEFAULT false,
    `roomLevel` INTEGER NOT NULL DEFAULT 1,
    `coverEmoji` VARCHAR(191) NULL DEFAULT '🎙️',
    `coverImageUrl` VARCHAR(191) NULL,
    `topic` VARCHAR(191) NULL,
    `scheduledAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,
    `lastActivityAt` DATETIME(3) NULL,
    `recordingUrl` VARCHAR(191) NULL,
    `commentsEnabled` BOOLEAN NOT NULL DEFAULT true,
    `slowMode` BOOLEAN NOT NULL DEFAULT false,
    `messageType` VARCHAR(191) NOT NULL DEFAULT 'all',
    `reactionsEnabled` BOOLEAN NOT NULL DEFAULT true,
    `lockedSeats` JSON NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `voice_rooms_schoolId_idx`(`schoolId`),
    INDEX `voice_rooms_hostId_idx`(`hostId`),
    INDEX `voice_rooms_status_idx`(`status`),
    INDEX `voice_rooms_privacy_idx`(`privacy`),
    INDEX `voice_rooms_status_privacy_schoolId_idx`(`status`, `privacy`, `schoolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `voice_participants` (
    `id` VARCHAR(191) NOT NULL,
    `roomId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` ENUM('HOST', 'MODERATOR', 'SPEAKER', 'AUDIENCE') NOT NULL DEFAULT 'AUDIENCE',
    `isMuted` BOOLEAN NOT NULL DEFAULT true,
    `mutedByModerator` BOOLEAN NOT NULL DEFAULT false,
    `handRaised` BOOLEAN NOT NULL DEFAULT false,
    `handRaisedAt` DATETIME(3) NULL,
    `isPinned` BOOLEAN NOT NULL DEFAULT false,
    `seatNumber` INTEGER NULL,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leftAt` DATETIME(3) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `wasKicked` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `voice_participants_roomId_idx`(`roomId`),
    INDEX `voice_participants_userId_idx`(`userId`),
    INDEX `voice_participants_isActive_idx`(`isActive`),
    INDEX `voice_participants_roomId_isActive_role_idx`(`roomId`, `isActive`, `role`),
    INDEX `voice_participants_roomId_isActive_handRaised_handRaisedAt_idx`(`roomId`, `isActive`, `handRaised`, `handRaisedAt`),
    INDEX `voice_participants_roomId_isActive_seatNumber_idx`(`roomId`, `isActive`, `seatNumber`),
    UNIQUE INDEX `voice_participants_roomId_userId_key`(`roomId`, `userId`),
    UNIQUE INDEX `voice_participants_roomId_seatNumber_key`(`roomId`, `seatNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `voice_room_members` (
    `id` VARCHAR(191) NOT NULL,
    `roomId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `memberLevel` INTEGER NOT NULL DEFAULT 1,
    `role` VARCHAR(191) NOT NULL DEFAULT 'MEMBER',
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `nickname` VARCHAR(191) NULL,
    `lastActiveAt` DATETIME(3) NULL,
    `isOnline` BOOLEAN NOT NULL DEFAULT false,
    `contribution` INTEGER NOT NULL DEFAULT 0,
    `invitedBy` VARCHAR(191) NULL,
    `isBanned` BOOLEAN NOT NULL DEFAULT false,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `upgradedAt` DATETIME(3) NULL,
    `note` VARCHAR(191) NULL,

    INDEX `voice_room_members_roomId_idx`(`roomId`),
    INDEX `voice_room_members_userId_idx`(`userId`),
    INDEX `voice_room_members_roomId_memberLevel_idx`(`roomId`, `memberLevel`),
    INDEX `voice_room_members_roomId_isBanned_idx`(`roomId`, `isBanned`),
    INDEX `voice_room_members_roomId_status_idx`(`roomId`, `status`),
    INDEX `voice_room_members_roomId_role_idx`(`roomId`, `role`),
    INDEX `voice_room_members_roomId_isOnline_idx`(`roomId`, `isOnline`),
    INDEX `voice_room_members_lastActiveAt_idx`(`lastActiveAt`),
    UNIQUE INDEX `voice_room_members_roomId_userId_key`(`roomId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `voice_messages` (
    `id` VARCHAR(191) NOT NULL,
    `roomId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `voice_messages_roomId_idx`(`roomId`),
    INDEX `voice_messages_userId_idx`(`userId`),
    INDEX `voice_messages_roomId_createdAt_idx`(`roomId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `schoolId` VARCHAR(191) NULL,
    `action` ENUM('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'IMPORT', 'VIEW') NOT NULL,
    `entity` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NULL,
    `oldValues` JSON NULL,
    `newValues` JSON NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_userId_idx`(`userId`),
    INDEX `audit_logs_schoolId_idx`(`schoolId`),
    INDEX `audit_logs_entity_idx`(`entity`),
    INDEX `audit_logs_createdAt_idx`(`createdAt`),
    INDEX `audit_logs_schoolId_action_createdAt_idx`(`schoolId`, `action`, `createdAt`),
    INDEX `audit_logs_entity_entityId_createdAt_idx`(`entity`, `entityId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `voice_host_stats` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `roomsHosted` INTEGER NOT NULL DEFAULT 0,
    `totalMinutes` INTEGER NOT NULL DEFAULT 0,
    `peakAudience` INTEGER NOT NULL DEFAULT 0,
    `totalListeners` INTEGER NOT NULL DEFAULT 0,
    `totalSpeakers` INTEGER NOT NULL DEFAULT 0,
    `totalMessages` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `voice_host_stats_userId_idx`(`userId`),
    INDEX `voice_host_stats_date_idx`(`date`),
    UNIQUE INDEX `voice_host_stats_userId_date_key`(`userId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wallets` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `coins` INTEGER NOT NULL DEFAULT 0,
    `diamonds` INTEGER NOT NULL DEFAULT 0,
    `totalSpent` INTEGER NOT NULL DEFAULT 0,
    `totalEarned` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `wallets_userId_key`(`userId`),
    INDEX `wallets_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wallet_transactions` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `coins` INTEGER NOT NULL,
    `diamonds` INTEGER NOT NULL DEFAULT 0,
    `description` VARCHAR(255) NULL,
    `stripeSessionId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(128) NULL,
    `packageId` VARCHAR(191) NULL,
    `giftTxId` VARCHAR(191) NULL,
    `tipId` VARCHAR(191) NULL,
    `subscriptionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `wallet_transactions_stripeSessionId_key`(`stripeSessionId`),
    UNIQUE INDEX `wallet_transactions_idempotencyKey_key`(`idempotencyKey`),
    INDEX `wallet_transactions_userId_idx`(`userId`),
    INDEX `wallet_transactions_type_idx`(`type`),
    INDEX `wallet_transactions_createdAt_idx`(`createdAt`),
    INDEX `wallet_transactions_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_revenue_entries` (
    `id` VARCHAR(191) NOT NULL,
    `source_type` VARCHAR(50) NOT NULL,
    `source_id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `coins` INTEGER NOT NULL,
    `usd_equiv` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `platform_revenue_entries_source_type_idx`(`source_type`),
    INDEX `platform_revenue_entries_user_id_idx`(`user_id`),
    INDEX `platform_revenue_entries_created_at_idx`(`created_at`),
    INDEX `platform_revenue_entries_source_type_created_at_idx`(`source_type`, `created_at`),
    UNIQUE INDEX `uq_platform_revenue_source`(`source_type`, `source_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coin_packages` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `coins` INTEGER NOT NULL,
    `priceUsd` DECIMAL(10, 2) NOT NULL,
    `bonusCoins` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gifts` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `emoji` VARCHAR(191) NOT NULL DEFAULT '🎁',
    `imageUrl` VARCHAR(191) NULL,
    `videoUrl` VARCHAR(191) NULL,
    `animationType` VARCHAR(191) NOT NULL DEFAULT 'overlay',
    `soundEffect` VARCHAR(191) NULL,
    `priceCoins` INTEGER NOT NULL,
    `rarity` VARCHAR(191) NOT NULL DEFAULT 'common',
    `comboEnabled` BOOLEAN NOT NULL DEFAULT true,
    `priority` VARCHAR(191) NOT NULL DEFAULT 'normal',
    `isPremium` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `gifts_isActive_idx`(`isActive`),
    INDEX `gifts_isPremium_idx`(`isPremium`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gift_transactions` (
    `id` VARCHAR(191) NOT NULL,
    `roomId` VARCHAR(191) NOT NULL,
    `room_type` VARCHAR(191) NOT NULL DEFAULT 'voice',
    `senderId` VARCHAR(191) NOT NULL,
    `receiverId` VARCHAR(191) NOT NULL,
    `giftId` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 1,
    `combo` INTEGER NOT NULL DEFAULT 1,
    `priority` VARCHAR(191) NOT NULL DEFAULT 'normal',
    `isPremium` BOOLEAN NOT NULL DEFAULT false,
    `coinsSpent` INTEGER NOT NULL,
    `diamondsEarned` INTEGER NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `gift_transactions_idempotencyKey_key`(`idempotencyKey`),
    INDEX `gift_transactions_roomId_idx`(`roomId`),
    INDEX `gift_transactions_room_type_idx`(`room_type`),
    INDEX `gift_transactions_senderId_idx`(`senderId`),
    INDEX `gift_transactions_receiverId_idx`(`receiverId`),
    INDEX `gift_transactions_createdAt_idx`(`createdAt`),
    INDEX `gift_transactions_isPremium_idx`(`isPremium`),
    INDEX `gift_transactions_createdAt_senderId_idx`(`createdAt`, `senderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `room_gift_leaderboard` (
    `id` VARCHAR(191) NOT NULL,
    `roomId` VARCHAR(191) NOT NULL,
    `room_type` VARCHAR(191) NOT NULL DEFAULT 'voice',
    `userId` VARCHAR(191) NOT NULL,
    `totalCoins` INTEGER NOT NULL DEFAULT 0,
    `giftCount` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `room_gift_leaderboard_roomId_idx`(`roomId`),
    INDEX `room_gift_leaderboard_room_type_idx`(`room_type`),
    INDEX `room_gift_leaderboard_totalCoins_idx`(`totalCoins`),
    UNIQUE INDEX `room_gift_leaderboard_roomId_userId_key`(`roomId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `follows` (
    `id` VARCHAR(191) NOT NULL,
    `followerId` VARCHAR(191) NOT NULL,
    `followingId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `follows_followerId_idx`(`followerId`),
    INDEX `follows_followingId_idx`(`followingId`),
    UNIQUE INDEX `follows_followerId_followingId_key`(`followerId`, `followingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `friend_requests` (
    `id` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `receiverId` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `friend_requests_senderId_idx`(`senderId`),
    INDEX `friend_requests_receiverId_idx`(`receiverId`),
    INDEX `friend_requests_status_idx`(`status`),
    UNIQUE INDEX `friend_requests_senderId_receiverId_key`(`senderId`, `receiverId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_reports` (
    `id` VARCHAR(191) NOT NULL,
    `reporterId` VARCHAR(191) NOT NULL,
    `reportedId` VARCHAR(191) NOT NULL,
    `roomId` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `reviewedBy` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `user_reports_reporterId_idx`(`reporterId`),
    INDEX `user_reports_reportedId_idx`(`reportedId`),
    INDEX `user_reports_reporterId_reportedId_status_idx`(`reporterId`, `reportedId`, `status`),
    INDEX `user_reports_status_idx`(`status`),
    INDEX `user_reports_createdAt_idx`(`createdAt`),
    UNIQUE INDEX `user_reports_reporterId_reportedId_key`(`reporterId`, `reportedId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `post_reports` (
    `id` VARCHAR(191) NOT NULL,
    `reporterId` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `reviewedBy` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `post_reports_reporterId_idx`(`reporterId`),
    INDEX `post_reports_postId_idx`(`postId`),
    INDEX `post_reports_reporterId_postId_status_idx`(`reporterId`, `postId`, `status`),
    INDEX `post_reports_status_idx`(`status`),
    INDEX `post_reports_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_blocks` (
    `id` VARCHAR(191) NOT NULL,
    `blockerId` VARCHAR(191) NOT NULL,
    `blockedId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_blocks_blockerId_idx`(`blockerId`),
    INDEX `user_blocks_blockedId_idx`(`blockedId`),
    UNIQUE INDEX `user_blocks_blockerId_blockedId_key`(`blockerId`, `blockedId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `live_classes` (
    `id` VARCHAR(191) NOT NULL,
    `stream_type` VARCHAR(20) NOT NULL DEFAULT 'SCHOOL',
    `schoolId` VARCHAR(191) NULL,
    `classId` VARCHAR(191) NULL,
    `teacherId` VARCHAR(191) NULL,
    `host_user_id` VARCHAR(191) NULL,
    `delegated_host_id` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `scheduledAt` DATETIME(3) NULL,
    `duration` INTEGER NULL,
    `status` ENUM('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    `livekitRoomName` VARCHAR(191) NULL,
    `recordingUrl` VARCHAR(191) NULL,
    `coverImageUrl` VARCHAR(191) NULL,
    `maxParticipants` INTEGER NULL,
    `maxSpeakers` INTEGER NOT NULL DEFAULT 20,
    `isRecorded` BOOLEAN NOT NULL DEFAULT false,
    `recordingStartedAt` DATETIME(3) NULL,
    `chatEnabled` BOOLEAN NOT NULL DEFAULT true,
    `handRaiseEnabled` BOOLEAN NOT NULL DEFAULT true,
    `whiteboardEnabled` BOOLEAN NOT NULL DEFAULT true,
    `quranPanelEnabled` BOOLEAN NOT NULL DEFAULT false,
    `isOpenMic` BOOLEAN NOT NULL DEFAULT false,
    `screenShareEnabled` BOOLEAN NOT NULL DEFAULT true,
    `startedAt` DATETIME(3) NULL,
    `endedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `live_classes_stream_type_idx`(`stream_type`),
    INDEX `live_classes_schoolId_idx`(`schoolId`),
    INDEX `live_classes_classId_idx`(`classId`),
    INDEX `live_classes_teacherId_idx`(`teacherId`),
    INDEX `live_classes_host_user_id_idx`(`host_user_id`),
    INDEX `live_classes_delegated_host_id_idx`(`delegated_host_id`),
    INDEX `live_classes_status_idx`(`status`),
    INDEX `live_classes_scheduledAt_idx`(`scheduledAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `live_class_participants` (
    `id` VARCHAR(191) NOT NULL,
    `liveClassId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` ENUM('HOST', 'MODERATOR', 'STUDENT', 'OBSERVER') NOT NULL DEFAULT 'STUDENT',
    `isMuted` BOOLEAN NOT NULL DEFAULT true,
    `isVideoOn` BOOLEAN NOT NULL DEFAULT false,
    `handRaised` BOOLEAN NOT NULL DEFAULT false,
    `handRaisedAt` DATETIME(3) NULL,
    `speakerSlot` INTEGER NULL,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leftAt` DATETIME(3) NULL,
    `totalDuration` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `wasKicked` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `live_class_participants_liveClassId_idx`(`liveClassId`),
    INDEX `live_class_participants_userId_idx`(`userId`),
    INDEX `live_class_participants_isActive_idx`(`isActive`),
    UNIQUE INDEX `live_class_participants_liveClassId_userId_key`(`liveClassId`, `userId`),
    UNIQUE INDEX `live_class_participants_liveClassId_speakerSlot_key`(`liveClassId`, `speakerSlot`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `live_class_messages` (
    `id` VARCHAR(191) NOT NULL,
    `liveClassId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `type` ENUM('TEXT', 'SYSTEM', 'POLL', 'QUESTION') NOT NULL DEFAULT 'TEXT',
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `live_class_messages_liveClassId_idx`(`liveClassId`),
    INDEX `live_class_messages_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `live_class_hand_queue` (
    `id` VARCHAR(191) NOT NULL,
    `liveClassId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `raisedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` ENUM('WAITING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'WAITING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `live_class_hand_queue_liveClassId_idx`(`liveClassId`),
    UNIQUE INDEX `live_class_hand_queue_liveClassId_userId_key`(`liveClassId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `live_class_attendance` (
    `id` VARCHAR(191) NOT NULL,
    `liveClassId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leftAt` DATETIME(3) NULL,
    `totalMinutes` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('PRESENT', 'PARTIAL', 'ABSENT') NOT NULL DEFAULT 'PRESENT',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `live_class_attendance_liveClassId_idx`(`liveClassId`),
    INDEX `live_class_attendance_studentId_idx`(`studentId`),
    UNIQUE INDEX `live_class_attendance_liveClassId_studentId_key`(`liveClassId`, `studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `live_class_polls` (
    `id` VARCHAR(191) NOT NULL,
    `liveClassId` VARCHAR(191) NOT NULL,
    `question` VARCHAR(500) NOT NULL,
    `options` JSON NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `live_class_polls_liveClassId_idx`(`liveClassId`),
    INDEX `live_class_polls_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `live_class_whiteboard_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `liveClassId` VARCHAR(191) NOT NULL,
    `strokes` LONGTEXT NOT NULL,
    `snapshotAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `live_class_whiteboard_snapshots_liveClassId_key`(`liveClassId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dm_conversations` (
    `id` VARCHAR(191) NOT NULL,
    `userAId` VARCHAR(191) NOT NULL,
    `userBId` VARCHAR(191) NOT NULL,
    `lastMessage` TEXT NULL,
    `lastMessageAt` DATETIME(3) NULL,
    `lastSenderId` VARCHAR(191) NULL,
    `unreadA` INTEGER NOT NULL DEFAULT 0,
    `unreadB` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `dm_conversations_userAId_idx`(`userAId`),
    INDEX `dm_conversations_userBId_idx`(`userBId`),
    INDEX `dm_conversations_lastMessageAt_idx`(`lastMessageAt`),
    UNIQUE INDEX `dm_conversations_userAId_userBId_key`(`userAId`, `userBId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `direct_messages` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `receiverId` VARCHAR(191) NOT NULL,
    `body` TEXT NULL,
    `msgType` VARCHAR(191) NOT NULL DEFAULT 'TEXT',
    `mediaUrl` VARCHAR(2048) NULL,
    `mimeType` VARCHAR(128) NULL,
    `fileSize` INTEGER NULL,
    `fileName` VARCHAR(255) NULL,
    `duration` INTEGER NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `thumbnail` VARCHAR(2048) NULL,
    `status` ENUM('SENT', 'DELIVERED', 'READ') NOT NULL DEFAULT 'SENT',
    `deliveredAt` DATETIME(3) NULL,
    `readAt` DATETIME(3) NULL,
    `isEdited` BOOLEAN NOT NULL DEFAULT false,
    `editedAt` DATETIME(3) NULL,
    `deletedBySender` BOOLEAN NOT NULL DEFAULT false,
    `deletedByReceiver` BOOLEAN NOT NULL DEFAULT false,
    `replyToId` VARCHAR(191) NULL,
    `storyId` VARCHAR(191) NULL,
    `refEntityType` VARCHAR(50) NULL,
    `refEntityId` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `direct_messages_conversationId_idx`(`conversationId`),
    INDEX `direct_messages_senderId_idx`(`senderId`),
    INDEX `direct_messages_receiverId_idx`(`receiverId`),
    INDEX `direct_messages_createdAt_idx`(`createdAt`),
    INDEX `direct_messages_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    INDEX `direct_messages_receiverId_status_createdAt_idx`(`receiverId`, `status`, `createdAt`),
    INDEX `direct_messages_storyId_idx`(`storyId`),
    INDEX `direct_messages_msgType_idx`(`msgType`),
    INDEX `direct_messages_refEntityType_refEntityId_idx`(`refEntityType`, `refEntityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dm_reactions` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `emoji` VARCHAR(10) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `dm_reactions_messageId_idx`(`messageId`),
    INDEX `dm_reactions_userId_idx`(`userId`),
    UNIQUE INDEX `dm_reactions_messageId_userId_emoji_key`(`messageId`, `userId`, `emoji`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hashtags` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `postCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `hashtags_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `posts` (
    `id` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `body` TEXT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'TEXT',
    `visibility` VARCHAR(191) NOT NULL DEFAULT 'PUBLIC',
    `schoolId` VARCHAR(191) NULL,
    `likeCount` INTEGER NOT NULL DEFAULT 0,
    `commentCount` INTEGER NOT NULL DEFAULT 0,
    `shareCount` INTEGER NOT NULL DEFAULT 0,
    `viewCount` INTEGER NOT NULL DEFAULT 0,
    `bookmarkCount` INTEGER NOT NULL DEFAULT 0,
    `isPinned` BOOLEAN NOT NULL DEFAULT false,
    `isArchived` BOOLEAN NOT NULL DEFAULT false,
    `isDraft` BOOLEAN NOT NULL DEFAULT false,
    `scheduledAt` DATETIME(3) NULL,
    `originalPostId` VARCHAR(191) NULL,
    `quotedBody` TEXT NULL,
    `linkUrl` VARCHAR(2048) NULL,
    `linkTitle` VARCHAR(512) NULL,
    `linkDescription` TEXT NULL,
    `linkImage` VARCHAR(2048) NULL,
    `pollData` JSON NULL,
    `refEntityType` VARCHAR(191) NULL,
    `refEntityId` VARCHAR(191) NULL,
    `communityId` VARCHAR(191) NULL,
    `isExclusive` BOOLEAN NULL DEFAULT false,
    `tierRequired` VARCHAR(191) NULL,
    `location` VARCHAR(120) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `posts_authorId_idx`(`authorId`),
    INDEX `posts_visibility_idx`(`visibility`),
    INDEX `posts_schoolId_idx`(`schoolId`),
    INDEX `posts_communityId_idx`(`communityId`),
    INDEX `posts_createdAt_idx`(`createdAt`),
    INDEX `posts_isDraft_idx`(`isDraft`),
    INDEX `posts_scheduledAt_idx`(`scheduledAt`),
    INDEX `posts_originalPostId_idx`(`originalPostId`),
    INDEX `posts_deletedAt_idx`(`deletedAt`),
    INDEX `posts_authorId_visibility_createdAt_idx`(`authorId`, `visibility`, `createdAt`),
    INDEX `posts_schoolId_visibility_createdAt_idx`(`schoolId`, `visibility`, `createdAt`),
    INDEX `posts_communityId_createdAt_idx`(`communityId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `post_media` (
    `id` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `url` VARCHAR(2048) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'IMAGE',
    `mimeType` VARCHAR(191) NULL,
    `size` INTEGER NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `duration` INTEGER NULL,
    `thumbnail` VARCHAR(2048) NULL,
    `orderIndex` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `post_media_postId_idx`(`postId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `post_reactions` (
    `id` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'LIKE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `post_reactions_postId_idx`(`postId`),
    INDEX `post_reactions_userId_idx`(`userId`),
    UNIQUE INDEX `post_reactions_postId_userId_key`(`postId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `post_comments` (
    `id` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `body` TEXT NOT NULL,
    `likeCount` INTEGER NOT NULL DEFAULT 0,
    `replyCount` INTEGER NOT NULL DEFAULT 0,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `post_comments_postId_idx`(`postId`),
    INDEX `post_comments_authorId_idx`(`authorId`),
    INDEX `post_comments_parentId_idx`(`parentId`),
    INDEX `post_comments_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `comment_reactions` (
    `id` VARCHAR(191) NOT NULL,
    `commentId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'LIKE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `comment_reactions_commentId_idx`(`commentId`),
    UNIQUE INDEX `comment_reactions_commentId_userId_key`(`commentId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `post_hashtags` (
    `postId` VARCHAR(191) NOT NULL,
    `hashtagId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`postId`, `hashtagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `post_mentions` (
    `id` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NULL,
    `commentId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `post_mentions_postId_idx`(`postId`),
    INDEX `post_mentions_commentId_idx`(`commentId`),
    INDEX `post_mentions_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `post_bookmarks` (
    `id` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `post_bookmarks_userId_idx`(`userId`),
    UNIQUE INDEX `post_bookmarks_postId_userId_key`(`postId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `post_views` (
    `id` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `votedOptionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `post_views_postId_idx`(`postId`),
    UNIQUE INDEX `post_views_postId_userId_key`(`postId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stories` (
    `id` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'IMAGE',
    `mediaUrl` VARCHAR(2048) NULL,
    `mimeType` VARCHAR(191) NULL,
    `thumbnail` VARCHAR(2048) NULL,
    `text` VARCHAR(500) NULL,
    `textColor` VARCHAR(191) NULL DEFAULT '#ffffff',
    `bgColor` VARCHAR(191) NULL DEFAULT '#6366f1',
    `bgGradient` VARCHAR(191) NULL,
    `caption` VARCHAR(280) NULL,
    `duration` INTEGER NOT NULL DEFAULT 5,
    `expiresAt` DATETIME(3) NOT NULL,
    `viewCount` INTEGER NOT NULL DEFAULT 0,
    `reactionCount` INTEGER NOT NULL DEFAULT 0,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `stories_authorId_idx`(`authorId`),
    INDEX `stories_expiresAt_idx`(`expiresAt`),
    INDEX `stories_createdAt_idx`(`createdAt`),
    INDEX `stories_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `story_views` (
    `id` VARCHAR(191) NOT NULL,
    `storyId` VARCHAR(191) NOT NULL,
    `viewerId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `story_views_storyId_idx`(`storyId`),
    UNIQUE INDEX `story_views_storyId_viewerId_key`(`storyId`, `viewerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `story_reactions` (
    `id` VARCHAR(191) NOT NULL,
    `storyId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'LIKE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `story_reactions_storyId_idx`(`storyId`),
    UNIQUE INDEX `story_reactions_storyId_userId_key`(`storyId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `communities` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `avatarUrl` VARCHAR(2048) NULL,
    `coverUrl` VARCHAR(2048) NULL,
    `privacy` VARCHAR(191) NOT NULL DEFAULT 'PUBLIC',
    `ownerId` VARCHAR(191) NOT NULL,
    `memberCount` INTEGER NOT NULL DEFAULT 1,
    `postCount` INTEGER NOT NULL DEFAULT 0,
    `isVerified` BOOLEAN NOT NULL DEFAULT false,
    `rules` TEXT NULL,
    `category` VARCHAR(191) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `communities_slug_key`(`slug`),
    INDEX `communities_ownerId_idx`(`ownerId`),
    INDEX `communities_privacy_idx`(`privacy`),
    INDEX `communities_category_idx`(`category`),
    INDEX `communities_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `community_members` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'MEMBER',
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `invitedBy` VARCHAR(191) NULL,

    INDEX `community_members_communityId_idx`(`communityId`),
    INDEX `community_members_userId_idx`(`userId`),
    INDEX `community_members_role_idx`(`role`),
    UNIQUE INDEX `community_members_communityId_userId_key`(`communityId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `community_join_requests` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `message` VARCHAR(500) NULL,
    `reviewedBy` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `community_join_requests_communityId_idx`(`communityId`),
    INDEX `community_join_requests_userId_idx`(`userId`),
    INDEX `community_join_requests_status_idx`(`status`),
    INDEX `community_join_requests_createdAt_idx`(`createdAt`),
    UNIQUE INDEX `community_join_requests_communityId_userId_status_key`(`communityId`, `userId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `community_bans` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `bannedBy` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `community_bans_communityId_idx`(`communityId`),
    INDEX `community_bans_userId_idx`(`userId`),
    UNIQUE INDEX `community_bans_communityId_userId_key`(`communityId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `community_invites` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `invitedBy` VARCHAR(191) NOT NULL,
    `invitedUserId` VARCHAR(191) NOT NULL,
    `token` VARCHAR(36) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `community_invites_token_key`(`token`),
    INDEX `community_invites_communityId_idx`(`communityId`),
    INDEX `community_invites_invitedUserId_idx`(`invitedUserId`),
    INDEX `community_invites_token_idx`(`token`),
    INDEX `community_invites_expiresAt_idx`(`expiresAt`),
    UNIQUE INDEX `community_invites_communityId_invitedUserId_status_key`(`communityId`, `invitedUserId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `creator_profiles` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(120) NULL,
    `tagline` VARCHAR(280) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isVerified` BOOLEAN NOT NULL DEFAULT false,
    `totalEarned` INTEGER NOT NULL DEFAULT 0,
    `subscriberCount` INTEGER NOT NULL DEFAULT 0,
    `tipCount` INTEGER NOT NULL DEFAULT 0,
    `links` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `creator_profiles_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `creator_tiers` (
    `id` VARCHAR(191) NOT NULL,
    `creatorId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `description` VARCHAR(500) NULL,
    `priceCoins` INTEGER NOT NULL DEFAULT 100,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `perks` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `creator_tiers_creatorId_idx`(`creatorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `creator_subscriptions` (
    `id` VARCHAR(191) NOT NULL,
    `subscriberId` VARCHAR(191) NOT NULL,
    `creatorId` VARCHAR(191) NOT NULL,
    `tierId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `renewedAt` DATETIME(3) NULL,
    `coinsCharged` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `creator_subscriptions_creatorId_idx`(`creatorId`),
    INDEX `creator_subscriptions_subscriberId_idx`(`subscriberId`),
    INDEX `creator_subscriptions_expiresAt_idx`(`expiresAt`),
    INDEX `creator_subscriptions_status_idx`(`status`),
    INDEX `creator_subscriptions_expiresAt_status_idx`(`expiresAt`, `status`),
    UNIQUE INDEX `creator_subscriptions_subscriberId_creatorId_key`(`subscriberId`, `creatorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `creator_tips` (
    `id` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `creatorId` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `diamondsEarned` INTEGER NOT NULL,
    `message` VARCHAR(280) NULL,
    `postId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `creator_tips_idempotencyKey_key`(`idempotencyKey`),
    INDEX `creator_tips_senderId_idx`(`senderId`),
    INDEX `creator_tips_creatorId_idx`(`creatorId`),
    INDEX `creator_tips_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `group_conversations` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `classId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `avatarUrl` VARCHAR(2048) NULL,
    `privacy` ENUM('PUBLIC', 'PRIVATE', 'SCHOOL_ONLY', 'CLASS_ONLY') NOT NULL DEFAULT 'PRIVATE',
    `maxMembers` INTEGER NOT NULL DEFAULT 100,
    `isMuted` BOOLEAN NOT NULL DEFAULT false,
    `slowMode` BOOLEAN NOT NULL DEFAULT false,
    `onlyAdminsCanSendMessages` BOOLEAN NOT NULL DEFAULT false,
    `onlyAdminsCanSendMedia` BOOLEAN NOT NULL DEFAULT false,
    `memberCount` INTEGER NOT NULL DEFAULT 1,
    `messageCount` INTEGER NOT NULL DEFAULT 0,
    `lastMessage` TEXT NULL,
    `lastMessageAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `group_conversations_schoolId_idx`(`schoolId`),
    INDEX `group_conversations_classId_idx`(`classId`),
    INDEX `group_conversations_privacy_idx`(`privacy`),
    INDEX `group_conversations_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `group_members` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` ENUM('OWNER', 'ADMIN', 'MODERATOR', 'MEMBER') NOT NULL DEFAULT 'MEMBER',
    `isMuted` BOOLEAN NOT NULL DEFAULT false,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leftAt` DATETIME(3) NULL,
    `unreadCount` INTEGER NOT NULL DEFAULT 0,
    `lastReadAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `group_members_conversationId_idx`(`conversationId`),
    INDEX `group_members_userId_idx`(`userId`),
    INDEX `group_members_role_idx`(`role`),
    UNIQUE INDEX `group_members_conversationId_userId_key`(`conversationId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `group_messages` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `type` ENUM('TEXT', 'IMAGE', 'VIDEO', 'GIF', 'AUDIO', 'VOICE', 'FILE', 'DOCUMENT', 'POLL', 'SYSTEM', 'VOICE_ROOM_SHARE') NOT NULL DEFAULT 'TEXT',
    `body` TEXT NULL,
    `mediaUrl` VARCHAR(2048) NULL,
    `mimeType` VARCHAR(128) NULL,
    `fileSize` INTEGER NULL,
    `fileName` VARCHAR(255) NULL,
    `duration` INTEGER NULL,
    `replyToId` VARCHAR(191) NULL,
    `isPinned` BOOLEAN NOT NULL DEFAULT false,
    `pinnedAt` DATETIME(3) NULL,
    `pinnedBy` VARCHAR(191) NULL,
    `deletedBy` JSON NULL,
    `deletedAt` DATETIME(3) NULL,
    `refEntityType` VARCHAR(50) NULL,
    `refEntityId` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `group_messages_conversationId_idx`(`conversationId`),
    INDEX `group_messages_senderId_idx`(`senderId`),
    INDEX `group_messages_createdAt_idx`(`createdAt`),
    INDEX `group_messages_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    INDEX `group_messages_conversationId_isPinned_idx`(`conversationId`, `isPinned`),
    INDEX `group_messages_refEntityType_refEntityId_idx`(`refEntityType`, `refEntityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `group_message_reactions` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'LIKE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `group_message_reactions_messageId_idx`(`messageId`),
    INDEX `group_message_reactions_userId_idx`(`userId`),
    UNIQUE INDEX `group_message_reactions_messageId_userId_key`(`messageId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `group_message_reads` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `readAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `group_message_reads_messageId_idx`(`messageId`),
    INDEX `group_message_reads_userId_idx`(`userId`),
    UNIQUE INDEX `group_message_reads_messageId_userId_key`(`messageId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assignment_submissions` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `classId` VARCHAR(191) NOT NULL,
    `gradeId` VARCHAR(191) NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `teacherId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `attachments` JSON NULL,
    `textContent` TEXT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'REVIEWED', 'GRADED', 'REJECTED', 'LATE') NOT NULL DEFAULT 'DRAFT',
    `submittedAt` DATETIME(3) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `gradedAt` DATETIME(3) NULL,
    `feedback` TEXT NULL,
    `score` DOUBLE NULL,
    `maxScore` DOUBLE NULL,
    `percentage` DOUBLE NULL,
    `isLate` BOOLEAN NOT NULL DEFAULT false,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `assignment_submissions_schoolId_idx`(`schoolId`),
    INDEX `assignment_submissions_classId_idx`(`classId`),
    INDEX `assignment_submissions_gradeId_idx`(`gradeId`),
    INDEX `assignment_submissions_studentId_idx`(`studentId`),
    INDEX `assignment_submissions_status_idx`(`status`),
    INDEX `assignment_submissions_submittedAt_idx`(`submittedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_submissions` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `classId` VARCHAR(191) NOT NULL,
    `gradeId` VARCHAR(191) NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `teacherId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `answers` JSON NULL,
    `attachments` JSON NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'REVIEWED', 'GRADED', 'REJECTED', 'LATE') NOT NULL DEFAULT 'DRAFT',
    `submittedAt` DATETIME(3) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `gradedAt` DATETIME(3) NULL,
    `feedback` TEXT NULL,
    `score` DOUBLE NULL,
    `maxScore` DOUBLE NULL,
    `percentage` DOUBLE NULL,
    `autoGraded` BOOLEAN NOT NULL DEFAULT false,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `exam_submissions_schoolId_idx`(`schoolId`),
    INDEX `exam_submissions_classId_idx`(`classId`),
    INDEX `exam_submissions_gradeId_idx`(`gradeId`),
    INDEX `exam_submissions_studentId_idx`(`studentId`),
    INDEX `exam_submissions_status_idx`(`status`),
    INDEX `exam_submissions_submittedAt_idx`(`submittedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `sellerId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `category` VARCHAR(191) NOT NULL DEFAULT 'OTHER',
    `condition` ENUM('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR') NOT NULL DEFAULT 'NEW',
    `price` DECIMAL(10, 2) NOT NULL,
    `negotiable` BOOLEAN NOT NULL DEFAULT false,
    `images` JSON NULL,
    `stock` INTEGER NOT NULL DEFAULT 1,
    `viewCount` INTEGER NOT NULL DEFAULT 0,
    `favoriteCount` INTEGER NOT NULL DEFAULT 0,
    `soldCount` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `expiresAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `products_schoolId_idx`(`schoolId`),
    INDEX `products_sellerId_idx`(`sellerId`),
    INDEX `products_category_idx`(`category`),
    INDEX `products_condition_idx`(`condition`),
    INDEX `products_isActive_idx`(`isActive`),
    INDEX `products_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `orders` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `productId` VARCHAR(191) NOT NULL,
    `buyerId` VARCHAR(191) NOT NULL,
    `sellerId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `totalPrice` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    `shippingAddress` JSON NULL,
    `notes` TEXT NULL,
    `confirmedAt` DATETIME(3) NULL,
    `shippedAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `refundedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `orders_schoolId_idx`(`schoolId`),
    INDEX `orders_productId_idx`(`productId`),
    INDEX `orders_buyerId_idx`(`buyerId`),
    INDEX `orders_sellerId_idx`(`sellerId`),
    INDEX `orders_status_idx`(`status`),
    INDEX `orders_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reviews` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NULL,
    `orderId` VARCHAR(191) NULL,
    `reviewerId` VARCHAR(191) NOT NULL,
    `sellerId` VARCHAR(191) NOT NULL,
    `rating` INTEGER NOT NULL,
    `title` VARCHAR(191) NULL,
    `body` TEXT NULL,
    `images` JSON NULL,
    `isVerified` BOOLEAN NOT NULL DEFAULT false,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `reviews_productId_idx`(`productId`),
    INDEX `reviews_orderId_idx`(`orderId`),
    INDEX `reviews_reviewerId_idx`(`reviewerId`),
    INDEX `reviews_sellerId_idx`(`sellerId`),
    INDEX `reviews_rating_idx`(`rating`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `school_buses` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `plateNumber` VARCHAR(191) NOT NULL,
    `busNumber` VARCHAR(191) NOT NULL,
    `capacity` INTEGER NOT NULL DEFAULT 40,
    `make` VARCHAR(191) NULL,
    `model` VARCHAR(191) NULL,
    `year` INTEGER NULL,
    `color` VARCHAR(191) NULL,
    `fuelType` VARCHAR(191) NULL DEFAULT 'DIESEL',
    `status` ENUM('ACTIVE', 'INACTIVE', 'MAINTENANCE', 'OUT_OF_SERVICE') NOT NULL DEFAULT 'ACTIVE',
    `insuranceExpiry` DATETIME(3) NULL,
    `lastServiceAt` DATETIME(3) NULL,
    `nextServiceAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `school_buses_plateNumber_key`(`plateNumber`),
    UNIQUE INDEX `school_buses_busNumber_key`(`busNumber`),
    INDEX `school_buses_schoolId_idx`(`schoolId`),
    INDEX `school_buses_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bus_routes` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `busId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `routeNumber` VARCHAR(191) NULL,
    `startTime` VARCHAR(191) NOT NULL,
    `endTime` VARCHAR(191) NOT NULL,
    `distanceKm` DOUBLE NULL,
    `durationMin` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bus_routes_schoolId_idx`(`schoolId`),
    INDEX `bus_routes_busId_idx`(`busId`),
    INDEX `bus_routes_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bus_stops` (
    `id` VARCHAR(191) NOT NULL,
    `routeId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `address` TEXT NULL,
    `latitude` DOUBLE NULL,
    `longitude` DOUBLE NULL,
    `sequence` INTEGER NOT NULL DEFAULT 0,
    `estimatedTime` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bus_stops_routeId_idx`(`routeId`),
    INDEX `bus_stops_sequence_idx`(`sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `drivers` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `licenseNumber` VARCHAR(191) NOT NULL,
    `licenseExpiry` DATETIME(3) NULL,
    `address` TEXT NULL,
    `emergencyContact` JSON NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'ON_LEAVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `hiredAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `drivers_userId_key`(`userId`),
    UNIQUE INDEX `drivers_licenseNumber_key`(`licenseNumber`),
    INDEX `drivers_schoolId_idx`(`schoolId`),
    INDEX `drivers_userId_idx`(`userId`),
    INDEX `drivers_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bus_assignments` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `busId` VARCHAR(191) NOT NULL,
    `routeId` VARCHAR(191) NOT NULL,
    `stopId` VARCHAR(191) NULL,
    `driverId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `pickupTime` VARCHAR(191) NOT NULL,
    `dropoffTime` VARCHAR(191) NOT NULL,
    `isMorning` BOOLEAN NOT NULL DEFAULT true,
    `isAfternoon` BOOLEAN NOT NULL DEFAULT true,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `effectiveFrom` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `effectiveTo` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bus_assignments_schoolId_idx`(`schoolId`),
    INDEX `bus_assignments_busId_idx`(`busId`),
    INDEX `bus_assignments_routeId_idx`(`routeId`),
    INDEX `bus_assignments_driverId_idx`(`driverId`),
    INDEX `bus_assignments_studentId_idx`(`studentId`),
    INDEX `bus_assignments_isActive_idx`(`isActive`),
    UNIQUE INDEX `bus_assignments_studentId_isMorning_effectiveFrom_key`(`studentId`, `isMorning`, `effectiveFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_school_stats` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `studentCount` INTEGER NOT NULL DEFAULT 0,
    `teacherCount` INTEGER NOT NULL DEFAULT 0,
    `classCount` INTEGER NOT NULL DEFAULT 0,
    `attendanceRate` DOUBLE NULL,
    `averageGrade` DOUBLE NULL,
    `behaviorScore` DOUBLE NULL,
    `totalPosts` INTEGER NOT NULL DEFAULT 0,
    `totalMessages` INTEGER NOT NULL DEFAULT 0,
    `totalGifts` INTEGER NOT NULL DEFAULT 0,
    `totalCoins` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `daily_school_stats_schoolId_idx`(`schoolId`),
    INDEX `daily_school_stats_date_idx`(`date`),
    UNIQUE INDEX `daily_school_stats_schoolId_date_key`(`schoolId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_user_stats` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `loginCount` INTEGER NOT NULL DEFAULT 0,
    `postsCreated` INTEGER NOT NULL DEFAULT 0,
    `commentsCreated` INTEGER NOT NULL DEFAULT 0,
    `likesGiven` INTEGER NOT NULL DEFAULT 0,
    `likesReceived` INTEGER NOT NULL DEFAULT 0,
    `messagesSent` INTEGER NOT NULL DEFAULT 0,
    `voiceMinutes` INTEGER NOT NULL DEFAULT 0,
    `giftsSent` INTEGER NOT NULL DEFAULT 0,
    `giftsReceived` INTEGER NOT NULL DEFAULT 0,
    `coinsSpent` INTEGER NOT NULL DEFAULT 0,
    `coinsEarned` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `daily_user_stats_userId_idx`(`userId`),
    INDEX `daily_user_stats_date_idx`(`date`),
    UNIQUE INDEX `daily_user_stats_userId_date_key`(`userId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `global_leaderboard` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `totalCoins` INTEGER NOT NULL DEFAULT 0,
    `totalDiamonds` INTEGER NOT NULL DEFAULT 0,
    `totalGifts` INTEGER NOT NULL DEFAULT 0,
    `totalPosts` INTEGER NOT NULL DEFAULT 0,
    `totalFollowers` INTEGER NOT NULL DEFAULT 0,
    `rank` INTEGER NOT NULL DEFAULT 0,
    `previousRank` INTEGER NULL,
    `period` VARCHAR(191) NOT NULL DEFAULT 'ALL_TIME',
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `global_leaderboard_userId_key`(`userId`),
    INDEX `global_leaderboard_rank_idx`(`rank`),
    INDEX `global_leaderboard_period_idx`(`period`),
    INDEX `global_leaderboard_period_rank_idx`(`period`, `rank`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `school_leaderboard` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `totalCoins` INTEGER NOT NULL DEFAULT 0,
    `totalDiamonds` INTEGER NOT NULL DEFAULT 0,
    `totalGifts` INTEGER NOT NULL DEFAULT 0,
    `totalPosts` INTEGER NOT NULL DEFAULT 0,
    `rank` INTEGER NOT NULL DEFAULT 0,
    `previousRank` INTEGER NULL,
    `period` VARCHAR(191) NOT NULL DEFAULT 'ALL_TIME',
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `school_leaderboard_schoolId_idx`(`schoolId`),
    INDEX `school_leaderboard_rank_idx`(`rank`),
    INDEX `school_leaderboard_period_idx`(`period`),
    UNIQUE INDEX `school_leaderboard_schoolId_userId_period_key`(`schoolId`, `userId`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `search_index` (
    `id` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NULL,
    `tags` JSON NULL,
    `schoolId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `popularity` DOUBLE NOT NULL DEFAULT 0,
    `lastIndexedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `search_index_entityType_idx`(`entityType`),
    INDEX `search_index_schoolId_idx`(`schoolId`),
    INDEX `search_index_userId_idx`(`userId`),
    INDEX `search_index_popularity_idx`(`popularity`),
    UNIQUE INDEX `search_index_entityType_entityId_key`(`entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trending_hashtags` (
    `id` VARCHAR(191) NOT NULL,
    `hashtag` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `rank` INTEGER NOT NULL DEFAULT 0,
    `previousRank` INTEGER NULL,
    `period` VARCHAR(191) NOT NULL DEFAULT 'HOURLY',
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `trending_hashtags_hashtag_key`(`hashtag`),
    INDEX `trending_hashtags_rank_idx`(`rank`),
    INDEX `trending_hashtags_period_idx`(`period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `backup_metadata` (
    `id` VARCHAR(191) NOT NULL,
    `backupType` VARCHAR(191) NOT NULL,
    `backupMethod` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `fileSize` BIGINT NOT NULL,
    `filePath` VARCHAR(191) NOT NULL,
    `checksum` VARCHAR(64) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'COMPLETED',
    `startedAt` DATETIME(3) NOT NULL,
    `completedAt` DATETIME(3) NULL,
    `retentionDays` INTEGER NOT NULL DEFAULT 30,
    `createdBy` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `backup_metadata_backupType_idx`(`backupType`),
    INDEX `backup_metadata_status_idx`(`status`),
    INDEX `backup_metadata_startedAt_idx`(`startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `deviceName` VARCHAR(255) NULL,
    `deviceType` VARCHAR(50) NULL,
    `deviceFingerprint` VARCHAR(64) NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `terminatedAt` DATETIME(3) NULL,
    `terminationReason` VARCHAR(50) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sessions_userId_idx`(`userId`),
    INDEX `sessions_userId_isActive_idx`(`userId`, `isActive`),
    INDEX `sessions_deviceFingerprint_idx`(`deviceFingerprint`),
    INDEX `sessions_lastSeenAt_isActive_idx`(`lastSeenAt`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhooks` (
    `id` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `events` VARCHAR(191) NOT NULL,
    `secret` VARCHAR(255) NULL,
    `headers` JSON NULL,
    `description` TEXT NULL,
    `userId` VARCHAR(191) NULL,
    `schoolId` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `webhooks_userId_idx`(`userId`),
    INDEX `webhooks_schoolId_idx`(`schoolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_deliveries` (
    `id` VARCHAR(191) NOT NULL,
    `webhookId` VARCHAR(191) NOT NULL,
    `deliveryId` VARCHAR(191) NOT NULL,
    `event` VARCHAR(191) NOT NULL,
    `success` BOOLEAN NOT NULL,
    `error` TEXT NULL,
    `attempt` INTEGER NOT NULL DEFAULT 1,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `webhook_deliveries_webhookId_idx`(`webhookId`),
    INDEX `webhook_deliveries_timestamp_idx`(`timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scheduled_jobs` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `schedule` VARCHAR(100) NOT NULL,
    `timezone` VARCHAR(50) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastRunAt` DATETIME(3) NULL,
    `nextRunAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `scheduled_jobs_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `job_executions` (
    `id` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` VARCHAR(50) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    `error` TEXT NULL,

    INDEX `job_executions_jobId_idx`(`jobId`),
    INDEX `job_executions_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_daily_gift_spend` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `date` VARCHAR(10) NOT NULL,
    `totalSpent` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `user_daily_gift_spend_userId_idx`(`userId`),
    INDEX `user_daily_gift_spend_date_idx`(`date`),
    UNIQUE INDEX `user_daily_gift_spend_userId_date_key`(`userId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payout_requests` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `diamonds` INTEGER NOT NULL,
    `usdAmount` DECIMAL(10, 2) NOT NULL,
    `method` VARCHAR(30) NOT NULL,
    `accountDetails` TEXT NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `adminNote` VARCHAR(500) NULL,
    `transactionRef` VARCHAR(200) NULL,
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `payout_requests_userId_idx`(`userId`),
    INDEX `payout_requests_status_idx`(`status`),
    INDEX `payout_requests_createdAt_idx`(`createdAt`),
    INDEX `payout_requests_userId_status_idx`(`userId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pk_seasons` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `status` ENUM('UPCOMING', 'ACTIVE', 'ENDED') NOT NULL DEFAULT 'UPCOMING',
    `description` TEXT NULL,
    `rules` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `pk_seasons_status_idx`(`status`),
    INDEX `pk_seasons_startDate_idx`(`startDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pk_config` (
    `id` VARCHAR(191) NOT NULL,
    `matchmakingEnabled` BOOLEAN NOT NULL DEFAULT true,
    `maxRatingDiffInitial` INTEGER NOT NULL DEFAULT 50,
    `maxRatingDiffExpand` INTEGER NOT NULL DEFAULT 100,
    `maxRatingDiffFinal` INTEGER NOT NULL DEFAULT 200,
    `matchmakingExpandInterval` INTEGER NOT NULL DEFAULT 10,
    `defaultDurationSeconds` INTEGER NOT NULL DEFAULT 300,
    `minDurationSeconds` INTEGER NOT NULL DEFAULT 60,
    `maxDurationSeconds` INTEGER NOT NULL DEFAULT 600,
    `countdownSeconds` INTEGER NOT NULL DEFAULT 5,
    `platformCutPercent` INTEGER NOT NULL DEFAULT 0,
    `comboThresholds` JSON NOT NULL,
    `comebackThresholdPercent` INTEGER NOT NULL DEFAULT 30,
    `comebackMultiplier` DOUBLE NOT NULL DEFAULT 1.5,
    `audienceVoteWeight` DOUBLE NOT NULL DEFAULT 0.1,
    `leaderboardCacheTtl` INTEGER NOT NULL DEFAULT 300,
    `pkEnabled` BOOLEAN NOT NULL DEFAULT true,
    `tournamentEnabled` BOOLEAN NOT NULL DEFAULT true,
    `rankingEnabled` BOOLEAN NOT NULL DEFAULT true,
    `votingEnabled` BOOLEAN NOT NULL DEFAULT true,
    `teamEnabled` BOOLEAN NOT NULL DEFAULT true,
    `clubEnabled` BOOLEAN NOT NULL DEFAULT true,
    `maxGiftVelocityPerMinute` INTEGER NOT NULL DEFAULT 20,
    `suspiciousRatingThreshold` DOUBLE NOT NULL DEFAULT 0.9,
    `minMatchesForRating` INTEGER NOT NULL DEFAULT 5,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pk_matches` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('ONE_V_ONE', 'ROOM_V_ROOM', 'TEAM_V_TEAM', 'CLUB_V_CLUB', 'TOURNAMENT') NOT NULL DEFAULT 'ONE_V_ONE',
    `state` ENUM('IDLE', 'MATCHMAKING', 'INVITED', 'PENDING_ACCEPTANCE', 'ACCEPTED', 'PREPARING', 'COUNTDOWN', 'LIVE', 'PAUSED', 'FINISHING', 'COMPLETED', 'CANCELLED', 'ABORTED', 'DISPUTED') NOT NULL DEFAULT 'IDLE',
    `seasonId` VARCHAR(191) NULL,
    `tournamentId` VARCHAR(191) NULL,
    `tournamentRound` INTEGER NULL,
    `roomIdA` VARCHAR(191) NULL,
    `roomIdB` VARCHAR(191) NULL,
    `roomTypeA` VARCHAR(191) NOT NULL DEFAULT 'voice',
    `roomTypeB` VARCHAR(191) NOT NULL DEFAULT 'voice',
    `durationSeconds` INTEGER NOT NULL DEFAULT 300,
    `countdownSeconds` INTEGER NOT NULL DEFAULT 5,
    `scheduledAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `endedAt` DATETIME(3) NULL,
    `pausedAt` DATETIME(3) NULL,
    `pausedDuration` INTEGER NOT NULL DEFAULT 0,
    `winnerId` VARCHAR(191) NULL,
    `winnerSide` VARCHAR(191) NULL,
    `scoreA` INTEGER NOT NULL DEFAULT 0,
    `scoreB` INTEGER NOT NULL DEFAULT 0,
    `giftScoreA` INTEGER NOT NULL DEFAULT 0,
    `giftScoreB` INTEGER NOT NULL DEFAULT 0,
    `bonusScoreA` INTEGER NOT NULL DEFAULT 0,
    `bonusScoreB` INTEGER NOT NULL DEFAULT 0,
    `voteScoreA` INTEGER NOT NULL DEFAULT 0,
    `voteScoreB` INTEGER NOT NULL DEFAULT 0,
    `peakComboA` INTEGER NOT NULL DEFAULT 0,
    `peakComboB` INTEGER NOT NULL DEFAULT 0,
    `peakViewers` INTEGER NOT NULL DEFAULT 0,
    `isRematch` BOOLEAN NOT NULL DEFAULT false,
    `previousMatchId` VARCHAR(191) NULL,
    `endedByAdmin` BOOLEAN NOT NULL DEFAULT false,
    `adminNote` TEXT NULL,
    `disputeReason` TEXT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pk_matches_idempotencyKey_key`(`idempotencyKey`),
    INDEX `pk_matches_state_idx`(`state`),
    INDEX `pk_matches_seasonId_idx`(`seasonId`),
    INDEX `pk_matches_tournamentId_idx`(`tournamentId`),
    INDEX `pk_matches_winnerId_idx`(`winnerId`),
    INDEX `pk_matches_createdAt_idx`(`createdAt`),
    INDEX `pk_matches_type_state_idx`(`type`, `state`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pk_participants` (
    `id` VARCHAR(191) NOT NULL,
    `pkMatchId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `side` VARCHAR(1) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'HOST',
    `teamId` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leftAt` DATETIME(3) NULL,
    `disconnectedAt` DATETIME(3) NULL,
    `reconnectedAt` DATETIME(3) NULL,
    `giftScore` INTEGER NOT NULL DEFAULT 0,
    `bonusScore` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `pk_participants_pkMatchId_idx`(`pkMatchId`),
    INDEX `pk_participants_userId_idx`(`userId`),
    INDEX `pk_participants_side_idx`(`side`),
    UNIQUE INDEX `pk_participants_pkMatchId_userId_key`(`pkMatchId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pk_teams` (
    `id` VARCHAR(191) NOT NULL,
    `pkMatchId` VARCHAR(191) NOT NULL,
    `side` VARCHAR(1) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `avatarUrl` VARCHAR(2048) NULL,
    `captainId` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NULL,
    `score` INTEGER NOT NULL DEFAULT 0,
    `giftScore` INTEGER NOT NULL DEFAULT 0,
    `bonusScore` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `pk_teams_pkMatchId_idx`(`pkMatchId`),
    INDEX `pk_teams_side_idx`(`side`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pk_invitations` (
    `id` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `receiverId` VARCHAR(191) NOT NULL,
    `pkMatchId` VARCHAR(191) NULL,
    `type` ENUM('ONE_V_ONE', 'ROOM_V_ROOM', 'TEAM_V_TEAM', 'CLUB_V_CLUB', 'TOURNAMENT') NOT NULL DEFAULT 'ONE_V_ONE',
    `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `message` VARCHAR(280) NULL,
    `durationSeconds` INTEGER NOT NULL DEFAULT 300,
    `teamSize` INTEGER NOT NULL DEFAULT 1,
    `expiresAt` DATETIME(3) NOT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `rejectedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `pk_invitations_senderId_idx`(`senderId`),
    INDEX `pk_invitations_receiverId_idx`(`receiverId`),
    INDEX `pk_invitations_status_idx`(`status`),
    INDEX `pk_invitations_expiresAt_idx`(`expiresAt`),
    INDEX `pk_invitations_receiverId_status_idx`(`receiverId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pk_gift_events` (
    `id` VARCHAR(191) NOT NULL,
    `pkMatchId` VARCHAR(191) NOT NULL,
    `giftTransactionId` VARCHAR(191) NOT NULL,
    `side` VARCHAR(1) NOT NULL,
    `beneficiaryId` VARCHAR(191) NOT NULL,
    `coinsSpent` INTEGER NOT NULL,
    `giftScore` INTEGER NOT NULL,
    `comboMultiplier` DOUBLE NOT NULL DEFAULT 1.0,
    `comboLevel` INTEGER NOT NULL DEFAULT 0,
    `isComebackBonus` BOOLEAN NOT NULL DEFAULT false,
    `bonusScore` INTEGER NOT NULL DEFAULT 0,
    `finalScore` INTEGER NOT NULL,
    `processedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `pk_gift_events_giftTransactionId_key`(`giftTransactionId`),
    INDEX `pk_gift_events_pkMatchId_idx`(`pkMatchId`),
    INDEX `pk_gift_events_side_idx`(`side`),
    INDEX `pk_gift_events_beneficiaryId_idx`(`beneficiaryId`),
    INDEX `pk_gift_events_pkMatchId_side_idx`(`pkMatchId`, `side`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pk_votes` (
    `id` VARCHAR(191) NOT NULL,
    `pkMatchId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `side` VARCHAR(1) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pk_votes_pkMatchId_idx`(`pkMatchId`),
    INDEX `pk_votes_userId_idx`(`userId`),
    INDEX `pk_votes_side_idx`(`side`),
    UNIQUE INDEX `pk_votes_pkMatchId_userId_key`(`pkMatchId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pk_matchmaking_queue` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('ONE_V_ONE', 'ROOM_V_ROOM', 'TEAM_V_TEAM', 'CLUB_V_CLUB', 'TOURNAMENT') NOT NULL DEFAULT 'ONE_V_ONE',
    `preferredRating` INTEGER NULL,
    `preferredRegion` VARCHAR(40) NULL,
    `preferredLang` VARCHAR(10) NULL,
    `durationSeconds` INTEGER NOT NULL DEFAULT 300,
    `teamSize` INTEGER NOT NULL DEFAULT 1,
    `enteredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `matchedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `pkMatchId` VARCHAR(191) NULL,

    UNIQUE INDEX `pk_matchmaking_queue_userId_key`(`userId`),
    INDEX `pk_matchmaking_queue_type_idx`(`type`),
    INDEX `pk_matchmaking_queue_enteredAt_idx`(`enteredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pk_history` (
    `id` VARCHAR(191) NOT NULL,
    `pkMatchId` VARCHAR(191) NOT NULL,
    `type` ENUM('ONE_V_ONE', 'ROOM_V_ROOM', 'TEAM_V_TEAM', 'CLUB_V_CLUB', 'TOURNAMENT') NOT NULL,
    `winnerId` VARCHAR(191) NULL,
    `winnerSide` VARCHAR(1) NULL,
    `loserSide` VARCHAR(1) NULL,
    `scoreA` INTEGER NOT NULL,
    `scoreB` INTEGER NOT NULL,
    `giftScoreA` INTEGER NOT NULL,
    `giftScoreB` INTEGER NOT NULL,
    `voteScoreA` INTEGER NOT NULL,
    `voteScoreB` INTEGER NOT NULL,
    `peakComboA` INTEGER NOT NULL,
    `peakComboB` INTEGER NOT NULL,
    `peakViewers` INTEGER NOT NULL,
    `durationSeconds` INTEGER NOT NULL,
    `seasonId` VARCHAR(191) NULL,
    `tournamentId` VARCHAR(191) NULL,
    `participantIds` JSON NOT NULL,
    `sideAIds` JSON NOT NULL,
    `sideBIds` JSON NOT NULL,
    `teamAName` VARCHAR(191) NULL,
    `teamBName` VARCHAR(191) NULL,
    `totalGifts` INTEGER NOT NULL DEFAULT 0,
    `totalCoins` INTEGER NOT NULL DEFAULT 0,
    `wasDisputed` BOOLEAN NOT NULL DEFAULT false,
    `recordingUrl` VARCHAR(2048) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `pk_history_pkMatchId_key`(`pkMatchId`),
    INDEX `pk_history_winnerId_idx`(`winnerId`),
    INDEX `pk_history_seasonId_idx`(`seasonId`),
    INDEX `pk_history_tournamentId_idx`(`tournamentId`),
    INDEX `pk_history_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pk_user_stats` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `totalPKs` INTEGER NOT NULL DEFAULT 0,
    `wins` INTEGER NOT NULL DEFAULT 0,
    `losses` INTEGER NOT NULL DEFAULT 0,
    `draws` INTEGER NOT NULL DEFAULT 0,
    `winRate` DOUBLE NOT NULL DEFAULT 0.0,
    `currentStreak` INTEGER NOT NULL DEFAULT 0,
    `bestStreak` INTEGER NOT NULL DEFAULT 0,
    `totalScore` INTEGER NOT NULL DEFAULT 0,
    `highestScore` INTEGER NOT NULL DEFAULT 0,
    `totalGiftsSent` INTEGER NOT NULL DEFAULT 0,
    `totalGiftsRecv` INTEGER NOT NULL DEFAULT 0,
    `avgScore` DOUBLE NOT NULL DEFAULT 0.0,
    `avgDuration` DOUBLE NOT NULL DEFAULT 0.0,
    `rating` INTEGER NOT NULL DEFAULT 1000,
    `rank` ENUM('BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'MASTER', 'GRANDMASTER') NOT NULL DEFAULT 'BRONZE',
    `peakRating` INTEGER NOT NULL DEFAULT 1000,
    `peakRank` ENUM('BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'MASTER', 'GRANDMASTER') NOT NULL DEFAULT 'BRONZE',
    `seasonId` VARCHAR(191) NULL,
    `seasonWins` INTEGER NOT NULL DEFAULT 0,
    `seasonLosses` INTEGER NOT NULL DEFAULT 0,
    `seasonScore` INTEGER NOT NULL DEFAULT 0,
    `seasonRating` INTEGER NOT NULL DEFAULT 1000,
    `seasonRank` ENUM('BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'MASTER', 'GRANDMASTER') NOT NULL DEFAULT 'BRONZE',
    `updatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `pk_user_stats_userId_key`(`userId`),
    INDEX `pk_user_stats_userId_idx`(`userId`),
    INDEX `pk_user_stats_rating_idx`(`rating`),
    INDEX `pk_user_stats_rank_idx`(`rank`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pk_ranks` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `seasonId` VARCHAR(191) NOT NULL,
    `rank` ENUM('BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'MASTER', 'GRANDMASTER') NOT NULL DEFAULT 'BRONZE',
    `rating` INTEGER NOT NULL DEFAULT 1000,
    `wins` INTEGER NOT NULL DEFAULT 0,
    `losses` INTEGER NOT NULL DEFAULT 0,
    `score` INTEGER NOT NULL DEFAULT 0,
    `position` INTEGER NULL,
    `rewards` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `pk_ranks_seasonId_idx`(`seasonId`),
    INDEX `pk_ranks_rating_idx`(`rating`),
    INDEX `pk_ranks_rank_idx`(`rank`),
    UNIQUE INDEX `pk_ranks_userId_seasonId_key`(`userId`, `seasonId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pk_leaderboard` (
    `id` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(20) NOT NULL,
    `period` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `seasonId` VARCHAR(191) NULL,
    `rank` INTEGER NOT NULL,
    `score` INTEGER NOT NULL DEFAULT 0,
    `wins` INTEGER NOT NULL DEFAULT 0,
    `rating` INTEGER NOT NULL DEFAULT 1000,
    `updatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pk_leaderboard_scope_period_rank_idx`(`scope`, `period`, `rank`),
    INDEX `pk_leaderboard_userId_idx`(`userId`),
    UNIQUE INDEX `pk_leaderboard_scope_period_userId_key`(`scope`, `period`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pk_tournaments` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `status` ENUM('DRAFT', 'REGISTRATION', 'SEEDING', 'ACTIVE', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `type` ENUM('ONE_V_ONE', 'ROOM_V_ROOM', 'TEAM_V_TEAM', 'CLUB_V_CLUB', 'TOURNAMENT') NOT NULL DEFAULT 'ONE_V_ONE',
    `bracketType` VARCHAR(191) NOT NULL DEFAULT 'SINGLE_ELIMINATION',
    `maxParticipants` INTEGER NOT NULL DEFAULT 16,
    `registeredCount` INTEGER NOT NULL DEFAULT 0,
    `teamSize` INTEGER NOT NULL DEFAULT 1,
    `registrationStart` DATETIME(3) NOT NULL,
    `registrationEnd` DATETIME(3) NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `prizeDescription` TEXT NULL,
    `rules` JSON NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `pk_tournaments_status_idx`(`status`),
    INDEX `pk_tournaments_startDate_idx`(`startDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pk_tournament_participants` (
    `id` VARCHAR(191) NOT NULL,
    `tournamentId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `seed` INTEGER NULL,
    `wins` INTEGER NOT NULL DEFAULT 0,
    `losses` INTEGER NOT NULL DEFAULT 0,
    `eliminated` BOOLEAN NOT NULL DEFAULT false,
    `eliminatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `pk_tournament_participants_tournamentId_idx`(`tournamentId`),
    INDEX `pk_tournament_participants_userId_idx`(`userId`),
    UNIQUE INDEX `pk_tournament_participants_tournamentId_userId_key`(`tournamentId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pk_achievements` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NOT NULL,
    `iconUrl` VARCHAR(2048) NULL,
    `condition` JSON NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `pk_achievements_key_key`(`key`),
    INDEX `pk_achievements_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pk_user_achievements` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `achievementId` VARCHAR(191) NOT NULL,
    `unlockedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `pkMatchId` VARCHAR(191) NULL,

    INDEX `pk_user_achievements_userId_idx`(`userId`),
    UNIQUE INDEX `pk_user_achievements_userId_achievementId_key`(`userId`, `achievementId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pk_missions` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'DAILY',
    `condition` JSON NOT NULL,
    `reward` JSON NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `pk_missions_key_key`(`key`),
    INDEX `pk_missions_type_idx`(`type`),
    INDEX `pk_missions_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pk_mission_progress` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `missionId` VARCHAR(191) NOT NULL,
    `progress` INTEGER NOT NULL DEFAULT 0,
    `target` INTEGER NOT NULL,
    `completed` BOOLEAN NOT NULL DEFAULT false,
    `completedAt` DATETIME(3) NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `pk_mission_progress_userId_idx`(`userId`),
    INDEX `pk_mission_progress_missionId_idx`(`missionId`),
    INDEX `pk_mission_progress_completed_idx`(`completed`),
    UNIQUE INDEX `pk_mission_progress_userId_missionId_periodStart_key`(`userId`, `missionId`, `periodStart`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pk_audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `pkMatchId` VARCHAR(191) NOT NULL,
    `adminId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(60) NOT NULL,
    `reason` TEXT NULL,
    `beforeValue` JSON NULL,
    `afterValue` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pk_audit_logs_pkMatchId_idx`(`pkMatchId`),
    INDEX `pk_audit_logs_adminId_idx`(`adminId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pk_analytics_events` (
    `id` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(60) NOT NULL,
    `pkMatchId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `side` VARCHAR(1) NULL,
    `data` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pk_analytics_events_eventType_idx`(`eventType`),
    INDEX `pk_analytics_events_pkMatchId_idx`(`pkMatchId`),
    INDEX `pk_analytics_events_userId_idx`(`userId`),
    INDEX `pk_analytics_events_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quizzes` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NOT NULL,
    `teacherId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `timeLimitMin` INTEGER NULL,
    `openAt` DATETIME(3) NULL,
    `closeAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `quizzes_schoolId_idx`(`schoolId`),
    INDEX `quizzes_classId_idx`(`classId`),
    INDEX `quizzes_teacherId_idx`(`teacherId`),
    INDEX `quizzes_classId_status_idx`(`classId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quiz_questions` (
    `id` VARCHAR(191) NOT NULL,
    `quizId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,
    `questionType` VARCHAR(30) NOT NULL,
    `prompt` TEXT NOT NULL,
    `modelAnswer` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `quiz_questions_quizId_idx`(`quizId`),
    INDEX `quiz_questions_quizId_position_idx`(`quizId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quiz_options` (
    `id` VARCHAR(191) NOT NULL,
    `questionId` VARCHAR(191) NOT NULL,
    `text` VARCHAR(500) NOT NULL,
    `isCorrect` BOOLEAN NOT NULL DEFAULT false,
    `position` INTEGER NOT NULL,

    INDEX `quiz_options_questionId_idx`(`questionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quiz_attempts` (
    `id` VARCHAR(191) NOT NULL,
    `quizId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
    `score` DOUBLE NULL,
    `feedback` TEXT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `submittedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `quiz_attempts_quizId_idx`(`quizId`),
    INDEX `quiz_attempts_studentId_idx`(`studentId`),
    INDEX `quiz_attempts_quizId_status_idx`(`quizId`, `status`),
    UNIQUE INDEX `quiz_attempts_quizId_studentId_key`(`quizId`, `studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quiz_answers` (
    `id` VARCHAR(191) NOT NULL,
    `attemptId` VARCHAR(191) NOT NULL,
    `questionId` VARCHAR(191) NOT NULL,
    `selectedOptionId` VARCHAR(191) NULL,
    `answerText` TEXT NULL,
    `isCorrect` BOOLEAN NULL,

    INDEX `quiz_answers_attemptId_idx`(`attemptId`),
    UNIQUE INDEX `quiz_answers_attemptId_questionId_key`(`attemptId`, `questionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `school_settings` ADD CONSTRAINT `school_settings_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `school_memberships` ADD CONSTRAINT `school_memberships_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `school_memberships` ADD CONSTRAINT `school_memberships_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_providers` ADD CONSTRAINT `auth_providers_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `otp_codes` ADD CONSTRAINT `otp_codes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `terms` ADD CONSTRAINT `terms_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `classes` ADD CONSTRAINT `classes_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `classes` ADD CONSTRAINT `classes_termId_fkey` FOREIGN KEY (`termId`) REFERENCES `terms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teachers` ADD CONSTRAINT `teachers_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teachers` ADD CONSTRAINT `teachers_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guardians` ADD CONSTRAINT `guardians_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guardians` ADD CONSTRAINT `guardians_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guardian_students` ADD CONSTRAINT `guardian_students_guardianId_fkey` FOREIGN KEY (`guardianId`) REFERENCES `guardians`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guardian_students` ADD CONSTRAINT `guardian_students_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_classes` ADD CONSTRAINT `teacher_classes_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `teachers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_classes` ADD CONSTRAINT `teacher_classes_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enrollments` ADD CONSTRAINT `enrollments_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enrollments` ADD CONSTRAINT `enrollments_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance` ADD CONSTRAINT `attendance_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance` ADD CONSTRAINT `attendance_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance` ADD CONSTRAINT `attendance_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance` ADD CONSTRAINT `attendance_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `teachers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_logs` ADD CONSTRAINT `attendance_logs_attendanceId_fkey` FOREIGN KEY (`attendanceId`) REFERENCES `attendance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `behavior_logs` ADD CONSTRAINT `behavior_logs_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `behavior_logs` ADD CONSTRAINT `behavior_logs_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `teachers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grade_categories` ADD CONSTRAINT `grade_categories_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grades` ADD CONSTRAINT `grades_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grades` ADD CONSTRAINT `grades_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grades` ADD CONSTRAINT `grades_termId_fkey` FOREIGN KEY (`termId`) REFERENCES `terms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grades` ADD CONSTRAINT `grades_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `teachers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grades` ADD CONSTRAINT `grades_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `grade_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activities` ADD CONSTRAINT `activities_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activities` ADD CONSTRAINT `activities_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `teachers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activity_participants` ADD CONSTRAINT `activity_participants_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `activities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activity_participants` ADD CONSTRAINT `activity_participants_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_parentMessageId_fkey` FOREIGN KEY (`parentMessageId`) REFERENCES `messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_recipients` ADD CONSTRAINT `message_recipients_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_recipients` ADD CONSTRAINT `message_recipients_recipientId_fkey` FOREIGN KEY (`recipientId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calendar_events` ADD CONSTRAINT `calendar_events_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calendar_events` ADD CONSTRAINT `calendar_events_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notes` ADD CONSTRAINT `notes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notes` ADD CONSTRAINT `notes_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notes` ADD CONSTRAINT `notes_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `announcements` ADD CONSTRAINT `announcements_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `file_uploads` ADD CONSTRAINT `file_uploads_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_issues` ADD CONSTRAINT `library_issues_bookId_fkey` FOREIGN KEY (`bookId`) REFERENCES `library_books`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_issues` ADD CONSTRAINT `library_issues_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_records` ADD CONSTRAINT `fee_records_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audio_courses` ADD CONSTRAINT `audio_courses_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `audio_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audio_courses` ADD CONSTRAINT `audio_courses_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `teachers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audio_lessons` ADD CONSTRAINT `audio_lessons_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `audio_courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audio_lessons` ADD CONSTRAINT `audio_lessons_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `audio_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audio_lessons` ADD CONSTRAINT `audio_lessons_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `teachers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voice_rooms` ADD CONSTRAINT `voice_rooms_hostId_fkey` FOREIGN KEY (`hostId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voice_participants` ADD CONSTRAINT `voice_participants_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `voice_rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voice_participants` ADD CONSTRAINT `voice_participants_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voice_room_members` ADD CONSTRAINT `voice_room_members_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `voice_rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voice_room_members` ADD CONSTRAINT `voice_room_members_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voice_messages` ADD CONSTRAINT `voice_messages_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `voice_rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voice_messages` ADD CONSTRAINT `voice_messages_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voice_host_stats` ADD CONSTRAINT `voice_host_stats_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wallets` ADD CONSTRAINT `wallets_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wallet_transactions` ADD CONSTRAINT `wallet_transactions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_transactions` ADD CONSTRAINT `gift_transactions_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_transactions` ADD CONSTRAINT `gift_transactions_receiverId_fkey` FOREIGN KEY (`receiverId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_transactions` ADD CONSTRAINT `gift_transactions_giftId_fkey` FOREIGN KEY (`giftId`) REFERENCES `gifts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `room_gift_leaderboard` ADD CONSTRAINT `room_gift_leaderboard_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `follows` ADD CONSTRAINT `follows_followerId_fkey` FOREIGN KEY (`followerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `follows` ADD CONSTRAINT `follows_followingId_fkey` FOREIGN KEY (`followingId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `friend_requests` ADD CONSTRAINT `friend_requests_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `friend_requests` ADD CONSTRAINT `friend_requests_receiverId_fkey` FOREIGN KEY (`receiverId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_reports` ADD CONSTRAINT `user_reports_reporterId_fkey` FOREIGN KEY (`reporterId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_reports` ADD CONSTRAINT `user_reports_reportedId_fkey` FOREIGN KEY (`reportedId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_reports` ADD CONSTRAINT `user_reports_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `voice_rooms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post_reports` ADD CONSTRAINT `post_reports_reporterId_fkey` FOREIGN KEY (`reporterId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post_reports` ADD CONSTRAINT `post_reports_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_blocks` ADD CONSTRAINT `user_blocks_blockerId_fkey` FOREIGN KEY (`blockerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_blocks` ADD CONSTRAINT `user_blocks_blockedId_fkey` FOREIGN KEY (`blockedId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `live_classes` ADD CONSTRAINT `live_classes_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `live_classes` ADD CONSTRAINT `live_classes_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `live_classes` ADD CONSTRAINT `live_classes_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `teachers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `live_classes` ADD CONSTRAINT `live_classes_host_user_id_fkey` FOREIGN KEY (`host_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `live_classes` ADD CONSTRAINT `live_classes_delegated_host_id_fkey` FOREIGN KEY (`delegated_host_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `live_class_participants` ADD CONSTRAINT `live_class_participants_liveClassId_fkey` FOREIGN KEY (`liveClassId`) REFERENCES `live_classes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `live_class_participants` ADD CONSTRAINT `live_class_participants_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `live_class_messages` ADD CONSTRAINT `live_class_messages_liveClassId_fkey` FOREIGN KEY (`liveClassId`) REFERENCES `live_classes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `live_class_messages` ADD CONSTRAINT `live_class_messages_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `live_class_hand_queue` ADD CONSTRAINT `live_class_hand_queue_liveClassId_fkey` FOREIGN KEY (`liveClassId`) REFERENCES `live_classes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `live_class_hand_queue` ADD CONSTRAINT `live_class_hand_queue_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `live_class_attendance` ADD CONSTRAINT `live_class_attendance_liveClassId_fkey` FOREIGN KEY (`liveClassId`) REFERENCES `live_classes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `live_class_attendance` ADD CONSTRAINT `live_class_attendance_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `live_class_polls` ADD CONSTRAINT `live_class_polls_liveClassId_fkey` FOREIGN KEY (`liveClassId`) REFERENCES `live_classes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `live_class_whiteboard_snapshots` ADD CONSTRAINT `live_class_whiteboard_snapshots_liveClassId_fkey` FOREIGN KEY (`liveClassId`) REFERENCES `live_classes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dm_conversations` ADD CONSTRAINT `dm_conversations_userAId_fkey` FOREIGN KEY (`userAId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dm_conversations` ADD CONSTRAINT `dm_conversations_userBId_fkey` FOREIGN KEY (`userBId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `direct_messages` ADD CONSTRAINT `direct_messages_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `dm_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `direct_messages` ADD CONSTRAINT `direct_messages_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `direct_messages` ADD CONSTRAINT `direct_messages_receiverId_fkey` FOREIGN KEY (`receiverId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `direct_messages` ADD CONSTRAINT `direct_messages_replyToId_fkey` FOREIGN KEY (`replyToId`) REFERENCES `direct_messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `direct_messages` ADD CONSTRAINT `direct_messages_storyId_fkey` FOREIGN KEY (`storyId`) REFERENCES `stories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dm_reactions` ADD CONSTRAINT `dm_reactions_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `direct_messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dm_reactions` ADD CONSTRAINT `dm_reactions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `posts` ADD CONSTRAINT `posts_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `posts` ADD CONSTRAINT `posts_originalPostId_fkey` FOREIGN KEY (`originalPostId`) REFERENCES `posts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `posts` ADD CONSTRAINT `posts_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `posts` ADD CONSTRAINT `posts_tierRequired_fkey` FOREIGN KEY (`tierRequired`) REFERENCES `creator_tiers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post_media` ADD CONSTRAINT `post_media_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post_reactions` ADD CONSTRAINT `post_reactions_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post_reactions` ADD CONSTRAINT `post_reactions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post_comments` ADD CONSTRAINT `post_comments_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post_comments` ADD CONSTRAINT `post_comments_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post_comments` ADD CONSTRAINT `post_comments_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `post_comments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comment_reactions` ADD CONSTRAINT `comment_reactions_commentId_fkey` FOREIGN KEY (`commentId`) REFERENCES `post_comments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comment_reactions` ADD CONSTRAINT `comment_reactions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post_hashtags` ADD CONSTRAINT `post_hashtags_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post_hashtags` ADD CONSTRAINT `post_hashtags_hashtagId_fkey` FOREIGN KEY (`hashtagId`) REFERENCES `hashtags`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post_mentions` ADD CONSTRAINT `post_mentions_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post_mentions` ADD CONSTRAINT `post_mentions_commentId_fkey` FOREIGN KEY (`commentId`) REFERENCES `post_comments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post_mentions` ADD CONSTRAINT `post_mentions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post_bookmarks` ADD CONSTRAINT `post_bookmarks_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post_bookmarks` ADD CONSTRAINT `post_bookmarks_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post_views` ADD CONSTRAINT `post_views_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post_views` ADD CONSTRAINT `post_views_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stories` ADD CONSTRAINT `stories_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `story_views` ADD CONSTRAINT `story_views_storyId_fkey` FOREIGN KEY (`storyId`) REFERENCES `stories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `story_views` ADD CONSTRAINT `story_views_viewerId_fkey` FOREIGN KEY (`viewerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `story_reactions` ADD CONSTRAINT `story_reactions_storyId_fkey` FOREIGN KEY (`storyId`) REFERENCES `stories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `story_reactions` ADD CONSTRAINT `story_reactions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communities` ADD CONSTRAINT `communities_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_members` ADD CONSTRAINT `community_members_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_members` ADD CONSTRAINT `community_members_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_join_requests` ADD CONSTRAINT `community_join_requests_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_join_requests` ADD CONSTRAINT `community_join_requests_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_bans` ADD CONSTRAINT `community_bans_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_bans` ADD CONSTRAINT `community_bans_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_invites` ADD CONSTRAINT `community_invites_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_invites` ADD CONSTRAINT `community_invites_invitedBy_fkey` FOREIGN KEY (`invitedBy`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_invites` ADD CONSTRAINT `community_invites_invitedUserId_fkey` FOREIGN KEY (`invitedUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `creator_profiles` ADD CONSTRAINT `creator_profiles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `creator_tiers` ADD CONSTRAINT `creator_tiers_creatorId_fkey` FOREIGN KEY (`creatorId`) REFERENCES `creator_profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `creator_subscriptions` ADD CONSTRAINT `creator_subscriptions_subscriberId_fkey` FOREIGN KEY (`subscriberId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `creator_subscriptions` ADD CONSTRAINT `creator_subscriptions_creatorId_fkey` FOREIGN KEY (`creatorId`) REFERENCES `creator_profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `creator_subscriptions` ADD CONSTRAINT `creator_subscriptions_tierId_fkey` FOREIGN KEY (`tierId`) REFERENCES `creator_tiers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `creator_tips` ADD CONSTRAINT `creator_tips_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `creator_tips` ADD CONSTRAINT `creator_tips_creatorId_fkey` FOREIGN KEY (`creatorId`) REFERENCES `creator_profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_conversations` ADD CONSTRAINT `group_conversations_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_conversations` ADD CONSTRAINT `group_conversations_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_members` ADD CONSTRAINT `group_members_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `group_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_members` ADD CONSTRAINT `group_members_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_messages` ADD CONSTRAINT `group_messages_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `group_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_messages` ADD CONSTRAINT `group_messages_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_messages` ADD CONSTRAINT `group_messages_replyToId_fkey` FOREIGN KEY (`replyToId`) REFERENCES `group_messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_message_reactions` ADD CONSTRAINT `group_message_reactions_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `group_messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_message_reactions` ADD CONSTRAINT `group_message_reactions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_message_reads` ADD CONSTRAINT `group_message_reads_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `group_messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_message_reads` ADD CONSTRAINT `group_message_reads_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignment_submissions` ADD CONSTRAINT `assignment_submissions_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignment_submissions` ADD CONSTRAINT `assignment_submissions_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignment_submissions` ADD CONSTRAINT `assignment_submissions_gradeId_fkey` FOREIGN KEY (`gradeId`) REFERENCES `grades`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignment_submissions` ADD CONSTRAINT `assignment_submissions_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_submissions` ADD CONSTRAINT `exam_submissions_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_submissions` ADD CONSTRAINT `exam_submissions_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_submissions` ADD CONSTRAINT `exam_submissions_gradeId_fkey` FOREIGN KEY (`gradeId`) REFERENCES `grades`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_submissions` ADD CONSTRAINT `exam_submissions_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_buyerId_fkey` FOREIGN KEY (`buyerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_reviewerId_fkey` FOREIGN KEY (`reviewerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `school_buses` ADD CONSTRAINT `school_buses_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bus_routes` ADD CONSTRAINT `bus_routes_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bus_routes` ADD CONSTRAINT `bus_routes_busId_fkey` FOREIGN KEY (`busId`) REFERENCES `school_buses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bus_stops` ADD CONSTRAINT `bus_stops_routeId_fkey` FOREIGN KEY (`routeId`) REFERENCES `bus_routes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `drivers` ADD CONSTRAINT `drivers_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `drivers` ADD CONSTRAINT `drivers_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bus_assignments` ADD CONSTRAINT `bus_assignments_busId_fkey` FOREIGN KEY (`busId`) REFERENCES `school_buses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bus_assignments` ADD CONSTRAINT `bus_assignments_routeId_fkey` FOREIGN KEY (`routeId`) REFERENCES `bus_routes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bus_assignments` ADD CONSTRAINT `bus_assignments_stopId_fkey` FOREIGN KEY (`stopId`) REFERENCES `bus_stops`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bus_assignments` ADD CONSTRAINT `bus_assignments_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `drivers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bus_assignments` ADD CONSTRAINT `bus_assignments_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `global_leaderboard` ADD CONSTRAINT `global_leaderboard_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `school_leaderboard` ADD CONSTRAINT `school_leaderboard_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_deliveries` ADD CONSTRAINT `webhook_deliveries_webhookId_fkey` FOREIGN KEY (`webhookId`) REFERENCES `webhooks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `job_executions` ADD CONSTRAINT `job_executions_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `scheduled_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_daily_gift_spend` ADD CONSTRAINT `user_daily_gift_spend_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payout_requests` ADD CONSTRAINT `payout_requests_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pk_matches` ADD CONSTRAINT `pk_matches_seasonId_fkey` FOREIGN KEY (`seasonId`) REFERENCES `pk_seasons`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pk_matches` ADD CONSTRAINT `pk_matches_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `pk_tournaments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pk_matches` ADD CONSTRAINT `pk_matches_previousMatchId_fkey` FOREIGN KEY (`previousMatchId`) REFERENCES `pk_matches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pk_participants` ADD CONSTRAINT `pk_participants_pkMatchId_fkey` FOREIGN KEY (`pkMatchId`) REFERENCES `pk_matches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pk_participants` ADD CONSTRAINT `pk_participants_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pk_participants` ADD CONSTRAINT `pk_participants_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `pk_teams`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pk_teams` ADD CONSTRAINT `pk_teams_pkMatchId_fkey` FOREIGN KEY (`pkMatchId`) REFERENCES `pk_matches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pk_gift_events` ADD CONSTRAINT `pk_gift_events_pkMatchId_fkey` FOREIGN KEY (`pkMatchId`) REFERENCES `pk_matches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pk_votes` ADD CONSTRAINT `pk_votes_pkMatchId_fkey` FOREIGN KEY (`pkMatchId`) REFERENCES `pk_matches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pk_history` ADD CONSTRAINT `pk_history_pkMatchId_fkey` FOREIGN KEY (`pkMatchId`) REFERENCES `pk_matches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pk_user_stats` ADD CONSTRAINT `pk_user_stats_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pk_ranks` ADD CONSTRAINT `pk_ranks_seasonId_fkey` FOREIGN KEY (`seasonId`) REFERENCES `pk_seasons`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pk_leaderboard` ADD CONSTRAINT `pk_leaderboard_seasonId_fkey` FOREIGN KEY (`seasonId`) REFERENCES `pk_seasons`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pk_tournament_participants` ADD CONSTRAINT `pk_tournament_participants_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `pk_tournaments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pk_user_achievements` ADD CONSTRAINT `pk_user_achievements_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pk_user_achievements` ADD CONSTRAINT `pk_user_achievements_achievementId_fkey` FOREIGN KEY (`achievementId`) REFERENCES `pk_achievements`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pk_mission_progress` ADD CONSTRAINT `pk_mission_progress_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pk_mission_progress` ADD CONSTRAINT `pk_mission_progress_missionId_fkey` FOREIGN KEY (`missionId`) REFERENCES `pk_missions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pk_audit_logs` ADD CONSTRAINT `pk_audit_logs_pkMatchId_fkey` FOREIGN KEY (`pkMatchId`) REFERENCES `pk_matches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quizzes` ADD CONSTRAINT `quizzes_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quizzes` ADD CONSTRAINT `quizzes_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quizzes` ADD CONSTRAINT `quizzes_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `teachers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quiz_questions` ADD CONSTRAINT `quiz_questions_quizId_fkey` FOREIGN KEY (`quizId`) REFERENCES `quizzes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quiz_options` ADD CONSTRAINT `quiz_options_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `quiz_questions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quiz_attempts` ADD CONSTRAINT `quiz_attempts_quizId_fkey` FOREIGN KEY (`quizId`) REFERENCES `quizzes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quiz_attempts` ADD CONSTRAINT `quiz_attempts_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quiz_answers` ADD CONSTRAINT `quiz_answers_attemptId_fkey` FOREIGN KEY (`attemptId`) REFERENCES `quiz_attempts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quiz_answers` ADD CONSTRAINT `quiz_answers_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `quiz_questions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quiz_answers` ADD CONSTRAINT `quiz_answers_selectedOptionId_fkey` FOREIGN KEY (`selectedOptionId`) REFERENCES `quiz_options`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

