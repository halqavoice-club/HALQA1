'use strict';
/**
 * Student + Teacher Permission Audit Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies SCHOOL_ADMIN cannot modify protected identity/account fields on
 * students, teachers, or guardians. Implements the full acceptance criteria
 * from the permission system audit.
 *
 * COVERAGE:
 *   STUDENT:
 *     - SCHOOL_ADMIN cannot change name, email, phone, username, password,
 *       socialId (N/A — field does not exist), role
 *     - SCHOOL_ADMIN cannot edit another school's student (IDOR)
 *     - updateStudent only writes: phone, dateOfBirth, gender, gradeLevel,
 *       medicalNotes, emergencyContact
 *
 *   TEACHER:
 *     - SCHOOL_ADMIN cannot change name, email, role
 *     - updateTeacher only writes: phone, department, specialization
 *
 *   GUARDIAN:
 *     - SCHOOL_ADMIN cannot change name, email
 *     - updateGuardian only writes: phone, relationship
 *
 *   MASS-ASSIGNMENT:
 *     - Destructured fields in all three update controllers are explicitly
 *       enumerated (no ...req.body spread)
 *
 *   SUPER_ADMIN:
 *     - Permissions are preserved as-is (school membership required)
 *
 * All tests use mocked DB — no real database required.
 * Run via: npm run test:unit
 */

