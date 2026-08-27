const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');

async function listTeachers(req, res, next) {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const { skip, ...pagination } = getPagination(page, limit);
    const schoolId = (req.schoolId || req.user.schoolId);

    const where = {
      deletedAt: null,
      // ARCH-01: always filter by school — SUPER_ADMIN is no longer a bypass
      ...(schoolId && { schoolId })
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
    // C-4 FIX: Verify the teacher belongs to the requester's school.
    const schoolId = req.schoolId || req.user.schoolId;
    const teacher = await prisma.teacher.findFirst({
      where: {
        id: req.params.id,
        deletedAt: null,
        ...(schoolId && { schoolId })  // ARCH-01: always filter by school
      },
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
    // H-2 FIX: Never trust req.body.schoolId for school context.
    const schoolId = req.schoolId || req.user.schoolId;
    if (!schoolId) return errorResponse(res, 'School context required', 400);

    // L-1 FIX: Random temp password instead of hardcoded default.
    const crypto = require('crypto');
    const tempPassword = crypto.randomBytes(12).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const teacher = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email, firstName, lastName, phone,
          passwordHash, role: 'TEACHER',
          schoolId, status: 'ACTIVE', emailVerified: true,
          mustChangePassword: true  // Step 8: force password reset on first login
        }
      });

      const teacherRecord = await tx.teacher.create({
        data: {
          userId: user.id, schoolId,
          department, specialization, employeeId,
          hireDate: hireDate ? new Date(hireDate) : null
        }
      });

      // GAP FIX: Also create SchoolMembership so requireSchoolMember() grants access.
      // Without this, legacy-created teachers pass middleware only via user.schoolId
      // fallback which doesn't set req.schoolMembership.role — breaking effectiveRole.
      await tx.schoolMembership.upsert({
        where: { userId_schoolId: { userId: user.id, schoolId } },
        create: {
          userId: user.id,
          schoolId,
          role: 'TEACHER',
          status: 'ACTIVE',
          joinedAt: new Date()
        },
        update: {
          role: 'TEACHER',
          status: 'ACTIVE',
          deletedAt: null
        }
      });

      return teacherRecord;
    });

    return successResponse(res, teacher, 'Teacher created', 201);
  } catch (error) { next(error); }
}

async function updateTeacher(req, res, next) {
  try {
    const { firstName, lastName, phone, department, specialization } = req.body;
    // C-4 FIX: Verify school ownership before updating.
    const schoolId = req.schoolId || req.user.schoolId;
    const teacher = await prisma.teacher.findFirst({
      where: { id: req.params.id, deletedAt: null, ...(schoolId && { schoolId }) }  // ARCH-01
    });
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
    // C-4 FIX: Verify school ownership before soft-delete.
    const schoolId = req.schoolId || req.user.schoolId;
    const teacher = await prisma.teacher.findFirst({
      where: { id: req.params.id, ...(schoolId && { schoolId }) },  // ARCH-01
      select: { id: true }
    });
    if (!teacher) return errorResponse(res, 'Teacher not found', 404);
    await prisma.teacher.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    return successResponse(res, null, 'Teacher deleted');
  } catch (error) { next(error); }
}

module.exports = { listTeachers, getTeacher, createTeacher, updateTeacher, assignClass, unassignClass, deleteTeacher };
