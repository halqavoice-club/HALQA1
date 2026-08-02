-- =============================================================================
-- Halqa Management System — Database Optimization Script
-- MySQL 8 | Prisma ORM | Target: 50k–100k users
-- =============================================================================
-- Run this ONCE on your production database after deploying.
-- All statements use IF NOT EXISTS / CREATE INDEX ... IF NOT EXISTS (MySQL 8).
-- Safe to re-run — duplicate index creation is a no-op.
-- =============================================================================

-- ─── 0. SLOW QUERY LOG (run as root / DBA) ───────────────────────────────────
-- Enable in my.cnf / my.ini for persistent config:
--   [mysqld]
--   slow_query_log = ON
--   slow_query_log_file = /var/log/mysql/slow.log
--   long_query_time = 1
--   log_queries_not_using_indexes = ON
--   min_examined_row_limit = 100
--
-- Or enable at runtime (resets on restart):
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;
SET GLOBAL log_queries_not_using_indexes = 'ON';
SET GLOBAL min_examined_row_limit = 100;

-- ─── 1. USERS ─────────────────────────────────────────────────────────────────
-- Already indexed: email (unique), schoolId, role, firstName, lastName
-- Missing: composite for the most common filter pattern

-- Full-name search (used in social search, student/teacher lookup)
CREATE INDEX IF NOT EXISTS idx_users_school_status_role
  ON users (schoolId, status, role);

-- Soft-delete filter (deletedAt IS NULL is on almost every query)
CREATE INDEX IF NOT EXISTS idx_users_deleted_school
  ON users (deletedAt, schoolId);

-- lastLoginAt — used for inactive user reports
CREATE INDEX IF NOT EXISTS idx_users_last_login
  ON users (lastLoginAt);

-- ─── 2. STUDENTS ─────────────────────────────────────────────────────────────
-- Already indexed: schoolId, qrCode (unique), studentId, gradeLevel
-- Missing: composite for school + grade level (class roster queries)

CREATE INDEX IF NOT EXISTS idx_students_school_grade_deleted
  ON students (schoolId, gradeLevel, deletedAt);

-- ─── 3. TEACHERS ─────────────────────────────────────────────────────────────
-- Already indexed: schoolId
-- Missing: department filter

CREATE INDEX IF NOT EXISTS idx_teachers_school_deleted
  ON teachers (schoolId, deletedAt);

CREATE INDEX IF NOT EXISTS idx_teachers_department
  ON teachers (schoolId, department);

-- ─── 4. CLASSES ──────────────────────────────────────────────────────────────
-- Already indexed: schoolId, termId
-- Missing: active class filter (most common query)

CREATE INDEX IF NOT EXISTS idx_classes_school_active_deleted
  ON classes (schoolId, isActive, deletedAt);

CREATE INDEX IF NOT EXISTS idx_classes_term_active
  ON classes (termId, isActive);

-- ─── 5. ENROLLMENTS ──────────────────────────────────────────────────────────
-- Already indexed: classId, unique(studentId, classId)
-- Missing: active enrollment filter

CREATE INDEX IF NOT EXISTS idx_enrollments_student_active
  ON enrollments (studentId, isActive);

CREATE INDEX IF NOT EXISTS idx_enrollments_class_active
  ON enrollments (classId, isActive);

-- ─── 6. ATTENDANCE ───────────────────────────────────────────────────────────
-- Already indexed: classId, studentId, date, unique(classId, studentId, date)
-- These are the most queried columns — add composites for report queries

-- Attendance report: school + date range (admin dashboard)
CREATE INDEX IF NOT EXISTS idx_attendance_school_date
  ON attendance (schoolId, date);

-- Student attendance history: studentId + date range (most common)
CREATE INDEX IF NOT EXISTS idx_attendance_student_date_status
  ON attendance (studentId, date, status);

-- Class attendance for a date: classId + date (teacher view)
CREATE INDEX IF NOT EXISTS idx_attendance_class_date_status
  ON attendance (classId, date, status);

-- Unnotified absences (parent notification queue)
CREATE INDEX IF NOT EXISTS idx_attendance_notified_status
  ON attendance (notifiedParent, status, date);

-- ─── 7. BEHAVIOR LOGS ────────────────────────────────────────────────────────
-- Already indexed: studentId, teacherId, date

CREATE INDEX IF NOT EXISTS idx_behavior_student_date_deleted
  ON behavior_logs (studentId, date, deletedAt);

CREATE INDEX IF NOT EXISTS idx_behavior_student_type
  ON behavior_logs (studentId, type, deletedAt);

-- ─── 8. GRADES ───────────────────────────────────────────────────────────────
-- Already indexed: studentId, classId, termId

-- Student grade history (most common: student + class + term)
CREATE INDEX IF NOT EXISTS idx_grades_student_class_term
  ON grades (studentId, classId, termId, deletedAt);

-- Class grade report (teacher view: class + term + type)
CREATE INDEX IF NOT EXISTS idx_grades_class_term_type
  ON grades (classId, termId, type, deletedAt);

-- ─── 9. VOICE ROOMS ──────────────────────────────────────────────────────────
-- Already indexed: schoolId, hostId, status, privacy

-- Room list query: school + status + not deleted (most common)
CREATE INDEX IF NOT EXISTS idx_voice_rooms_school_status_deleted
  ON voice_rooms (schoolId, status, deletedAt);

