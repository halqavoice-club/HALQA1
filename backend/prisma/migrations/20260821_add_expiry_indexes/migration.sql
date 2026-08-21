-- Migration: 20260821_add_expiry_indexes
-- Adds indexes on expiry-related columns to prevent full table scans during:
--   1. Scheduled cleanup jobs (expired tokens, OTPs, subscriptions, sessions)
--   2. Auth lookups (check if token is revoked or expired)
--
-- These tables grow continuously and without indexes, nightly cleanup queries
-- will perform full scans — O(N) growing to minutes on large datasets.

-- ─── refresh_tokens ──────────────────────────────────────────────────────────
-- Used by: scheduled cleanup (DELETE WHERE expiresAt < NOW())
-- Used by: token validation (WHERE token = ? AND isRevoked = false AND expiresAt > NOW())
CREATE INDEX `refresh_tokens_expiresAt_idx`
  ON `refresh_tokens` (`expiresAt`);

CREATE INDEX `refresh_tokens_isRevoked_idx`
  ON `refresh_tokens` (`isRevoked`);

-- ─── otp_codes ───────────────────────────────────────────────────────────────
-- Used by: OTP verification (WHERE userId=? AND type=? AND isUsed=false AND expiresAt > NOW())
-- Used by: cleanup (DELETE WHERE expiresAt < NOW())
CREATE INDEX `otp_codes_expiresAt_idx`
  ON `otp_codes` (`expiresAt`);

CREATE INDEX `otp_codes_isUsed_idx`
  ON `otp_codes` (`isUsed`);

-- Composite: most common OTP lookup pattern
CREATE INDEX `otp_codes_userId_type_isUsed_idx`
  ON `otp_codes` (`userId`, `type`, `isUsed`);

-- ─── creator_subscriptions ───────────────────────────────────────────────────
-- Used by: renewal job (WHERE expiresAt <= NOW() AND status = 'ACTIVE')
CREATE INDEX `creator_subscriptions_expiresAt_status_idx`
  ON `creator_subscriptions` (`expiresAt`, `status`);

-- ─── sessions ────────────────────────────────────────────────────────────────
-- Used by: session cleanup (WHERE isActive=true AND lastSeenAt < cutoff)
-- Used by: session limit enforcement (WHERE userId=? AND isActive=true ORDER BY lastSeenAt)
CREATE INDEX `sessions_lastSeenAt_isActive_idx`
  ON `sessions` (`lastSeenAt`, `isActive`);

-- ─── pk_invitations ──────────────────────────────────────────────────────────
-- Used by: invitation expiry cleanup (WHERE expiresAt < NOW() AND status='PENDING')
CREATE INDEX `pk_invitations_receiverId_status_idx`
  ON `pk_invitations` (`receiverId`, `status`);

-- ─── library_issues ──────────────────────────────────────────────────────────
-- Used by: overdue book detection + dedup guard
CREATE INDEX `library_issues_bookId_studentId_status_idx`
  ON `library_issues` (`bookId`, `studentId`, `status`);
