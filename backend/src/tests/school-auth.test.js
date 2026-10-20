/**
 * school-auth.test.js
 *
 * Authorization boundary tests for the Social/Education separation.
 *
 * Tests verify:
 *   1. Social access is independent of school membership
 *   2. Education access requires school membership + correct role
 *   3. School data is isolated between schools
 *   4. Education roles are NOT global HALQA roles
 *   5. Direct API parameter manipulation is rejected server-side
 *
 * These tests use Jest + Supertest against an Express app built
 * from the actual middleware — no mocking of auth logic itself.
 */

const express = require('express');
const request = require('supertest');

// ─── Mock Prisma ──────────────────────────────────────────────────────────────
jest.mock('../utils/prisma', () => {
  const mockMembership = (userId, schoolId, role, status = 'ACTIVE') => ({
    id: `mem-${userId}-${schoolId}`,
    userId,
    schoolId,
    role,
    status,
  });

  return {
    user: {
      findUnique: jest.fn(),
    },
    schoolMembership: {
      findUnique: jest.fn(),
      findFirst:  jest.fn(),
    },
    $disconnect: jest.fn(),
  };
});

jest.mock('../utils/redis', () => ({
  isRedisReady: jest.fn(() => false), // disable cache in tests — always hit DB mock
  getCache: jest.fn(() => null),
  setCache: jest.fn(),
  deleteCache: jest.fn(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────
const { generateAccessToken } = require('../utils/jwt');
const prisma = require('../utils/prisma');

function makeToken(userId, role, schoolId = null) {
  return generateAccessToken({ userId, role, schoolId });
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

// Standard test user shapes
const USERS = {
  // Social-only user — no school
  socialMember: { id: 'u-social', role: 'MEMBER', status: 'ACTIVE', schoolId: null },

  // Legacy users with global Education roles
  teacher: { id: 'u-teacher', role: 'TEACHER', status: 'ACTIVE', schoolId: 'school-a' },
  student: { id: 'u-student', role: 'STUDENT', status: 'ACTIVE', schoolId: 'school-a' },
  guardian: { id: 'u-guardian', role: 'GUARDIAN', status: 'ACTIVE', schoolId: 'school-a' },
  schoolAdmin: { id: 'u-admin', role: 'SCHOOL_ADMIN', status: 'ACTIVE', schoolId: 'school-a' },
  superAdmin: { id: 'u-super', role: 'SUPER_ADMIN', status: 'ACTIVE', schoolId: 'school-a' },

  // User belonging to School B (not School A)
  otherSchoolUser: { id: 'u-other', role: 'TEACHER', status: 'ACTIVE', schoolId: 'school-b' },
};

const MEMBERSHIPS = {
  teacher_schoolA: { id: 'mem-1', userId: 'u-teacher', schoolId: 'school-a', role: 'TEACHER', status: 'ACTIVE' },
  student_schoolA: { id: 'mem-2', userId: 'u-student', schoolId: 'school-a', role: 'STUDENT', status: 'ACTIVE' },
  guardian_schoolA: { id: 'mem-3', userId: 'u-guardian', schoolId: 'school-a', role: 'GUARDIAN', status: 'ACTIVE' },
  admin_schoolA: { id: 'mem-4', userId: 'u-admin', schoolId: 'school-a', role: 'SCHOOL_ADMIN', status: 'ACTIVE' },
  super_schoolA: { id: 'mem-5', userId: 'u-super', schoolId: 'school-a', role: 'SUPER_ADMIN', status: 'ACTIVE' },
  other_schoolB: { id: 'mem-6', userId: 'u-other', schoolId: 'school-b', role: 'TEACHER', status: 'ACTIVE' },
};

// ─── Test app factory ─────────────────────────────────────────────────────────
// Builds a minimal Express app with just the middleware under test.

function buildApp() {
  const app = express();
  app.use(express.json());

  const { authenticate, authorize } = require('../middleware/auth.middleware');
  const { requireSchoolMember, requireSchoolRole } = require('../middleware/schoolAuth.middleware');

  // ── Social route — only requires authentication ────────────────────────────
  app.get('/api/v1/feed', authenticate, (req, res) => {
    res.json({ success: true, userId: req.user.id, message: 'Social feed — no school required' });
  });

  // ── Education route — requires school membership ──────────────────────────
  app.get('/api/v1/education/:schoolId/students',
    authenticate,
    requireSchoolMember('schoolId'),
    (req, res) => {
      res.json({ success: true, schoolId: req.params.schoolId, role: req.schoolMembership?.role });
    }
  );

  // ── Education route — requires specific school role ───────────────────────
  app.get('/api/v1/education/:schoolId/grades',
    authenticate,
    requireSchoolMember('schoolId'),
    requireSchoolRole('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
    (req, res) => {
      res.json({ success: true, role: req.schoolMembership?.role });
    }
  );

  // ── Admin-only social route (report review) ───────────────────────────────
  app.get('/api/v1/social/admin/reports',
    authenticate,
    authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
    (req, res) => {
      res.json({ success: true });
    }
  );

  return app;
}

// ─── Mock setup helpers ───────────────────────────────────────────────────────
function mockUser(user) {
  prisma.user.findUnique.mockResolvedValue(user);
}

function mockMembership(membership) {
  // NF-3: loadMembership now uses findFirst (with deletedAt: null filter).
  // Mock both findUnique (cache fallback) and findFirst (DB query) for full coverage.
  const impl = ({ where }) => {
    if (!membership) return Promise.resolve(null);
    const userId   = where.userId_schoolId?.userId   || where.userId;
    const schoolId = where.userId_schoolId?.schoolId || where.schoolId;
    if (membership.userId === userId && membership.schoolId === schoolId) {
      return Promise.resolve(membership);
    }
    return Promise.resolve(null);
  };
  prisma.schoolMembership.findUnique.mockImplementation(impl);
  prisma.schoolMembership.findFirst.mockImplementation(impl);
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('Social/Education Authorization Separation', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── SOCIAL PLATFORM TESTS ─────────────────────────────────────────────────
  describe('Social Platform — Independent of school membership', () => {
    test('MEMBER (social-only user) can access social feed', async () => {
      mockUser(USERS.socialMember);
      const token = makeToken('u-social', 'MEMBER');

      const res = await request(app)
        .get('/api/v1/feed')
        .set(authHeader(token));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('TEACHER can access social feed (Social independent of Education role)', async () => {
      mockUser(USERS.teacher);
      const token = makeToken('u-teacher', 'TEACHER', 'school-a');

      const res = await request(app)
        .get('/api/v1/feed')
        .set(authHeader(token));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('STUDENT can access social feed', async () => {
      mockUser(USERS.student);
      const token = makeToken('u-student', 'STUDENT', 'school-a');

      const res = await request(app)
        .get('/api/v1/feed')
        .set(authHeader(token));

      expect(res.status).toBe(200);
    });

    test('GUARDIAN can access social feed', async () => {
      mockUser(USERS.guardian);
      const token = makeToken('u-guardian', 'GUARDIAN', 'school-a');

      const res = await request(app)
        .get('/api/v1/feed')
        .set(authHeader(token));

      expect(res.status).toBe(200);
    });

    test('SCHOOL_ADMIN can access social feed', async () => {
      mockUser(USERS.schoolAdmin);
      const token = makeToken('u-admin', 'SCHOOL_ADMIN', 'school-a');

      const res = await request(app)
        .get('/api/v1/feed')
        .set(authHeader(token));

      expect(res.status).toBe(200);
    });

    test('Unauthenticated request is rejected', async () => {
      const res = await request(app).get('/api/v1/feed');
      expect(res.status).toBe(401);
    });
  });

  // ── EDUCATION ACCESS TESTS ────────────────────────────────────────────────
  describe('Education — Requires school membership', () => {
    test('MEMBER (no school) cannot access school education data', async () => {
      mockUser(USERS.socialMember);
      mockMembership(null); // no membership
      const token = makeToken('u-social', 'MEMBER');

      const res = await request(app)
        .get('/api/v1/education/school-a/students')
        .set(authHeader(token));

      expect(res.status).toBe(403);
    });

    test('TEACHER with valid membership can access education data', async () => {
      mockUser(USERS.teacher);
      mockMembership(MEMBERSHIPS.teacher_schoolA);
      const token = makeToken('u-teacher', 'TEACHER', 'school-a');

      const res = await request(app)
        .get('/api/v1/education/school-a/students')
        .set(authHeader(token));

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('TEACHER');
    });

    test('STUDENT with valid membership can access education data', async () => {
      mockUser(USERS.student);
      mockMembership(MEMBERSHIPS.student_schoolA);
      const token = makeToken('u-student', 'STUDENT', 'school-a');

      const res = await request(app)
        .get('/api/v1/education/school-a/students')
        .set(authHeader(token));

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('STUDENT');
    });
  });

  // ── ROLE BOUNDARY TESTS ───────────────────────────────────────────────────
  describe('Education — Role boundaries within a school', () => {
    test('STUDENT cannot access TEACHER-only grade management', async () => {
      mockUser(USERS.student);
      mockMembership(MEMBERSHIPS.student_schoolA);
      const token = makeToken('u-student', 'STUDENT', 'school-a');

      const res = await request(app)
        .get('/api/v1/education/school-a/grades')
        .set(authHeader(token));

      expect(res.status).toBe(403);
    });

    test('GUARDIAN cannot access TEACHER-only grade management', async () => {
      mockUser(USERS.guardian);
      mockMembership(MEMBERSHIPS.guardian_schoolA);
      const token = makeToken('u-guardian', 'GUARDIAN', 'school-a');

      const res = await request(app)
        .get('/api/v1/education/school-a/grades')
        .set(authHeader(token));

      expect(res.status).toBe(403);
    });

    test('TEACHER can access grade management in their school', async () => {
      mockUser(USERS.teacher);
      mockMembership(MEMBERSHIPS.teacher_schoolA);
      const token = makeToken('u-teacher', 'TEACHER', 'school-a');

      const res = await request(app)
        .get('/api/v1/education/school-a/grades')
        .set(authHeader(token));

      expect(res.status).toBe(200);
    });

    test('SCHOOL_ADMIN can access grade management', async () => {
      mockUser(USERS.schoolAdmin);
      mockMembership(MEMBERSHIPS.admin_schoolA);
      const token = makeToken('u-admin', 'SCHOOL_ADMIN', 'school-a');

      const res = await request(app)
        .get('/api/v1/education/school-a/grades')
        .set(authHeader(token));

      expect(res.status).toBe(200);
    });

    test('SUPER_ADMIN requires explicit school membership to access education data', async () => {
      mockUser(USERS.superAdmin);
      // SUPER_ADMIN has NO school membership in this test — must be denied
      // Administration is platform-level only; education access requires membership
      const token = makeToken('u-super', 'SUPER_ADMIN', 'school-a');

      const res = await request(app)
        .get('/api/v1/education/school-a/grades')
        .set(authHeader(token));

      // No membership record → 403. SUPER_ADMIN has no implicit education bypass.
      expect(res.status).toBe(403);
    });
  });

  // ── SCHOOL ISOLATION TESTS ────────────────────────────────────────────────
  describe('School data isolation — Cross-school access denied', () => {
    test('TEACHER from School B cannot access School A data', async () => {
      mockUser(USERS.otherSchoolUser);
      // User has membership in school-b, not school-a
      // NF-3: mock both findUnique and findFirst
      const crossSchoolImpl = ({ where }) => {
        const userId   = where.userId_schoolId?.userId   || where.userId;
        const schoolId = where.userId_schoolId?.schoolId || where.schoolId;
        if (userId === 'u-other' && schoolId === 'school-b') {
          return Promise.resolve(MEMBERSHIPS.other_schoolB);
        }
        return Promise.resolve(null); // no membership in school-a
      };
      prisma.schoolMembership.findUnique.mockImplementation(crossSchoolImpl);
      prisma.schoolMembership.findFirst.mockImplementation(crossSchoolImpl);
      const token = makeToken('u-other', 'TEACHER', 'school-b');

      const res = await request(app)
        .get('/api/v1/education/school-a/students') // requesting school-a
        .set(authHeader(token));

      expect(res.status).toBe(403);
    });

    test('Changing schoolId in URL cannot grant cross-school access', async () => {
      // User is a TEACHER in school-a but tries to access school-c
      mockUser(USERS.teacher);
      // NF-3: mock both findUnique and findFirst
      const schoolCImpl = ({ where }) => {
        const userId   = where.userId_schoolId?.userId   || where.userId;
        const schoolId = where.userId_schoolId?.schoolId || where.schoolId;
        // Has membership in school-a but not school-c
        if (userId === 'u-teacher' && schoolId === 'school-a') {
          return Promise.resolve(MEMBERSHIPS.teacher_schoolA);
        }
        return Promise.resolve(null);
      };
      prisma.schoolMembership.findUnique.mockImplementation(schoolCImpl);
      prisma.schoolMembership.findFirst.mockImplementation(schoolCImpl);
      const token = makeToken('u-teacher', 'TEACHER', 'school-a');

      const res = await request(app)
        .get('/api/v1/education/school-c/students') // school-c — no membership
        .set(authHeader(token));

      expect(res.status).toBe(403);
    });
  });

  // ── SUSPENDED MEMBERSHIP TESTS ────────────────────────────────────────────
  describe('Suspended membership is rejected', () => {
    test('TEACHER with SUSPENDED membership cannot access education', async () => {
      mockUser(USERS.teacher);
      mockMembership({
        ...MEMBERSHIPS.teacher_schoolA,
        status: 'SUSPENDED',
      });
      const token = makeToken('u-teacher', 'TEACHER', 'school-a');

      const res = await request(app)
        .get('/api/v1/education/school-a/students')
        .set(authHeader(token));

      expect(res.status).toBe(403);
    });

    test('STUDENT with PENDING membership cannot access education', async () => {
      mockUser(USERS.student);
      mockMembership({
        ...MEMBERSHIPS.student_schoolA,
        status: 'PENDING',
      });
      const token = makeToken('u-student', 'STUDENT', 'school-a');

      const res = await request(app)
        .get('/api/v1/education/school-a/students')
        .set(authHeader(token));

      expect(res.status).toBe(403);
    });
  });

  // ── EDUCATION ROLES ≠ GLOBAL ROLES ───────────────────────────────────────
  describe('Education roles are NOT global HALQA roles', () => {
    test('Social admin route requires SUPER_ADMIN or SCHOOL_ADMIN global role', async () => {
      mockUser(USERS.teacher); // TEACHER has Education role but not social admin
      const token = makeToken('u-teacher', 'TEACHER', 'school-a');

      const res = await request(app)
        .get('/api/v1/social/admin/reports')
        .set(authHeader(token));

      expect(res.status).toBe(403);
    });

    test('STUDENT cannot access social admin routes', async () => {
      mockUser(USERS.student);
      const token = makeToken('u-student', 'STUDENT', 'school-a');

      const res = await request(app)
        .get('/api/v1/social/admin/reports')
        .set(authHeader(token));

      expect(res.status).toBe(403);
    });

    test('GUARDIAN cannot access social admin routes', async () => {
      mockUser(USERS.guardian);
      const token = makeToken('u-guardian', 'GUARDIAN', 'school-a');

      const res = await request(app)
        .get('/api/v1/social/admin/reports')
        .set(authHeader(token));

      expect(res.status).toBe(403);
    });

    test('SUPER_ADMIN can access social admin routes', async () => {
      mockUser(USERS.superAdmin);
      const token = makeToken('u-super', 'SUPER_ADMIN', 'school-a');

      const res = await request(app)
        .get('/api/v1/social/admin/reports')
        .set(authHeader(token));

      expect(res.status).toBe(200);
    });
  });

  // ── CROSS-DOMAIN: Education roles still have Social access ────────────────
  describe('Cross-domain: Education users retain Social access', () => {
    test('TEACHER still has Social feed access', async () => {
      mockUser(USERS.teacher);
      const token = makeToken('u-teacher', 'TEACHER', 'school-a');
      const res = await request(app).get('/api/v1/feed').set(authHeader(token));
      expect(res.status).toBe(200);
    });

    test('STUDENT still has Social feed access', async () => {
      mockUser(USERS.student);
      const token = makeToken('u-student', 'STUDENT', 'school-a');
      const res = await request(app).get('/api/v1/feed').set(authHeader(token));
      expect(res.status).toBe(200);
    });

    test('GUARDIAN still has Social feed access', async () => {
      mockUser(USERS.guardian);
      const token = makeToken('u-guardian', 'GUARDIAN', 'school-a');
      const res = await request(app).get('/api/v1/feed').set(authHeader(token));
      expect(res.status).toBe(200);
    });

    test('SCHOOL_ADMIN still has Social feed access', async () => {
      mockUser(USERS.schoolAdmin);
      const token = makeToken('u-admin', 'SCHOOL_ADMIN', 'school-a');
      const res = await request(app).get('/api/v1/feed').set(authHeader(token));
      expect(res.status).toBe(200);
    });
  });
});