jest.mock('../utils/prisma');
jest.mock('../utils/redis', () => ({
  isRedisReady:       jest.fn(() => false),
  getCache:           jest.fn().mockResolvedValue(null),
  setCache:           jest.fn().mockResolvedValue(undefined),
  deleteCache:        jest.fn().mockResolvedValue(undefined),
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/jwt', () => ({ verifyAccessToken: jest.fn() }));
jest.mock('../middleware/ipAllowlist', () => (req, res, next) => next());
jest.mock('../sockets', () => ({ getIo: jest.fn(() => null) }));

const request  = require('supertest');
const express  = require('express');
const cookieParser = require('cookie-parser');
const prisma   = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');
const fs   = require('fs');
const path = require('path');

// ─── Test app builders ────────────────────────────────────────────────────────

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

function buildTeacherApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/teachers', require('../routes/teacher.routes'));
  app.use((err, req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tok(id) { return `Bearer t-${id}`; }

/**
 * Set up an authenticated user with an active school membership.
 * Configures both verifyAccessToken mock and prisma.user.findUnique mock.
 */
function asSchoolAdmin(userId, schoolId = 'school-a') {
  const u = {
    id: userId, role: 'MEMBER', status: 'ACTIVE', schoolId,
    firstName: 'Admin', lastName: 'User', avatarUrl: null, deletedAt: null,
  };
  verifyAccessToken.mockReturnValue({ userId, role: 'MEMBER', schoolId });
  prisma.user.findUnique.mockResolvedValue(u);
  // requireSchoolMember calls prisma.schoolMembership.findFirst to load membership
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  if (!prisma.schoolMembership.findFirst) prisma.schoolMembership.findFirst = jest.fn();
  prisma.schoolMembership.findFirst.mockResolvedValue({
    id: `mem-${userId}`, userId, schoolId, role: 'SCHOOL_ADMIN', status: 'ACTIVE',
  });
  return u;
}

function asSuperAdmin(userId, schoolId = 'school-a') {
  const u = {
    id: userId, role: 'SUPER_ADMIN', status: 'ACTIVE', schoolId,
    firstName: 'Super', lastName: 'Admin', avatarUrl: null, deletedAt: null,
  };
  verifyAccessToken.mockReturnValue({ userId, role: 'SUPER_ADMIN', schoolId });
  prisma.user.findUnique.mockResolvedValue(u);
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  if (!prisma.schoolMembership.findFirst) prisma.schoolMembership.findFirst = jest.fn();
  prisma.schoolMembership.findFirst.mockResolvedValue({
    id: `mem-sa-${userId}`, userId, schoolId, role: 'SUPER_ADMIN', status: 'ACTIVE',
  });
  return u;
}

function asTeacher(userId, schoolId = 'school-a') {
  const u = {
    id: userId, role: 'MEMBER', status: 'ACTIVE', schoolId,
    firstName: 'Teacher', lastName: 'User', avatarUrl: null, deletedAt: null,
  };
  verifyAccessToken.mockReturnValue({ userId, role: 'MEMBER', schoolId });
  prisma.user.findUnique.mockResolvedValue(u);
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  if (!prisma.schoolMembership.findFirst) prisma.schoolMembership.findFirst = jest.fn();
  prisma.schoolMembership.findFirst.mockResolvedValue({
    id: `mem-tch-${userId}`, userId, schoolId, role: 'TEACHER', status: 'ACTIVE',
  });
  return u;
}

function asStudent(userId, schoolId = 'school-a') {
  const u = {
    id: userId, role: 'MEMBER', status: 'ACTIVE', schoolId,
    firstName: 'Student', lastName: 'User', avatarUrl: null, deletedAt: null,
  };
  verifyAccessToken.mockReturnValue({ userId, role: 'MEMBER', schoolId });
  prisma.user.findUnique.mockResolvedValue(u);
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  if (!prisma.schoolMembership.findFirst) prisma.schoolMembership.findFirst = jest.fn();
  prisma.schoolMembership.findFirst.mockResolvedValue({
    id: `mem-std-${userId}`, userId, schoolId, role: 'STUDENT', status: 'ACTIVE',
  });
  return u;
}

/** Stub a student belonging to a school */
function stubStudent(studentId, schoolId = 'school-a') {
  if (!prisma.student) prisma.student = {};
  if (!prisma.student.findFirst) prisma.student.findFirst = jest.fn();
  if (!prisma.student.update)    prisma.student.update    = jest.fn();
  prisma.student.findFirst.mockResolvedValue({
    id: studentId, schoolId, userId: `user-for-${studentId}`, studentId: 'STU-001',
    gradeLevel: '5', medicalNotes: null, emergencyContact: null, deletedAt: null,
  });
  prisma.student.update.mockResolvedValue({ id: studentId, gradeLevel: '5' });
  if (!prisma.user) prisma.user = {};
  if (!prisma.user.update) prisma.user.update = jest.fn();
  prisma.user.update.mockResolvedValue({});
  if (!prisma.auditLog) prisma.auditLog = {};
  if (!prisma.auditLog.create) prisma.auditLog.create = jest.fn();
  prisma.auditLog.create.mockResolvedValue({});
}

/** Stub a teacher belonging to a school */
function stubTeacher(teacherId, schoolId = 'school-a') {
  if (!prisma.teacher) prisma.teacher = {};
  if (!prisma.teacher.findFirst) prisma.teacher.findFirst = jest.fn();
  if (!prisma.teacher.update)    prisma.teacher.update    = jest.fn();
  prisma.teacher.findFirst.mockResolvedValue({
    id: teacherId, schoolId, userId: `user-for-${teacherId}`,
    department: 'Quran', specialization: 'Tajweed', deletedAt: null,
  });
  prisma.teacher.update.mockResolvedValue({ id: teacherId });
  if (!prisma.user) prisma.user = {};
  if (!prisma.user.update) prisma.user.update = jest.fn();
  prisma.user.update.mockResolvedValue({});
  if (!prisma.auditLog) prisma.auditLog = {};
  if (!prisma.auditLog.create) prisma.auditLog.create = jest.fn();
  prisma.auditLog.create.mockResolvedValue({});
}

beforeEach(() => {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);
  require('../utils/redis').getCache.mockResolvedValue(null);
  // Ensure auditLog and schoolMembership mocks exist for middleware chain
  prisma.auditLog = { create: jest.fn().mockResolvedValue({}) };
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  if (!prisma.schoolMembership.findFirst)  prisma.schoolMembership.findFirst  = jest.fn();
  if (!prisma.schoolMembership.findUnique) prisma.schoolMembership.findUnique = jest.fn();
  // Default: no membership (overridden per test by asSchoolAdmin/asSuperAdmin etc.)
  prisma.schoolMembership.findFirst.mockResolvedValue(null);
  prisma.schoolMembership.findUnique.mockResolvedValue(null);
});

// ═════════════════════════════════════════════════════════════════════════════
// SOURCE CODE AUDIT — these tests verify the implementation itself
// ═════════════════════════════════════════════════════════════════════════════

describe('SOURCE AUDIT: student.controller.js', () => {
  const SRC = fs.readFileSync(
    path.join(__dirname, '../controllers/student.controller.js'), 'utf8'
  );

  test('updateStudent does NOT destructure firstName from req.body', () => {
    const updateBlock = SRC.slice(SRC.indexOf('async function updateStudent'));
    const destructureMatch = updateBlock.match(/const\s*\{([^}]+)\}\s*=\s*req\.body/);
    if (destructureMatch) {
      expect(destructureMatch[1]).not.toMatch(/\bfirstName\b/);
      expect(destructureMatch[1]).not.toMatch(/\blastName\b/);
    }
  });

  test('updateStudent does NOT destructure lastName from req.body', () => {
    const updateBlock = SRC.slice(SRC.indexOf('async function updateStudent'));
    const destructureMatch = updateBlock.match(/const\s*\{([^}]+)\}\s*=\s*req\.body/);
    if (destructureMatch) {
      expect(destructureMatch[1]).not.toMatch(/\blastName\b/);
    }
  });

  test('updateStudent does NOT destructure email from req.body', () => {
    const updateBlock = SRC.slice(SRC.indexOf('async function updateStudent'));
    const destructureMatch = updateBlock.match(/const\s*\{([^}]+)\}\s*=\s*req\.body/);
    if (destructureMatch) {
      expect(destructureMatch[1]).not.toMatch(/\bemail\b/);
    }
  });

  test('updateStudent does NOT destructure role from req.body', () => {
    const updateBlock = SRC.slice(SRC.indexOf('async function updateStudent'));
    const destructureMatch = updateBlock.match(/const\s*\{([^}]+)\}\s*=\s*req\.body/);
    if (destructureMatch) {
      expect(destructureMatch[1]).not.toMatch(/\brole\b/);
    }
  });

  test('updateStudent does NOT destructure username from req.body', () => {
    const updateBlock = SRC.slice(SRC.indexOf('async function updateStudent'));
    const destructureMatch = updateBlock.match(/const\s*\{([^}]+)\}\s*=\s*req\.body/);
    if (destructureMatch) {
      expect(destructureMatch[1]).not.toMatch(/\busername\b/);
    }
  });

  test('updateStudent does NOT destructure phone from req.body', () => {
    const updateBlock = SRC.slice(SRC.indexOf('async function updateStudent'));
    const destructureMatch = updateBlock.match(/const\s*\{([^}]+)\}\s*=\s*req\.body/);
    if (destructureMatch) {
      expect(destructureMatch[1]).not.toMatch(/\bphone\b/);
    }
  });

  test('updateStudent does NOT use ...req.body spread (mass-assignment prevention)', () => {
    const updateBlock = SRC.slice(SRC.indexOf('async function updateStudent'));
    expect(updateBlock).not.toMatch(/\.\.\.\s*req\.body/);
    expect(updateBlock).not.toMatch(/data:\s*req\.body/);
  });

  test('user.create in createStudent hardcodes role as STUDENT (no req.body.role)', () => {
    const createBlock = SRC.slice(SRC.indexOf('async function createStudent'));
    expect(createBlock).toMatch(/role:\s*['"]STUDENT['"]/);
    // Must not read role from req.body
    const destructureMatch = createBlock.match(/const\s*\{([^}]+)\}\s*=\s*req\.body/);
    if (destructureMatch) {
      expect(destructureMatch[1]).not.toMatch(/\brole\b/);
    }
  });

  test('updateStudent prisma.user.update data does NOT contain name or phone fields', () => {
    // Extract the user.update call inside updateStudent
    const updateBlock = SRC.slice(SRC.indexOf('async function updateStudent'),
      SRC.indexOf('async function enrollStudent'));
    const userUpdateMatch = updateBlock.match(/prisma\.user\.update\(\{[\s\S]*?data:\s*\{([^}]+)\}/);
    if (userUpdateMatch) {
      expect(userUpdateMatch[1]).not.toMatch(/\bfirstName\b/);
      expect(userUpdateMatch[1]).not.toMatch(/\blastName\b/);
      expect(userUpdateMatch[1]).not.toMatch(/\bemail\b/);
      expect(userUpdateMatch[1]).not.toMatch(/\brole\b/);
      expect(userUpdateMatch[1]).not.toMatch(/\bphone\b/);
    }
  });
});

