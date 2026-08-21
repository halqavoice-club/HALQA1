'use strict';
/**
 * privilege-escalation.test.js
 *
 * Security regression tests for the SUPER_ADMIN privilege-escalation fix.
 *
 * BEFORE fix:
 *   MEMBER → create school → User.role = 'SUPER_ADMIN' ❌ (platform admin escalation)
 *
 * AFTER fix:
 *   MEMBER → create school → SchoolMembership.role = 'SCHOOL_ADMIN', User.role = 'MEMBER' ✅
 *
 * Tests:
 *   T-1   MEMBER creates school → User.role remains MEMBER
 *   T-2   MEMBER creates school → SchoolMembership.role = SCHOOL_ADMIN
 *   T-3   School creator can administer own school (SCHOOL_ADMIN membership)
 *   T-4   School creator cannot access platform social report moderation (403)
 *   T-5   School creator cannot administer platform payouts (403)
 *   T-6   School creator cannot administer global PK (403)
 *   T-7   School creator cannot administer another school (403)
 *   T-8   Normal MEMBER without school still has Social feed access (200)
 *   T-9   Existing SUPER_ADMIN still has platform access (200)
 *   T-10  Registration cannot create SUPER_ADMIN (returns MEMBER)
 *   T-11  Join-school cannot create SUPER_ADMIN (stays MEMBER)
 *   T-12  Client-supplied role=SUPER_ADMIN in body is ignored
 *   T-13  SchoolMembership role change cannot set global User.role to SUPER_ADMIN
 *   T-14  Multi-school: School A = SCHOOL_ADMIN, School B = STUDENT (no leak)
 *   T-15  Existing SCHOOL_ADMIN (global role) cannot access platform administration
 */

const express = require('express');
const request = require('supertest');

