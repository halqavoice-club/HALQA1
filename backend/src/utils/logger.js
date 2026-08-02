'use strict';

/**
 * Structured Logger — Winston
 * ─────────────────────────────────────────────────────────────────────────────
 * Development : coloured human-readable lines to console
 * Production  : JSON lines to console + rotating files
 *
 * Every log entry includes:
 *   timestamp, level, service, message
 *   + any extra fields passed as the second argument
 *
 * Usage:
 *   logger.info('Server started', { port: 5000 })
 *   logger.warn('[redis] Reconnecting', { attempt: 2 })
 *   logger.error('DB query failed', { query: '...', durationMs: 1200, err })
 * ─────────────────────────────────────────────────────────────────────────────
 */

const winston = require('winston');
const path    = require('path');
const fs      = require('fs');

const { combine, timestamp, errors, colorize, printf, json } = winston.format;

// ─── Ensure logs directory exists ────────────────────────────────────────────
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const SERVICE = process.env.SERVICE_NAME || 'halqa-api';
const IS_PROD = process.env.NODE_ENV === 'production';

// ─── Formats ─────────────────────────────────────────────────────────────────

// Development: coloured single-line format
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    const extras = Object.keys(meta).length
      ? ' ' + JSON.stringify(meta)
      : '';
    return `${ts} [${level}]: ${stack || message}${extras}`;
  })
);

// Production: JSON lines — one JSON object per log entry
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  // Inject service name into every record
  winston.format((info) => {
    info.service = SERVICE;
    return info;
  })(),
  json()
);

// ─── Transports ───────────────────────────────────────────────────────────────

const transports = [
  // Console — always on
  new winston.transports.Console({
    format: IS_PROD ? prodFormat : devFormat,
  }),
];

if (IS_PROD) {
  // Rotating file transports (production only)
  transports.push(
    new winston.transports.File({
      filename:  path.join(logsDir, 'error.log'),
      level:     'error',
      format:    prodFormat,
      maxsize:   10 * 1024 * 1024, // 10 MB
      maxFiles:  5,
      tailable:  true,
    }),
    new winston.transports.File({
      filename:  path.join(logsDir, 'combined.log'),
      format:    prodFormat,
      maxsize:   20 * 1024 * 1024, // 20 MB
      maxFiles:  7,
      tailable:  true,
    })
  );
}

// ─── Logger instance ──────────────────────────────────────────────────────────
const logger = winston.createLogger({
  level:            IS_PROD ? 'info' : 'debug',
  defaultMeta:      { service: SERVICE },
  transports,
  // Don't crash the process on uncaught logger errors
  exitOnError:      false,
  // Silence winston's own "Logging to an unconfigured transport" warnings
  silent:           false,
});

// ─── Convenience: attach requestId / userId to a child logger ─────────────────
/**
 * Create a child logger that automatically includes requestId and userId
 * in every log entry. Use this inside request handlers.
 *
 * @param {string} requestId
 * @param {string|null} userId
 * @returns {winston.Logger}
 */
logger.child = function (requestId, userId) {
  return logger.child({ requestId, ...(userId && { userId }) });
};

module.exports = logger;
