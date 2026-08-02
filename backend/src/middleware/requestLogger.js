'use strict';

/**
 * Request Logger Middleware
 * ─────────────────────────────────────────────────────────────────────────────
 * Records every HTTP request to:
 *   1. Structured JSON log (Winston)
 *   2. In-memory metrics (metrics.js) — for /health/metrics JSON endpoint
 *   3. Prometheus metrics (prometheus.js) — for /metrics Prometheus endpoint
 *
 * Both metric systems are updated in the same `res.on('finish')` callback
 * so there is exactly one timing measurement per request.
 *
 * Paths excluded from logging (too noisy):
 *   /health, /health/detailed, /metrics, /favicon.ico
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { v4: uuidv4 } = require('uuid');
const logger  = require('../utils/logger');
const metrics = require('../utils/metrics');
const prom    = require('../utils/prometheus');

const SLOW_REQUEST_MS = parseInt(process.env.SLOW_REQUEST_MS || '500', 10);

// Paths excluded from logging
const SKIP_PATHS = new Set([
  '/health', '/health/detailed', '/health/metrics',
  '/metrics', '/favicon.ico',
]);

// ─── Sensitive field names — values are redacted in logs ─────────────────────
// SEC-002: Request bodies containing these keys are logged with [REDACTED]
// so that passwords, OTPs, and tokens never appear in log files.
const SENSITIVE_FIELDS = new Set([
  'password', 'newPassword', 'currentPassword', 'confirmPassword',
  'otp', 'code', 'token', 'refreshToken', 'accessToken',
  'secret', 'apiKey', 'api_key', 'Authorization', 'authorization',
  'passwordHash', 'cvv', 'cardNumber', 'card_number',
]);

/**
 * Normalise dynamic path segments so metrics group correctly.
 * /api/v1/students/abc-123/grades → /api/v1/students/:id/grades
 * /api/v1/voice/rooms/42          → /api/v1/voice/rooms/:id
 */
function normalisePath(rawPath) {
  return rawPath
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:id');
}

/**
 * Recursively redact sensitive keys in an object for safe logging.
 * Returns a new object — does NOT mutate the original.
 * @param {object} obj
 * @returns {object}
 */
function redactSensitive(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.has(k)) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redactSensitive(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function requestLogger(req, res, next) {
  if (SKIP_PATHS.has(req.path)) return next();

  // Attach a unique request ID for log correlation
  const requestId = uuidv4();
  req.requestId   = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startedAt = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const status     = res.statusCode;
    const userId     = req.user?.id ?? null;
    const normPath   = normalisePath(req.path);
    const isSlow     = durationMs > SLOW_REQUEST_MS;

    // ── 1. In-memory metrics (metrics.js) ────────────────────────────────────
    metrics.recordRequest();
    metrics.recordEndpoint(req.method, normPath, durationMs, status);
    metrics.increment('requestsTotal');
    if (status >= 500)      metrics.increment('requestsServerErr');
    else if (status >= 400) metrics.increment('requestsClientErr');
    else                    metrics.increment('requestsSuccess');
    if (userId) metrics.recordActiveUser(userId);

    // ── 2. Prometheus metrics ─────────────────────────────────────────────────
    const labels = {
      method:      req.method,
      route:       normPath,
      status_code: String(status),
    };

    prom.httpRequestsTotal.inc(labels);
    prom.httpRequestDurationMs.observe(labels, durationMs);

    if (status >= 400) {
      // category is set by errorHandler; fall back to generic
      const category = res.locals.errorCategory || (status >= 500 ? 'INTERNAL' : 'CLIENT');
      prom.httpErrorsTotal.inc({ ...labels, category });
    }

    // ── 3. Structured log ─────────────────────────────────────────────────────
    const IS_DEV = process.env.NODE_ENV !== 'production';
    const entry = {
      requestId,
      method:    req.method,
      path:      normPath,
      status,
      durationMs,
      userId,
      ip:        req.ip || req.socket?.remoteAddress,
      userAgent: (req.headers['user-agent'] || '').slice(0, 100),
      // SEC-002: In development, log a redacted body snapshot for debugging.
      // In production, body is never logged to prevent credential exposure.
      ...(IS_DEV && req.body && typeof req.body === 'object' && {
        body: redactSensitive(req.body)
      }),
      ...(isSlow && { slow: true }),
    };

    if (status >= 500)  logger.error('[http] Server error', entry);
    else if (isSlow)    logger.warn('[http] Slow request', entry);
    else if (status >= 400) logger.warn('[http] Client error', entry);
    else                logger.info('[http]', entry);
  });

  next();
}

module.exports = requestLogger;
