'use strict';

const { v4: uuidv4 } = require('uuid');
const logger  = require('../utils/logger');
const metrics = require('../utils/metrics');

const IS_DEV = process.env.NODE_ENV !== 'production';

// ─── Categorise error ─────────────────────────────────────────────────────────
function categorise(err) {
  if (err.code === 'P2002') return { category: 'DB_CONSTRAINT', status: 409, message: 'A record with this data already exists', meta: { field: err.meta?.target } };
  if (err.code === 'P2025') return { category: 'DB_CONSTRAINT', status: 404, message: 'Record not found' };
  if (err.code === 'P2003') return { category: 'DB_CONSTRAINT', status: 400, message: 'Related record not found' };
  if (err.code === 'P2016') return { category: 'DB_CONSTRAINT', status: 400, message: 'Query interpretation error' };
  if (err.code?.startsWith('P'))  return { category: 'DB_CONSTRAINT', status: 500, message: 'Database error' };

  // PrismaClientValidationError — invalid query shape (missing required field, wrong type, etc.)
  if (err.name === 'PrismaClientValidationError') {
    const detail = IS_DEV ? err.message : 'Invalid database query';
    return { category: 'DB_CONSTRAINT', status: 400, message: detail };
  }
  // PrismaClientKnownRequestError not caught by code prefix above
  if (err.name === 'PrismaClientKnownRequestError') {
    return { category: 'DB_CONSTRAINT', status: 500, message: IS_DEV ? err.message : 'Database error' };
  }

  if (err.name === 'JsonWebTokenError')  return { category: 'AUTH', status: 401, message: 'Invalid token' };
  if (err.name === 'TokenExpiredError')  return { category: 'AUTH', status: 401, message: 'Token expired' };
  if (err.name === 'UnauthorizedError')  return { category: 'AUTH', status: 401, message: err.message };

  if (err.name === 'ValidationError')    return { category: 'VALIDATION', status: 400, message: err.message, meta: { errors: err.errors } };
  if (err.name === 'ZodError')           return { category: 'VALIDATION', status: 400, message: 'Validation failed', meta: { errors: err.errors } };

  if (err.code === 'LIMIT_FILE_SIZE')    return { category: 'UPLOAD', status: 413, message: 'File too large' };
  if (err.code === 'LIMIT_UNEXPECTED_FILE') return { category: 'UPLOAD', status: 400, message: 'Unexpected file field' };

  if (err.status === 429 || err.statusCode === 429) return { category: 'RATE_LIMIT', status: 429, message: err.message || 'Too many requests' };

  if (err.message?.startsWith('CORS:'))  return { category: 'AUTH', status: 403, message: err.message };

  const status = err.statusCode || err.status || 500;
  if (status === 404) return { category: 'NOT_FOUND',  status: 404, message: err.message || 'Not found' };
  if (status === 403) return { category: 'AUTH',       status: 403, message: err.message || 'Forbidden' };
  if (status === 401) return { category: 'AUTH',       status: 401, message: err.message || 'Unauthorized' };
  if (status === 400) return { category: 'VALIDATION', status: 400, message: err.message || 'Bad request' };

  return { category: 'INTERNAL', status: 500, message: IS_DEV ? err.message : 'Internal server error' };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const errorId = uuidv4();
  const { category, status, message, meta } = categorise(err);

  res.locals.errorCategory = category;

  metrics.increment('errorsTotal');
  metrics.increment('requestsServerErr');
  metrics.recordError();

  const logEntry = {
    errorId,
    category,
    status,
    method:    req.method,
    path:      req.path,
    userId:    req.user?.id ?? null,
    requestId: req.requestId ?? null,
    ip:        req.ip,
    // SEC-002: Never log raw request body in error handler — it may contain
    // passwords or tokens. The requestLogger already handles redacted body logging.
    ...(IS_DEV && err.stack && { stack: err.stack }),
    ...(meta && { meta }),
  };

  if (status >= 500) {
    logger.error(`[error] ${category}: ${err.message}`, logEntry);

    // ── Alert on 5xx errors in production ───────────────────────────────────
    if (!IS_DEV) {
      try {
        const { alertCritical } = require('../utils/alerting');
        alertCritical(`5xx Error: ${message}`, {
          errorId,
          path: req.path,
          method: req.method,
          userId: req.user?.id,
          category,
        }).catch(() => {}); // fire-and-forget, never block response
      } catch {} // alerting module not available — safe to ignore
    }
  } else if (status >= 400) {
    logger.warn(`[error] ${category}: ${message}`, logEntry);
  }

  if (res.headersSent) return;

  res.status(status).json({
    success:  false,
    message,
    errorId,
    ...(meta && { details: meta }),
    ...(IS_DEV && err.stack && { stack: err.stack }),
  });
}

module.exports = errorHandler;
