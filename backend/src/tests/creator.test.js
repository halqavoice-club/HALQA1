'use strict';
/**
 * Creator Economy Controller Tests — Task 14.2
 * ─────────────────────────────────────────────────────────────────────────────
 * Financial critical path tests for creator subscriptions, tips, and SUPER_ADMIN
 * isolation guards.  All dependencies are mocked — no real DB, Redis, or network.
 *
 * Covers:
 *   - POST /creators/:userId/subscribe — happy path (coins deducted, diamonds credited, ledger)
 *   - POST /creators/:userId/subscribe — insufficient balance (402)
 *   - POST /creators/:userId/subscribe — optimistic lock (P2025 → 402)
 *   - POST /creators/:userId/subscribe — SUBSCRIPTION ledger failure rolls back entire tx
 *   - POST /creators/:userId/subscribe — concurrent race: at most one succeeds
 *   - POST /creators/:userId/tip — happy path with TIP_SEND ledger
 *   - POST /creators/:userId/tip — idempotency key prevents double-tip
 *   - POST /creators/:userId/tip — insufficient balance (402)
 *   - POST /creators/me/become — SUPER_ADMIN gets 403
 *   - POST /creators/:userId/subscribe — SUPER_ADMIN gets 403
 *   - POST /creators/:userId/tip — SUPER_ADMIN gets 403
 *   - GET /creators/me/dashboard — correct aggregation
 */

const request = require('supertest');
const express = require('express');

// ─── Module mocks (must be before require of app/routes) ───────────────────────
jest.mock('../utils/prisma');
jest.mock('../utils/redis', () => ({
  isRedisReady: jest.fn(() => false),
  getCache:     jest.fn().mockResolvedValue(null),
  setCache:     jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../sockets', () => ({
  getIo: jest.fn(() => ({
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
  })),
}));
jest.mock('../services/notification.service', () => ({
  notify: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../middleware/auth.middleware', () => ({
  authenticate: (req, _res, next) => {
    req.user = req._testUser || {
      id: 'subscriber-1',
      email: 'subscriber@halqa.app',
      firstName: 'Alice',
      lastName: 'Sub',
      role: 'MEMBER',
    };
    next();
  },
  authorize: (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    next();
  },
  requireSchoolAccess: (_q, _s, next) => next(),
  optionalAuth:        (_q, _s, next) => next(),
  invalidateUserCache: jest.fn(),
  USER_SELECT: {},
}));

const prisma = require('../utils/prisma');

// ─── Test fixtures ──────────────────────────────────────────────────────────────
const SUBSCRIBER = {
  id: 'subscriber-1',
  email: 'subscriber@halqa.app',
  firstName: 'Alice',
  lastName: 'Sub',
  role: 'MEMBER',
};

const CREATOR_USER = {
  id: 'creator-user-1',
  email: 'creator@halqa.app',
  firstName: 'Bob',
  lastName: 'Creator',
  role: 'MEMBER',
};

const SUPER_ADMIN = {
  id: 'sa-1',
  email: 'admin@halqa.app',
  firstName: 'Super',
  lastName: 'Admin',
  role: 'SUPER_ADMIN',
};

const TIER = {
  id: 'tier-1',
  creatorId: 'profile-1',
  name: 'Gold',
  priceCoins: 100,
  isActive: true,
  sortOrder: 0,
};

const CREATOR_PROFILE = {
  id: 'profile-1',
  userId: CREATOR_USER.id,
  displayName: 'Bob Creator',
  isActive: true,
  subscriberCount: 5,
  totalEarned: 500,
  tipCount: 3,
  tiers: [TIER],
};

const WALLET_WITH_FUNDS = {
  userId: SUBSCRIBER.id,
  coins: 500,
  diamonds: 0,
  totalSpent: 0,
  totalEarned: 0,
};

const WALLET_EMPTY = {
  userId: SUBSCRIBER.id,
  coins: 50,
  diamonds: 0,
  totalSpent: 0,
  totalEarned: 0,
};

