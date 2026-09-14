'use strict';

/**
 * schoolMembership.routes.js
 * …
 */

const router = require('express').Router();
const { body, param } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const rateLimit = require('express-rate-limit');
const {
  requireSchoolMember,
  requireSchoolRole,
  invalidateMembershipCache,
  getSchoolMemberships
} = require('../middleware/schoolAuth.middleware');
const { deleteGetMeCache } = require('../controllers/auth.controller');
const { assertSafeMembershipRole } = require('../utils/roleGuard');
const prisma = require('../utils/prisma');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

// ─── Helper: auto-enroll a student in the school's default class ──────────────
// Called when a STUDENT membership is approved (status → ACTIVE).
// 1. Finds or creates the Student profile record (with QR code).
// 2. Finds the school's isDefault=true class.
// 3. Enrolls the student in that class (idempotent — skips if already enrolled).
// If the school has no default class (e.g. existing schools before this feature),
// the function still creates/updates the Student record — just no class enrollment.
async function autoEnrollStudentInDefaultClass(userId, schoolId) {
  // Find the default class for this school
  const defaultClass = await prisma.class.findFirst({
    where: { schoolId, isDefault: true, isActive: true, deletedAt: null },
    select: { id: true }
  });

  // Find or create the Student profile record
  let student = await prisma.student.findFirst({
    where: { userId, schoolId, deletedAt: null },
    select: { id: true, qrCode: true }
  });

  if (!student) {
    // Generate a unique sequential studentId and a QR code
    const count = await prisma.student.count({ where: { schoolId } });
    const studentId = `S${String(count + 1).padStart(4, '0')}`;
    // QR code: same format as admin-created students (STU-XXXXXXXX)
    const qrCode = `STU-${uuidv4().split('-')[0].toUpperCase()}`;

    student = await prisma.student.create({
      data: { userId, schoolId, studentId, qrCode },
      select: { id: true, qrCode: true }
    });
    logger.info(`[autoEnroll] Created Student profile ${student.id} for user ${userId} in school ${schoolId} with QR ${student.qrCode}`);
  } else if (!student.qrCode) {
    // Student record exists but has no QR code (e.g. created before this fix)
    // Generate one now so they can use attendance QR scanning
    const qrCode = `STU-${uuidv4().split('-')[0].toUpperCase()}`;
    await prisma.student.update({
      where: { id: student.id },
      data: { qrCode }
    });
    logger.info(`[autoEnroll] Backfilled QR code for existing Student ${student.id}`);
  }

  if (!defaultClass) {
    logger.info(`[autoEnroll] School ${schoolId} has no default class — student record created but not enrolled in any class`);
    return;
  }

  // Enroll in the default class (idempotent)
  await prisma.enrollment.upsert({
    where: { studentId_classId: { studentId: student.id, classId: defaultClass.id } },
    create: { studentId: student.id, classId: defaultClass.id, isActive: true },
    update: { isActive: true, droppedAt: null },  // re-activate if previously dropped
  });

  logger.info(`[autoEnroll] Enrolled student ${student.id} in default class ${defaultClass.id} of school ${schoolId}`);
}

// L-9 FIX: Rate limit school creation — max 2 new schools per user per 24 hours.
// Prevents spam school creation that would pollute the school database.
// SA-SCHOOL-CREATE-01: SUPER_ADMIN is a platform role — they do NOT create schools
// via /school-memberships/create-school. They use POST /schools (admin endpoint).
const createSchoolLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: (req) => {
    // SCHOOL_ADMIN (school-scoped role) can create more schools (they administer them)
    // Regular users (MEMBER, TEACHER, STUDENT, GUARDIAN) are limited to 2
    return req.user?.role === 'SCHOOL_ADMIN' ? 20 : 2;
  },
  keyGenerator: req => req.user?.id || req.ip,
  message: { success: false, message: 'Too many school creation requests. Please try again later.' }
});

// All routes require authentication
router.use(authenticate);

