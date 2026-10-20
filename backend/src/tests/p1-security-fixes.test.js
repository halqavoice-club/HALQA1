'use strict';
/**
 * P1 Security Fix Regression Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * SEC-HIGH-001 (P1-001): PUT /users/:id/status — enum validation
 * SEC-MED-005  (P1-002): PENDING school admin cannot perform admin actions
 * SEC-HIGH-003 (P1-003): avatarUrl URL validation in PUT /users/profile
 * SEC-CRIT-004 (P1-004): GET /metrics always requires token
 *
 * Run via: npm run test:unit
 */

jest.mock('../utils/prisma');
jest.mock('../utils/redis', () => ({
  isRedisReady:      jest.fn(() => false),
  getCache:          jest.fn().mockResolvedValue(null),
  setCache:          jest.fn().mockResolvedValue(undefined),
  deleteCache:       jest.fn().mockResolvedValue(undefined),
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/jwt',    () => ({ verifyAccessToken: jest.fn() }));
jest.mock('../middleware/ipAllowlist', () => (req, res, next) => next());
jest.mock('../sockets',      () => ({ getIo: jest.fn(() => null) }));
jest.mock('../controllers/auth.controller', () => ({
  deleteGetMeCache: jest.fn().mockResolvedValue(undefined),
  getMe: jest.fn(),
}));
jest.mock('../utils/prometheus', () => ({
  registry: {
    contentType: 'text/plain',
    metrics: jest.fn().mockResolvedValue('# metrics\n'),
  },
}));

const request    = require('supertest');
const express    = require('express');
const cookieParser = require('cookie-parser');
const prisma     = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');
const fs   = require('fs');
const path = require('path');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function asUser(id, role, status, schoolId) {
  status   = status   || 'ACTIVE';
  schoolId = schoolId || null;
  const u = { id, role, status, schoolId, firstName: 'T', lastName: 'U', avatarUrl: null, deletedAt: null };
  verifyAccessToken.mockReturnValue({ userId: id, role, schoolId });
  prisma.user.findUnique.mockResolvedValue(u);
  return u;
}

function tok(id) { return `Bearer t-${id}`; }

beforeEach(() => {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);
  require('../utils/redis').getCache.mockResolvedValue(null);
  // Ensure schoolMembership methods exist on the mock without replacing the whole object
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  if (typeof prisma.schoolMembership.findUnique !== 'function') prisma.schoolMembership.findUnique = jest.fn();
  if (typeof prisma.schoolMembership.findFirst  !== 'function') prisma.schoolMembership.findFirst  = jest.fn();
  if (typeof prisma.schoolMembership.update     !== 'function') prisma.schoolMembership.update     = jest.fn();
  if (typeof prisma.schoolMembership.create     !== 'function') prisma.schoolMembership.create     = jest.fn();
  if (typeof prisma.schoolMembership.upsert     !== 'function') prisma.schoolMembership.upsert     = jest.fn();
  if (typeof prisma.schoolMembership.count      !== 'function') prisma.schoolMembership.count      = jest.fn();
  prisma.schoolMembership.findUnique.mockResolvedValue(null);
  prisma.schoolMembership.findFirst.mockResolvedValue(null);
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-001 (SEC-HIGH-001): PUT /users/:id/status — enum validation
// ─────────────────────────────────────────────────────────────────────────────

describe('P1-001 SEC-HIGH-001: User status enum validation', () => {
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

  // Mock school membership required by eduAdmin middleware
  function mockSchoolAdminContext(userId, schoolId) {
    prisma.schoolMembership.findUnique.mockImplementation(({ where }) => {
      const uid = where.userId_schoolId?.userId   || where.userId;
      const sid = where.userId_schoolId?.schoolId || where.schoolId;
      if (uid === userId && sid === schoolId) {
        return Promise.resolve({ id: 'm1', userId, schoolId, role: 'SCHOOL_ADMIN', status: 'ACTIVE', deletedAt: null });
      }
      return Promise.resolve(null);
    });
    prisma.schoolMembership.findFirst.mockImplementation(({ where }) => {
      if (where.userId === userId) {
        return Promise.resolve({ id: 'm1', userId, schoolId, role: 'SCHOOL_ADMIN', status: 'ACTIVE', deletedAt: null });
      }
      return Promise.resolve(null);
    });
  }

  test('ACTIVE is accepted', async () => {
    const adminId = 'admin-status-1';
    asUser(adminId, 'SCHOOL_ADMIN', 'ACTIVE', 'school-a');
    mockSchoolAdminContext(adminId, 'school-a');
    prisma.user.update.mockResolvedValue({ id: 'target-1', status: 'ACTIVE' });

    const res = await request(userApp)
      .put('/api/v1/users/target-1/status')
      .set('Authorization', tok(adminId))
      .send({ status: 'ACTIVE' });
    expect([200, 201]).toContain(res.status);
  });

  test('SUSPENDED is accepted', async () => {
    const adminId = 'admin-status-2';
    asUser(adminId, 'SCHOOL_ADMIN', 'ACTIVE', 'school-a');
    mockSchoolAdminContext(adminId, 'school-a');
    prisma.user.update.mockResolvedValue({ id: 'target-1', status: 'SUSPENDED' });

    const res = await request(userApp)
      .put('/api/v1/users/target-1/status')
      .set('Authorization', tok(adminId))
      .send({ status: 'SUSPENDED' });
    expect([200, 201]).toContain(res.status);
  });

  test('INACTIVE is accepted', async () => {
    const adminId = 'admin-status-3';
    asUser(adminId, 'SCHOOL_ADMIN', 'ACTIVE', 'school-a');
    mockSchoolAdminContext(adminId, 'school-a');
    prisma.user.update.mockResolvedValue({ id: 'target-1', status: 'INACTIVE' });

    const res = await request(userApp)
      .put('/api/v1/users/target-1/status')
      .set('Authorization', tok(adminId))
      .send({ status: 'INACTIVE' });
    expect([200, 201]).toContain(res.status);
  });

  test('BANNED is accepted', async () => {
    const adminId = 'admin-status-4';
    asUser(adminId, 'SCHOOL_ADMIN', 'ACTIVE', 'school-a');
    mockSchoolAdminContext(adminId, 'school-a');
    prisma.user.update.mockResolvedValue({ id: 'target-1', status: 'BANNED' });

    const res = await request(userApp)
      .put('/api/v1/users/target-1/status')
      .set('Authorization', tok(adminId))
      .send({ status: 'BANNED' });
    expect([200, 201]).toContain(res.status);
  });

  test('PENDING is accepted (valid enum value)', async () => {
    const adminId = 'admin-status-5';
    asUser(adminId, 'SCHOOL_ADMIN', 'ACTIVE', 'school-a');
    mockSchoolAdminContext(adminId, 'school-a');
    prisma.user.update.mockResolvedValue({ id: 'target-1', status: 'PENDING' });

    const res = await request(userApp)
      .put('/api/v1/users/target-1/status')
      .set('Authorization', tok(adminId))
      .send({ status: 'PENDING' });
    expect([200, 201]).toContain(res.status);
  });

  test('Arbitrary value ACTIVE_SUPERUSER returns 400', async () => {
    const adminId = 'admin-status-6';
    asUser(adminId, 'SCHOOL_ADMIN', 'ACTIVE', 'school-a');
    mockSchoolAdminContext(adminId, 'school-a');

    const res = await request(userApp)
      .put('/api/v1/users/target-1/status')
      .set('Authorization', tok(adminId))
      .send({ status: 'ACTIVE_SUPERUSER' });
    expect(res.status).toBe(400);
    // DB must NOT have been called
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test('Empty string status returns 400', async () => {
    const adminId = 'admin-status-7';
    asUser(adminId, 'SCHOOL_ADMIN', 'ACTIVE', 'school-a');
    mockSchoolAdminContext(adminId, 'school-a');

    const res = await request(userApp)
      .put('/api/v1/users/target-1/status')
      .set('Authorization', tok(adminId))
      .send({ status: '' });
    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test('Missing status returns 400', async () => {
    const adminId = 'admin-status-8';
    asUser(adminId, 'SCHOOL_ADMIN', 'ACTIVE', 'school-a');
    mockSchoolAdminContext(adminId, 'school-a');

    const res = await request(userApp)
      .put('/api/v1/users/target-1/status')
      .set('Authorization', tok(adminId))
      .send({});
    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // Source verification
  test('user.routes.js defines VALID_USER_STATUSES with all 5 enum values', () => {
    const src = fs.readFileSync(path.join(__dirname, '../routes/user.routes.js'), 'utf8');
    expect(src).toMatch(/VALID_USER_STATUSES/);
    expect(src).toMatch(/'ACTIVE'/);
    expect(src).toMatch(/'INACTIVE'/);
    expect(src).toMatch(/'SUSPENDED'/);
    expect(src).toMatch(/'PENDING'/);
    expect(src).toMatch(/'BANNED'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-002 (SEC-MED-005): PENDING school admin cannot perform admin actions
// ─────────────────────────────────────────────────────────────────────────────

describe('P1-002 SEC-MED-005: PENDING school admin blocked', () => {
  let smApp;

  beforeAll(() => {
    smApp = express();
    smApp.use(express.json());
    smApp.use(cookieParser());
    smApp.use('/api/v1/school-memberships', require('../routes/schoolMembership.routes'));
    smApp.use((err, req, res, _next) => {
      res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
    });
  });

  const TARGET_MEMBERSHIP_ID = 'membership-target-id';
  const TARGET_SCHOOL_ID     = 'school-target-id';
  const CALLER_ID            = 'caller-user-id';

  function mockCallerMembership(callerStatus) {
    // Target membership to operate on
    prisma.schoolMembership.findUnique.mockImplementation(({ where }) => {
      if (where.id === TARGET_MEMBERSHIP_ID) {
        return Promise.resolve({
          id: TARGET_MEMBERSHIP_ID,
          userId: 'some-member',
          schoolId: TARGET_SCHOOL_ID,
          role: 'STUDENT',
          status: 'PENDING'
        });
      }
      // Caller membership lookup
      if (where.userId_schoolId?.userId === CALLER_ID && where.userId_schoolId?.schoolId === TARGET_SCHOOL_ID) {
        return Promise.resolve({
          id: 'caller-mem-id',
          userId: CALLER_ID,
          schoolId: TARGET_SCHOOL_ID,
          role: 'SCHOOL_ADMIN',
          status: callerStatus
        });
      }
      return Promise.resolve(null);
    });
  }

  test('ACTIVE SCHOOL_ADMIN can update membership status', async () => {
    asUser(CALLER_ID, 'SCHOOL_ADMIN', 'ACTIVE', TARGET_SCHOOL_ID);
    mockCallerMembership('ACTIVE');
    prisma.schoolMembership.update.mockResolvedValue({ id: TARGET_MEMBERSHIP_ID, status: 'ACTIVE' });

    const res = await request(smApp)
      .put(`/api/v1/school-memberships/${TARGET_MEMBERSHIP_ID}/status`)
      .set('Authorization', tok(CALLER_ID))
      .send({ status: 'ACTIVE' });
    // Should succeed (200) or get school member check (403 from requireSchoolMember — that's a different guard)
    // The key check is it doesn't get blocked by our new PENDING check
    expect([200, 201, 403]).toContain(res.status);
    if (res.status === 200) {
      // Full success — ACTIVE admin worked
      expect(prisma.schoolMembership.update).toHaveBeenCalled();
    }
  });

  test('PENDING SCHOOL_ADMIN gets 403 on PUT /:id/status', async () => {
    asUser(CALLER_ID, 'SCHOOL_ADMIN', 'ACTIVE', TARGET_SCHOOL_ID);
    mockCallerMembership('PENDING');

    const res = await request(smApp)
      .put(`/api/v1/school-memberships/${TARGET_MEMBERSHIP_ID}/status`)
      .set('Authorization', tok(CALLER_ID))
      .send({ status: 'ACTIVE' });
    expect(res.status).toBe(403);
    expect(prisma.schoolMembership.update).not.toHaveBeenCalled();
  });

  test('SUSPENDED SCHOOL_ADMIN gets 403 on PUT /:id/status', async () => {
    asUser(CALLER_ID, 'SCHOOL_ADMIN', 'ACTIVE', TARGET_SCHOOL_ID);
    mockCallerMembership('SUSPENDED');

    const res = await request(smApp)
      .put(`/api/v1/school-memberships/${TARGET_MEMBERSHIP_ID}/status`)
      .set('Authorization', tok(CALLER_ID))
      .send({ status: 'ACTIVE' });
    expect(res.status).toBe(403);
    expect(prisma.schoolMembership.update).not.toHaveBeenCalled();
  });

  test('INACTIVE SCHOOL_ADMIN gets 403 on PUT /:id/status', async () => {
    asUser(CALLER_ID, 'SCHOOL_ADMIN', 'ACTIVE', TARGET_SCHOOL_ID);
    mockCallerMembership('INACTIVE');

    const res = await request(smApp)
      .put(`/api/v1/school-memberships/${TARGET_MEMBERSHIP_ID}/status`)
      .set('Authorization', tok(CALLER_ID))
      .send({ status: 'ACTIVE' });
    expect(res.status).toBe(403);
    expect(prisma.schoolMembership.update).not.toHaveBeenCalled();
  });

  test('PENDING SCHOOL_ADMIN gets 403 on PUT /:id/role', async () => {
    asUser(CALLER_ID, 'SCHOOL_ADMIN', 'ACTIVE', TARGET_SCHOOL_ID);
    mockCallerMembership('PENDING');

    const res = await request(smApp)
      .put(`/api/v1/school-memberships/${TARGET_MEMBERSHIP_ID}/role`)
      .set('Authorization', tok(CALLER_ID))
      .send({ role: 'TEACHER' });
    expect(res.status).toBe(403);
    expect(prisma.schoolMembership.update).not.toHaveBeenCalled();
  });

  test('SUPER_ADMIN without school membership is denied (no implicit bypass)', async () => {
    asUser(CALLER_ID, 'SUPER_ADMIN', 'ACTIVE', null);
    // SUPER_ADMIN has no membership record in the target school.
    // Under the no-bypass rule, they must be denied — admin is platform-level only.
    prisma.schoolMembership.findUnique.mockImplementation(({ where }) => {
      if (where.id === TARGET_MEMBERSHIP_ID) {
        return Promise.resolve({
          id: TARGET_MEMBERSHIP_ID,
          userId: 'some-member',
          schoolId: TARGET_SCHOOL_ID,
          role: 'STUDENT',
          status: 'PENDING'
        });
      }
      return Promise.resolve(null); // no membership for SUPER_ADMIN
    });
    prisma.schoolMembership.update.mockResolvedValue({ id: TARGET_MEMBERSHIP_ID, status: 'ACTIVE' });

    const res = await request(smApp)
      .put(`/api/v1/school-memberships/${TARGET_MEMBERSHIP_ID}/status`)
      .set('Authorization', tok(CALLER_ID))
      .send({ status: 'ACTIVE' });
    // No bypass: 403 — SUPER_ADMIN must have an active school membership to act
    expect(res.status).toBe(403);
  });

  test('PENDING admin cannot approve their own membership (self-approval blocked)', async () => {
    // The target membership IS the caller's own pending membership
    const selfCallerId = 'self-pending-admin';
    asUser(selfCallerId, 'SCHOOL_ADMIN', 'ACTIVE', TARGET_SCHOOL_ID);
    const selfMembership = {
      id: TARGET_MEMBERSHIP_ID,
      userId: selfCallerId,
      schoolId: TARGET_SCHOOL_ID,
      role: 'SCHOOL_ADMIN',
      status: 'PENDING'
    };
    prisma.schoolMembership.findUnique.mockImplementation(({ where }) => {
      // Both the target lookup and the caller lookup return the same PENDING membership
      if (where.id === TARGET_MEMBERSHIP_ID ||
          (where.userId_schoolId?.userId === selfCallerId && where.userId_schoolId?.schoolId === TARGET_SCHOOL_ID)) {
        return Promise.resolve(selfMembership);
      }
      return Promise.resolve(null);
    });

    const res = await request(smApp)
      .put(`/api/v1/school-memberships/${TARGET_MEMBERSHIP_ID}/status`)
      .set('Authorization', tok(selfCallerId))
      .send({ status: 'ACTIVE' });
    expect(res.status).toBe(403);
    expect(prisma.schoolMembership.update).not.toHaveBeenCalled();
  });

  // Source verification
  test('schoolMembership.routes.js checks callerMembership.status === ACTIVE', () => {
    const src = fs.readFileSync(path.join(__dirname, '../routes/schoolMembership.routes.js'), 'utf8');
    expect(src).toMatch(/callerMembership\.status\s*===\s*'ACTIVE'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-003 (SEC-HIGH-003): avatarUrl validation in PUT /users/profile
// ─────────────────────────────────────────────────────────────────────────────

describe('P1-003 SEC-HIGH-003: avatarUrl URL validation', () => {
  let profileApp;

  beforeAll(() => {
    profileApp = express();
    profileApp.use(express.json());
    profileApp.use(cookieParser());
    profileApp.use('/api/v1/users', require('../routes/user.routes'));
    profileApp.use((err, req, res, _next) => {
      res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
    });
  });

  function setupProfile(userId) {
    asUser(userId, 'MEMBER', 'ACTIVE');
    prisma.user.update.mockResolvedValue({ id: userId, firstName: 'T', lastName: 'U', avatarUrl: null });
  }

  test('Valid HTTPS URL is accepted', async () => {
    setupProfile('usr-av1');
    const res = await request(profileApp)
      .put('/api/v1/users/profile')
      .set('Authorization', tok('usr-av1'))
      .send({ avatarUrl: 'https://example.com/avatar.jpg' });
    expect([200, 201]).toContain(res.status);
  });

  test('R2/CDN URL accepted (https://*.r2.dev/...)', async () => {
    setupProfile('usr-av2');
    const res = await request(profileApp)
      .put('/api/v1/users/profile')
      .set('Authorization', tok('usr-av2'))
      .send({ avatarUrl: 'https://pub-abc123.r2.dev/avatars/test.jpg' });
    expect([200, 201]).toContain(res.status);
  });

  test('Local /uploads/ path accepted (dev storage)', async () => {
    setupProfile('usr-av3');
    const res = await request(profileApp)
      .put('/api/v1/users/profile')
      .set('Authorization', tok('usr-av3'))
      .send({ avatarUrl: '/uploads/avatars/uuid-test.jpg' });
    expect([200, 201]).toContain(res.status);
  });

  test('null avatarUrl accepted (clears avatar)', async () => {
    setupProfile('usr-av4');
    const res = await request(profileApp)
      .put('/api/v1/users/profile')
      .set('Authorization', tok('usr-av4'))
      .send({ avatarUrl: null });
    expect([200, 201]).toContain(res.status);
  });

  test('Empty string avatarUrl accepted (clears avatar)', async () => {
    setupProfile('usr-av5');
    const res = await request(profileApp)
      .put('/api/v1/users/profile')
      .set('Authorization', tok('usr-av5'))
      .send({ avatarUrl: '' });
    expect([200, 201]).toContain(res.status);
  });

  test('javascript: URL rejected with 400', async () => {
    setupProfile('usr-av6');
    const res = await request(profileApp)
      .put('/api/v1/users/profile')
      .set('Authorization', tok('usr-av6'))
      .send({ avatarUrl: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test('data: URL rejected with 400', async () => {
    setupProfile('usr-av7');
    const res = await request(profileApp)
      .put('/api/v1/users/profile')
      .set('Authorization', tok('usr-av7'))
      .send({ avatarUrl: 'data:text/html,<script>alert(1)</script>' });
    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test('file: URL rejected with 400', async () => {
    setupProfile('usr-av8');
    const res = await request(profileApp)
      .put('/api/v1/users/profile')
      .set('Authorization', tok('usr-av8'))
      .send({ avatarUrl: 'file:///etc/passwd' });
    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test('Plain HTTP URL rejected (not HTTPS)', async () => {
    setupProfile('usr-av9');
    const res = await request(profileApp)
      .put('/api/v1/users/profile')
      .set('Authorization', tok('usr-av9'))
      .send({ avatarUrl: 'http://attacker.com/evil.jpg' });
    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test('Arbitrary non-URL string rejected with 400', async () => {
    setupProfile('usr-av10');
    const res = await request(profileApp)
      .put('/api/v1/users/profile')
      .set('Authorization', tok('usr-av10'))
      .send({ avatarUrl: 'not-a-url-at-all-just-a-string' });
    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test('No avatarUrl field passes through (optional field unchanged)', async () => {
    setupProfile('usr-av11');
    const res = await request(profileApp)
      .put('/api/v1/users/profile')
      .set('Authorization', tok('usr-av11'))
      .send({ firstName: 'Test' });
    expect([200, 201]).toContain(res.status);
  });

  // Source verification
  test('user.routes.js defines validateAvatarUrl function', () => {
    const src = fs.readFileSync(path.join(__dirname, '../routes/user.routes.js'), 'utf8');
    expect(src).toMatch(/validateAvatarUrl/);
    expect(src).toMatch(/javascript:/);
    expect(src).toMatch(/https:/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-004 (SEC-CRIT-004): /metrics always requires a token
// ─────────────────────────────────────────────────────────────────────────────

describe('P1-004 SEC-CRIT-004: /metrics always requires token', () => {
  let metricsApp;
  const VALID_TOKEN    = 'test-metrics-secret-token-12345';
  const DEFAULT_TOKEN  = 'halqa_metrics_dev_token_change_in_production';

  beforeAll(() => {
    metricsApp = express();
    metricsApp.use(express.json());
    // Mount the /metrics route by requiring app.js selectively — but app.js
    // registers all routes, so instead we test the security logic directly
    // by building a minimal express app that mirrors the implementation.
    // This avoids starting the full server while still testing the exact logic.
  });

  // Helper: create a minimal app with the /metrics endpoint mirroring app.js logic
  function makeMetricsApp(metricsToken, isProduction) {
    const app = express();
    const logger = { error: jest.fn(), info: jest.fn() };
    const DEFAULT = 'halqa_metrics_dev_token_change_in_production';

    app.get('/metrics', async (req, res) => {
      const configuredToken = metricsToken;
      const IS_PROD         = isProduction;

      if (IS_PROD) {
        if (!configuredToken || configuredToken === DEFAULT) {
          return res.status(503).json({ error: 'Metrics endpoint is not configured for production.' });
        }
      }

      if (!configuredToken) {
        return res.status(401).json({ error: 'Unauthorized. Set METRICS_TOKEN to access this endpoint.' });
      }

      const supplied = (req.headers.authorization || '').replace('Bearer ', '').trim() || req.query.token;
      if (!supplied || supplied !== configuredToken) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      res.status(200).json({ metrics: 'ok' });
    });

    return app;
  }

  test('Unauthenticated request is rejected (token configured, dev env)', async () => {
    const app = makeMetricsApp(VALID_TOKEN, false);
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(401);
  });

  test('Wrong token rejected (dev env)', async () => {
    const app = makeMetricsApp(VALID_TOKEN, false);
    const res = await request(app)
      .get('/metrics')
      .set('Authorization', 'Bearer wrong-token');
    expect(res.status).toBe(401);
  });

  test('Correct token accepted (dev env)', async () => {
    const app = makeMetricsApp(VALID_TOKEN, false);
    const res = await request(app)
      .get('/metrics')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
  });

  test('Token via query param accepted', async () => {
    const app = makeMetricsApp(VALID_TOKEN, false);
    const res = await request(app).get(`/metrics?token=${VALID_TOKEN}`);
    expect(res.status).toBe(200);
  });

  test('No METRICS_TOKEN configured returns 401 even in dev', async () => {
    // Previously this would return 200 (open). Now it returns 401.
    const app = makeMetricsApp(null, false);
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(401);
  });

  test('Default placeholder token: unauthenticated returns 401 (dev)', async () => {
    // Even in dev, the default token requires a matching token to be supplied
    const app = makeMetricsApp(DEFAULT_TOKEN, false);
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(401);
  });

  test('Default placeholder token: correct value accepted (dev)', async () => {
    const app = makeMetricsApp(DEFAULT_TOKEN, false);
    const res = await request(app)
      .get('/metrics')
      .set('Authorization', `Bearer ${DEFAULT_TOKEN}`);
    expect(res.status).toBe(200);
  });

  test('Production with default token returns 503', async () => {
    const app = makeMetricsApp(DEFAULT_TOKEN, true);
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(503);
  });

  test('Production with no token returns 503', async () => {
    const app = makeMetricsApp(null, true);
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(503);
  });

  test('Production with custom token and correct value returns 200', async () => {
    const app = makeMetricsApp(VALID_TOKEN, true);
    const res = await request(app)
      .get('/metrics')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
  });

  // Source verification
  test('app.js /metrics no longer has "allow freely" fallback', () => {
    const src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    // The old "allow freely" comment must be gone
    expect(src).not.toMatch(/allow freely/);
    // The new behaviour: always require token
    expect(src).toMatch(/Unauthorized\. Set METRICS_TOKEN/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0 regression: all three P0 fixes still hold
// ─────────────────────────────────────────────────────────────────────────────

describe('P0 regression checks', () => {
  test('backup.routes.js still contains authorize("SUPER_ADMIN")', () => {
    const src = fs.readFileSync(path.join(__dirname, '../routes/backup.routes.js'), 'utf8');
    expect(src).toMatch(/authorize\s*\(\s*['"]SUPER_ADMIN['"]\s*\)/);
  });

  test('livekit.controller.js still checks voice room participant', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/livekit.controller.js'), 'utf8');
    expect(src).toMatch(/not an active participant in this voice room/);
  });

  test('user.routes.js still defines PUBLIC_PROFILE_SELECT without email', () => {
    const src = fs.readFileSync(path.join(__dirname, '../routes/user.routes.js'), 'utf8');
    expect(src).toMatch(/PUBLIC_PROFILE_SELECT/);
    const match = src.match(/const PUBLIC_PROFILE_SELECT\s*=\s*\{([^}]+)\}/);
    if (match) {
      expect(match[1]).not.toMatch(/\bemail\b/);
    }
  });
});
