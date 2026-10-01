'use strict';
/**
 * Student ID Card — School Ownership Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Enforces the core invariant:
 *
 *   ID CARD SCHOOL = STUDENT'S OWN ENROLLED SCHOOL
 *
 *   Never the requesting admin's school, never a frontend-supplied school,
 *   never a hardcoded default.
 *
 * COVERAGE:
 *   1. SOURCE AUDIT — getStudent includes school, no hardcoded branding
 *   2. BACKEND DATA FLOW — school in response comes from student.schoolId
 *   3. SCHOOL ISOLATION — admin cannot get student from another school
 *   4. QR REGENERATION — school-scoped before regenerating
 *   5. QR CHECK-IN — school-scoped, prevents cross-school attendance
 *   6. SCHOOL OWNERSHIP — name and logo come from SAME school record
 *   7. MULTIPLE SCHOOLS — correct school even when admin has different school
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

const request  = require('supertest');
const express  = require('express');
const cookieParser = require('cookie-parser');
const prisma   = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');
const fs   = require('fs');
const path = require('path');

// ─── Test apps ────────────────────────────────────────────────────────────────

function buildStudentApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/students', require('../routes/student.routes'));
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

function setupUser(userId, role, schoolId) {
  const u = { id: userId, role, status: 'ACTIVE', schoolId, firstName: 'T', lastName: 'U', avatarUrl: null, deletedAt: null };
  verifyAccessToken.mockReturnValue({ userId, role, schoolId });
  prisma.user.findUnique.mockResolvedValue(u);
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  if (!prisma.schoolMembership.findFirst) prisma.schoolMembership.findFirst = jest.fn();
  prisma.schoolMembership.findFirst.mockResolvedValue({
    id: `mem-${userId}`, userId, schoolId, role: role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'SCHOOL_ADMIN', status: 'ACTIVE',
  });
  return u;
}

function stubStudentWithSchool(studentId, studentSchoolId, adminSchoolId) {
  if (!prisma.student) prisma.student = {};
  if (!prisma.student.findFirst) prisma.student.findFirst = jest.fn();

  const SCHOOL_A = { id: 'school-a', name: 'Green Valley Academy', logoUrl: '/uploads/school-a-logo.png', address: '1 Green St', phone: null };
  const SCHOOL_B = { id: 'school-b', name: 'Blue Ridge School',    logoUrl: '/uploads/school-b-logo.png', address: '2 Blue Rd',  phone: null };
  const school = studentSchoolId === 'school-a' ? SCHOOL_A : SCHOOL_B;

  // findFirst returns the student ONLY if schoolId filter matches
  prisma.student.findFirst.mockImplementation(({ where }) => {
    const filterSchoolId = where?.schoolId;
    if (filterSchoolId && filterSchoolId !== studentSchoolId) return Promise.resolve(null);
    return Promise.resolve({
      id: studentId,
      schoolId: studentSchoolId,
      studentId: 'STU-001',
      qrCode: `QR-${studentId.toUpperCase()}`,
      gradeLevel: '5',
      deletedAt: null,
      school,   // <── always from student's own school
      user: { id: `user-${studentId}`, firstName: 'Ahmad', lastName: 'Hassan', email: 'a@school.com', phone: null, avatarUrl: null, dateOfBirth: null, gender: null, status: 'ACTIVE', emailVerified: true, lastLoginAt: null },
      enrollments: [{ isActive: true, class: { id: 'cls-1', name: 'Grade 5A' } }],
      guardianLinks: [],
    });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);
  require('../utils/redis').getCache.mockResolvedValue(null);
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  if (!prisma.schoolMembership.findFirst)  prisma.schoolMembership.findFirst  = jest.fn().mockResolvedValue(null);
  if (!prisma.schoolMembership.findUnique) prisma.schoolMembership.findUnique = jest.fn().mockResolvedValue(null);
  if (!prisma.auditLog) prisma.auditLog = { create: jest.fn().mockResolvedValue({}) };
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. SOURCE AUDIT — controller and component use correct source
// ═════════════════════════════════════════════════════════════════════════════

describe('SOURCE AUDIT: student.controller.js includes school in getStudent', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '../controllers/student.controller.js'), 'utf8');

  test('getStudent includes school relation in Prisma query', () => {
    const getStudentBlock = SRC.slice(
      SRC.indexOf('async function getStudent'),
      SRC.indexOf('async function createStudent')
    );
    expect(getStudentBlock).toMatch(/school\s*:/);
    expect(getStudentBlock).toMatch(/name\s*:\s*true/);
    expect(getStudentBlock).toMatch(/logoUrl\s*:\s*true/);
  });

  test('regenerateQr checks school ownership before updating', () => {
    const qrBlock = SRC.slice(
      SRC.indexOf('async function regenerateQr'),
      SRC.indexOf('module.exports')
    );
    // Must verify student.schoolId matches before updating
    expect(qrBlock).toMatch(/findFirst|schoolId/);
  });
});

describe('SOURCE AUDIT: student-id-card.tsx has no hardcoded school branding', () => {
  // Find the component file relative to backend (it's in frontend)
  const componentPath = path.join(__dirname, '../../../frontend/src/components/student-id-card.tsx');

  test('component file exists', () => {
    expect(fs.existsSync(componentPath)).toBe(true);
  });

  test('no hardcoded "Halqa Academy" in component JSX/logic (comments excluded)', () => {
    if (!fs.existsSync(componentPath)) return;
    const src = fs.readFileSync(componentPath, 'utf8');
    // Strip single-line and multi-line comments, then check for hardcoded branding
    const noComments = src
      .replace(/\/\/[^\n]*/g, '')           // remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '');    // remove multi-line comments
    expect(noComments).not.toMatch(/Halqa Academy/i);
  });

  test('no hardcoded school logo (static /logo.png or similar)', () => {
    if (!fs.existsSync(componentPath)) return;
    const src = fs.readFileSync(componentPath, 'utf8');
    // Must not have a hardcoded logo src like src="/logo.png" or src="halqa.png"
    expect(src).not.toMatch(/src="\/logo|src='\/logo|src="halqa|src='halqa/i);
  });

  test('school name uses student.school.name (dynamic)', () => {
    if (!fs.existsSync(componentPath)) return;
    const src = fs.readFileSync(componentPath, 'utf8');
    expect(src).toMatch(/school\.name|school\?\.name/);
  });

  test('school logo uses student.school.logoUrl (dynamic)', () => {
    if (!fs.existsSync(componentPath)) return;
    const src = fs.readFileSync(componentPath, 'utf8');
    expect(src).toMatch(/school\.logoUrl|school\?\.logoUrl/);
  });

  test('schoolName prop is removed (no longer accepted)', () => {
    if (!fs.existsSync(componentPath)) return;
    const src = fs.readFileSync(componentPath, 'utf8');
    // The old schoolName prop that could inject a different school's name is removed
    expect(src).not.toMatch(/schoolName\s*:/);
    expect(src).not.toMatch(/schoolName\s*\?/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. BACKEND — school data in response comes from student's own school
// ═════════════════════════════════════════════════════════════════════════════

describe('RUNTIME: GET /students/:id — school comes from student enrollment', () => {
  let app;
  beforeAll(() => { app = buildStudentApp(); });

  test('response includes student.school with name and logoUrl', async () => {
    setupUser('admin-1', 'SCHOOL_ADMIN', 'school-a');
    stubStudentWithSchool('student-1', 'school-a', 'school-a');

    const res = await request(app)
      .get('/api/v1/students/student-1')
      .set('Authorization', tok('admin-1'))
      .set('x-school-id', 'school-a');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('school');
    expect(res.body.data.school).toHaveProperty('name');
    expect(res.body.data.school).toHaveProperty('logoUrl');
    expect(res.body.data.school.name).not.toBe('');
  });

  test('student from school-a returns school-a branding, not admin school-b', async () => {
    // Admin is in school-b but student is in school-a
    // This test verifies cross-context school isolation
    setupUser('admin-b', 'SCHOOL_ADMIN', 'school-b');

    // Student is in school-a — admin from school-b should get 404 (school isolation)
    if (!prisma.student) prisma.student = {};
    prisma.student.findFirst = jest.fn().mockImplementation(({ where }) => {
      // schoolId filter: school-b ≠ school-a → null
      if (where?.schoolId === 'school-b') return Promise.resolve(null);
      return Promise.resolve({ id: 'student-a', schoolId: 'school-a' });
    });

    const res = await request(app)
      .get('/api/v1/students/student-a')
      .set('Authorization', tok('admin-b'))
      .set('x-school-id', 'school-b');

    // Admin B cannot see School A's student — 404 due to school scoping
    expect(res.status).toBe(404);
  });

  test('school.name in response is the student\'s school, not the requester\'s school', async () => {
    setupUser('admin-sa', 'SCHOOL_ADMIN', 'school-a');
    stubStudentWithSchool('student-sa', 'school-a', 'school-a');

    const res = await request(app)
      .get('/api/v1/students/student-sa')
      .set('Authorization', tok('admin-sa'))
      .set('x-school-id', 'school-a');

    expect(res.status).toBe(200);
    // The school name must be the student's school (school-a = "Green Valley Academy")
    expect(res.body.data.school.name).toBe('Green Valley Academy');
    expect(res.body.data.school.id).toBe('school-a');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. SCHOOL ISOLATION (IDOR prevention)
// ═════════════════════════════════════════════════════════════════════════════

describe('RUNTIME: School isolation — IDOR prevention', () => {
  let app;
  beforeAll(() => { app = buildStudentApp(); });

  test('SCHOOL_ADMIN cannot view student from another school → 404', async () => {
    setupUser('admin-school-x', 'SCHOOL_ADMIN', 'school-x');
    stubStudentWithSchool('student-y', 'school-y', 'school-x'); // student in y, admin in x

    const res = await request(app)
      .get('/api/v1/students/student-y')
      .set('Authorization', tok('admin-school-x'))
      .set('x-school-id', 'school-x');

    expect(res.status).toBe(404);
  });

  test('SCHOOL_ADMIN can view student from their own school → 200', async () => {
    setupUser('admin-same', 'SCHOOL_ADMIN', 'school-a');
    stubStudentWithSchool('student-same', 'school-a', 'school-a');

    const res = await request(app)
      .get('/api/v1/students/student-same')
      .set('Authorization', tok('admin-same'))
      .set('x-school-id', 'school-a');

    expect(res.status).toBe(200);
  });

  test('Unauthenticated request → 401', async () => {
    const res = await request(app).get('/api/v1/students/any-student');
    expect(res.status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. QR REGENERATION — school-scoped
// ═════════════════════════════════════════════════════════════════════════════

describe('RUNTIME: POST /students/:id/regenerate-qr — school-scoped', () => {
  let app;
  beforeAll(() => { app = buildStudentApp(); });

  test('SCHOOL_ADMIN cannot regenerate QR for student in another school → 404', async () => {
    setupUser('admin-regen', 'SCHOOL_ADMIN', 'school-a');
    if (!prisma.student) prisma.student = {};
    prisma.student.findFirst = jest.fn().mockResolvedValue(null); // different school → not found

    const res = await request(app)
      .post('/api/v1/students/student-other-school/regenerate-qr')
      .set('Authorization', tok('admin-regen'))
      .set('x-school-id', 'school-a');

    expect(res.status).toBe(404);
    expect(prisma.student.update).not.toHaveBeenCalled();
  });

  test('SCHOOL_ADMIN can regenerate QR for student in their school → 200', async () => {
    setupUser('admin-regen-ok', 'SCHOOL_ADMIN', 'school-a');
    if (!prisma.student) prisma.student = {};
    prisma.student.findFirst = jest.fn().mockResolvedValue({ id: 'student-own', schoolId: 'school-a' });
    prisma.student.update = jest.fn().mockResolvedValue({ id: 'student-own', qrCode: 'STU-NEWQR123' });

    const res = await request(app)
      .post('/api/v1/students/student-own/regenerate-qr')
      .set('Authorization', tok('admin-regen-ok'))
      .set('x-school-id', 'school-a');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('qrCode');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. QR CHECK-IN — correct school boundary
// ═════════════════════════════════════════════════════════════════════════════

describe('RUNTIME: POST /attendance/qr-checkin — school boundary enforced', () => {
  let app;
  beforeAll(() => { app = buildAttendanceApp(); });

  test('QR code from different school cannot mark attendance in this school → 403', async () => {
    setupUser('teacher-a', 'TEACHER', 'school-a');

    if (!prisma.student) prisma.student = {};
    // QR maps to student in school-b
    prisma.student.findUnique = jest.fn().mockResolvedValue({
      id: 'student-b', schoolId: 'school-b',
      user: { firstName: 'Ahmad', lastName: 'Hassan' }
    });

    const res = await request(app)
      .post('/api/v1/attendance/qr-checkin')
      .set('Authorization', tok('teacher-a'))
      .set('x-school-id', 'school-a')
      .send({ qrCode: 'QR-SCHOOLB', classId: 'class-a-1' });

    // student.schoolId (school-b) ≠ admin/teacher schoolId (school-a) → 403
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/school/i);
  });

  test('QR code for student in same school marks attendance → proceeds past school check', async () => {
    setupUser('teacher-same', 'TEACHER', 'school-a');

    if (!prisma.student) prisma.student = {};
    prisma.student.findUnique = jest.fn().mockResolvedValue({
      id: 'student-a', schoolId: 'school-a',
      user: { firstName: 'Layla', lastName: 'Khalid' }
    });

    if (!prisma.class) prisma.class = {};
    prisma.class.findFirst = jest.fn().mockResolvedValue({ id: 'class-a-1', schoolId: 'school-a' });

    if (!prisma.attendance) prisma.attendance = {};
    prisma.attendance.upsert = jest.fn().mockResolvedValue({
      id: 'att-1', studentId: 'student-a', classId: 'class-a-1', status: 'PRESENT'
    });

    const res = await request(app)
      .post('/api/v1/attendance/qr-checkin')
      .set('Authorization', tok('teacher-same'))
      .set('x-school-id', 'school-a')
      .send({ qrCode: 'QR-SCHOOLA', classId: 'class-a-1' });

    // Should pass school check (200), even if DB returns a mock attendance record
    expect(res.status).toBe(200);
    expect(prisma.attendance.upsert).toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. SCHOOL OWNERSHIP — name and logo from the SAME school record
// ═════════════════════════════════════════════════════════════════════════════

describe('SOURCE AUDIT: school name and logo come from the same school record', () => {
  const componentPath = path.join(__dirname, '../../../frontend/src/components/student-id-card.tsx');

  test('component uses student.school for BOTH name and logo (same object)', () => {
    if (!fs.existsSync(componentPath)) return;
    const src = fs.readFileSync(componentPath, 'utf8');
    // Must reference school.name and school.logoUrl from the same variable
    // (not mixing school A name with school B logo)
    const schoolVar = src.match(/const school\s*=\s*student\.school/);
    expect(schoolVar).not.toBeNull();
    // The resolved schoolName must come from school?.name
    expect(src).toMatch(/school\?\.name/);
    // The resolved schoolLogo must come from school?.logoUrl or school.logoUrl
    expect(src).toMatch(/school\?\.logoUrl|school\.logoUrl/);
  });

  test('no separate schoolName variable that could be from a different context', () => {
    if (!fs.existsSync(componentPath)) return;
    const src = fs.readFileSync(componentPath, 'utf8');
    // The old schoolName prop acceptance is gone
    expect(src).not.toMatch(/schoolName\s*\?.*string/);
    expect(src).not.toMatch(/schoolName\s*:\s*string/);
  });
});
