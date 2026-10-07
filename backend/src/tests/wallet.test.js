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
    // $transaction mock: interactive form receives a callback fn
    prisma.$transaction.mockImplementation(async (fn) => fn({
      wallet:            { upsert: jest.fn().mockResolvedValue({ ...WALLET, coins: WALLET.coins + 550 }) },
      walletTransaction: { create: jest.fn().mockResolvedValue({ id: 'wt-dev-1' }) },
    }));
    const res = await request(buildApp('test')).post('/api/v1/wallet/purchase')
      .send({ packageId: PACKAGE.id });
    expect(res.status).toBe(200);
    expect(res.body.data.purchased.total).toBe(550); // 500 + 50 bonus
  });

  test('F-01: walletTransaction.create called with STRIPE_PURCHASE type in dev mode', async () => {
    prisma.coinPackage.findUnique.mockResolvedValue(PACKAGE);
    const mockCreate = jest.fn().mockResolvedValue({ id: 'wt-dev-2' });
    prisma.$transaction.mockImplementation(async (fn) => fn({
      wallet:            { upsert: jest.fn().mockResolvedValue({ ...WALLET, coins: WALLET.coins + 550 }) },
      walletTransaction: { create: mockCreate },
    }));
    await request(buildApp('test')).post('/api/v1/wallet/purchase')
      .send({ packageId: PACKAGE.id });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'STRIPE_PURCHASE', coins: 550 })
      })
    );
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
// Task 9.1: history now returns WalletTransaction records (not GiftTransaction)
describe('GET /api/v1/wallet/history', () => {
  beforeEach(() => jest.clearAllMocks());

  // WalletTransaction fixtures
  const stripeTx = {
    id: 'wt-1', type: 'STRIPE_PURCHASE', coins: 1000, diamonds: 0,
    description: 'Stripe purchase', packageId: 'pkg-1',
    stripeSessionId: 'cs_abc', giftTxId: null, tipId: null, subscriptionId: null,
    createdAt: new Date().toISOString(),
  };
  const giftTx = {
    id: 'wt-2', type: 'GIFT_SEND', coins: -20, diamonds: 0,
    description: 'Sent 1x Rose to room r1', giftTxId: 'gt-1', packageId: null,
    stripeSessionId: null, tipId: null, subscriptionId: null,
    createdAt: new Date().toISOString(),
  };
  const payoutTx = {
    id: 'wt-3', type: 'PAYOUT', coins: 0, diamonds: -2000,
    description: 'Payout request pr-1: 2000 diamonds reserved', giftTxId: null,
    packageId: null, stripeSessionId: null, tipId: null, subscriptionId: null,
    createdAt: new Date().toISOString(),
  };

  test('returns WalletTransaction records with pagination', async () => {
    if (!prisma.walletTransaction) prisma.walletTransaction = {};
    prisma.walletTransaction.findMany = jest.fn().mockResolvedValue([stripeTx, giftTx]);
    prisma.walletTransaction.count    = jest.fn().mockResolvedValue(2);
    // No GIFT_SEND enrichment needed (giftTxId present but giftTransaction.findMany returns [])
    prisma.giftTransaction.findMany.mockResolvedValue([]);

    const res = await request(buildApp()).get('/api/v1/wallet/history');
    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(2);
    expect(res.body.data.pagination.total).toBe(2);
  });

  test('returns empty array when no transactions', async () => {
    if (!prisma.walletTransaction) prisma.walletTransaction = {};
    prisma.walletTransaction.findMany = jest.fn().mockResolvedValue([]);
    prisma.walletTransaction.count    = jest.fn().mockResolvedValue(0);

    const res = await request(buildApp()).get('/api/v1/wallet/history');
    expect(res.status).toBe(200);
    expect(res.body.data.pagination.total).toBe(0);
  });

  test('applies page/limit pagination — skip and take passed to walletTransaction', async () => {
    if (!prisma.walletTransaction) prisma.walletTransaction = {};
    prisma.walletTransaction.findMany = jest.fn().mockResolvedValue([]);
    prisma.walletTransaction.count    = jest.fn().mockResolvedValue(0);

    await request(buildApp()).get('/api/v1/wallet/history?page=2&limit=10');
    expect(prisma.walletTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 })
    );
  });

  test('GIFT_SEND records enriched with gift details (batch lookup, no N+1)', async () => {
    if (!prisma.walletTransaction) prisma.walletTransaction = {};
    prisma.walletTransaction.findMany = jest.fn().mockResolvedValue([giftTx]);
    prisma.walletTransaction.count    = jest.fn().mockResolvedValue(1);
    // Batch giftTransaction lookup returns the matching record
    prisma.giftTransaction.findMany.mockResolvedValue([{
      id:       'gt-1',
      gift:     { name: 'Rose', emoji: '🌹', priceCoins: 20 },
      receiver: { id: 'r-1', firstName: 'Sara', lastName: 'A', avatarUrl: null },
    }]);

    const res = await request(buildApp()).get('/api/v1/wallet/history');
    expect(res.status).toBe(200);
    const record = res.body.data.data[0];
    expect(record.type).toBe('GIFT_SEND');
    expect(record.giftDetails.gift.name).toBe('Rose');
    expect(record.giftDetails.receiver.firstName).toBe('Sara');
    // Exactly 1 findMany call for enrichment (batch, not N+1)
    expect(prisma.giftTransaction.findMany).toHaveBeenCalledTimes(1);
  });

  test('PAYOUT records have no sensitive fields exposed', async () => {
    if (!prisma.walletTransaction) prisma.walletTransaction = {};
    prisma.walletTransaction.findMany = jest.fn().mockResolvedValue([payoutTx]);
    prisma.walletTransaction.count    = jest.fn().mockResolvedValue(1);
    prisma.giftTransaction.findMany.mockResolvedValue([]);

    const res = await request(buildApp()).get('/api/v1/wallet/history');
    expect(res.status).toBe(200);
    const record = res.body.data.data[0];
    expect(record.type).toBe('PAYOUT');
    expect(record.diamonds).toBe(-2000);
    // accountDetails should not be present (lives on PayoutRequest, not WalletTransaction)
    expect(record.accountDetails).toBeUndefined();
  });
});
