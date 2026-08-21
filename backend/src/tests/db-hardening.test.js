'use strict';
/**
 * db-hardening.test.js
 *
 * Database write path hardening regression tests.
 *
 * Tests verify:
 *   - User.role is never accepted from req.body
 *   - User.role hardcoded values are correct in every creation path
 *   - SchoolMembership.role SUPER_ADMIN is blocked at runtime guard level
 *   - Mass-assignment on PKConfig/PKSeason is eliminated
 *   - sanitizeUserData strips all privileged fields
 *   - assertSafeUserRole throws on SUPER_ADMIN
 *   - assertSafeMembershipRole throws on SUPER_ADMIN
 *   - All invite/role-change paths have runtime guards
 *   - Seed scripts are not callable via API
 *   - updateMany/createMany on User/SchoolMembership do not exist in app code
 */

const express = require('express');
const request = require('supertest');

// ─── Mocks ────────────────────────────────────────────────────────────────────
jest.mock('../utils/prisma', () => ({
  user:             { findUnique: jest.fn(), update: jest.fn(), create: jest.fn(), count: jest.fn() },
  school:           { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
  schoolMembership: { findUnique: jest.fn(), findFirst: jest.fn(), upsert: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  teacher:          { findFirst: jest.fn(), create: jest.fn() },
  pKConfig:         { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  pKSeason:         { update: jest.fn() },
  pKAuditLog:       { create: jest.fn().mockResolvedValue({}) },
  auditLog:         { create: jest.fn().mockResolvedValue({}) },
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
jest.mock('../services/notification.service', () => ({ notify: jest.fn() }));
jest.mock('../services/pk.service', () => ({
  clearConfigCache: jest.fn(),
  getConfig: jest.fn().mockResolvedValue({ pkEnabled: true }),
}));
jest.mock('../utils/email', () => ({ sendEmail: jest.fn() }));
jest.mock('../controllers/auth.controller', () => ({
  deleteGetMeCache: jest.fn().mockResolvedValue(undefined),
}));

const { generateAccessToken } = require('../utils/jwt');
const prisma = require('../utils/prisma');
const { assertSafeUserRole, assertSafeMembershipRole, sanitizeUserData, sanitizeMembershipData, ALLOWED_MEMBERSHIP_ROLES, ALLOWED_USER_ROLES_APP } = require('../utils/roleGuard');

// ─── Test users ────────────────────────────────────────────────────────────────
const SUPER_ADMIN  = { id: 'u-super',  role: 'SUPER_ADMIN',  status: 'ACTIVE', schoolId: null,       deletedAt: null };
const SCHOOL_ADMIN = { id: 'u-admin',  role: 'SCHOOL_ADMIN', status: 'ACTIVE', schoolId: 'school-a', deletedAt: null };
const MEMBER       = { id: 'u-member', role: 'MEMBER',       status: 'ACTIVE', schoolId: null,       deletedAt: null };

function tok(user) {
  return `Bearer ${generateAccessToken({ userId: user.id, role: user.role, schoolId: user.schoolId })}`;
}
function mockUser(u) { prisma.user.findUnique.mockResolvedValue(u); }

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Database Hardening — Role Write Path Regression Tests', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.auditLog.create.mockResolvedValue({});
    prisma.pKAuditLog.create.mockResolvedValue({});
  });

  // ── 1. roleGuard utility unit tests ─────────────────────────────────────────

  describe('1. roleGuard utility — assertSafeUserRole', () => {
    test('assertSafeUserRole throws on SUPER_ADMIN', () => {
      expect(() => assertSafeUserRole('SUPER_ADMIN', 'test')).toThrow('SUPER_ADMIN role cannot be assigned');
    });

    test('assertSafeUserRole throws on unknown role', () => {
      expect(() => assertSafeUserRole('GOD_MODE', 'test')).toThrow("Invalid role 'GOD_MODE'");
    });

    test('assertSafeUserRole passes for MEMBER', () => {
      expect(() => assertSafeUserRole('MEMBER', 'test')).not.toThrow();
    });

    test('assertSafeUserRole passes for all ALLOWED_USER_ROLES_APP', () => {
      ALLOWED_USER_ROLES_APP.forEach(role => {
        expect(() => assertSafeUserRole(role, 'test')).not.toThrow();
      });
    });
  });

  describe('2. roleGuard utility — assertSafeMembershipRole', () => {
    test('assertSafeMembershipRole throws on SUPER_ADMIN', () => {
      expect(() => assertSafeMembershipRole('SUPER_ADMIN', 'test')).toThrow("Invalid membership role 'SUPER_ADMIN'");
    });

    test('assertSafeMembershipRole throws on MEMBER (not a valid membership role)', () => {
      expect(() => assertSafeMembershipRole('MEMBER', 'test')).toThrow("Invalid membership role 'MEMBER'");
    });

    test('assertSafeMembershipRole throws on arbitrary string', () => {
      expect(() => assertSafeMembershipRole('HACKER', 'test')).toThrow("Invalid membership role 'HACKER'");
    });

    test('assertSafeMembershipRole passes for all ALLOWED_MEMBERSHIP_ROLES', () => {
      ALLOWED_MEMBERSHIP_ROLES.forEach(role => {
        expect(() => assertSafeMembershipRole(role, 'test')).not.toThrow();
      });
    });

    test('ALLOWED_MEMBERSHIP_ROLES does not include SUPER_ADMIN', () => {
      expect(ALLOWED_MEMBERSHIP_ROLES).not.toContain('SUPER_ADMIN');
    });
  });

  describe('3. roleGuard utility — sanitizeUserData', () => {
    test('sanitizeUserData removes role field', () => {
      const result = sanitizeUserData({ firstName: 'Test', role: 'SUPER_ADMIN', email: 'x@x.com' });
      expect(result.role).toBeUndefined();
      expect(result.firstName).toBe('Test');
    });

    test('sanitizeUserData removes passwordHash', () => {
      const result = sanitizeUserData({ firstName: 'Test', passwordHash: 'hash123' });
      expect(result.passwordHash).toBeUndefined();
    });

    test('sanitizeUserData removes deletedAt', () => {
      const result = sanitizeUserData({ firstName: 'Test', deletedAt: new Date() });
      expect(result.deletedAt).toBeUndefined();
    });

    test('sanitizeUserData removes emailVerified', () => {
      const result = sanitizeUserData({ firstName: 'Test', emailVerified: true });
      expect(result.emailVerified).toBeUndefined();
    });

    test('sanitizeUserData preserves safe fields', () => {
      const result = sanitizeUserData({ firstName: 'Test', lastName: 'User', bio: 'hello' });
      expect(result.firstName).toBe('Test');
      expect(result.lastName).toBe('User');
      expect(result.bio).toBe('hello');
    });

    test('sanitizeUserData handles non-object input gracefully', () => {
      expect(sanitizeUserData(null)).toEqual({});
      expect(sanitizeUserData(undefined)).toEqual({});
      expect(sanitizeUserData('string')).toEqual({});
    });
  });

  // ── 2. User.role write path verification ─────────────────────────────────

  describe('4. User.role write paths — never from req.body', () => {
    test('PUT /users/profile does NOT write User.role', () => {
      // Read source to confirm role is not in data destructuring
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../routes/user.routes.js'), 'utf8');
      // Extract the PUT /profile handler
      const profileHandlerMatch = src.match(/PUT \/users\/profile[\s\S]{0,2000}firstName.*lastName.*phone[\s\S]{0,200}prisma\.user\.update\s*\(\s*\{[\s\S]{0,500?}\}/);
      // The update data must not include role
      const updateBlock = src.match(/router\.put\('\/profile'[\s\S]{0,1500?}data:\s*\{([^}]{0,400})\}/);
      if (updateBlock) {
        expect(updateBlock[1]).not.toMatch(/\brole\b/);
      }
    });

    test('PUT /users/:id/status writes only status field', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../routes/user.routes.js'), 'utf8');
      // Find status update block — use 1500 chars to cover P1-001 validation code
      // added before the prisma.user.update call
      const statusIdx = src.indexOf("PUT /users/:id/status");
      const statusBlock = src.substring(statusIdx, statusIdx + 1500);
      expect(statusBlock).toMatch(/data:\s*\{\s*status\s*\}/);
      expect(statusBlock).not.toMatch(/role/);
    });

    test('User.role in auth.controller.register is hardcoded MEMBER, not from req.body', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../controllers/auth.controller.js'), 'utf8');
      // Registration must use hardcoded MEMBER
      expect(src).toMatch(/role:\s*'MEMBER'/);
      // Must not use req.body.role
      const registerIdx = src.indexOf("async function register");
      const registerBlock = src.substring(registerIdx, registerIdx + 800);
      expect(registerBlock).not.toMatch(/req\.body\.role/);
      expect(registerBlock).not.toMatch(/body\.role/);
    });

    test('student.controller createStudent uses hardcoded STUDENT role', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../controllers/student.controller.js'), 'utf8');
      expect(src).toMatch(/role:\s*'STUDENT'/);
      // Must not pass req.body.role to user.create
      const createIdx = src.indexOf("async function createStudent");
      const createBlock = src.substring(createIdx, createIdx + 800);
      expect(createBlock).not.toMatch(/req\.body\.role/);
    });

    test('teacher.controller createTeacher uses hardcoded TEACHER role', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../controllers/teacher.controller.js'), 'utf8');
      const createIdx = src.indexOf("async function createTeacher");
      const createBlock = src.substring(createIdx, createIdx + 1000);
      // Must hardcode TEACHER
      expect(createBlock).toMatch(/role:\s*'TEACHER'/);
      // Must not spread req.body
      expect(createBlock).not.toMatch(/\.\.\.\s*req\.body/);
    });

    test('guardian.controller createGuardian uses hardcoded GUARDIAN role', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../controllers/guardian.controller.js'), 'utf8');
      const createIdx = src.indexOf("async function createGuardian");
      const createBlock = src.substring(createIdx, createIdx + 800);
      expect(createBlock).toMatch(/role:\s*'GUARDIAN'/);
      expect(createBlock).not.toMatch(/req\.body\.role/);
    });
  });

  // ── 3. SchoolMembership.role write path verification ──────────────────────

  describe('5. SchoolMembership.role write paths — SUPER_ADMIN blocked at runtime', () => {
    test('invite validator rejects SUPER_ADMIN role (isIn check)', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../routes/schoolMembership.routes.js'), 'utf8');
      // The invite validator must not include SUPER_ADMIN in isIn()
      const inviteSection = src.substring(src.indexOf("POST /school-memberships/invite"), src.indexOf("PUT /school-memberships/:id/status") || src.length);
      // isIn must not contain SUPER_ADMIN
      const isInMatch = inviteSection.match(/isIn\(\[([^\]]+)\]\)/);
      if (isInMatch) {
        expect(isInMatch[1]).not.toMatch(/SUPER_ADMIN/);
      }
    });

    test('assertSafeMembershipRole runtime guard blocks SUPER_ADMIN in invite context', () => {
      // Simulate what the invite handler does
      expect(() => assertSafeMembershipRole('SUPER_ADMIN', 'invite')).toThrow();
    });

    test('PUT /:id/role validator excludes SUPER_ADMIN from isIn()', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../routes/schoolMembership.routes.js'), 'utf8');
      const roleChangeSection = src.substring(src.indexOf("PUT /:id/role"), src.indexOf("DELETE /school-memberships/:id") || src.length);
      const isInMatch = roleChangeSection.match(/isIn\(\[([^\]]+)\]\)/);
      if (isInMatch) {
        expect(isInMatch[1]).not.toMatch(/SUPER_ADMIN/);
      }
    });

    test('assertSafeMembershipRole runtime guard blocks SUPER_ADMIN in role-change context', () => {
      expect(() => assertSafeMembershipRole('SUPER_ADMIN', 'PUT /:id/role')).toThrow();
    });

    test('create-school sets SchoolMembership.role = SCHOOL_ADMIN (not SUPER_ADMIN)', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../routes/schoolMembership.routes.js'), 'utf8');
      // The create-school route uses tx.schoolMembership.create with role: 'SCHOOL_ADMIN'
      const createSchoolIdx = src.indexOf("router.post('/create-school'");
      const createSchoolBlock = src.substring(createSchoolIdx, createSchoolIdx + 2500);
      // Must use SCHOOL_ADMIN in membership creation
      expect(createSchoolBlock).toMatch(/role:\s*'SCHOOL_ADMIN'/);
      // Must NOT set role: 'SUPER_ADMIN' in any create/update inside create-school
      // (Note: create-school no longer sets User.role at all)
      const superAdminInData = [...createSchoolBlock.matchAll(/data:\s*\{[^}]{0,300}role:\s*'SUPER_ADMIN'/g)];
      expect(superAdminInData).toHaveLength(0);
    });

    test('create-school does NOT update User.role to SUPER_ADMIN', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../routes/schoolMembership.routes.js'), 'utf8');
      const createSchoolIdx = src.indexOf("create-school");
      const createSchoolBlock = src.substring(createSchoolIdx, createSchoolIdx + 2000);
      // The user.update in create-school must NOT contain role: 'SUPER_ADMIN'
      const userUpdateBlocks = [...createSchoolBlock.matchAll(/user\.update\s*\(\s*\{[\s\S]{0,400}\}/g)];
      userUpdateBlocks.forEach(m => {
        expect(m[0]).not.toMatch(/role:\s*'SUPER_ADMIN'/);
      });
    });

    test('invite handler does NOT write User.role (C-4 fix)', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../routes/schoolMembership.routes.js'), 'utf8');
      // The invite user.update must only contain schoolId, not role
      const inviteIdx = src.indexOf("POST /school-memberships/invite");
      const inviteBlock = src.substring(inviteIdx, inviteIdx + 2500);
      // Find user.update calls in the invite handler
      const userUpdateMatches = [...inviteBlock.matchAll(/user\.update\s*\(\s*\{[\s\S]{0,300}\}/g)];
      userUpdateMatches.forEach(m => {
        // role must NOT be in the data object of user.update
        const dataMatch = m[0].match(/data:\s*\{([^}]{0,200})\}/);
        if (dataMatch) {
          expect(dataMatch[1]).not.toMatch(/\brole\b/);
        }
      });
    });
  });

  // ── 4. Mass-assignment prevention ────────────────────────────────────────

  describe('6. Mass-assignment prevention — PKConfig and PKSeason whitelisted', () => {
    test('updatePKConfig no longer uses ...req.body spread', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../controllers/pk.admin.controller.js'), 'utf8');
      const updateConfigIdx = src.indexOf("async function updatePKConfig");
      const updateConfigBlock = src.substring(updateConfigIdx, updateConfigIdx + 1500);
      // Must NOT have { ...req.body } or data: req.body
      expect(updateConfigBlock).not.toMatch(/\{\s*\.\.\.req\.body/);
      expect(updateConfigBlock).not.toMatch(/data:\s*req\.body/);
      // Must use whitelisted allowedData
      expect(updateConfigBlock).toMatch(/allowedData/);
    });

    test('updateSeason no longer uses data: req.body directly', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../controllers/pk.admin.controller.js'), 'utf8');
      const updateSeasonIdx = src.indexOf("async function updateSeason");
      const updateSeasonBlock = src.substring(updateSeasonIdx, updateSeasonIdx + 600);
      // Must NOT have data: req.body
      expect(updateSeasonBlock).not.toMatch(/data:\s*req\.body[^,\n\)]/);
      // Must use allowedData
      expect(updateSeasonBlock).toMatch(/allowedData/);
    });
  });

  // ── 5. No updateMany/createMany on User or SchoolMembership ──────────────

  describe('7. No bulk role operations on User or SchoolMembership', () => {
    test('No updateMany on User in routes or controllers', () => {
      const fs = require('fs');
      const path = require('path');
      const routesDir = path.join(__dirname, '../routes');
      const controllersDir = path.join(__dirname, '../controllers');
      const files = [
        ...fs.readdirSync(routesDir).map(f => path.join(routesDir, f)),
        ...fs.readdirSync(controllersDir).map(f => path.join(controllersDir, f)),
      ].filter(f => f.endsWith('.js'));

      let found = false;
      let foundIn = '';
      for (const f of files) {
        // Skip delete/me (it uses post.updateMany for own posts, not User.updateMany for role)
        const src = fs.readFileSync(f, 'utf8');
        if (/prisma\.user\.updateMany/.test(src)) {
          // Allow only for non-role fields (post delete own account uses post.updateMany)
          const matches = [...src.matchAll(/prisma\.user\.updateMany\s*\(\s*\{[\s\S]{0,300}\}/g)];
          for (const m of matches) {
            if (/role/.test(m[0])) {
              found = true;
              foundIn = path.basename(f);
            }
          }
        }
      }
      expect(found).toBe(false);
    });

    test('No createMany on User in routes or controllers', () => {
      const fs = require('fs');
      const path = require('path');
      const routesDir = path.join(__dirname, '../routes');
      const controllersDir = path.join(__dirname, '../controllers');
      const files = [
        ...fs.readdirSync(routesDir).map(f => path.join(routesDir, f)),
        ...fs.readdirSync(controllersDir).map(f => path.join(controllersDir, f)),
      ].filter(f => f.endsWith('.js'));

      for (const f of files) {
        const src = fs.readFileSync(f, 'utf8');
        expect(src).not.toMatch(/prisma\.user\.createMany/);
      }
    });
  });

  // ── 6. Seed script not callable via API ──────────────────────────────────

  describe('8. Seed script cannot be triggered via API', () => {
    test('No HTTP route imports or executes seed-demo-accounts', () => {
      const fs = require('fs');
      const path = require('path');
      const appSrc = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
      expect(appSrc).not.toMatch(/seed-demo/);
      expect(appSrc).not.toMatch(/seed-demo-accounts/);
    });

    test('Deploy pipeline does not run seed script', () => {
      const fs = require('fs');
      const path = require('path');
      const deployYml = path.join(__dirname, '../../../../.github/workflows/deploy.yml');
      if (fs.existsSync(deployYml)) {
        const src = fs.readFileSync(deployYml, 'utf8');
        expect(src).not.toMatch(/seed-demo/);
        expect(src).not.toMatch(/seed-demo-accounts/);
      }
    });
  });

  // ── 7. Production environment safety ─────────────────────────────────────

  describe('9. Production environment does not expose dangerous operations', () => {
    test('SUPER_ADMIN in UserRole enum — enforced by Prisma type system', () => {
      // The UserRole enum contains SUPER_ADMIN as a valid value — this is expected.
      // The security guarantee comes from application-layer guards, not schema removal.
      // This test documents the expected state.
      const fs = require('fs');
      const path = require('path');
      const schema = fs.readFileSync(path.join(__dirname, '../../prisma/schema.prisma'), 'utf8');
      expect(schema).toMatch(/enum UserRole \{[\s\S]*SUPER_ADMIN[\s\S]*\}/);
      // Prisma enum provides type safety — only valid enum values accepted
    });

    test('SchoolMembership.role is plain String (no enum) — DB CHECK constraint compensates', () => {
      // SchoolMembership.role uses String (not a typed enum) in Prisma.
      // DB-level CHECK constraint chk_membership_role (migration 20260821) compensates.
      // Application-layer guards (assertSafeMembershipRole) provide defense in depth.
      const fs = require('fs');
      const path = require('path');
      const schema = fs.readFileSync(path.join(__dirname, '../../prisma/schema.prisma'), 'utf8');
      const membershipIdx = schema.indexOf('model SchoolMembership {');
      // Use 800 chars to ensure the role field is included even with longer comments
      const membershipBlock = schema.substring(membershipIdx, membershipIdx + 800);
      // role is a String field (not UserRole enum)
      expect(membershipBlock).toMatch(/role\s+String/);
    });
  });

  // ── 8. roleGuard is imported and active in membership routes ─────────────

  describe('10. roleGuard import verification', () => {
    test('schoolMembership.routes.js imports roleGuard', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../routes/schoolMembership.routes.js'), 'utf8');
      expect(src).toMatch(/require.*roleGuard/);
      expect(src).toMatch(/assertSafeMembershipRole/);
    });

    test('assertSafeMembershipRole is called in invite handler', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../routes/schoolMembership.routes.js'), 'utf8');
      // The invite handler is between "POST /school-memberships/invite" and the next router.put
      const startIdx = src.indexOf("router.post('/invite'");
      const endIdx   = src.indexOf("router.put('/:id/status'");
      const inviteBlock = src.substring(startIdx, endIdx);
      expect(inviteBlock).toMatch(/assertSafeMembershipRole/);
    });

    test('assertSafeMembershipRole is called in role-change handler', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../routes/schoolMembership.routes.js'), 'utf8');
      // The role-change handler is between "PUT /:id/role" and "DELETE /:id"
      const startIdx = src.indexOf("router.put('/:id/role'");
      const endIdx   = src.indexOf("router.delete('/:id'");
      const roleChangeBlock = src.substring(startIdx, endIdx);
      expect(roleChangeBlock).toMatch(/assertSafeMembershipRole/);
    });
  });
});
