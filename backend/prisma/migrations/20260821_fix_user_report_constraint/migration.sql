-- Migration: 20260821_fix_user_report_constraint
-- Problem: user_reports has @@unique([reporterId, reportedId]) which allows
-- only ONE lifetime report per user pair. Once a report is DISMISSED, the
-- reporter cannot re-report the same user for a new incident.
--
-- Fix: Drop the over-restrictive unique constraint. Replace with an index
-- that supports the application-level guard: one PENDING report per pair
-- at a time (enforced in code, not DB).
--
-- New behavior:
--   - Multiple reports allowed per pair (one per incident)
--   - Application blocks duplicate PENDING reports (same pair + status=PENDING)
--   - Resolved/dismissed reports do not block new reports
--
-- Data impact: zero. The constraint removal does not delete or alter any rows.

ALTER TABLE `user_reports`
  DROP INDEX `user_reports_reporterId_reportedId_key`;

-- Replacement: index supporting the application-level pending check
CREATE INDEX `user_reports_reporterId_reportedId_status_idx`
  ON `user_reports` (`reporterId`, `reportedId`, `status`);
