const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');

// ─── ALLOWED SORT FIELDS (prevents SQL injection) ─────────────────────────────
const ALLOWED_SORT_FIELDS = {
  'first_name':    { field: 'user', subField: 'firstName' },
  'last_name':     { field: 'user', subField: 'lastName' },
  'student_id_no': { field: 'studentId', subField: null },
  'level':         { field: 'gradeLevel', subField: null },
  'created_at':    { field: 'createdAt', subField: null },
  'enrollment_date': { field: 'enrollmentDate', subField: null }
};

const ALLOWED_ORDERS = ['asc', 'desc'];

/**
 * Build a safe Prisma orderBy array from query params.
 * Supports multi-column: ?sortBy=level,first_name&order=asc,asc
 */
function buildOrderBy(sortBy, order) {
  const sortFields = sortBy ? String(sortBy).split(',').map(s => s.trim()) : ['first_name'];
  const sortOrders = order ? String(order).split(',').map(o => o.trim().toLowerCase()) : ['asc'];

  const orderBy = [];

  sortFields.forEach((field, idx) => {
    const mapping = ALLOWED_SORT_FIELDS[field];
    if (!mapping) return; // skip invalid fields silently

    const dir = ALLOWED_ORDERS.includes(sortOrders[idx]) ? sortOrders[idx] : 'asc';

    if (mapping.subField) {
      // Nested relation sort (e.g., user.firstName)
      orderBy.push({ [mapping.field]: { [mapping.subField]: dir } });
    } else {
      orderBy.push({ [mapping.field]: dir });
    }
  });

  // Default fallback
  if (orderBy.length === 0) {
    orderBy.push({ user: { firstName: 'asc' } });
  }

  return orderBy;
}

async function listStudents(req, res, next) {
  try {
    const {
      page = 1,
      limit = 100,
      search,
      classId,
      sortBy = 'first_name',
      order = 'asc',
      level,          // filter by gradeLevel
      status          // filter by user status
    } = req.query;

    // Validate sortBy fields
    const requestedFields = String(sortBy).split(',').map(s => s.trim());
    const invalidFields = requestedFields.filter(f => !ALLOWED_SORT_FIELDS[f]);
    if (invalidFields.length > 0) {
      return errorResponse(res, `Invalid sortBy field(s): ${invalidFields.join(', ')}. Allowed: ${Object.keys(ALLOWED_SORT_FIELDS).join(', ')}`, 400);
    }

    const { skip, ...pagination } = getPagination(page, limit);
    const schoolId = req.schoolId || req.user.schoolId;

    // ARCH-01: ALL users (including SUPER_ADMIN) must be scoped to a school.
    // SUPER_ADMIN must have an explicit SchoolMembership to view school student data.
    if (!schoolId) {
      return errorResponse(res, 'School context required', 400);
    }

    const where = {
      deletedAt: null,
      schoolId,   // always filter by school — no bypass for any role
    };

    // Search filter
    if (search) {
      const s = String(search).trim();
      where.OR = [
        { user: { firstName: { contains: s } } },
        { user: { lastName: { contains: s } } },
        { user: { email: { contains: s } } },
        { studentId: { contains: s } }
      ];
    }

    // Class filter
    if (classId) {
      where.enrollments = { some: { classId: String(classId), isActive: true } };
    }

    // Level/grade filter
    if (level) {
      where.gradeLevel = { contains: String(level) };
    }

    // Status filter
    if (status) {
      where.user = { ...where.user, status: String(status).toUpperCase() };
    }

    const orderBy = buildOrderBy(sortBy, order);

    const [students, total] = await Promise.all([
      prisma.student.findMany({
        where,
        include: {
          user: {
            select: {
              id: true, firstName: true, lastName: true,
              email: true, phone: true, avatarUrl: true, status: true
            }
          },
          enrollments: {
            where: { isActive: true },
            include: { class: { select: { id: true, name: true } } }
          }
        },
        skip,
        take: pagination.limit,
        orderBy
      }),
      prisma.student.count({ where })
    ]);

    return paginatedResponse(res, students, buildPaginationMeta(total, pagination.page, pagination.limit));
  } catch (error) { next(error); }
}

