const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const prisma = require('../utils/prisma');
const { successResponse } = require('../utils/response');

router.use(authenticate);

/**
 * Global search across students, teachers, classes
 */
router.get('/', async (req, res, next) => {
  try {
    const { q, limit = 10 } = req.query;
    // SUPER_ADMIN has no schoolId — use undefined so Prisma omits the filter
    // (undefined keys are ignored by Prisma, null causes a validation error)
    const schoolId = req.user.schoolId || undefined;

    if (!q || q.trim().length < 2) {
      return successResponse(res, { students: [], teachers: [], classes: [] });
    }

    const searchTerm = q.trim();
    const take = Math.min(parseInt(limit), 20);

    const [students, teachers, classes] = await Promise.all([
      prisma.student.findMany({
        where: {
          schoolId,
          deletedAt: null,
          OR: [
            { user: { firstName: { contains: searchTerm } } },
            { user: { lastName: { contains: searchTerm } } },
            { studentId: { contains: searchTerm } }
          ]
        },
        include: {
          user: { select: { firstName: true, lastName: true, avatarUrl: true } }
        },
        take
      }),

      prisma.teacher.findMany({
        where: {
          schoolId,
          deletedAt: null,
          OR: [
            { user: { firstName: { contains: searchTerm } } },
            { user: { lastName: { contains: searchTerm } } }
          ]
        },
        include: {
          user: { select: { firstName: true, lastName: true, avatarUrl: true } }
        },
        take
      }),

      prisma.class.findMany({
        where: {
          schoolId,
          isActive: true,
          deletedAt: null,
          name: { contains: searchTerm }
        },
        take
      })
    ]);

    return successResponse(res, { students, teachers, classes });
  } catch (error) { next(error); }
});

module.exports = router;
