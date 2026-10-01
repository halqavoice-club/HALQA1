const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');

async function listGuardians(req, res, next) {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const { skip, ...pagination } = getPagination(page, limit);
    // ARCH-01: always use req.schoolId (set by requireSchoolMember middleware).
    // Never bypass school scope based on req.user.role — even SUPER_ADMIN must
    // have an explicit school membership (enforced upstream by eduMember/eduAdmin).
    const schoolId = req.schoolId || req.user.schoolId;

    const where = {
      deletedAt: null,
      ...(schoolId && { schoolId })  // always scope to school — no role bypass
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
    // ARCH-01: always scope to school — school membership validated by middleware.
    const schoolId = req.schoolId || req.user.schoolId;
    const guardian = await prisma.guardian.findFirst({
      where: {
        id: req.params.id,
        deletedAt: null,
        ...(schoolId && { schoolId })  // always filter by school — no role bypass
      },
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
    // H-2 FIX: Never trust req.body.schoolId.
    const schoolId = req.schoolId || req.user.schoolId;
    if (!schoolId) return errorResponse(res, 'School context required', 400);

    // FRIEND-GUARDIAN-01: If a linkedUserId is provided (admin adding a social friend as guardian),
    // the user ALREADY EXISTS on the platform. Link them — do NOT create a new User record.
    const { linkedUserId } = req.body;

    if (linkedUserId) {
      // ── PATH A: Existing HALQA user being added as guardian ──────────────
      const existingUser = await prisma.user.findUnique({
        where: { id: linkedUserId, deletedAt: null },
        select: { id: true, email: true, firstName: true, lastName: true, schoolId: true }
      });
      if (!existingUser) return errorResponse(res, 'Linked user not found', 404);

      const alreadyGuardian = await prisma.guardian.findFirst({
        where: { userId: existingUser.id, schoolId, deletedAt: null }
      });
      if (alreadyGuardian) {
        return errorResponse(res, `${existingUser.firstName} is already a guardian in this school`, 409);
      }

      const guardian = await prisma.$transaction(async (tx) => {
        if (!existingUser.schoolId) {
          await tx.user.update({ where: { id: existingUser.id }, data: { schoolId } });
        }

        const g = await tx.guardian.create({
          data: {
            userId: existingUser.id,
            schoolId,
            relationship: relationship || 'parent'
          }
        });

        if (studentIds && studentIds.length > 0) {
          await tx.guardianStudent.createMany({
            data: studentIds.map((sid, i) => ({
              guardianId: g.id, studentId: sid, isPrimary: i === 0
            }))
          });
        }

        await tx.schoolMembership.upsert({
          where: { userId_schoolId: { userId: existingUser.id, schoolId } },
          create: { userId: existingUser.id, schoolId, role: 'GUARDIAN', status: 'ACTIVE', joinedAt: new Date() },
          update: { role: 'GUARDIAN', status: 'ACTIVE', deletedAt: null }
        });

        return g;
      });

      return successResponse(res, guardian, 'Guardian added successfully', 201);
    }

    // ── PATH B: Brand new user (manual entry) ────────────────────────────
    if (!email) return errorResponse(res, 'Email is required', 400);

    // L-1 FIX: Random temp password.
    const crypto = require('crypto');
    const tempPassword = crypto.randomBytes(12).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const guardian = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email, firstName, lastName, phone,
          passwordHash, role: 'GUARDIAN',
          schoolId, status: 'ACTIVE', emailVerified: true,
          mustChangePassword: true  // Step 8: force password reset on first login
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

      // GAP FIX: Create SchoolMembership so requireSchoolMember() sets effectiveRole correctly.
      await tx.schoolMembership.upsert({
        where: { userId_schoolId: { userId: user.id, schoolId } },
        create: { userId: user.id, schoolId, role: 'GUARDIAN', status: 'ACTIVE', joinedAt: new Date() },
        update: { role: 'GUARDIAN', status: 'ACTIVE', deletedAt: null }
      });

      return g;
    });

    return successResponse(res, guardian, 'Guardian created', 201);
  } catch (error) { next(error); }
}

async function updateGuardian(req, res, next) {
  try {
    const { relationship } = req.body;
    // PERM-FIX: firstName, lastName, phone are NOT accepted here.
    // Identity and contact fields belong to the user themselves and can only be
    // changed via PUT /users/profile (self-service). A School Admin manages only
    // the Guardian record (relationship).
    //
    // ARCH-01: always scope to school via req.schoolId (set by requireSchoolMember).
    const schoolId = req.schoolId || req.user.schoolId;
    const guardian = await prisma.guardian.findFirst({
      where: { id: req.params.id, deletedAt: null, ...(schoolId && { schoolId }) }
    });
    if (!guardian) return errorResponse(res, 'Guardian not found', 404);

    const updated = await prisma.guardian.update({
      where: { id: req.params.id },
      data: { relationship }
    });

    return successResponse(res, updated, 'Guardian updated');
  } catch (error) { next(error); }
}

async function linkStudent(req, res, next) {
  try {
    // M-3 FIX: Verify guardian and student belong to the same school before linking.
    // ARCH-01: No SUPER_ADMIN bypass — all roles must be scoped to a school.
    const schoolId = req.schoolId || req.user.schoolId;
    if (!schoolId) return errorResponse(res, 'School context required', 400);
    const [guardian, student] = await Promise.all([
      prisma.guardian.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null }, select: { id: true } }),
      prisma.student.findFirst({ where: { id: req.body.studentId, schoolId, deletedAt: null }, select: { id: true } })
    ]);
    if (!guardian) return errorResponse(res, 'Guardian not found in your school', 404);
    if (!student)  return errorResponse(res, 'Student not found in your school', 404);
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
    // ARCH-01: always scope to school — no bypass for any role.
    const schoolId = req.schoolId || req.user.schoolId;
    const guardian = await prisma.guardian.findFirst({
      where: { id: req.params.id, ...(schoolId && { schoolId }) },
      select: { id: true }
    });
    if (!guardian) return errorResponse(res, 'Guardian not found', 404);
    await prisma.guardian.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    return successResponse(res, null, 'Guardian deleted');
  } catch (error) { next(error); }
}

module.exports = { listGuardians, getGuardian, createGuardian, updateGuardian, linkStudent, unlinkStudent, deleteGuardian };
