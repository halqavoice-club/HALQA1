-- ─── HALQA Performance Indexes Migration ─────────────────────────────────────
-- Date    : 2026-08-01
-- Author  : Audit Phase 1/2
-- Purpose : Add missing composite indexes identified in the full platform audit.
--           All statements are additive (CREATE INDEX IF NOT EXISTS).
--           Safe to run multiple times — idempotent.
--           Zero downtime: MySQL/MariaDB CREATE INDEX runs online on InnoDB.
--
-- Indexes added:
--   DB-001  voice_rooms          (status, privacy, schoolId)   — listRooms() hot path
--   DB-002  gift_transactions    (createdAt, senderId)          — daily leaderboard groupBy
--   DB-008  enrollments          (studentId, classId, isActive) — attendance eligibility check
-- ─────────────────────────────────────────────────────────────────────────────

-- DB-001: voice_rooms composite index
-- Eliminates full table scan on the room discovery / lobby page.
-- Covers: WHERE status != 'ENDED' AND privacy = 'PUBLIC' AND (schoolId = ? OR schoolId IS NULL)
CREATE INDEX IF NOT EXISTS `voice_rooms_status_privacy_schoolId_idx`
  ON `voice_rooms` (`status`, `privacy`, `schoolId`);

-- DB-002: gift_transactions composite index for daily leaderboard
-- Covers: WHERE createdAt >= TODAY grouped by senderId (ORDER BY SUM(coinsSpent) DESC)
CREATE INDEX IF NOT EXISTS `gift_transactions_createdAt_senderId_idx`
  ON `gift_transactions` (`createdAt`, `senderId`);

-- DB-008: enrollments triple composite index
-- Covers: WHERE studentId = ? AND classId = ? AND isActive = true
-- Used by attendance eligibility checks on every attendance mark.
CREATE INDEX IF NOT EXISTS `enrollments_studentId_classId_isActive_idx`
  ON `enrollments` (`studentId`, `classId`, `isActive`);
