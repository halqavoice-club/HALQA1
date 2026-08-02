const rateLimit = require('express-rate-limit');

const isDev = process.env.NODE_ENV !== 'production';

// ─── Global rate limiter ──────────────────────────────────────────────────────
// Applied to all routes. Skips /health only.
// Previously skipped ALL routes in development — this made it impossible to catch
// rate-limit related bugs before production. Now active in both environments,
// but with a much higher limit in development for convenience.
const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 min
  max: isDev
    ? 10000  // dev: effectively unlimited (10k/15min) but limiter IS active
    : parseInt(process.env.RATE_LIMIT_MAX || '100'),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later'
  },
  skip: (req) => req.path === '/health'
});

// ─── Auth endpoints limiter (login, register, forgot-password) ────────────────
// Strict limit to prevent brute-force credential attacks.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again in 15 minutes'
  }
});

// ─── Refresh token limiter ─────────────────────────────────────────────────────
// SECURITY FIX: Previously /auth/refresh had NO rate limiter — an attacker with
// a stolen refresh token could hammer the endpoint indefinitely.
// Limit: 30 refreshes per 15 minutes per IP. A legitimate client refreshes once
// every 15 minutes (access token TTL), so 30 is generous while blocking abuse.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 1000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many token refresh attempts, please try again later'
  }
});

// ─── OTP / verify limiter ──────────────────────────────────────────────────────
// Prevents brute-forcing 6-digit OTP codes.
// 10 attempts per 10 minutes per IP.
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: isDev ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many verification attempts, please try again in 10 minutes'
  }
});

module.exports = rateLimiter;
module.exports.authLimiter    = authLimiter;
module.exports.refreshLimiter = refreshLimiter;
module.exports.otpLimiter     = otpLimiter;
