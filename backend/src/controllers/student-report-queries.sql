-- ============================================================
-- HALQA MANAGEMENT SYSTEM
-- Student Attendance Report — Raw MySQL Queries
-- ============================================================
-- These are the equivalent raw SQL queries for the Prisma ORM
-- calls used in student-report.controller.js
-- ============================================================


-- ─── 1. STUDENT SUMMARY ──────────────────────────────────────────────────────

-- Get student info with school and enrollments
SELECT
  s.id,
  s.studentId,
  s.qrCode,
  s.enrollmentDate,
  u.firstName,
  u.lastName,
  u.email,
  u.avatarUrl,
  sc.name AS schoolName
FROM students s
JOIN users u ON s.userId = u.id
JOIN schools sc ON s.schoolId = sc.id
WHERE s.id = :studentId
  AND s.deletedAt IS NULL;

-- Get enrolled classes for student
SELECT
  c.id,
  c.name
FROM enrollments e
JOIN classes c ON e.classId = c.id
WHERE e.studentId = :studentId
  AND e.isActive = 1;

-- Attendance counts grouped by status
SELECT
  status,
  COUNT(*) AS count
FROM attendance
WHERE studentId = :studentId
  -- Optional date range filter:
  -- AND date >= :startDate AND date <= :endDate
  -- Optional class filter:
  -- AND classId = :classId
GROUP BY status;

-- Current present streak (consecutive present days from today backwards)
SELECT
  date,
  status
FROM attendance
WHERE studentId = :studentId
ORDER BY date DESC
LIMIT 10;


-- ─── 2. DAILY HISTORY ────────────────────────────────────────────────────────

-- Paginated attendance history with class and teacher info
SELECT
  a.id,
  a.date,
  a.status,
  a.checkInTime,
  a.checkOutTime,
  a.checkInMethod,
  a.notes,
  c.name AS className,
  CONCAT(u.firstName, ' ', u.lastName) AS markedBy
FROM attendance a
LEFT JOIN classes c ON a.classId = c.id
LEFT JOIN teachers t ON a.teacherId = t.id
LEFT JOIN users u ON t.userId = u.id
WHERE a.studentId = :studentId
  -- Optional filters:
  -- AND a.status = :status
  -- AND a.date >= :startDate AND a.date <= :endDate
  -- AND a.classId = :classId
ORDER BY a.date DESC
LIMIT :limit OFFSET :offset;

-- Count total records for pagination
SELECT COUNT(*) AS total
FROM attendance
WHERE studentId = :studentId
  -- Same optional filters as above
;


-- ─── 3. MONTHLY CALENDAR ─────────────────────────────────────────────────────

-- Get all attendance records for a specific month
SELECT
  a.id,
  a.date,
  a.status,
  a.checkInTime,
  a.checkOutTime,
  a.notes,
  c.name AS className
FROM attendance a
LEFT JOIN classes c ON a.classId = c.id
WHERE a.studentId = :studentId
  AND a.date >= :monthStart    -- e.g., '2026-04-01'
  AND a.date <= :monthEnd      -- e.g., '2026-04-30'
ORDER BY a.date ASC;

-- Monthly stats summary
SELECT
  status,
  COUNT(*) AS count
FROM attendance
WHERE studentId = :studentId
  AND date >= :monthStart
  AND date <= :monthEnd
GROUP BY status;


-- ─── 4. EXPORT QUERIES ───────────────────────────────────────────────────────

-- Full attendance export (CSV / Excel / PDF)
SELECT
  a.date,
  DAYNAME(a.date) AS dayOfWeek,
  a.status,
  a.checkInTime,
  a.checkOutTime,
  a.checkInMethod,
  a.notes,
  c.name AS className,
  CONCAT(u.firstName, ' ', u.lastName) AS studentName,
  s.studentId AS studentCode,
  sc.name AS schoolName
FROM attendance a
JOIN students s ON a.studentId = s.id
JOIN users u ON s.userId = u.id
JOIN schools sc ON s.schoolId = sc.id
LEFT JOIN classes c ON a.classId = c.id
WHERE a.studentId = :studentId
  -- Optional date range:
  -- AND a.date >= :startDate AND a.date <= :endDate
ORDER BY a.date ASC;

