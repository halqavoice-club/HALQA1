'use strict';
/**
 * P3 Security Fix Regression Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * P3-001: Analytics endpoints scoped — users cannot read/write other users'
 *         stats; school members cannot read/write other schools' stats.
 * P3-002: updateLiveClass raw SQL column names come from an allowlist (verified).
 * P3-003: listLiveClasses raw SQL WHERE clause uses only hardcoded literals and
 *         parameterized placeholders (verified).
 *
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
jest.mock('../utils/jwt',   () => ({ verifyAccessToken: jest.fn() }));
jest.mock('../middleware/ipAllowlist', () => (req, res, next) => next());
jest.mock('../sockets',     () => ({ getIo: jest.fn(() => null) }));
jest.mock('../controllers/auth.controller', () => ({
  deleteGetMeCache: jest.fn().mockResolvedValue(undefined),
  getMe: jest.fn(),
}));
jest.mock('../utils/storage', () => ({
  saveFile:   jest.fn().mockResolvedValue({ url: '/uploads/test.jpg' }),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/feedLive', () => ({
  broadcastLiveStart:  jest.fn(),
  broadcastLiveEnd:    jest.fn(),
  broadcastLiveUpdate: jest.fn(),
}));
jest.mock('../services/queue.service', () => ({
  queueBulkNotifications: jest.fn().mockResolvedValue(undefined),
  scheduleRoomReminder:   jest.fn().mockResolvedValue(undefined),
  cancelRoomReminder:     jest.fn().mockResolvedValue(undefined),
}));

const request      = require('supertest');
const express      = require('express');
const cookieParser = require('cookie-parser');
const prisma       = require('../utils/prisma');
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
  // Ensure schoolMembership stubs exist (needed by user.routes.js for DELETE /users/me)
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  ['findUnique', 'findFirst', 'update', 'create', 'count'].forEach(m => {
    if (typeof prisma.schoolMembership[m] !== 'function') {
      prisma.schoolMembership[m] = jest.fn();
    }
  });
  prisma.schoolMembership.findUnique.mockResolvedValue(null);
  prisma.schoolMembership.findFirst.mockResolvedValue(null);
  // school.findFirst — needed for admin guard in DELETE /users/me
  prisma.school.findFirst.mockResolvedValue(null);
});

// ─────────────────────────────────────────────────────────────────────────────
// P3-001: Analytics endpoint authorization
// ─────────────────────────────────────────────────────────────────────────────

describe('P3-001: Analytics endpoint authorization', () => {
  let analyticsApp;

  beforeAll(() => {
    analyticsApp = express();
    analyticsApp.use(express.json());
    analyticsApp.use(cookieParser());
    analyticsApp.use('/api/v1/analytics', require('../routes/analytics.routes'));
    analyticsApp.use((err, req, res, _next) => {
      res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
    });
  });

  // ── User stats ─────────────────────────────────────────────────────────────

  test('User can GET their own daily stats', async () => {
    asUser('user-a', 'MEMBER', 'ACTIVE', 'school-x');
    prisma.dailyUserStats = { findMany: jest.fn().mockResolvedValue([]) };

    const res = await request(analyticsApp)
      .get('/api/v1/analytics/users/user-a/daily-stats')
      .set('Authorization', tok('user-a'));
    expect(res.status).toBe(200);
  });

  test('User gets 403 trying to GET another user\'s daily stats', async () => {
    asUser('user-a', 'MEMBER', 'ACTIVE', 'school-x');

    const res = await request(analyticsApp)
      .get('/api/v1/analytics/users/user-b/daily-stats')
      .set('Authorization', tok('user-a'));
    expect(res.status).toBe(403);
  });

  test('User can GET their own analytics', async () => {
    asUser('user-a', 'MEMBER', 'ACTIVE', 'school-x');
    prisma.dailyUserStats = { findMany: jest.fn().mockResolvedValue([]) };

    const res = await request(analyticsApp)
      .get('/api/v1/analytics/users/user-a/analytics')
      .set('Authorization', tok('user-a'));
    expect(res.status).toBe(200);
  });

  test('User gets 403 trying to GET another user\'s analytics', async () => {
    asUser('user-a', 'MEMBER', 'ACTIVE', 'school-x');

    const res = await request(analyticsApp)
      .get('/api/v1/analytics/users/user-b/analytics')
      .set('Authorization', tok('user-a'));
    expect(res.status).toBe(403);
  });

  test('User gets 403 trying to PUT another user\'s daily stats', async () => {
    asUser('user-a', 'MEMBER', 'ACTIVE', 'school-x');

    const res = await request(analyticsApp)
      .put('/api/v1/analytics/users/user-b/daily-stats/2026-01-01')
      .set('Authorization', tok('user-a'))
      .send({ loginCount: 5 });
    expect(res.status).toBe(403);
  });

  test('SUPER_ADMIN can GET any user\'s daily stats', async () => {
    asUser('sa-user', 'SUPER_ADMIN', 'ACTIVE', null);
    prisma.dailyUserStats = { findMany: jest.fn().mockResolvedValue([]) };

    const res = await request(analyticsApp)
      .get('/api/v1/analytics/users/user-b/daily-stats')
      .set('Authorization', tok('sa-user'));
    expect(res.status).toBe(200);
  });

  test('Unauthenticated request returns 401', async () => {
    const res = await request(analyticsApp)
      .get('/api/v1/analytics/users/user-a/daily-stats');
    expect(res.status).toBe(401);
  });

  // ── School stats ────────────────────────────────────────────────────────────

  test('School member can GET their own school\'s stats', async () => {
    asUser('user-a', 'MEMBER', 'ACTIVE', 'school-x');
    prisma.dailySchoolStats = { findMany: jest.fn().mockResolvedValue([]) };

    const res = await request(analyticsApp)
      .get('/api/v1/analytics/schools/school-x/daily-stats')
      .set('Authorization', tok('user-a'));
    expect(res.status).toBe(200);
  });

  test('School member gets 403 trying to GET another school\'s stats', async () => {
    asUser('user-a', 'MEMBER', 'ACTIVE', 'school-x');

    const res = await request(analyticsApp)
      .get('/api/v1/analytics/schools/school-y/daily-stats')
      .set('Authorization', tok('user-a'));
    expect(res.status).toBe(403);
  });

  test('School member gets 403 trying to GET another school\'s analytics', async () => {
    asUser('user-a', 'MEMBER', 'ACTIVE', 'school-x');

    const res = await request(analyticsApp)
      .get('/api/v1/analytics/schools/school-y/analytics')
      .set('Authorization', tok('user-a'));
    expect(res.status).toBe(403);
  });

  test('MEMBER gets 403 trying to PUT school stats (write requires SCHOOL_ADMIN)', async () => {
    asUser('user-a', 'MEMBER', 'ACTIVE', 'school-x');

    const res = await request(analyticsApp)
      .put('/api/v1/analytics/schools/school-x/daily-stats/2026-01-01')
      .set('Authorization', tok('user-a'))
      .send({ studentCount: 100 });
    expect(res.status).toBe(403);
  });

  test('SUPER_ADMIN can GET any school\'s stats', async () => {
    asUser('sa-user', 'SUPER_ADMIN', 'ACTIVE', null);
    prisma.dailySchoolStats = { findMany: jest.fn().mockResolvedValue([]) };

    const res = await request(analyticsApp)
      .get('/api/v1/analytics/schools/school-y/daily-stats')
      .set('Authorization', tok('sa-user'));
    expect(res.status).toBe(200);
  });

  test('SUPER_ADMIN can GET any school\'s analytics', async () => {
    asUser('sa-user', 'SUPER_ADMIN', 'ACTIVE', null);
    prisma.dailySchoolStats = { findMany: jest.fn().mockResolvedValue([]) };

    const res = await request(analyticsApp)
      .get('/api/v1/analytics/schools/school-y/analytics')
      .set('Authorization', tok('sa-user'));
    expect(res.status).toBe(200);
  });

  // Source verification
  test('analytics.controller.js defines assertSchoolStatsAccess and assertUserStatsAccess', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/analytics.controller.js'), 'utf8'
    );
    expect(src).toMatch(/assertSchoolStatsAccess/);
    expect(src).toMatch(/assertUserStatsAccess/);
    expect(src).toMatch(/assertSchoolStatsWriteAccess/);
    // All functions must call the guards
    expect(src).toMatch(/getDailySchoolStats[\s\S]{0,300}assertSchoolStatsAccess/);
    expect(src).toMatch(/getDailyUserStats[\s\S]{0,300}assertUserStatsAccess/);
  });

  test('analytics.routes.js has authenticate middleware', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../routes/analytics.routes.js'), 'utf8'
    );
    expect(src).toMatch(/router\.use\(authenticate\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P3-002: updateLiveClass raw SQL uses column allowlist (source verification)
// ─────────────────────────────────────────────────────────────────────────────

describe('P3-002: updateLiveClass raw SQL column allowlist', () => {
  test('live-class.controller.js updateLiveClass uses column allowlist before raw SQL', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/live-class.controller.js'), 'utf8'
    );
    // The allowed array must be present
    expect(src).toMatch(/const allowed = \[/);
    // The allowed list must include known columns, not arbitrary ones
    expect(src).toMatch(/'title'/);
    expect(src).toMatch(/'description'/);
    expect(src).toMatch(/'duration'/);
    // The raw SQL uses ${k} only from Object.entries(data) where data is built from allowed
    expect(src).toMatch(/allowed\.forEach/);
    // P3-002 comment must be present confirming the verification
    expect(src).toMatch(/P3-002 VERIFIED/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P3-003: listLiveClasses WHERE clause uses hardcoded literals + parameterized ?
// ─────────────────────────────────────────────────────────────────────────────

describe('P3-003: listLiveClasses conditions array uses safe parameterization', () => {
  test('live-class.controller.js listLiveClasses uses parameterized conditions', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/live-class.controller.js'), 'utf8'
    );
    // P3-003 comment must be present
    expect(src).toMatch(/P3-003 VERIFIED/);
    // Dynamic values pushed to params array, not interpolated into the SQL string
    expect(src).toMatch(/params\.push\(schoolId\)/);
    expect(src).toMatch(/params\.push\(classId\)/);
    expect(src).toMatch(/params\.push\(status\)/);
    // The WHERE clause uses the joined conditions array (hardcoded literals)
    expect(src).toMatch(/conditions\.join/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P4-001: DELETE /users/me blocked when wallet has non-zero balance
// ─────────────────────────────────────────────────────────────────────────────

describe('P4-001: Wallet balance check on account deletion', () => {
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

  const USER_ID = 'wallet-test-user';

  async function setupUser(passwordHash, walletCoins, walletDiamonds) {
    asUser(USER_ID, 'MEMBER', 'ACTIVE', null);
    prisma.user.findUnique.mockResolvedValue({
      id: USER_ID, role: 'MEMBER', status: 'ACTIVE', schoolId: null,
      firstName: 'Test', lastName: 'User', avatarUrl: null, deletedAt: null,
      email: 'test@example.com',
      passwordHash: passwordHash || null,
    });
    prisma.schoolMembership.findFirst.mockResolvedValue(null);
    prisma.wallet.findUnique.mockResolvedValue(
      walletCoins !== undefined || walletDiamonds !== undefined
        ? { coins: walletCoins ?? 0, diamonds: walletDiamonds ?? 0 }
        : null
    );
  }

  test('User with non-zero coins cannot delete account (400)', async () => {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('correct-password', 1);
    await setupUser(hash, 50, 0);

    const res = await request(userApp)
      .delete('/api/v1/users/me')
      .set('Authorization', tok(USER_ID))
      .send({ password: 'correct-password' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/wallet|balance|coin/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('User with non-zero diamonds cannot delete account (400)', async () => {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('correct-password', 1);
    await setupUser(hash, 0, 100);

    const res = await request(userApp)
      .delete('/api/v1/users/me')
      .set('Authorization', tok(USER_ID))
      .send({ password: 'correct-password' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/wallet|balance|diamond/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('User with both coins and diamonds cannot delete account (400)', async () => {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('correct-password', 1);
    await setupUser(hash, 25, 75);

    const res = await request(userApp)
      .delete('/api/v1/users/me')
      .set('Authorization', tok(USER_ID))
      .send({ password: 'correct-password' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/wallet|balance/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('User with zero-balance wallet can proceed to deletion', async () => {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('correct-password', 1);
    await setupUser(hash, 0, 0);
    prisma.$transaction.mockResolvedValue([{ id: USER_ID }]);
    prisma.follow.deleteMany.mockResolvedValue({ count: 0 });
    prisma.communityMember.deleteMany.mockResolvedValue({ count: 0 });
    if (!prisma.friendRequest) prisma.friendRequest = { deleteMany: jest.fn() };
    prisma.friendRequest.deleteMany.mockResolvedValue({ count: 0 });
    prisma.voiceParticipant.updateMany.mockResolvedValue({ count: 0 });
    prisma.liveClassParticipant.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(userApp)
      .delete('/api/v1/users/me')
      .set('Authorization', tok(USER_ID))
      .send({ password: 'correct-password' });

    expect(res.status).toBe(200);
  });

  test('User with no wallet record can proceed to deletion', async () => {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('correct-password', 1);
    await setupUser(hash, undefined, undefined); // wallet is null
    prisma.$transaction.mockResolvedValue([{ id: USER_ID }]);
    prisma.follow.deleteMany.mockResolvedValue({ count: 0 });
    prisma.communityMember.deleteMany.mockResolvedValue({ count: 0 });
    if (!prisma.friendRequest) prisma.friendRequest = { deleteMany: jest.fn() };
    prisma.friendRequest.deleteMany.mockResolvedValue({ count: 0 });
    prisma.voiceParticipant.updateMany.mockResolvedValue({ count: 0 });
    prisma.liveClassParticipant.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(userApp)
      .delete('/api/v1/users/me')
      .set('Authorization', tok(USER_ID))
      .send({ password: 'correct-password' });

    expect(res.status).toBe(200);
  });

  // Source verification
  test('user.routes.js has wallet balance check before deletion', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../routes/user.routes.js'), 'utf8'
    );
    expect(src).toMatch(/P4-001/);
    expect(src).toMatch(/wallet\.coins > 0/);
    expect(src).toMatch(/wallet\.diamonds > 0/);
    expect(src).toMatch(/spend or withdraw/i);
  });
});




describe('P0/P1/P2 regression checks', () => {
  test('backup.routes.js still has authorize("SUPER_ADMIN")', () => {
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

  test('voice.controller.js has privacy guard for PRIVATE/INVITE_ONLY rooms', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/voice.controller.js'), 'utf8');
    expect(src).toMatch(/You do not have access to this room/);
  });

  test('user.routes.js has null passwordHash guard for OAuth deletion', () => {
    const src = fs.readFileSync(path.join(__dirname, '../routes/user.routes.js'), 'utf8');
    expect(src).toMatch(/!user\.passwordHash/);
    expect(src).toMatch(/Google Sign-In/);
  });

  test('admin-stats.routes.js uses priceCoins, not coinCost', () => {
    const src = fs.readFileSync(path.join(__dirname, '../routes/admin-stats.routes.js'), 'utf8');
    expect(src).not.toMatch(/coinCost/);
    expect(src).toMatch(/priceCoins/);
  });
});