// ─── GET /school-memberships/me ───────────────────────────────────────────────
// Returns all active school memberships for the current user.
// This is how the frontend determines if the Education section should appear
// and which school(s) to show.
router.get('/me', async (req, res, next) => {
  try {
    const memberships = await getSchoolMemberships(req.user.id);
    return successResponse(res, memberships, 'School memberships fetched');
  } catch (error) { next(error); }
});

// ─── POST /school-memberships/join ───────────────────────────────────────────
// A user requests to join a school (requires an invitation code or open enrollment).
// Any user can request to join. Status starts as PENDING.
// Admins approve via PUT /school-memberships/:id/status.
router.post('/join',
  [
    body('schoolId').notEmpty().withMessage('schoolId is required'),
    // M-1 FIX: role field is accepted but IGNORED — always forced to STUDENT in the handler.
    // Removing the isIn(['STUDENT']) validator because:
    //   1. The handler already hardcodes requestedRole = 'STUDENT' (security is in the code)
    //   2. The validator was blocking requests that sent role='TEACHER' or no role with a
    //      generic "Validation failed" message instead of letting the code handle it
    body('role').optional().isString(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { schoolId } = req.body;
      // ROLE FIX: Honour the requested role for TEACHER and GUARDIAN join requests.
      // Previously forced to STUDENT regardless of what was sent — this made
      // teachers/guardians who self-joined appear as students until an admin
      // manually changed their role.
      //
      // Security: STUDENT/TEACHER/GUARDIAN are all safe education roles.
      // SCHOOL_ADMIN and SUPER_ADMIN cannot be self-requested (assertSafeMembershipRole
      // blocks them). The join flow always starts as PENDING so an admin must
      // approve before the membership becomes ACTIVE.
      const ALLOWED_JOIN_ROLES = ['STUDENT', 'TEACHER', 'GUARDIAN'];
      const requestedRole = ALLOWED_JOIN_ROLES.includes(req.body.role)
        ? req.body.role
        : 'STUDENT';

      // Defense-in-depth: block any attempt to self-request admin roles
      try { assertSafeMembershipRole(requestedRole, 'join'); }
      catch (e) { return errorResponse(res, e.message, 400); }

      // ONE-STUDENT-SCHOOL RULE: A user can only be a STUDENT in ONE school at a time.
      // They can be TEACHER or GUARDIAN in multiple schools simultaneously.
      // This prevents a student from being enrolled in multiple schools as a student.
      if (requestedRole === 'STUDENT') {
        const existingStudentMembership = await prisma.schoolMembership.findFirst({
          where: {
            userId: req.user.id,
            role: 'STUDENT',
            status: { in: ['ACTIVE', 'PENDING'] },
            deletedAt: null,
          },
          select: { schoolId: true, status: true, school: { select: { name: true } } }
        });
        if (existingStudentMembership) {
          const schoolName = existingStudentMembership.school?.name || 'another school';
          const statusText = existingStudentMembership.status === 'PENDING' ? 'pending' : 'active';
          return errorResponse(
            res,
            `You already have a ${statusText} student membership at ${schoolName}. A student can only be enrolled in one school at a time. You can still join as a Teacher or Guardian.`,
            409
          );
        }
      }

      // Verify school exists and is active
      const school = await prisma.school.findFirst({
        where: { id: schoolId, isActive: true, deletedAt: null },
        select: { id: true, name: true }
      });
      if (!school) return errorResponse(res, 'School not found or inactive', 404);

      // Check for existing membership
      const existing = await prisma.schoolMembership.findUnique({
        where: { userId_schoolId: { userId: req.user.id, schoolId } }
      });
      if (existing && existing.status === 'ACTIVE') {
        return errorResponse(res, 'You are already a member of this school', 409);
      }
      if (existing && existing.status === 'PENDING') {
        return errorResponse(res, 'You already have a pending request for this school', 409);
      }

      const membership = await prisma.schoolMembership.upsert({
        where: { userId_schoolId: { userId: req.user.id, schoolId } },
        create: {
          userId: req.user.id,
          schoolId,
          role: requestedRole,
          status: 'PENDING',
          joinedAt: new Date()
        },
        update: {
          role: requestedRole,
          status: 'PENDING',
          deletedAt: null
        }
      });

      await invalidateMembershipCache(req.user.id, schoolId);
      // Invalidate getMe cache so the sidebar reflects the new membership immediately
      await deleteGetMeCache(req.user.id);

      // NOTIFY ADMINS: Send a real-time socket notification + in-app notification to
      // all active SCHOOL_ADMIN members of this school so they can approve promptly.
      try {
        const { getIo } = require('../sockets');
        const io = getIo();

        // Find all active admins of this school
        const admins = await prisma.schoolMembership.findMany({
          where: { schoolId, role: { in: ['SCHOOL_ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE', deletedAt: null },
          select: { userId: true }
        });

        const joiner = req.user;
        const payload = {
          type: 'school:join_request',
          schoolId,
          schoolName: school.name,
          userId: joiner.id,
          userName: `${joiner.firstName} ${joiner.lastName}`,
          role: requestedRole,
          membershipId: membership.id,
        };

        if (io) {
          for (const admin of admins) {
            io.to(`user:${admin.userId}`).emit('school:join_request', payload);
          }
        }

        // Create in-app notifications for each admin
        if (admins.length > 0) {
          await prisma.notification.createMany({
            data: admins.map(admin => ({
              userId: admin.userId,
              type: 'SCHOOL_JOIN_REQUEST',
              title: `New join request — ${school.name}`,
              body: `${joiner.firstName} ${joiner.lastName} wants to join as ${requestedRole.replace(/_/g, ' ').toLowerCase()}`,
              data: JSON.stringify(payload),
              isRead: false,
            })),
            skipDuplicates: true,
          }).catch(() => {}); // non-fatal if notification table differs
        }

        logger.info(`[schoolMembership:join] Notified ${admins.length} admin(s) of join request in school ${schoolId}`);
      } catch (notifyErr) {
        // Non-fatal — membership was created, notification failed
        logger.warn(`[schoolMembership:join] Admin notification failed: ${notifyErr.message}`);
      }

      const roleLabel = requestedRole.replace(/_/g, ' ').toLowerCase();
      return successResponse(res, membership, `Join request sent to ${school.name} as ${roleLabel}. Awaiting admin approval.`, 201);
    } catch (error) { next(error); }
  }
);

// ─── POST /school-memberships/invite ─────────────────────────────────────────
// A school admin invites a user by email/userId.
router.post('/invite',
  [
    body('schoolId').notEmpty(),
    body('userEmail').isEmail().normalizeEmail(),
    body('role').isIn(['SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'GUARDIAN']).withMessage('Invalid education role')
  ],
  validate,
  requireSchoolMember('schoolId'),
  requireSchoolRole('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  async (req, res, next) => {
    try {
      const { schoolId, userEmail, role } = req.body;

      // DB-HARDENING: Defense-in-depth runtime guard.
      // Validator already blocks SUPER_ADMIN, but this ensures the role is safe
      // even if the validator is bypassed, misconfigured, or removed in the future.
      try { assertSafeMembershipRole(role, 'invite'); }
      catch (e) { return errorResponse(res, e.message, 400); }

      // Find user by email
      const invitee = await prisma.user.findUnique({
        where: { email: userEmail },
        select: { id: true, firstName: true, lastName: true, email: true }
      });
      if (!invitee) return errorResponse(res, 'User not found with that email', 404);

      // Check for existing active membership
      const existing = await prisma.schoolMembership.findUnique({
        where: { userId_schoolId: { userId: invitee.id, schoolId } }
      });
      if (existing && existing.status === 'ACTIVE') {
        return errorResponse(res, 'User is already a member of this school', 409);
      }

      const membership = await prisma.schoolMembership.upsert({
        where: { userId_schoolId: { userId: invitee.id, schoolId } },
        create: {
          userId: invitee.id,
          schoolId,
          role,
          status: 'ACTIVE',  // Admin invite → immediately active
          invitedBy: req.user.id,
          joinedAt: new Date()
        },
        update: {
          role,
          status: 'ACTIVE',
          invitedBy: req.user.id,
          deletedAt: null
        }
      });

      await invalidateMembershipCache(invitee.id, schoolId);
      // Invalidate invitee's getMe cache so their sidebar updates immediately
      await deleteGetMeCache(invitee.id);

      // AUTO-ENROLL: Invited STUDENTs go straight to ACTIVE, so enroll them
      // in the default class immediately (same as when an admin approves a join request).
      if (role === 'STUDENT') {
        try {
          await autoEnrollStudentInDefaultClass(invitee.id, schoolId);
        } catch (autoEnrollErr) {
          logger.warn(`[schoolMembership:invite] Auto-enroll failed for user ${invitee.id} in school ${schoolId}: ${autoEnrollErr.message}`);
        }
      }

      // PRIVILEGE-ESCALATION LOCK:
      // Only update User.schoolId for legacy backward-compat (so the school appears in
      // the legacy sidebar fallback). Do NOT touch User.role — education roles (TEACHER,
      // SCHOOL_ADMIN, STUDENT, GUARDIAN) belong EXCLUSIVELY in SchoolMembership, never
      // as global User.role values. Writing an education role to User.role would
      // contaminate the global authorization layer and open a path for role escalation
      // (even if SUPER_ADMIN is blocked by the validator today, future changes must not
      // rely on that single validator as the only barrier).
      const existingUserRole = invitee ? await prisma.user.findUnique({
        where: { id: invitee.id }, select: { schoolId: true, role: true }
      }) : null;
      if (existingUserRole && !existingUserRole.schoolId) {
        // Set schoolId only — NEVER set User.role from an invitation
        await prisma.user.update({
          where: { id: invitee.id },
          data: { schoolId }   // role intentionally omitted: belongs in SchoolMembership only
        });
      }

      // GAP FIX: If inviting as TEACHER, auto-create a Teacher profile record if one doesn't exist.
      // Without a Teacher record, the user passes middleware (effectiveRole = TEACHER) but fails
      // controller-level checks that look up prisma.teacher.findFirst({ where: { userId } }).
      // This ensures MEMBER+TEACHER membership users can immediately create grades, behavior logs,
      // audio courses, and join live classes as HOST without a separate admin step.
      if (role === 'TEACHER') {
        const existingTeacher = await prisma.teacher.findFirst({
          where: { userId: invitee.id, schoolId, deletedAt: null }
        });
        if (!existingTeacher) {
          await prisma.teacher.create({
            data: { userId: invitee.id, schoolId }
          });
          logger.info(`[schoolMembership:invite] Auto-created Teacher record for user ${invitee.id} in school ${schoolId}`);
        }
      }

      return successResponse(res, {
        membership,
        user: { id: invitee.id, firstName: invitee.firstName, lastName: invitee.lastName, email: invitee.email }
      }, `${invitee.firstName} invited successfully as ${role}`);
    } catch (error) { next(error); }
  }
);

// ─── PUT /school-memberships/:id/status ──────────────────────────────────────
// Admin approves/rejects/suspends a membership.
// M-4 NOTE: deleteGetMeCache is called after every status change so the
// user's frontend sidebar updates within the next request, not after 60s TTL.
router.put('/:id/status',
  [
    param('id').notEmpty(),
    body('status').isIn(['ACTIVE', 'PENDING', 'SUSPENDED']).withMessage('Invalid status')
  ],
  validate,
  async (req, res, next) => {
    try {
      const membership = await prisma.schoolMembership.findUnique({
        where: { id: req.params.id }
      });
      if (!membership) return errorResponse(res, 'Membership not found', 404);

      // ARCH-01: Only active school admins may update membership status.
      // SUPER_ADMIN is a platform administrator — they must have an explicit
      // SCHOOL_ADMIN or SUPER_ADMIN membership record in the target school.
      // There is no global bypass: administration is school-scoped.
      const callerMembership = await prisma.schoolMembership.findUnique({
        where: { userId_schoolId: { userId: req.user.id, schoolId: membership.schoolId } }
      });
      const isAdmin = callerMembership &&
        ['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(callerMembership.role) &&
        callerMembership.status === 'ACTIVE';

      if (!isAdmin) {
        return errorResponse(res, 'Only active school admins can update membership status', 403);
      }

      const updated = await prisma.schoolMembership.update({
        where: { id: req.params.id },
        data: { status: req.body.status }
      });

      // AUTO-ENROLL: When a STUDENT membership is approved (→ ACTIVE),
      // automatically create their Student profile (if missing) and enroll
      // them in the school's default class. This means students start learning
      // immediately — no extra admin steps needed. Teachers/admins can
      // reassign to a specific class later via the Classes page.
      if (req.body.status === 'ACTIVE' && membership.role === 'STUDENT') {
        try {
          await autoEnrollStudentInDefaultClass(membership.userId, membership.schoolId);
        } catch (autoEnrollErr) {
          // Non-fatal — membership is already activated, log and continue
          logger.warn(`[schoolMembership:status] Auto-enroll failed for user ${membership.userId} in school ${membership.schoolId}: ${autoEnrollErr.message}`);
        }
      }

      await invalidateMembershipCache(membership.userId, membership.schoolId);
      // Invalidate target user's getMe cache
      await deleteGetMeCache(membership.userId);

      return successResponse(res, updated, 'Membership status updated');
    } catch (error) { next(error); }
  }
);

// ─── PUT /school-memberships/:id/role ────────────────────────────────────────
// Admin changes a member's role within the school.
// M-4 FIX: Every role change immediately clears both the membership cache
// and the getMe cache so the user's sidebar reflects the new permissions
// on their next request, not after the 60s TTL expires.
router.put('/:id/role',
  [
    param('id').notEmpty(),
    body('role').isIn(['SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'GUARDIAN']).withMessage('Invalid education role')
  ],
  validate,
  async (req, res, next) => {
    try {
      // DB-HARDENING: Defense-in-depth runtime guard — assertSafeMembershipRole
      // blocks SUPER_ADMIN and any invalid role even if the validator above is
      // somehow bypassed (e.g. middleware reordering, future refactor).
      try { assertSafeMembershipRole(req.body.role, 'PUT /:id/role'); }
      catch (e) { return errorResponse(res, e.message, 400); }

      const membership = await prisma.schoolMembership.findUnique({
        where: { id: req.params.id }
      });
      if (!membership) return errorResponse(res, 'Membership not found', 404);

      // Caller must be an admin of the same school
      const callerMembership = await prisma.schoolMembership.findUnique({
        where: { userId_schoolId: { userId: req.user.id, schoolId: membership.schoolId } }
      });
      // ARCH-01: SUPER_ADMIN platform role is no longer a bypass.
      // Caller must have an ACTIVE SCHOOL_ADMIN or SUPER_ADMIN membership in the school.
      const isAdmin = callerMembership &&
        ['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(callerMembership.role) &&
        callerMembership.status === 'ACTIVE';

      if (!isAdmin) {
        return errorResponse(res, 'Only active school admins can change membership roles', 403);
      }

      // Prevent self-demotion of the only SUPER_ADMIN
      if (membership.role === 'SUPER_ADMIN' && req.body.role !== 'SUPER_ADMIN') {
        const otherSuperAdmins = await prisma.schoolMembership.count({
          where: {
            schoolId: membership.schoolId,
            role: 'SUPER_ADMIN',
            status: 'ACTIVE',
            id: { not: membership.id }
          }
        });
        if (otherSuperAdmins === 0) {
          return errorResponse(res, 'Cannot demote the only Super Admin. Assign another Super Admin first.', 400);
        }
      }

      const updated = await prisma.schoolMembership.update({
        where: { id: req.params.id },
        data: { role: req.body.role }
      });

      // GAP FIX: If changing role TO TEACHER, auto-create Teacher profile if missing.
      if (req.body.role === 'TEACHER') {
        const existingTeacher = await prisma.teacher.findFirst({
          where: { userId: membership.userId, schoolId: membership.schoolId, deletedAt: null }
        });
        if (!existingTeacher) {
          await prisma.teacher.create({
            data: { userId: membership.userId, schoolId: membership.schoolId }
          });
          logger.info(`[schoolMembership:role] Auto-created Teacher record for user ${membership.userId} in school ${membership.schoolId}`);
        }
      }

      // M-4 FIX: Invalidate both membership cache and getMe cache
      await invalidateMembershipCache(membership.userId, membership.schoolId);
      await deleteGetMeCache(membership.userId);

      return successResponse(res, updated, 'Membership role updated');
    } catch (error) { next(error); }
  }
);

// ─── DELETE /school-memberships/:id ──────────────────────────────────────────
// User leaves a school, OR admin removes a member.
router.delete('/:id',
  [param('id').notEmpty()],
  validate,
  async (req, res, next) => {
    try {
      const membership = await prisma.schoolMembership.findUnique({
        where: { id: req.params.id }
      });
      if (!membership) return errorResponse(res, 'Membership not found', 404);

      const isOwn = membership.userId === req.user.id;
      const callerMembership = await prisma.schoolMembership.findUnique({
        where: { userId_schoolId: { userId: req.user.id, schoolId: membership.schoolId } }
      });
      // ARCH-01: SUPER_ADMIN platform role no longer bypasses — must have a real membership.
      const isAdmin = callerMembership &&
        ['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(callerMembership.role);

      if (!isOwn && !isAdmin) {
        return errorResponse(res, 'You can only remove yourself or your own school members', 403);
      }

      // Soft delete
      await prisma.schoolMembership.update({
        where: { id: req.params.id },
        data: { status: 'INACTIVE', deletedAt: new Date() }
      });

      await invalidateMembershipCache(membership.userId, membership.schoolId);
      // Invalidate member's getMe cache so the school disappears from their sidebar
      await deleteGetMeCache(membership.userId);

      return successResponse(res, null, 'Left school successfully');
    } catch (error) { next(error); }
  }
);

// ─── GET /school-memberships/school/:schoolId ─────────────────────────────────
// List all members of a school (admin only).
router.get('/school/:schoolId',
  requireSchoolMember('schoolId'),
  requireSchoolRole('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  async (req, res, next) => {
    try {
      const { schoolId } = req.params;
      const { page = 1, limit = 50, role, status = 'ACTIVE' } = req.query;
      const { skip, ...pagination } = getPagination(page, limit);

      const where = {
        schoolId,
        ...(status && { status }),
        ...(role && { role }),
        deletedAt: null
      };

      const [members, total] = await Promise.all([
        prisma.schoolMembership.findMany({
          where,
          include: {
            user: {
              select: {
                id: true, firstName: true, lastName: true, email: true,
                avatarUrl: true, lastLoginAt: true
              }
            }
          },
          skip,
          take: pagination.limit,
          orderBy: { joinedAt: 'asc' }
        }),
        prisma.schoolMembership.count({ where })
      ]);

      return paginatedResponse(res, members, buildPaginationMeta(total, pagination.page, pagination.limit));
    } catch (error) { next(error); }
  }
);

// ─── POST /school-memberships/create-school ──────────────────────────────────
// Any authenticated user (except SUPER_ADMIN) can create a school and become its SCHOOL_ADMIN.
// PRIVILEGE-ESCALATION FIX: Creating a school does NOT grant SUPER_ADMIN (platform admin).
// The creator receives SchoolMembership.role = SCHOOL_ADMIN for that school only.
// User.role remains unchanged (MEMBER for new users).
// SUPER_ADMIN is reserved for HALQA internal platform administrators only.
// SA-SCHOOL-CREATE-02: SUPER_ADMIN must use POST /schools (admin endpoint) instead.
router.post('/create-school',
  // Block SUPER_ADMIN from this end-user school creation flow
  (req, res, next) => {
    if (req.user?.role === 'SUPER_ADMIN') {
      const { errorResponse } = require('../utils/response');
      return errorResponse(res, 'Platform administrators must use the admin panel to create schools.', 403);
    }
    return next();
  },
  createSchoolLimit,     // L-9 FIX: rate limit — 2 schools per user per 24h
  [
    body('name').trim().notEmpty().withMessage('School name is required'),
    body('slug').trim().notEmpty().withMessage('School slug is required'),
    body('type').optional().isIn(['school', 'academy', 'college', 'daycare', 'camp', 'sports'])
  ],
  validate,
  async (req, res, next) => {
    try {
      const { name, slug, type = 'school', description, address, city, state, country, phone, email: schoolEmail, website, timezone } = req.body;

      // Check slug uniqueness
      const existing = await prisma.school.findUnique({ where: { slug } });
      if (existing) return errorResponse(res, 'School slug already in use', 409);

      // Create school + membership + default class in a transaction
      const result = await prisma.$transaction(async (tx) => {
        const school = await tx.school.create({
          data: {
            name,
            slug,
            type,
            address:  address  || null,
            city:     city     || null,
            state:    state    || null,
            country:  country  || 'US',
            phone:    phone    || null,
            email:    schoolEmail || null,
            website:  website  || null,
            timezone: timezone || 'America/New_York'
          }
        });

        const membership = await tx.schoolMembership.create({
          data: {
            userId: req.user.id,
            schoolId: school.id,
            // PRIVILEGE-ESCALATION FIX:
            // School creators receive SCHOOL_ADMIN (school-scoped administration),
            // NOT SUPER_ADMIN (HALQA platform administration).
            // SUPER_ADMIN is reserved for internal HALQA platform operators and must
            // only be provisioned through a secure internal/database bootstrap process.
            // A normal user creating a school MUST NOT gain platform-wide privileges.
            role: 'SCHOOL_ADMIN',
            status: 'ACTIVE',
            joinedAt: new Date()
          }
        });

        // AUTO-CLASS: Create the school's default "General" class.
        // Every new school gets one default class so students who join have
        // somewhere to land immediately — no admin setup required.
        // Admins/teachers can create more classes and reassign students later.
        const defaultClass = await tx.class.create({
          data: {
            schoolId: school.id,
            name: 'General',
            description: 'Default class — all new members are enrolled here automatically. Rename or replace this class as needed.',
            capacity: 500,
            isActive: true,
            isDefault: true,
          }
        });

        // PRIVILEGE-ESCALATION FIX:
        // Do NOT promote User.role to SUPER_ADMIN on school creation.
        // The creator's global role stays unchanged (MEMBER for new users).
        // School administration is handled through SchoolMembership.role = SCHOOL_ADMIN.
        // Only update User.schoolId for legacy backward-compat (sidebar/effectiveRole fallback).
        const currentUser = await tx.user.findUnique({
          where: { id: req.user.id },
          select: { schoolId: true, role: true }
        });
        if (!currentUser.schoolId) {
          // Set legacy schoolId if not yet set — does NOT change User.role
          await tx.user.update({
            where: { id: req.user.id },
            data: { schoolId: school.id }
          });
        }

        return { school, membership, defaultClass };
      });

      // Save description via raw SQL — Prisma client was compiled before this column
      // was added so prisma.school.create/update doesn't know about it yet.
      // The column exists in the DB (migration 20260822_add_school_description).
      if (description) {
        await prisma.$executeRawUnsafe(
          'UPDATE schools SET description = ?, updatedAt = NOW() WHERE id = ?',
          description,
          result.school.id
        );
        result.school.description = description;
      }

      await invalidateMembershipCache(req.user.id, result.school.id);
      // Invalidate getMe cache so the new school appears in the sidebar immediately
      await deleteGetMeCache(req.user.id);

      logger.info(`[schoolMembership] User ${req.user.id} created school ${result.school.id} (${name}) with default class ${result.defaultClass.id}`);

      return successResponse(res, result, `School "${name}" created. You are now the School Admin.`, 201);
    } catch (error) { next(error); }
  }
);

module.exports = router;