-- Active rooms sorted by activity (room list default sort)
CREATE INDEX IF NOT EXISTS idx_voice_rooms_status_activity
  ON voice_rooms (status, lastActivityAt DESC);

-- ─── 10. VOICE PARTICIPANTS ──────────────────────────────────────────────────
-- Already indexed: roomId, userId, isActive, unique(roomId, userId)

-- Active speakers in a room (most frequent query)
CREATE INDEX IF NOT EXISTS idx_voice_participants_room_active_role
  ON voice_participants (roomId, isActive, role);

-- Hand queue: room + active + handRaised (queue management)
CREATE INDEX IF NOT EXISTS idx_voice_participants_room_hand
  ON voice_participants (roomId, isActive, handRaised, handRaisedAt);

-- ─── 11. VOICE MESSAGES ──────────────────────────────────────────────────────
-- Already indexed: roomId, userId

-- Chat history with cursor pagination (roomId + createdAt)
CREATE INDEX IF NOT EXISTS idx_voice_messages_room_created
  ON voice_messages (roomId, createdAt DESC);

-- ─── 12. DM CONVERSATIONS ────────────────────────────────────────────────────
-- Already indexed: userAId, userBId, lastMessageAt, unique(userAId, userBId)

-- Conversation list sorted by last message (inbox view)
CREATE INDEX IF NOT EXISTS idx_dm_conversations_userA_last
  ON dm_conversations (userAId, lastMessageAt DESC);

CREATE INDEX IF NOT EXISTS idx_dm_conversations_userB_last
  ON dm_conversations (userBId, lastMessageAt DESC);

-- ─── 13. DIRECT MESSAGES ─────────────────────────────────────────────────────
-- Already indexed: conversationId, senderId, receiverId, createdAt

-- Message thread with cursor pagination (most common)
CREATE INDEX IF NOT EXISTS idx_direct_messages_conv_created
  ON direct_messages (conversationId, createdAt DESC);

-- Unread messages for a receiver
CREATE INDEX IF NOT EXISTS idx_direct_messages_receiver_status
  ON direct_messages (receiverId, status, createdAt DESC);

-- ─── 14. GIFT TRANSACTIONS ───────────────────────────────────────────────────
-- Already indexed: roomId, senderId, receiverId, createdAt, isPremium

-- Daily leaderboard (groupBy senderId + date)
CREATE INDEX IF NOT EXISTS idx_gift_tx_sender_created
  ON gift_transactions (senderId, createdAt DESC);

-- Room leaderboard (groupBy roomId + senderId)
CREATE INDEX IF NOT EXISTS idx_gift_tx_room_sender_coins
  ON gift_transactions (roomId, senderId, coinsSpent);

-- ─── 15. WALLETS ─────────────────────────────────────────────────────────────
-- Already indexed: userId (unique)
-- No additional indexes needed — wallet is always looked up by userId

-- ─── 16. AUDIT LOGS ──────────────────────────────────────────────────────────
-- Already indexed: userId, schoolId, entity, createdAt

-- Admin audit view: school + action + date range
CREATE INDEX IF NOT EXISTS idx_audit_school_action_created
  ON audit_logs (schoolId, action, createdAt DESC);

-- Entity-specific audit trail
CREATE INDEX IF NOT EXISTS idx_audit_entity_id_created
  ON audit_logs (entity, entityId, createdAt DESC);

-- ─── 17. NOTIFICATIONS ───────────────────────────────────────────────────────
-- Already indexed: userId, isRead

-- Unread count query (most frequent)
CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created
  ON notifications (userId, isRead, createdAt DESC);

-- ─── 18. LIVE CLASSES ────────────────────────────────────────────────────────
-- Already indexed: schoolId, classId, teacherId, status, scheduledAt

CREATE INDEX IF NOT EXISTS idx_live_classes_school_status_deleted
  ON live_classes (schoolId, status, deletedAt);

-- ─── 19. LIVE CLASS PARTICIPANTS ─────────────────────────────────────────────
-- Already indexed: liveClassId, userId, isActive, unique(liveClassId, userId)

CREATE INDEX IF NOT EXISTS idx_lc_participants_class_active_role
  ON live_class_participants (liveClassId, isActive, role);

-- ─── 20. FOLLOWS ─────────────────────────────────────────────────────────────
-- Already indexed: followerId, followingId, unique(followerId, followingId)
-- No additional indexes needed

-- ─── 21. FRIEND REQUESTS ─────────────────────────────────────────────────────
-- Already indexed: senderId, receiverId, status, unique(senderId, receiverId)

-- Friends list (accepted requests for a user)
CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver_status
  ON friend_requests (receiverId, status);

-- ─── 22. TERMS ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_terms_school_current
  ON terms (schoolId, isCurrent, isActive);

-- ─── 23. FEE RECORDS ─────────────────────────────────────────────────────────
-- Already indexed: schoolId, studentId, status

CREATE INDEX IF NOT EXISTS idx_fee_records_student_status_due
  ON fee_records (studentId, status, dueDate);

-- ─── 24. VOICE HOST STATS ────────────────────────────────────────────────────
-- Already indexed: userId, date, unique(userId, date)

CREATE INDEX IF NOT EXISTS idx_voice_host_stats_date_minutes
  ON voice_host_stats (date DESC, totalMinutes DESC);

-- =============================================================================
-- VERIFY: Check which indexes exist on a table
-- SHOW INDEX FROM attendance;
-- SHOW INDEX FROM voice_participants;
-- =============================================================================
