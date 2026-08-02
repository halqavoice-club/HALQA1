const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');

async function listTeachers(req, res, next) {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const { skip, ...pagination } = getPagination(page, limit);
    const schoolId = req.user.schoolId;

    const where = {
      deletedAt: null,
      ...(schoolId && req.user.role !== 'SUPER_ADMIN' && { schoolId })
    };

    if (search) {
      where.OR = [
        { user: { firstName: { contains: search } } },
        { user: { lastName: { contains: search } } },
        { user: { email: { contains: search } } }
      ];
    }

    const [teachers, total] = await Promise.all([
      prisma.teacher.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true, status: true } },
          teacherClasses: {
            include: { class: { select: { id: true, name: true, _count: { select: { enrollments: { where: { isActive: true } } } } } } }
          }
        },
        skip,
        take: pagination.limit,
        orderBy: { user: { firstName: 'asc' } }
      }),
      prisma.teacher.count({ where })
    ]);

    return paginatedResponse(res, teachers, buildPaginationMeta(total, pagination.page, pagination.limit));
  } catch (error) { next(error); }
}

async function getTeacher(req, res, next) {
  try {
    const teacher = await prisma.teacher.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true, status: true, lastLoginAt: true } },
        teacherClasses: {
          include: { class: { select: { id: true, name: true, room: true, _count: { select: { enrollments: { where: { isActive: true } } } } } } }
        }
      }
    });
    if (!teacher) return errorResponse(res, 'Teacher not found', 404);
    return successResponse(res, teacher);
  } catch (error) { next(error); }
}

async function createTeacher(req, res, next) {
  try {
    const { email, firstName, lastName, phone, department, specialization, hireDate, employeeId } = req.body;
    const schoolId = req.user.schoolId || req.body.schoolId;

    const passwordHash = await bcrypt.hash('Halqa@2024', 12);

    const teacher = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email, firstName, lastName, phone,
          passwordHash, role: 'TEACHER',
          schoolId, status: 'ACTIVE', emailVerified: true
        }
      });

      return tx.teacher.create({
        data: {
          userId: user.id, schoolId,
          department, specialization, employeeId,
          hireDate: hireDate ? new Date(hireDate) : null
        }
      });
    });

    return successResponse(res, teacher, 'Teacher created', 201);
  } catch (error) { next(error); }
}

async function updateTeacher(req, res, next) {
  try {
    const { firstName, lastName, phone, department, specialization } = req.body;
    const teacher = await prisma.teacher.findUnique({ where: { id: req.params.id } });
    if (!teacher) return errorResponse(res, 'Teacher not found', 404);

    await prisma.user.update({
      where: { id: teacher.userId },
      data: { firstName, lastName, phone }
    });

    const updated = await prisma.teacher.update({
      where: { id: req.params.id },
      data: { department, specialization }
    });

    return successResponse(res, updated, 'Teacher updated');
  } catch (error) { next(error); }
}

async function assignClass(req, res, next) {
  try {
    const assignment = await prisma.teacherClass.upsert({
      where: { teacherId_classId: { teacherId: req.params.id, classId: req.body.classId } },
      update: { isLead: req.body.isLead || false, subject: req.body.subject },
      create: { teacherId: req.params.id, classId: req.body.classId, isLead: req.body.isLead || false, subject: req.body.subject }
    });
    return successResponse(res, assignment, 'Teacher assigned to class');
  } catch (error) { next(error); }
}

async function unassignClass(req, res, next) {
  try {
    await prisma.teacherClass.delete({
      where: { teacherId_classId: { teacherId: req.params.id, classId: req.params.classId } }
    });
    return successResponse(res, null, 'Teacher unassigned from class');
  } catch (error) { next(error); }
}

async function deleteTeacher(req, res, next) {
  try {
    await prisma.teacher.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    return successResponse(res, null, 'Teacher deleted');
  } catch (error) { next(error); }
}

module.exports = { listTeachers, getTeacher, createTeacher, updateTeacher, assignClass, unassignClass, deleteTeacher };
