'use strict';
/**
 * HALQA — School/ERP Findings Remediation Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * FIND-01: Analytics authorization uses SchoolMembership (not User.schoolId)
 * FIND-02: Assignment/Exam submission creation uses server-controlled school context
 * FIND-03: JSDoc correction (source-only)
 *
 * SA-ANALYTICS-001: SUPER_ADMIN removed from analytics write role list
 * SA-SCHOOL-DATA-001: requireSchoolMember blocks SUPER_ADMIN before membership lookup
 * SA-SOCIAL-READ-001: SUPER_ADMIN blocked from social read endpoints
 *
 * Test Matrix — Analytics:
 *   A1   SchoolMembership=SchoolA + User.schoolId=SchoolA → 200
 *   A2   SchoolMembership=SchoolA + User.schoolId=NULL   → 200  (CRITICAL regression)
 *   A3   SchoolMembership=SchoolA → School B             → 403
 *   A4   No SchoolMembership                             → 403
 *   SA-SCHOOL-01  SUPER_ADMIN without membership         → 403
 *   SA-SCHOOL-02  SUPER_ADMIN WITH active membership     → 403  (CRITICAL)
 *   A7   SUSPENDED membership                            → 403
 *   SA-SCHOOL-03  SCHOOL_ADMIN write stats               → 200
 *   AW2  TEACHER write stats                             → 403
 *   SA-ANALYTICS-001  SUPER_ADMIN write even with membership → 403
 *   SA-SCHOOL-04  Normal MEMBER with membership          → 200
 *   SA-SCHOOL-05  MEMBER User.schoolId=NULL + membership → 200  (CRITICAL regression)
 *   AW3  Cross-school URL injection                      → 403
 *
 * Test Matrix — Assignment/Exam (unchanged from prior remediation):
 *   AS1–AS7, EX1–EX5
 *
 * Test Matrix — Social Read Boundary (SA-SOCIAL-READ-001):
 *   SR-01  SUPER_ADMIN GET /feed                         → 403
 *   SR-02  SUPER_ADMIN GET /:id                          → 403
 *   SR-03  SUPER_ADMIN GET /trending                     → 403
 *   SR-04  Normal user GET /feed                         → unaffected (200 or mock-dependent)
 *   SR-05  post.routes.js source: denyIfSuperAdmin on read routes
 */

