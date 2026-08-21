'use strict';
/**
 * Jest global setup — runs before every test file.
 * Sets minimum environment variables needed for the server code to boot
 * without a real database, Redis, or Stripe connection.
 */

// ─── JWT ──────────────────────────────────────────────────────────────────────
process.env.JWT_SECRET          = 'test_jwt_secret_at_least_32_characters_long!!';
process.env.JWT_REFRESH_SECRET  = 'test_refresh_secret_at_least_32_chars_long!!';
process.env.JWT_EXPIRES_IN      = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

// ─── App ──────────────────────────────────────────────────────────────────────
process.env.PORT                = '5001';
process.env.NODE_ENV            = 'test';
process.env.SERVICE_NAME        = 'halqa-test';

// ─── Database ─────────────────────────────────────────────────────────────────
// Don't override DATABASE_URL if already set by the caller (e.g. integration
// tests running against XAMPP/halqa_db). Unit tests don't hit the DB at all.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'mysql://root:@localhost:3306/halqa_db';
}

// ─── Redis (disabled in unit tests — mocked) ──────────────────────────────────
// No REDIS_URL set → isRedisReady() returns false → fail-open mode

// ─── Stripe (disabled — no real Stripe calls in unit tests) ───────────────────
// Tests that need Stripe configured set STRIPE_SECRET_KEY themselves
// M-9 FIX: Explicitly enable signature bypass for tests (replaces NODE_ENV check).
// This is safe because NODE_ENV=test is already set above and this var is
// only respected when NODE_ENV !== 'production'.
process.env.STRIPE_SKIP_SIGNATURE = 'true';

// ─── LiveKit ──────────────────────────────────────────────────────────────────
process.env.LIVEKIT_URL         = 'wss://test.livekit.cloud';
process.env.LIVEKIT_API_KEY     = 'test_key';
process.env.LIVEKIT_API_SECRET  = 'test_secret';

// ─── Email (mocked in tests) ──────────────────────────────────────────────────
process.env.SMTP_HOST           = 'smtp.test.local';
process.env.SMTP_USER           = 'test@halqa.app';
process.env.SMTP_PASS           = 'test_pass';
process.env.EMAIL_FROM          = 'noreply@halqa.app';

// ─── Storage ──────────────────────────────────────────────────────────────────
process.env.STORAGE_TYPE        = 'local';

// ─── Metrics token ────────────────────────────────────────────────────────────
process.env.METRICS_TOKEN       = 'test_metrics_token_32_chars_min_!!';

// ─── Client URL ──────────────────────────────────────────────────────────────
process.env.CLIENT_URL          = 'http://localhost:3000';
