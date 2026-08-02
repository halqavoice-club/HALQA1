const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const prisma = require('../utils/prisma');
const { successResponse, errorResponse } = require('../utils/response');
const { notifySchool } = require('../services/notification.service');

router.use(authenticate);

// List announcements for current school
router.get('/', async (req, res, next) => {
  try {
    const now = new Date();
    // SUPER_ADMIN sees all announcements across all schools;
    // all other roles are scoped to their own school.
    // Guard: if non-super-admin has no schoolId (shouldn't happen but be safe)
    const where = {
      deletedAt: null,
      publishAt: { lte: now },
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } }
      ]
    };
    if (req.user.role !== 'SUPER_ADMIN') {
      if (!req.user.schoolId) return successResponse(res, []);
      where.schoolId = req.user.schoolId;
    }

    const announcements = await prisma.announcement.findMany({
      where,
      orderBy: [{ isPinned: 'desc' }, { publishAt: 'desc' }]
    });

    return successResponse(res, announcements);
  } catch (error) { next(error); }
});

// Create announcement
router.post('/',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  [
    body('title').trim().notEmpty(),
    body('content').trim().notEmpty()
  ],
  validate,
  async (req, res, next) => {
    try {
      const { title, content, targetRoles, isPinned, expiresAt } = req.body;
      // SUPER_ADMIN may pass schoolId in body; other roles use their own schoolId
      const schoolId = req.user.role === 'SUPER_ADMIN'
        ? (req.body.schoolId || req.user.schoolId)
        : req.user.schoolId;
      if (!schoolId) return errorResponse(res, 'schoolId required for SUPER_ADMIN', 400);

      const announcement = await prisma.announcement.create({
        data: {
          schoolId,
          authorId: req.user.id,
          title,
          content,
          targetRoles: targetRoles || [],
          isPinned: isPinned || false,
          expiresAt: expiresAt ? new Date(expiresAt) : null
        }
      });

      // Notify target roles
      const roles = targetRoles?.length > 0
        ? targetRoles
        : ['TEACHER', 'STUDENT', 'GUARDIAN'];

      await notifySchool(schoolId, roles, {
        type: 'ANNOUNCEMENT',
        title: `📢 ${title}`,
        body: content.substring(0, 120),
        data: { announcementId: announcement.id }
      });

      return successResponse(res, announcement, 'Announcement published', 201);
    } catch (error) { next(error); }
  }
);

// Update announcement
router.put('/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  [
    body('title').optional().trim().notEmpty(),
    body('content').optional().trim().notEmpty(),
    body('isPinned').optional().isBoolean(),
    body('expiresAt').optional().isISO8601(),
    body('targetRoles').optional().isArray()
  ],
  validate,
  async (req, res, next) => {
    try {
      // Ownership check: only the author or admin can update
      const existing = await prisma.announcement.findUnique({ where: { id: req.params.id } });
      if (!existing) return errorResponse(res, 'Announcement not found', 404);
      if (
        req.user.role === 'TEACHER' &&
        existing.authorId !== req.user.id
      ) {
        return errorResponse(res, 'You can only update your own announcements', 403);
      }

      // Explicit field extraction — prevents mass assignment of authorId, schoolId, deletedAt
      const { title, content, isPinned, expiresAt, targetRoles } = req.body;
      const data = {};
      if (title       !== undefined) data.title       = title;
      if (content     !== undefined) data.content     = content;
      if (isPinned    !== undefined) data.isPinned    = Boolean(isPinned);
      if (expiresAt   !== undefined) data.expiresAt   = expiresAt ? new Date(expiresAt) : null;
      if (targetRoles !== undefined) data.targetRoles = targetRoles || [];

      const announcement = await prisma.announcement.update({
        where: { id: req.params.id },
        data
      });
      return successResponse(res, announcement, 'Announcement updated');
    } catch (error) { next(error); }
  }
);

// Delete announcement
router.delete('/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  async (req, res, next) => {
    try {
      await prisma.announcement.update({
        where: { id: req.params.id },
        data: { deletedAt: new Date() }
      });
      return successResponse(res, null, 'Announcement deleted');
    } catch (error) { next(error); }
  }
);

module.exports = router;
