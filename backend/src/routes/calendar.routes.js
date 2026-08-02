const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const prisma = require('../utils/prisma');
const { successResponse, errorResponse } = require('../utils/response');

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const { startDate, endDate, classId } = req.query;
    const schoolId = req.user.schoolId;

    const where = {
      deletedAt: null,
      ...(schoolId && { schoolId })
    };

    if (startDate && endDate) {
      where.startDate = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    if (classId) where.classId = classId;

    const events = await prisma.calendarEvent.findMany({
      where,
      orderBy: { startDate: 'asc' }
    });

    return successResponse(res, events, 'Events fetched');
  } catch (error) { next(error); }
});

router.post('/',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  [
    body('title').trim().notEmpty(),
    body('type').isIn(['EXAM', 'ASSIGNMENT', 'HOLIDAY', 'MEETING', 'CLASS', 'PRAYER', 'ACTIVITY', 'OTHER']),
    body('startDate').notEmpty()
  ],
  validate,
  async (req, res, next) => {
    try {
      const schoolId = req.user.schoolId || req.body.schoolId;

      // Normalize dates — datetime-local sends "2026-04-18T14:00" without Z
      const parseDate = (val) => {
        if (!val) return null;
        // If missing timezone suffix, treat as local and append Z for UTC
        const s = String(val);
        return new Date(s.includes('Z') || s.includes('+') ? s : s + ':00.000Z');
      };

      const { title, type, description, allDay, startDate, endDate } = req.body;

      const event = await prisma.calendarEvent.create({
        data: {
          title,
          type,
          description: description || null,
          allDay: allDay ?? true,
          startDate: parseDate(startDate),
          endDate: endDate ? parseDate(endDate) : parseDate(startDate),
          schoolId,
          createdBy: req.user.id
        }
      });
      return successResponse(res, event, 'Event created', 201);
    } catch (error) { next(error); }
  }
);

router.put('/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  [
    body('title').optional().trim().notEmpty(),
    body('type').optional().isIn(['EXAM', 'ASSIGNMENT', 'HOLIDAY', 'MEETING', 'CLASS', 'PRAYER', 'ACTIVITY', 'OTHER']),
    body('startDate').optional().notEmpty(),
    body('endDate').optional(),
    body('allDay').optional().isBoolean(),
    body('description').optional().isString(),
    body('location').optional().isString(),
    body('color').optional().isString(),
    body('isPublic').optional().isBoolean(),
  ],
  validate,
  async (req, res, next) => {
    try {
      // Explicit field extraction — prevents mass assignment of schoolId, createdBy, deletedAt
      const { title, type, description, allDay, startDate, endDate, location, color, isPublic } = req.body;

      const parseDate = (val) => {
        if (!val) return null;
        const s = String(val);
        return new Date(s.includes('Z') || s.includes('+') ? s : s + ':00.000Z');
      };

      const data = {};
      if (title       !== undefined) data.title       = title;
      if (type        !== undefined) data.type        = type;
      if (description !== undefined) data.description = description || null;
      if (allDay      !== undefined) data.allDay      = Boolean(allDay);
      if (startDate   !== undefined) data.startDate   = parseDate(startDate);
      if (endDate     !== undefined) data.endDate     = endDate ? parseDate(endDate) : null;
      if (location    !== undefined) data.location    = location || null;
      if (color       !== undefined) data.color       = color    || null;
      if (isPublic    !== undefined) data.isPublic    = Boolean(isPublic);

      const event = await prisma.calendarEvent.update({
        where: { id: req.params.id },
        data
      });
      return successResponse(res, event, 'Event updated');
    } catch (error) { next(error); }
  }
);

router.delete('/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  async (req, res, next) => {
    try {
      await prisma.calendarEvent.update({
        where: { id: req.params.id },
        data: { deletedAt: new Date() }
      });
      return successResponse(res, null, 'Event deleted');
    } catch (error) { next(error); }
  }
);

module.exports = router;
