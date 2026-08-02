const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');

async function listGuardians(req, res, next) {
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

    const [guardians, total] = await Promise.all([
      prisma.guardian.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true, status: true } },
          students: {
            include: {
              student: {
                include: { user: { select: { firstName: true, lastName: true } } }
              }
            }
          }
        },
        skip,
        take: pagination.limit,
        orderBy: { user: { firstName: 'asc' } }
      }),
      prisma.guardian.count({ where })
    ]);

    return paginatedResponse(res, guardians, buildPaginationMeta(total, pagination.page, pagination.limit));
  } catch (error) { next(error); }
}

async function getGuardian(req, res, next) {
  try {
    const guardian = await prisma.guardian.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true, status: true } },
        students: {
          include: {
            student: {
              include: {
                user: { select: { firstName: true, lastName: true, avatarUrl: true } },
                enrollments: { where: { isActive: true }, include: { class: { select: { name: true } } } }
              }
            }
          }
        }
      }
    });
    if (!guardian) return errorResponse(res, 'Guardian not found', 404);
    return successResponse(res, guardian);
  } catch (error) { next(error); }
}

async function createGuardian(req, res, next) {
  try {
    const { email, firstName, lastName, phone, relationship, studentIds } = req.body;
    const schoolId = req.user.schoolId || req.body.schoolId;

    const passwordHash = await bcrypt.hash('Halqa@2024', 12);

    const guardian = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email, firstName, lastName, phone,
          passwordHash, role: 'GUARDIAN',
          schoolId, status: 'ACTIVE', emailVerified: true
        }
      });

      const g = await tx.guardian.create({
        data: { userId: user.id, schoolId, relationship: relationship || 'parent' }
      });

      if (studentIds && studentIds.length > 0) {
        await tx.guardianStudent.createMany({
          data: studentIds.map((sid, i) => ({
            guardianId: g.id,
            studentId: sid,
            isPrimary: i === 0
          }))
        });
      }

      return g;
    });

    return successResponse(res, guardian, 'Guardian created', 201);
  } catch (error) { next(error); }
}

async function updateGuardian(req, res, next) {
  try {
    const { firstName, lastName, phone, relationship } = req.body;
    const guardian = await prisma.guardian.findUnique({ where: { id: req.params.id } });
    if (!guardian) return errorResponse(res, 'Guardian not found', 404);

    await prisma.user.update({
      where: { id: guardian.userId },
      data: { firstName, lastName, phone }
    });

    const updated = await prisma.guardian.update({
      where: { id: req.params.id },
      data: { relationship }
    });

    return successResponse(res, updated, 'Guardian updated');
  } catch (error) { next(error); }
}

async function linkStudent(req, res, next) {
  try {
    const link = await prisma.guardianStudent.upsert({
      where: { guardianId_studentId: { guardianId: req.params.id, studentId: req.body.studentId } },
      update: { },
      create: { guardianId: req.params.id, studentId: req.body.studentId, isPrimary: req.body.isPrimary || false }
    });
    return successResponse(res, link, 'Student linked to guardian');
  } catch (error) { next(error); }
}

async function unlinkStudent(req, res, next) {
  try {
    await prisma.guardianStudent.delete({
      where: { guardianId_studentId: { guardianId: req.params.id, studentId: req.params.studentId } }
    });
    return successResponse(res, null, 'Student unlinked');
  } catch (error) { next(error); }
}

async function deleteGuardian(req, res, next) {
  try {
    await prisma.guardian.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    return successResponse(res, null, 'Guardian deleted');
  } catch (error) { next(error); }
}

module.exports = { listGuardians, getGuardian, createGuardian, updateGuardian, linkStudent, unlinkStudent, deleteGuardian };
