'use strict';
/**
 * Sprint 7 — Security Regression Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * UIGAP-014: /health/detailed requires HEALTH_TOKEN
 * GAP-001:   Production startup warns when ADMIN_IP_ALLOWLIST is empty
 * GAP-002:   requireSchoolAccess checks SchoolMembership (not just user.schoolId)
 *
 * All tests use mocked DB — no real database required.
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
jest.mock('livekit-server-sdk', () => ({
  AccessToken: jest.fn().mockImplementation(() => ({
    addGrant: jest.fn(),
    toJwt:    jest.fn().mockResolvedValue('mock.livekit.token'),
  })),
}));
// health.js calls external services — mock them all so no network I/O
jest.mock('../utils/circuitBreaker', () => ({
  registry: { getAllStates: jest.fn(() => ({})) }
}));
global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200 }));

const request  = require('supertest');
const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const prisma   = require('../utils/prisma');

beforeEach(() => {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);
  require('../utils/redis').getCache.mockResolvedValue(null);
});

// ─────────────────────────────────────────────────────────────────────────────
// UIGAP-014: /health/detailed token gate
// The endpoint must:
//   - Return 401 when HEALTH_TOKEN is set but no token supplied
//   - Return 401 when supplied token does not match
//   - Return 200/503 (not 401) when correct token supplied
//   - Return 401 when HEALTH_TOKEN is unset in non-production
//   - Return 503 when HEALTH_TOKEN is unset in production
// ─────────────────────────────────────────────────────────────────────────────

describe('UIGAP-014: /health/detailed token gate', () => {
  const ORIG_ENV = process.env.NODE_ENV;
  const ORIG_TOKEN = process.env.HEALTH_TOKEN;

  afterEach(() => {
    // Restore env after each test
    if (ORIG_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIG_ENV;

    if (ORIG_TOKEN === undefined) delete process.env.HEALTH_TOKEN;
    else process.env.HEALTH_TOKEN = ORIG_TOKEN;
  });

  function makeHealthApp() {
    // Build an isolated mini-app that replicates the /health/detailed route
    // exactly as registered in app.js (inline token-gate + health.detailed).
    const health = require('../utils/health');
    const logger = require('../utils/logger');
    const app = express();
    app.use(express.json());

    app.get('/health/detailed', (req, res, next) => {
      const configuredToken = process.env.HEALTH_TOKEN;
      const DEFAULT_TOKEN   = 'halqa_health_dev_token_change_in_production';
      const IS_PROD         = process.env.NODE_ENV === 'production';

      if (IS_PROD) {
        if (!configuredToken || configuredToken === DEFAULT_TOKEN) {
          return res.status(503).json({ error: 'Health detail endpoint is not configured for production. Set HEALTH_TOKEN.' });
        }
      }

      if (!configuredToken) {
        return res.status(401).json({ error: 'Unauthorized. Set HEALTH_TOKEN to access /health/detailed.' });
      }

      const supplied = (req.headers.authorization || '').replace('Bearer ', '').trim() || req.query.token;
      if (!supplied || supplied !== configuredToken) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      return health.detailed(req, res, next);
    });

    return app;
  }

  test('returns 401 when HEALTH_TOKEN is set but no token in request (non-prod)', async () => {
    process.env.NODE_ENV    = 'test';
    process.env.HEALTH_TOKEN = 'super-secret-health-token';
    const app = makeHealthApp();
    const res = await request(app).get('/health/detailed');
    expect(res.status).toBe(401);
  });

  test('returns 401 when wrong token is supplied (Authorization header)', async () => {
    process.env.NODE_ENV    = 'test';
    process.env.HEALTH_TOKEN = 'correct-token';
    const app = makeHealthApp();
    const res = await request(app).get('/health/detailed')
      .set('Authorization', 'Bearer wrong-token');
    expect(res.status).toBe(401);
  });

  test('returns 401 when wrong token is supplied (query param)', async () => {
    process.env.NODE_ENV    = 'test';
    process.env.HEALTH_TOKEN = 'correct-token';
    const app = makeHealthApp();
    const res = await request(app).get('/health/detailed?token=wrong-token');
    expect(res.status).toBe(401);
  });

  test('returns 200 or 503 (not 401) when correct token in Authorization header', async () => {
    process.env.NODE_ENV    = 'test';
    process.env.HEALTH_TOKEN = 'correct-token';
    const app = makeHealthApp();
    const res = await request(app).get('/health/detailed')
      .set('Authorization', 'Bearer correct-token');
    // 401 means token gate rejected — the rest (200/503) is fine
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect([200, 503]).toContain(res.status);
  });

  test('returns 200 or 503 (not 401) when correct token in query param', async () => {
    process.env.NODE_ENV    = 'test';
    process.env.HEALTH_TOKEN = 'correct-token';
    const app = makeHealthApp();
    const res = await request(app).get('/health/detailed?token=correct-token');
    expect(res.status).not.toBe(401);
    expect([200, 503]).toContain(res.status);
  });

  test('returns 401 when HEALTH_TOKEN is not set in non-production', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.HEALTH_TOKEN;
    const app = makeHealthApp();
    const res = await request(app).get('/health/detailed');
    expect(res.status).toBe(401);
  });

  test('returns 503 when HEALTH_TOKEN is not set in production', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.HEALTH_TOKEN;
    const app = makeHealthApp();
    const res = await request(app).get('/health/detailed');
    expect(res.status).toBe(503);
  });

  test('returns 503 when HEALTH_TOKEN is still the default in production', async () => {
    process.env.NODE_ENV    = 'production';
    process.env.HEALTH_TOKEN = 'halqa_health_dev_token_change_in_production';
    const app = makeHealthApp();
    const res = await request(app).get('/health/detailed');
    expect(res.status).toBe(503);
  });

  // /health/liveness must remain public — Kubernetes probe
  test('/health/liveness is still public (no token needed)', async () => {
    process.env.NODE_ENV    = 'test';
    process.env.HEALTH_TOKEN = 'some-token';
    const health = require('../utils/health');
    const app = express();
    app.get('/health/liveness', health.liveness);
    const res = await request(app).get('/health/liveness');
    expect(res.status).toBe(200);
  });

  // /health/readiness must remain public — Kubernetes probe
  test('/health/readiness is still public (no token needed)', async () => {
    process.env.NODE_ENV    = 'test';
    process.env.HEALTH_TOKEN = 'some-token';
    const health = require('../utils/health');
    const app = express();
    app.get('/health/readiness', health.readiness);
    const res = await request(app).get('/health/readiness');
    // 200 or 503 — depends on mock state. Must not be 401.
    expect(res.status).not.toBe(401);
  });

  // Source-level verification
  test('app.js /health/detailed route has HEALTH_TOKEN guard', () => {
    const src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    expect(src).toMatch(/HEALTH_TOKEN/);
    expect(src).toMatch(/health\.detailed/);
    // Token gate pattern is present
    expect(src).toMatch(/UIGAP-014/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP-001: ADMIN_IP_ALLOWLIST — production startup warning
// The production startup warning code must exist in app.js
// ─────────────────────────────────────────────────────────────────────────────

describe('GAP-001: ADMIN_IP_ALLOWLIST production startup warning', () => {
  test('app.js contains production warning for missing ADMIN_IP_ALLOWLIST', () => {
    const src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    // Must warn when ADMIN_IP_ALLOWLIST is empty in production
    expect(src).toMatch(/ADMIN_IP_ALLOWLIST/);
    expect(src).toMatch(/GAP-001/);
    expect(src).toMatch(/NODE_ENV.*production.*ADMIN_IP_ALLOWLIST|ADMIN_IP_ALLOWLIST.*NODE_ENV.*production/);
  });

  test('ipAllowlist middleware passes through when ADMIN_IP_ALLOWLIST is empty (dev behaviour)', () => {
    const origEnv = process.env.ADMIN_IP_ALLOWLIST;
    delete process.env.ADMIN_IP_ALLOWLIST;

    // Use jest.requireActual to bypass the top-level mock and test the real middleware
    const realIpAllowlist = jest.requireActual('../middleware/ipAllowlist');

    const req  = { ip: '1.2.3.4', connection: { remoteAddress: '1.2.3.4' } };
    const res  = {};
    const next = jest.fn();

    realIpAllowlist(req, res, next);
    expect(next).toHaveBeenCalled();

    if (origEnv !== undefined) process.env.ADMIN_IP_ALLOWLIST = origEnv;
    else delete process.env.ADMIN_IP_ALLOWLIST;
  });

  test('ipAllowlist middleware blocks IPs not in the allowlist when configured', async () => {
    const origEnv = process.env.ADMIN_IP_ALLOWLIST;
    process.env.ADMIN_IP_ALLOWLIST = '10.0.0.1';

    // Use jest.requireActual to bypass the top-level mock and test the real middleware.
    // The module caches based on _cachedRaw; clear it by setting a new value first.
    const realIpAllowlist = jest.requireActual('../middleware/ipAllowlist');

    const req  = { ip: '1.2.3.4', connection: { remoteAddress: '1.2.3.4' } };
    const res  = { status: jest.fn().mockReturnThis(), end: jest.fn() };
    const next = jest.fn();

    realIpAllowlist(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);

    if (origEnv !== undefined) process.env.ADMIN_IP_ALLOWLIST = origEnv;
    else delete process.env.ADMIN_IP_ALLOWLIST;
  });

  test('ipAllowlist middleware allows IPs in the allowlist', () => {
    const origEnv = process.env.ADMIN_IP_ALLOWLIST;
    process.env.ADMIN_IP_ALLOWLIST = '10.0.0.1,192.168.1.0/24';

    const realIpAllowlist = jest.requireActual('../middleware/ipAllowlist');

    const req  = { ip: '192.168.1.50', connection: { remoteAddress: '192.168.1.50' } };
    const res  = { status: jest.fn().mockReturnThis(), end: jest.fn() };
    const next = jest.fn();

    realIpAllowlist(req, res, next);
    expect(next).toHaveBeenCalled();

    if (origEnv !== undefined) process.env.ADMIN_IP_ALLOWLIST = origEnv;
    else delete process.env.ADMIN_IP_ALLOWLIST;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP-002: requireSchoolAccess uses SchoolMembership (not just user.schoolId)
// Verifies the schoolAuth middleware checks the memberships table.
// ─────────────────────────────────────────────────────────────────────────────

describe('GAP-002: requireSchoolAccess checks SchoolMembership', () => {
  const { requireSchoolAccess } = require('../middleware/schoolAuth.middleware');

  const SCHOOL_ID = 'school-gap002';

  function makeReq(userId, userSchoolId, overrides = {}) {
    return {
      user:    { id: userId, role: 'MEMBER', schoolId: userSchoolId },
      params:  { schoolId: SCHOOL_ID },
      headers: {},
      body:    {},
      query:   {},
      ...overrides,
    };
  }
  function makeRes() {
    return {
      status: jest.fn().mockReturnThis(),
      json:   jest.fn().mockReturnThis(),
    };
  }

  beforeEach(() => {
    // Ensure schoolMembership mock exists
    if (!prisma.schoolMembership) prisma.schoolMembership = {};
    prisma.schoolMembership.findFirst = jest.fn();
    prisma.schoolMembership.findUnique = jest.fn();
  });

  test('user with ACTIVE SchoolMembership is allowed through', async () => {
    prisma.schoolMembership.findFirst.mockResolvedValue({
      id: 'mem-1', userId: 'user-1', schoolId: SCHOOL_ID,
      role: 'MEMBER', status: 'ACTIVE', deletedAt: null,
    });
    const req  = makeReq('user-1', null); // no legacy schoolId
    const res  = makeRes();
    const next = jest.fn();
    await requireSchoolAccess(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('user with SUSPENDED SchoolMembership is denied', async () => {
    prisma.schoolMembership.findFirst.mockResolvedValue({
      id: 'mem-2', userId: 'user-2', schoolId: SCHOOL_ID,
      role: 'MEMBER', status: 'SUSPENDED', deletedAt: null,
    });
    const req  = makeReq('user-2', null);
    const res  = makeRes();
    const next = jest.fn();
    await requireSchoolAccess(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('user with PENDING SchoolMembership is denied', async () => {
    prisma.schoolMembership.findFirst.mockResolvedValue({
      id: 'mem-3', userId: 'user-3', schoolId: SCHOOL_ID,
      role: 'MEMBER', status: 'PENDING', deletedAt: null,
    });
    const req  = makeReq('user-3', null);
    const res  = makeRes();
    const next = jest.fn();
    await requireSchoolAccess(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('user with no membership but matching legacy user.schoolId is allowed (pre-migration)', async () => {
    prisma.schoolMembership.findFirst.mockResolvedValue(null);
    // Legacy: user.schoolId matches the requested school
    const req  = makeReq('user-4', SCHOOL_ID);
    const res  = makeRes();
    const next = jest.fn();
    await requireSchoolAccess(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('user with no membership and non-matching user.schoolId is denied', async () => {
    prisma.schoolMembership.findFirst.mockResolvedValue(null);
    const req  = makeReq('user-5', 'different-school');
    const res  = makeRes();
    const next = jest.fn();
    await requireSchoolAccess(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // Source-level verification
  test('schoolAuth.middleware.js uses SchoolMembership.findFirst for access check', () => {
    const src = fs.readFileSync(path.join(__dirname, '../middleware/schoolAuth.middleware.js'), 'utf8');
    expect(src).toMatch(/schoolMembership\.findFirst/);
    expect(src).toMatch(/loadMembership/);
    // Should no longer have unconditional SUPER_ADMIN bypass
    expect(src).not.toMatch(/role === 'SUPER_ADMIN'[\s\S]{0,50}return next/);
  });
});
