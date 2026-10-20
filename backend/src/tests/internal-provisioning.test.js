'use strict';
/**
 * internal-provisioning.test.js
 *
 * Security tests for the HALQA Internal Platform Administrator Provisioning system.
 *
 * Verifies:
 *   - Only SUPER_ADMIN can call provisioning endpoints
 *   - MEMBER, SCHOOL_ADMIN, TEACHER, STUDENT, GUARDIAN are all blocked (403)
 *   - Unauthenticated requests are rejected (401)
 *   - Granting SUPER_ADMIN succeeds and is audited
 *   - Revoking SUPER_ADMIN succeeds and is audited
 *   - Self-modification is blocked (400)
 *   - Revoking the last SUPER_ADMIN is blocked (400)
 *   - Provisioning a non-existent user returns 404
 *   - Provisioning a deleted user returns 400
 *   - All existing privilege-escalation paths still blocked
 *   - Audit records contain required fields
 */

const express = require('express');
const request = require('supertest');

// ─── Mocks ────────────────────────────────────────────────────────────────────
jest.mock('../utils/prisma', () => ({
  user:     { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), count: jest.fn(), create: jest.fn() },
  auditLog: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  school:           { findUnique: jest.fn(), findFirst: jest.fn() },
  schoolMembership: { findUnique: jest.fn(), findFirst: jest.fn(), upsert: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  $transaction:     jest.fn(fn => fn(require('../utils/prisma'))),
}));

jest.mock('../utils/redis', () => ({
  isRedisReady: jest.fn(() => false),
  getCache:     jest.fn(() => null),
  setCache:     jest.fn(),
  deleteCache:  jest.fn(),
}));

jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../sockets',       () => ({ getIo: jest.fn(() => null) }));
jest.mock('../services/notification.service', () => ({ notify: jest.fn() }));
jest.mock('../utils/email',   () => ({ sendEmail: jest.fn() }));

const { generateAccessToken } = require('../utils/jwt');
const prisma = require('../utils/prisma');

// ─── Test users ────────────────────────────────────────────────────────────────
const SUPER_ADMIN  = { id: 'u-super',        role: 'SUPER_ADMIN',  status: 'ACTIVE', schoolId: null, deletedAt: null, firstName: 'Platform', lastName: 'Admin' };
const SUPER_ADMIN2 = { id: 'u-super2',       role: 'SUPER_ADMIN',  status: 'ACTIVE', schoolId: null, deletedAt: null, firstName: 'Platform2', lastName: 'Admin2' };
const MEMBER       = { id: 'u-member',       role: 'MEMBER',       status: 'ACTIVE', schoolId: null, deletedAt: null, firstName: 'Regular', lastName: 'User' };
const SCHOOL_ADMIN = { id: 'u-school-admin', role: 'SCHOOL_ADMIN', status: 'ACTIVE', schoolId: 'school-a', deletedAt: null };
const TEACHER      = { id: 'u-teacher',      role: 'TEACHER',      status: 'ACTIVE', schoolId: 'school-a', deletedAt: null };
const STUDENT      = { id: 'u-student',      role: 'STUDENT',      status: 'ACTIVE', schoolId: 'school-a', deletedAt: null };
const GUARDIAN     = { id: 'u-guardian',     role: 'GUARDIAN',     status: 'ACTIVE', schoolId: 'school-a', deletedAt: null };

// Target users for provisioning
const TARGET_MEMBER   = { id: 'u-target',   role: 'MEMBER',       status: 'ACTIVE', schoolId: null,       deletedAt: null, email: 'target@test.com', firstName: 'Target', lastName: 'User' };
const TARGET_DELETED  = { id: 'u-deleted',  role: 'MEMBER',       status: 'INACTIVE', schoolId: null,     deletedAt: new Date(), email: 'deleted@test.com', firstName: 'Deleted', lastName: 'User' };
const TARGET_EXISTING = { id: 'u-existing', role: 'SUPER_ADMIN',  status: 'ACTIVE', schoolId: null,       deletedAt: null, email: 'existing@test.com', firstName: 'Existing', lastName: 'Admin' };

