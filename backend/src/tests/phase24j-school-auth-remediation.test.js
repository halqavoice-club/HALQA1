'use strict';
/**
 * HALQA — Phase 24J School Authorization Remediation Regression Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * P2-001: Grade cross-school IDOR — classId and studentId validation
 * P2-002: Attendance cross-school IDOR — classId, studentId, and bulk
 * P2-003: Dead SUPER_ADMIN bypass removed from grade/analytics controllers
 *
 * Test Matrix — Grade (P2-001):
 *   G1  School A teacher GET /grades/class/:classId where classId is School B → 404
 *   G2  School A teacher POST /grades with School B classId → 403
 *   G3  School A teacher POST /grades with School B studentId → 403
 *   G4  School A teacher PUT /grades/:id where grade's class is School B → 403
 *   G5  School A teacher DELETE /grades/:id where grade's class is School B → 403
 *   G6  School A teacher POST /grades with valid School A classId+studentId → 201
 *
 * Test Matrix — Attendance (P2-002):
 *   AT1 School A teacher GET /attendance/class/:classId where classId is School B → 404
 *   AT2 School A teacher POST /attendance with School B studentId → 403
 *   AT3 School A teacher POST /attendance/bulk with one School B student → 400
 *   AT4 School A teacher POST /attendance with valid School A classId+studentId → 200
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

const request      = require('supertest');
const express      = require('express');
const cookieParser = require('cookie-parser');
const prisma       = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');

// ─── App builders ─────────────────────────────────────────────────────────────

function buildGradeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/grades', require('../routes/grade.routes'));
  app.use((err, req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

function buildAttendanceApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/attendance', require('../routes/attendance.routes'));
  app.use((err, req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tok(id) { return `Bearer t-${id}`; }

const SCHOOL_A = 'school-a';
const SCHOOL_B = 'school-b';

function setupUser(userId, role, schoolId) {
  const u = {
    id: userId, role, status: 'ACTIVE',
    schoolId: schoolId || null,
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

// ─── beforeEach: Reset all mocks and initialize prisma tables ─────────────────

beforeEach(() => {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);
  require('../utils/redis').getCache.mockResolvedValue(null);

  // SchoolMembership
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  prisma.schoolMembership.findFirst  = jest.fn().mockResolvedValue(null);
  prisma.schoolMembership.findUnique = jest.fn().mockResolvedValue(null);

  // AuditLog
  if (!prisma.auditLog) prisma.auditLog = {};
  prisma.auditLog.create = jest.fn().mockResolvedValue({});

  // Grade
  if (!prisma.grade) prisma.grade = {};
  prisma.grade.create    = jest.fn();
  prisma.grade.findMany  = jest.fn().mockResolvedValue([]);
  prisma.grade.findFirst = jest.fn().mockResolvedValue(null);
  prisma.grade.update    = jest.fn();
  prisma.$transaction    = jest.fn().mockResolvedValue([]);

  // Attendance
  if (!prisma.attendance) prisma.attendance = {};
  prisma.attendance.upsert   = jest.fn();
  prisma.attendance.update   = jest.fn();
  prisma.attendance.findMany = jest.fn().mockResolvedValue([]);
  if (!prisma.attendanceLog) prisma.attendanceLog = {};
  prisma.attendanceLog.create = jest.fn().mockResolvedValue({});

  // Teacher
  if (!prisma.teacher) prisma.teacher = {};
  prisma.teacher.findFirst  = jest.fn().mockResolvedValue(null);
  prisma.teacher.findUnique = jest.fn().mockResolvedValue(null);

  // Class
  if (!prisma.class) prisma.class = {};
  prisma.class.findFirst = jest.fn().mockResolvedValue(null);

  // Student
  if (!prisma.student) prisma.student = {};
  prisma.student.findFirst = jest.fn().mockResolvedValue(null);
  prisma.student.findMany  = jest.fn().mockResolvedValue([]);

  // User
  if (!prisma.user) prisma.user = {};
  prisma.user.findUnique = jest.fn().mockResolvedValue(null);
});

// ═════════════════════════════════════════════════════════════════════════════
// P2-001 — Grade Cross-School IDOR
// ═════════════════════════════════════════════════════════════════════════════

describe('P2-001: Grade — cross-school IDOR authorization', () => {
  let app;
  beforeAll(() => { app = buildGradeApp(); });

  test('G1: GET /grades/class/:classId where classId belongs to School B → 404', async () => {
    setupUser('u-g1', 'MEMBER', SCHOOL_A);
    setupMembership('u-g1', SCHOOL_A, 'TEACHER');
    // class.findFirst returns null — class-b is not in SCHOOL_A
    prisma.class.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/grades/class/class-b')
      .set('Authorization', tok('u-g1'))
      .set('x-school-id', SCHOOL_A);

    expect(res.status).toBe(404);
    expect(prisma.grade.findMany).not.toHaveBeenCalled();
  });

  test('G2: POST /grades with School B classId → 403', async () => {
    setupUser('u-g2', 'MEMBER', SCHOOL_A);
    setupMembership('u-g2', SCHOOL_A, 'TEACHER');
    prisma.teacher.findFirst.mockResolvedValue({ id: 'teacher-a-id' });
    // class-b not in SCHOOL_A → findFirst returns null
    prisma.class.findFirst.mockResolvedValue(null);
    // student is valid (to isolate classId failure)
    prisma.student.findFirst.mockResolvedValue({ id: 'student-a', schoolId: SCHOOL_A });

    const res = await request(app)
      .post('/api/v1/grades')
      .set('Authorization', tok('u-g2'))
      .set('x-school-id', SCHOOL_A)
      .send({ classId: 'class-b', studentId: 'student-a', title: 'Math Test', type: 'EXAM', score: 80, maxScore: 100 });

    expect(res.status).toBe(403);
    expect(prisma.grade.create).not.toHaveBeenCalled();
  });

  test('G3: POST /grades with School B studentId → 403', async () => {
    setupUser('u-g3', 'MEMBER', SCHOOL_A);
    setupMembership('u-g3', SCHOOL_A, 'TEACHER');
    prisma.teacher.findFirst.mockResolvedValue({ id: 'teacher-a-id' });
    // class-a is in SCHOOL_A (valid), but student-b is not
    prisma.class.findFirst.mockImplementation(({ where }) => {
      if (where.id === 'class-a' && where.schoolId === SCHOOL_A) {
        return Promise.resolve({ id: 'class-a', schoolId: SCHOOL_A });
      }
      return Promise.resolve(null);
    });
    // student-b not in SCHOOL_A → findFirst returns null
    prisma.student.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/grades')
      .set('Authorization', tok('u-g3'))
      .set('x-school-id', SCHOOL_A)
      .send({ classId: 'class-a', studentId: 'student-b', title: 'Math Test', type: 'EXAM', score: 80, maxScore: 100 });

    expect(res.status).toBe(403);
    expect(prisma.grade.create).not.toHaveBeenCalled();
  });

  test('G4: PUT /grades/:id where existing grade class belongs to School B → 403', async () => {
    setupUser('u-g4', 'MEMBER', SCHOOL_A);
    setupMembership('u-g4', SCHOOL_A, 'TEACHER');
    // grade exists but is associated with class-b (School B class)
    prisma.grade.findFirst.mockResolvedValue({
      id: 'grade-1', classId: 'class-b', teacherId: 'teacher-a-id', deletedAt: null
    });
    // class-b not in SCHOOL_A → class lookup returns null
    prisma.class.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/v1/grades/grade-1')
      .set('Authorization', tok('u-g4'))
      .set('x-school-id', SCHOOL_A)
      .send({ score: 90, maxScore: 100 });

    expect(res.status).toBe(403);
    expect(prisma.grade.update).not.toHaveBeenCalled();
  });

  test('G5: DELETE /grades/:id where existing grade class belongs to School B → 403', async () => {
    setupUser('u-g5', 'MEMBER', SCHOOL_A);
    setupMembership('u-g5', SCHOOL_A, 'TEACHER');
    // grade exists but associated with class-b (School B class)
    prisma.grade.findFirst.mockResolvedValue({
      id: 'grade-2', classId: 'class-b', teacherId: 'teacher-a-id', deletedAt: null
    });
    // class-b not in SCHOOL_A → class lookup returns null
    prisma.class.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/v1/grades/grade-2')
      .set('Authorization', tok('u-g5'))
      .set('x-school-id', SCHOOL_A);

    expect(res.status).toBe(403);
    expect(prisma.grade.update).not.toHaveBeenCalled();
  });

  test('G6: POST /grades with valid School A classId and studentId → 201 (regression positive)', async () => {
    setupUser('u-g6', 'MEMBER', SCHOOL_A);
    setupMembership('u-g6', SCHOOL_A, 'TEACHER');
    prisma.teacher.findFirst.mockResolvedValue({ id: 'teacher-a-id' });
    // Both class and student belong to SCHOOL_A
    prisma.class.findFirst.mockResolvedValue({ id: 'class-a', schoolId: SCHOOL_A });
    prisma.student.findFirst.mockResolvedValue({ id: 'student-a', schoolId: SCHOOL_A });
    prisma.grade.create.mockResolvedValue({
      id: 'grade-new', studentId: 'student-a', classId: 'class-a',
      score: 80, maxScore: 100, percentage: 80, letterGrade: 'B-',
      student: { user: { firstName: 'Alice', lastName: 'Smith' } },
      category: null
    });

    const res = await request(app)
      .post('/api/v1/grades')
      .set('Authorization', tok('u-g6'))
      .set('x-school-id', SCHOOL_A)
      .send({ classId: 'class-a', studentId: 'student-a', title: 'Math Test', type: 'EXAM', score: 80, maxScore: 100 });

    expect(res.status).toBe(201);
    expect(prisma.grade.create).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// P2-002 — Attendance Cross-School IDOR
// ═════════════════════════════════════════════════════════════════════════════

describe('P2-002: Attendance — cross-school IDOR authorization', () => {
  let app;
  beforeAll(() => { app = buildAttendanceApp(); });

  test('AT1: GET /attendance/class/:classId where classId belongs to School B → 404', async () => {
    setupUser('u-at1', 'MEMBER', SCHOOL_A);
    setupMembership('u-at1', SCHOOL_A, 'TEACHER');
    // class-b not in SCHOOL_A — existing M-2 FIX returns 404
    prisma.class.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/attendance/class/class-b')
      .set('Authorization', tok('u-at1'))
      .set('x-school-id', SCHOOL_A);

    expect(res.status).toBe(404);
    expect(prisma.attendance.findMany).not.toHaveBeenCalled();
  });

  test('AT2: POST /attendance with School B studentId → 403', async () => {
    setupUser('u-at2', 'MEMBER', SCHOOL_A);
    setupMembership('u-at2', SCHOOL_A, 'TEACHER');
    prisma.teacher.findFirst.mockResolvedValue({ id: 'teacher-a-id' });
    // class-a is in SCHOOL_A (valid), but student-b is not
    prisma.class.findFirst.mockImplementation(({ where }) => {
      if (where.id === 'class-a' && where.schoolId === SCHOOL_A) {
        return Promise.resolve({ id: 'class-a', schoolId: SCHOOL_A });
      }
      return Promise.resolve(null);
    });
    // student-b not in SCHOOL_A → findFirst returns null
    prisma.student.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/attendance')
      .set('Authorization', tok('u-at2'))
      .set('x-school-id', SCHOOL_A)
      .send({ classId: 'class-a', studentId: 'student-b', date: '2026-09-01', status: 'PRESENT' });

    expect(res.status).toBe(403);
    expect(prisma.attendance.upsert).not.toHaveBeenCalled();
  });

  test('AT3: POST /attendance/bulk with one School B student → 400', async () => {
    setupUser('u-at3', 'MEMBER', SCHOOL_A);
    setupMembership('u-at3', SCHOOL_A, 'TEACHER');
    // class-a is in SCHOOL_A (valid)
    prisma.class.findFirst.mockResolvedValue({ id: 'class-a', schoolId: SCHOOL_A });
    // Only student-a is valid in SCHOOL_A; student-b is foreign
    prisma.student.findMany.mockResolvedValue([{ id: 'student-a' }]);

    const res = await request(app)
      .post('/api/v1/attendance/bulk')
      .set('Authorization', tok('u-at3'))
      .set('x-school-id', SCHOOL_A)
      .send({
        classId: 'class-a',
        date: '2026-09-01',
        records: [
          { studentId: 'student-a', status: 'PRESENT' },
          { studentId: 'student-b', status: 'ABSENT' }  // School B student
        ]
      });

    expect(res.status).toBe(400);
    expect(prisma.attendance.upsert).not.toHaveBeenCalled();
  });

  test('AT4: POST /attendance with valid School A classId and studentId → 200 (regression positive)', async () => {
    setupUser('u-at4', 'MEMBER', SCHOOL_A);
    setupMembership('u-at4', SCHOOL_A, 'TEACHER');
    prisma.teacher.findFirst.mockResolvedValue({ id: 'teacher-a-id' });
    // Both class and student belong to SCHOOL_A
    prisma.class.findFirst.mockResolvedValue({ id: 'class-a', schoolId: SCHOOL_A });
    prisma.student.findFirst.mockResolvedValue({ id: 'student-a', schoolId: SCHOOL_A });
    const mockAttendance = {
      id: 'att-1', classId: 'class-a', studentId: 'student-a',
      date: new Date('2026-09-01'), status: 'PRESENT',
      notifiedParent: false,
      student: {
        user: { firstName: 'Alice', lastName: 'Smith' },
        guardianLinks: []
      }
    };
    prisma.attendance.upsert.mockResolvedValue(mockAttendance);
    prisma.attendanceLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/attendance')
      .set('Authorization', tok('u-at4'))
      .set('x-school-id', SCHOOL_A)
      .send({ classId: 'class-a', studentId: 'student-a', date: '2026-09-01', status: 'PRESENT' });

    expect(res.status).toBe(200);
    expect(prisma.attendance.upsert).toHaveBeenCalledTimes(1);
  });
});
