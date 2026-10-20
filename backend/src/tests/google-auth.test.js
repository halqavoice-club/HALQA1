'use strict';

/**
 * google-auth.test.js
 *
 * Tests for POST /api/v1/auth/google
 *
 * All Google credential verification is mocked — we never make real Google API calls.
 * The OAuth2Client.verifyIdToken() is replaced with a jest mock throughout.
 */

const request = require('supertest');

// ─── Mock google-auth-library BEFORE requiring app ───────────────────────────
// This ensures the require() in googleAuth.controller.js gets the mock.
jest.mock('google-auth-library', () => {
  const mockVerifyIdToken = jest.fn();
  const mockGetPayload    = jest.fn();

  return {
    OAuth2Client: jest.fn().mockImplementation(() => ({
      verifyIdToken: mockVerifyIdToken,
    })),
    __mockVerifyIdToken: mockVerifyIdToken,
    __mockGetPayload:    mockGetPayload,
  };
});

const { __mockVerifyIdToken, __mockGetPayload } = require('google-auth-library');

// Helper: set up a successful Google verification returning the given payload
function mockGoogleSuccess(payload = {}) {
  const defaultPayload = {
    sub:            'google-sub-123',
    email:          'google_test@example.com',
    name:           'Google Test User',
    picture:        'https://lh3.googleusercontent.com/photo.jpg',
    email_verified: true,
    iss:            'accounts.google.com',
    aud:            'test-client-id.apps.googleusercontent.com',
    exp:            Math.floor(Date.now() / 1000) + 3600,
  };
  const merged = { ...defaultPayload, ...payload };
  __mockGetPayload.mockReturnValue(merged);
  __mockVerifyIdToken.mockResolvedValue({ getPayload: __mockGetPayload });
}

// Helper: make verifyIdToken throw
function mockGoogleFailure(message = 'Token verification failed') {
  __mockVerifyIdToken.mockRejectedValue(new Error(message));
}

let app;
let prisma;

beforeAll(async () => {
  // Set GOOGLE_CLIENT_ID so the controller doesn't throw "not configured"
  process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
  app    = require('../app');
  prisma = require('../utils/prisma');
});

