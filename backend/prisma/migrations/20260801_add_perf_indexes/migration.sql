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
SET @idx1 = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='voice_rooms' AND INDEX_NAME='voice_rooms_status_privacy_schoolId_idx');
SET @sql1 = IF(@idx1=0, 'CREATE INDEX `voice_rooms_status_privacy_schoolId_idx` ON `voice_rooms` (`status`, `privacy`, `schoolId`)', 'SELECT 1');
PREPARE stmt1 FROM @sql1; EXECUTE stmt1; DEALLOCATE PREPARE stmt1;

-- DB-002: gift_transactions composite index for daily leaderboard
-- Covers: WHERE createdAt >= TODAY grouped by senderId (ORDER BY SUM(coinsSpent) DESC)
SET @idx2 = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='gift_transactions' AND INDEX_NAME='gift_transactions_createdAt_senderId_idx');
SET @sql2 = IF(@idx2=0, 'CREATE INDEX `gift_transactions_createdAt_senderId_idx` ON `gift_transactions` (`createdAt`, `senderId`)', 'SELECT 1');
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

-- DB-008: enrollments triple composite index
-- Covers: WHERE studentId = ? AND classId = ? AND isActive = true
-- Used by attendance eligibility checks on every attendance mark.
SET @idx3 = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='enrollments' AND INDEX_NAME='enrollments_studentId_classId_isActive_idx');
SET @sql3 = IF(@idx3=0, 'CREATE INDEX `enrollments_studentId_classId_isActive_idx` ON `enrollments` (`studentId`, `classId`, `isActive`)', 'SELECT 1');
PREPARE stmt3 FROM @sql3; EXECUTE stmt3; DEALLOCATE PREPARE stmt3;
