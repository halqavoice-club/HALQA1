const prisma = require('../utils/prisma');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');

async function listClasses(req, res, next) {
  try {
    const { page = 1, limit = 50, search, termId } = req.query;
    const { skip, ...pagination } = getPagination(page, limit);
    const schoolId = (req.schoolId || req.user.schoolId);

    const where = {
      isActive: true,
      deletedAt: null,
      ...(schoolId && req.user.role !== 'SUPER_ADMIN' && { schoolId })
    };

    if (search) where.name = { contains: search };
    if (termId) where.termId = termId;

    const [classes, total] = await Promise.all([
      prisma.class.findMany({
        where,
        include: {
          teacherClasses: {
            where: { teacher: { is: { id: { not: undefined } } } },
            include: {
              teacher: {
                include: { user: { select: { firstName: true, lastName: true } } }
              }
            }
          },
          _count: { select: { enrollments: { where: { isActive: true } } } }
        },
        skip,
        take: pagination.limit,
        orderBy: { name: 'asc' }
      }),
      prisma.class.count({ where })
    ]);

    return paginatedResponse(res, classes, buildPaginationMeta(total, pagination.page, pagination.limit));
  } catch (error) { next(error); }
}

async function getClass(req, res, next) {
  try {
    // C-5 FIX: Verify the class belongs to the requester's school.
    const schoolId = req.schoolId || req.user.schoolId;
    const cls = await prisma.class.findFirst({
      where: {
        id: req.params.id,
        deletedAt: null,
        ...(req.user.role !== 'SUPER_ADMIN' && schoolId && { schoolId })
      },
      include: {
        teacherClasses: {
          include: {
            teacher: {
              include: { user: { select: { firstName: true, lastName: true, avatarUrl: true } } }
            }
          }
        },
        enrollments: {
          where: { isActive: true },
          include: {
            student: {
              include: { user: { select: { firstName: true, lastName: true, avatarUrl: true } } }
            }
          }
        },
        term: true,
        gradeCategories: true
      }
    });
    if (!cls) return errorResponse(res, 'Class not found', 404);
    return successResponse(res, cls);
  } catch (error) { next(error); }
}

async function createClass(req, res, next) {
  try {
    // H-2 FIX: Never trust req.body.schoolId.
    const schoolId = req.schoolId || req.user.schoolId;
    if (!schoolId) return errorResponse(res, 'School context required', 400);

    // Explicit field extraction prevents mass assignment
    const {
      name, description, gradeLevel, room, capacity,
      schedule, termId, isActive, isDefault
    } = req.body;

    const cls = await prisma.class.create({
      data: {
        schoolId,
        name,
        description:  description  || null,
        gradeLevel:   gradeLevel   || null,
        room:         room         || null,
        capacity:     capacity     ? parseInt(capacity) : 30,
        schedule:     schedule     || null,
        termId:       termId       || null,
        isActive:     isActive !== undefined ? Boolean(isActive) : true,
        isDefault:    false, // manually-created classes are never the default; only auto-created ones are
      }
    });
    return successResponse(res, cls, 'Class created', 201);
  } catch (error) { next(error); }
}

async function updateClass(req, res, next) {
  try {
    // C-5 FIX: Verify class belongs to caller's school before updating.
    const schoolId = req.schoolId || req.user.schoolId;
    const existing = await prisma.class.findFirst({
      where: { id: req.params.id, deletedAt: null, ...(req.user.role !== 'SUPER_ADMIN' && schoolId && { schoolId }) },
      select: { id: true }
    });
    if (!existing) return errorResponse(res, 'Class not found', 404);
    // Sensitive fields (deletedAt, schoolId) are NOT accepted from req.body
    const {
      name, description, gradeLevel, room, capacity,
      schedule, termId, isActive
    } = req.body;

    const data = {};
    if (name        !== undefined) data.name        = name;
    if (description !== undefined) data.description = description || null;
    if (gradeLevel  !== undefined) data.gradeLevel  = gradeLevel  || null;
    if (room        !== undefined) data.room        = room        || null;
    if (capacity    !== undefined) data.capacity    = parseInt(capacity);
    if (schedule    !== undefined) data.schedule    = schedule    || null;
    if (termId      !== undefined) data.termId      = termId      || null;
    if (isActive    !== undefined) data.isActive    = Boolean(isActive);

    const cls = await prisma.class.update({
      where: { id: req.params.id },
      data
    });
    return successResponse(res, cls, 'Class updated');
  } catch (error) { next(error); }
}

async function deleteClass(req, res, next) {
  try {
    // C-5 FIX: Verify class belongs to caller's school before soft-delete.
    const schoolId = req.schoolId || req.user.schoolId;
    const existing = await prisma.class.findFirst({
      where: { id: req.params.id, ...(req.user.role !== 'SUPER_ADMIN' && schoolId && { schoolId }) },
      select: { id: true }
    });
    if (!existing) return errorResponse(res, 'Class not found', 404);
    await prisma.class.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    return successResponse(res, null, 'Class deleted');
  } catch (error) { next(error); }
}

async function getClassStudents(req, res, next) {
  try {
    const enrollments = await prisma.enrollment.findMany({
      where: { classId: req.params.id, isActive: true },
      include: {
        student: {
          include: { user: { select: { firstName: true, lastName: true, email: true, avatarUrl: true } } }
        }
      },
      orderBy: { student: { user: { firstName: 'asc' } } }
    });
    return successResponse(res, enrollments.map(e => e.student));
  } catch (error) { next(error); }
}

module.exports = { listClasses, getClass, createClass, updateClass, deleteClass, getClassStudents };
