'use strict';
/**
 * Sprint 9 — User Profile Drill-Down Regression Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * UIGAP-003: GET /api/v1/admin/stats/users/:id/wallet
 *   - SUPER_ADMIN gets wallet + transactions + school memberships
 *   - Non-existent user returns 404
 *   - Deleted user returns 404
 *   - MEMBER gets 403 (SA-only endpoint)
 *   - Unauthenticated gets 401
 *   - Returns zero-balance wallet when no wallet record exists
 *   - Returns empty arrays when no transactions/memberships
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

const request      = require('supertest');
const express      = require('express');
const cookieParser = require('cookie-parser');
const prisma       = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');
const fs   = require('fs');
const path = require('path');

// ─── App setup ────────────────────────────────────────────────────────────────
let app;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/admin/stats', require('../routes/admin-stats.routes'));
  app.use((err, req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function asUser(id, role, schoolId = null) {
  const u = { id, role, status: 'ACTIVE', schoolId, firstName: 'T', lastName: 'U', avatarUrl: null, deletedAt: null };
  verifyAccessToken.mockReturnValue({ userId: id, role, schoolId });
  prisma.user.findUnique.mockResolvedValue(u);
  return u;
}
function tok(id) { return `Bearer t-${id}`; }

const TARGET_ID = 'user-target-profile';
const TARGET = {
  id: TARGET_ID, email: 'target@example.com',
  firstName: 'Jane', lastName: 'Doe', deletedAt: null,
};
const WALLET = { coins: 1500, diamonds: 200, totalSpent: 3000, totalEarned: 200, updatedAt: new Date() };
const TXS = [
  { id: 'tx-1', type: 'STRIPE_PURCHASE', coins: 1000, description: 'Stripe buy', stripeSessionId: 'cs_abc', packageId: 'pkg-1', createdAt: new Date() },
  { id: 'tx-2', type: 'ADMIN_GRANT', coins: 500, description: 'Admin grant', stripeSessionId: null, packageId: null, createdAt: new Date() },
];
const MEMBERSHIPS = [
  {
    id: 'mem-1', schoolId: 'sch-1', role: 'MEMBER', status: 'ACTIVE', joinedAt: new Date(),
    school: { id: 'sch-1', name: 'Test School', slug: 'test', logoUrl: null, type: 'PRIMARY', isActive: true }
  }
];

beforeEach(() => {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);

  // Default wallet/tx/membership mocks
  if (!prisma.wallet) prisma.wallet = {};
  prisma.wallet.findUnique = jest.fn().mockResolvedValue(WALLET);

  if (!prisma.walletTransaction) prisma.walletTransaction = {};
  prisma.walletTransaction.findMany = jest.fn().mockResolvedValue(TXS);

  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  prisma.schoolMembership.findMany = jest.fn().mockResolvedValue(MEMBERSHIPS);
});

// ─────────────────────────────────────────────────────────────────────────────
// Access control
// ─────────────────────────────────────────────────────────────────────────────
describe('UIGAP-003: /admin/stats/users/:id/wallet access control', () => {
  test('Unauthenticated returns 401', async () => {
    const res = await request(app).get(`/api/v1/admin/stats/users/${TARGET_ID}/wallet`);
    expect(res.status).toBe(401);
  });

  test('MEMBER returns 403', async () => {
    asUser('mb-1', 'MEMBER');
    const res = await request(app)
      .get(`/api/v1/admin/stats/users/${TARGET_ID}/wallet`)
      .set('Authorization', tok('mb-1'));
    expect(res.status).toBe(403);
  });

  test('SCHOOL_ADMIN returns 403', async () => {
    asUser('sca-1', 'SCHOOL_ADMIN', 'sch-1');
    const res = await request(app)
      .get(`/api/v1/admin/stats/users/${TARGET_ID}/wallet`)
      .set('Authorization', tok('sca-1'));
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error cases
// ─────────────────────────────────────────────────────────────────────────────
describe('UIGAP-003: /admin/stats/users/:id/wallet error handling', () => {
  test('Non-existent user returns 404', async () => {
    asUser('sa-1', 'SUPER_ADMIN');
    // First findUnique is the auth check, second is the target user lookup
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'sa-1', role: 'SUPER_ADMIN', status: 'ACTIVE', schoolId: null, firstName: 'A', lastName: 'S', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce(null); // target not found
    const res = await request(app)
      .get(`/api/v1/admin/stats/users/does-not-exist/wallet`)
      .set('Authorization', tok('sa-1'));
    expect(res.status).toBe(404);
  });

  test('Deleted user returns 404', async () => {
    asUser('sa-1', 'SUPER_ADMIN');
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'sa-1', role: 'SUPER_ADMIN', status: 'ACTIVE', schoolId: null, firstName: 'A', lastName: 'S', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce(null); // deleted user filtered by deletedAt: null
    const res = await request(app)
      .get(`/api/v1/admin/stats/users/${TARGET_ID}/wallet`)
      .set('Authorization', tok('sa-1'));
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────────────────────────────────────
describe('UIGAP-003: /admin/stats/users/:id/wallet data', () => {
  beforeEach(() => {
    // Set up SA auth + target user lookup
    const sa = { id: 'sa-1', role: 'SUPER_ADMIN', status: 'ACTIVE', schoolId: null, firstName: 'A', lastName: 'S', avatarUrl: null, deletedAt: null };
    verifyAccessToken.mockReturnValue({ userId: 'sa-1', role: 'SUPER_ADMIN', schoolId: null });
    prisma.user.findUnique
      .mockResolvedValueOnce(sa)   // auth middleware
      .mockResolvedValueOnce(TARGET); // route handler
  });

  test('Returns 200 with wallet, transactions, and memberships', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/stats/users/${TARGET_ID}/wallet`)
      .set('Authorization', tok('sa-1'));
    expect(res.status).toBe(200);
    expect(res.body.data.wallet.coins).toBe(1500);
    expect(res.body.data.wallet.diamonds).toBe(200);
    expect(res.body.data.recentTransactions).toHaveLength(2);
    expect(res.body.data.schoolMemberships).toHaveLength(1);
    expect(res.body.data.user.email).toBe('target@example.com');
  });

  test('Returns zero-balance wallet when no wallet record exists', async () => {
    prisma.wallet.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .get(`/api/v1/admin/stats/users/${TARGET_ID}/wallet`)
      .set('Authorization', tok('sa-1'));
    expect(res.status).toBe(200);
    expect(res.body.data.wallet.coins).toBe(0);
    expect(res.body.data.wallet.diamonds).toBe(0);
  });

  test('Returns empty arrays when no transactions exist', async () => {
    prisma.walletTransaction.findMany.mockResolvedValue([]);
    const res = await request(app)
      .get(`/api/v1/admin/stats/users/${TARGET_ID}/wallet`)
      .set('Authorization', tok('sa-1'));
    expect(res.status).toBe(200);
    expect(res.body.data.recentTransactions).toEqual([]);
  });

  test('Returns empty memberships when user has none', async () => {
    prisma.schoolMembership.findMany.mockResolvedValue([]);
    const res = await request(app)
      .get(`/api/v1/admin/stats/users/${TARGET_ID}/wallet`)
      .set('Authorization', tok('sa-1'));
    expect(res.status).toBe(200);
    expect(res.body.data.schoolMemberships).toEqual([]);
  });

  test('Response includes expected data shape', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/stats/users/${TARGET_ID}/wallet`)
      .set('Authorization', tok('sa-1'));
    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data).toHaveProperty('user');
    expect(data).toHaveProperty('wallet');
    expect(data).toHaveProperty('recentTransactions');
    expect(data).toHaveProperty('schoolMemberships');
  });

  test('Transactions include type, coins, and description fields', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/stats/users/${TARGET_ID}/wallet`)
      .set('Authorization', tok('sa-1'));
    const tx = res.body.data.recentTransactions[0];
    expect(tx).toHaveProperty('type');
    expect(tx).toHaveProperty('coins');
    expect(tx).toHaveProperty('description');
    expect(tx).toHaveProperty('createdAt');
  });

  test('School memberships include school name and role', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/stats/users/${TARGET_ID}/wallet`)
      .set('Authorization', tok('sa-1'));
    const mem = res.body.data.schoolMemberships[0];
    expect(mem.school.name).toBe('Test School');
    expect(mem.role).toBe('MEMBER');
    expect(mem.status).toBe('ACTIVE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-level verification
// ─────────────────────────────────────────────────────────────────────────────
describe('UIGAP-003: Source verification', () => {
  test('admin-stats.routes.js contains wallet endpoint for user profile', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../routes/admin-stats.routes.js'), 'utf8'
    );
    expect(src).toMatch(/users\/:id\/wallet/);
    expect(src).toMatch(/UIGAP-003/);
    expect(src).toMatch(/walletTransaction\.findMany/);
    expect(src).toMatch(/schoolMembership\.findMany/);
  });

  test('Profile page file exists at the correct route path', () => {
    // __dirname = backend/src/tests — go 3 levels up to reach workspace root
    const workspaceRoot = path.resolve(__dirname, '../../..');
    const pagePath = path.join(
      workspaceRoot,
      'frontend', 'src', 'app', '(dashboard)', 'admin', 'users', '[id]', 'page.tsx'
    );
    expect(fs.existsSync(pagePath)).toBe(true);
  });
});
