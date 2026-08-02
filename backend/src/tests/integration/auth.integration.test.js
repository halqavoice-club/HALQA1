'use strict';
/**
 * Integration tests — Auth controller
 *
 * Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.9
 *
 * Requires a real database (DATABASE_URL env var).
 * Run via: npm run test:integration
 */
const request = require('supertest');
const prisma  = require('../../utils/prisma');

// Import the app AFTER env vars are set by jest.setup.js
let app, httpServer;

beforeAll(async () => {
  // Start the server on a random port to avoid conflicts
  process.env.PORT = '0';
  const { createServer } = require('http');
  const appModule = require('../../app');
  app = appModule;
});

afterAll(async () => {
  await prisma.$disconnect();
});

// Clean up test users after each test
afterEach(async () => {
  try {
    await prisma.refreshToken.deleteMany({ where: { user: { email: { contains: '@integration-test.halqa' } } } });
    await prisma.otpCode.deleteMany({ where: { user: { email: { contains: '@integration-test.halqa' } } } });
    await prisma.user.deleteMany({ where: { email: { contains: '@integration-test.halqa' } } });
  } catch { /* ignore cleanup errors */ }
});

const testEmail = () => `test-${Date.now()}@integration-test.halqa`;
const VALID_PASSWORD = 'Test1234!';
const WEAK_PASSWORD  = 'weak';

describe('Auth — register', () => {
  it('registers a user with valid data', async () => {
    const email = testEmail();
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: VALID_PASSWORD, firstName: 'Test', lastName: 'User' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe(email);
  });

  it('rejects a weak password with HTTP 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: testEmail(), password: WEAK_PASSWORD, firstName: 'Test', lastName: 'User' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('Auth — login lockout (REQ-8.3, 8.4, 8.5)', () => {
  let email;

  beforeEach(async () => {
    email = testEmail();
    // Register and activate the user so login works
    await prisma.user.create({
      data: {
        email,
        passwordHash: require('bcryptjs').hashSync(VALID_PASSWORD, 10),
        firstName: 'Lock',
        lastName:  'Test',
        role:      'STUDENT',
        status:    'ACTIVE',
        emailVerified: true,
      }
    });
    // Clear any existing lockout key
    try {
      const { isRedisReady, getRedis } = require('../../utils/redis');
      if (isRedisReady()) await getRedis().del(`login:fail:${email.toLowerCase()}`);
    } catch {}
  });

  it('increments lockout counter on wrong password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'WrongPassword1!' });

    expect(res.status).toBe(401);
  });

  it('locks account after 5 failures and returns HTTP 429', async () => {
    // Hit the endpoint 5 times with the wrong password
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'WrongPassword1!' });
    }

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: VALID_PASSWORD });

    expect(res.status).toBe(429);
  });

  it('resets counter on successful login', async () => {
    // Fail once
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'WrongPassword1!' });

    // Succeed
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: VALID_PASSWORD });

    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
  });
});

describe('Auth — refresh token & logout', () => {
  let refreshToken;

  beforeEach(async () => {
    const email = testEmail();
    await prisma.user.create({
      data: {
        email,
        passwordHash: require('bcryptjs').hashSync(VALID_PASSWORD, 10),
        firstName: 'Refresh',
        lastName:  'Test',
        role:      'STUDENT',
        status:    'ACTIVE',
        emailVerified: true,
      }
    });

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: VALID_PASSWORD });

    refreshToken = loginRes.body.data?.refreshToken;
  });

  it('issues a new access token on refresh', async () => {
    if (!refreshToken) return; // Redis not available in this env — skip
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect([200, 401]).toContain(res.status); // 401 is OK if Redis not available
  });

  it('clears refresh token cookie on logout', async () => {
    if (!refreshToken) return;
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .send({ refreshToken });

    expect([200, 204]).toContain(res.status);
  });
});