-- Summary stats for export header
SELECT
  COUNT(*) AS totalDays,
  SUM(CASE WHEN status = 'PRESENT'    THEN 1 ELSE 0 END) AS presentCount,
  SUM(CASE WHEN status = 'ABSENT'     THEN 1 ELSE 0 END) AS absentCount,
  SUM(CASE WHEN status = 'LATE'       THEN 1 ELSE 0 END) AS lateCount,
  SUM(CASE WHEN status = 'EXCUSED'    THEN 1 ELSE 0 END) AS excusedCount,
  SUM(CASE WHEN status = 'LEFT_EARLY' THEN 1 ELSE 0 END) AS leftEarlyCount,
  ROUND(
    (SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) +
     SUM(CASE WHEN status = 'LATE'    THEN 0.5 ELSE 0 END))
    / COUNT(*) * 100
  , 0) AS attendancePercentage
FROM attendance
WHERE studentId = :studentId;


-- ─── 5. ANALYTICS QUERIES ────────────────────────────────────────────────────

-- Weekly attendance trend (last 8 weeks)
SELECT
  YEARWEEK(date, 1) AS weekKey,
  MIN(date) AS weekStart,
  COUNT(*) AS totalDays,
  SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) AS presentDays,
  ROUND(
    SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) / COUNT(*) * 100
  , 0) AS weeklyRate
FROM attendance
WHERE studentId = :studentId
  AND date >= DATE_SUB(CURDATE(), INTERVAL 8 WEEK)
GROUP BY YEARWEEK(date, 1)
ORDER BY weekKey ASC;

-- Monthly attendance trend (last 6 months)
SELECT
  DATE_FORMAT(date, '%Y-%m') AS month,
  COUNT(*) AS totalDays,
  SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) AS presentDays,
  ROUND(
    SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) / COUNT(*) * 100
  , 0) AS monthlyRate
FROM attendance
WHERE studentId = :studentId
  AND date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
GROUP BY DATE_FORMAT(date, '%Y-%m')
ORDER BY month ASC;

-- Absence pattern by day of week
SELECT
  DAYNAME(date) AS dayName,
  DAYOFWEEK(date) AS dayNum,
  COUNT(*) AS totalDays,
  SUM(CASE WHEN status = 'ABSENT' THEN 1 ELSE 0 END) AS absentDays,
  ROUND(
    SUM(CASE WHEN status = 'ABSENT' THEN 1 ELSE 0 END) / COUNT(*) * 100
  , 0) AS absenceRate
FROM attendance
WHERE studentId = :studentId
GROUP BY DAYNAME(date), DAYOFWEEK(date)
ORDER BY dayNum ASC;

-- Consecutive absence streaks
SELECT
  date,
  status,
  @streak := IF(status = 'ABSENT', @streak + 1, 0) AS absenceStreak
FROM attendance,
  (SELECT @streak := 0) AS init
WHERE studentId = :studentId
ORDER BY date ASC;


-- ─── 6. CLASS-LEVEL QUERIES ──────────────────────────────────────────────────

-- All students attendance summary for a class on a date
SELECT
  s.id AS studentId,
  s.studentId AS studentCode,
  CONCAT(u.firstName, ' ', u.lastName) AS studentName,
  a.status,
  a.checkInTime,
  a.checkOutTime,
  a.notes
FROM enrollments e
JOIN students s ON e.studentId = s.id
JOIN users u ON s.userId = u.id
LEFT JOIN attendance a ON a.studentId = s.id
  AND a.classId = :classId
  AND a.date = :date
WHERE e.classId = :classId
  AND e.isActive = 1
ORDER BY u.firstName ASC;

-- Class attendance rate for a date range
SELECT
  DATE(a.date) AS attendanceDate,
  COUNT(DISTINCT a.studentId) AS markedStudents,
  SUM(CASE WHEN a.status = 'PRESENT' THEN 1 ELSE 0 END) AS presentCount,
  ROUND(
    SUM(CASE WHEN a.status = 'PRESENT' THEN 1 ELSE 0 END) /
    COUNT(DISTINCT a.studentId) * 100
  , 0) AS dailyRate
FROM attendance a
WHERE a.classId = :classId
  AND a.date >= :startDate
  AND a.date <= :endDate
GROUP BY DATE(a.date)
ORDER BY attendanceDate ASC;
