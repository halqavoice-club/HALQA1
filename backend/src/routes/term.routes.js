const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const prisma = require('../utils/prisma');
const { successResponse, errorResponse } = require('../utils/response');

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const schoolId = req.user.schoolId;
    // SUPER_ADMIN has no schoolId — return all terms; others filter by school
    const where = schoolId ? { schoolId, deletedAt: null } : { deletedAt: null };
    const terms = await prisma.term.findMany({
      where,
      orderBy: { startDate: 'desc' }
    });
    return successResponse(res, terms);
  } catch (error) { next(error); }
});

router.post('/',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  [
    body('name').trim().notEmpty(),
    body('startDate').isISO8601(),
    body('endDate').isISO8601()
  ],
  validate,
  async (req, res, next) => {
    try {
      const schoolId = req.user.schoolId || req.body.schoolId;

      // Explicit field extraction — prevents mass assignment of deletedAt, isCurrent, isActive
      const { name, startDate, endDate } = req.body;

      const term = await prisma.term.create({
        data: {
          schoolId,
          name,
          startDate: new Date(startDate),
          endDate:   new Date(endDate),
          isActive:  false,
          isCurrent: false,
        }
      });
      return successResponse(res, term, 'Term created', 201);
    } catch (error) { next(error); }
  }
);

router.put('/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  [
    body('name').optional().trim().notEmpty(),
    body('startDate').optional().isISO8601(),
    body('endDate').optional().isISO8601(),
  ],
  validate,
  async (req, res, next) => {
    try {
      // Explicit field extraction — prevents mass assignment of deletedAt, isCurrent, schoolId
      const { name, startDate, endDate } = req.body;

      const data = {};
      if (name      !== undefined) data.name      = name;
      if (startDate !== undefined) data.startDate = new Date(startDate);
      if (endDate   !== undefined) data.endDate   = new Date(endDate);

      const term = await prisma.term.update({
        where: { id: req.params.id },
        data
      });
      return successResponse(res, term, 'Term updated');
    } catch (error) { next(error); }
  }
);

// Set current term
router.post('/:id/set-current',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  async (req, res, next) => {
    try {
      const schoolId = req.user.schoolId;
      const ops = [
        prisma.term.update({ where: { id: req.params.id }, data: { isCurrent: true, isActive: true } })
      ];
      // Only reset other terms if we know the school
      if (schoolId) {
        ops.unshift(
          prisma.term.updateMany({ where: { schoolId, id: { not: req.params.id } }, data: { isCurrent: false } })
        );
      }
      await prisma.$transaction(ops);
      return successResponse(res, null, 'Current term set');
    } catch (error) { next(error); }
  }
);

router.delete('/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  async (req, res, next) => {
    try {
      await prisma.term.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
      return successResponse(res, null, 'Term deleted');
    } catch (error) { next(error); }
  }
);

module.exports = router;
