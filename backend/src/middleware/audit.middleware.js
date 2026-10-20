const prisma = require('../utils/prisma');
const logger = require('../utils/logger');

/**
 * Audit logging middleware factory.
 *
 * Usage: add auditLog('CREATE', 'students') before the controller in any route.
 *
 * Fires AFTER the controller responds (response interceptor pattern).
 * Only logs when the response was successful (data.success === true).
 *
 * School ID resolution (in priority order):
 *   1. req.schoolId  — set by requireSchoolMember() from SchoolMembership table (new arch)
 *   2. req.user.schoolId — legacy single-school field on User (old arch)
 *
 * Both paths are always tried so legacy and new-arch users are audited correctly.
 */
function auditLog(action, entity) {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = async function (data) {
      // Only log successful mutations performed by an authenticated user
      if (data?.success && req.user) {
        // Use school-scoped ID from middleware first, fall back to legacy field
        const schoolId = req.schoolId || req.user.schoolId || null;

        try {
          await prisma.auditLog.create({
            data: {
              userId:    req.user.id,
              schoolId,
              action,
              entity,
              entityId:  data?.data?.id || req.params.id || req.params.classId || null,
              newValues: ['CREATE', 'UPDATE'].includes(action) ? sanitizeBody(req.body) : undefined,
              ipAddress: req.ip || req.connection?.remoteAddress || null,
              userAgent: req.headers['user-agent'] || null,
            }
          });
        } catch (err) {
          // Audit failures must never break the actual request
          logger.error('[audit] Failed to write audit log:', err.message);
        }
      }
      return originalJson(data);
    };

    next();
  };
}

/**
 * Remove sensitive fields from the request body before storing in audit log.
 * Passwords, tokens, and secrets must never appear in audit records.
 */
function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return body;
  const REDACTED_KEYS = new Set(['password', 'passwordHash', 'token', 'refreshToken', 'secret', 'otp', 'code', 'creditCard']);
  const sanitized = {};
  for (const [key, value] of Object.entries(body)) {
    sanitized[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : value;
  }
  return sanitized;
}

module.exports = auditLog;
