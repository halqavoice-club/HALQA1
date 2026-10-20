/**
 * CSRF protection for cookie-consuming endpoints.
 *
 * Applies to: POST /auth/refresh, POST /auth/logout
 *
 * Strategy: Origin header check (same-origin enforcement).
 * These endpoints read the httpOnly refreshToken cookie. A cross-site
 * request from a malicious page would carry the cookie automatically,
 * but it cannot set a matching Origin header.
 *
 * Rules:
 *   1. If the Origin header is present and matches CLIENT_URL → allow.
 *   2. If Origin is absent (same-origin requests from some browsers,
 *      server-to-server calls, curl) → allow with warning in dev.
 *   3. If Origin is present but does NOT match → reject 403.
 *
 * sameSite: strict on the refreshToken cookie already blocks most CSRF in
 * modern browsers, but this adds defense-in-depth for older browsers and
 * any future cookie that might drop the strict setting.
 */

const logger = require('../utils/logger');

const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim().replace(/\/$/, '')); // normalise trailing slashes

function csrfProtect(req, res, next) {
  const origin = req.headers.origin;

  if (!origin) {
    // No Origin header — typically same-origin, curl, or server-to-server.
    // Allow but log in dev so we can investigate if this is unexpected.
    if (process.env.NODE_ENV !== 'production') {
      logger.debug(`[csrf] No Origin header on ${req.method} ${req.path} — allowing`);
    }
    return next();
  }

  const normOrigin = origin.replace(/\/$/, '');
  if (allowedOrigins.includes(normOrigin)) {
    return next();
  }

  logger.warn(`[csrf] Blocked cross-origin request: Origin="${origin}" not in allowlist`);
  return res.status(403).json({
    success: false,
    error: { code: 'CSRF_001', message: 'Cross-origin request blocked', statusCode: 403 }
  });
}

module.exports = { csrfProtect };
