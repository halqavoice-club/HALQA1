'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const { eduMember, eduStaff } = require('../middleware/educationAuth');
const prisma = require('../utils/prisma');
const { successResponse, errorResponse } = require('../utils/response');

router.use(authenticate);

router.get('/', ...eduMember, async (req, res, next) => {
  try {
    const { classId, type } = req.query;
    const where = { deletedAt: null };
    if (classId) where.classId = classId;
    if (type)    where.type    = type;
    const activities = await prisma.activity.findMany({
      where,
      include: {
        teacher: { include: { user: { select: { firstName: true, lastName: true } } } },
        _count: { select: { participants: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    return successResponse(res, activities);
  } catch (error) { next(error); }
});

router.post('/',
  ...eduStaff,
  [
    body('classId').notEmpty(),
    body('type').isIn(['EXAM', 'BREAK', 'LIBRARY', 'PRAYER', 'MEMORIZATION', 'COUNSELING', 'OTHER']),
    body('title').trim().notEmpty()
  ],
  validate,
  async (req, res, next) => {
    try {
      const { classId, type, title, description } = req.body;
      const teacher = await prisma.teacher.findFirst({ where: { userId: req.user.id } });
      const activity = await prisma.activity.create({
        data: {
          title, type, description: description || null,
          class: { connect: { id: classId } },
          ...(teacher?.id && { teacher: { connect: { id: teacher.id } } })
        },
        include: {
          teacher: { include: { user: { select: { firstName: true, lastName: true } } } },
          _count: { select: { participants: true } }
        }
      });
      return successResponse(res, activity, 'Activity created', 201);
    } catch (error) { next(error); }
  }
);

router.post('/:id/start', ...eduStaff, async (req, res, next) => {
  try {
    const activity = await prisma.activity.update({ where: { id: req.params.id }, data: { startTime: new Date(), isActive: true } });
    return successResponse(res, activity, 'Activity started');
  } catch (error) { next(error); }
});

router.post('/:id/stop', ...eduStaff, async (req, res, next) => {
  try {
    const activity = await prisma.activity.findUnique({ where: { id: req.params.id } });
    const endTime = new Date();
    const duration = activity.startTime ? Math.round((endTime - activity.startTime) / 60000) : 0;
    const updated = await prisma.activity.update({ where: { id: req.params.id }, data: { endTime, duration, isActive: false } });
    return successResponse(res, updated, 'Activity stopped');
  } catch (error) { next(error); }
});

router.post('/:id/participants',
  ...eduMember,
  [body('studentId').notEmpty()],
  validate,
  async (req, res, next) => {
    try {
      const participant = await prisma.activityParticipant.upsert({
        where: { activityId_studentId: { activityId: req.params.id, studentId: req.body.studentId } },
        update: { joinedAt: new Date() },
        create: { activityId: req.params.id, studentId: req.body.studentId, joinedAt: new Date() }
      });
      return successResponse(res, participant, 'Participant added');
    } catch (error) { next(error); }
  }
);

router.get('/:id', ...eduMember, async (req, res, next) => {
  try {
    const activity = await prisma.activity.findUnique({
      where: { id: req.params.id },
      include: {
        teacher: { include: { user: { select: { firstName: true, lastName: true } } } },
        participants: {
          include: { student: { include: { user: { select: { firstName: true, lastName: true, avatarUrl: true } } } } }
        },
        _count: { select: { participants: true } }
      }
    });
    if (!activity) return errorResponse(res, 'Activity not found', 404);
    return successResponse(res, activity);
  } catch (error) { next(error); }
});

router.delete('/:id', ...eduStaff, async (req, res, next) => {
  try {
    await prisma.activity.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    return successResponse(res, null, 'Activity deleted');
  } catch (error) { next(error); }
});

module.exports = router;
