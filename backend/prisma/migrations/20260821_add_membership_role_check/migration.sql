-- Migration: 20260821_add_membership_role_check
-- Adds a CHECK constraint to school_memberships.role to enforce valid values
-- at the database level. This closes the gap where SchoolMembership.role is
-- a plain String in Prisma (no enum), meaning only application-layer guards
-- previously blocked invalid roles like SUPER_ADMIN.
--
-- Valid values mirror ALLOWED_MEMBERSHIP_ROLES in roleGuard.js:
--   SCHOOL_ADMIN | TEACHER | STUDENT | GUARDIAN | REPRESENTATIVE
--
-- SUPER_ADMIN is intentionally excluded — school-scoped SUPER_ADMIN is
-- meaningless and dangerous. MEMBER is excluded — it is a platform role,
-- not a school education role.
--
-- Step 1: Data fix — migrate legacy SUPER_ADMIN memberships to SCHOOL_ADMIN.
-- These were created by the old create-school route before the role guard
-- was added (pre-20260816_add_school_memberships). The user's global
-- User.role (SUPER_ADMIN) is unchanged — only the school-scoped membership
-- role is corrected to SCHOOL_ADMIN, which is the correct school-scoped role.
-- 11 rows affected as of 2026-08-21.
UPDATE `school_memberships`
  SET `role` = 'SCHOOL_ADMIN', `updatedAt` = NOW()
  WHERE `role` = 'SUPER_ADMIN';

-- Step 2: Add CHECK constraint — safe now that all rows have valid roles.
-- MariaDB 10.2+ and MySQL 8.0.16+ enforce CHECK constraints.
-- Earlier versions accept the syntax but silently ignore it.
ALTER TABLE `school_memberships`
  ADD CONSTRAINT `chk_membership_role`
  CHECK (`role` IN ('SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'GUARDIAN', 'REPRESENTATIVE'));
