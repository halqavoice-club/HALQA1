'use strict';
/**
 * P2 Security Fix Regression Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * SEC-HIGH-002: PRIVATE/INVITE_ONLY voice rooms enforce participant check on
 *               GET /voice/:id (getRoom) and GET /voice/:id/messages (getMessages)
 * SEC-MED-004:  DELETE /users/me does not crash when passwordHash is null (OAuth)
 * SEC-HIGH-004: GET /admin/stats/gifts uses correct field name (priceCoins)
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
jest.mock('../utils/jwt',    () => ({ verifyAccessToken: jest.fn() }));
jest.mock('../middleware/ipAllowlist', () => (req, res, next) => next());
jest.mock('../sockets',      () => ({ getIo: jest.fn(() => null) }));
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
  enqueue:                jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/voiceQueue', () => ({
  clearQueue:    jest.fn().mockResolvedValue(undefined),
  enqueue:       jest.fn().mockResolvedValue(undefined),
  getQueue:      jest.fn().mockResolvedValue([]),
  isInQueue:     jest.fn().mockResolvedValue(false),
  dequeue:       jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/autoPromote', () => ({
  autoPromoteNext: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/search', () => ({
  searchVoiceRooms: jest.fn().mockResolvedValue([]),
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

  // Ensure schoolMembership stubs exist
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  ['findUnique', 'findFirst', 'update', 'create', 'count'].forEach(m => {
    if (typeof prisma.schoolMembership[m] !== 'function') {
      prisma.schoolMembership[m] = jest.fn();
    }
  });
  prisma.schoolMembership.findUnique.mockResolvedValue(null);
  prisma.schoolMembership.findFirst.mockResolvedValue(null);
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-HIGH-002: Voice room privacy check — getRoom and getMessages
// ─────────────────────────────────────────────────────────────────────────────

describe('SEC-HIGH-002: Voice room privacy enforcement', () => {
  let voiceApp;

  beforeAll(() => {
    voiceApp = express();
    voiceApp.use(express.json());
    voiceApp.use(cookieParser());
    voiceApp.use('/api/v1/voice', require('../routes/voice.routes'));
    voiceApp.use((err, req, res, _next) => {
      res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
    });
  });

  const ROOM_ID   = 'room-privacy-test-id';
  const HOST_ID   = 'host-user-id';
  const MEMBER_ID = 'outside-user-id';
  const SA_ID     = 'super-admin-id';

  function makeRoom(privacy) {
    return {
      id: ROOM_ID, hostId: HOST_ID, privacy, status: 'LIVE',
      title: 'Test Room', deletedAt: null,
      host: { id: HOST_ID, firstName: 'Host', lastName: 'User', avatarUrl: null },
      participants: [],
      _count: { participants: 0 },
    };
  }

  // ── getRoom tests ───────────────────────────────────────────────────────

  test('PUBLIC room: non-participant can GET /voice/:id (200)', async () => {
    asUser(MEMBER_ID, 'MEMBER', 'ACTIVE', null);
    prisma.voiceRoom.findUnique.mockResolvedValue(makeRoom('PUBLIC'));

    const res = await request(voiceApp)
      .get(`/api/v1/voice/${ROOM_ID}`)
      .set('Authorization', tok(MEMBER_ID));
    expect(res.status).toBe(200);
  });

  test('PRIVATE room: host can always GET /voice/:id (200)', async () => {
    asUser(HOST_ID, 'MEMBER', 'ACTIVE', null);
    prisma.voiceRoom.findUnique.mockResolvedValue(makeRoom('PRIVATE'));
    // No participant lookup needed — host bypass

    const res = await request(voiceApp)
      .get(`/api/v1/voice/${ROOM_ID}`)
      .set('Authorization', tok(HOST_ID));
    expect(res.status).toBe(200);
  });

  test('PRIVATE room: active participant can GET /voice/:id (200)', async () => {
    asUser(MEMBER_ID, 'MEMBER', 'ACTIVE', null);
    prisma.voiceRoom.findUnique.mockResolvedValue(makeRoom('PRIVATE'));
    prisma.voiceParticipant.findUnique.mockResolvedValue({ isActive: true });

    const res = await request(voiceApp)
      .get(`/api/v1/voice/${ROOM_ID}`)
      .set('Authorization', tok(MEMBER_ID));
    expect(res.status).toBe(200);
  });

  test('PRIVATE room: non-participant gets 403 on GET /voice/:id', async () => {
    asUser(MEMBER_ID, 'MEMBER', 'ACTIVE', null);
    prisma.voiceRoom.findUnique.mockResolvedValue(makeRoom('PRIVATE'));
    prisma.voiceParticipant.findUnique.mockResolvedValue(null);

    const res = await request(voiceApp)
      .get(`/api/v1/voice/${ROOM_ID}`)
      .set('Authorization', tok(MEMBER_ID));
    expect(res.status).toBe(403);
  });

  test('INVITE_ONLY room: non-participant gets 403 on GET /voice/:id', async () => {
    asUser(MEMBER_ID, 'MEMBER', 'ACTIVE', null);
    prisma.voiceRoom.findUnique.mockResolvedValue(makeRoom('INVITE_ONLY'));
    prisma.voiceParticipant.findUnique.mockResolvedValue(null);

    const res = await request(voiceApp)
      .get(`/api/v1/voice/${ROOM_ID}`)
      .set('Authorization', tok(MEMBER_ID));
    expect(res.status).toBe(403);
  });

  test('PRIVATE room: inactive (kicked) participant gets 403 on GET /voice/:id', async () => {
    asUser(MEMBER_ID, 'MEMBER', 'ACTIVE', null);
    prisma.voiceRoom.findUnique.mockResolvedValue(makeRoom('PRIVATE'));
    prisma.voiceParticipant.findUnique.mockResolvedValue({ isActive: false });

    const res = await request(voiceApp)
      .get(`/api/v1/voice/${ROOM_ID}`)
      .set('Authorization', tok(MEMBER_ID));
    expect(res.status).toBe(403);
  });

  test('PRIVATE room: SUPER_ADMIN bypasses participant check on GET /voice/:id', async () => {
    asUser(SA_ID, 'SUPER_ADMIN', 'ACTIVE', null);
    prisma.voiceRoom.findUnique.mockResolvedValue(makeRoom('PRIVATE'));
    // SUPER_ADMIN should NOT call voiceParticipant.findUnique

    const res = await request(voiceApp)
      .get(`/api/v1/voice/${ROOM_ID}`)
      .set('Authorization', tok(SA_ID));
    expect(res.status).toBe(200);
    expect(prisma.voiceParticipant.findUnique).not.toHaveBeenCalled();
  });

  test('Non-existent room returns 404', async () => {
    asUser(MEMBER_ID, 'MEMBER', 'ACTIVE', null);
    prisma.voiceRoom.findUnique.mockResolvedValue(null);

    const res = await request(voiceApp)
      .get(`/api/v1/voice/${ROOM_ID}`)
      .set('Authorization', tok(MEMBER_ID));
    expect(res.status).toBe(404);
  });

  // ── getMessages tests ───────────────────────────────────────────────────

  test('PUBLIC room: non-participant can GET /voice/:id/messages (200)', async () => {
    asUser(MEMBER_ID, 'MEMBER', 'ACTIVE', null);
    prisma.voiceRoom.findUnique.mockResolvedValue({ privacy: 'PUBLIC', hostId: HOST_ID });
    prisma.voiceMessage.findMany.mockResolvedValue([]);

    const res = await request(voiceApp)
      .get(`/api/v1/voice/${ROOM_ID}/messages`)
      .set('Authorization', tok(MEMBER_ID));
    expect(res.status).toBe(200);
  });

  test('PRIVATE room: non-participant gets 403 on GET /voice/:id/messages', async () => {
    asUser(MEMBER_ID, 'MEMBER', 'ACTIVE', null);
    prisma.voiceRoom.findUnique.mockResolvedValue({ privacy: 'PRIVATE', hostId: HOST_ID });
    prisma.voiceParticipant.findUnique.mockResolvedValue(null);

    const res = await request(voiceApp)
      .get(`/api/v1/voice/${ROOM_ID}/messages`)
      .set('Authorization', tok(MEMBER_ID));
    expect(res.status).toBe(403);
    expect(prisma.voiceMessage.findMany).not.toHaveBeenCalled();
  });

  test('INVITE_ONLY room: non-participant gets 403 on GET /voice/:id/messages', async () => {
    asUser(MEMBER_ID, 'MEMBER', 'ACTIVE', null);
    prisma.voiceRoom.findUnique.mockResolvedValue({ privacy: 'INVITE_ONLY', hostId: HOST_ID });
    prisma.voiceParticipant.findUnique.mockResolvedValue(null);

    const res = await request(voiceApp)
      .get(`/api/v1/voice/${ROOM_ID}/messages`)
      .set('Authorization', tok(MEMBER_ID));
    expect(res.status).toBe(403);
    expect(prisma.voiceMessage.findMany).not.toHaveBeenCalled();
  });

  test('PRIVATE room: active participant can GET /voice/:id/messages (200)', async () => {
    asUser(MEMBER_ID, 'MEMBER', 'ACTIVE', null);
    prisma.voiceRoom.findUnique.mockResolvedValue({ privacy: 'PRIVATE', hostId: HOST_ID });
    prisma.voiceParticipant.findUnique.mockResolvedValue({ isActive: true });
    prisma.voiceMessage.findMany.mockResolvedValue([]);

    const res = await request(voiceApp)
      .get(`/api/v1/voice/${ROOM_ID}/messages`)
      .set('Authorization', tok(MEMBER_ID));
    expect(res.status).toBe(200);
  });

  test('PRIVATE room: SUPER_ADMIN can GET /voice/:id/messages (200)', async () => {
    asUser(SA_ID, 'SUPER_ADMIN', 'ACTIVE', null);
    prisma.voiceRoom.findUnique.mockResolvedValue({ privacy: 'PRIVATE', hostId: HOST_ID });
    prisma.voiceMessage.findMany.mockResolvedValue([]);

    const res = await request(voiceApp)
      .get(`/api/v1/voice/${ROOM_ID}/messages`)
      .set('Authorization', tok(SA_ID));
    expect(res.status).toBe(200);
    expect(prisma.voiceParticipant.findUnique).not.toHaveBeenCalled();
  });

  // Source-level verification
  test('voice.controller.js getRoom has privacy check', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
    );
    expect(src).toMatch(/room\.privacy === 'PRIVATE' \|\| room\.privacy === 'INVITE_ONLY'/);
    expect(src).toMatch(/You do not have access to this room/);
  });

  test('voice.controller.js getMessages has privacy check', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
    );
    // getMessages must also contain the privacy guard
    const getMessagesIdx = src.indexOf('async function getMessages');
    const snippet = src.slice(getMessagesIdx, getMessagesIdx + 1200);
    expect(snippet).toMatch(/PRIVATE.*INVITE_ONLY|INVITE_ONLY.*PRIVATE/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-MED-004: DELETE /users/me — OAuth null passwordHash crash
// ─────────────────────────────────────────────────────────────────────────────

describe('SEC-MED-004: OAuth account deletion null passwordHash', () => {
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

  const OAUTH_USER_ID = 'oauth-user-uuid';

  test('OAuth user (null passwordHash) gets 400, not 500', async () => {
    asUser(OAUTH_USER_ID, 'MEMBER', 'ACTIVE', null);
    // OAuth user has no password
    prisma.user.findUnique.mockResolvedValue({
      id: OAUTH_USER_ID,
      role: 'MEMBER',
      status: 'ACTIVE',
      schoolId: null,
      firstName: 'Google',
      lastName: 'User',
      avatarUrl: null,
      deletedAt: null,
      email: 'oauth@gmail.com',
      passwordHash: null,   // OAuth — no password set
    });

    const res = await request(userApp)
      .delete('/api/v1/users/me')
      .set('Authorization', tok(OAUTH_USER_ID))
      .send({ password: 'anything' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Google Sign-In|contact support/i);
    // Database was never mutated
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('Normal user with wrong password still gets 400 (not 500)', async () => {
    asUser('normal-user', 'MEMBER', 'ACTIVE', null);
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('correct-password', 1);
    prisma.user.findUnique.mockResolvedValue({
      id: 'normal-user',
      role: 'MEMBER',
      status: 'ACTIVE',
      schoolId: null,
      firstName: 'Normal',
      lastName: 'User',
      avatarUrl: null,
      deletedAt: null,
      email: 'normal@example.com',
      passwordHash: hash,
    });
    // schoolMembership check — not an admin
    prisma.schoolMembership.findFirst.mockResolvedValue(null);

    const res = await request(userApp)
      .delete('/api/v1/users/me')
      .set('Authorization', tok('normal-user'))
      .send({ password: 'wrong-password' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Incorrect password/i);
  });

  test('Normal user with correct password proceeds to deletion (200)', async () => {
    asUser('normal-user-2', 'MEMBER', 'ACTIVE', null);
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('correct-password', 1);
    prisma.user.findUnique.mockResolvedValue({
      id: 'normal-user-2',
      role: 'MEMBER',
      status: 'ACTIVE',
      schoolId: null,
      firstName: 'Normal',
      lastName: 'User',
      avatarUrl: null,
      deletedAt: null,
      email: 'normal2@example.com',
      passwordHash: hash,
    });
    prisma.schoolMembership.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockResolvedValue([{ id: 'normal-user-2' }]);
    // allSettled calls — guard against models absent from the shared mock
    prisma.follow.deleteMany.mockResolvedValue({ count: 0 });
    prisma.communityMember.deleteMany.mockResolvedValue({ count: 0 });
    if (!prisma.friendRequest) prisma.friendRequest = { deleteMany: jest.fn() };
    if (!prisma.friendRequest.deleteMany) prisma.friendRequest.deleteMany = jest.fn();
    prisma.friendRequest.deleteMany.mockResolvedValue({ count: 0 });
    prisma.voiceParticipant.updateMany.mockResolvedValue({ count: 0 });
    prisma.liveClassParticipant.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(userApp)
      .delete('/api/v1/users/me')
      .set('Authorization', tok('normal-user-2'))
      .send({ password: 'correct-password' });

    expect(res.status).toBe(200);
  });

  test('No password in body returns 400', async () => {
    asUser('no-pass-user', 'MEMBER', 'ACTIVE', null);

    const res = await request(userApp)
      .delete('/api/v1/users/me')
      .set('Authorization', tok('no-pass-user'))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Password confirmation required/i);
  });

  // Source-level verification
  test('user.routes.js has null passwordHash guard before bcrypt.compare', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../routes/user.routes.js'), 'utf8'
    );
    expect(src).toMatch(/!user\.passwordHash/);
    expect(src).toMatch(/Google Sign-In/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-HIGH-004: GET /admin/stats/gifts — correct field name priceCoins
// ─────────────────────────────────────────────────────────────────────────────

describe('SEC-HIGH-004: Admin stats gifts — priceCoins field name', () => {
  let adminApp;

  beforeAll(() => {
    adminApp = express();
    adminApp.use(express.json());
    adminApp.use(cookieParser());
    adminApp.use('/api/v1/admin/stats', require('../routes/admin-stats.routes'));
    adminApp.use((err, req, res, _next) => {
      res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
    });
  });

  function setupSuperAdmin() {
    asUser('sa-gifts', 'SUPER_ADMIN', 'ACTIVE', null);
  }

  beforeEach(() => {
    // Default stubs for the gifts endpoint
    prisma.giftTransaction.count.mockResolvedValue(0);
    prisma.giftTransaction.findMany.mockResolvedValue([]);
    prisma.gift.count.mockResolvedValue(0);
    prisma.gift.findMany.mockResolvedValue([
      { id: 'g1', name: 'Star', priceCoins: 10, emoji: '⭐' },
      { id: 'g2', name: 'Heart', priceCoins: 50, emoji: '❤️' },
    ]);
  });

  test('SUPER_ADMIN can GET /admin/stats/gifts (200)', async () => {
    setupSuperAdmin();
    const res = await request(adminApp)
      .get('/api/v1/admin/stats/gifts')
      .set('Authorization', tok('sa-gifts'));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('GET /gifts response contains catalog array', async () => {
    setupSuperAdmin();
    const res = await request(adminApp)
      .get('/api/v1/admin/stats/gifts')
      .set('Authorization', tok('sa-gifts'));
    expect(res.status).toBe(200);
    expect(res.body.data.catalog).toBeDefined();
    expect(Array.isArray(res.body.data.catalog)).toBe(true);
  });

  test('GET /gifts — gift.findMany called with priceCoins orderBy (not coinCost)', async () => {
    setupSuperAdmin();
    await request(adminApp)
      .get('/api/v1/admin/stats/gifts')
      .set('Authorization', tok('sa-gifts'));

    const findManyCalls = prisma.gift.findMany.mock.calls;
    expect(findManyCalls.length).toBeGreaterThan(0);
    const callArg = findManyCalls[0][0];
    // Must use priceCoins, not coinCost
    expect(callArg.orderBy).toEqual({ priceCoins: 'asc' });
    expect(callArg.orderBy).not.toEqual(expect.objectContaining({ coinCost: expect.anything() }));
  });

  test('GET /gifts — recentTransactions gift select uses priceCoins (not coinCost)', async () => {
    setupSuperAdmin();
    // Mock a transaction with the gift included
    prisma.giftTransaction.findMany.mockResolvedValue([
      {
        id: 'tx1', createdAt: new Date(),
        sender:   { id: 'u1', firstName: 'Alice', lastName: 'A' },
        receiver: { id: 'u2', firstName: 'Bob',   lastName: 'B' },
        gift:     { id: 'g1', name: 'Star', priceCoins: 10 },
      }
    ]);

    const res = await request(adminApp)
      .get('/api/v1/admin/stats/gifts')
      .set('Authorization', tok('sa-gifts'));

    expect(res.status).toBe(200);

    // Verify the include select passed to giftTransaction.findMany uses priceCoins
    const txCalls = prisma.giftTransaction.findMany.mock.calls;
    expect(txCalls.length).toBeGreaterThan(0);
    const txCallArg = txCalls[0][0];
    if (txCallArg && txCallArg.include && txCallArg.include.gift) {
      const giftSelect = txCallArg.include.gift.select;
      expect(giftSelect.priceCoins).toBe(true);
      expect(giftSelect.coinCost).toBeUndefined();
    }
  });

  test('Non-SUPER_ADMIN gets 403 on GET /admin/stats/gifts', async () => {
    asUser('school-admin', 'SCHOOL_ADMIN', 'ACTIVE', 'school-1');
    const res = await request(adminApp)
      .get('/api/v1/admin/stats/gifts')
      .set('Authorization', tok('school-admin'));
    expect(res.status).toBe(403);
  });

  test('Unauthenticated gets 401 on GET /admin/stats/gifts', async () => {
    const res = await request(adminApp).get('/api/v1/admin/stats/gifts');
    expect(res.status).toBe(401);
  });

  // Source-level verification
  test('admin-stats.routes.js uses priceCoins, not coinCost', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../routes/admin-stats.routes.js'), 'utf8'
    );
    expect(src).not.toMatch(/coinCost/);
    expect(src).toMatch(/priceCoins/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0 + P1 regression: previously fixed findings still hold
// ─────────────────────────────────────────────────────────────────────────────

describe('P0/P1 regression checks', () => {
  test('backup.routes.js still has authorize("SUPER_ADMIN")', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../routes/backup.routes.js'), 'utf8'
    );
    expect(src).toMatch(/authorize\s*\(\s*['"]SUPER_ADMIN['"]\s*\)/);
  });

  test('livekit.controller.js still checks voice room participant', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/livekit.controller.js'), 'utf8'
    );
    expect(src).toMatch(/not an active participant in this voice room/);
  });

  test('user.routes.js still defines PUBLIC_PROFILE_SELECT without email', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../routes/user.routes.js'), 'utf8'
    );
    expect(src).toMatch(/PUBLIC_PROFILE_SELECT/);
    const match = src.match(/const PUBLIC_PROFILE_SELECT\s*=\s*\{([^}]+)\}/);
    if (match) {
      expect(match[1]).not.toMatch(/\bemail\b/);
      expect(match[1]).not.toMatch(/\bphone\b/);
    }
  });

  test('user.routes.js still has VALID_USER_STATUSES with all 5 values', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../routes/user.routes.js'), 'utf8'
    );
    expect(src).toMatch(/VALID_USER_STATUSES/);
    ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING', 'BANNED'].forEach(s => {
      expect(src).toMatch(new RegExp(`'${s}'`));
    });
  });

  test('schoolMembership.routes.js still checks callerMembership.status === ACTIVE', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../routes/schoolMembership.routes.js'), 'utf8'
    );
    expect(src).toMatch(/callerMembership\.status\s*===\s*'ACTIVE'/);
  });

  test('app.js /metrics no longer allows open fallback', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../app.js'), 'utf8'
    );
    expect(src).not.toMatch(/allow freely/);
    expect(src).toMatch(/Unauthorized\. Set METRICS_TOKEN/);
  });
});
