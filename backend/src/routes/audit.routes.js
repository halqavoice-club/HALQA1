'use strict';
const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { eduAdmin } = require('../middleware/educationAuth');
const ipAllowlist = require('../middleware/ipAllowlist');
const prisma = require('../utils/prisma');
const { paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');

// IP allowlist checked before any auth (Requirements: 10.1, 10.2)
router.use(ipAllowlist);
router.use(authenticate);
// Audit logs are admin-only and school-scoped
router.use(...eduAdmin);

router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 50, userId, entity, action, startDate, endDate } = req.query;
    const { skip, ...pagination } = getPagination(page, limit);
    const schoolId = req.schoolId || req.user.schoolId;

    const where = {
      // School isolation: non-SUPER_ADMIN admins only see their school's audit logs
      ...(schoolId && req.schoolMembership?.role !== 'SUPER_ADMIN' && { schoolId })
    };
    if (userId)               where.userId    = userId;
    if (entity)               where.entity    = entity;
    if (action)               where.action    = action;
    if (startDate && endDate) where.createdAt = { gte: new Date(startDate), lte: new Date(endDate) };

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
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