const SUBSCRIPTION = {
  id: 'sub-1',
  subscriberId: SUBSCRIBER.id,
  creatorId: 'profile-1',
  tierId: TIER.id,
  status: 'ACTIVE',
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  coinsCharged: 100,
};

const TIP = {
  id: 'tip-1',
  senderId: SUBSCRIBER.id,
  creatorId: 'profile-1',
  amount: 50,
  diamondsEarned: 25,
  message: 'Great content!',
  postId: null,
  idempotencyKey: 'idem-key-123',
};

// ─── App factory ────────────────────────────────────────────────────────────────
/**
 * Build a test Express app.
 * @param {object|null} userOverride — if provided, sets req.user before auth middleware
 */
function buildApp(userOverride = null) {
  const app = express();
  app.use(express.json());

  // Inject user override before the route middleware runs
  if (userOverride) {
    app.use((req, _res, next) => {
      req._testUser = userOverride;
      next();
    });
  }

  app.use('/api/v1/creators', require('../routes/creator.routes'));

  // Minimal error handler
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ success: false, message: err.message || 'Internal error' });
  });

  return app;
}

// ─── Helper: mock a successful subscribe transaction ───────────────────────────
function mockSuccessfulSubscribeTransaction() {
  prisma.$transaction.mockImplementation(async (fn) => {
    if (typeof fn !== 'function') return Promise.all(fn);
    return fn({
      wallet: {
        update: jest.fn().mockResolvedValue({ ...WALLET_WITH_FUNDS, coins: 400 }),
        upsert: jest.fn().mockResolvedValue({ userId: CREATOR_USER.id, diamonds: 50 }),
      },
      creatorSubscription: {
        upsert: jest.fn().mockResolvedValue(SUBSCRIPTION),
      },
      creatorProfile: {
        update: jest.fn().mockResolvedValue(CREATOR_PROFILE),
      },
      walletTransaction: {
        create: jest.fn().mockResolvedValue({ id: 'wt-1' }),
      },
      platformRevenueEntry: {
        create: jest.fn().mockResolvedValue({ id: 'pre-1' }),
      },
    });
  });
}