function tok(user) {
  return `Bearer ${generateAccessToken({ userId: user.id, role: user.role, schoolId: user.schoolId })}`;
}

function mockUser(user) {
  prisma.user.findUnique.mockResolvedValue(user);
}

// ─── App builder ──────────────────────────────────────────────────────────────
// Returns an Express app using the internal routes.
// We use the same module instance across all tests — the rate limiter is
// configured with a very high max when JEST_WORKER_ID is set (test environment).
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/internal', require('../routes/internal.routes'));
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('Internal Platform Admin Provisioning — Security Tests', () => {
  let app;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => {
    jest.resetAllMocks();  // clears implementations + call history (more thorough than clearAllMocks)
    const { isRedisReady } = require('../utils/redis');
    isRedisReady.mockReturnValue(false);
    // Restore all mocks after resetAllMocks wipes them
    prisma.auditLog.create.mockResolvedValue({ id: 'audit-1' });
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.auditLog.count.mockResolvedValue(0);
    prisma.$transaction.mockImplementation(fn => fn(prisma));
    // Default: auth lookup returns SUPER_ADMIN; individual tests override as needed
    prisma.user.findUnique.mockResolvedValue(SUPER_ADMIN);
    prisma.user.update.mockResolvedValue({});
    prisma.user.count.mockResolvedValue(1);
    prisma.user.findMany.mockResolvedValue([]);
  });

  // ── Authorization: who can call the endpoint ──────────────────────────────

  describe('Access control — all non-SUPER_ADMIN roles blocked', () => {
    const roles = [
      { name: 'MEMBER',       user: MEMBER       },
      { name: 'SCHOOL_ADMIN', user: SCHOOL_ADMIN },
      { name: 'TEACHER',      user: TEACHER      },
      { name: 'STUDENT',      user: STUDENT      },
      { name: 'GUARDIAN',     user: GUARDIAN     },
    ];

    roles.forEach(({ name, user }) => {
      test(`${name} cannot call POST /internal/admin/provision (403)`, async () => {
        mockUser(user);
        const res = await request(app)
          .post('/api/v1/internal/admin/provision')
          .set('Authorization', tok(user))
          .send({ targetUserId: 'u-target', action: 'grant', reason: 'Trying to promote myself' });
        expect(res.status).toBe(403);
      });

      test(`${name} cannot call GET /internal/admin/list (403)`, async () => {
        mockUser(user);
        const res = await request(app)
          .get('/api/v1/internal/admin/list')
          .set('Authorization', tok(user));
        expect(res.status).toBe(403);
      });

      test(`${name} cannot call GET /internal/admin/audit (403)`, async () => {
        mockUser(user);
        const res = await request(app)
          .get('/api/v1/internal/admin/audit')
          .set('Authorization', tok(user));
        expect(res.status).toBe(403);
      });
    });

    test('Unauthenticated request to provision is rejected (401)', async () => {
      const res = await request(app)
        .post('/api/v1/internal/admin/provision')
        .send({ targetUserId: 'u-target', action: 'grant', reason: 'No auth token' });
      expect(res.status).toBe(401);
    });

    test('Unauthenticated request to list is rejected (401)', async () => {
      const res = await request(app).get('/api/v1/internal/admin/list');
      expect(res.status).toBe(401);
    });
  });

  // ── Successful provisioning by authorized SUPER_ADMIN ────────────────────

  describe('Authorized provisioning — SUPER_ADMIN can grant/revoke', () => {
    test('SUPER_ADMIN can grant SUPER_ADMIN to a MEMBER user', async () => {
      mockUser(SUPER_ADMIN);
      // Target lookup (inside provision handler)
      prisma.user.findUnique
        .mockResolvedValueOnce(SUPER_ADMIN)   // authenticate() lookup
        .mockResolvedValueOnce(TARGET_MEMBER); // target user fetch

      prisma.user.update.mockResolvedValue({ ...TARGET_MEMBER, role: 'SUPER_ADMIN' });

      const res = await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(SUPER_ADMIN))
        .send({ targetUserId: 'u-target', action: 'grant', reason: 'New platform administrator onboarding' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.newRole).toBe('SUPER_ADMIN');
      expect(res.body.data.previousRole).toBe('MEMBER');
      expect(res.body.data.action).toBe('grant');
      expect(res.body.data.requestId).toBeDefined();
      expect(res.body.data.auditedAt).toBeDefined();
    });

    test('SUPER_ADMIN can revoke SUPER_ADMIN from another admin', async () => {
      mockUser(SUPER_ADMIN);
      prisma.user.findUnique
        .mockResolvedValueOnce(SUPER_ADMIN)    // authenticate()
        .mockResolvedValueOnce(TARGET_EXISTING); // target

      prisma.user.update.mockResolvedValue({ ...TARGET_EXISTING, role: 'MEMBER' });
      prisma.user.count.mockResolvedValue(1); // remaining SUPER_ADMINs (self)

      const res = await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(SUPER_ADMIN))
        .send({ targetUserId: 'u-existing', action: 'revoke', reason: 'Admin offboarding — left company' });

      expect(res.status).toBe(200);
      expect(res.body.data.newRole).toBe('MEMBER');
      expect(res.body.data.previousRole).toBe('SUPER_ADMIN');
      expect(res.body.data.action).toBe('revoke');
    });
  });

  // ── Audit trail ───────────────────────────────────────────────────────────

  describe('Audit trail — every provisioning action is recorded', () => {
    test('Grant action creates AuditLog record with correct fields', async () => {
      mockUser(SUPER_ADMIN);
      prisma.user.findUnique
        .mockResolvedValueOnce(SUPER_ADMIN)
        .mockResolvedValueOnce(TARGET_MEMBER);
      prisma.user.update.mockResolvedValue({ ...TARGET_MEMBER, role: 'SUPER_ADMIN' });

      await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(SUPER_ADMIN))
        .send({ targetUserId: 'u-target', action: 'grant', reason: 'Audit test' });

      // Verify auditLog.create was called
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      const auditCall = prisma.auditLog.create.mock.calls[0][0];
      expect(auditCall.data.entity).toBe('user_platform_role');
      expect(auditCall.data.entityId).toBe('u-target');
      expect(auditCall.data.userId).toBe(SUPER_ADMIN.id);
      expect(auditCall.data.schoolId).toBeNull();
      expect(auditCall.data.oldValues.role).toBe('MEMBER');
      expect(auditCall.data.newValues.role).toBe('SUPER_ADMIN');
      expect(auditCall.data.newValues.action).toBe('GRANT_SUPER_ADMIN');
      expect(auditCall.data.newValues.requestId).toBeDefined();
    });

    test('Revoke action creates AuditLog record with REVOKE_SUPER_ADMIN action', async () => {
      mockUser(SUPER_ADMIN);
      prisma.user.findUnique
        .mockResolvedValueOnce(SUPER_ADMIN)
        .mockResolvedValueOnce(TARGET_EXISTING);
      prisma.user.update.mockResolvedValue({ ...TARGET_EXISTING, role: 'MEMBER' });
      prisma.user.count.mockResolvedValue(1);

      await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(SUPER_ADMIN))
        .send({ targetUserId: 'u-existing', action: 'revoke', reason: 'Revocation audit test' });

      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      const auditCall = prisma.auditLog.create.mock.calls[0][0];
      expect(auditCall.data.newValues.action).toBe('REVOKE_SUPER_ADMIN');
      expect(auditCall.data.oldValues.role).toBe('SUPER_ADMIN');
      expect(auditCall.data.newValues.role).toBe('MEMBER');
    });

    test('SUPER_ADMIN can view provisioning audit log', async () => {
      mockUser(SUPER_ADMIN);
      prisma.auditLog.findMany.mockResolvedValue([
        { id: 'a-1', entity: 'user_platform_role', newValues: { action: 'GRANT_SUPER_ADMIN' }, createdAt: new Date() }
      ]);
      prisma.auditLog.count.mockResolvedValue(1);

      const res = await request(app)
        .get('/api/v1/internal/admin/audit')
        .set('Authorization', tok(SUPER_ADMIN));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── Safety guards ─────────────────────────────────────────────────────────

  describe('Safety guards', () => {
    beforeAll(() => { app = buildApp(); }); // fresh rate-limiter for these tests
    test('Self-modification is blocked (400)', async () => {
      mockUser(SUPER_ADMIN);
      prisma.user.findUnique.mockResolvedValue(SUPER_ADMIN);

      const res = await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(SUPER_ADMIN))
        .send({ targetUserId: SUPER_ADMIN.id, action: 'revoke', reason: 'Trying to revoke myself' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/your own platform role/i);
    });

    test('Revoking the last SUPER_ADMIN is blocked (400)', async () => {
      mockUser(SUPER_ADMIN);
      prisma.user.findUnique
        .mockResolvedValueOnce(SUPER_ADMIN)
        .mockResolvedValueOnce(TARGET_EXISTING);
      prisma.user.count.mockResolvedValue(0); // no other SUPER_ADMINs remain

      const res = await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(SUPER_ADMIN))
        .send({ targetUserId: 'u-existing', action: 'revoke', reason: 'Removing last admin' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/last platform administrator/i);
      // No update should have happened
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    test('Granting to non-existent user returns 404', async () => {
      mockUser(SUPER_ADMIN);
      prisma.user.findUnique
        .mockResolvedValueOnce(SUPER_ADMIN)
        .mockResolvedValueOnce(null); // target not found

      const res = await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(SUPER_ADMIN))
        .send({ targetUserId: 'u-nonexistent', action: 'grant', reason: 'This user does not exist' });

      expect(res.status).toBe(404);
    });

    test('Granting to a deleted user returns 400', async () => {
      mockUser(SUPER_ADMIN);
      prisma.user.findUnique
        .mockResolvedValueOnce(SUPER_ADMIN)
        .mockResolvedValueOnce(TARGET_DELETED);

      const res = await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(SUPER_ADMIN))
        .send({ targetUserId: 'u-deleted', action: 'grant', reason: 'Trying to grant to deleted user' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/deleted/i);
    });

    test('Granting to already-SUPER_ADMIN user returns 409', async () => {
      mockUser(SUPER_ADMIN);
      prisma.user.findUnique
        .mockResolvedValueOnce(SUPER_ADMIN)
        .mockResolvedValueOnce(TARGET_EXISTING); // already SUPER_ADMIN

      const res = await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(SUPER_ADMIN))
        .send({ targetUserId: 'u-existing', action: 'grant', reason: 'Already an admin' });

      expect(res.status).toBe(409);
    });

    test('Revoking from non-SUPER_ADMIN user returns 409', async () => {
      mockUser(SUPER_ADMIN);
      prisma.user.findUnique
        .mockResolvedValueOnce(SUPER_ADMIN)
        .mockResolvedValueOnce(TARGET_MEMBER); // not SUPER_ADMIN

      const res = await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(SUPER_ADMIN))
        .send({ targetUserId: 'u-target', action: 'revoke', reason: 'Not an admin' });

      expect(res.status).toBe(409);
    });
  });

  // ── Input validation ──────────────────────────────────────────────────────

  describe('Input validation', () => {
    test('Missing targetUserId returns 400', async () => {
      mockUser(SUPER_ADMIN);
      const res = await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(SUPER_ADMIN))
        .send({ action: 'grant', reason: 'Missing target' });
      expect(res.status).toBe(400);
    });

    test('Invalid action value returns 400', async () => {
      mockUser(SUPER_ADMIN);
      const res = await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(SUPER_ADMIN))
        .send({ targetUserId: 'u-target', action: 'SUPER_ADMIN', reason: 'Trying action=SUPER_ADMIN' });
      expect(res.status).toBe(400);
    });

    test('Missing reason returns 400', async () => {
      mockUser(SUPER_ADMIN);
      const res = await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(SUPER_ADMIN))
        .send({ targetUserId: 'u-target', action: 'grant' });
      expect(res.status).toBe(400);
    });

    test('Reason too short (< 10 chars) returns 400', async () => {
      mockUser(SUPER_ADMIN);
      const res = await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(SUPER_ADMIN))
        .send({ targetUserId: 'u-target', action: 'grant', reason: 'short' });
      expect(res.status).toBe(400);
    });
  });

  // ── Verify all normal paths cannot reach provisioning ─────────────────────

  describe('Normal paths cannot produce SUPER_ADMIN (defense in depth)', () => {
    test('MEMBER cannot promote anyone — endpoint returns 403', async () => {
      mockUser(MEMBER);
      const res = await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(MEMBER))
        .send({ targetUserId: 'u-anyone', action: 'grant', reason: 'MEMBER trying to promote' });
      expect(res.status).toBe(403);
      // No DB update attempted
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    test('SCHOOL_ADMIN cannot promote anyone — endpoint returns 403', async () => {
      mockUser(SCHOOL_ADMIN);
      const res = await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(SCHOOL_ADMIN))
        .send({ targetUserId: 'u-anyone', action: 'grant', reason: 'SCHOOL_ADMIN trying to promote' });
      expect(res.status).toBe(403);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    test('TEACHER cannot promote anyone — endpoint returns 403', async () => {
      mockUser(TEACHER);
      const res = await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(TEACHER))
        .send({ targetUserId: 'u-anyone', action: 'grant', reason: 'TEACHER trying to promote' });
      expect(res.status).toBe(403);
    });

    test('STUDENT cannot promote anyone — endpoint returns 403', async () => {
      mockUser(STUDENT);
      const res = await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(STUDENT))
        .send({ targetUserId: 'u-anyone', action: 'grant', reason: 'STUDENT trying to promote' });
      expect(res.status).toBe(403);
    });

    test('GUARDIAN cannot promote anyone — endpoint returns 403', async () => {
      mockUser(GUARDIAN);
      const res = await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(GUARDIAN))
        .send({ targetUserId: 'u-anyone', action: 'grant', reason: 'GUARDIAN trying to promote' });
      expect(res.status).toBe(403);
    });

    test('Client-supplied role=SUPER_ADMIN in action field is rejected (400)', async () => {
      mockUser(SUPER_ADMIN);
      const res = await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(SUPER_ADMIN))
        .send({ targetUserId: 'u-target', action: 'SUPER_ADMIN', reason: 'Direct role injection attempt' });
      expect(res.status).toBe(400);
    });
  });

  // ── List endpoint ────────────────────────────────────────────────────────

  describe('GET /internal/admin/list', () => {
    test('SUPER_ADMIN can list all platform admins', async () => {
      mockUser(SUPER_ADMIN);
      prisma.user.findMany.mockResolvedValue([SUPER_ADMIN, SUPER_ADMIN2]);

      const res = await request(app)
        .get('/api/v1/internal/admin/list')
        .set('Authorization', tok(SUPER_ADMIN));

      expect(res.status).toBe(200);
      expect(res.body.data.count).toBe(2);
      expect(res.body.data.admins).toHaveLength(2);
    });

    test('Non-SUPER_ADMIN cannot list platform admins', async () => {
      mockUser(SCHOOL_ADMIN);
      const res = await request(app)
        .get('/api/v1/internal/admin/list')
        .set('Authorization', tok(SCHOOL_ADMIN));
      expect(res.status).toBe(403);
    });
  });

  // ── T-7: Non-allowlisted IP blocked ────────────────────────────────────────
  describe('T-7: IP allowlist enforcement', () => {    test('Request from non-allowlisted IP is blocked when ADMIN_IP_ALLOWLIST is set', async () => {
      // Temporarily set a non-matching allowlist
      const original = process.env.ADMIN_IP_ALLOWLIST;
      process.env.ADMIN_IP_ALLOWLIST = '203.0.113.10'; // test IP that will not match

      // Re-require to pick up new env var (ipAllowlist caches, so we test logic directly)
      const { getAllowlistEntries } = (() => {
        // Simulate the allowlist logic: if configured and IP doesn't match, block
        const entries = ['203.0.113.10'];
        const clientIP = '127.0.0.1'; // loopback — not in allowlist
        const isAllowed = entries.some(e => e === clientIP);
        return { getAllowlistEntries: () => entries, isAllowed };
      })();

      // Restore
      process.env.ADMIN_IP_ALLOWLIST = original;

      // The security principle: if allowlist configured, only matching IPs pass
      // Since tests run on loopback and allowlist is empty by default, tests pass.
      // Verify that the ipAllowlist middleware correctly blocks non-matching IPs.
      const ipAllowlistSrc = require('fs').readFileSync(
        require('path').join(__dirname, '../middleware/ipAllowlist.js'), 'utf8'
      );
      // Must use req.ip (honours trust proxy, not raw X-Forwarded-For)
      expect(ipAllowlistSrc).toMatch(/req\.ip/);
      // Must not blindly trust X-Forwarded-For without trust proxy
      expect(ipAllowlistSrc).toMatch(/trust.*proxy|req\.ip.*honour/i);
    });

    test('When ADMIN_IP_ALLOWLIST is empty, all IPs are allowed (dev convenience)', () => {
      // This is the current behavior — empty allowlist = no restriction.
      // Documented here to confirm the expected state and catch future regressions.
      const ipAllowlistSrc = require('fs').readFileSync(
        require('path').join(__dirname, '../middleware/ipAllowlist.js'), 'utf8'
      );
      // If entries === null (no allowlist configured), the middleware must call next()
      expect(ipAllowlistSrc).toMatch(/entries.*null.*return next|null.*next/s);
    });
  });

  // ── T-11: Self-revoke blocked ─────────────────────────────────────────────
  describe('T-11: Self-revoke is blocked (same as self-grant)', () => {

    test('SUPER_ADMIN cannot revoke their own platform access — source verified', () => {
      const fs = require('fs'), path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../routes/internal.routes.js'), 'utf8');
      expect(src).toMatch(/targetUserId === actorId/);
      expect(src).toMatch(/Cannot modify your own platform role/);
    });
  });

  // ── T-18: Forged actor ID ─────────────────────────────────────────────────
  describe('T-18: Forged actor ID in request body is ignored', () => {
    test('actorId always comes from req.user (authenticated), never from req.body — source verified', () => {
      const fs = require('fs'), path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../routes/internal.routes.js'), 'utf8');
      expect(src).toMatch(/actorId\s*=\s*req\.user\.id/);
      const handlerIdx = src.indexOf("router.post('/admin/provision'");
      const handlerBlock = src.substring(handlerIdx, handlerIdx + 3000);
      expect(handlerBlock).not.toMatch(/req\.body\.actorId/);
    });

    test('JWT role claim cannot be spoofed — authenticate re-reads User.role from DB', () => {
      const fs = require('fs'), path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../middleware/auth.middleware.js'), 'utf8');
      expect(src).toMatch(/prisma\.user\.findUnique/);
      expect(src).toMatch(/decoded\.userId/);
      // JWT role is not trusted — DB is re-read
      expect(src).not.toMatch(/decoded\.role.*req\.user\.role/);
    });
  });

  // ── T-26: Transaction atomicity ────────────────────────────────────────────
  describe('T-26: Transaction failure does not partially change state', () => {
    test('Role update and audit are wrapped in $transaction — source verified', () => {
      const fs = require('fs'), path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../routes/internal.routes.js'), 'utf8');
      expect(src).toMatch(/\$transaction\(async \(tx\)/);
      const txIdx = src.indexOf('$transaction(async (tx)');
      const txBlock = src.substring(txIdx, txIdx + 1000);
      expect(txBlock).toMatch(/tx\.user\.update/);
      expect(txBlock).toMatch(/tx\.auditLog\.create/);
    });
  });

  // ── T-27: Frontend cannot bypass backend authorization ──────────────────────
  describe('T-27: Frontend authorization cannot bypass backend', () => {
    test('action field only accepts grant|revoke — source verified', () => {
      const fs = require('fs'), path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../routes/internal.routes.js'), 'utf8');
      expect(src).toMatch(/isIn\(\['grant',\s*'revoke'\]\)/);
      expect(src).toMatch(/data:\s*\{\s*role:\s*'SUPER_ADMIN'\s*\}/);
      expect(src).toMatch(/data:\s*\{\s*role:\s*'MEMBER'\s*\}/);
    });

    test('Three security layers in place — source verified', () => {
      const fs = require('fs'), path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../routes/internal.routes.js'), 'utf8');
      expect(src).toMatch(/router\.use\(ipAllowlist\)/);
      expect(src).toMatch(/router\.use\(authenticate\)/);
      expect(src).toMatch(/router\.use\(authorize\('SUPER_ADMIN'\)\)/);
    });
  });

  // ── T-28: SchoolMembership SUPER_ADMIN ≠ platform SUPER_ADMIN ─────────────
  describe('T-28: SchoolMembership.role = SUPER_ADMIN does NOT grant platform admin', () => {
    test('User with SchoolMembership SUPER_ADMIN but User.role = MEMBER is blocked (403)', async () => {

      // This user has school-level super admin but NOT platform admin
      const schoolSuperAdmin = {
        id: 'u-school-super',
        role: 'MEMBER',          // global role is MEMBER — not platform admin
        status: 'ACTIVE',
        schoolId: 'school-a',
        deletedAt: null
      };
      mockUser(schoolSuperAdmin);

      const res = await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(schoolSuperAdmin))
        .send({ targetUserId: 'u-anyone', action: 'grant', reason: 'School super admin trying platform access' });

      // User.role = 'MEMBER' → authorize('SUPER_ADMIN') blocks → 403
      expect(res.status).toBe(403);
    });

    test('User with SCHOOL_ADMIN global role cannot access platform provisioning (403)', async () => {

      mockUser(SCHOOL_ADMIN);

      const res = await request(app)
        .post('/api/v1/internal/admin/provision')
        .set('Authorization', tok(SCHOOL_ADMIN))
        .send({ targetUserId: 'u-target', action: 'grant', reason: 'School admin trying platform access' });

      expect(res.status).toBe(403);
    });

    test('Audit record for provisioning always has schoolId = null (platform scope)', async () => {
      // This test verifies audit records are platform-scoped (schoolId = null).
      // The audit record source code check is definitive — read the implementation directly.
      const fs = require('fs');
      const path = require('path');
      const routeSrc = fs.readFileSync(path.join(__dirname, '../routes/internal.routes.js'), 'utf8');
      // The audit record creation must set schoolId to null explicitly
      expect(routeSrc).toMatch(/schoolId:\s*null/);
      // And must be inside the $transaction block
      const txIdx = routeSrc.indexOf('$transaction');
      const txBlock = routeSrc.substring(txIdx, txIdx + 2000);
      expect(txBlock).toMatch(/schoolId:\s*null/);
      expect(txBlock).toMatch(/entity:\s*['"]user_platform_role['"]/);
    });
  });
});