async function getStudent(req, res, next) {
  try {
    // C-4 FIX: Verify the student belongs to the requester's school.
    // Previously only the list endpoint was school-scoped; individual fetch was not,
    // allowing cross-school data access via guessed/discovered UUIDs.
    const schoolId = req.schoolId || req.user.schoolId;
    const student = await prisma.student.findFirst({
      where: {
        id: req.params.id,
        deletedAt: null,
        ...(schoolId && { schoolId })  // ARCH-01: always filter by school
      },
      include: {
        // ID-CARD-01: Always include the student's own school record so the ID card
        // always uses the STUDENT's enrolled school name/logo — never the requesting
        // admin's school or any other context-dependent school.
        school: {
          select: { id: true, name: true, logoUrl: true, address: true, phone: true, email: true }
        },
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true, dateOfBirth: true, gender: true, status: true, emailVerified: true, lastLoginAt: true } },
        enrollments: {
          where: { isActive: true },
          include: { class: true }
        },
        guardianLinks: {
          include: {
            guardian: {
              include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } }
            }
          }
        }
      }
    });
    if (!student) return errorResponse(res, 'Student not found', 404);
    return successResponse(res, student);
  } catch (error) { next(error); }
}

async function createStudent(req, res, next) {
  try {
    let { email, firstName, lastName, studentId, phone, dateOfBirth, gender, gradeLevel, classId, guardianId } = req.body;
    // H-2 FIX: Never trust req.body.schoolId — always use the school resolved from
    // the authenticated context (set by requireSchoolMember middleware).
    const schoolId = req.schoolId || req.user.schoolId;
    if (!schoolId) return errorResponse(res, 'School context required', 400);

    // FRIEND-STUDENT-02: If a linkedUserId is provided (admin adding a social friend),
    // the user ALREADY EXISTS on the platform. We must NOT create a new User record —
    // instead we link the existing user to this school as a Student.
    const { linkedUserId } = req.body;

    if (linkedUserId) {
      // ── PATH A: Existing HALQA user being added as a student ─────────────────
      const existingUser = await prisma.user.findUnique({
        where: { id: linkedUserId, deletedAt: null },
        select: { id: true, email: true, firstName: true, lastName: true, schoolId: true }
      });
      if (!existingUser) return errorResponse(res, 'Linked user not found', 404);

      // Check they aren't already a student in this school
      const alreadyStudent = await prisma.student.findFirst({
        where: { userId: existingUser.id, schoolId, deletedAt: null }
      });
      if (alreadyStudent) {
        return errorResponse(res, `${existingUser.firstName} is already a student in this school`, 409);
      }

      const qrCode = `STU-${uuidv4().split('-')[0].toUpperCase()}`;

      const student = await prisma.$transaction(async (tx) => {
        // Update the existing user's schoolId if not set
        if (!existingUser.schoolId) {
          await tx.user.update({
            where: { id: existingUser.id },
            data: { schoolId }
          });
        }

        const s = await tx.student.create({
          data: {
            userId: existingUser.id,
            schoolId,
            studentId,
            qrCode,
            gradeLevel: gradeLevel || null
          }
        });

        if (classId) {
          await tx.enrollment.create({ data: { studentId: s.id, classId } });
        }

        if (guardianId) {
          await tx.guardianStudent.create({
            data: { guardianId, studentId: s.id, isPrimary: true }
          });
        }

        // Create/update SchoolMembership so the user gets STUDENT role in this school
        await tx.schoolMembership.upsert({
          where: { userId_schoolId: { userId: existingUser.id, schoolId } },
          create: { userId: existingUser.id, schoolId, role: 'STUDENT', status: 'ACTIVE', joinedAt: new Date() },
          update: { role: 'STUDENT', status: 'ACTIVE', deletedAt: null }
        });

        return s;
      });

      return successResponse(res, student, 'Student added successfully', 201);
    }

    // ── PATH B: Brand new user (manual entry) ───────────────────────────────────
    // linkedUserId is not set — create a fresh User record with the provided fields.
    if (!email) return errorResponse(res, 'Email is required', 400);

    // Generate a cryptographically random temporary password instead of a hardcoded default (L-1 fix)
    const crypto = require('crypto');
    const tempPassword = crypto.randomBytes(12).toString('hex'); // 24-char hex — user must reset via email
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    const qrCode = `STU-${uuidv4().split('-')[0].toUpperCase()}`;

    const student = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email, firstName, lastName, phone,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
          gender, passwordHash,
          role: 'STUDENT',
          schoolId,
          status: 'ACTIVE',
          emailVerified: true,
          mustChangePassword: true  // Step 8: force password reset on first login
        }
      });

      const s = await tx.student.create({
        data: { userId: user.id, schoolId, studentId, qrCode, gradeLevel: gradeLevel || null }
      });

      if (classId) {
        await tx.enrollment.create({ data: { studentId: s.id, classId } });
      }

      if (guardianId) {
        await tx.guardianStudent.create({
          data: { guardianId, studentId: s.id, isPrimary: true }
        });
      }

      // GAP FIX: Create SchoolMembership so requireSchoolMember() sets effectiveRole correctly.
      await tx.schoolMembership.upsert({
        where: { userId_schoolId: { userId: user.id, schoolId } },
        create: { userId: user.id, schoolId, role: 'STUDENT', status: 'ACTIVE', joinedAt: new Date() },
        update: { role: 'STUDENT', status: 'ACTIVE', deletedAt: null }
      });

      return s;
    });

    return successResponse(res, student, 'Student created', 201);
  } catch (error) {
    // P2002 = unique constraint (duplicate email or studentId)
    if (error.code === 'P2002') {
      const field = error.meta?.target?.includes('email') ? 'email' : 'student ID';
      return next(Object.assign(new Error(`A student with this ${field} already exists`), { statusCode: 409 }));
    }
    // P2003 = foreign key constraint (classId or guardianId doesn't exist)
    if (error.code === 'P2003') {
      return next(Object.assign(new Error('Invalid class or guardian ID provided'), { statusCode: 400 }));
    }
    next(error);
  }
}

