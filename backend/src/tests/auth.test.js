'use strict';
/**
 * Auth Controller Unit Tests — TE-001
 * All external deps mocked. No real DB/Redis needed.
 */
const request  = require('supertest');
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');

jest.mock('../utils/prisma');
jest.mock('../utils/redis', () => ({
  isRedisReady: jest.fn(() => false),
  getRedis:     jest.fn(),
}));
jest.mock('../utils/email', () => ({
  sendOtpEmail: jest.fn().mockResolvedValue(true),
}));

// Partial mock: keep real auth functions, allow tests to spy on authenticate
jest.mock('../middleware/auth.middleware', () => {
  const real = jest.requireActual('../middleware/auth.middleware');
  return {
    ...real,
    authenticate: jest.fn((req, _res, next) => {
      // Default: pass through as unauthenticated — tests override as needed
      next();
    }),
    authorize:           (..._r) => (_q, _s, next) => next(),
    requireSchoolAccess: (_q, _s, next) => next(),
    optionalAuth:        (_q, _s, next) => next(),
    invalidateUserCache: jest.fn(),
    USER_SELECT: {},
  };
});

const prisma = require('../utils/prisma');
const authMiddleware = require('../middleware/auth.middleware');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(require('cookie-parser')());
  app.use('/api/v1/auth', require('../routes/auth.routes'));
  app.use(require('../middleware/errorHandler'));
  return app;
}

function makeRefreshToken(userId = 'user-1', role = 'STUDENT') {
  return jwt.sign({ userId, role }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
}

const VALID_USER = {
  id: 'user-uuid-1', email: 'test@halqa.app',
  passwordHash: bcrypt.hashSync('Test1234', 10),
  firstName: 'Test', lastName: 'User',
  role: 'STUDENT', status: 'ACTIVE', schoolId: 'school-1', deletedAt: null,
  emailVerified: true,
  school: { id: 'school-1', name: 'Test School', slug: 'test-school' },
};

// ─── REGISTER ─────────────────────────────────────────────────────────────────
describe('POST /api/v1/auth/register', () => {
  let app;
  let txUserCreate, txWalletCreate;
  beforeEach(() => {
    app = buildApp(); jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.otpCode.create.mockResolvedValue({ id: 'otp-1' });

    // F-06: register now wraps user + wallet creation in $transaction
    txUserCreate = jest.fn().mockResolvedValue({ ...VALID_USER, status: 'PENDING' });
    txWalletCreate = jest.fn().mockResolvedValue({ id: 'w-1', userId: VALID_USER.id });
    prisma.$transaction.mockImplementation(async (fn) => fn({
      user:            { create: txUserCreate },
      wallet:          { create: txWalletCreate },
    }));
  });

  test('creates user with valid data', async () => {
    const res = await request(app).post('/api/v1/auth/register')
      .send({ email: 'new@halqa.app', password: 'Test1234', firstName: 'New', lastName: 'User' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('SECURITY: role from body is always MEMBER (social-only, no privilege escalation)', async () => {
    // Architecture change: new registrations default to MEMBER (Social-only).
    // Education roles (TEACHER, STUDENT, etc.) are assigned via SchoolMembership
    // when a user joins/creates a school — never at registration time.
    // This prevents privilege escalation (self-registering as SUPER_ADMIN etc.)
    await request(app).post('/api/v1/auth/register')
      .send({ email: 'admin@halqa.app', password: 'Test1234', firstName: 'A', lastName: 'B', role: 'SUPER_ADMIN' });
    expect(txUserCreate.mock.calls[0][0].data.role).toBe('MEMBER');
  });

  test('F-06: wallet created atomically with user at registration', async () => {
    const res = await request(app).post('/api/v1/auth/register')
      .send({ email: 'new@halqa.app', password: 'Test1234', firstName: 'New', lastName: 'User' });
    expect(res.status).toBe(201);
    // Wallet must be created inside the same transaction as the user
    expect(txWalletCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId:    VALID_USER.id,
          coins:     0,
          diamonds:  0,
          totalSpent: 0,
          totalEarned: 0,
        })
      })
    );
  });

  test('rejects duplicate email with 409', async () => {
    prisma.user.findUnique.mockResolvedValue(VALID_USER);
    const res = await request(app).post('/api/v1/auth/register')
      .send({ email: 'test@halqa.app', password: 'Test1234', firstName: 'X', lastName: 'Y' });
    expect(res.status).toBe(409);
  });

  test('SEC-003: rejects password without uppercase', async () => {
    const res = await request(app).post('/api/v1/auth/register')
      .send({ email: 'new@halqa.app', password: 'test1234', firstName: 'X', lastName: 'Y' });
    expect(res.status).toBe(400);
  });

  test('SEC-003: rejects password without digit', async () => {
    const res = await request(app).post('/api/v1/auth/register')
      .send({ email: 'new@halqa.app', password: 'TestOnly', firstName: 'X', lastName: 'Y' });
    expect(res.status).toBe(400);
  });

  test('SEC-003: rejects password shorter than 8', async () => {
    const res = await request(app).post('/api/v1/auth/register')
      .send({ email: 'new@halqa.app', password: 'T1', firstName: 'X', lastName: 'Y' });
    expect(res.status).toBe(400);
  });

  test('rejects invalid email format', async () => {
    const res = await request(app).post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: 'Test1234', firstName: 'X', lastName: 'Y' });
    expect(res.status).toBe(400);
  });

  test('rejects missing firstName', async () => {
    const res = await request(app).post('/api/v1/auth/register')
      .send({ email: 'new@halqa.app', password: 'Test1234', lastName: 'Y' });
    expect(res.status).toBe(400);
  });
});

