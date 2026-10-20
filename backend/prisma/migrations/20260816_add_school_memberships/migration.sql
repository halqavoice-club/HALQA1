-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260816_add_school_memberships
-- Description: Add SchoolMembership model + MEMBER role for Social-only users
--
-- Strategy: ADDITIVE + BACKWARD-COMPATIBLE
--   - Adds MEMBER to the UserRole enum (existing roles untouched)
--   - Adds school_memberships table (new, does not modify existing tables)
--   - Back-fills school_memberships from existing (user.schoolId + user.role)
--     so all current users already have a membership record
--   - Does NOT drop user.schoolId or user.role (kept for legacy compatibility)
--   - Does NOT modify any existing table structure
--
-- After this migration:
--   - New social-only users register with role = MEMBER
--   - School-scoped roles (SUPER_ADMIN, SCHOOL_ADMIN, TEACHER, STUDENT, GUARDIAN)
--     live in school_memberships.role, NOT in user.role
--   - Existing users retain their user.role for backward compat until fully migrated
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Add MEMBER to UserRole enum ──────────────────────────────────────────
-- MySQL requires ALTER TABLE to change enum values.
-- We modify the `users`.`role` column to include MEMBER.
-- All existing enum values are preserved — no data loss.
ALTER TABLE `users`
  MODIFY COLUMN `role` ENUM(
    'SUPER_ADMIN',
    'SCHOOL_ADMIN',
    'TEACHER',
    'STUDENT',
    'GUARDIAN',
    'REPRESENTATIVE',
    'MEMBER'
  ) NOT NULL;

-- ─── 2. Create school_memberships table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS `school_memberships` (
  `id`         VARCHAR(191) NOT NULL,
  `userId`     VARCHAR(191) NOT NULL,
  `schoolId`   VARCHAR(191) NOT NULL,
  -- The Education role this user holds in THIS specific school.
  -- Uses VARCHAR so it's decoupled from the global UserRole enum.
  `role`       VARCHAR(40)  NOT NULL,
  -- ACTIVE = full access, PENDING = awaiting approval, SUSPENDED = suspended
  `status`     VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
  `invitedBy`  VARCHAR(191) NULL,     -- userId of whoever invited this member
  `joinedAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `deletedAt`  DATETIME(3)  NULL,
  `createdAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),

  -- Prevent duplicate active memberships for the same user + school
  UNIQUE INDEX `school_memberships_userId_schoolId_key` (`userId`, `schoolId`),

  -- Fast lookups
  INDEX `school_memberships_userId_idx`   (`userId`),
  INDEX `school_memberships_schoolId_idx` (`schoolId`),
  INDEX `school_memberships_role_idx`     (`role`),
  INDEX `school_memberships_status_idx`   (`status`),
  -- Composite: list all active memberships for a user
  INDEX `school_memberships_userId_status_idx` (`userId`, `status`),
  -- Composite: list all active members of a school with a specific role
  INDEX `school_memberships_schoolId_role_status_idx` (`schoolId`, `role`, `status`),

  CONSTRAINT `school_memberships_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `school_memberships_schoolId_fkey`
    FOREIGN KEY (`schoolId`) REFERENCES `schools` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── 3. Back-fill school_memberships from existing user.schoolId + user.role ──
-- For every existing user who has a schoolId AND a school-scoped role,
-- create a membership record so they don't lose access.
-- Roles that are education-scoped: SUPER_ADMIN, SCHOOL_ADMIN, TEACHER, STUDENT, GUARDIAN
-- REPRESENTATIVE users are NOT back-filled (no school-scoped semantics defined)
INSERT IGNORE INTO `school_memberships`
  (`id`, `userId`, `schoolId`, `role`, `status`, `joinedAt`, `createdAt`, `updatedAt`)
SELECT
  UUID()           AS `id`,
  u.`id`           AS `userId`,
  u.`schoolId`     AS `schoolId`,
  u.`role`         AS `role`,    -- copy the global role as the school role
  'ACTIVE'         AS `status`,
  u.`createdAt`    AS `joinedAt`,
  NOW()            AS `createdAt`,
  NOW()            AS `updatedAt`
FROM `users` u
WHERE
  u.`schoolId` IS NOT NULL
  AND u.`deletedAt` IS NULL
  AND u.`role` IN ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'GUARDIAN');
-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE: user.role and user.schoolId are KEPT intact for backward compatibility.
-- The new school_memberships table is the authoritative source for
-- school-scoped authorization going forward.
-- ─────────────────────────────────────────────────────────────────────────────