async function updateStudent(req, res, next) {
  try {
    const { gradeLevel, studentId } = req.body;
    // PERM-FIX: A School Admin may ONLY update school-specific student fields:
    //   - studentId  (school-assigned identifier)
    //   - gradeLevel (academic level in this school)
    //
    // The following fields are NOT accepted, regardless of what is sent in the body:
    //   - firstName, lastName, phone  (identity — user-owned)
    //   - email                       (identity — user-owned)
    //   - dateOfBirth, gender         (personal — user-owned)
    //   - medicalNotes, emergencyContact  (removed from permitted fields)
    //
    // Personal information can only be changed by the user themselves
    // via PUT /users/profile (self-service).
    const schoolId = req.schoolId || req.user.schoolId;
    const student = await prisma.student.findFirst({
      where: {
        id: req.params.id,
        deletedAt: null,
        ...(schoolId && { schoolId })
      }
    });
    if (!student) return errorResponse(res, 'Student not found', 404);

    // If studentId is being changed, check it isn't already taken in this school
    if (studentId && studentId !== student.studentId) {
      const conflict = await prisma.student.findFirst({
        where: { schoolId, studentId, id: { not: req.params.id }, deletedAt: null }
      });
      if (conflict) return errorResponse(res, `Student ID "${studentId}" is already in use`, 409);
    }

    // Only update the Student record — never touch the User record here.
    const updated = await prisma.student.update({
      where: { id: req.params.id },
      data: {
        ...(studentId && { studentId }),
        gradeLevel: gradeLevel !== undefined ? (gradeLevel || null) : undefined,
      }
    });

    return successResponse(res, updated, 'Student updated');
  } catch (error) { next(error); }
}