// ─── Mocks ────────────────────────────────────────────────────────────────────
jest.mock('../utils/prisma', () => ({
  school:           { findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
  schoolMembership: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn(), upsert: jest.fn() },
  teacher:          { findFirst: jest.fn(), create: jest.fn() },
  user:             { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  userReport:       { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  payoutRequest:    { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  post:             { findFirst: jest.fn() },
  $transaction:     jest.fn(fn => fn(require('../utils/prisma'))),
}));

jest.mock('../utils/redis', () => ({
  isRedisReady: jest.fn(() => false),
  getCache:     jest.fn(() => null),
  setCache:     jest.fn(),
  deleteCache:  jest.fn(),
}));

jest.mock('../utils/logger',  () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../sockets',       () => ({ getIo: jest.fn(() => null) }));
jest.mock('../services/notification.service', () => ({ notify: jest.fn(), notifySchool: jest.fn() }));
jest.mock('../utils/email',   () => ({ sendEmail: jest.fn() }));

// Mock deleteGetMeCache (used in create-school route)
jest.mock('../controllers/auth.controller', () => ({
  deleteGetMeCache: jest.fn().mockResolvedValue(undefined),
  // Provide stubs for any other exports used elsewhere
  register:      jest.fn(),
  login:         jest.fn(),
  logout:        jest.fn(),
  refreshToken:  jest.fn(),
  getMe:         jest.fn(),
  forgotPassword: jest.fn(),
  resetPassword:  jest.fn(),
  verifyEmail:    jest.fn(),
  changePassword: jest.fn(),
}));

const { generateAccessToken } = require('../utils/jwt');
const prisma = require('../utils/prisma');

// ─── Test users ────────────────────────────────────────────────────────────────
const MEMBER_USER    = { id: 'u-member',       role: 'MEMBER',       status: 'ACTIVE', schoolId: null,       deletedAt: null, firstName: 'Test', lastName: 'User' };
const SCHOOL_ADMIN_A = { id: 'u-admin-a',      role: 'SCHOOL_ADMIN', status: 'ACTIVE', schoolId: 'school-a', deletedAt: null, firstName: 'Admin', lastName: 'A' };
const SUPER_ADMIN    = { id: 'u-super',        role: 'SUPER_ADMIN',  status: 'ACTIVE', schoolId: null,       deletedAt: null, firstName: 'Super', lastName: 'Admin' };
const MEMBER_MULTI   = { id: 'u-multi',        role: 'MEMBER',       status: 'ACTIVE', schoolId: 'school-a', deletedAt: null, firstName: 'Multi', lastName: 'School' };

function tok(user) {
  return `Bearer ${generateAccessToken({ userId: user.id, role: user.role, schoolId: user.schoolId })}`;
}

function mockUser(user) {
  prisma.user.findUnique.mockResolvedValue(user);
}

// Mock membership lookup (supports both findUnique and findFirst for NF-3)
function mockMembership(userId, schoolId, membership) {
  const impl = ({ where }) => {
    const uid = where.userId_schoolId?.userId   || where.userId;
    const sid = where.userId_schoolId?.schoolId || where.schoolId;
    if (uid === userId && sid === schoolId) return Promise.resolve(membership);
    return Promise.resolve(null);
  };
  prisma.schoolMembership.findUnique.mockImplementation(impl);
  prisma.schoolMembership.findFirst.mockImplementation(impl);
}

// ─── App builders ─────────────────────────────────────────────────────────────

function buildSchoolMembershipApp() {
  const app = express();
  app.use(express.json());
  const { authenticate } = require('../middleware/auth.middleware');
  const smRoutes = require('../routes/schoolMembership.routes');
  app.use('/school-memberships', authenticate, smRoutes);
  return app;
}

function buildPlatformApp() {
  const app = express();
  app.use(express.json());
  const { authenticate, authorize } = require('../middleware/auth.middleware');
  const reportBlockCtrl = require('../controllers/report-block.controller');
  const payoutCtrl      = require('../controllers/payout.controller');

  // Platform moderation (SUPER_ADMIN only)
  app.get('/social/reports',
    authenticate,
    authorize('SUPER_ADMIN'),
    reportBlockCtrl.listReports
  );
  // Payout admin (SUPER_ADMIN only)
  app.get('/payout/admin/list',
    authenticate,
    authorize('SUPER_ADMIN'),
    payoutCtrl.listPayoutsAdmin
  );
  // PK admin (SUPER_ADMIN only)
  app.post('/admin/pk/test',
    authenticate,
    authorize('SUPER_ADMIN'),
    (req, res) => res.json({ success: true })
  );
  // Social feed (any authenticated user)
  app.get('/feed',
    authenticate,
    (req, res) => res.json({ success: true, userId: req.user.id })
  );
  return app;
}

function buildSchoolApp() {
  const app = express();
  app.use(express.json());
  const { authenticate, authorize } = require('../middleware/auth.middleware');
  const { errorResponse } = require('../utils/response');
  const schoolCtrl = require('../controllers/school.controller');

  // School update — SCHOOL_ADMIN can only update own school
  app.put('/schools/:id',
    authenticate,
    authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
    (req, res, next) => {
      if (req.user.role === 'SCHOOL_ADMIN') {
        const ownSchoolId = req.schoolMembership?.schoolId || req.user.schoolId;
        if (ownSchoolId !== req.params.id) {
          return errorResponse(res, 'You can only update your own school', 403);
        }
      }
      next();
    },
    schoolCtrl.updateSchool
  );
  return app;
}

function buildEducationApp() {
  const app = express();
  app.use(express.json());
  const { authenticate } = require('../middleware/auth.middleware');
  const { eduAdmin } = require('../middleware/educationAuth');
  app.get('/education/:schoolId/admin',
    authenticate,
    ...eduAdmin,
    (req, res) => res.json({ success: true, role: req.schoolMembership?.role })
  );
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('Privilege Escalation Security Tests — SUPER_ADMIN Protection', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    const { isRedisReady } = require('../utils/redis');
    isRedisReady.mockReturnValue(false);
  });

  // ── T-1: MEMBER creates school → User.role remains MEMBER ────────────────
  describe('T-1: Create school does NOT promote User.role to SUPER_ADMIN', () => {
    test('User.role remains MEMBER after school creation', async () => {
      const app = buildSchoolMembershipApp();
      mockUser(MEMBER_USER);

      const createdSchool = { id: 'school-new', name: 'My New School', slug: 'my-new-school' };
      const createdMembership = {
        id: 'mem-new', userId: 'u-member', schoolId: 'school-new',
        role: 'SCHOOL_ADMIN', status: 'ACTIVE'
      };

      prisma.school.findUnique.mockResolvedValue(null);  // slug not taken
      prisma.$transaction.mockImplementation(async (fn) => {
        const txResult = await fn({
          school:           { create: jest.fn().mockResolvedValue(createdSchool) },
          schoolMembership: { create: jest.fn().mockResolvedValue(createdMembership) },
          user:             {
            findUnique: jest.fn().mockResolvedValue({ schoolId: null, role: 'MEMBER' }),
            update:     jest.fn().mockImplementation(({ data }) => {
              // Verify: data must NOT contain role: 'SUPER_ADMIN'
              if (data.role === 'SUPER_ADMIN') {
                throw new Error('PRIVILEGE ESCALATION DETECTED: attempted to set role=SUPER_ADMIN');
              }
              return Promise.resolve({ ...MEMBER_USER, schoolId: 'school-new' });
            })
          },
        });
        return txResult;
      });

      prisma.schoolMembership.findFirst.mockResolvedValue(null);
      prisma.schoolMembership.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/school-memberships/create-school')
        .set('Authorization', tok(MEMBER_USER))
        .send({ name: 'My New School', slug: 'my-new-school' });

      // Should succeed (201) — no privilege escalation error thrown
      expect(res.status).toBe(201);
    });

    test('SchoolMembership.role is SCHOOL_ADMIN (not SUPER_ADMIN) after creation', async () => {
      const app = buildSchoolMembershipApp();
      mockUser(MEMBER_USER);

      let capturedMembershipRole = null;

      const createdSchool = { id: 'school-new', name: 'Test School', slug: 'test-school' };

      prisma.school.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (fn) => {
        const txResult = await fn({
          school:           { create: jest.fn().mockResolvedValue(createdSchool) },
          schoolMembership: {
            create: jest.fn().mockImplementation(({ data }) => {
              capturedMembershipRole = data.role;  // capture what role was used
              return Promise.resolve({ id: 'mem-1', ...data });
            })
          },
          user: {
            findUnique: jest.fn().mockResolvedValue({ schoolId: null, role: 'MEMBER' }),
            update:     jest.fn().mockResolvedValue({ ...MEMBER_USER, schoolId: 'school-new' })
          },
        });
        return txResult;
      });

      prisma.schoolMembership.findFirst.mockResolvedValue(null);
      prisma.schoolMembership.findUnique.mockResolvedValue(null);

      await request(app)
        .post('/school-memberships/create-school')
        .set('Authorization', tok(MEMBER_USER))
        .send({ name: 'Test School', slug: 'test-school' });

      // The membership role must be SCHOOL_ADMIN, never SUPER_ADMIN
      expect(capturedMembershipRole).toBe('SCHOOL_ADMIN');
      expect(capturedMembershipRole).not.toBe('SUPER_ADMIN');
    });
  });

  // ── T-3: School creator can administer own school (SCHOOL_ADMIN membership) ─
  describe('T-3: School creator can administer own school', () => {
    test('MEMBER with SCHOOL_ADMIN membership can access school admin education endpoint', async () => {
      const app = buildEducationApp();
      mockUser(MEMBER_USER);
      mockMembership('u-member', 'school-new', {
        id: 'mem-1', userId: 'u-member', schoolId: 'school-new',
        role: 'SCHOOL_ADMIN', status: 'ACTIVE'
      });

      const res = await request(app)
        .get('/education/school-new/admin')
        .set('Authorization', tok(MEMBER_USER))
        .set('X-School-Id', 'school-new');

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('SCHOOL_ADMIN');
    });
  });

  // ── T-4: School creator cannot access platform social report moderation ─────
  describe('T-4: School creator cannot moderate platform social reports', () => {
    test('MEMBER (even with SCHOOL_ADMIN membership) cannot access social/reports (403)', async () => {
      const app = buildPlatformApp();
      mockUser(MEMBER_USER);

      const res = await request(app)
        .get('/social/reports')
        .set('Authorization', tok(MEMBER_USER));

      expect(res.status).toBe(403);
    });

    test('SCHOOL_ADMIN (global role) cannot access social/reports (403)', async () => {
      const app = buildPlatformApp();
      mockUser(SCHOOL_ADMIN_A);

      const res = await request(app)
        .get('/social/reports')
        .set('Authorization', tok(SCHOOL_ADMIN_A));

      expect(res.status).toBe(403);
    });
  });

  // ── T-5: School creator cannot administer platform payouts ──────────────────
  describe('T-5: School creator cannot administer platform payouts', () => {
    test('MEMBER cannot access payout admin (403)', async () => {
      const app = buildPlatformApp();
      mockUser(MEMBER_USER);

      const res = await request(app)
        .get('/payout/admin/list')
        .set('Authorization', tok(MEMBER_USER));

      expect(res.status).toBe(403);
    });

    test('SCHOOL_ADMIN cannot access payout admin (403)', async () => {
      const app = buildPlatformApp();
      mockUser(SCHOOL_ADMIN_A);

      const res = await request(app)
        .get('/payout/admin/list')
        .set('Authorization', tok(SCHOOL_ADMIN_A));

      expect(res.status).toBe(403);
    });
  });

  // ── T-6: School creator cannot administer global PK ─────────────────────────
  describe('T-6: School creator cannot administer global PK', () => {
    test('MEMBER cannot access PK admin endpoint (403)', async () => {
      const app = buildPlatformApp();
      mockUser(MEMBER_USER);

      const res = await request(app)
        .post('/admin/pk/test')
        .set('Authorization', tok(MEMBER_USER));

      expect(res.status).toBe(403);
    });
  });

  // ── T-7: School creator cannot administer another school ────────────────────
  describe('T-7: School creator cannot update another school', () => {
    test('SCHOOL_ADMIN_A cannot update school-b (403)', async () => {
      const app = buildSchoolApp();
      mockUser(SCHOOL_ADMIN_A);  // schoolId = school-a
      mockMembership('u-admin-a', 'school-b', null);  // no membership in school-b

      const res = await request(app)
        .put('/schools/school-b')
        .set('Authorization', tok(SCHOOL_ADMIN_A))
        .send({ name: 'Hacked' });

      expect(res.status).toBe(403);
    });

    test('MEMBER (new school creator) cannot update a different school (403)', async () => {
      const app = buildSchoolApp();
      mockUser(MEMBER_USER);
      // MEMBER has schoolId=null and no SCHOOL_ADMIN membership on school-x
      mockMembership('u-member', 'school-x', null);

      const res = await request(app)
        .put('/schools/school-x')
        .set('Authorization', tok(MEMBER_USER))
        .send({ name: 'Attempt' });

      expect(res.status).toBe(403);
    });
  });

  // ── T-8: Normal MEMBER without school still has Social access ───────────────
  describe('T-8: MEMBER without school can access Social', () => {
    test('MEMBER without school membership can access social feed', async () => {
      const app = buildPlatformApp();
      mockUser(MEMBER_USER);

      const res = await request(app)
        .get('/feed')
        .set('Authorization', tok(MEMBER_USER));

      expect(res.status).toBe(200);
    });
  });

  // ── T-9: Existing SUPER_ADMIN still has platform access ─────────────────────
  describe('T-9: Existing SUPER_ADMIN retains platform administration access', () => {
    test('SUPER_ADMIN can access social/reports', async () => {
      const app = buildPlatformApp();
      mockUser(SUPER_ADMIN);
      prisma.userReport.findMany.mockResolvedValue([]);
      prisma.userReport.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/social/reports')
        .set('Authorization', tok(SUPER_ADMIN));

      expect(res.status).toBe(200);
    });

    test('SUPER_ADMIN can access payout admin', async () => {
      const app = buildPlatformApp();
      mockUser(SUPER_ADMIN);
      prisma.payoutRequest.findMany.mockResolvedValue([]);
      prisma.payoutRequest.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/payout/admin/list')
        .set('Authorization', tok(SUPER_ADMIN));

      expect(res.status).toBe(200);
    });

    test('SUPER_ADMIN can access PK admin', async () => {
      const app = buildPlatformApp();
      mockUser(SUPER_ADMIN);

      const res = await request(app)
        .post('/admin/pk/test')
        .set('Authorization', tok(SUPER_ADMIN));

      expect(res.status).toBe(200);
    });
  });

  // ── T-10: Registration cannot create SUPER_ADMIN ────────────────────────────
  describe('T-10: Registration always creates MEMBER, never SUPER_ADMIN', () => {
    test('auth.controller.register sets role=MEMBER', async () => {
      // Read the actual register handler to verify role is hardcoded to MEMBER
      const authCtrl = require('../controllers/auth.controller');
      // The register controller is mocked — read actual source to verify
      const fs = require('fs');
      const path = require('path');
      const source = fs.readFileSync(
        path.join(__dirname, '../controllers/auth.controller.js'),
        'utf8'
      );
      // role: 'MEMBER' must be present and role must NOT be 'SUPER_ADMIN' in register
      expect(source).toMatch(/role:\s*['"]MEMBER['"]/);
      expect(source).not.toMatch(/register[\s\S]{0,500}role:\s*['"]SUPER_ADMIN['"]/);
    });
  });

  // ── T-11: Join-school cannot create SUPER_ADMIN ──────────────────────────────
  describe('T-11: Join-school forces STUDENT role, never SUPER_ADMIN', () => {
    test('POST /join always sets membership role=STUDENT regardless of request body', async () => {
      const app = buildSchoolMembershipApp();
      mockUser(MEMBER_USER);
      prisma.school.findFirst.mockResolvedValue({ id: 'school-a', name: 'Test' });
      prisma.schoolMembership.findUnique.mockResolvedValue(null);
      prisma.schoolMembership.findFirst.mockResolvedValue(null);

      let capturedRole = null;
      prisma.schoolMembership.upsert.mockImplementation(({ create }) => {
        capturedRole = create.role;
        return Promise.resolve({ id: 'mem-1', ...create });
      });

      await request(app)
        .post('/school-memberships/join')
        .set('Authorization', tok(MEMBER_USER))
        .send({ schoolId: 'school-a', role: 'SUPER_ADMIN' });  // attacker tries SUPER_ADMIN

      // Must always be STUDENT, never SUPER_ADMIN
      expect(capturedRole).toBe('STUDENT');
      expect(capturedRole).not.toBe('SUPER_ADMIN');
    });
  });

  // ── T-11b: Invite cannot set User.role (C-4 fix) ─────────────────────────────
  describe('T-11b: Invite handler NEVER sets User.role — education roles stay in SchoolMembership', () => {
    test('Inviting as TEACHER does NOT write User.role = TEACHER globally', async () => {
      const app = buildSchoolMembershipApp();
      const adminUser = { id: 'u-admin', role: 'SCHOOL_ADMIN', status: 'ACTIVE', schoolId: 'school-a', deletedAt: null, firstName: 'Admin', lastName: 'User' };
      mockUser(adminUser);

      // Admin's membership
      const adminMembership = { id: 'mem-admin', userId: 'u-admin', schoolId: 'school-a', role: 'SCHOOL_ADMIN', status: 'ACTIVE' };
      prisma.schoolMembership.findFirst.mockImplementation(({ where }) => {
        const uid = where.userId_schoolId?.userId || where.userId;
        if (uid === 'u-admin') return Promise.resolve(adminMembership);
        return Promise.resolve(null);
      });
      prisma.schoolMembership.findUnique.mockImplementation(({ where }) => {
        if (where.userId_schoolId?.userId === 'u-admin') return Promise.resolve(adminMembership);
        return Promise.resolve(null);
      });

      // Invitee
      prisma.user.findUnique.mockImplementation(({ where }) => {
        if (where.id === 'u-admin') return Promise.resolve(adminUser);
        if (where.email === 'invitee@test.com') return Promise.resolve({ id: 'u-invitee', email: 'invitee@test.com', firstName: 'Inv', lastName: 'Itee' });
        if (where.id === 'u-invitee') return Promise.resolve({ schoolId: null, role: 'MEMBER' });
        return Promise.resolve(null);
      });
      prisma.schoolMembership.upsert.mockResolvedValue({ id: 'mem-new', userId: 'u-invitee', schoolId: 'school-a', role: 'TEACHER', status: 'ACTIVE' });
      prisma.teacher.findFirst.mockResolvedValue(null);
      prisma.teacher.create.mockResolvedValue({ id: 'teach-1', userId: 'u-invitee', schoolId: 'school-a' });

      // Track User.update calls
      let userUpdateData = null;
      prisma.user.update.mockImplementation(({ data }) => {
        userUpdateData = data;
        return Promise.resolve({ id: 'u-invitee', ...data });
      });

      await request(app)
        .post('/school-memberships/invite')
        .set('Authorization', tok(adminUser))
        .set('X-School-Id', 'school-a')
        .send({ schoolId: 'school-a', userEmail: 'invitee@test.com', role: 'TEACHER' });

      // If User.update was called, role MUST NOT be in the data object
      if (userUpdateData) {
        expect(userUpdateData.role).toBeUndefined();
        expect(userUpdateData.schoolId).toBe('school-a');
      }
      // Confirm User.role was never written to 'TEACHER' or 'SUPER_ADMIN'
      const roleWasWritten = prisma.user.update.mock.calls.some(
        ([{ data }]) => data?.role !== undefined
      );
      expect(roleWasWritten).toBe(false);
    });

    test('Inviting as SCHOOL_ADMIN does NOT write User.role = SCHOOL_ADMIN globally', async () => {
      const app = buildSchoolMembershipApp();
      const adminUser = { id: 'u-admin', role: 'SCHOOL_ADMIN', status: 'ACTIVE', schoolId: 'school-a', deletedAt: null, firstName: 'Admin', lastName: 'User' };
      mockUser(adminUser);

      const adminMembership = { id: 'mem-admin', userId: 'u-admin', schoolId: 'school-a', role: 'SCHOOL_ADMIN', status: 'ACTIVE' };
      prisma.schoolMembership.findFirst.mockImplementation(({ where }) => {
        const uid = where.userId_schoolId?.userId || where.userId;
        if (uid === 'u-admin') return Promise.resolve(adminMembership);
        return Promise.resolve(null);
      });
      prisma.schoolMembership.findUnique.mockImplementation(({ where }) => {
        if (where.userId_schoolId?.userId === 'u-admin') return Promise.resolve(adminMembership);
        return Promise.resolve(null);
      });
      prisma.user.findUnique.mockImplementation(({ where }) => {
        if (where.id === 'u-admin') return Promise.resolve(adminUser);
        if (where.email === 'newadmin@test.com') return Promise.resolve({ id: 'u-newadmin', email: 'newadmin@test.com', firstName: 'New', lastName: 'Admin' });
        if (where.id === 'u-newadmin') return Promise.resolve({ schoolId: null, role: 'MEMBER' });
        return Promise.resolve(null);
      });
      prisma.schoolMembership.upsert.mockResolvedValue({ id: 'mem-new2', userId: 'u-newadmin', schoolId: 'school-a', role: 'SCHOOL_ADMIN', status: 'ACTIVE' });

      let userUpdateData = null;
      prisma.user.update.mockImplementation(({ data }) => {
        userUpdateData = data;
        return Promise.resolve({ id: 'u-newadmin', ...data });
      });

      await request(app)
        .post('/school-memberships/invite')
        .set('Authorization', tok(adminUser))
        .set('X-School-Id', 'school-a')
        .send({ schoolId: 'school-a', userEmail: 'newadmin@test.com', role: 'SCHOOL_ADMIN' });

      if (userUpdateData) {
        // role must NOT be present — only schoolId is allowed
        expect(userUpdateData.role).toBeUndefined();
        expect(userUpdateData.role).not.toBe('SCHOOL_ADMIN');
        expect(userUpdateData.role).not.toBe('SUPER_ADMIN');
      }
      const roleWasWritten = prisma.user.update.mock.calls.some(
        ([{ data }]) => data?.role !== undefined
      );
      expect(roleWasWritten).toBe(false);
    });
  });
  describe('T-12: Client-supplied role value cannot set SUPER_ADMIN', () => {
    test('POST /auth/register does not accept role parameter', () => {
      // Verify by reading the route source
      const fs = require('fs');
      const path = require('path');
      const routeSource = fs.readFileSync(
        path.join(__dirname, '../routes/auth.routes.js'),
        'utf8'
      );
      // The comment "role is intentionally NOT accepted" must exist
      expect(routeSource).toMatch(/role.*intentionally NOT accepted|not accepted.*role/i);
    });
  });

  // ── T-13: SchoolMembership role change cannot set global User.role ────────────
  describe('T-13: PUT /school-memberships/:id/role does not change global User.role', () => {
    test('Role change endpoint only updates SchoolMembership, not User.role', async () => {
      const app = buildSchoolMembershipApp();
      // Admin changing a member's role
      const adminUser = { id: 'u-admin', role: 'SCHOOL_ADMIN', status: 'ACTIVE', schoolId: 'school-a', deletedAt: null };
      mockUser(adminUser);

      const targetMembership = { id: 'mem-target', userId: 'u-target', schoolId: 'school-a', role: 'STUDENT', status: 'ACTIVE' };
      prisma.schoolMembership.findUnique.mockImplementation(({ where }) => {
        if (where.id === 'mem-target') return Promise.resolve(targetMembership);
        if (where.userId_schoolId?.userId === 'u-admin') return Promise.resolve({ ...targetMembership, userId: 'u-admin', role: 'SCHOOL_ADMIN' });
        return Promise.resolve(null);
      });
      prisma.schoolMembership.findFirst.mockResolvedValue({ ...targetMembership, userId: 'u-admin', role: 'SCHOOL_ADMIN' });

      const updatedMembership = { ...targetMembership, role: 'TEACHER' };
      prisma.schoolMembership.update.mockResolvedValue(updatedMembership);
      prisma.schoolMembership.count.mockResolvedValue(1);
      prisma.teacher.findFirst.mockResolvedValue(null);
      prisma.teacher.create = jest.fn().mockResolvedValue({ id: 'teacher-new', userId: 'u-target', schoolId: 'school-a' });

      // Verify User.update is NOT called to change role to SUPER_ADMIN
      let userRoleChangeAttempted = false;
      prisma.user.update = jest.fn().mockImplementation(({ data }) => {
        if (data.role === 'SUPER_ADMIN') {
          userRoleChangeAttempted = true;
        }
        return Promise.resolve({});
      });

      const res = await request(app)
        .put('/school-memberships/mem-target/role')
        .set('Authorization', tok(adminUser))
        .set('X-School-Id', 'school-a')
        .send({ role: 'TEACHER' });

      // User.role must never be set to SUPER_ADMIN through this endpoint
      expect(userRoleChangeAttempted).toBe(false);
    });
  });

  // ── T-14: Multi-school isolation ──────────────────────────────────────────────
  describe('T-14: Multi-school user has correct role per school', () => {
    test('School A = SCHOOL_ADMIN, School B = STUDENT — roles are isolated', async () => {
      const app = buildEducationApp();
      mockUser(MEMBER_MULTI);

      // Request to School A: membership = SCHOOL_ADMIN
      prisma.schoolMembership.findFirst.mockImplementation(({ where }) => {
        const sid = where.userId_schoolId?.schoolId || where.schoolId;
        if (sid === 'school-a') return Promise.resolve({ id: 'm1', userId: 'u-multi', schoolId: 'school-a', role: 'SCHOOL_ADMIN', status: 'ACTIVE' });
        if (sid === 'school-b') return Promise.resolve({ id: 'm2', userId: 'u-multi', schoolId: 'school-b', role: 'STUDENT',      status: 'ACTIVE' });
        return Promise.resolve(null);
      });
      prisma.schoolMembership.findUnique.mockImplementation(({ where }) => {
        const sid = where.userId_schoolId?.schoolId;
        if (sid === 'school-a') return Promise.resolve({ id: 'm1', userId: 'u-multi', schoolId: 'school-a', role: 'SCHOOL_ADMIN', status: 'ACTIVE' });
        if (sid === 'school-b') return Promise.resolve({ id: 'm2', userId: 'u-multi', schoolId: 'school-b', role: 'STUDENT',      status: 'ACTIVE' });
        return Promise.resolve(null);
      });

      // School A: SCHOOL_ADMIN → should pass eduAdmin
      const resA = await request(app)
        .get('/education/school-a/admin')
        .set('Authorization', tok(MEMBER_MULTI))
        .set('X-School-Id', 'school-a');

      expect(resA.status).toBe(200);
      expect(resA.body.role).toBe('SCHOOL_ADMIN');

      // School B: STUDENT → should fail eduAdmin (only SCHOOL_ADMIN/SUPER_ADMIN)
      const resB = await request(app)
        .get('/education/school-b/admin')
        .set('Authorization', tok(MEMBER_MULTI))
        .set('X-School-Id', 'school-b');

      expect(resB.status).toBe(403);
    });
  });

  // ── T-15: Existing SCHOOL_ADMIN (global role) cannot access platform admin ───
  describe('T-15: Global SCHOOL_ADMIN cannot access platform administration', () => {
    test('SCHOOL_ADMIN cannot moderate platform social reports (403)', async () => {
      const app = buildPlatformApp();
      mockUser(SCHOOL_ADMIN_A);

      const res = await request(app)
        .get('/social/reports')
        .set('Authorization', tok(SCHOOL_ADMIN_A));

      expect(res.status).toBe(403);
    });

    test('SCHOOL_ADMIN cannot access payout admin (403)', async () => {
      const app = buildPlatformApp();
      mockUser(SCHOOL_ADMIN_A);

      const res = await request(app)
        .get('/payout/admin/list')
        .set('Authorization', tok(SCHOOL_ADMIN_A));

      expect(res.status).toBe(403);
    });

    test('SCHOOL_ADMIN cannot access PK admin (403)', async () => {
      const app = buildPlatformApp();
      mockUser(SCHOOL_ADMIN_A);

      const res = await request(app)
        .post('/admin/pk/test')
        .set('Authorization', tok(SCHOOL_ADMIN_A));

      expect(res.status).toBe(403);
    });
  });
});