// ─── LOGIN ────────────────────────────────────────────────────────────────────
describe('POST /api/v1/auth/login', () => {
  let app;
  beforeEach(() => {
    app = buildApp(); jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue(VALID_USER);
    prisma.refreshToken.create.mockResolvedValue({ id: 'rt-new' });
    prisma.user.update.mockResolvedValue(VALID_USER);
  });

  test('returns tokens on valid credentials', async () => {
    const res = await request(app).post('/api/v1/auth/login')
      .send({ email: VALID_USER.email, password: 'Test1234' });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  test('sets httpOnly refreshToken cookie', async () => {
    const res = await request(app).post('/api/v1/auth/login')
      .send({ email: VALID_USER.email, password: 'Test1234' });
    const cookies = res.headers['set-cookie'] || [];
    const rtCookie = cookies.find(c => c.startsWith('refreshToken='));
    expect(rtCookie).toBeDefined();
    expect(rtCookie).toMatch(/HttpOnly/i);
  });

  test('rejects wrong password with 401', async () => {
    const res = await request(app).post('/api/v1/auth/login')
      .send({ email: VALID_USER.email, password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid credentials/i);
  });

  test('non-existent email returns 401 with same message (no enumeration)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/api/v1/auth/login')
      .send({ email: 'ghost@halqa.app', password: 'Test1234' });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid credentials/i);
  });

  test('rejects SUSPENDED with 403', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...VALID_USER, status: 'SUSPENDED' });
    const res = await request(app).post('/api/v1/auth/login')
      .send({ email: VALID_USER.email, password: 'Test1234' });
    expect(res.status).toBe(403);
  });

  test('rejects PENDING with 403', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...VALID_USER, status: 'PENDING' });
    const res = await request(app).post('/api/v1/auth/login')
      .send({ email: VALID_USER.email, password: 'Test1234' });
    expect(res.status).toBe(403);
  });

  test('rejects deleted accounts with 401', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...VALID_USER, deletedAt: new Date() });
    const res = await request(app).post('/api/v1/auth/login')
      .send({ email: VALID_USER.email, password: 'Test1234' });
    expect(res.status).toBe(401);
  });

  test('SEC-004: locks account after 5 failed attempts (Redis enabled)', async () => {
    const redis = require('../utils/redis');
    redis.isRedisReady.mockReturnValue(true);
    redis.getRedis.mockReturnValue({
      get: jest.fn().mockResolvedValue('5'),
      incr: jest.fn().mockResolvedValue(6),
      expire: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
    });
    const res = await request(app).post('/api/v1/auth/login')
      .send({ email: VALID_USER.email, password: 'any' });
    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/too many/i);
    redis.isRedisReady.mockReturnValue(false);
  });

  test('rejects missing email field', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ password: 'Test1234' });
    expect(res.status).toBe(400);
  });
});