// ─── Helper: mock a successful tip transaction ────────────────────────────────
function mockSuccessfulTipTransaction() {
  prisma.$transaction.mockImplementation(async (fn) => {
    if (typeof fn !== 'function') return Promise.all(fn);
    return fn({
      wallet: {
        update: jest.fn().mockResolvedValue({ ...WALLET_WITH_FUNDS, coins: 450 }),
        upsert: jest.fn().mockResolvedValue({ userId: CREATOR_USER.id, diamonds: 25 }),
      },
      creatorTip: {
        create: jest.fn().mockResolvedValue(TIP),
      },
      creatorProfile: {
        update: jest.fn().mockResolvedValue({ ...CREATOR_PROFILE, tipCount: 4 }),
      },
      walletTransaction: {
        create: jest.fn().mockResolvedValue({ id: 'wt-2' }),
      },
      platformRevenueEntry: {
        create: jest.fn().mockResolvedValue({ id: 'pre-2' }),
      },
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUBSCRIBE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/creators/:userId/subscribe', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock setup for most subscribe tests
    prisma.creatorProfile.findUnique.mockResolvedValue(CREATOR_PROFILE);
    prisma.creatorSubscription.findUnique.mockResolvedValue(null); // no existing subscription
    prisma.wallet.findUnique.mockResolvedValue(WALLET_WITH_FUNDS);
    mockSuccessfulSubscribeTransaction();
  });

  // ── Happy path ──────────────────────────────────────────────────────────────
  test('happy path: coins deducted, diamonds credited, SUBSCRIPTION ledger written', async () => {
    let capturedTxFn;
    const mockWalletUpdate = jest.fn().mockResolvedValue({ ...WALLET_WITH_FUNDS, coins: 400 });
    const mockWalletUpsert = jest.fn().mockResolvedValue({ userId: CREATOR_USER.id, diamonds: 50 });
    const mockSubUpsert = jest.fn().mockResolvedValue(SUBSCRIPTION);
    const mockProfileUpdate = jest.fn().mockResolvedValue(CREATOR_PROFILE);
    const mockLedgerCreate = jest.fn().mockResolvedValue({ id: 'wt-1' });

    prisma.$transaction.mockImplementation(async (fn) => {
      capturedTxFn = fn;
      return fn({
        wallet:              { update: mockWalletUpdate, upsert: mockWalletUpsert },
        creatorSubscription: { upsert: mockSubUpsert },
        creatorProfile:      { update: mockProfileUpdate },
        walletTransaction:   { create: mockLedgerCreate },
        platformRevenueEntry: { create: jest.fn().mockResolvedValue({ id: 'pre-1' }) },
      });
    });

    const res = await request(buildApp())
      .post(`/api/v1/creators/${CREATOR_USER.id}/subscribe`)
      .send({ tierId: TIER.id });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.subscribed).toBe(true);
    expect(res.body.data.coinsCharged).toBe(TIER.priceCoins);

    // Verify coin deduction used optimistic lock (coins: { gte: priceCoins })
    expect(mockWalletUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: SUBSCRIBER.id,
          coins: { gte: TIER.priceCoins },
        }),
        data: expect.objectContaining({
          coins: { decrement: TIER.priceCoins },
        }),
      })
    );

    // Verify diamonds credited to creator
    expect(mockWalletUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: CREATOR_USER.id } })
    );

    // Verify SUBSCRIPTION ledger entry written
    expect(mockLedgerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'SUBSCRIPTION',
          coins: -TIER.priceCoins,
        }),
      })
    );

    // F-05: verify SUBSCRIPTION_RECEIVE ledger entry written for creator (diamond credit)
    expect(mockLedgerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type:           'SUBSCRIPTION_RECEIVE',
          userId:         CREATOR_USER.id,
          diamonds:       expect.any(Number),
          subscriptionId: SUBSCRIPTION.id,
        }),
      })
    );
  });

  // ── Insufficient balance (sync pre-check path) ──────────────────────────────
  test('returns 402 when wallet has insufficient coins (optimistic lock P2025)', async () => {
    const p2025 = new Error('Record to update not found');
    p2025.code = 'P2025';

    prisma.$transaction.mockImplementationOnce(() => Promise.reject(p2025));
    prisma.wallet.findUnique.mockResolvedValue(WALLET_EMPTY);

    const res = await request(buildApp())
      .post(`/api/v1/creators/${CREATOR_USER.id}/subscribe`)
      .send({ tierId: TIER.id });

    expect(res.status).toBe(402);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/coins/i);
  });

  // ── Already subscribed (active subscription) ────────────────────────────────
  test('returns 200 with "Already subscribed" when subscription is still active', async () => {
    prisma.creatorSubscription.findUnique.mockResolvedValue(SUBSCRIPTION);

    const res = await request(buildApp())
      .post(`/api/v1/creators/${CREATOR_USER.id}/subscribe`)
      .send({ tierId: TIER.id });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/already subscribed/i);
    // Transaction must NOT be called — no charge for an already-active sub
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // ── Cannot subscribe to yourself ────────────────────────────────────────────
  test('returns 400 when subscriber tries to subscribe to themselves', async () => {
    const res = await request(buildApp())
      .post(`/api/v1/creators/${SUBSCRIBER.id}/subscribe`)
      .send({ tierId: TIER.id });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/yourself/i);
  });

  // ── Creator not found ────────────────────────────────────────────────────────
  test('returns 404 when creator profile does not exist', async () => {
    prisma.creatorProfile.findUnique.mockResolvedValue(null);

    const res = await request(buildApp())
      .post(`/api/v1/creators/nonexistent-user/subscribe`)
      .send({ tierId: TIER.id });

    expect(res.status).toBe(404);
  });

  // ── Tier not found / inactive ────────────────────────────────────────────────
  test('returns 404 when tierId does not exist in creator profile', async () => {
    const res = await request(buildApp())
      .post(`/api/v1/creators/${CREATOR_USER.id}/subscribe`)
      .send({ tierId: 'nonexistent-tier' });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/tier not found/i);
  });

  // ── SUBSCRIPTION ledger failure rolls back entire transaction ───────────────
  test('ledger write failure rolls back entire subscription transaction', async () => {
    const ledgerError = new Error('Ledger DB write failed');

    prisma.$transaction.mockImplementationOnce(async (fn) => {
      return fn({
        wallet: {
          update: jest.fn().mockResolvedValue({ ...WALLET_WITH_FUNDS, coins: 400 }),
          upsert: jest.fn().mockResolvedValue({ userId: CREATOR_USER.id, diamonds: 50 }),
        },
        creatorSubscription: {
          upsert: jest.fn().mockResolvedValue(SUBSCRIPTION),
        },
        creatorProfile: {
          update: jest.fn().mockResolvedValue(CREATOR_PROFILE),
        },
        walletTransaction: {
          // Simulates the fatal ledger write failing
          create: jest.fn().mockRejectedValue(ledgerError),
        },
        platformRevenueEntry: {
          create: jest.fn().mockResolvedValue({ id: 'pre-1' }),
        },
      });
    });

    const res = await request(buildApp())
      .post(`/api/v1/creators/${CREATOR_USER.id}/subscribe`)
      .send({ tierId: TIER.id });

    // The transaction must propagate the error — no silent swallowing
    expect(res.status).toBe(500);
  });

  // ── Concurrent subscriptions: second fails with 402 ─────────────────────────
  test('concurrent subscribe race: second concurrent attempt gets 402 (P2025)', async () => {
    // First call succeeds
    prisma.$transaction.mockImplementationOnce(async (fn) => {
      return fn({
        wallet:              { update: jest.fn().mockResolvedValue({ ...WALLET_WITH_FUNDS, coins: 400 }), upsert: jest.fn().mockResolvedValue({}) },
        creatorSubscription: { upsert: jest.fn().mockResolvedValue(SUBSCRIPTION) },
        creatorProfile:      { update: jest.fn().mockResolvedValue(CREATOR_PROFILE) },
        walletTransaction:   { create: jest.fn().mockResolvedValue({ id: 'wt-1' }) },
        platformRevenueEntry: { create: jest.fn().mockResolvedValue({ id: 'pre-1' }) },
      });
    });

    // Second call — OL miss (another worker already decremented the coins)
    const p2025 = new Error('Record to update not found');
    p2025.code = 'P2025';
    prisma.$transaction.mockImplementationOnce(() => Promise.reject(p2025));
    prisma.wallet.findUnique
      .mockResolvedValueOnce(WALLET_WITH_FUNDS)  // first call's pre-check
      .mockResolvedValueOnce(WALLET_EMPTY);       // second call's balance readback

    const app = buildApp();

    const [res1, res2] = await Promise.all([
      request(app).post(`/api/v1/creators/${CREATOR_USER.id}/subscribe`).send({ tierId: TIER.id }),
      request(app).post(`/api/v1/creators/${CREATOR_USER.id}/subscribe`).send({ tierId: TIER.id }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    // One succeeds (200) and one gets 402
    expect(statuses).toEqual([200, 402]);
  });

  // ── SUPER_ADMIN isolation ────────────────────────────────────────────────────
  test('SUPER_ADMIN gets 403 on subscribe', async () => {
    const res = await request(buildApp(SUPER_ADMIN))
      .post(`/api/v1/creators/${CREATOR_USER.id}/subscribe`)
      .send({ tierId: TIER.id });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/SUPER_ADMIN/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIP TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/creators/:userId/tip', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    prisma.creatorProfile.findUnique.mockResolvedValue(CREATOR_PROFILE);
    prisma.creatorTip.findUnique.mockResolvedValue(null); // no existing tip
    prisma.wallet.findUnique.mockResolvedValue(WALLET_WITH_FUNDS);
    mockSuccessfulTipTransaction();
  });

  // ── Happy path with TIP_SEND ledger ─────────────────────────────────────────
  test('happy path: coins deducted, diamonds credited, TIP_SEND ledger written', async () => {
    const mockWalletUpdate = jest.fn().mockResolvedValue({ ...WALLET_WITH_FUNDS, coins: 450 });
    const mockWalletUpsert = jest.fn().mockResolvedValue({ userId: CREATOR_USER.id, diamonds: 25 });
    const mockTipCreate    = jest.fn().mockResolvedValue(TIP);
    const mockLedgerCreate = jest.fn().mockResolvedValue({ id: 'wt-2' });

    prisma.$transaction.mockImplementationOnce(async (fn) => {
      return fn({
        wallet:              { update: mockWalletUpdate, upsert: mockWalletUpsert },
        creatorTip:          { create: mockTipCreate },
        creatorProfile:      { update: jest.fn().mockResolvedValue(CREATOR_PROFILE) },
        walletTransaction:   { create: mockLedgerCreate },
        platformRevenueEntry: { create: jest.fn().mockResolvedValue({ id: 'pre-tip-1' }) },
      });
    });

    const res = await request(buildApp())
      .post(`/api/v1/creators/${CREATOR_USER.id}/tip`)
      .send({ amount: 50, message: 'Great content!', idempotencyKey: 'idem-key-123' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.coinsSpent).toBe(50);
    // diamonds = toDiamonds(50) = Math.floor(50 * 50 / 100) = 25
    expect(res.body.data.diamondsEarned).toBe(25);

    // Verify TIP_SEND ledger written
    expect(mockLedgerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type:  'TIP_SEND',
          coins: -50,
        }),
      })
    );

    // F-05: verify TIP_RECEIVE ledger entry written for creator (diamond credit)
    expect(mockLedgerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type:     'TIP_RECEIVE',
          userId:   CREATOR_USER.id,
          diamonds: 25,
          tipId:    TIP.id,
        }),
      })
    );

    // Verify coins deducted from sender
    // P1-001 FIX: wallet.update now uses optimistic lock WHERE coins >= amount
    expect(mockWalletUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: SUBSCRIBER.id,
          coins:  { gte: 50 },         // optimistic lock added by P1-001
        }),
        data: expect.objectContaining({ coins: { decrement: 50 } }),
      })
    );
  });

  // ── Idempotency: same key returns existing tip ───────────────────────────────
  test('idempotency key prevents double-tip', async () => {
    prisma.creatorTip.findUnique.mockResolvedValue(TIP);

    const res = await request(buildApp())
      .post(`/api/v1/creators/${CREATOR_USER.id}/tip`)
      .send({ amount: 50, message: 'Dupe tip', idempotencyKey: 'idem-key-123' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/already sent/i);
    // Transaction must NOT be called for a duplicate tip
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // ── Insufficient balance ─────────────────────────────────────────────────────
  // P1-001 FIX: The pre-transaction wallet.findUnique balance check was removed
  // to fix the TOCTOU race. Insufficient balance is now detected via the optimistic
  // lock inside the transaction (WHERE coins >= amount) which throws P2025.
  // This test reflects the new behavior: transaction is entered, P2025 is thrown,
  // and the controller returns 402 with the current balance.
  test('returns 402 when sender has insufficient coins', async () => {
    // No longer reads wallet before tx — 402 comes from P2025 inside transaction
    prisma.$transaction.mockImplementationOnce(async (fn) => {
      const err = new Error('Record to update not found');
      err.code  = 'P2025';
      throw err;
    });
    // wallet.findUnique is called AFTER P2025 to get current balance for error msg
    prisma.wallet.findUnique.mockResolvedValue({ ...WALLET_EMPTY, coins: 5 });

    const res = await request(buildApp())
      .post(`/api/v1/creators/${CREATOR_USER.id}/tip`)
      .send({ amount: 100, message: 'Too expensive' });

    expect(res.status).toBe(402);
    expect(res.body.message).toMatch(/coins/i);
  });

  // ── Cannot tip yourself ──────────────────────────────────────────────────────
  test('returns 400 when user tips themselves', async () => {
    const res = await request(buildApp())
      .post(`/api/v1/creators/${SUBSCRIBER.id}/tip`)
      .send({ amount: 50 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/yourself/i);
  });

  // ── Invalid tip amount ───────────────────────────────────────────────────────
  test('returns 400 when amount is 0 or missing', async () => {
    const res = await request(buildApp())
      .post(`/api/v1/creators/${CREATOR_USER.id}/tip`)
      .send({ amount: 0 });

    expect(res.status).toBe(400);
  });

  // ── TIP_SEND ledger failure rolls back transaction ───────────────────────────
  test('TIP_SEND ledger failure rolls back entire tip transaction', async () => {
    const ledgerError = new Error('Ledger write failed — DB timeout');

    prisma.$transaction.mockImplementationOnce(async (fn) => {
      return fn({
        wallet:            { update: jest.fn().mockResolvedValue({}), upsert: jest.fn().mockResolvedValue({}) },
        creatorTip:        { create: jest.fn().mockResolvedValue(TIP) },
        creatorProfile:    { update: jest.fn().mockResolvedValue(CREATOR_PROFILE) },
        walletTransaction: { create: jest.fn().mockRejectedValue(ledgerError) },
        platformRevenueEntry: { create: jest.fn().mockResolvedValue({ id: 'pre-1' }) },
      });
    });

    const res = await request(buildApp())
      .post(`/api/v1/creators/${CREATOR_USER.id}/tip`)
      .send({ amount: 50, message: 'Will fail' });

    // Ledger failure must bubble up — no silent suppression
    expect(res.status).toBe(500);
  });

  // ── Creator not found ────────────────────────────────────────────────────────
  test('returns 404 when creator profile not found', async () => {
    prisma.creatorProfile.findUnique.mockResolvedValue(null);

    const res = await request(buildApp())
      .post(`/api/v1/creators/ghost-user/tip`)
      .send({ amount: 50 });

    expect(res.status).toBe(404);
  });

  // ── SUPER_ADMIN isolation ────────────────────────────────────────────────────
  test('SUPER_ADMIN gets 403 on sendTip', async () => {
    const res = await request(buildApp(SUPER_ADMIN))
      .post(`/api/v1/creators/${CREATOR_USER.id}/tip`)
      .send({ amount: 50 });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/SUPER_ADMIN/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BECOME CREATOR TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/creators/me/become', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('SUPER_ADMIN gets 403 on becomeCreator', async () => {
    const res = await request(buildApp(SUPER_ADMIN))
      .post('/api/v1/creators/me/become')
      .send({ displayName: 'Admin Creator' });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/SUPER_ADMIN/i);
    expect(prisma.creatorProfile.findUnique).not.toHaveBeenCalled();
  });

  test('MEMBER can become creator', async () => {
    prisma.creatorProfile.findUnique.mockResolvedValue(null); // not yet a creator
    prisma.creatorProfile.create.mockResolvedValue({
      id: 'new-profile-1',
      userId: SUBSCRIBER.id,
      displayName: 'Alice Creator',
      tagline: null,
      links: null,
      isActive: true,
      user: { id: SUBSCRIBER.id, firstName: 'Alice', lastName: 'Sub', avatarUrl: null },
    });

    const res = await request(buildApp())
      .post('/api/v1/creators/me/become')
      .send({ displayName: 'Alice Creator' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.displayName).toBe('Alice Creator');
  });

  test('returns 200 with existing profile if user is already a creator', async () => {
    prisma.creatorProfile.findUnique.mockResolvedValue({
      id: 'existing-profile',
      userId: SUBSCRIBER.id,
      displayName: 'Alice Creator',
    });

    const res = await request(buildApp())
      .post('/api/v1/creators/me/become')
      .send({ displayName: 'Alice Creator Again' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/already a creator/i);
    expect(prisma.creatorProfile.create).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/creators/me/dashboard', () => {
  const RECENT_TIPS = [
    { id: 'tip-a', amount: 50, diamondsEarned: 25, createdAt: new Date(), sender: { id: 'u1', firstName: 'Charlie', lastName: 'D', avatarUrl: null } },
    { id: 'tip-b', amount: 30, diamondsEarned: 15, createdAt: new Date(), sender: { id: 'u2', firstName: 'Diana', lastName: 'E', avatarUrl: null } },
  ];

  const RECENT_SUBS = [
    { id: 'sub-a', createdAt: new Date(), subscriber: { id: 'u3', firstName: 'Eve', lastName: 'F', avatarUrl: null }, tier: { id: TIER.id, name: 'Gold', priceCoins: 100 } },
  ];

  const CREATOR_WALLET = { userId: SUBSCRIBER.id, coins: 0, diamonds: 500 };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns correct aggregated dashboard data', async () => {
    // Creator profile for the requesting user (SUBSCRIBER acts as the creator here)
    prisma.creatorProfile.findUnique.mockResolvedValue({
      ...CREATOR_PROFILE,
      userId: SUBSCRIBER.id, // owner is the requesting user
    });

    prisma.creatorTip.findMany.mockResolvedValue(RECENT_TIPS);
    prisma.creatorSubscription.findMany.mockResolvedValue(RECENT_SUBS);
    prisma.creatorSubscription.count.mockResolvedValue(3);
    prisma.wallet.findUnique.mockResolvedValue(CREATOR_WALLET);

    const res = await request(buildApp())
      .get('/api/v1/creators/me/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { stats, recentTips, recentSubs, wallet } = res.body.data;

    // Aggregate checks
    expect(stats.activeSubs).toBe(3);
    expect(stats.tipsLast30d).toBe(2);        // 2 recent tips returned
    expect(stats.tipsTotal30d).toBe(80);       // 50 + 30
    expect(stats.totalEarned).toBe(CREATOR_PROFILE.totalEarned);
    expect(stats.subscriberCount).toBe(CREATOR_PROFILE.subscriberCount);

    expect(recentTips).toHaveLength(2);
    expect(recentSubs).toHaveLength(1);

    // Wallet coins/diamonds present
    expect(wallet.coins).toBe(0);
    expect(wallet.diamonds).toBe(500);
  });

  test('returns 404 when user is not a creator', async () => {
    prisma.creatorProfile.findUnique.mockResolvedValue(null);

    const res = await request(buildApp())
      .get('/api/v1/creators/me/dashboard');

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not a creator/i);
  });

  test('dashboard with zero tips returns tipsTotal30d of 0', async () => {
    prisma.creatorProfile.findUnique.mockResolvedValue({
      ...CREATOR_PROFILE,
      userId: SUBSCRIBER.id,
    });
    prisma.creatorTip.findMany.mockResolvedValue([]);
    prisma.creatorSubscription.findMany.mockResolvedValue([]);
    prisma.creatorSubscription.count.mockResolvedValue(0);
    prisma.wallet.findUnique.mockResolvedValue(CREATOR_WALLET);

    const res = await request(buildApp())
      .get('/api/v1/creators/me/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.data.stats.tipsTotal30d).toBe(0);
    expect(res.body.data.stats.tipsLast30d).toBe(0);
    expect(res.body.data.stats.activeSubs).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DEPRECATED PAYOUT ENDPOINT TESTS (re-verified here for completeness)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Deprecated creator payout endpoints → HTTP 410', () => {
  test('POST /me/payout-request returns 410 with redirect', async () => {
    const res = await request(buildApp())
      .post('/api/v1/creators/me/payout-request')
      .send({ diamonds: 2000 });

    expect(res.status).toBe(410);
    expect(res.body.message).toMatch(/wallet\/payout\/request/i);
  });

  test('GET /me/payout-info returns 410 with redirect', async () => {
    const res = await request(buildApp())
      .get('/api/v1/creators/me/payout-info');

    expect(res.status).toBe(410);
    expect(res.body.message).toMatch(/wallet\/payout\/info/i);
  });
});