jest.mock('../utils/prisma');
jest.mock('../utils/redis', () => ({
  isRedisReady:       jest.fn(() => false),
  getCache:           jest.fn().mockResolvedValue(null),
  setCache:           jest.fn().mockResolvedValue(undefined),
  deleteCache:        jest.fn().mockResolvedValue(undefined),
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/jwt',             () => ({ verifyAccessToken: jest.fn() }));
jest.mock('../middleware/ipAllowlist', () => (req, res, next) => next());
jest.mock('../sockets',               () => ({ getIo: jest.fn(() => null) }));
jest.mock('../middleware/audit.middleware', () => () => (req, res, next) => next());
jest.mock('../utils/contentFilter', () => ({
  filterMiddleware: () => (req, res, next) => next(),
}));

const request    = require('supertest');
const express    = require('express');
const cookieParser = require('cookie-parser');
const prisma     = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');
const fs   = require('fs');
const path = require('path');

// ─── App builders ─────────────────────────────────────────────────────────────

function buildAnalyticsApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/analytics', require('../routes/analytics.routes'));
  app.use((err, req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

function buildAssignmentApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/assignments', require('../routes/assignment.routes'));
  app.use((err, req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

function buildExamApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/exams', require('../routes/exam.routes'));
  app.use((err, req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

function buildPostApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/posts', require('../routes/post.routes'));
  app.use((err, req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tok(id) { return `Bearer t-${id}`; }
const SCHOOL_A = 'school-a';
const SCHOOL_B = 'school-b';

function setupUser(userId, role, schoolId, schoolIdNull = false) {
  const u = {
    id: userId, role, status: 'ACTIVE',
    schoolId: schoolIdNull ? null : (schoolId || null),
    firstName: 'T', lastName: 'U', avatarUrl: null, deletedAt: null,
  };
  verifyAccessToken.mockReturnValue({ userId, role, schoolId: u.schoolId });
  prisma.user.findUnique.mockResolvedValue(u);
  return u;
}

function setupMembership(userId, schoolId, role, status = 'ACTIVE') {
  const m = { id: `mem-${userId}-${schoolId}`, userId, schoolId, role, status, deletedAt: null };
  prisma.schoolMembership.findFirst.mockImplementation(({ where }) => {
    const uid = where.userId;
    const sid = where.schoolId;
    if (uid === userId && sid === schoolId && where.deletedAt === null) {
      return Promise.resolve(status === 'ACTIVE' ? m : null);
    }
    return Promise.resolve(null);
  });
  prisma.schoolMembership.findUnique.mockImplementation(({ where }) => {
    const uid = where.userId_schoolId?.userId   || where.userId;
    const sid = where.userId_schoolId?.schoolId || where.schoolId;
    if (uid === userId && sid === schoolId) return Promise.resolve(m);
    return Promise.resolve(null);
  });
  return m;
}

function setupNoMembership() {
  prisma.schoolMembership.findFirst.mockResolvedValue(null);
  prisma.schoolMembership.findUnique.mockResolvedValue(null);
}

function setupSuspendedMembership(userId, schoolId) {
  const m = { id: `mem-sus-${userId}`, userId, schoolId, role: 'TEACHER', status: 'SUSPENDED', deletedAt: null };
  prisma.schoolMembership.findFirst.mockImplementation(({ where }) => {
    if (where.userId === userId && where.schoolId === schoolId && where.deletedAt === null) {
      return Promise.resolve(m);
    }
    return Promise.resolve(null);
  });
  prisma.schoolMembership.findUnique.mockResolvedValue(m);
}

beforeEach(() => {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);
  require('../utils/redis').getCache.mockResolvedValue(null);
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  if (!prisma.schoolMembership.findFirst)  prisma.schoolMembership.findFirst  = jest.fn().mockResolvedValue(null);
  if (!prisma.schoolMembership.findUnique) prisma.schoolMembership.findUnique = jest.fn().mockResolvedValue(null);
  if (!prisma.auditLog) prisma.auditLog = { create: jest.fn().mockResolvedValue({}) };
  if (!prisma.dailySchoolStats) prisma.dailySchoolStats = {};
  prisma.dailySchoolStats.findMany   = jest.fn().mockResolvedValue([]);
  prisma.dailySchoolStats.findUnique = jest.fn().mockResolvedValue(null);
  prisma.dailySchoolStats.create     = jest.fn().mockResolvedValue({ id: 'stat-1', schoolId: SCHOOL_A });
  prisma.dailySchoolStats.upsert     = jest.fn().mockResolvedValue({ id: 'stat-1', schoolId: SCHOOL_A });
  if (!prisma.student)  prisma.student  = {};
  if (!prisma.teacher)  prisma.teacher  = {};
  if (!prisma.class)    prisma.class    = {};
  if (!prisma.grade)    prisma.grade    = {};
  if (!prisma.assignmentSubmission) prisma.assignmentSubmission = {};
  if (!prisma.examSubmission)       prisma.examSubmission       = {};
  if (!prisma.post) prisma.post = {};
  prisma.post.findFirst = jest.fn().mockResolvedValue(null);
  prisma.post.findMany  = jest.fn().mockResolvedValue([]);
});

// ═════════════════════════════════════════════════════════════════════════════
// FIND-01 + SA-ANALYTICS-001 + SA-SCHOOL-DATA-001: Analytics Authorization
// ═════════════════════════════════════════════════════════════════════════════

describe('Analytics — school boundary and SUPER_ADMIN exclusion', () => {
  let app;
  beforeAll(() => { app = buildAnalyticsApp(); });

  test('A1: MEMBER with SchoolMembership=SchoolA and User.schoolId=SchoolA → 200', async () => {
    setupUser('u-a1', 'MEMBER', SCHOOL_A);
    setupMembership('u-a1', SCHOOL_A, 'TEACHER');
    const res = await request(app).get(`/api/v1/analytics/schools/${SCHOOL_A}/analytics`).set('Authorization', tok('u-a1'));
    expect(res.status).toBe(200);
  });

  test('A2 (CRITICAL): MEMBER with SchoolMembership + User.schoolId=NULL → 200', async () => {
    // Protects FIND-01 regression: new-arch MEMBER users with null schoolId must still work
    setupUser('u-a2', 'MEMBER', null, true);
    setupMembership('u-a2', SCHOOL_A, 'STUDENT');
    const res = await request(app).get(`/api/v1/analytics/schools/${SCHOOL_A}/analytics`).set('Authorization', tok('u-a2'));
    expect(res.status).toBe(200);
  });

  test('A3: User in SchoolA cannot access SchoolB analytics → 403', async () => {
    setupUser('u-a3', 'MEMBER', SCHOOL_A);
    prisma.schoolMembership.findFirst.mockImplementation(({ where }) => {
      if (where.userId === 'u-a3' && where.schoolId === SCHOOL_A && where.deletedAt === null) {
        return Promise.resolve({ id: 'mem-a3', userId: 'u-a3', schoolId: SCHOOL_A, role: 'TEACHER', status: 'ACTIVE', deletedAt: null });
      }
      return Promise.resolve(null);
    });
    const res = await request(app).get(`/api/v1/analytics/schools/${SCHOOL_B}/analytics`).set('Authorization', tok('u-a3'));
    expect(res.status).toBe(403);
  });

  test('A4: No SchoolMembership → 403', async () => {
    setupUser('u-a4', 'MEMBER', null, true);
    setupNoMembership();
    const res = await request(app).get(`/api/v1/analytics/schools/${SCHOOL_A}/analytics`).set('Authorization', tok('u-a4'));
    expect(res.status).toBe(403);
  });

  test('SA-SCHOOL-01: SUPER_ADMIN without SchoolMembership → 403', async () => {
    setupUser('u-sa1', 'SUPER_ADMIN', null, true);
    setupNoMembership();
    const res = await request(app).get(`/api/v1/analytics/schools/${SCHOOL_A}/analytics`).set('Authorization', tok('u-sa1'));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/platform administrator/i);
  });

  test('SA-SCHOOL-02 (CRITICAL): SUPER_ADMIN WITH active SchoolMembership → still 403', async () => {
    // The application must deny SA before SchoolMembership lookup.
    // Even with legacy membership data, SA cannot access school-scoped endpoints.
    setupUser('u-sa2', 'SUPER_ADMIN', null, true);
    setupMembership('u-sa2', SCHOOL_A, 'SCHOOL_ADMIN', 'ACTIVE');
    const res = await request(app).get(`/api/v1/analytics/schools/${SCHOOL_A}/analytics`).set('Authorization', tok('u-sa2'));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/platform administrator/i);
  });

  test('A7: SUSPENDED membership → 403', async () => {
    setupUser('u-a7', 'MEMBER', SCHOOL_A);
    setupSuspendedMembership('u-a7', SCHOOL_A);
    const res = await request(app).get(`/api/v1/analytics/schools/${SCHOOL_A}/analytics`).set('Authorization', tok('u-a7'));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/suspended/i);
  });

  test('SA-SCHOOL-03: SCHOOL_ADMIN with membership can update school stats → 200', async () => {
    setupUser('u-aw1', 'MEMBER', SCHOOL_A);
    setupMembership('u-aw1', SCHOOL_A, 'SCHOOL_ADMIN');
    prisma.dailySchoolStats.upsert.mockResolvedValue({ id: 'stat-1', schoolId: SCHOOL_A });
    const res = await request(app).put(`/api/v1/analytics/schools/${SCHOOL_A}/daily-stats/2026-09-01`).set('Authorization', tok('u-aw1')).send({ studentCount: 100 });
    expect(res.status).toBe(200);
  });

  test('AW2: TEACHER cannot update school stats → 403', async () => {
    setupUser('u-aw2', 'MEMBER', SCHOOL_A);
    setupMembership('u-aw2', SCHOOL_A, 'TEACHER');
    const res = await request(app).put(`/api/v1/analytics/schools/${SCHOOL_A}/daily-stats/2026-09-01`).set('Authorization', tok('u-aw2')).send({ studentCount: 100 });
    expect(res.status).toBe(403);
  });

  test('SA-ANALYTICS-001: SUPER_ADMIN cannot write school stats even with legacy membership → 403', async () => {
    setupUser('u-sa-w', 'SUPER_ADMIN', null, true);
    setupMembership('u-sa-w', SCHOOL_A, 'SCHOOL_ADMIN', 'ACTIVE');
    const res = await request(app).put(`/api/v1/analytics/schools/${SCHOOL_A}/daily-stats/2026-09-01`).set('Authorization', tok('u-sa-w')).send({ studentCount: 999 });
    expect(res.status).toBe(403);
  });

  test('SA-SCHOOL-04: Normal MEMBER with active SchoolMembership → 200', async () => {
    setupUser('u-s4', 'MEMBER', null, true);
    setupMembership('u-s4', SCHOOL_A, 'TEACHER');
    const res = await request(app).get(`/api/v1/analytics/schools/${SCHOOL_A}/analytics`).set('Authorization', tok('u-s4'));
    expect(res.status).toBe(200);
  });

  test('SA-SCHOOL-05 (CRITICAL): MEMBER with User.schoolId=NULL + valid membership → 200', async () => {
    // Protects FIND-01 fix: null User.schoolId must not break membership-based access
    setupUser('u-s5', 'MEMBER', null, true);
    setupMembership('u-s5', SCHOOL_A, 'STUDENT');
    const res = await request(app).get(`/api/v1/analytics/schools/${SCHOOL_A}/analytics`).set('Authorization', tok('u-s5'));
    expect(res.status).toBe(200);
  });

  test('AW3: Cross-school URL schoolId injection → 403', async () => {
    setupUser('u-aw3', 'MEMBER', SCHOOL_A);
    prisma.schoolMembership.findFirst.mockImplementation(({ where }) => {
      if (where.userId === 'u-aw3' && where.schoolId === SCHOOL_A && where.deletedAt === null) {
        return Promise.resolve({ id: 'mem-aw3', userId: 'u-aw3', schoolId: SCHOOL_A, role: 'SCHOOL_ADMIN', status: 'ACTIVE', deletedAt: null });
      }
      return Promise.resolve(null);
    });
    const res = await request(app).get(`/api/v1/analytics/schools/${SCHOOL_B}/daily-stats`).set('Authorization', tok('u-aw3'));
    expect(res.status).toBe(403);
  });

  test('Unauthenticated analytics request → 401', async () => {
    const res = await request(app).get(`/api/v1/analytics/schools/${SCHOOL_A}/analytics`);
    expect(res.status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FIND-02: Assignment Submission Security
// ═════════════════════════════════════════════════════════════════════════════

describe('FIND-02: Assignment — server-controlled school context', () => {
  let app;
  beforeAll(() => { app = buildAssignmentApp(); });

  function setupValidStudentInSchoolA(userId = 'u-student') {
    setupUser(userId, 'MEMBER', SCHOOL_A);
    setupMembership(userId, SCHOOL_A, 'STUDENT');
    prisma.student.findFirst = jest.fn().mockImplementation(({ where }) => {
      if (where.userId === userId && where.schoolId === SCHOOL_A) {
        return Promise.resolve({ id: `stu-${userId}`, userId, schoolId: SCHOOL_A, deletedAt: null });
      }
      return Promise.resolve(null);
    });
  }

  test('AS1: Student creates submission for SchoolA class → 201 with server schoolId', async () => {
    setupValidStudentInSchoolA('u-as1');
    prisma.class.findFirst = jest.fn().mockImplementation(({ where }) => {
      if (where.id === 'class-a' && where.schoolId === SCHOOL_A) return Promise.resolve({ id: 'class-a', schoolId: SCHOOL_A });
      return Promise.resolve(null);
    });
    prisma.assignmentSubmission.create = jest.fn().mockResolvedValue({ id: 'sub-1', schoolId: SCHOOL_A, classId: 'class-a', studentId: 'stu-u-as1' });
    const res = await request(app).post('/api/v1/assignments/submissions').set('Authorization', tok('u-as1')).set('x-school-id', SCHOOL_A).send({ classId: 'class-a', title: 'My Assignment' });
    expect(res.status).toBe(201);
    const d = prisma.assignmentSubmission.create.mock.calls[0][0].data;
    expect(d.schoolId).toBe(SCHOOL_A);
    expect(d.studentId).toBe('stu-u-as1');
  });

  test('AS2: body.schoolId injection (SchoolB) ignored → server uses SchoolA', async () => {
    setupValidStudentInSchoolA('u-as2');
    prisma.class.findFirst = jest.fn().mockImplementation(({ where }) => {
      if (where.id === 'class-a' && where.schoolId === SCHOOL_A) return Promise.resolve({ id: 'class-a', schoolId: SCHOOL_A });
      return Promise.resolve(null);
    });
    prisma.assignmentSubmission.create = jest.fn().mockResolvedValue({ id: 'sub-2', schoolId: SCHOOL_A, classId: 'class-a', studentId: 'stu-u-as2' });
    const res = await request(app).post('/api/v1/assignments/submissions').set('Authorization', tok('u-as2')).set('x-school-id', SCHOOL_A).send({ classId: 'class-a', schoolId: SCHOOL_B, title: 'Injected' });
    expect(res.status).toBe(201);
    const d = prisma.assignmentSubmission.create.mock.calls[0][0].data;
    expect(d.schoolId).toBe(SCHOOL_A);
    expect(d.schoolId).not.toBe(SCHOOL_B);
  });

  test('AS3: body.studentId injection ignored → uses authenticated student', async () => {
    setupValidStudentInSchoolA('u-as3');
    prisma.class.findFirst = jest.fn().mockResolvedValue({ id: 'class-a', schoolId: SCHOOL_A });
    prisma.assignmentSubmission.create = jest.fn().mockResolvedValue({ id: 'sub-3', schoolId: SCHOOL_A, studentId: 'stu-u-as3' });
    const res = await request(app).post('/api/v1/assignments/submissions').set('Authorization', tok('u-as3')).set('x-school-id', SCHOOL_A).send({ classId: 'class-a', studentId: 'other-id', title: 'Stolen' });
    expect(res.status).toBe(201);
    const d = prisma.assignmentSubmission.create.mock.calls[0][0].data;
    expect(d.studentId).toBe('stu-u-as3');
    expect(d.studentId).not.toBe('other-id');
  });

  test('AS4: classId from School B → 403', async () => {
    setupValidStudentInSchoolA('u-as4');
    prisma.class.findFirst = jest.fn().mockResolvedValue(null);
    const res = await request(app).post('/api/v1/assignments/submissions').set('Authorization', tok('u-as4')).set('x-school-id', SCHOOL_A).send({ classId: 'class-b', title: 'Cross-school' });
    expect(res.status).toBe(403);
    expect(prisma.assignmentSubmission.create).not.toHaveBeenCalled();
  });

  test('AS5: gradeId not belonging to classId → 403', async () => {
    setupValidStudentInSchoolA('u-as5');
    prisma.class.findFirst = jest.fn().mockResolvedValue({ id: 'class-a', schoolId: SCHOOL_A });
    prisma.grade.findFirst = jest.fn().mockResolvedValue(null);
    const res = await request(app).post('/api/v1/assignments/submissions').set('Authorization', tok('u-as5')).set('x-school-id', SCHOOL_A).send({ classId: 'class-a', gradeId: 'grade-x', title: 'Cross-grade' });
    expect(res.status).toBe(403);
    expect(prisma.assignmentSubmission.create).not.toHaveBeenCalled();
  });

  test('AS6: Non-existent classId → 403, not 500', async () => {
    setupValidStudentInSchoolA('u-as6');
    prisma.class.findFirst = jest.fn().mockResolvedValue(null);
    const res = await request(app).post('/api/v1/assignments/submissions').set('Authorization', tok('u-as6')).set('x-school-id', SCHOOL_A).send({ classId: 'nonexistent', title: 'Test' });
    expect(res.status).toBe(403);
    expect(res.status).not.toBe(500);
    expect(prisma.assignmentSubmission.create).not.toHaveBeenCalled();
  });

  test('AS7: No student profile in school → 403', async () => {
    setupUser('u-as7', 'MEMBER', SCHOOL_A);
    setupMembership('u-as7', SCHOOL_A, 'STUDENT');
    prisma.class.findFirst = jest.fn().mockResolvedValue({ id: 'class-a', schoolId: SCHOOL_A });
    prisma.student.findFirst = jest.fn().mockResolvedValue(null);
    const res = await request(app).post('/api/v1/assignments/submissions').set('Authorization', tok('u-as7')).set('x-school-id', SCHOOL_A).send({ classId: 'class-a', title: 'No profile' });
    expect(res.status).toBe(403);
    expect(prisma.assignmentSubmission.create).not.toHaveBeenCalled();
  });

  test('Missing classId → 400', async () => {
    setupUser('u-as-miss', 'MEMBER', SCHOOL_A);
    setupMembership('u-as-miss', SCHOOL_A, 'STUDENT');
    prisma.student.findFirst = jest.fn().mockResolvedValue({ id: 'stu-miss', userId: 'u-as-miss', schoolId: SCHOOL_A });
    const res = await request(app).post('/api/v1/assignments/submissions').set('Authorization', tok('u-as-miss')).set('x-school-id', SCHOOL_A).send({ title: 'No classId' });
    expect(res.status).toBe(400);
    expect(prisma.assignmentSubmission.create).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FIND-02: Exam Submission Security
// ═════════════════════════════════════════════════════════════════════════════

describe('FIND-02: Exam — server-controlled school context', () => {
  let app;
  beforeAll(() => { app = buildExamApp(); });

  function setupValidStudentForExam(userId = 'u-ex-student') {
    setupUser(userId, 'MEMBER', SCHOOL_A);
    setupMembership(userId, SCHOOL_A, 'STUDENT');
    prisma.student.findFirst = jest.fn().mockImplementation(({ where }) => {
      if (where.userId === userId && where.schoolId === SCHOOL_A) {
        return Promise.resolve({ id: `stu-${userId}`, userId, schoolId: SCHOOL_A, deletedAt: null });
      }
      return Promise.resolve(null);
    });
  }

  test('EX1: Student creates exam submission for SchoolA class → 201 with server schoolId', async () => {
    setupValidStudentForExam('u-ex1');
    prisma.class.findFirst = jest.fn().mockResolvedValue({ id: 'class-a', schoolId: SCHOOL_A });
    prisma.examSubmission.create = jest.fn().mockResolvedValue({ id: 'exsub-1', schoolId: SCHOOL_A, classId: 'class-a', studentId: 'stu-u-ex1' });
    const res = await request(app).post('/api/v1/exams/submissions').set('Authorization', tok('u-ex1')).set('x-school-id', SCHOOL_A).send({ classId: 'class-a', title: 'Exam 1', answers: {} });
    expect(res.status).toBe(201);
    const d = prisma.examSubmission.create.mock.calls[0][0].data;
    expect(d.schoolId).toBe(SCHOOL_A);
    expect(d.studentId).toBe('stu-u-ex1');
  });

  test('EX2: body.schoolId=SchoolB injection ignored → uses req.schoolId (SchoolA)', async () => {
    setupValidStudentForExam('u-ex2');
    prisma.class.findFirst = jest.fn().mockImplementation(({ where }) => {
      if (where.id === 'class-a' && where.schoolId === SCHOOL_A) return Promise.resolve({ id: 'class-a', schoolId: SCHOOL_A });
      return Promise.resolve(null);
    });
    prisma.examSubmission.create = jest.fn().mockResolvedValue({ id: 'exsub-2', schoolId: SCHOOL_A, classId: 'class-a', studentId: 'stu-u-ex2' });
    const res = await request(app).post('/api/v1/exams/submissions').set('Authorization', tok('u-ex2')).set('x-school-id', SCHOOL_A).send({ classId: 'class-a', schoolId: SCHOOL_B, title: 'Injected exam' });
    expect(res.status).toBe(201);
    const d = prisma.examSubmission.create.mock.calls[0][0].data;
    expect(d.schoolId).toBe(SCHOOL_A);
    expect(d.schoolId).not.toBe(SCHOOL_B);
  });

  test('EX3: classId from SchoolB → 403', async () => {
    setupValidStudentForExam('u-ex3');
    prisma.class.findFirst = jest.fn().mockResolvedValue(null);
    const res = await request(app).post('/api/v1/exams/submissions').set('Authorization', tok('u-ex3')).set('x-school-id', SCHOOL_A).send({ classId: 'class-b', title: 'Cross-school exam' });
    expect(res.status).toBe(403);
    expect(prisma.examSubmission.create).not.toHaveBeenCalled();
  });

  test('EX4: gradeId not belonging to classId → 403', async () => {
    setupValidStudentForExam('u-ex4');
    prisma.class.findFirst = jest.fn().mockResolvedValue({ id: 'class-a', schoolId: SCHOOL_A });
    prisma.grade.findFirst = jest.fn().mockResolvedValue(null);
    const res = await request(app).post('/api/v1/exams/submissions').set('Authorization', tok('u-ex4')).set('x-school-id', SCHOOL_A).send({ classId: 'class-a', gradeId: 'grade-other', title: 'Cross-grade exam' });
    expect(res.status).toBe(403);
    expect(prisma.examSubmission.create).not.toHaveBeenCalled();
  });

  test('EX5: Non-existent classId → 403, not 500', async () => {
    setupValidStudentForExam('u-ex5');
    prisma.class.findFirst = jest.fn().mockResolvedValue(null);
    const res = await request(app).post('/api/v1/exams/submissions').set('Authorization', tok('u-ex5')).set('x-school-id', SCHOOL_A).send({ classId: 'nonexistent', title: 'Test exam' });
    expect(res.status).toBe(403);
    expect(res.status).not.toBe(500);
    expect(prisma.examSubmission.create).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SA-SOCIAL-READ-001: Social Read Boundary
// ═════════════════════════════════════════════════════════════════════════════

describe('SA-SOCIAL-READ-001: SUPER_ADMIN blocked from social read endpoints', () => {
  let app;
  beforeAll(() => { app = buildPostApp(); });

  function setupSA() {
    const u = { id: 'sa-read', role: 'SUPER_ADMIN', status: 'ACTIVE', schoolId: null, firstName: 'SA', lastName: 'U', avatarUrl: null, deletedAt: null };
    verifyAccessToken.mockReturnValue({ userId: 'sa-read', role: 'SUPER_ADMIN', schoolId: null });
    prisma.user.findUnique.mockResolvedValue(u);
    return u;
  }

  function setupMember() {
    const u = { id: 'mem-read', role: 'MEMBER', status: 'ACTIVE', schoolId: null, firstName: 'M', lastName: 'U', avatarUrl: null, deletedAt: null };
    verifyAccessToken.mockReturnValue({ userId: 'mem-read', role: 'MEMBER', schoolId: null });
    prisma.user.findUnique.mockResolvedValue(u);
    return u;
  }

  test('SR-01: SUPER_ADMIN GET /posts/feed → 403', async () => {
    setupSA();
    const res = await request(app).get('/api/v1/posts/feed').set('Authorization', tok('sa-read'));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/platform administrator/i);
  });

  test('SR-02: SUPER_ADMIN GET /posts/:id → 403', async () => {
    setupSA();
    const res = await request(app).get('/api/v1/posts/some-post-id').set('Authorization', tok('sa-read'));
    expect(res.status).toBe(403);
  });

  test('SR-03: SUPER_ADMIN GET /posts/trending → 403', async () => {
    setupSA();
    const res = await request(app).get('/api/v1/posts/trending').set('Authorization', tok('sa-read'));
    expect(res.status).toBe(403);
  });

  test('SR-04: SUPER_ADMIN GET /posts/:id/reactions → 403', async () => {
    setupSA();
    const res = await request(app).get('/api/v1/posts/some-post-id/reactions').set('Authorization', tok('sa-read'));
    expect(res.status).toBe(403);
  });

  test('SR-05: SUPER_ADMIN GET /posts/:id/comments → 403', async () => {
    setupSA();
    const res = await request(app).get('/api/v1/posts/some-post-id/comments').set('Authorization', tok('sa-read'));
    expect(res.status).toBe(403);
  });

  test('SR-06: Normal MEMBER can GET /posts/feed (unchanged) → not 403', async () => {
    setupMember();
    // Mock minimal feed data
    const { isRedisReady, getCache } = require('../utils/redis');
    isRedisReady.mockReturnValue(false);
    getCache.mockResolvedValue(null);
    if (!prisma.follow) prisma.follow = {};
    prisma.follow.findMany = jest.fn().mockResolvedValue([]);
    if (!prisma.post) prisma.post = {};
    prisma.post.findMany = jest.fn().mockResolvedValue([]);
    prisma.schoolMembership.findFirst.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/posts/feed').set('Authorization', tok('mem-read'));
    expect(res.status).not.toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FIND-03: JSDoc source verification
// ═════════════════════════════════════════════════════════════════════════════

describe('FIND-03: schoolAuth.middleware.js JSDoc updated', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../middleware/schoolAuth.middleware.js'),
    'utf8'
  );

  test('Stale "Legacy compatibility: SUPER_ADMIN...allowed through" text removed', () => {
    expect(src).not.toMatch(/Legacy compatibility: SUPER_ADMIN users with no SchoolMembership/);
    expect(src).not.toMatch(/are allowed through.*fully migrated/s);
  });

  test('Updated JSDoc correctly states SchoolMembership is required for all users', () => {
    expect(src).toMatch(/ARCH-01/);
    expect(src).toMatch(/SchoolMembership is the authoritative source/);
    expect(src).toMatch(/SUPER_ADMIN does NOT receive an implicit school-membership/);
  });

  test('SA-SCHOOL-DATA-001 fix present: SUPER_ADMIN early-exit in requireSchoolMember', () => {
    expect(src).toMatch(/SA-SCHOOL-DATA-001 FIX/);
    expect(src).toMatch(/req\.user\.role === 'SUPER_ADMIN'/);
    expect(src).toMatch(/Platform administrators do not have school-scoped access/);
  });

  test('Implementation still has membership check (no unintended removal)', () => {
    expect(src).toMatch(/loadMembership\(req\.user\.id, schoolId\)/);
    expect(src).toMatch(/You are not a member of this school/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SA-SOCIAL-READ-001 SOURCE: post.routes.js verification
// ═════════════════════════════════════════════════════════════════════════════

describe('SA-SOCIAL-READ-001 source: post.routes.js denyIfSuperAdmin on read routes', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../routes/post.routes.js'),
    'utf8'
  );

  test('GET /feed has denyIfSuperAdmin', () => {
    expect(src).toMatch(/router\.get\(['"]\/feed['"],\s*denyIfSuperAdmin/);
  });

  test('GET /trending has denyIfSuperAdmin', () => {
    expect(src).toMatch(/router\.get\(['"]\/trending['"],\s*denyIfSuperAdmin/);
  });

  test('GET /search has denyIfSuperAdmin', () => {
    expect(src).toMatch(/router\.get\(['"]\/search['"],\s*denyIfSuperAdmin/);
  });

  test('GET /:id has denyIfSuperAdmin', () => {
    expect(src).toMatch(/router\.get\(['"]\/\:id['"],\s*denyIfSuperAdmin/);
  });

  test('GET /:id/reactions has denyIfSuperAdmin', () => {
    expect(src).toMatch(/router\.get\(['"]\/\:id\/reactions['"],\s*denyIfSuperAdmin/);
  });

  test('GET /:id/comments has denyIfSuperAdmin', () => {
    expect(src).toMatch(/router\.get\(['"]\/\:id\/comments['"],\s*denyIfSuperAdmin/);
  });

  test('DELETE /:id does NOT have denyIfSuperAdmin (platform moderation preserved)', () => {
    // SA can still delete posts for platform moderation
    const deleteBlock = src.slice(src.indexOf('router.delete(\'/:id\''));
    expect(deleteBlock.slice(0, 100)).not.toMatch(/denyIfSuperAdmin/);
  });
});