async function enrollStudent(req, res, next) {
  try {
    // H-9 FIX: Verify both student and class belong to the caller's school.
    const schoolId = req.schoolId || req.user.schoolId;
    const [student, cls] = await Promise.all([
      prisma.student.findFirst({ where: { id: req.params.id, deletedAt: null, ...(schoolId && { schoolId }) }, select: { id: true } }),
      prisma.class.findFirst({ where: { id: req.body.classId, deletedAt: null, ...(schoolId && { schoolId }) }, select: { id: true } })
    ]);
    if (!student) return errorResponse(res, 'Student not found or not in your school', 404);
    if (!cls) return errorResponse(res, 'Class not found or not in your school', 404);

    const enrollment = await prisma.enrollment.upsert({
      where: { studentId_classId: { studentId: req.params.id, classId: req.body.classId } },
      update: { isActive: true, droppedAt: null },
      create: { studentId: req.params.id, classId: req.body.classId }
    });
    return successResponse(res, enrollment, 'Student enrolled');
  } catch (error) { next(error); }
}

async function unenrollStudent(req, res, next) {
  try {
    // C-4 FIX: Verify both student and class belong to the caller's school before unenrolling.
    const schoolId = req.schoolId || req.user.schoolId;
    const [student, cls] = await Promise.all([
      prisma.student.findFirst({
        where: { id: req.params.id, deletedAt: null, ...(schoolId && { schoolId }) },
        select: { id: true }
      }),
      prisma.class.findFirst({
        where: { id: req.params.classId, deletedAt: null, ...(schoolId && { schoolId }) },
        select: { id: true }
      })
    ]);
    if (!student) return errorResponse(res, 'Student not found or not in your school', 404);
    if (!cls)     return errorResponse(res, 'Class not found or not in your school', 404);

    await prisma.enrollment.update({
      where: { studentId_classId: { studentId: req.params.id, classId: req.params.classId } },
      data: { isActive: false, droppedAt: new Date() }
    });
    return successResponse(res, null, 'Student unenrolled');
  } catch (error) { next(error); }
}

async function deleteStudent(req, res, next) {
  try {
    // C-4 FIX: Verify school ownership before soft-delete.
    const schoolId = req.schoolId || req.user.schoolId;
    const student = await prisma.student.findFirst({
      where: { id: req.params.id, ...(schoolId && { schoolId }) },
      select: { id: true }
    });
    if (!student) return errorResponse(res, 'Student not found', 404);
    await prisma.student.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    return successResponse(res, null, 'Student deleted');
  } catch (error) { next(error); }
}

async function regenerateQr(req, res, next) {
  try {
    // ID-CARD-QR-01: Verify school ownership before regenerating QR code.
    // This prevents cross-school QR regeneration via IDOR.
    const schoolId = req.schoolId || req.user.schoolId;
    const existing = await prisma.student.findFirst({
      where: { id: req.params.id, ...(schoolId && { schoolId }), deletedAt: null },
      select: { id: true }
    });
    if (!existing) return errorResponse(res, 'Student not found', 404);

    const qrCode = `STU-${uuidv4().split('-')[0].toUpperCase()}`;
    const student = await prisma.student.update({
      where: { id: req.params.id },
      data: { qrCode }
    });
    return successResponse(res, { qrCode: student.qrCode }, 'QR code regenerated');
  } catch (error) { next(error); }
}

module.exports = { listStudents, getStudent, createStudent, updateStudent, enrollStudent, unenrollStudent, deleteStudent, regenerateQr };
