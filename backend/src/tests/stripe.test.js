'use strict';
/**
 * Stripe Webhook + Checkout Tests — TE-001 (Financial Critical)
 * No real Stripe/DB — all deps mocked.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../utils/prisma');
jest.mock('../utils/redis', () => ({
  isRedisReady: jest.fn(() => false),
  getCache:     jest.fn().mockResolvedValue(null),
  setCache:     jest.fn().mockResolvedValue(true),
}));
jest.mock('../services/notification.service', () => ({
  notify: jest.fn().mockResolvedValue(true),
}));
jest.mock('../sockets', () => ({
  getIo: jest.fn(() => ({ to: jest.fn().mockReturnThis(), emit: jest.fn() })),
}));
// Mock the stripe npm package to prevent real API calls
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({ id: 'cs_mock', url: 'https://checkout.stripe.com/test' }),
      },
    },
    webhooks: {
      constructEvent: jest.fn((body) => {
        const payload = Buffer.isBuffer(body) ? body.toString() : body;
        return typeof payload === 'string' ? JSON.parse(payload) : payload;
      }),
    },
  }));
});
// Mock authenticate so /stripe/checkout (authenticated route) lets requests through
jest.mock('../middleware/auth.middleware', () => ({
  authenticate:        (req, _res, next) => { req.user = { id: 'user-pay-1', email: 'payer@halqa.app', firstName: 'Pay', lastName: 'Er', role: 'STUDENT' }; next(); },
  authorize:           (..._r) => (_q, _s, next) => next(),
  requireSchoolAccess: (_q, _s, next) => next(),
  optionalAuth:        (_q, _s, next) => next(),
  invalidateUserCache: jest.fn(),
  USER_SELECT: {},
}));

const prisma = require('../utils/prisma');

// ─── Build app ────────────────────────────────────────────────────────────────
const USER = { id: 'user-pay-1', email: 'payer@halqa.app', firstName: 'Pay', lastName: 'Er', role: 'STUDENT' };
const COIN_PACKAGE = { id: 'pkg-gold', name: 'Gold Pack', coins: 1000, bonusCoins: 100, priceUsd: 9.99, isActive: true };

function buildApp() {
  const app = express();
  // express.json() for checkout; webhook route applies express.raw() itself
  app.use(express.json());
  app.use('/api/v1/stripe', require('../routes/stripe.routes'));
  app.use(require('../middleware/errorHandler'));
  return app;
}

function makeEvent(metadata = {}, status = 'paid', sessionId = 'cs_test_abc') {
  return JSON.stringify({
    type: 'checkout.session.completed',
    id:   `evt_${sessionId}`,
    data: { object: { id: sessionId, payment_status: status, metadata: {
      userId: USER.id, packageId: COIN_PACKAGE.id,
      coins: '1000', bonus: '100', ...metadata,
    }}},
  });
}

// ─── CHECKOUT ─────────────────────────────────────────────────────────────────
describe('POST /api/v1/stripe/checkout', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.STRIPE_SECRET_KEY;
    app = buildApp();
  });

  test('returns 503 when Stripe is not configured', async () => {
    prisma.coinPackage.findUnique.mockResolvedValue(COIN_PACKAGE);
    const res = await request(app).post('/api/v1/stripe/checkout').send({ packageId: COIN_PACKAGE.id });
    expect(res.status).toBe(503);
  });

  test('returns 400 when packageId is missing', async () => {
    const res = await request(app).post('/api/v1/stripe/checkout').send({});
    expect(res.status).toBe(400);
  });

  test('returns 404 when package not found', async () => {
    prisma.coinPackage.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/api/v1/stripe/checkout').send({ packageId: 'bad-id' });
    expect(res.status).toBe(404);
  });
});

// ─── WEBHOOK — COIN PURCHASE ──────────────────────────────────────────────────
describe('POST /api/v1/stripe/webhook — coin purchase', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    // Set a fake Stripe key so getStripe() returns a client instance.
    // The controller's getStripe() skips when key starts with 'sk_test_REPLACE'.
    // We use a different test key; stripe.webhooks.constructEvent is bypassed
    // because STRIPE_WEBHOOK_SECRET is unset → dev mode (no signature check).
    process.env.STRIPE_SECRET_KEY     = 'sk_test_halqa_unit_test_key';
    delete process.env.STRIPE_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'test';
    app = buildApp();
    prisma.walletTransaction.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (fn) => fn({
      wallet: {
        upsert: jest.fn().mockResolvedValue({ coins: 1100 }),
        update: jest.fn().mockResolvedValue({ coins: 500 }),
      },
      walletTransaction: { create: jest.fn().mockResolvedValue({ id: 'wt-1' }) },
      platformRevenueEntry: { create: jest.fn().mockResolvedValue({ id: 'pre-1' }) },
    }));
  });
  afterAll(() => {
    delete process.env.STRIPE_SECRET_KEY;
    process.env.NODE_ENV = 'test';
  });

  test('credits coins on valid webhook', async () => {
    const res = await request(app).post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json').send(makeEvent());
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  test('IDEMPOTENCY: skips duplicate (DB check)', async () => {
    prisma.walletTransaction.findUnique.mockResolvedValue({ id: 'wt-existing' });
    const res = await request(app).post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json').send(makeEvent());
    expect(res.status).toBe(200);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('IDEMPOTENCY: skips duplicate (Redis check)', async () => {
    const redis = require('../utils/redis');
    redis.isRedisReady.mockReturnValue(true);
    redis.getCache.mockResolvedValueOnce({ userId: USER.id });
    const res = await request(app).post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json').send(makeEvent());
    expect(res.status).toBe(200);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    redis.isRedisReady.mockReturnValue(false);
  });

  test('skips when payment_status is not "paid"', async () => {
    const res = await request(app).post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json').send(makeEvent({}, 'unpaid'));
    expect(res.status).toBe(200);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('gracefully ignores webhook with missing metadata', async () => {
    const event = JSON.stringify({
      type: 'checkout.session.completed', id: 'evt_bad',
      data: { object: { id: 'cs_bad', payment_status: 'paid', metadata: {} } },
    });
    const res = await request(app).post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json').send(event);
    expect(res.status).toBe(200);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('emits wallet:coins_credited after successful credit', async () => {
    const { getIo } = require('../sockets');
    const mockEmit = jest.fn();
    getIo.mockReturnValue({ to: jest.fn().mockReturnValue({ emit: mockEmit }) });
    await request(app).post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json').send(makeEvent());
    expect(mockEmit).toHaveBeenCalledWith('wallet:coins_credited', expect.objectContaining({
      coins:     1100,
      packageId: COIN_PACKAGE.id,
    }));
  });

  test('returns 500 on DB failure (so Stripe retries)', async () => {
    // DB idempotency check passes (no existing tx), then transaction itself fails
    prisma.walletTransaction.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockRejectedValue(new Error('DB connection lost'));
    const res = await request(app).post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json').send(makeEvent());
    expect(res.status).toBe(500);
  });

  test('handles unrelated event types gracefully', async () => {
    const event = JSON.stringify({ type: 'customer.updated', id: 'evt_cu', data: { object: {} } });
    const res = await request(app).post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json').send(event);
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });
});

// ─── WEBHOOK — FEE PAYMENT ────────────────────────────────────────────────────
describe('POST /api/v1/stripe/webhook — fee payment', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_halqa_unit_test_key';
    delete process.env.STRIPE_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'test';
    app = buildApp();
    // Redis not ready → Redis idempotency check skipped
    // DB idempotency check (Task 8.1): findFirst returns null = not yet processed
    if (!prisma.feeRecord) prisma.feeRecord = {};
    prisma.feeRecord.findFirst = jest.fn().mockResolvedValue(null);
    prisma.feeRecord.update.mockResolvedValue({ id: 'fee-1', status: 'PAID', stripeSessionId: 'cs_fee' });
  });
  afterAll(() => { delete process.env.STRIPE_SECRET_KEY; });

  test('marks fee PAID on fee_payment webhook', async () => {
    const event = JSON.stringify({
      type: 'checkout.session.completed', id: 'evt_fee',
      data: { object: { id: 'cs_fee', payment_status: 'paid',
        metadata: { type: 'fee_payment', feeId: 'fee-1', studentId: 's-1', paidBy: USER.id },
      }},
    });
    const res = await request(app).post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json').send(event);
    expect(res.status).toBe(200);
    expect(prisma.feeRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'fee-1' }, data: expect.objectContaining({ status: 'PAID' }) })
    );
  });

  test('handles missing feeId gracefully', async () => {
    const event = JSON.stringify({
      type: 'checkout.session.completed', id: 'evt_fee_bad',
      data: { object: { id: 'cs_bad', payment_status: 'paid',
        metadata: { type: 'fee_payment' },
      }},
    });
    const res = await request(app).post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json').send(event);
    expect(res.status).toBe(200);
    expect(prisma.feeRecord.update).not.toHaveBeenCalled();
  });
});
