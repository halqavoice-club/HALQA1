'use strict';
/**
 * Sprint 8 — Refund API Regression Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * PAY-GAP-001: POST /api/v1/admin/actions/transactions/:id/refund
 *   - Only STRIPE_PURCHASE and ADMIN_GRANT are refundable
 *   - GIFT_SEND, TIP_SEND, SUBSCRIPTION, REFUND types return 400
 *   - Idempotency: second refund attempt returns 409
 *   - Insufficient coins returns 400
 *   - Zero-coin transaction returns 400
 *   - Non-existent transaction returns 404
 *   - Deleted user returns 404
 *
 * PAY-GAP-002: Stripe refund integration
 *   - STRIPE_PURCHASE with stripeSessionId: Stripe refunds.create called
 *   - ADMIN_GRANT: no Stripe call made
 *   - Stripe failure is non-fatal (DB refund still committed)
 *
 * Security:
 *   - Non-SUPER_ADMIN gets 403
 *   - Unauthenticated gets 401
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

// ─── Stripe mock ──────────────────────────────────────────────────────────────
// The refund route does: const Stripe = require('stripe'); new Stripe(key, {...})
// We mock the module so the constructor returns our controllable mock instance.
// Note: jest.mock factories are hoisted — we cannot reference module-scope
// variables inside them. Use jest.fn() directly and share refs via module scope.
const mockStripeRefundCreate    = jest.fn();
const mockStripeSessionRetrieve = jest.fn();

jest.mock('stripe', () => {
  // Return a constructor that creates a mock Stripe client.
  // The inner jest.fn()s are accessed via the outer-scope variables above
  // because jest.mock is hoisted but the outer const declarations are evaluated
  // before any test code runs (they are in the same file scope).
  return jest.fn().mockImplementation(() => ({
    checkout: { sessions: { retrieve: (...args) => mockStripeSessionRetrieve(...args) } },
    refunds:  { create:   (...args) => mockStripeRefundCreate(...args) },
  }));
});

const request      = require('supertest');
const express      = require('express');
const cookieParser = require('cookie-parser');
const prisma       = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');
let app;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/admin/actions', require('../routes/admin-actions.routes'));
  app.use((err, req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function asSuperAdmin(id = 'sa-1') {
  const u = { id, role: 'SUPER_ADMIN', status: 'ACTIVE', schoolId: null, firstName: 'A', lastName: 'S', avatarUrl: null, deletedAt: null };
  verifyAccessToken.mockReturnValue({ userId: id, role: 'SUPER_ADMIN', schoolId: null });
  prisma.user.findUnique.mockResolvedValue(u);
  return u;
}
function asMember(id = 'mb-1') {
  const u = { id, role: 'MEMBER', status: 'ACTIVE', schoolId: 'sch-1', firstName: 'M', lastName: 'B', avatarUrl: null, deletedAt: null };
  verifyAccessToken.mockReturnValue({ userId: id, role: 'MEMBER', schoolId: 'sch-1' });
  prisma.user.findUnique.mockResolvedValue(u);
  return u;
}
function tok(id) { return `Bearer t-${id}`; }

const TX_ID       = 'tx-stripe-001';
const ADMIN_TX_ID = 'tx-admin-001';
const TARGET_USER = { id: 'user-target', email: 'user@example.com', firstName: 'Jane', lastName: 'Doe', deletedAt: null };

function makeStripeTx(overrides = {}) {
  return {
    id: TX_ID, userId: 'user-target', type: 'STRIPE_PURCHASE',
    coins: 1000, description: 'Stripe purchase', stripeSessionId: 'cs_test_abc',
    packageId: 'pkg-1', giftTxId: null, tipId: null, subscriptionId: null,
    createdAt: new Date(),
    user: TARGET_USER,
    ...overrides,
  };
}
function makeAdminGrantTx(overrides = {}) {
  return {
    id: ADMIN_TX_ID, userId: 'user-target', type: 'ADMIN_GRANT',
    coins: 500, description: 'Admin grant', stripeSessionId: null,
    packageId: null, giftTxId: null, tipId: null, subscriptionId: null,
    createdAt: new Date(),
    user: TARGET_USER,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);

  // Default wallet mock — enough coins for refund
  if (!prisma.wallet) prisma.wallet = {};
  prisma.wallet.findUnique = jest.fn().mockResolvedValue({ coins: 2000 });
  prisma.wallet.update     = jest.fn().mockResolvedValue({ coins: 1000 });

  // Default walletTransaction mock
  // Call order in the refund route:
  //   1st findUnique: load the transaction by id
  //   2nd findUnique: idempotency check (WHERE idempotencyKey = 'refund:${txId}')
  // By default: first returns null (overridden per-test), second returns null (not yet refunded)
  if (!prisma.walletTransaction) prisma.walletTransaction = {};
  prisma.walletTransaction.findUnique = jest.fn().mockResolvedValue(null);
  prisma.walletTransaction.findFirst  = jest.fn().mockResolvedValue(null); // legacy — kept for compat
  prisma.walletTransaction.create     = jest.fn().mockResolvedValue({ id: 'refund-tx-1', coins: -1000 });

  // Default $transaction mock — executes the callback
  prisma.$transaction = jest.fn().mockImplementation(async (fn) => {
    if (typeof fn === 'function') {
      return fn({
        wallet:            { update: jest.fn().mockResolvedValue({}) },
        walletTransaction: { create: jest.fn().mockResolvedValue({ id: 'refund-tx-1', coins: -1000 }) },
      });
    }
    return Promise.all(fn);
  });

  // auditLog
  if (!prisma.auditLog) prisma.auditLog = {};
  prisma.auditLog.create = jest.fn().mockResolvedValue({});

  // Stripe mocks
  mockStripeSessionRetrieve.mockResolvedValue({ payment_intent: 'pi_test_123' });
  mockStripeRefundCreate.mockResolvedValue({ id: 'rf_test_abc', status: 'succeeded' });

  // STRIPE_SECRET_KEY must be non-empty and non-placeholder for the Stripe
  // client initialisation guard to pass. Use a clearly fake value that does
  // not match the pre-commit secret scanner patterns.
  process.env.STRIPE_SECRET_KEY = 'halqa_unit_test_stripe_key_mock';
});

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
});

// ─────────────────────────────────────────────────────────────────────────────
// Security: access control
// ─────────────────────────────────────────────────────────────────────────────
describe('PAY-GAP-001: Refund endpoint access control', () => {
  test('Unauthenticated request returns 401', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/actions/transactions/${TX_ID}/refund`)
      .send({ reason: 'testing refund security' });
    expect(res.status).toBe(401);
  });

  test('MEMBER gets 403', async () => {
    asMember('mb-refund');
    const res = await request(app)
      .post(`/api/v1/admin/actions/transactions/${TX_ID}/refund`)
      .set('Authorization', tok('mb-refund'))
      .send({ reason: 'testing refund security' });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Input validation
// ─────────────────────────────────────────────────────────────────────────────
describe('PAY-GAP-001: Refund input validation', () => {
  test('Missing reason returns 400', async () => {
    asSuperAdmin();
    // 1st findUnique: tx load; 2nd findUnique: idempotency (null = not yet refunded)
    prisma.walletTransaction.findUnique
      .mockResolvedValueOnce(makeStripeTx())
      .mockResolvedValueOnce(null);
    const res = await request(app)
      .post(`/api/v1/admin/actions/transactions/${TX_ID}/refund`)
      .set('Authorization', tok('sa-1'))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/reason/i);
  });

  test('Reason shorter than 10 chars returns 400', async () => {
    asSuperAdmin();
    prisma.walletTransaction.findUnique
      .mockResolvedValueOnce(makeStripeTx())
      .mockResolvedValueOnce(null);
    const res = await request(app)
      .post(`/api/v1/admin/actions/transactions/${TX_ID}/refund`)
      .set('Authorization', tok('sa-1'))
      .send({ reason: 'short' });
    expect(res.status).toBe(400);
  });

  test('Non-existent transaction returns 404', async () => {
    asSuperAdmin();
    prisma.walletTransaction.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/v1/admin/actions/transactions/does-not-exist/refund')
      .set('Authorization', tok('sa-1'))
      .send({ reason: 'testing non-existent transaction' });
    expect(res.status).toBe(404);
  });

  test('Deleted user account returns 404', async () => {
    asSuperAdmin();
    prisma.walletTransaction.findUnique
      .mockResolvedValueOnce(makeStripeTx({ user: { ...TARGET_USER, deletedAt: new Date() } }))
      .mockResolvedValueOnce(null);
    const res = await request(app)
      .post(`/api/v1/admin/actions/transactions/${TX_ID}/refund`)
      .set('Authorization', tok('sa-1'))
      .send({ reason: 'deleted user refund attempt' });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Non-refundable types
// ─────────────────────────────────────────────────────────────────────────────
describe('PAY-GAP-001: Non-refundable transaction types', () => {
  const NON_REFUNDABLE = ['GIFT_SEND', 'TIP_SEND', 'SUBSCRIPTION', 'REFUND'];

  NON_REFUNDABLE.forEach(type => {
    test(`${type} type returns 400 (non-refundable)`, async () => {
      asSuperAdmin();
      // Non-refundable check happens before idempotency — only 1 findUnique call needed
      prisma.walletTransaction.findUnique
        .mockResolvedValueOnce(makeStripeTx({ type, stripeSessionId: null }))
        .mockResolvedValueOnce(null);
      const res = await request(app)
        .post(`/api/v1/admin/actions/transactions/${TX_ID}/refund`)
        .set('Authorization', tok('sa-1'))
        .send({ reason: `trying to refund a ${type} transaction` });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cannot be refunded/i);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Business rules
// ─────────────────────────────────────────────────────────────────────────────
describe('PAY-GAP-001: Refund business rules', () => {
  test('Already-refunded transaction returns 409', async () => {
    asSuperAdmin();
    // 1st findUnique: tx load returns the original tx
    // 2nd findUnique: idempotency check returns an existing REFUND tx (F-04: uses idempotencyKey)
    prisma.walletTransaction.findUnique
      .mockResolvedValueOnce(makeStripeTx())
      .mockResolvedValueOnce({ id: 'existing-refund-tx' }); // idempotency hit
    const res = await request(app)
      .post(`/api/v1/admin/actions/transactions/${TX_ID}/refund`)
      .set('Authorization', tok('sa-1'))
      .send({ reason: 'duplicate refund attempt test' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already been refunded/i);
  });

  test('Insufficient wallet coins returns 400', async () => {
    asSuperAdmin();
    prisma.walletTransaction.findUnique
      .mockResolvedValueOnce(makeStripeTx()) // 1000 coins tx
      .mockResolvedValueOnce(null);          // not yet refunded
    prisma.wallet.findUnique.mockResolvedValue({ coins: 50 }); // only 50 coins
    const res = await request(app)
      .post(`/api/v1/admin/actions/transactions/${TX_ID}/refund`)
      .set('Authorization', tok('sa-1'))
      .send({ reason: 'testing insufficient balance guard' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/only has \d+ coins/i);
  });

  test('Zero-coin transaction returns 400', async () => {
    asSuperAdmin();
    prisma.walletTransaction.findUnique
      .mockResolvedValueOnce(makeStripeTx({ coins: 0 }))
      .mockResolvedValueOnce(null);
    const res = await request(app)
      .post(`/api/v1/admin/actions/transactions/${TX_ID}/refund`)
      .set('Authorization', tok('sa-1'))
      .send({ reason: 'testing zero coins edge case' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/zero coins/i);
  });

  test('STRIPE_PURCHASE refund succeeds — returns 200 with refundTransaction', async () => {
    asSuperAdmin();
    prisma.walletTransaction.findUnique
      .mockResolvedValueOnce(makeStripeTx())
      .mockResolvedValueOnce(null);
    const res = await request(app)
      .post(`/api/v1/admin/actions/transactions/${TX_ID}/refund`)
      .set('Authorization', tok('sa-1'))
      .send({ reason: 'customer complained — full refund authorized' });
    expect(res.status).toBe(200);
    expect(res.body.data.coinsRefunded).toBe(1000);
    expect(res.body.data.refundTransaction).toBeDefined();
  });

  test('ADMIN_GRANT refund succeeds — returns 200', async () => {
    asSuperAdmin();
    prisma.walletTransaction.findUnique
      .mockResolvedValueOnce(makeAdminGrantTx())
      .mockResolvedValueOnce(null);
    const res = await request(app)
      .post(`/api/v1/admin/actions/transactions/${ADMIN_TX_ID}/refund`)
      .set('Authorization', tok('sa-1'))
      .send({ reason: 'admin grant was issued in error' });
    expect(res.status).toBe(200);
    expect(res.body.data.coinsRefunded).toBe(500);
  });

  test('$transaction is called atomically for coin deduction + ledger entry', async () => {
    asSuperAdmin();
    prisma.walletTransaction.findUnique
      .mockResolvedValueOnce(makeStripeTx())
      .mockResolvedValueOnce(null);
    await request(app)
      .post(`/api/v1/admin/actions/transactions/${TX_ID}/refund`)
      .set('Authorization', tok('sa-1'))
      .send({ reason: 'testing atomicity of refund transaction' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PAY-GAP-002: Stripe integration
// ─────────────────────────────────────────────────────────────────────────────
describe('PAY-GAP-002: Stripe refund integration', () => {
  test('STRIPE_PURCHASE: stripe.refunds.create is called with payment intent', async () => {
    asSuperAdmin();
    prisma.walletTransaction.findUnique
      .mockResolvedValueOnce(makeStripeTx())
      .mockResolvedValueOnce(null);
    mockStripeSessionRetrieve.mockResolvedValue({ payment_intent: 'pi_test_123' });
    mockStripeRefundCreate.mockResolvedValue({ id: 'rf_abc', status: 'succeeded' });

    const res = await request(app)
      .post(`/api/v1/admin/actions/transactions/${TX_ID}/refund`)
      .set('Authorization', tok('sa-1'))
      .send({ reason: 'stripe refund integration test check', stripeRefund: true });
    expect(res.status).toBe(200);
    expect(mockStripeSessionRetrieve).toHaveBeenCalledWith('cs_test_abc');
    expect(mockStripeRefundCreate).toHaveBeenCalledWith({
      payment_intent: 'pi_test_123',
      reason: 'requested_by_customer',
    });
    expect(res.body.data.stripeRefund.refundId).toBe('rf_abc');
  });

  test('ADMIN_GRANT: Stripe is NOT called (no Stripe session)', async () => {
    asSuperAdmin();
    prisma.walletTransaction.findUnique
      .mockResolvedValueOnce(makeAdminGrantTx())
      .mockResolvedValueOnce(null);
    const res = await request(app)
      .post(`/api/v1/admin/actions/transactions/${ADMIN_TX_ID}/refund`)
      .set('Authorization', tok('sa-1'))
      .send({ reason: 'admin grant reversal no stripe needed' });
    expect(res.status).toBe(200);
    expect(mockStripeRefundCreate).not.toHaveBeenCalled();
    expect(res.body.data.stripeRefund).toBeNull();
  });

  test('stripeRefund=false skips Stripe even for STRIPE_PURCHASE', async () => {
    asSuperAdmin();
    prisma.walletTransaction.findUnique
      .mockResolvedValueOnce(makeStripeTx())
      .mockResolvedValueOnce(null);
    const res = await request(app)
      .post(`/api/v1/admin/actions/transactions/${TX_ID}/refund`)
      .set('Authorization', tok('sa-1'))
      .send({ reason: 'coins refund only no stripe needed here', stripeRefund: false });
    expect(res.status).toBe(200);
    expect(mockStripeRefundCreate).not.toHaveBeenCalled();
    expect(res.body.data.stripeRefund).toBeNull();
  });

  test('Stripe failure is non-fatal — DB refund still committed (200)', async () => {
    asSuperAdmin();
    prisma.walletTransaction.findUnique
      .mockResolvedValueOnce(makeStripeTx())
      .mockResolvedValueOnce(null);
    mockStripeSessionRetrieve.mockResolvedValue({ payment_intent: 'pi_test_123' });
    mockStripeRefundCreate.mockRejectedValue(new Error('Stripe API error'));

    const res = await request(app)
      .post(`/api/v1/admin/actions/transactions/${TX_ID}/refund`)
      .set('Authorization', tok('sa-1'))
      .send({ reason: 'stripe fails but coin refund must still work' });
    // DB refund succeeded — 200 even when Stripe failed
    expect(res.status).toBe(200);
    expect(res.body.data.coinsRefunded).toBe(1000);
    expect(res.body.data.stripeRefund.error).toMatch(/Stripe API error/);
  });

  test('Stripe session with no payment_intent returns stripeRefund.error', async () => {
    asSuperAdmin();
    prisma.walletTransaction.findUnique
      .mockResolvedValueOnce(makeStripeTx())
      .mockResolvedValueOnce(null);
    mockStripeSessionRetrieve.mockResolvedValue({ payment_intent: null });

    const res = await request(app)
      .post(`/api/v1/admin/actions/transactions/${TX_ID}/refund`)
      .set('Authorization', tok('sa-1'))
      .send({ reason: 'stripe session missing payment intent test' });
    expect(res.status).toBe(200);
    expect(res.body.data.stripeRefund.error).toMatch(/No payment_intent/i);
    expect(mockStripeRefundCreate).not.toHaveBeenCalled();
  });

  // Source-level verification
  test('admin-actions.routes.js contains refund endpoint', () => {
    const fs   = require('fs');
    const path = require('path');
    const src  = fs.readFileSync(path.join(__dirname, '../routes/admin-actions.routes.js'), 'utf8');
    expect(src).toMatch(/transactions\/:id\/refund/);
    expect(src).toMatch(/PAY-GAP-001/);
    expect(src).toMatch(/PAY-GAP-002/);
    expect(src).toMatch(/stripe\.refunds\.create/);
    expect(src).toMatch(/INVARIANT-006/);
  });
});
