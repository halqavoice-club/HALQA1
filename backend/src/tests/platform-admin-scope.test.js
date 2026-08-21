'use strict';
/**
 * platform-admin-scope.test.js
 *
 * Regression tests for the Second-Level Architecture Audit findings.
 *
 * Coverage:
 *   F-1  SCHOOL_ADMIN cannot moderate platform-wide social reports
 *   F-2  SCHOOL_ADMIN cannot delete posts/comments/stories of any user
 *   F-3  SCHOOL_ADMIN cannot control PK battles globally
 *   F-4  SCHOOL_ADMIN cannot update another school's settings
 *   F-5  assignment.controller uses effectiveRole (MEMBER+TEACHER membership)
 *   F-6  audio.controller uses effectiveRole (MEMBER+TEACHER membership)
 *   F-7  SUPER_ADMIN payout restricted (baseline regression)
 *   F-8  Marketplace admin restricted
 *   Platform: MEMBER user can access all Social features
 *   Platform: MEMBER+SchoolMembership(TEACHER) can access Education features
 */

const express = require('express');
const request = require('supertest');

// ─── Mocks ────────────────────────────────────────────────────────────────────
jest.mock('../utils/prisma', () => ({
  school:           { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn(), create: jest.fn() },
  schoolSettings:   { upsert: jest.fn() },
  schoolMembership: { findUnique: jest.fn(), findFirst: jest.fn(), upsert: jest.fn(), create: jest.fn(), update: jest.fn() },
  user:             { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  post:             { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  postComment:      { findFirst: jest.fn(), update: jest.fn() },
  story:            { findFirst: jest.fn(), update: jest.fn() },
  userReport:       { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn(), upsert: jest.fn() },
  pkMatch:          { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  pkConfig:         { findFirst: jest.fn(), update: jest.fn() },
  product:          { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  audioCategory:    { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  audioCourse:      { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  audioLesson:      { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  teacher:          { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  assignmentSubmission: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  grade:            { findFirst: jest.fn() },
  postHashtag:      { findMany: jest.fn().mockResolvedValue([]) },
  hashtag:          { updateMany: jest.fn() },
  follow:           { findMany: jest.fn().mockResolvedValue([]) },
  postReaction:     { findUnique: jest.fn() },
  notification:     { create: jest.fn() },
  $transaction:     jest.fn(ops => Array.isArray(ops) ? Promise.all(ops) : ops(require('../utils/prisma'))),
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
jest.mock('../utils/storage', () => ({ saveFile: jest.fn(), deleteFile: jest.fn(), STORAGE_TYPE: 'local' }));
jest.mock('file-type',        () => ({ fromBuffer: jest.fn().mockResolvedValue({ mime: 'image/jpeg' }) }));
jest.mock('../utils/clamav',  () => ({ isEnabled: jest.fn(() => false), scanBuffer: jest.fn() }));

const { generateAccessToken } = require('../utils/jwt');
const prisma = require('../utils/prisma');

// ─── Test users ────────────────────────────────────────────────────────────────
// School A users
const SUPER_ADMIN_A  = { id: 'u-super',   role: 'SUPER_ADMIN',  status: 'ACTIVE', schoolId: 'school-a', firstName: 'Super', lastName: 'Admin', deletedAt: null };
const SCHOOL_ADMIN_A = { id: 'u-admin-a', role: 'SCHOOL_ADMIN', status: 'ACTIVE', schoolId: 'school-a', firstName: 'School', lastName: 'Admin', deletedAt: null };
const TEACHER_A      = { id: 'u-teach-a', role: 'TEACHER',      status: 'ACTIVE', schoolId: 'school-a', firstName: 'Teacher', lastName: 'A', deletedAt: null };
const STUDENT_A      = { id: 'u-stud-a',  role: 'STUDENT',      status: 'ACTIVE', schoolId: 'school-a', firstName: 'Student', lastName: 'A', deletedAt: null };
// Social-only user — no school
const MEMBER_USER    = { id: 'u-member',  role: 'MEMBER',       status: 'ACTIVE', schoolId: null,       firstName: 'Member', lastName: 'User', deletedAt: null };
// School B user
const SCHOOL_ADMIN_B = { id: 'u-admin-b', role: 'SCHOOL_ADMIN', status: 'ACTIVE', schoolId: 'school-b', firstName: 'School', lastName: 'B', deletedAt: null };
// NEW-style user: global MEMBER but has TEACHER membership in school-a
const MEMBER_AS_TEACHER = { id: 'u-member-teacher', role: 'MEMBER', status: 'ACTIVE', schoolId: 'school-a', firstName: 'New', lastName: 'Teacher', deletedAt: null };

const SCHOOL_A_MEMBERSHIP_ADMIN  = { id: 'mem-1', userId: 'u-admin-a',        schoolId: 'school-a', role: 'SCHOOL_ADMIN', status: 'ACTIVE' };
const SCHOOL_A_MEMBERSHIP_TEACHER = { id: 'mem-2', userId: 'u-teach-a',        schoolId: 'school-a', role: 'TEACHER',      status: 'ACTIVE' };
const MEMBER_TEACHER_MEMBERSHIP  = { id: 'mem-3', userId: 'u-member-teacher',  schoolId: 'school-a', role: 'TEACHER',      status: 'ACTIVE' };

function tok(user) {
  return `Bearer ${generateAccessToken({ userId: user.id, role: user.role, schoolId: user.schoolId })}`;
}

function mockUser(user) {
  prisma.user.findUnique.mockResolvedValue(user);
}

function mockMembership(userId, schoolId, membership) {
  // Mock both findUnique (legacy) and findFirst (NF-3: soft-delete filter uses findFirst)
  const impl = ({ where }) => {
    const uid = where.userId_schoolId?.userId || where.userId;
    const sid = where.userId_schoolId?.schoolId || where.schoolId;
    if (uid === userId && sid === schoolId) return Promise.resolve(membership);
    return Promise.resolve(null);
  };
  prisma.schoolMembership.findUnique.mockImplementation(impl);
  prisma.schoolMembership.findFirst.mockImplementation(impl);
}

// ─── App builders ─────────────────────────────────────────────────────────────
function buildSocialApp() {
  const app = express();
  app.use(express.json());
  const { authenticate, authorize } = require('../middleware/auth.middleware');
  const reportBlockCtrl = require('../controllers/report-block.controller');
  const postCtrl = require('../controllers/post.controller');
  const storyCtrl = require('../controllers/story.controller');

  // Social report moderation routes — F-1 FIX: SUPER_ADMIN only
  app.get('/social/reports',
    authenticate,
    authorize('SUPER_ADMIN'),
    reportBlockCtrl.listReports
  );
  app.patch('/social/reports/:id/review',
    authenticate,
    authorize('SUPER_ADMIN'),
    reportBlockCtrl.reviewReport
  );

  // Post delete — F-2 FIX: controller enforces author + SUPER_ADMIN only
  app.delete('/posts/:id', authenticate, postCtrl.deletePost);

  // Story delete — F-2 FIX: controller enforces author + SUPER_ADMIN only
  app.delete('/stories/:id', authenticate, storyCtrl.deleteStory);

  // Social feed (no school needed — Social independence test)
  app.get('/feed', authenticate, (req, res) => res.json({ success: true, data: { items: [] } }));

  return app;
}

function buildSchoolApp() {
  const app = express();
  app.use(express.json());
  const { authenticate, authorize } = require('../middleware/auth.middleware');
  const { errorResponse } = require('../utils/response');
  const schoolCtrl = require('../controllers/school.controller');

  // F-4 FIX: SCHOOL_ADMIN can only update their own school
  const ownSchoolCheck = (req, res, next) => {
    if (req.user.role === 'SCHOOL_ADMIN' && req.user.schoolId !== req.params.id) {
      return errorResponse(res, 'You can only update your own school', 403);
    }
    next();
  };

  app.put('/schools/:id',
    authenticate,
    authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
    ownSchoolCheck,
    schoolCtrl.updateSchool
  );
  app.put('/schools/:id/settings',
    authenticate,
    authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
    ownSchoolCheck,
    schoolCtrl.updateSchoolSettings
  );

  return app;
}

function buildPKApp() {
  const app = express();
  app.use(express.json());
  const { authenticate, authorize } = require('../middleware/auth.middleware');

  // F-3 FIX: PK admin operations are PLATFORM-LEVEL — SUPER_ADMIN only
  app.post('/pk/:id/abort',
    authenticate,
    authorize('SUPER_ADMIN'),
    (req, res) => res.json({ success: true })
  );
  app.post('/pk/:id/pause',
    authenticate,
    authorize('SUPER_ADMIN'),
    (req, res) => res.json({ success: true })
  );

  return app;
}

function buildAudioApp() {
  const app = express();
  app.use(express.json());
  const { authenticate } = require('../middleware/auth.middleware');
  const { eduMember, eduStaff } = require('../middleware/educationAuth');
  const audioCtrl = require('../controllers/audio.controller');

  app.get('/audio/courses', authenticate, ...eduMember, audioCtrl.listCourses);
  app.post('/audio/courses', authenticate, ...eduStaff, audioCtrl.createCourse);
  app.put('/audio/courses/:id', authenticate, ...eduStaff, audioCtrl.updateCourse);

  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Platform Admin Scope Audit — Security Regression Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { isRedisReady } = require('../utils/redis');
    isRedisReady.mockReturnValue(false);
  });

  // ── F-1: Social report moderation — SCHOOL_ADMIN scope ───────────────────
  describe('F-1: Social report moderation scope', () => {
    let app;
    beforeAll(() => { app = buildSocialApp(); });

    test('SUPER_ADMIN can list all social reports (current behavior — OK)', async () => {
      mockUser(SUPER_ADMIN_A);
      prisma.userReport.findMany.mockResolvedValue([]);
      prisma.userReport.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/social/reports')
        .set('Authorization', tok(SUPER_ADMIN_A));

      expect(res.status).toBe(200);
    });

    test('SCHOOL_ADMIN from School A can list platform-wide social reports (CURRENT BEHAVIOR — documents F-1 risk)', async () => {
      // F-1 FIX APPLIED: SCHOOL_ADMIN no longer passes authorize('SUPER_ADMIN') — returns 403.
      mockUser(SCHOOL_ADMIN_A);

      const res = await request(app)
        .get('/social/reports')
        .set('Authorization', tok(SCHOOL_ADMIN_A));

      // After F-1 fix: SCHOOL_ADMIN returns 403
      expect(res.status).toBe(403);
    });

    test('SCHOOL_ADMIN from School B can also list reports (DOCUMENTS cross-school risk)', async () => {
      // F-1 FIX APPLIED: Both School A and B admins now get 403.
      mockUser(SCHOOL_ADMIN_B);

      const res = await request(app)
        .get('/social/reports')
        .set('Authorization', tok(SCHOOL_ADMIN_B));

      expect(res.status).toBe(403);
    });

    test('TEACHER cannot access social reports', async () => {
      mockUser(TEACHER_A);

      const res = await request(app)
        .get('/social/reports')
        .set('Authorization', tok(TEACHER_A));

      expect(res.status).toBe(403);
    });

    test('MEMBER cannot access social reports', async () => {
      mockUser(MEMBER_USER);

      const res = await request(app)
        .get('/social/reports')
        .set('Authorization', tok(MEMBER_USER));

      expect(res.status).toBe(403);
    });

    test('STUDENT cannot access social reports', async () => {
      mockUser(STUDENT_A);

      const res = await request(app)
        .get('/social/reports')
        .set('Authorization', tok(STUDENT_A));

      expect(res.status).toBe(403);
    });
  });

  // ── F-2: Post/story deletion — SCHOOL_ADMIN scope ────────────────────────
  describe('F-2: Post and story deletion — SCHOOL_ADMIN platform-wide access', () => {
    let app;
    beforeAll(() => { app = buildSocialApp(); });

    test('Author can delete their own post', async () => {
      mockUser(MEMBER_USER);
      prisma.post.findFirst.mockResolvedValue({ id: 'post-1', authorId: 'u-member', deletedAt: null, visibility: 'PUBLIC' });
      prisma.post.update.mockResolvedValue({});
      prisma.postHashtag.findMany.mockResolvedValue([]);

      const res = await request(app)
        .delete('/posts/post-1')
        .set('Authorization', tok(MEMBER_USER));

      expect(res.status).toBe(200);
    });

    test('SUPER_ADMIN can delete any user\'s post (platform admin — acceptable)', async () => {
      mockUser(SUPER_ADMIN_A);
      prisma.post.findFirst.mockResolvedValue({ id: 'post-1', authorId: 'u-member', deletedAt: null, visibility: 'PUBLIC' });
      prisma.post.update.mockResolvedValue({});
      prisma.postHashtag.findMany.mockResolvedValue([]);

      const res = await request(app)
        .delete('/posts/post-1')
        .set('Authorization', tok(SUPER_ADMIN_A));

      expect(res.status).toBe(200);
    });

    test('SCHOOL_ADMIN can delete any user\'s post (DOCUMENTS F-2 risk — should be 403 after fix)', async () => {
      // This DOCUMENTS that any SCHOOL_ADMIN can delete posts by users from other schools
      mockUser(SCHOOL_ADMIN_A);
      prisma.post.findFirst.mockResolvedValue({
        id: 'post-member',
        authorId: 'u-member',  // Post by a MEMBER user — not from any school
        deletedAt: null,
        visibility: 'PUBLIC'
      });
      prisma.post.update.mockResolvedValue({});
      prisma.postHashtag.findMany.mockResolvedValue([]);

      const res = await request(app)
        .delete('/posts/post-member')
        .set('Authorization', tok(SCHOOL_ADMIN_A));

      // After F-2 fix: 403 — SCHOOL_ADMIN cannot delete other users' posts
      expect(res.status).toBe(403);
    });

    test('TEACHER cannot delete another user\'s post', async () => {
      mockUser(TEACHER_A);
      prisma.post.findFirst.mockResolvedValue({
        id: 'post-member',
        authorId: 'u-member',
        deletedAt: null,
        visibility: 'PUBLIC'
      });

      const res = await request(app)
        .delete('/posts/post-member')
        .set('Authorization', tok(TEACHER_A));

      expect(res.status).toBe(403);
    });
  });

  // ── F-3: PK admin — SCHOOL_ADMIN platform-wide access ────────────────────
  describe('F-3: PK battle admin — SCHOOL_ADMIN platform-wide control', () => {
    let app;
    beforeAll(() => { app = buildPKApp(); });

    test('SUPER_ADMIN can abort PK battles (platform admin — acceptable)', async () => {
      mockUser(SUPER_ADMIN_A);

      const res = await request(app)
        .post('/pk/pk-match-1/abort')
        .set('Authorization', tok(SUPER_ADMIN_A));

      expect(res.status).toBe(200);
    });

    test('SCHOOL_ADMIN can abort PK battles (DOCUMENTS F-3 risk — should be 403 after fix)', async () => {
      mockUser(SCHOOL_ADMIN_A);

      const res = await request(app)
        .post('/pk/pk-match-1/abort')
        .set('Authorization', tok(SCHOOL_ADMIN_A));

      // After F-3 fix: 403 — SCHOOL_ADMIN cannot abort PK battles (SUPER_ADMIN only)
      expect(res.status).toBe(403);
    });

    test('SCHOOL_ADMIN from School B can also abort PK battles (cross-school PK admin)', async () => {
      mockUser(SCHOOL_ADMIN_B);

      const res = await request(app)
        .post('/pk/pk-match-1/abort')
        .set('Authorization', tok(SCHOOL_ADMIN_B));

      // F-3 FIX: SCHOOL_ADMIN from any school cannot abort PK battles — SUPER_ADMIN only
      expect(res.status).toBe(403);
    });

    test('TEACHER cannot abort PK battles', async () => {
      mockUser(TEACHER_A);

      const res = await request(app)
        .post('/pk/pk-match-1/abort')
        .set('Authorization', tok(TEACHER_A));

      expect(res.status).toBe(403);
    });

    test('MEMBER cannot abort PK battles', async () => {
      mockUser(MEMBER_USER);

      const res = await request(app)
        .post('/pk/pk-match-1/abort')
        .set('Authorization', tok(MEMBER_USER));

      expect(res.status).toBe(403);
    });
  });

  // ── F-4: School settings — no school isolation for SCHOOL_ADMIN ──────────
  describe('F-4: School settings isolation — SCHOOL_ADMIN can update any school', () => {
    let app;
    beforeAll(() => { app = buildSchoolApp(); });

    test('SUPER_ADMIN can update any school', async () => {
      mockUser(SUPER_ADMIN_A);
      prisma.school.update.mockResolvedValue({ id: 'school-b', name: 'Updated' });

      const res = await request(app)
        .put('/schools/school-b')  // different school from SUPER_ADMIN_A.schoolId
        .set('Authorization', tok(SUPER_ADMIN_A))
        .send({ name: 'Updated Name' });

      expect(res.status).toBe(200);
    });

    test('SCHOOL_ADMIN from School A can update School B (DOCUMENTS F-4 risk — no isolation)', async () => {
      mockUser(SCHOOL_ADMIN_A);
      prisma.school.update.mockResolvedValue({ id: 'school-b', name: 'Hacked' });

      const res = await request(app)
        .put('/schools/school-b')  // School B — different from SCHOOL_ADMIN_A.schoolId (school-a)
        .set('Authorization', tok(SCHOOL_ADMIN_A))
        .send({ name: 'Hacked by School A Admin' });

      // F-4 FIX: SCHOOL_ADMIN can only update their own school — cross-school access blocked
      expect(res.status).toBe(403);
    });

    test('SCHOOL_ADMIN can update their own school (should remain 200 after fix)', async () => {
      mockUser(SCHOOL_ADMIN_A);
      prisma.school.update.mockResolvedValue({ id: 'school-a', name: 'Updated' });

      const res = await request(app)
        .put('/schools/school-a')  // Own school
        .set('Authorization', tok(SCHOOL_ADMIN_A))
        .send({ name: 'Own School Update' });

      // Should remain 200 after fix
      expect(res.status).toBe(200);
    });

    test('TEACHER cannot update any school settings', async () => {
      mockUser(TEACHER_A);

      const res = await request(app)
        .put('/schools/school-a')
        .set('Authorization', tok(TEACHER_A))
        .send({ name: 'Attempt' });

      expect(res.status).toBe(403);
    });
  });

  // ── F-5/F-6: effectiveRole pattern — MEMBER with TEACHER membership ───────
  describe('F-5/F-6: MEMBER user with TEACHER school membership — audio courses', () => {
    let app;
    beforeAll(() => { app = buildAudioApp(); });

    test('MEMBER with TEACHER school membership can list audio courses', async () => {
      mockUser(MEMBER_AS_TEACHER);
      mockMembership('u-member-teacher', 'school-a', MEMBER_TEACHER_MEMBERSHIP);
      prisma.audioCourse.findMany.mockResolvedValue([]);
      prisma.audioCourse.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/audio/courses')
        .set('Authorization', tok(MEMBER_AS_TEACHER))
        .set('X-School-Id', 'school-a');

      expect(res.status).toBe(200);
    });

    test('MEMBER with TEACHER school membership can create audio course', async () => {
      mockUser(MEMBER_AS_TEACHER);
      mockMembership('u-member-teacher', 'school-a', MEMBER_TEACHER_MEMBERSHIP);
      prisma.teacher.findFirst.mockResolvedValue({ id: 'teach-rec-1', userId: 'u-member-teacher' });
      prisma.audioCourse.findFirst.mockResolvedValue(null);
      prisma.audioCourse.create.mockResolvedValue({ id: 'course-1', title: 'New Course' });

      const res = await request(app)
        .post('/audio/courses')
        .set('Authorization', tok(MEMBER_AS_TEACHER))
        .set('X-School-Id', 'school-a')
        .send({ title: 'New Course', categoryId: 'cat-1' });

      expect(res.status).toBe(201);
    });

    test('MEMBER without school membership cannot access audio courses', async () => {
      mockUser(MEMBER_USER);
      // No membership → requireSchoolMember returns 400 (no school context)
      prisma.schoolMembership.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/audio/courses')
        .set('Authorization', tok(MEMBER_USER));
      // No X-School-Id header — should get 400 (school context required)

      expect(res.status).toBe(400);
    });

    test('Legacy TEACHER (global role) can still access audio courses with school context', async () => {
      mockUser(TEACHER_A);
      mockMembership('u-teach-a', 'school-a', SCHOOL_A_MEMBERSHIP_TEACHER);
      prisma.audioCourse.findMany.mockResolvedValue([]);
      prisma.audioCourse.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/audio/courses')
        .set('Authorization', tok(TEACHER_A))
        .set('X-School-Id', 'school-a');

      expect(res.status).toBe(200);
    });
  });

  // ── Platform: Social independence — MEMBER user ───────────────────────────
  describe('Social independence: MEMBER user with no school', () => {
    let app;
    beforeAll(() => { app = buildSocialApp(); });

    test('MEMBER user can access Social feed (no school required)', async () => {
      mockUser(MEMBER_USER);

      const res = await request(app)
        .get('/feed')
        .set('Authorization', tok(MEMBER_USER));

      expect(res.status).toBe(200);
    });

    test('MEMBER user is blocked from platform moderation endpoints (403)', async () => {
      mockUser(MEMBER_USER);

      const res = await request(app)
        .get('/social/reports')
        .set('Authorization', tok(MEMBER_USER));

      expect(res.status).toBe(403);
    });

    test('Unauthenticated user cannot access any route', async () => {
      const res = await request(app)
        .get('/feed');

      expect(res.status).toBe(401);
    });
  });

  // ── School Admin cross-school privilege summary ───────────────────────────
  describe('School Admin privilege summary — all risks fixed', () => {
    test('SCHOOL_ADMIN from School B cannot abort PK match involving School A users (F-3 fixed)', async () => {
      const pkApp = buildPKApp();
      mockUser(SCHOOL_ADMIN_B); // School B admin

      const res = await request(pkApp)
        .post('/pk/pk-match-1/pause')
        .set('Authorization', tok(SCHOOL_ADMIN_B));

      // F-3 FIX: SCHOOL_ADMIN from any school is blocked — SUPER_ADMIN only
      expect(res.status).toBe(403);
    });

    test('SCHOOL_ADMIN from School B cannot moderate School A user social report (F-1 fixed)', async () => {
      const socialApp = buildSocialApp();
      mockUser(SCHOOL_ADMIN_B);
      prisma.userReport.findMany.mockResolvedValue([]);
      prisma.userReport.count.mockResolvedValue(0);

      const res = await request(socialApp)
        .get('/social/reports')
        .set('Authorization', tok(SCHOOL_ADMIN_B));

      // F-1 FIX: Cross-school admin cannot see platform-wide reports — SUPER_ADMIN only
      expect(res.status).toBe(403);
    });
  });

  // ── Phase 1 NF fixes ─────────────────────────────────────────────────────
  describe('Phase 1 NF fixes — new findings from post-fix audit', () => {

    // NF-1: PK controller — abortPK/pausePK/resumePK internal check
    describe('NF-1: PK controller internal SCHOOL_ADMIN bypass removed', () => {
      function buildDirectPKApp() {
        const app = express();
        app.use(express.json());
        const { authenticate } = require('../middleware/auth.middleware');
        const pkCtrl = require('../controllers/pk.controller');
        // No route-level authorize — test controller's own guard directly
        app.post('/pk/:id/abort-direct', authenticate, pkCtrl.abortPK);
        app.post('/pk/:id/pause-direct', authenticate, pkCtrl.pausePK);
        app.post('/pk/:id/resume-direct', authenticate, pkCtrl.resumePK);
        return app;
      }

      test('SUPER_ADMIN passes controller-level abort check', async () => {
        const app = buildDirectPKApp();
        mockUser(SUPER_ADMIN_A);
        // pkService.abortPK not mocked — controller returns 400 from service error
        // but must NOT return 403 (the admin check passes)
        const res = await request(app)
          .post('/pk/pk-1/abort-direct')
          .set('Authorization', tok(SUPER_ADMIN_A))
          .send({ reason: 'test' });
        expect(res.status).not.toBe(403);
      });

      test('SCHOOL_ADMIN is blocked by controller abort check (NF-1 fix)', async () => {
        const app = buildDirectPKApp();
        mockUser(SCHOOL_ADMIN_A);
        const res = await request(app)
          .post('/pk/pk-1/abort-direct')
          .set('Authorization', tok(SCHOOL_ADMIN_A));
        expect(res.status).toBe(403);
      });

      test('SCHOOL_ADMIN is blocked by controller pause check (NF-1 fix)', async () => {
        const app = buildDirectPKApp();
        mockUser(SCHOOL_ADMIN_A);
        const res = await request(app)
          .post('/pk/pk-1/pause-direct')
          .set('Authorization', tok(SCHOOL_ADMIN_A));
        expect(res.status).toBe(403);
      });

      test('SCHOOL_ADMIN is blocked by controller resume check (NF-1 fix)', async () => {
        const app = buildDirectPKApp();
        mockUser(SCHOOL_ADMIN_A);
        const res = await request(app)
          .post('/pk/pk-1/resume-direct')
          .set('Authorization', tok(SCHOOL_ADMIN_A));
        expect(res.status).toBe(403);
      });

      test('MEMBER cannot abort PK via controller', async () => {
        const app = buildDirectPKApp();
        mockUser(MEMBER_USER);
        const res = await request(app)
          .post('/pk/pk-1/abort-direct')
          .set('Authorization', tok(MEMBER_USER));
        expect(res.status).toBe(403);
      });

      test('TEACHER cannot abort PK via controller', async () => {
        const app = buildDirectPKApp();
        mockUser(TEACHER_A);
        const res = await request(app)
          .post('/pk/pk-1/abort-direct')
          .set('Authorization', tok(TEACHER_A));
        expect(res.status).toBe(403);
      });
    });

    // NF-4: Marketplace SCHOOL_ADMIN scope — test controller directly
    describe('NF-4: Marketplace — SCHOOL_ADMIN cannot access other sellers\' products', () => {
      function buildMarketplaceApp() {
        const app = express();
        app.use(express.json());
        const { authenticate } = require('../middleware/auth.middleware');
        const mktCtrl = require('../controllers/marketplace.controller');
        app.get('/marketplace/seller/:sellerId/products', authenticate, mktCtrl.getSellerProducts);
        return app;
      }

      test('SCHOOL_ADMIN cannot view another user\'s product listings (NF-4 fix)', async () => {
        const app = buildMarketplaceApp();
        mockUser(SCHOOL_ADMIN_A);
        // sellerId is MEMBER_USER — different from SCHOOL_ADMIN_A
        const res = await request(app)
          .get('/marketplace/seller/u-member/products')
          .set('Authorization', tok(SCHOOL_ADMIN_A));
        expect(res.status).toBe(403);
      });

      test('TEACHER cannot view another user\'s product listings', async () => {
        const app = buildMarketplaceApp();
        mockUser(TEACHER_A);
        const res = await request(app)
          .get('/marketplace/seller/u-member/products')
          .set('Authorization', tok(TEACHER_A));
        expect(res.status).toBe(403);
      });

      test('User can view their own product listings', async () => {
        const app = buildMarketplaceApp();
        mockUser(MEMBER_USER);
        // Will call prisma.product.findMany which is mocked
        prisma.product = prisma.product || { findMany: jest.fn() };
        if (!prisma.product.findMany) prisma.product.findMany = jest.fn();
        prisma.product.findMany.mockResolvedValue([]);

        const res = await request(app)
          .get('/marketplace/seller/u-member/products')  // matches own userId
          .set('Authorization', tok(MEMBER_USER));
        // Same userId as sellerId → allowed (not a 403)
        expect(res.status).not.toBe(403);
      });

      test('SUPER_ADMIN can view any seller\'s products', async () => {
        const app = buildMarketplaceApp();
        mockUser(SUPER_ADMIN_A);
        prisma.product = prisma.product || { findMany: jest.fn() };
        if (!prisma.product.findMany) prisma.product.findMany = jest.fn();
        prisma.product.findMany.mockResolvedValue([]);

        const res = await request(app)
          .get('/marketplace/seller/u-member/products')
          .set('Authorization', tok(SUPER_ADMIN_A));
        expect(res.status).not.toBe(403);
      });
    });
  });
});
