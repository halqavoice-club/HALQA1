const prisma = require('../utils/prisma');
const logger = require('../utils/logger');

/**
 * Audit logging middleware factory
 */
function auditLog(action, entity) {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = async function (data) {
      // Only log successful mutations
      if (data?.success && req.user) {
        try {
          await prisma.auditLog.create({
            data: {
              userId: req.user.id,
              schoolId: req.user.schoolId,
              action,
              entity,
              entityId: data?.data?.id || req.params.id,
              newValues: ['CREATE', 'UPDATE'].includes(action) ? req.body : undefined,
              ipAddress: req.ip || req.connection.remoteAddress,
              userAgent: req.headers['user-agent']
            }
          });
        } catch (err) {
          logger.error('Audit log failed:', err);
        }
      }
      return originalJson(data);
    };

    next();
  };
}

module.exports = auditLog;