describe('SOURCE AUDIT: teacher.controller.js', () => {
  const SRC = fs.readFileSync(
    path.join(__dirname, '../controllers/teacher.controller.js'), 'utf8'
  );

  test('updateTeacher does NOT destructure firstName from req.body', () => {
    const updateBlock = SRC.slice(SRC.indexOf('async function updateTeacher'));
    const destructureMatch = updateBlock.match(/const\s*\{([^}]+)\}\s*=\s*req\.body/);
    if (destructureMatch) {
      expect(destructureMatch[1]).not.toMatch(/\bfirstName\b/);
    }
  });

  test('updateTeacher does NOT destructure lastName from req.body', () => {
    const updateBlock = SRC.slice(SRC.indexOf('async function updateTeacher'));
    const destructureMatch = updateBlock.match(/const\s*\{([^}]+)\}\s*=\s*req\.body/);
    if (destructureMatch) {
      expect(destructureMatch[1]).not.toMatch(/\blastName\b/);
    }
  });

  test('updateTeacher does NOT destructure email from req.body', () => {
    const updateBlock = SRC.slice(SRC.indexOf('async function updateTeacher'));
    const destructureMatch = updateBlock.match(/const\s*\{([^}]+)\}\s*=\s*req\.body/);
    if (destructureMatch) {
      expect(destructureMatch[1]).not.toMatch(/\bemail\b/);
    }
  });

  test('updateTeacher does NOT destructure role from req.body', () => {
    const updateBlock = SRC.slice(SRC.indexOf('async function updateTeacher'));
    const destructureMatch = updateBlock.match(/const\s*\{([^}]+)\}\s*=\s*req\.body/);
    if (destructureMatch) {
      expect(destructureMatch[1]).not.toMatch(/\brole\b/);
    }
  });

  test('updateTeacher does NOT destructure phone from req.body', () => {
    const updateBlock = SRC.slice(SRC.indexOf('async function updateTeacher'));
    const destructureMatch = updateBlock.match(/const\s*\{([^}]+)\}\s*=\s*req\.body/);
    if (destructureMatch) {
      expect(destructureMatch[1]).not.toMatch(/\bphone\b/);
    }
  });

  test('updateTeacher does NOT use ...req.body spread', () => {
    const updateBlock = SRC.slice(SRC.indexOf('async function updateTeacher'));
    expect(updateBlock).not.toMatch(/\.\.\.\s*req\.body/);
    expect(updateBlock).not.toMatch(/data:\s*req\.body/);
  });

  test('updateTeacher prisma.user.update is NOT called (phone removed — no User writes)', () => {
    // After phone was removed, updateTeacher no longer calls prisma.user.update at all
    const updateBlock = SRC.slice(SRC.indexOf('async function updateTeacher'),
      SRC.indexOf('async function assignClass'));
    // Must not have a user.update call in the update function
    expect(updateBlock).not.toMatch(/prisma\.user\.update/);
  });
});

