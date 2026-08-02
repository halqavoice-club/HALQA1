'use strict';
/**
 * Wallet Controller Unit Tests — TE-001
 * No real DB. All deps mocked.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../utils/prisma');
// Mock authenticate so wallet routes (router.use(authenticate)) let requests through
jest.mock('../middleware/auth.middleware', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'user-w-1', email: 'w@halqa.app', firstName: 'W', lastName: 'L', role: 'STUDENT' }; next(); },
  authorize:    (..._roles) => (_req, _res, next) => next(),
  requireSchoolAccess: (_req, _res, next) => next(),
  optionalAuth: (_req, _res, next) => next(),
  invalidateUserCache: jest.fn(),
  USER_SELECT: {},
}));

const prisma = require('../utils/prisma');

const USER    = { id: 'user-w-1', email: 'w@halqa.app', firstName: 'W', lastName: 'L', role: 'STUDENT' };
const WALLET  = { id: 'w-1', userId: USER.id, coins: 500, diamonds: 250, totalSpent: 100, totalEarned: 250 };
const PACKAGE = { id: 'pkg-s', name: 'Silver', coins: 500, bonusCoins: 50, priceUsd: 4.99, isActive: true, sortOrder: 1 };

function buildApp(nodeEnv = 'test') {
  process.env.NODE_ENV = nodeEnv;
  const app = express();
  app.use(express.json());
  // No manual req.user injection needed — authenticate mock does it
  app.use('/api/v1/wallet', require('../routes/wallet.routes'));
  app.use(require('../middleware/errorHandler'));
  return app;
}

// ─── GET /wallet/me ───────────────────────────────────────────────────────────
describe('GET /api/v1/wallet/me', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns existing wallet balance', async () => {
    prisma.wallet.upsert.mockResolvedValue(WALLET);
    const res = await request(buildApp()).get('/api/v1/wallet/me');
    expect(res.status).toBe(200);
    expect(res.body.data.coins).toBe(500);
    expect(res.body.data.diamonds).toBe(250);
  });

  test('creates wallet for new user (upsert create path)', async () => {
    const empty = { ...WALLET, coins: 0, diamonds: 0, totalSpent: 0, totalEarned: 0 };
    prisma.wallet.upsert.mockResolvedValue(empty);
    const res = await request(buildApp()).get('/api/v1/wallet/me');
    expect(res.status).toBe(200);
    expect(res.body.data.coins).toBe(0);
    expect(prisma.wallet.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ coins: 0 }) })
    );
  });
});

// ─── GET /wallet/packages ─────────────────────────────────────────────────────
describe('GET /api/v1/wallet/packages', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns active packages only', async () => {
    prisma.coinPackage.findMany.mockResolvedValue([PACKAGE]);
    const res = await request(buildApp()).get('/api/v1/wallet/packages');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(prisma.coinPackage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } })
    );
  });

  test('returns empty array when no packages', async () => {
    prisma.coinPackage.findMany.mockResolvedValue([]);
    const res = await request(buildApp()).get('/api/v1/wallet/packages');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

// ─── POST /wallet/purchase ────────────────────────────────────────────────────
describe('POST /api/v1/wallet/purchase', () => {
  beforeEach(() => { jest.clearAllMocks(); process.env.NODE_ENV = 'test'; });
  afterAll(() => { process.env.NODE_ENV = 'test'; });

  test('grants coins+bonus in test/dev mode', async () => {
    prisma.coinPackage.findUnique.mockResolvedValue(PACKAGE);
    prisma.wallet.upsert.mockResolvedValue({ ...WALLET, coins: WALLET.coins + 550 });
    const res = await request(buildApp('test')).post('/api/v1/wallet/purchase')
      .send({ packageId: PACKAGE.id });
    expect(res.status).toBe(200);
    expect(res.body.data.purchased.total).toBe(550); // 500 + 50 bonus
  });

  test('SECURITY: blocks /wallet/purchase in production', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(buildApp('production')).post('/api/v1/wallet/purchase')
      .send({ packageId: PACKAGE.id });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/stripe/i);
    process.env.NODE_ENV = 'test';
  });

  test('returns 400 when packageId missing', async () => {
    const res = await request(buildApp()).post('/api/v1/wallet/purchase').send({});
    expect(res.status).toBe(400);
  });

  test('returns 404 when package not found', async () => {
    prisma.coinPackage.findUnique.mockResolvedValue(null);
    const res = await request(buildApp()).post('/api/v1/wallet/purchase')
      .send({ packageId: 'bad-id' });
    expect(res.status).toBe(404);
  });
});

// ─── GET /wallet/history ─────────────────────────────────────────────────────
describe('GET /api/v1/wallet/history', () => {
  beforeEach(() => jest.clearAllMocks());

  const sentTx     = { id: 'gt-1', coinsSpent: 20, createdAt: new Date().toISOString(),
    gift: { name: 'Rose', emoji: '🌹', priceCoins: 20 },
    receiver: { id: 'r-1', firstName: 'Sara', lastName: 'A', avatarUrl: null },
    room: { id: 'room-1', title: 'Live' } };
  const receivedTx = { id: 'gt-2', diamondsEarned: 10, createdAt: new Date().toISOString(),
    gift: { name: 'Rose', emoji: '🌹', priceCoins: 20 },
    sender: { id: 's-1', firstName: 'Ali', lastName: 'H', avatarUrl: null },
    room: { id: 'room-1', title: 'Live' } };

  test('returns sent + received with total count', async () => {
    prisma.giftTransaction.findMany
      .mockResolvedValueOnce([sentTx])
      .mockResolvedValueOnce([receivedTx]);
    prisma.giftTransaction.count.mockResolvedValue(2);
    const res = await request(buildApp()).get('/api/v1/wallet/history');
    expect(res.status).toBe(200);
    expect(res.body.data.sent).toHaveLength(1);
    expect(res.body.data.received).toHaveLength(1);
    expect(res.body.data.total).toBe(2);
  });

  test('returns empty arrays when no transactions', async () => {
    prisma.giftTransaction.findMany.mockResolvedValue([]);
    prisma.giftTransaction.count.mockResolvedValue(0);
    const res = await request(buildApp()).get('/api/v1/wallet/history');
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(0);
  });

  test('applies page/limit pagination correctly', async () => {
    prisma.giftTransaction.findMany.mockResolvedValue([]);
    prisma.giftTransaction.count.mockResolvedValue(0);
    await request(buildApp()).get('/api/v1/wallet/history?page=2&limit=10');
    // Both findMany calls (sent + received) should have been called with pagination
    expect(prisma.giftTransaction.findMany).toHaveBeenCalled();
    const firstCall = prisma.giftTransaction.findMany.mock.calls[0][0];
    // page=2, limit=10 → skip = (2-1)*10 = 10
    expect(firstCall.skip).toBe(10);
    expect(firstCall.take).toBe(10);
  });
});