// ─── REFRESH TOKEN ────────────────────────────────────────────────────────────
describe('POST /api/v1/auth/refresh', () => {
  let app, validRT;
  beforeEach(() => {
    app = buildApp(); jest.clearAllMocks();
    validRT = makeRefreshToken(VALID_USER.id, VALID_USER.role);
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-1', token: validRT, userId: VALID_USER.id,
      isRevoked: false,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      user: VALID_USER,
    });
    prisma.$transaction.mockResolvedValue([{}, {}]);
  });

  test('returns new access token from body refresh token', async () => {
    const res = await request(app).post('/api/v1/auth/refresh')
      .send({ refreshToken: validRT });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
  });

  test('returns 401 for revoked token', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-1', token: validRT, userId: VALID_USER.id, isRevoked: true,
      expiresAt: new Date(Date.now() + 86400000), user: VALID_USER,
    });
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: validRT });
    expect(res.status).toBe(401);
  });

  test('returns 401 for expired token (DB level)', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-1', token: validRT, userId: VALID_USER.id, isRevoked: false,
      expiresAt: new Date(Date.now() - 1000), user: VALID_USER,
    });
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: validRT });
    expect(res.status).toBe(401);
  });

  test('returns 401 when no token provided', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({});
    expect(res.status).toBe(401);
  });
});

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
describe('POST /api/v1/auth/logout', () => {
  let app;
  beforeEach(() => {
    app = buildApp(); jest.clearAllMocks();
    // Set authenticate to inject user for this test
    authMiddleware.authenticate.mockImplementation((req, _res, next) => {
      req.user = VALID_USER; next();
    });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
  });

  test('returns 200 and revokes token', async () => {
    const res = await request(app).post('/api/v1/auth/logout').send({ refreshToken: 'tok' });
    expect(res.status).toBe(200);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isRevoked: true } })
    );
  });
});

// ─── FORGOT PASSWORD ──────────────────────────────────────────────────────────
describe('POST /api/v1/auth/forgot-password', () => {
  let app;
  beforeEach(() => {
    app = buildApp(); jest.clearAllMocks();
    prisma.otpCode.create.mockResolvedValue({ id: 'otp-fp' });
  });

  test('SECURITY: returns 200 for unknown email (no enumeration)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'ghost@test.com' });
    expect(res.status).toBe(200);
  });

  test('sends OTP for real user', async () => {
    prisma.user.findUnique.mockResolvedValue(VALID_USER);
    const { sendOtpEmail } = require('../utils/email');
    await request(app).post('/api/v1/auth/forgot-password').send({ email: VALID_USER.email });
    expect(sendOtpEmail).toHaveBeenCalledWith(VALID_USER.email, expect.any(String), 'password_reset');
  });
});

// ─── RESET PASSWORD ───────────────────────────────────────────────────────────
describe('POST /api/v1/auth/reset-password', () => {
  let app;
  beforeEach(() => {
    app = buildApp(); jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue(VALID_USER);
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-r', userId: VALID_USER.id, code: '123456',
      type: 'password_reset', isUsed: false,
      expiresAt: new Date(Date.now() + 600000),
    });
    prisma.$transaction.mockResolvedValue([{}, {}, {}]);
  });

  test('resets password with valid OTP', async () => {
    const res = await request(app).post('/api/v1/auth/reset-password')
      .send({ email: VALID_USER.email, otp: '123456', newPassword: 'NewPass1' });
    expect(res.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  test('SEC-003: rejects weak new password', async () => {
    const res = await request(app).post('/api/v1/auth/reset-password')
      .send({ email: VALID_USER.email, otp: '123456', newPassword: 'weak' });
    expect(res.status).toBe(400);
  });

  test('rejects invalid OTP', async () => {
    prisma.otpCode.findFirst.mockResolvedValue(null);
    const res = await request(app).post('/api/v1/auth/reset-password')
      .send({ email: VALID_USER.email, otp: '999999', newPassword: 'NewPass1' });
    expect(res.status).toBe(400);
  });
});
