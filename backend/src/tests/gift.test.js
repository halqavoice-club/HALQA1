'use strict';
/**
 * Gift Controller Unit Tests — TE-001 (Financial Critical)
 * Mocks all external deps. No real DB/Redis.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../utils/prisma');
jest.mock('../utils/redis', () => ({
  isRedisReady: jest.fn(() => false),
  getCache:     jest.fn().mockResolvedValue(null),
  setCache:     jest.fn().mockResolvedValue(true),
  deleteCache:  jest.fn().mockResolvedValue(true),
}));
jest.mock('../sockets', () => ({
  getIo: jest.fn(() => ({ to: jest.fn().mockReturnThis(), emit: jest.fn() })),
}));
jest.mock('../utils/roomResolver', () => ({
  resolveRoom:             jest.fn(),
  resolveParticipant:      jest.fn(),
  resolveActiveRecipients: jest.fn(),
}));
// Mock ESM-only packages that voice routes pull in
jest.mock('livekit-server-sdk', () => ({
  AccessToken: class {
    constructor() {}
    addGrant() {}
    async toJwt() { return 'mock.livekit.token'; }
  },
}));
// Mock authenticate so voice routes let requests through
jest.mock('../middleware/auth.middleware', () => ({
  authenticate:        (req, _res, next) => { req.user = { id: SENDER_ID, firstName: 'Ali', lastName: 'H', role: 'STUDENT' }; next(); },
  authorize:           (..._r) => (_q, _s, next) => next(),
  requireSchoolAccess: (_q, _s, next) => next(),
  optionalAuth:        (_q, _s, next) => next(),
  invalidateUserCache: jest.fn(),
  USER_SELECT: {},
  VOICE_ROLES: { HOST: 'HOST', MODERATOR: 'MODERATOR', SPEAKER: 'SPEAKER', AUDIENCE: 'AUDIENCE' },
}));

const prisma       = require('../utils/prisma');
const roomResolver = require('../utils/roomResolver');

// ─── Fixtures — valid UUID v4 values required by gift Zod validator ───────────
// The sendGift schema enforces z.string().uuid() on giftId and receiverId.
const SENDER_ID   = '11111111-1111-4111-a111-111111111111';
const RECEIVER_ID = '22222222-2222-4222-a222-222222222222';
const GIFT_ID     = '33333333-3333-4333-a333-333333333333';

const SENDER   = { id: SENDER_ID,   firstName: 'Ali',  lastName: 'H', avatarUrl: null };
const RECEIVER = { id: RECEIVER_ID, firstName: 'Sara', lastName: 'A', avatarUrl: null };

const GIFT = {
  id: GIFT_ID, name: 'Rose', emoji: '🌹',
  priceCoins: 20, rarity: 'common', animationType: 'overlay',
  soundEffect: null, comboEnabled: true, priority: 'normal',
  isPremium: false, isActive: true, sortOrder: 1,
};

const LIVE_ROOM  = { id: 'room-1', status: 'LIVE', title: 'Test Room' };
const SENDER_P   = { userId: SENDER_ID,   role: 'AUDIENCE', isActive: true, user: SENDER };
const RECEIVER_P = { userId: RECEIVER_ID, role: 'SPEAKER',  isActive: true, user: RECEIVER };

// ─── App builder ──────────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  // No manual req.user — authenticate mock injects it
  app.use('/api/v1/voice', require('../routes/voice.routes'));
  app.use('/api/v1/gifts', require('../routes/gift.routes'));
  app.use(require('../middleware/errorHandler'));
  return app;
}

// ─── Transaction mock that simulates successful debit/credit ──────────────────
function happyTransaction() {
  prisma.$transaction.mockImplementation(async (fn) => {
    if (typeof fn !== 'function') return Promise.all(fn);
    return fn({
      wallet: {
        upsert: jest.fn()
          .mockResolvedValueOnce({ coins: 500, diamonds: 0 })   // sender balance check
          .mockResolvedValueOnce({ coins: 0,   diamonds: 0 }),  // receiver upsert
        update: jest.fn().mockResolvedValue({ coins: 480, diamonds: 0 }),
      },
      giftTransaction: {
        create: jest.fn().mockResolvedValue({ id: 'txn-1', combo: 1 }),
        update: jest.fn().mockResolvedValue({ id: 'txn-1', combo: 2 }),
      },
      walletTransaction:   { create: jest.fn().mockResolvedValue({}) },
      roomGiftLeaderboard: { upsert: jest.fn().mockResolvedValue({}) },
      voiceRoomMember:     { updateMany: jest.fn().mockResolvedValue({}) },
    });
  });
}

// ─── LIST GIFTS ───────────────────────────────────────────────────────────────
// listGifts lives at GET /api/v1/gifts (gift.routes.js), not /voice/:id/gifts
describe('GET /api/v1/gifts', () => {
  let app;
  beforeEach(() => { jest.clearAllMocks(); app = buildApp(); });

  test('returns active gifts list', async () => {
    prisma.gift.findMany.mockResolvedValue([GIFT]);
    const res = await request(app).get('/api/v1/gifts');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(GIFT.id);
  });

  test('returns empty array when no gifts', async () => {
    prisma.gift.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/v1/gifts');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

// ─── SEND GIFT ────────────────────────────────────────────────────────────────
describe('POST /api/v1/voice/:id/gifts', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
    // Happy-path defaults
    roomResolver.resolveRoom.mockResolvedValue(LIVE_ROOM);
    roomResolver.resolveParticipant.mockImplementation((_t, _r, uid) =>
      uid === SENDER.id ? SENDER_P : RECEIVER_P
    );
    prisma.giftTransaction.findUnique.mockResolvedValue(null);
    prisma.giftTransaction.update.mockResolvedValue({ id: 'txn-1', combo: 1 });
    prisma.gift.findUnique.mockResolvedValue(GIFT);
    prisma.user.findUnique.mockResolvedValue(SENDER);
    happyTransaction();
  });

  test('returns 200 on valid gift send', async () => {
    const res = await request(app).post('/api/v1/voice/room-1/gifts')
      .send({ giftId: GIFT.id, receiverId: RECEIVER.id });
    expect(res.status).toBe(200);
    expect(res.body.data.diamondsEarned).toBe(10); // floor(20 * 0.5)
  });

  test('FINANCIAL: 3x count → 30 diamonds earned', async () => {
    const res = await request(app).post('/api/v1/voice/room-1/gifts')
      .send({ giftId: GIFT.id, receiverId: RECEIVER.id, count: 3 });
    expect(res.status).toBe(200);
    expect(res.body.data.diamondsEarned).toBe(30); // floor(60 * 0.5)
  });

  test('SECURITY: self-gift returns 400', async () => {
    const res = await request(app).post('/api/v1/voice/room-1/gifts')
      .send({ giftId: GIFT.id, receiverId: SENDER.id });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/yourself/i);
  });

  test('returns 404 when room not found', async () => {
    roomResolver.resolveRoom.mockResolvedValue(null);
    const res = await request(app).post('/api/v1/voice/room-1/gifts')
      .send({ giftId: GIFT.id, receiverId: RECEIVER.id });
    expect(res.status).toBe(404);
  });

  test('returns 400 for ended room', async () => {
    roomResolver.resolveRoom.mockResolvedValue({ ...LIVE_ROOM, status: 'ENDED' });
    const res = await request(app).post('/api/v1/voice/room-1/gifts')
      .send({ giftId: GIFT.id, receiverId: RECEIVER.id });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/ended/i);
  });

  test('returns 403 when sender not in room', async () => {
    roomResolver.resolveParticipant.mockResolvedValue(null);
    const res = await request(app).post('/api/v1/voice/room-1/gifts')
      .send({ giftId: GIFT.id, receiverId: RECEIVER.id });
    expect(res.status).toBe(403);
  });

  test('returns 400 when giftId missing', async () => {
    const res = await request(app).post('/api/v1/voice/room-1/gifts')
      .send({ receiverId: RECEIVER.id });
    expect(res.status).toBe(400);
  });

  test('returns 400 when receiverId missing', async () => {
    const res = await request(app).post('/api/v1/voice/room-1/gifts')
      .send({ giftId: GIFT.id });
    expect(res.status).toBe(400);
  });

  test('IDEMPOTENCY: duplicate idempotencyKey returns existing tx, no DB write', async () => {
    prisma.giftTransaction.findUnique.mockResolvedValue({ id: 'txn-existing', combo: 1 });
    const res = await request(app).post('/api/v1/voice/room-1/gifts')
      .send({ giftId: GIFT.id, receiverId: RECEIVER.id, idempotencyKey: 'idem-1' });
    expect(res.status).toBe(200);
    expect(res.body.data.duplicate).toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('FINANCIAL: insufficient coins returns 402', async () => {
    prisma.$transaction.mockImplementation(async (fn) => {
      if (typeof fn !== 'function') return Promise.all(fn);
      // Throw the exact error the controller expects
      throw new Error('INSUFFICIENT_COINS:5:20');
    });
    const res = await request(app).post('/api/v1/voice/room-1/gifts')
      .send({ giftId: GIFT.id, receiverId: RECEIVER.id });
    expect(res.status).toBe(402);
    expect(res.body.message).toMatch(/coins/i);
  });
});

// ─── DAILY LEADERBOARD ────────────────────────────────────────────────────────
describe('GET /api/v1/gifts/leaderboard/daily', () => {
  let app;
  beforeEach(() => { jest.clearAllMocks(); app = buildApp(); });

  test('returns enriched leaderboard using findMany not N individual findUnique', async () => {
    prisma.giftTransaction.groupBy.mockResolvedValue([
      { senderId: SENDER.id, _sum: { coinsSpent: 500 }, _count: { id: 10 } },
    ]);
    prisma.user.findMany.mockResolvedValue([SENDER]);
    const res = await request(app).get('/api/v1/gifts/leaderboard/daily');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].totalCoins).toBe(500);
    // Performance: 1 groupBy + 1 findMany — never N individual findUnique calls
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  test('returns empty array with no transactions', async () => {
    prisma.giftTransaction.groupBy.mockResolvedValue([]);
    const res = await request(app).get('/api/v1/gifts/leaderboard/daily');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});

// ─── ROOM LEADERBOARD ─────────────────────────────────────────────────────────
describe('GET /api/v1/voice/:id/gifts/leaderboard', () => {
  let app;
  beforeEach(() => { jest.clearAllMocks(); app = buildApp(); });

  test('returns top givers for room', async () => {
    prisma.roomGiftLeaderboard.findMany.mockResolvedValue([
      { userId: SENDER.id, totalCoins: 1000, giftCount: 20, user: SENDER },
    ]);
    const res = await request(app).get('/api/v1/voice/room-1/gifts/leaderboard');
    expect(res.status).toBe(200);
    expect(res.body.data[0].totalCoins).toBe(1000);
  });

  test('returns empty array for room with no gifts', async () => {
    prisma.roomGiftLeaderboard.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/v1/voice/room-1/gifts/leaderboard');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});