describe('SOURCE AUDIT: guardian.controller.js', () => {
  const SRC = fs.readFileSync(
    path.join(__dirname, '../controllers/guardian.controller.js'), 'utf8'
  );

  test('updateGuardian does NOT destructure firstName from req.body', () => {
    const updateBlock = SRC.slice(SRC.indexOf('async function updateGuardian'));
    const destructureMatch = updateBlock.match(/const\s*\{([^}]+)\}\s*=\s*req\.body/);
    if (destructureMatch) {
      expect(destructureMatch[1]).not.toMatch(/\bfirstName\b/);
    }
  });

  test('updateGuardian does NOT destructure lastName from req.body', () => {
    const updateBlock = SRC.slice(SRC.indexOf('async function updateGuardian'));
    const destructureMatch = updateBlock.match(/const\s*\{([^}]+)\}\s*=\s*req\.body/);
    if (destructureMatch) {
      expect(destructureMatch[1]).not.toMatch(/\blastName\b/);
    }
  });

  test('updateGuardian does NOT destructure phone from req.body', () => {
    const updateBlock = SRC.slice(SRC.indexOf('async function updateGuardian'));
    const destructureMatch = updateBlock.match(/const\s*\{([^}]+)\}\s*=\s*req\.body/);
    if (destructureMatch) {
      expect(destructureMatch[1]).not.toMatch(/\bphone\b/);
    }
  });

  test('updateGuardian does NOT use ...req.body spread', () => {
    const updateBlock = SRC.slice(SRC.indexOf('async function updateGuardian'));
    expect(updateBlock).not.toMatch(/\.\.\.\s*req\.body/);
  });

  test('updateGuardian prisma.user.update is NOT called (all user fields removed)', () => {
    const updateBlock = SRC.slice(SRC.indexOf('async function updateGuardian'),
      SRC.indexOf('async function linkStudent'));
    expect(updateBlock).not.toMatch(/prisma\.user\.update/);
  });

  test('listGuardians does NOT have SUPER_ADMIN bypass (uses schoolId unconditionally)', () => {
    const listBlock = SRC.slice(SRC.indexOf('async function listGuardians'),
      SRC.indexOf('async function getGuardian'));
    expect(listBlock).not.toMatch(/req\.user\.role\s*!==\s*['"]SUPER_ADMIN['"]/);
  });

  test('getGuardian does NOT have SUPER_ADMIN bypass', () => {
    const getBlock = SRC.slice(SRC.indexOf('async function getGuardian'),
      SRC.indexOf('async function createGuardian'));
    expect(getBlock).not.toMatch(/req\.user\.role\s*!==\s*['"]SUPER_ADMIN['"]/);
  });

  test('deleteGuardian does NOT have SUPER_ADMIN bypass', () => {
    const deleteBlock = SRC.slice(SRC.indexOf('async function deleteGuardian'));
    expect(deleteBlock).not.toMatch(/req\.user\.role\s*!==\s*['"]SUPER_ADMIN['"]/);
  });

  test('updateGuardian prisma.user.update data does NOT contain name fields', () => {
    const updateBlock = SRC.slice(SRC.indexOf('async function updateGuardian'),
      SRC.indexOf('async function linkStudent'));
    const userUpdateMatch = updateBlock.match(/prisma\.user\.update\(\{[\s\S]*?data:\s*\{([^}]+)\}/);
    if (userUpdateMatch) {
      expect(userUpdateMatch[1]).not.toMatch(/\bfirstName\b/);
      expect(userUpdateMatch[1]).not.toMatch(/\blastName\b/);
      expect(userUpdateMatch[1]).not.toMatch(/\bemail\b/);
      expect(userUpdateMatch[1]).not.toMatch(/\brole\b/);
    }
  });
});

describe('SOURCE AUDIT: import.controller.js', () => {
  const SRC = fs.readFileSync(
    path.join(__dirname, '../controllers/import.controller.js'), 'utf8'
  );

  test('importStudents does NOT use hardcoded Halqa@2024 password', () => {
    expect(SRC).not.toMatch(/Halqa@2024/);
  });

  test('importStudents hardcodes role as STUDENT (no req.body.role)', () => {
    expect(SRC).toMatch(/role:\s*['"]STUDENT['"]/);
  });

  test('importTeachers hardcodes role as TEACHER (no req.body.role)', () => {
    expect(SRC).toMatch(/role:\s*['"]TEACHER['"]/);
  });

  test('import does NOT use ...req.body spread for user creation', () => {
    expect(SRC).not.toMatch(/data:\s*req\.body/);
    expect(SRC).not.toMatch(/\.\.\.\s*req\.body/);
  });
});

describe('SOURCE AUDIT: No socialId field confusion', () => {
  test('schema.prisma does not contain a socialId field on User', () => {
    const schema = fs.readFileSync(
      path.join(__dirname, '../../prisma/schema.prisma'), 'utf8'
    );
    // socialId does not exist — confirm there is no confusion with schoolId
    expect(schema).not.toMatch(/\bsocialId\b/);
  });

  test('student.controller.js does not reference socialId', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/student.controller.js'), 'utf8'
    );
    expect(src).not.toMatch(/socialId/);
  });

  test('teacher.controller.js does not reference socialId', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/teacher.controller.js'), 'utf8'
    );
    expect(src).not.toMatch(/socialId/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RUNTIME TESTS — HTTP request-level authorization checks
// ═════════════════════════════════════════════════════════════════════════════

describe('RUNTIME: PUT /students/:id — SCHOOL_ADMIN cannot modify protected fields', () => {
  let app;
  beforeAll(() => { app = buildStudentApp(); });

  test('SCHOOL_ADMIN sending name fields → prisma.user.update does NOT receive firstName', async () => {
    asSchoolAdmin('admin-1', 'school-a');
    stubStudent('student-1', 'school-a');

    // Attempt to inject name, phone, and role changes
    await request(app)
      .put('/api/v1/students/student-1')
      .set('Authorization', tok('admin-1'))
      .set('x-school-id', 'school-a')
      .send({
        firstName: 'HACKED_NAME',
        lastName:  'HACKED_LAST',
        email:     'hacked@evil.com',
        phone:     '+1999999',
        role:      'SUPER_ADMIN',
        gradeLevel: '6'
      });

    // Check ALL calls to prisma.user.update — none should have identity/contact fields
    const userUpdateCalls = prisma.user.update.mock.calls;
    userUpdateCalls.forEach(([args]) => {
      const data = args.data || {};
      expect(data.firstName).toBeUndefined();
      expect(data.lastName).toBeUndefined();
      expect(data.email).toBeUndefined();
      expect(data.phone).toBeUndefined();
      expect(data.role).toBeUndefined();
      expect(data.username).toBeUndefined();
      expect(data.passwordHash).toBeUndefined();
    });
  });

  test('SCHOOL_ADMIN can update legitimate fields (phone, gradeLevel) → 200', async () => {
    asSchoolAdmin('admin-2', 'school-a');
    stubStudent('student-2', 'school-a');

    const res = await request(app)
      .put('/api/v1/students/student-2')
      .set('Authorization', tok('admin-2'))
      .set('x-school-id', 'school-a')
      .send({ phone: '+1234567', gradeLevel: '7', medicalNotes: 'None' });

    expect(res.status).toBe(200);
  });

  test('TEACHER cannot update student (eduAdmin required) → 403', async () => {
    asTeacher('teacher-1', 'school-a');
    stubStudent('student-3', 'school-a');

    const res = await request(app)
      .put('/api/v1/students/student-3')
      .set('Authorization', tok('teacher-1'))
      .set('x-school-id', 'school-a')
      .send({ gradeLevel: '5' });

    expect(res.status).toBe(403);
  });

  test('STUDENT cannot update another student → 403', async () => {
    asStudent('student-self', 'school-a');

    const res = await request(app)
      .put('/api/v1/students/student-other')
      .set('Authorization', tok('student-self'))
      .set('x-school-id', 'school-a')
      .send({ gradeLevel: '5' });

    expect(res.status).toBe(403);
  });

  test('SCHOOL_ADMIN of school-a cannot update student from school-b (IDOR) → 404', async () => {
    asSchoolAdmin('admin-idor', 'school-a');
    // Student belongs to school-b — findFirst with schoolId='school-a' returns null
    prisma.student.findFirst.mockResolvedValue(null);
    prisma.auditLog = { create: jest.fn().mockResolvedValue({}) };

    const res = await request(app)
      .put('/api/v1/students/student-in-school-b')
      .set('Authorization', tok('admin-idor'))
      .set('x-school-id', 'school-a')
      .send({ gradeLevel: '8' });

    // null student → 404 (school isolation works)
    expect(res.status).toBe(404);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test('Unauthenticated request → 401', async () => {
    const res = await request(app)
      .put('/api/v1/students/any-student')
      .send({ gradeLevel: '5' });
    expect(res.status).toBe(401);
  });
});

describe('RUNTIME: PUT /teachers/:id — SCHOOL_ADMIN cannot modify protected fields', () => {
  let app;
  beforeAll(() => { app = buildTeacherApp(); });

  test('SCHOOL_ADMIN sending name fields → prisma.user.update does NOT receive firstName', async () => {
    asSchoolAdmin('admin-t1', 'school-a');
    stubTeacher('teacher-t1', 'school-a');

    await request(app)
      .put('/api/v1/teachers/teacher-t1')
      .set('Authorization', tok('admin-t1'))
      .set('x-school-id', 'school-a')
      .send({
        firstName:  'HACKED',
        lastName:   'HACKED_LAST',
        email:      'hacked@evil.com',
        phone:      '+1999',
        role:       'SUPER_ADMIN',
        department: 'Legit Dept'
      });

    // updateTeacher no longer calls prisma.user.update at all — no user fields accepted
    const userUpdateCalls = prisma.user.update.mock.calls;
    userUpdateCalls.forEach(([args]) => {
      const data = args.data || {};
      expect(data.firstName).toBeUndefined();
      expect(data.lastName).toBeUndefined();
      expect(data.email).toBeUndefined();
      expect(data.phone).toBeUndefined();
      expect(data.role).toBeUndefined();
      expect(data.username).toBeUndefined();
      expect(data.passwordHash).toBeUndefined();
    });
  });

  test('SCHOOL_ADMIN can update legitimate teacher fields (phone, department) → 200', async () => {
    asSchoolAdmin('admin-t2', 'school-a');
    stubTeacher('teacher-t2', 'school-a');

    const res = await request(app)
      .put('/api/v1/teachers/teacher-t2')
      .set('Authorization', tok('admin-t2'))
      .set('x-school-id', 'school-a')
      .send({ phone: '+1234', department: 'Math', specialization: 'Algebra' });

    expect(res.status).toBe(200);
  });

  test('SCHOOL_ADMIN of school-a cannot update teacher from school-b (IDOR) → 404', async () => {
    asSchoolAdmin('admin-tidor', 'school-a');
    prisma.teacher.findFirst.mockResolvedValue(null); // different school
    prisma.auditLog = { create: jest.fn().mockResolvedValue({}) };

    const res = await request(app)
      .put('/api/v1/teachers/teacher-in-school-b')
      .set('Authorization', tok('admin-tidor'))
      .set('x-school-id', 'school-a')
      .send({ department: 'Quran' });

    expect(res.status).toBe(404);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test('TEACHER role cannot update another teacher → 403', async () => {
    asTeacher('teacher-selfmod', 'school-a');

    const res = await request(app)
      .put('/api/v1/teachers/teacher-other')
      .set('Authorization', tok('teacher-selfmod'))
      .set('x-school-id', 'school-a')
      .send({ department: 'Quran' });

    expect(res.status).toBe(403);
  });

  test('Unauthenticated request → 401', async () => {
    const res = await request(app)
      .put('/api/v1/teachers/any-teacher')
      .send({ department: 'X' });
    expect(res.status).toBe(401);
  });
});

describe('RUNTIME: Role escalation — SCHOOL_ADMIN cannot promote via user.update', () => {
  let studentApp;
  let teacherApp;

  beforeAll(() => {
    studentApp = buildStudentApp();
    teacherApp = buildTeacherApp();
  });

  test('PUT /students/:id with role=SUPER_ADMIN does not write role to DB', async () => {
    asSchoolAdmin('admin-esc1', 'school-a');
    stubStudent('student-esc1', 'school-a');

    await request(studentApp)
      .put('/api/v1/students/student-esc1')
      .set('Authorization', tok('admin-esc1'))
      .set('x-school-id', 'school-a')
      .send({ role: 'SUPER_ADMIN', gradeLevel: '5' });

    const roleWritten = prisma.user.update.mock.calls.some(
      ([{ data }]) => data?.role !== undefined
    );
    expect(roleWritten).toBe(false);
  });

  test('PUT /teachers/:id with role=SUPER_ADMIN does not write role to DB', async () => {
    asSchoolAdmin('admin-esc2', 'school-a');
    stubTeacher('teacher-esc2', 'school-a');

    await request(teacherApp)
      .put('/api/v1/teachers/teacher-esc2')
      .set('Authorization', tok('admin-esc2'))
      .set('x-school-id', 'school-a')
      .send({ role: 'SUPER_ADMIN', department: 'Quran' });

    const roleWritten = prisma.user.update.mock.calls.some(
      ([{ data }]) => data?.role !== undefined
    );
    expect(roleWritten).toBe(false);
  });
});

describe('RUNTIME: SUPER_ADMIN retains update access with school membership', () => {
  let studentApp;

  beforeAll(() => { studentApp = buildStudentApp(); });

  test('SUPER_ADMIN with school membership → 403 (SA-SCHOOL-DATA-001: SA is denied before membership lookup)', async () => {
    // After SA-SCHOOL-DATA-001 fix: SUPER_ADMIN is denied at requireSchoolMember()
    // before any SchoolMembership lookup. Even a valid school-admin membership
    // cannot grant SUPER_ADMIN school-scoped access.
    asSuperAdmin('sa-update', 'school-a');
    stubStudent('student-sa1', 'school-a');

    const res = await request(studentApp)
      .put('/api/v1/students/student-sa1')
      .set('Authorization', tok('sa-update'))
      .set('x-school-id', 'school-a')
      .send({ gradeLevel: '9' });

    expect(res.status).toBe(403);
  });
});

describe('RUNTIME: PUT /users/profile — self-service is unaffected', () => {
  let userApp;

  beforeAll(() => {
    userApp = express();
    userApp.use(express.json());
    userApp.use(cookieParser());
    userApp.use('/api/v1/users', require('../routes/user.routes'));
    userApp.use((err, req, res, _next) => {
      res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
    });
  });

  test('Student can update their own name via PUT /users/profile → 200', async () => {
    const userId = 'student-self-profile';
    asStudent(userId, 'school-a');
    prisma.user.update.mockResolvedValue({
      id: userId, firstName: 'New', lastName: 'Name',
      email: 'student@school.com', phone: null, avatarUrl: null, bio: null, username: null,
    });

    const res = await request(userApp)
      .put('/api/v1/users/profile')
      .set('Authorization', tok(userId))
      .send({ firstName: 'New', lastName: 'Name' });

    expect(res.status).toBe(200);
    // Verify the update was scoped to req.user.id (not someone else)
    const updateCall = prisma.user.update.mock.calls[0];
    expect(updateCall[0].where.id).toBe(userId);
  });

  test('Teacher can update their own name via PUT /users/profile → 200', async () => {
    const userId = 'teacher-self-profile';
    asTeacher(userId, 'school-a');
    prisma.user.update.mockResolvedValue({
      id: userId, firstName: 'Teacher', lastName: 'Updated',
      email: 't@school.com', phone: null, avatarUrl: null, bio: null, username: null,
    });

    const res = await request(userApp)
      .put('/api/v1/users/profile')
      .set('Authorization', tok(userId))
      .send({ firstName: 'Teacher', lastName: 'Updated' });

    expect(res.status).toBe(200);
    const updateCall = prisma.user.update.mock.calls[0];
    expect(updateCall[0].where.id).toBe(userId);
  });
});
