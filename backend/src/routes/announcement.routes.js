'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const { eduMember, eduStaff } = require('../middleware/educationAuth');
const prisma = require('../utils/prisma');
const { successResponse, errorResponse } = require('../utils/response');
const { notifySchool } = require('../services/notification.service');

router.use(authenticate);

// List announcements — any active school member sees their school's announcements
router.get('/', ...eduMember, async (req, res, next) => {
  try {
    const now = new Date();
    // Use req.schoolId (set by requireSchoolMember) — school-scoped, not user.schoolId
    const schoolId = req.schoolId || req.user.schoolId;
    const where = {
      deletedAt: null,
      publishAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      ...(schoolId && { schoolId })
    };

    const announcements = await prisma.announcement.findMany({
      where,
      orderBy: [{ isPinned: 'desc' }, { publishAt: 'desc' }]
    });
    return successResponse(res, announcements);
  } catch (error) { next(error); }
});

// Create announcement — staff only
router.post('/',
  ...eduStaff,
  [body('title').trim().notEmpty(), body('content').trim().notEmpty()],
  validate,
  async (req, res, next) => {
    try {
      const { title, content, targetRoles, isPinned, expiresAt } = req.body;
      const schoolId = req.schoolId || req.user.schoolId;
      if (!schoolId) return errorResponse(res, 'School context required', 400);

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

      const roles = targetRoles?.length > 0 ? targetRoles : ['TEACHER', 'STUDENT', 'GUARDIAN'];
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

// Update — staff; teacher can only update own announcements
router.put('/:id',
  ...eduStaff,
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
      const existing = await prisma.announcement.findUnique({ where: { id: req.params.id } });
      if (!existing) return errorResponse(res, 'Announcement not found', 404);
      // School isolation: ensure announcement belongs to same school
      const schoolId = req.schoolId || req.user.schoolId;
      if (existing.schoolId !== schoolId && req.schoolMembership?.role !== 'SUPER_ADMIN') {
        return errorResponse(res, 'Access denied to this announcement', 403);
      }
      // Teachers can only edit their own announcements
      if (req.schoolMembership?.role === 'TEACHER' && existing.authorId !== req.user.id) {
        return errorResponse(res, 'You can only update your own announcements', 403);
      }

      const { title, content, isPinned, expiresAt, targetRoles } = req.body;
      const data = {};
      if (title       !== undefined) data.title       = title;
      if (content     !== undefined) data.content     = content;
      if (isPinned    !== undefined) data.isPinned    = Boolean(isPinned);
      if (expiresAt   !== undefined) data.expiresAt   = expiresAt ? new Date(expiresAt) : null;
      if (targetRoles !== undefined) data.targetRoles = targetRoles || [];

      const announcement = await prisma.announcement.update({ where: { id: req.params.id }, data });
      return successResponse(res, announcement, 'Announcement updated');
    } catch (error) { next(error); }
  }
);

// Delete — staff
router.delete('/:id', ...eduStaff, async (req, res, next) => {
  try {
    await prisma.announcement.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    return successResponse(res, null, 'Announcement deleted');
  } catch (error) { next(error); }
});

module.exports = router;