afterEach(async () => {
  // Clean up any Google test users created during tests
  await prisma.authProvider.deleteMany({ where: { provider: 'GOOGLE', providerAccountId: { startsWith: 'google-sub' } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { endsWith: '@example.com' }, emailVerified: true, passwordHash: null } }).catch(() => {});
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. VALID GOOGLE LOGIN — new user
// ─────────────────────────────────────────────────────────────────────────────
test('Valid Google credential creates new MEMBER user and returns HALQA tokens', async () => {
  mockGoogleSuccess({ sub: 'google-sub-new', email: 'new_google@example.com', name: 'New User' });

  const res = await request(app)
    .post('/api/v1/auth/google')
    .send({ credential: 'valid-google-id-token' });

  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.data.user).toBeDefined();
  expect(res.body.data.user.email).toBe('new_google@example.com');
  expect(res.body.data.user.role).toBe('MEMBER');  // NEVER any education role
  expect(res.body.data.accessToken).toBeDefined();
  expect(res.body.data.refreshToken).toBeDefined();
  expect(res.body.data.isNewUser).toBe(true);

  // Verify AuthProvider record was created
  const provider = await prisma.authProvider.findUnique({
    where: { provider_providerAccountId: { provider: 'GOOGLE', providerAccountId: 'google-sub-new' } }
  });
  expect(provider).not.toBeNull();
  expect(provider.userId).toBe(res.body.data.user.id);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. VALID GOOGLE LOGIN — returning user
// ─────────────────────────────────────────────────────────────────────────────
test('Returning Google user (existing AuthProvider) authenticates without creating duplicate', async () => {
  // First login — creates user + provider
  mockGoogleSuccess({ sub: 'google-sub-returning', email: 'returning@example.com', name: 'Returning User' });
  const first = await request(app).post('/api/v1/auth/google').send({ credential: 'token' });
  expect(first.status).toBe(200);
  expect(first.body.data.isNewUser).toBe(true);

  // Second login — should authenticate existing user
  mockGoogleSuccess({ sub: 'google-sub-returning', email: 'returning@example.com' });
  const second = await request(app).post('/api/v1/auth/google').send({ credential: 'token' });
  expect(second.status).toBe(200);
  expect(second.body.data.isNewUser).toBeFalsy();  // not a new user
  expect(second.body.data.user.id).toBe(first.body.data.user.id);  // same user

  // Verify only one AuthProvider record exists
  const count = await prisma.authProvider.count({
    where: { provider: 'GOOGLE', providerAccountId: 'google-sub-returning' }
  });
  expect(count).toBe(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. ACCOUNT LINKING — existing HALQA email account
// ─────────────────────────────────────────────────────────────────────────────
test('Google login with existing HALQA email links accounts without creating duplicate', async () => {
  const existingEmail = 'existing_halqa@example.com';

  // Create a pre-existing HALQA user (password login)
  const hash = require('bcryptjs').hashSync('Password@123', 10);
  const existing = await prisma.user.create({
    data: { email: existingEmail, passwordHash: hash, firstName: 'Existing', lastName: 'User', role: 'MEMBER', status: 'ACTIVE', emailVerified: true }
  });

  mockGoogleSuccess({ sub: 'google-sub-linking', email: existingEmail });
  const res = await request(app).post('/api/v1/auth/google').send({ credential: 'token' });

  expect(res.status).toBe(200);
  // Must authenticate the existing user, not create a new one
  expect(res.body.data.user.id).toBe(existing.id);
  expect(res.body.data.isNewUser).toBeFalsy();

  // AuthProvider must be linked to the existing user
  const provider = await prisma.authProvider.findUnique({
    where: { provider_providerAccountId: { provider: 'GOOGLE', providerAccountId: 'google-sub-linking' } }
  });
  expect(provider.userId).toBe(existing.id);

  await prisma.user.delete({ where: { id: existing.id } }).catch(() => {});
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. INVALID GOOGLE CREDENTIAL
// ─────────────────────────────────────────────────────────────────────────────
test('Invalid Google credential returns 401', async () => {
  mockGoogleFailure('Invalid token');

  const res = await request(app)
    .post('/api/v1/auth/google')
    .send({ credential: 'invalid-token' });

  expect(res.status).toBe(401);
  expect(res.body.success).toBe(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. EXPIRED GOOGLE CREDENTIAL
// ─────────────────────────────────────────────────────────────────────────────
test('Expired Google credential returns 401 with safe message', async () => {
  mockGoogleFailure('Token used too late');

  const res = await request(app)
    .post('/api/v1/auth/google')
    .send({ credential: 'expired-token' });

  expect(res.status).toBe(401);
  expect(res.body.message).toContain('expired');
  // Must NOT expose internal error details
  expect(res.body.message).not.toContain('Token used too late');
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. WRONG GOOGLE AUDIENCE (wrong client ID)
// ─────────────────────────────────────────────────────────────────────────────
test('Wrong Google audience returns 401', async () => {
  mockGoogleFailure('audience mismatch');

  const res = await request(app)
    .post('/api/v1/auth/google')
    .send({ credential: 'wrong-audience-token' });

  expect(res.status).toBe(401);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. MISSING CREDENTIAL
// ─────────────────────────────────────────────────────────────────────────────
test('Missing credential field returns 400 validation error', async () => {
  const res = await request(app)
    .post('/api/v1/auth/google')
    .send({});

  expect(res.status).toBe(400);
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. ROLE INJECTION ATTEMPT — must be ignored
// ─────────────────────────────────────────────────────────────────────────────
test('Role injection via request body is silently ignored — user always gets MEMBER', async () => {
  mockGoogleSuccess({ sub: 'google-sub-injection', email: 'injection@example.com' });

  const res = await request(app)
    .post('/api/v1/auth/google')
    .send({
      credential: 'valid-token',
      role:       'SUPER_ADMIN',    // injection attempt
      schoolId:   'some-school-id',
    });

  expect(res.status).toBe(200);
  expect(res.body.data.user.role).toBe('MEMBER');      // injection blocked
  expect(res.body.data.user.role).not.toBe('SUPER_ADMIN');
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. SUPER_ADMIN injection specifically blocked
// ─────────────────────────────────────────────────────────────────────────────
test('SUPER_ADMIN cannot be granted through Google login', async () => {
  mockGoogleSuccess({ sub: 'google-sub-superadmin', email: 'superadmin_try@example.com' });

  const res = await request(app)
    .post('/api/v1/auth/google')
    .send({ credential: 'token', role: 'SUPER_ADMIN' });

  expect(res.status).toBe(200);
  expect(res.body.data.user.role).toBe('MEMBER');

  // Verify DB also has MEMBER
  const user = await prisma.user.findUnique({ where: { email: 'superadmin_try@example.com' } });
  expect(user?.role).toBe('MEMBER');
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. SUSPENDED ACCOUNT
// ─────────────────────────────────────────────────────────────────────────────
test('Suspended HALQA account returns 403', async () => {
  const hash = require('bcryptjs').hashSync('Password@123', 10);
  // Clean up any leftover from a prior failed run before creating
  await prisma.user.deleteMany({ where: { email: 'suspended_g@example.com' } }).catch(() => {});
  const suspended = await prisma.user.create({
    data: { email: 'suspended_g@example.com', passwordHash: hash, firstName: 'Sus', lastName: 'User', role: 'MEMBER', status: 'SUSPENDED', emailVerified: true }
  });

  mockGoogleSuccess({ sub: 'google-sub-suspended', email: 'suspended_g@example.com' });

  const res = await request(app)
    .post('/api/v1/auth/google')
    .send({ credential: 'token' });

  expect(res.status).toBe(403);
  expect(res.body.message.toLowerCase()).toContain('suspended');

  await prisma.user.delete({ where: { id: suspended.id } }).catch(() => {});
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. DELETED ACCOUNT
// ─────────────────────────────────────────────────────────────────────────────
test('Deleted HALQA account returns 403', async () => {
  const hash = require('bcryptjs').hashSync('Password@123', 10);
  // Clean up any leftover from a prior failed run before creating
  await prisma.user.deleteMany({ where: { email: 'deleted_g@example.com' } }).catch(() => {});
  const deleted = await prisma.user.create({
    data: { email: 'deleted_g@example.com', passwordHash: hash, firstName: 'Del', lastName: 'User', role: 'MEMBER', status: 'ACTIVE', emailVerified: true, deletedAt: new Date() }
  });

  mockGoogleSuccess({ sub: 'google-sub-deleted', email: 'deleted_g@example.com' });

  const res = await request(app)
    .post('/api/v1/auth/google')
    .send({ credential: 'token' });

  expect(res.status).toBe(403);

  await prisma.user.delete({ where: { id: deleted.id } }).catch(() => {});
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. GOOGLE USER WITHOUT SCHOOL — can use social features
// ─────────────────────────────────────────────────────────────────────────────
test('Google user with no school has MEMBER role and no school memberships', async () => {
  mockGoogleSuccess({ sub: 'google-sub-noschool', email: 'noschool@example.com' });

  const res = await request(app)
    .post('/api/v1/auth/google')
    .send({ credential: 'token' });

  expect(res.status).toBe(200);
  expect(res.body.data.user.role).toBe('MEMBER');
  expect(res.body.data.user.schoolId).toBeNull();

  // No SchoolMembership records — user is social-only
  const memberships = await prisma.schoolMembership.findMany({
    where: { userId: res.body.data.user.id }
  });
  expect(memberships).toHaveLength(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. REFRESH TOKEN FLOW after Google login
// ─────────────────────────────────────────────────────────────────────────────
test('Refresh token works after Google login', async () => {
  mockGoogleSuccess({ sub: 'google-sub-refresh', email: 'refresh_test@example.com' });

  const loginRes = await request(app)
    .post('/api/v1/auth/google')
    .send({ credential: 'token' });

  expect(loginRes.status).toBe(200);
  const { refreshToken } = loginRes.body.data;

  // Use refresh token to get a new access token
  const refreshRes = await request(app)
    .post('/api/v1/auth/refresh')
    .send({ refreshToken });

  expect(refreshRes.status).toBe(200);
  expect(refreshRes.body.data.accessToken).toBeDefined();
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. LOGOUT after Google login
// ─────────────────────────────────────────────────────────────────────────────
test('Logout works after Google login', async () => {
  mockGoogleSuccess({ sub: 'google-sub-logout', email: 'logout_test@example.com' });

  const loginRes = await request(app)
    .post('/api/v1/auth/google')
    .send({ credential: 'token' });

  expect(loginRes.status).toBe(200);
  const { accessToken, refreshToken } = loginRes.body.data;

  const logoutRes = await request(app)
    .post('/api/v1/auth/logout')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ refreshToken });

  expect(logoutRes.status).toBe(200);
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. EXISTING PASSWORD LOGIN still works (no regression)
// ─────────────────────────────────────────────────────────────────────────────
test('Existing email/password login still works after Google auth addition', async () => {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'superadmin@halqa.com', password: 'Admin@2024' });

  expect(res.status).toBe(200);
  expect(res.body.data.accessToken).toBeDefined();
  expect(res.body.data.user.role).toBe('SUPER_ADMIN');
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. GOOGLE USER WITH STUDENT MEMBERSHIP — role comes from SchoolMembership
// ─────────────────────────────────────────────────────────────────────────────
test('Google user with STUDENT school membership: User.role stays MEMBER, Education role in SchoolMembership', async () => {
  mockGoogleSuccess({ sub: 'google-sub-student-membership', email: 'student_membership@example.com' });

  const loginRes = await request(app)
    .post('/api/v1/auth/google')
    .send({ credential: 'token' });

  expect(loginRes.status).toBe(200);
  const userId = loginRes.body.data.user.id;

  // Simulate being invited to a school as STUDENT (separate from auth)
  const school = await prisma.school.findFirst({ where: { slug: 'halqa-academy' } });
  if (school) {
    await prisma.schoolMembership.create({
      data: { userId, schoolId: school.id, role: 'STUDENT', status: 'ACTIVE', joinedAt: new Date() }
    }).catch(() => {});
  }

  // User.role is still MEMBER — Education role is in SchoolMembership
  const user = await prisma.user.findUnique({ where: { id: userId } });
  expect(user?.role).toBe('MEMBER');  // Global role NEVER changes due to school membership

  // Clean up
  if (school) await prisma.schoolMembership.deleteMany({ where: { userId, schoolId: school.id } }).catch(() => {});
});
