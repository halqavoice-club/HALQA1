const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const ipAllowlist = require('../middleware/ipAllowlist');
const prisma = require('../utils/prisma');
const { paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');

// Restrict to IP allowlist before any other checks (Requirements: 10.1, 10.2)
router.use(ipAllowlist);

router.use(authenticate);
router.use(authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'));

router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 50, userId, entity, action, startDate, endDate } = req.query;
    const { skip, ...pagination } = getPagination(page, limit);
    const schoolId = req.user.schoolId;

    const where = {
      ...(schoolId && req.user.role !== 'SUPER_ADMIN' && { schoolId })
    };

    if (userId) where.userId = userId;
    if (entity) where.entity = entity;
    if (action) where.action = action;
    if (startDate && endDate) {
      where.createdAt = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { firstName: true, lastName: true, email: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pagination.limit
      }),
      prisma.auditLog.count({ where })
    ]);

    return paginatedResponse(res, logs, buildPaginationMeta(total, pagination.page, pagination.limit));
  } catch (error) { next(error); }
});

module.exports = router;
