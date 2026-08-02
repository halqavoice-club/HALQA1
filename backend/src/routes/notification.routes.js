const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const prisma = require('../utils/prisma');
const { successResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');

router.use(authenticate);

// ── List notifications ────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, unreadOnly } = req.query;
    const { skip, ...pagination } = getPagination(page, limit);

    const where = { userId: req.user.id };
    if (unreadOnly === 'true') where.isRead = false;

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pagination.limit
      }),
      prisma.notification.count({ where })
    ]);

    return paginatedResponse(res, notifications, buildPaginationMeta(total, pagination.page, pagination.limit));
  } catch (error) { next(error); }
});

// ── IMPORTANT: static routes MUST come before /:id routes ────────────────────

// Unread count
router.get('/unread-count', async (req, res, next) => {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.user.id, isRead: false }
    });
    return successResponse(res, { count });
  } catch (error) { next(error); }
});

// Mark ALL as read — must be before /:id/read or Express matches "read-all" as :id
router.put('/read-all', async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, isRead: false },
      data: { isRead: true, readAt: new Date() }
    });
    return successResponse(res, null, 'All notifications marked as read');
  } catch (error) { next(error); }
});

// Mark one as read
router.put('/:id/read', async (req, res, next) => {
  try {
    await prisma.notification.update({
      where: { id: req.params.id, userId: req.user.id },
      data: { isRead: true, readAt: new Date() }
    });
    return successResponse(res, null, 'Notification marked as read');
  } catch (error) { next(error); }
});

module.exports = router;
