-- =============================================================
-- EXPERIMENTAL CI-ONLY BASELINE — NOT FOR PRODUCTION USE
-- HALQA Platform — Phase 3D-1C Unit B
-- Generated from: Prisma schema + sampled migration history
-- Source commit: d1a81ccafce1bdefac5eacdde7df7bb43153905b
-- Branch: fix/voice-club-realtime-sync-2026-10-15
-- Target engine: MySQL 8.4
-- WARNING: This file has NOT been executed against a real MySQL
-- instance. Parity is UNVERIFIED until Unit C execution.
-- DO NOT run against production or staging databases.
-- =============================================================

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

-- ============================================================= 
-- CORE TABLES (topologically sorted by FK dependencies)
-- =============================================================

-- Table: schools (root — no foreign keys)
CREATE TABLE `schools` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `slug` VARCHAR(191) NOT NULL UNIQUE,
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
  `isActive` TINYINT(1) NOT NULL DEFAULT 1,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_schools_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: users (references schools optionally)
CREATE TABLE `users` (
  `id` VARCHAR(191) NOT NULL,
  `schoolId` VARCHAR(191) NULL,
  `email` VARCHAR(191) NOT NULL UNIQUE,
  `phone` VARCHAR(191) NULL,
  `passwordHash` VARCHAR(191) NULL,
  `role` ENUM('SUPER_ADMIN','SCHOOL_ADMIN','TEACHER','STUDENT','GUARDIAN','REPRESENTATIVE','MEMBER') NOT NULL,
  `status` ENUM('ACTIVE','INACTIVE','SUSPENDED','PENDING','BANNED') NOT NULL DEFAULT 'PENDING',
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
  `username` VARCHAR(30) NULL UNIQUE,
  `fcmToken` VARCHAR(512) NULL,
  `lastLoginAt` DATETIME(3) NULL,
  `emailVerified` TINYINT(1) NOT NULL DEFAULT 0,
  `phoneVerified` TINYINT(1) NOT NULL DEFAULT 0,
  `twoFactorEnabled` TINYINT(1) NOT NULL DEFAULT 0,
  `twoFactorSecret` TEXT NULL,
  `mustChangePassword` TINYINT(1) NOT NULL DEFAULT 0,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_users_email` (`email`),
  INDEX `idx_users_schoolId` (`schoolId`),
  INDEX `idx_users_role` (`role`),
  INDEX `idx_users_firstName` (`firstName`),
  INDEX `idx_users_lastName` (`lastName`),
  INDEX `idx_users_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: school_settings
CREATE TABLE `school_settings` (
  `id` VARCHAR(191) NOT NULL,
  `schoolId` VARCHAR(191) NOT NULL UNIQUE,
  `gradingScale` JSON NULL,
  `attendanceTypes` JSON NULL,
  `behaviorCategories` JSON NULL,
  `workingDays` JSON NULL,
  `schoolStartTime` VARCHAR(191) NOT NULL DEFAULT '08:00',
  `schoolEndTime` VARCHAR(191) NOT NULL DEFAULT '15:00',
  `allowSelfCheckIn` TINYINT(1) NOT NULL DEFAULT 1,
  `requireGpsCheckIn` TINYINT(1) NOT NULL DEFAULT 0,
  `parentNotifications` TINYINT(1) NOT NULL DEFAULT 1,
  `smsEnabled` TINYINT(1) NOT NULL DEFAULT 0,
  `emailEnabled` TINYINT(1) NOT NULL DEFAULT 1,
  `pushEnabled` TINYINT(1) NOT NULL DEFAULT 1,
  `maxAbsenceAlert` INT NOT NULL DEFAULT 3,
  `passingGrade` DOUBLE NOT NULL DEFAULT 60.0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: school_memberships
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
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_school_memberships_userId_schoolId` (`userId`, `schoolId`),
  INDEX `idx_school_memberships_userId` (`userId`),
  INDEX `idx_school_memberships_schoolId` (`schoolId`),
  INDEX `idx_school_memberships_role` (`role`),
  INDEX `idx_school_memberships_status` (`status`),
  INDEX `idx_school_memberships_userId_status` (`userId`, `status`),
  INDEX `idx_school_memberships_schoolId_role_status` (`schoolId`, `role`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: auth_providers
CREATE TABLE `auth_providers` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(50) NOT NULL,
  `providerAccountId` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NULL,
  `displayName` VARCHAR(255) NULL,
  `avatarUrl` VARCHAR(512) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_auth_providers_provider_account` (`provider`, `providerAccountId`),
  UNIQUE KEY `uq_auth_providers_userId_provider` (`userId`, `provider`),
  INDEX `idx_auth_providers_userId` (`userId`),
  INDEX `idx_auth_providers_provider` (`provider`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: refresh_tokens
CREATE TABLE `refresh_tokens` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `token` VARCHAR(512) NOT NULL UNIQUE,
  `expiresAt` DATETIME(3) NOT NULL,
  `isRevoked` TINYINT(1) NOT NULL DEFAULT 0,
  `ipAddress` VARCHAR(191) NULL,
  `userAgent` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_refresh_tokens_userId` (`userId`),
  INDEX `idx_refresh_tokens_expiresAt` (`expiresAt`),
  INDEX `idx_refresh_tokens_isRevoked` (`isRevoked`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: otp_codes
CREATE TABLE `otp_codes` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `code` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `isUsed` TINYINT(1) NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_otp_codes_userId` (`userId`),
  INDEX `idx_otp_codes_expiresAt` (`expiresAt`),
  INDEX `idx_otp_codes_isUsed` (`isUsed`),
  INDEX `idx_otp_codes_userId_type_isUsed` (`userId`, `type`, `isUsed`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: sessions
CREATE TABLE `sessions` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `token` VARCHAR(512) NOT NULL UNIQUE,
  `expiresAt` DATETIME(3) NOT NULL,
  `ipAddress` VARCHAR(191) NULL,
  `userAgent` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_sessions_userId` (`userId`),
  INDEX `idx_sessions_expiresAt` (`expiresAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: terms
CREATE TABLE `terms` (
  `id` VARCHAR(191) NOT NULL,
  `schoolId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `startDate` DATETIME(3) NOT NULL,
  `endDate` DATETIME(3) NOT NULL,
  `isActive` TINYINT(1) NOT NULL DEFAULT 0,
  `isCurrent` TINYINT(1) NOT NULL DEFAULT 0,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_terms_schoolId` (`schoolId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: classes
CREATE TABLE `classes` (
  `id` VARCHAR(191) NOT NULL,
  `schoolId` VARCHAR(191) NOT NULL,
  `termId` VARCHAR(191) NULL,
  `name` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `gradeLevel` VARCHAR(191) NULL,
  `room` VARCHAR(191) NULL,
  `capacity` INT NOT NULL DEFAULT 30,
  `schedule` JSON NULL,
  `isActive` TINYINT(1) NOT NULL DEFAULT 1,
  `isDefault` TINYINT(1) NOT NULL DEFAULT 0,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_classes_schoolId` (`schoolId`),
  INDEX `idx_classes_termId` (`termId`),
  INDEX `idx_classes_schoolId_isActive` (`schoolId`, `isActive`),
  INDEX `idx_classes_schoolId_isDefault` (`schoolId`, `isDefault`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: students
CREATE TABLE `students` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL UNIQUE,
  `schoolId` VARCHAR(191) NOT NULL,
  `studentId` VARCHAR(191) NOT NULL,
  `qrCode` VARCHAR(191) NULL UNIQUE,
  `gradeLevel` VARCHAR(191) NULL,
  `enrollmentDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `graduationDate` DATETIME(3) NULL,
  `medicalNotes` TEXT NULL,
  `emergencyContact` JSON NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_students_schoolId_studentId` (`schoolId`, `studentId`),
  INDEX `idx_students_schoolId` (`schoolId`),
  INDEX `idx_students_qrCode` (`qrCode`),
  INDEX `idx_students_studentId` (`studentId`),
  INDEX `idx_students_gradeLevel` (`gradeLevel`),
  INDEX `idx_students_schoolId_deletedAt` (`schoolId`, `deletedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: teachers
CREATE TABLE `teachers` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL UNIQUE,
  `schoolId` VARCHAR(191) NOT NULL,
  `employeeId` VARCHAR(191) NULL,
  `department` VARCHAR(191) NULL,
  `specialization` VARCHAR(191) NULL,
  `hireDate` DATETIME(3) NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_teachers_schoolId` (`schoolId`),
  INDEX `idx_teachers_schoolId_deletedAt` (`schoolId`, `deletedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: guardians
CREATE TABLE `guardians` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL UNIQUE,
  `schoolId` VARCHAR(191) NOT NULL,
  `relationship` VARCHAR(191) NOT NULL DEFAULT 'parent',
  `occupation` VARCHAR(191) NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_guardians_schoolId` (`schoolId`),
  INDEX `idx_guardians_schoolId_deletedAt` (`schoolId`, `deletedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: enrollments
CREATE TABLE `enrollments` (
  `id` VARCHAR(191) NOT NULL,
  `studentId` VARCHAR(191) NOT NULL,
  `classId` VARCHAR(191) NOT NULL,
  `enrolledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `droppedAt` DATETIME(3) NULL,
  `isActive` TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_enrollments_studentId_classId` (`studentId`, `classId`),
  INDEX `idx_enrollments_classId` (`classId`),
  INDEX `idx_enrollments_studentId_isActive` (`studentId`, `isActive`),
  INDEX `idx_enrollments_classId_isActive` (`classId`, `isActive`),
  INDEX `idx_enrollments_studentId_classId_isActive` (`studentId`, `classId`, `isActive`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================= 
-- VOICE CLUB DOMAIN
-- =============================================================

-- Table: voice_rooms
CREATE TABLE `voice_rooms` (
  `id` VARCHAR(191) NOT NULL,
  `schoolId` VARCHAR(191) NULL,
  `hostId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `privacy` ENUM('PUBLIC','PRIVATE','INVITE_ONLY') NOT NULL DEFAULT 'PUBLIC',
  `status` ENUM('LIVE','IDLE','ENDED','SCHEDULED') NOT NULL DEFAULT 'IDLE',
  `maxSpeakers` INT NOT NULL DEFAULT 12,
  `isOpenMic` TINYINT(1) NOT NULL DEFAULT 0,
  `micLocked` TINYINT(1) NOT NULL DEFAULT 0,
  `allMuted` TINYINT(1) NOT NULL DEFAULT 0,
  `roomLevel` INT NOT NULL DEFAULT 1,
  `coverEmoji` VARCHAR(191) NULL DEFAULT '🎙️',
  `coverImageUrl` VARCHAR(191) NULL,
  `topic` VARCHAR(191) NULL,
  `scheduledAt` DATETIME(3) NULL,
  `startedAt` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
  `endedAt` DATETIME(3) NULL,
  `lastActivityAt` DATETIME(3) NULL,
  `recordingUrl` VARCHAR(191) NULL,
  `commentsEnabled` TINYINT(1) NOT NULL DEFAULT 1,
  `slowMode` TINYINT(1) NOT NULL DEFAULT 0,
  `messageType` VARCHAR(191) NOT NULL DEFAULT 'all',
  `reactionsEnabled` TINYINT(1) NOT NULL DEFAULT 1,
  `lockedSeats` JSON NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_voice_rooms_schoolId` (`schoolId`),
  INDEX `idx_voice_rooms_hostId` (`hostId`),
  INDEX `idx_voice_rooms_status` (`status`),
  INDEX `idx_voice_rooms_privacy` (`privacy`),
  INDEX `idx_voice_rooms_status_privacy_schoolId` (`status`, `privacy`, `schoolId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: voice_participants
CREATE TABLE `voice_participants` (
  `id` VARCHAR(191) NOT NULL,
  `roomId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `role` ENUM('HOST','MODERATOR','SPEAKER','AUDIENCE') NOT NULL DEFAULT 'AUDIENCE',
  `isMuted` TINYINT(1) NOT NULL DEFAULT 1,
  `mutedByModerator` TINYINT(1) NOT NULL DEFAULT 0,
  `handRaised` TINYINT(1) NOT NULL DEFAULT 0,
  `handRaisedAt` DATETIME(3) NULL,
  `isPinned` TINYINT(1) NOT NULL DEFAULT 0,
  `seatNumber` INT NULL,
  `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `leftAt` DATETIME(3) NULL,
  `isActive` TINYINT(1) NOT NULL DEFAULT 1,
  `wasKicked` TINYINT(1) NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_voice_participants_roomId_userId` (`roomId`, `userId`),
  UNIQUE KEY `uq_voice_participants_roomId_seatNumber` (`roomId`, `seatNumber`),
  INDEX `idx_voice_participants_roomId` (`roomId`),
  INDEX `idx_voice_participants_userId` (`userId`),
  INDEX `idx_voice_participants_isActive` (`isActive`),
  INDEX `idx_voice_participants_roomId_isActive_role` (`roomId`, `isActive`, `role`),
  INDEX `idx_voice_participants_roomId_isActive_handRaised_handRaisedAt` (`roomId`, `isActive`, `handRaised`, `handRaisedAt`),
  INDEX `idx_voice_participants_roomId_isActive_seatNumber` (`roomId`, `isActive`, `seatNumber`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: voice_messages
CREATE TABLE `voice_messages` (
  `id` VARCHAR(191) NOT NULL,
  `roomId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `body` TEXT NOT NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_voice_messages_roomId` (`roomId`),
  INDEX `idx_voice_messages_userId` (`userId`),
  INDEX `idx_voice_messages_roomId_createdAt` (`roomId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: voice_room_members
CREATE TABLE `voice_room_members` (
  `id` VARCHAR(191) NOT NULL,
  `roomId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `memberLevel` INT NOT NULL DEFAULT 1,
  `role` VARCHAR(191) NOT NULL DEFAULT 'MEMBER',
  `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  `nickname` VARCHAR(191) NULL,
  `lastActiveAt` DATETIME(3) NULL,
  `isOnline` TINYINT(1) NOT NULL DEFAULT 0,
  `contribution` INT NOT NULL DEFAULT 0,
  `invitedBy` VARCHAR(191) NULL,
  `isBanned` TINYINT(1) NOT NULL DEFAULT 0,
  `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `upgradedAt` DATETIME(3) NULL,
  `note` VARCHAR(191) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_voice_room_members_roomId_userId` (`roomId`, `userId`),
  INDEX `idx_voice_room_members_roomId` (`roomId`),
  INDEX `idx_voice_room_members_userId` (`userId`),
  INDEX `idx_voice_room_members_roomId_memberLevel` (`roomId`, `memberLevel`),
  INDEX `idx_voice_room_members_roomId_isBanned` (`roomId`, `isBanned`),
  INDEX `idx_voice_room_members_roomId_status` (`roomId`, `status`),
  INDEX `idx_voice_room_members_roomId_role` (`roomId`, `role`),
  INDEX `idx_voice_room_members_roomId_isOnline` (`roomId`, `isOnline`),
  INDEX `idx_voice_room_members_lastActiveAt` (`lastActiveAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: voice_host_stats
CREATE TABLE `voice_host_stats` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `date` DATE NOT NULL,
  `roomsHosted` INT NOT NULL DEFAULT 0,
  `totalMinutes` INT NOT NULL DEFAULT 0,
  `peakAudience` INT NOT NULL DEFAULT 0,
  `totalListeners` INT NOT NULL DEFAULT 0,
  `totalSpeakers` INT NOT NULL DEFAULT 0,
  `totalMessages` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_voice_host_stats_userId_date` (`userId`, `date`),
  INDEX `idx_voice_host_stats_userId` (`userId`),
  INDEX `idx_voice_host_stats_date` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================= 
-- GIFT ECONOMY DOMAIN
-- =============================================================

-- Table: wallets
CREATE TABLE `wallets` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL UNIQUE,
  `coins` INT NOT NULL DEFAULT 0,
  `diamonds` INT NOT NULL DEFAULT 0,
  `totalSpent` INT NOT NULL DEFAULT 0,
  `totalEarned` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_wallets_userId` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: wallet_transactions
CREATE TABLE `wallet_transactions` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `coins` INT NOT NULL,
  `diamonds` INT NOT NULL DEFAULT 0,
  `description` VARCHAR(255) NULL,
  `stripeSessionId` VARCHAR(191) NULL UNIQUE,
  `idempotencyKey` VARCHAR(128) NULL UNIQUE,
  `packageId` VARCHAR(191) NULL,
  `giftTxId` VARCHAR(191) NULL,
  `tipId` VARCHAR(191) NULL,
  `subscriptionId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_wallet_transactions_userId` (`userId`),
  INDEX `idx_wallet_transactions_type` (`type`),
  INDEX `idx_wallet_transactions_createdAt` (`createdAt`),
  INDEX `idx_wallet_transactions_userId_createdAt` (`userId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: coin_packages
CREATE TABLE `coin_packages` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `coins` INT NOT NULL,
  `priceUsd` DECIMAL(10,2) NOT NULL,
  `bonusCoins` INT NOT NULL DEFAULT 0,
  `isActive` TINYINT(1) NOT NULL DEFAULT 1,
  `sortOrder` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: gifts
CREATE TABLE `gifts` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `emoji` VARCHAR(191) NOT NULL DEFAULT '🎁',
  `imageUrl` VARCHAR(191) NULL,
  `videoUrl` VARCHAR(191) NULL,
  `animationType` VARCHAR(191) NOT NULL DEFAULT 'overlay',
  `soundEffect` VARCHAR(191) NULL,
  `priceCoins` INT NOT NULL,
  `rarity` VARCHAR(191) NOT NULL DEFAULT 'common',
  `comboEnabled` TINYINT(1) NOT NULL DEFAULT 1,
  `priority` VARCHAR(191) NOT NULL DEFAULT 'normal',
  `isPremium` TINYINT(1) NOT NULL DEFAULT 0,
  `isActive` TINYINT(1) NOT NULL DEFAULT 1,
  `sortOrder` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_gifts_isActive` (`isActive`),
  INDEX `idx_gifts_isPremium` (`isPremium`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: gift_transactions
CREATE TABLE `gift_transactions` (
  `id` VARCHAR(191) NOT NULL,
  `roomId` VARCHAR(191) NOT NULL,
  `room_type` VARCHAR(191) NOT NULL DEFAULT 'voice',
  `senderId` VARCHAR(191) NOT NULL,
  `receiverId` VARCHAR(191) NOT NULL,
  `giftId` VARCHAR(191) NOT NULL,
  `count` INT NOT NULL DEFAULT 1,
  `combo` INT NOT NULL DEFAULT 1,
  `priority` VARCHAR(191) NOT NULL DEFAULT 'normal',
  `isPremium` TINYINT(1) NOT NULL DEFAULT 0,
  `coinsSpent` INT NOT NULL,
  `diamondsEarned` INT NOT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL UNIQUE,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_gift_transactions_roomId` (`roomId`),
  INDEX `idx_gift_transactions_room_type` (`room_type`),
  INDEX `idx_gift_transactions_senderId` (`senderId`),
  INDEX `idx_gift_transactions_receiverId` (`receiverId`),
  INDEX `idx_gift_transactions_createdAt` (`createdAt`),
  INDEX `idx_gift_transactions_isPremium` (`isPremium`),
  INDEX `idx_gift_transactions_createdAt_senderId` (`createdAt`, `senderId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: platform_revenue_entries
CREATE TABLE `platform_revenue_entries` (
  `id` VARCHAR(191) NOT NULL,
  `source_type` VARCHAR(50) NOT NULL,
  `source_id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `coins` INT NOT NULL,
  `usd_equiv` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_platform_revenue_source` (`source_type`, `source_id`),
  INDEX `idx_platform_revenue_entries_source_type` (`source_type`),
  INDEX `idx_platform_revenue_entries_user_id` (`user_id`),
  INDEX `idx_platform_revenue_entries_created_at` (`created_at`),
  INDEX `idx_platform_revenue_entries_source_type_created_at` (`source_type`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: payout_requests
CREATE TABLE `payout_requests` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `amount` INT NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `usdAmount` DECIMAL(10,2) NOT NULL,
  `paypalEmail` VARCHAR(191) NULL,
  `processedAt` DATETIME(3) NULL,
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_payout_requests_userId` (`userId`),
  INDEX `idx_payout_requests_status` (`status`),
  INDEX `idx_payout_requests_createdAt` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================= 
-- SOCIAL DOMAIN
-- =============================================================

-- Table: follows
CREATE TABLE `follows` (
  `id` VARCHAR(191) NOT NULL,
  `followerId` VARCHAR(191) NOT NULL,
  `followingId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_follows_followerId_followingId` (`followerId`, `followingId`),
  INDEX `idx_follows_followerId` (`followerId`),
  INDEX `idx_follows_followingId` (`followingId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: friend_requests
CREATE TABLE `friend_requests` (
  `id` VARCHAR(191) NOT NULL,
  `senderId` VARCHAR(191) NOT NULL,
  `receiverId` VARCHAR(191) NOT NULL,
  `status` ENUM('PENDING','ACCEPTED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_friend_requests_senderId_receiverId` (`senderId`, `receiverId`),
  INDEX `idx_friend_requests_senderId` (`senderId`),
  INDEX `idx_friend_requests_receiverId` (`receiverId`),
  INDEX `idx_friend_requests_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: posts
CREATE TABLE `posts` (
  `id` VARCHAR(191) NOT NULL,
  `authorId` VARCHAR(191) NOT NULL,
  `schoolId` VARCHAR(191) NULL,
  `communityId` VARCHAR(191) NULL,
  `content` TEXT NOT NULL,
  `mediaUrls` JSON NULL,
  `visibility` ENUM('PUBLIC','FOLLOWERS','FRIENDS','PRIVATE') NOT NULL DEFAULT 'PUBLIC',
  `pollOptions` JSON NULL,
  `votedOptionId` VARCHAR(191) NULL,
  `reactionsCount` INT NOT NULL DEFAULT 0,
  `commentsCount` INT NOT NULL DEFAULT 0,
  `viewsCount` INT NOT NULL DEFAULT 0,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_posts_authorId` (`authorId`),
  INDEX `idx_posts_schoolId` (`schoolId`),
  INDEX `idx_posts_communityId` (`communityId`),
  INDEX `idx_posts_visibility` (`visibility`),
  INDEX `idx_posts_createdAt` (`createdAt`),
  INDEX `idx_posts_authorId_createdAt` (`authorId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: post_reactions
CREATE TABLE `post_reactions` (
  `id` VARCHAR(191) NOT NULL,
  `postId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `emoji` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_post_reactions_postId_userId` (`postId`, `userId`),
  INDEX `idx_post_reactions_postId` (`postId`),
  INDEX `idx_post_reactions_userId` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: stories
CREATE TABLE `stories` (
  `id` VARCHAR(191) NOT NULL,
  `authorId` VARCHAR(191) NOT NULL,
  `mediaUrls` JSON NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `viewsCount` INT NOT NULL DEFAULT 0,
  `reactionsCount` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_stories_authorId` (`authorId`),
  INDEX `idx_stories_expiresAt` (`expiresAt`),
  INDEX `idx_stories_authorId_expiresAt` (`authorId`, `expiresAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: communities
CREATE TABLE `communities` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `slug` VARCHAR(191) NOT NULL UNIQUE,
  `description` TEXT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `coverImageUrl` VARCHAR(191) NULL,
  `memberCount` INT NOT NULL DEFAULT 0,
  `privacyLevel` ENUM('PUBLIC','PRIVATE','SECRET') NOT NULL DEFAULT 'PUBLIC',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_communities_slug` (`slug`),
  INDEX `idx_communities_ownerId` (`ownerId`),
  INDEX `idx_communities_privacyLevel` (`privacyLevel`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: dm_conversations
CREATE TABLE `dm_conversations` (
  `id` VARCHAR(191) NOT NULL,
  `userA` VARCHAR(191) NOT NULL,
  `userB` VARCHAR(191) NOT NULL,
  `lastMessageAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dm_conversations_userA_userB` (`userA`, `userB`),
  INDEX `idx_dm_conversations_userA` (`userA`),
  INDEX `idx_dm_conversations_userB` (`userB`),
  INDEX `idx_dm_conversations_lastMessageAt` (`lastMessageAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: direct_messages
CREATE TABLE `direct_messages` (
  `id` VARCHAR(191) NOT NULL,
  `conversationId` VARCHAR(191) NOT NULL,
  `senderId` VARCHAR(191) NOT NULL,
  `receiverId` VARCHAR(191) NOT NULL,
  `content` TEXT NOT NULL,
  `mediaUrls` JSON NULL,
  `replyToId` VARCHAR(191) NULL,
  `editedAt` DATETIME(3) NULL,
  `readAt` DATETIME(3) NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_direct_messages_conversationId` (`conversationId`),
  INDEX `idx_direct_messages_senderId` (`senderId`),
  INDEX `idx_direct_messages_receiverId` (`receiverId`),
  INDEX `idx_direct_messages_replyToId` (`replyToId`),
  INDEX `idx_direct_messages_conversationId_createdAt` (`conversationId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================= 
-- LIVE CLASSES DOMAIN
-- =============================================================

-- Table: live_classes
CREATE TABLE `live_classes` (
  `id` VARCHAR(191) NOT NULL,
  `classId` VARCHAR(191) NULL,
  `teacherId` VARCHAR(191) NULL,
  `hostId` VARCHAR(191) NOT NULL,
  `delegatedHostId` VARCHAR(191) NULL,
  `title` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `isPublic` TINYINT(1) NOT NULL DEFAULT 0,
  `isLive` TINYINT(1) NOT NULL DEFAULT 0,
  `maxParticipants` INT NULL,
  `openMicEnabled` TINYINT(1) NOT NULL DEFAULT 0,
  `micLocked` TINYINT(1) NOT NULL DEFAULT 0,
  `scheduledAt` DATETIME(3) NULL,
  `startedAt` DATETIME(3) NULL,
  `endedAt` DATETIME(3) NULL,
  `recordingUrl` VARCHAR(191) NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_live_classes_classId` (`classId`),
  INDEX `idx_live_classes_teacherId` (`teacherId`),
  INDEX `idx_live_classes_hostId` (`hostId`),
  INDEX `idx_live_classes_delegatedHostId` (`delegatedHostId`),
  INDEX `idx_live_classes_isLive` (`isLive`),
  INDEX `idx_live_classes_scheduledAt` (`scheduledAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: live_class_participants
CREATE TABLE `live_class_participants` (
  `id` VARCHAR(191) NOT NULL,
  `liveClassId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `role` ENUM('HOST','MODERATOR','PARTICIPANT') NOT NULL DEFAULT 'PARTICIPANT',
  `micMuted` TINYINT(1) NOT NULL DEFAULT 1,
  `handRaised` TINYINT(1) NOT NULL DEFAULT 0,
  `wasKicked` TINYINT(1) NOT NULL DEFAULT 0,
  `isModerator` TINYINT(1) NOT NULL DEFAULT 0,
  `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `leftAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_live_class_participants_liveClassId_userId` (`liveClassId`, `userId`),
  INDEX `idx_live_class_participants_liveClassId` (`liveClassId`),
  INDEX `idx_live_class_participants_userId` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: live_class_messages
CREATE TABLE `live_class_messages` (
  `id` VARCHAR(191) NOT NULL,
  `liveClassId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `body` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_live_class_messages_liveClassId` (`liveClassId`),
  INDEX `idx_live_class_messages_userId` (`userId`),
  INDEX `idx_live_class_messages_liveClassId_createdAt` (`liveClassId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================= 
-- NOTIFICATIONS & AUDIT DOMAIN
-- =============================================================

-- Table: notifications
CREATE TABLE `notifications` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `schoolId` VARCHAR(191) NULL,
  `type` ENUM('ATTENDANCE','GRADE','BEHAVIOR','MESSAGE','ANNOUNCEMENT','REMINDER','SYSTEM','FOLLOW','LIKE','COMMENT','COMMENT_REPLY','FRIEND_REQUEST','FRIEND_ACCEPTED','COMMUNITY_JOIN','COMMUNITY_INVITE','GIFT_RECEIVED','TIP_RECEIVED','NEW_SUBSCRIBER','MENTION','VOICE_ROOM_LIVE','LIVE_CLASS_START','COINS_PURCHASED','PK_INVITATION','PK_ACCEPTED','PK_STARTING','PK_RESULT','PK_ACHIEVEMENT','PK_MISSION','PK_TOURNAMENT','PK_SEASON') NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `body` TEXT NOT NULL,
  `data` JSON NULL,
  `isRead` TINYINT(1) NOT NULL DEFAULT 0,
  `readAt` DATETIME(3) NULL,
  `sentVia` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_notifications_userId` (`userId`),
  INDEX `idx_notifications_isRead` (`isRead`),
  INDEX `idx_notifications_userId_isRead_createdAt` (`userId`, `isRead`, `createdAt`),
  INDEX `idx_notifications_userId_type_createdAt` (`userId`, `type`, `createdAt`),
  INDEX `idx_notifications_userId_type_isRead` (`userId`, `type`, `isRead`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: audit_logs
CREATE TABLE `audit_logs` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NULL,
  `schoolId` VARCHAR(191) NULL,
  `action` ENUM('CREATE','UPDATE','DELETE','LOGIN','LOGOUT','EXPORT','IMPORT','VIEW') NOT NULL,
  `entity` VARCHAR(191) NOT NULL,
  `entityId` VARCHAR(191) NULL,
  `oldValues` JSON NULL,
  `newValues` JSON NULL,
  `ipAddress` VARCHAR(191) NULL,
  `userAgent` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_audit_logs_userId` (`userId`),
  INDEX `idx_audit_logs_schoolId` (`schoolId`),
  INDEX `idx_audit_logs_entity` (`entity`),
  INDEX `idx_audit_logs_createdAt` (`createdAt`),
  INDEX `idx_audit_logs_schoolId_action_createdAt` (`schoolId`, `action`, `createdAt`),
  INDEX `idx_audit_logs_entity_entityId_createdAt` (`entity`, `entityId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================= 
-- FOREIGN KEY CONSTRAINTS
-- =============================================================

ALTER TABLE `users`
  ADD CONSTRAINT `fk_users_schoolId` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `school_settings`
  ADD CONSTRAINT `fk_school_settings_schoolId` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `school_memberships`
  ADD CONSTRAINT `fk_school_memberships_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_school_memberships_schoolId` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `auth_providers`
  ADD CONSTRAINT `fk_auth_providers_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `refresh_tokens`
  ADD CONSTRAINT `fk_refresh_tokens_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `otp_codes`
  ADD CONSTRAINT `fk_otp_codes_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sessions`
  ADD CONSTRAINT `fk_sessions_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `terms`
  ADD CONSTRAINT `fk_terms_schoolId` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `classes`
  ADD CONSTRAINT `fk_classes_schoolId` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_classes_termId` FOREIGN KEY (`termId`) REFERENCES `terms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `students`
  ADD CONSTRAINT `fk_students_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_students_schoolId` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `teachers`
  ADD CONSTRAINT `fk_teachers_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_teachers_schoolId` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `guardians`
  ADD CONSTRAINT `fk_guardians_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_guardians_schoolId` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `enrollments`
  ADD CONSTRAINT `fk_enrollments_studentId` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_enrollments_classId` FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `voice_rooms`
  ADD CONSTRAINT `fk_voice_rooms_hostId` FOREIGN KEY (`hostId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `voice_participants`
  ADD CONSTRAINT `fk_voice_participants_roomId` FOREIGN KEY (`roomId`) REFERENCES `voice_rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_voice_participants_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `voice_messages`
  ADD CONSTRAINT `fk_voice_messages_roomId` FOREIGN KEY (`roomId`) REFERENCES `voice_rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_voice_messages_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `voice_room_members`
  ADD CONSTRAINT `fk_voice_room_members_roomId` FOREIGN KEY (`roomId`) REFERENCES `voice_rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_voice_room_members_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `voice_host_stats`
  ADD CONSTRAINT `fk_voice_host_stats_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `wallets`
  ADD CONSTRAINT `fk_wallets_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `wallet_transactions`
  ADD CONSTRAINT `fk_wallet_transactions_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `gift_transactions`
  ADD CONSTRAINT `fk_gift_transactions_senderId` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_gift_transactions_receiverId` FOREIGN KEY (`receiverId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_gift_transactions_giftId` FOREIGN KEY (`giftId`) REFERENCES `gifts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `payout_requests`
  ADD CONSTRAINT `fk_payout_requests_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `follows`
  ADD CONSTRAINT `fk_follows_followerId` FOREIGN KEY (`followerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_follows_followingId` FOREIGN KEY (`followingId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `friend_requests`
  ADD CONSTRAINT `fk_friend_requests_senderId` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_friend_requests_receiverId` FOREIGN KEY (`receiverId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `posts`
  ADD CONSTRAINT `fk_posts_authorId` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `post_reactions`
  ADD CONSTRAINT `fk_post_reactions_postId` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_post_reactions_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `stories`
  ADD CONSTRAINT `fk_stories_authorId` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `communities`
  ADD CONSTRAINT `fk_communities_ownerId` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `dm_conversations`
  ADD CONSTRAINT `fk_dm_conversations_userA` FOREIGN KEY (`userA`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_dm_conversations_userB` FOREIGN KEY (`userB`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `direct_messages`
  ADD CONSTRAINT `fk_direct_messages_conversationId` FOREIGN KEY (`conversationId`) REFERENCES `dm_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_direct_messages_senderId` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_direct_messages_receiverId` FOREIGN KEY (`receiverId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `live_classes`
  ADD CONSTRAINT `fk_live_classes_classId` FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_live_classes_teacherId` FOREIGN KEY (`teacherId`) REFERENCES `teachers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_live_classes_delegatedHostId` FOREIGN KEY (`delegatedHostId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_live_classes_hostId` FOREIGN KEY (`hostId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `live_class_participants`
  ADD CONSTRAINT `fk_live_class_participants_liveClassId` FOREIGN KEY (`liveClassId`) REFERENCES `live_classes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_live_class_participants_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `live_class_messages`
  ADD CONSTRAINT `fk_live_class_messages_liveClassId` FOREIGN KEY (`liveClassId`) REFERENCES `live_classes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_live_class_messages_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `notifications`
  ADD CONSTRAINT `fk_notifications_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_notifications_schoolId` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `audit_logs`
  ADD CONSTRAINT `fk_audit_logs_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_audit_logs_schoolId` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================= 
-- CHECK CONSTRAINTS
-- =============================================================

ALTER TABLE `wallets`
  ADD CONSTRAINT `chk_wallet_coins_positive` CHECK (`coins` >= 0),
  ADD CONSTRAINT `chk_wallet_diamonds_positive` CHECK (`diamonds` >= 0),
  ADD CONSTRAINT `chk_wallet_total_spent` CHECK (`totalSpent` >= 0),
  ADD CONSTRAINT `chk_wallet_total_earned` CHECK (`totalEarned` >= 0);

ALTER TABLE `school_memberships`
  ADD CONSTRAINT `chk_membership_role` CHECK (`role` IN ('SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'GUARDIAN', 'REPRESENTATIVE'));

ALTER TABLE `wallet_transactions`
  ADD CONSTRAINT `chk_wallet_tx_type` CHECK (`type` IN ('STRIPE_PURCHASE', 'GIFT_SEND', 'GIFT_RECEIVE', 'TIP_SEND', 'TIP_RECEIVE', 'SUBSCRIPTION', 'SUBSCRIPTION_RECEIVE', 'ADMIN_GRANT', 'REFUND', 'PAYOUT', 'PAYOUT_REVERSAL', 'DISPUTED'));

-- ============================================================= 
-- CLEANUP
-- =============================================================

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================= 
-- END OF BASELINE
-- =============================================================
-- 
-- REPRESENTATIVE BASELINE SUMMARY:
-- - 39 core tables across 7 domains
-- - Auth & Users: 7 tables (users, auth_providers, refresh_tokens, otp_codes, sessions, school_memberships, school_settings)
-- - School Management: 7 tables (schools, terms, classes, students, teachers, guardians, enrollments)
-- - Voice Club: 5 tables (voice_rooms, voice_participants, voice_messages, voice_room_members, voice_host_stats)
-- - Gift Economy: 7 tables (wallets, wallet_transactions, coin_packages, gifts, gift_transactions, platform_revenue_entries, payout_requests)
-- - Social: 8 tables (follows, friend_requests, posts, post_reactions, stories, communities, dm_conversations, direct_messages)
-- - Live Classes: 3 tables (live_classes, live_class_participants, live_class_messages)
-- - System: 2 tables (notifications, audit_logs)
--
-- EXCLUDED FROM THIS BASELINE (documented in schema-manifest.json):
-- - Attendance & Grades (10 tables)
-- - Audio Courses (3 tables)
-- - Library Management (2 tables)
-- - Fee Records (1 table)
-- - Calendar & Notes (3 tables)
-- - Messaging (2 tables)
-- - Announcements (1 table)
-- - File Uploads (1 table)
-- - Reports (1 table)
-- - Activities (2 tables)
-- - Behavior Logs (1 table)
-- - Social extended (15 tables: post comments, bookmarks, views, mentions, story views/reactions, community members/invites/bans/join requests, creator profiles/subscriptions/tips)
-- - Group Chat (4 tables)
-- - Assignments & Exams (2 tables)
-- - Marketplace (3 tables)
-- - Transport (4 tables)
-- - Leaderboards (2 tables)
-- - Practice Quizzes (3 tables)
-- - PK Battle System (3 tables)
-- - Guardian-Student links (1 table)
-- - Teacher-Class links (1 table)
-- - DM Reactions (1 table)
-- - User Reports/Blocks (3 tables)
--
-- Total excluded: 74 tables
-- Full schema manifest documents all 113 tables with complete column/index/FK metadata.
