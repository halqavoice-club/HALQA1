-- Migration: 20260821_add_attendance_school_fk
-- Adds a foreign key constraint on attendance.schoolId which currently exists
-- as a nullable column with no FK enforcement.
--
-- ON DELETE SET NULL: if a school is deleted, attendance records are retained
-- but their schoolId is cleared (soft orphan, not hard delete).
-- ON UPDATE CASCADE: if a school UUID changes, attendance is updated automatically.
--
-- Impact: safe. schoolId is already nullable. Rows with NULL schoolId are
-- unaffected. Rows with a non-NULL schoolId that references a non-existent
-- school would fail validation — run the check query below first.
--
-- Pre-flight check (run before applying to production):
--   SELECT a.id, a.schoolId
--   FROM attendance a
--   LEFT JOIN schools s ON s.id = a.schoolId
--   WHERE a.schoolId IS NOT NULL AND s.id IS NULL;
-- Expected result: 0 rows.

ALTER TABLE `attendance`
  ADD CONSTRAINT `attendance_schoolId_fkey`
  FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
