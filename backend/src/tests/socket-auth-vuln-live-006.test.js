'use strict';
/**
 * VULN-LIVE-006 Regression Tests — Socket.IO Authentication Status Check
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Prior to this fix, the Socket.IO io.use() middleware only verified the JWT
 * signature and expiry. A user who was banned/suspended/deactivated after token
 * issuance could still establish a new Socket.IO connection for up to 15 minutes.
 *
 * Fix: Added getUserFromCache() + DB fallback + status/deletedAt check to io.use(),
 * mirroring the existing HTTP authenticate() middleware.
 *
 * Test coverage:
 *   1.  ACTIVE user            — cache hit                → accepted
 *   2.  BANNED user            — cache hit                → rejected
 *   2b. BANNED user            — cache returns banned     → rejected, no DB call
 *   3.  SUSPENDED user         — cache hit                → rejected
 *   4.  INACTIVE user          — cache hit                → rejected
 *   5.  Soft-deleted user      — cache hit                → rejected
 *   6.  Cache miss + ACTIVE DB — DB fallback              → accepted
 *   7.  Cache miss + BANNED DB — DB fallback              → rejected
 *   8.  User not found         — cache miss + DB null     → rejected
 *   9.  Missing token                                     → rejected
 *  10.  Expired JWT                                       → rejected
 *  10b. Invalid JWT signature                             → rejected
 *  11. SUPER_ADMIN ACTIVE                                 → accepted (platform invariant)
 *  12. Source code invariant check
 */

// ─── Mock auth.middleware so getUserFromCache is a controllable jest.fn() ─────
// This is the cleanest test seam: mock the cache helper directly rather than
// mocking Redis internals. The production app.js calls getUserFromCache()
// from auth.middleware — by mocking auth.middleware we test the handler logic
// without needing a real Redis connection.
jest.mock('../middleware/auth.middleware', () => ({
  getUserFromCache:    jest.fn(),
  invalidateUserCache: jest.fn(),
  USER_SELECT: {
    id: true, email: true, role: true, status: true, schoolId: true,
    firstName: true, lastName: true, avatarUrl: true, deletedAt: true,
  },
  authenticate:        jest.fn((req, res, next) => next()),
  authorize:           jest.fn(() => (req, res, next) => next()),
  optionalAuth:        jest.fn((req, res, next) => next()),
  requireSchoolAccess: jest.fn((req, res, next) => next()),
}));

// Prisma mock — explicit factory so user.findUnique is a proper jest.fn()
jest.mock('../utils/prisma', () => ({
  user: { findUnique: jest.fn() },
  $queryRawUnsafe:   jest.fn(),
  $executeRawUnsafe: jest.fn(),
}));

jest.mock('../utils/redis', () => ({
  isRedisReady: jest.fn(() => false),
  getCache:     jest.fn().mockResolvedValue(null),
  setCache:     jest.fn().mockResolvedValue(undefined),
  deleteCache:  jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/jwt', () => ({
  verifyAccessToken:    jest.fn(),
  generateAccessToken:  jest.fn(),
  generateRefreshToken: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────
const prisma              = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');
const { getUserFromCache, USER_SELECT } = require('../middleware/auth.middleware');

// ─── Inline handler — mirrors app.js io.use() exactly ────────────────────────
// Extracted for unit testing without spinning up Socket.IO.
// Must stay in sync with app.js whenever the production handler changes.
async function socketAuthHandler(socket, next) {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    const decoded = verifyAccessToken(token);

    let user = await getUserFromCache(decoded.userId);
    if (!user) {
      user = await prisma.user.findUnique({
        where:  { id: decoded.userId },
        select: USER_SELECT,
      });
    }

    if (!user)                       return next(new Error('Authentication failed'));
    if (user.status === 'BANNED')    return next(new Error('Account banned'));
    if (user.status === 'SUSPENDED') return next(new Error('Account suspended'));
    if (user.status === 'INACTIVE')  return next(new Error('Account inactive'));
    if (user.deletedAt)              return next(new Error('Authentication failed'));

    socket.userId       = user.id;
    socket.userRole     = user.role;
    socket.userSchoolId = user.schoolId ?? null;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return next(new Error('Token expired'));
    if (err.name === 'JsonWebTokenError') return next(new Error('Invalid token'));
    next(new Error('Authentication failed'));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeSocket(token) {
  return { handshake: { auth: { token } }, userId: undefined, userRole: undefined, userSchoolId: undefined };
}

function makeUser(overrides = {}) {
  return {
    id: 'user-1', role: 'MEMBER', status: 'ACTIVE',
    schoolId: null, firstName: 'T', lastName: 'U',
    avatarUrl: null, deletedAt: null, email: 't@t.com',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: cache miss — tests that need a cache hit set getUserFromCache mock explicitly
  getUserFromCache.mockResolvedValue(null);
  // Default: DB returns null — tests override per-test
  prisma.user.findUnique.mockResolvedValue(null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. ACTIVE user (cache hit) → accepted
// ─────────────────────────────────────────────────────────────────────────────
describe('1. ACTIVE user (cache hit) → accepted', () => {
  test('connection accepted; socket identity set from user record', async () => {
    verifyAccessToken.mockReturnValue({ userId: 'u1' });
    getUserFromCache.mockResolvedValue(makeUser({ id: 'u1', role: 'MEMBER', schoolId: 'school-a' }));

    const socket = makeSocket('tok');
    const next   = jest.fn();
    await socketAuthHandler(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.userId).toBe('u1');
    expect(socket.userRole).toBe('MEMBER');
    expect(socket.userSchoolId).toBe('school-a');
    // DB not hit when cache returns a result
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. BANNED user → rejected (core VULN-LIVE-006 case)
// ─────────────────────────────────────────────────────────────────────────────
describe('2. BANNED user → rejected', () => {
  test('cache hit returns BANNED → rejected, socket identity not set', async () => {
    verifyAccessToken.mockReturnValue({ userId: 'ban1' });
    getUserFromCache.mockResolvedValue(makeUser({ id: 'ban1', status: 'BANNED' }));

    const socket = makeSocket('tok');
    const next   = jest.fn();
    await socketAuthHandler(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Account banned' }));
    expect(socket.userId).toBeUndefined();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  test('DB fallback returns BANNED → rejected', async () => {
    verifyAccessToken.mockReturnValue({ userId: 'ban2' });
    getUserFromCache.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(makeUser({ id: 'ban2', status: 'BANNED' }));

    const socket = makeSocket('tok');
    const next   = jest.fn();
    await socketAuthHandler(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Account banned' }));
    expect(socket.userId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. SUSPENDED user → rejected
// ─────────────────────────────────────────────────────────────────────────────
describe('3. SUSPENDED user → rejected', () => {
  test('SUSPENDED user from cache → rejected', async () => {
    verifyAccessToken.mockReturnValue({ userId: 'sus1' });
    getUserFromCache.mockResolvedValue(makeUser({ id: 'sus1', status: 'SUSPENDED' }));

    const socket = makeSocket('tok');
    const next   = jest.fn();
    await socketAuthHandler(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Account suspended' }));
    expect(socket.userId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. INACTIVE user → rejected
// ─────────────────────────────────────────────────────────────────────────────
describe('4. INACTIVE user → rejected', () => {
  test('INACTIVE user from cache → rejected', async () => {
    verifyAccessToken.mockReturnValue({ userId: 'ina1' });
    getUserFromCache.mockResolvedValue(makeUser({ id: 'ina1', status: 'INACTIVE' }));

    const socket = makeSocket('tok');
    const next   = jest.fn();
    await socketAuthHandler(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Account inactive' }));
    expect(socket.userId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Soft-deleted user → rejected
// ─────────────────────────────────────────────────────────────────────────────
describe('5. Soft-deleted user → rejected', () => {
  test('user with deletedAt set → rejected', async () => {
    verifyAccessToken.mockReturnValue({ userId: 'del1' });
    getUserFromCache.mockResolvedValue(makeUser({ id: 'del1', deletedAt: new Date() }));

    const socket = makeSocket('tok');
    const next   = jest.fn();
    await socketAuthHandler(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Authentication failed' }));
    expect(socket.userId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Cache miss + ACTIVE DB → accepted (Redis fallback)
// ─────────────────────────────────────────────────────────────────────────────
describe('6. Cache miss + ACTIVE DB → accepted', () => {
  test('null from cache; DB returns ACTIVE user → accepted', async () => {
    verifyAccessToken.mockReturnValue({ userId: 'db1' });
    getUserFromCache.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(makeUser({ id: 'db1', role: 'TEACHER', schoolId: 's1' }));

    const socket = makeSocket('tok');
    const next   = jest.fn();
    await socketAuthHandler(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(socket.userId).toBe('db1');
    expect(socket.userRole).toBe('TEACHER');
    expect(socket.userSchoolId).toBe('s1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Cache miss + BANNED DB → rejected
// ─────────────────────────────────────────────────────────────────────────────
describe('7. Cache miss + BANNED DB → rejected', () => {
  test('null from cache; DB returns BANNED → rejected', async () => {
    verifyAccessToken.mockReturnValue({ userId: 'db2' });
    getUserFromCache.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(makeUser({ id: 'db2', status: 'BANNED' }));

    const socket = makeSocket('tok');
    const next   = jest.fn();
    await socketAuthHandler(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Account banned' }));
    expect(socket.userId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. User not found → rejected
// ─────────────────────────────────────────────────────────────────────────────
describe('8. User not found → rejected', () => {
  test('cache miss + DB null → rejected', async () => {
    verifyAccessToken.mockReturnValue({ userId: 'ghost' });
    getUserFromCache.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(null);

    const socket = makeSocket('tok');
    const next   = jest.fn();
    await socketAuthHandler(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Authentication failed' }));
    expect(socket.userId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Missing token → rejected
// ─────────────────────────────────────────────────────────────────────────────
describe('9. Missing token → rejected', () => {
  test('no token → Authentication required', async () => {
    const socket = makeSocket(undefined);
    const next   = jest.fn();
    await socketAuthHandler(socket, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Authentication required' }));
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  test('null token → Authentication required', async () => {
    const socket = makeSocket(null);
    const next   = jest.fn();
    await socketAuthHandler(socket, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Authentication required' }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. JWT errors → rejected
// ─────────────────────────────────────────────────────────────────────────────
describe('10. JWT errors → rejected', () => {
  test('expired JWT → Token expired', async () => {
    const err = Object.assign(new Error('jwt expired'), { name: 'TokenExpiredError' });
    verifyAccessToken.mockImplementation(() => { throw err; });
    const socket = makeSocket('expired');
    const next   = jest.fn();
    await socketAuthHandler(socket, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Token expired' }));
  });

  test('invalid JWT → Invalid token', async () => {
    const err = Object.assign(new Error('invalid sig'), { name: 'JsonWebTokenError' });
    verifyAccessToken.mockImplementation(() => { throw err; });
    const socket = makeSocket('bad');
    const next   = jest.fn();
    await socketAuthHandler(socket, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid token' }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. SUPER_ADMIN ACTIVE → accepted (platform-only invariant preserved)
// ─────────────────────────────────────────────────────────────────────────────
describe('11. SUPER_ADMIN ACTIVE → accepted', () => {
  test('active SUPER_ADMIN passes status check; no school assigned', async () => {
    verifyAccessToken.mockReturnValue({ userId: 'sa1' });
    getUserFromCache.mockResolvedValue(makeUser({ id: 'sa1', role: 'SUPER_ADMIN', status: 'ACTIVE', schoolId: null }));

    const socket = makeSocket('tok');
    const next   = jest.fn();
    await socketAuthHandler(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.userId).toBe('sa1');
    expect(socket.userRole).toBe('SUPER_ADMIN');
    expect(socket.userSchoolId).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Source code invariants
// ─────────────────────────────────────────────────────────────────────────────
describe('12. Source code invariants', () => {
  test('app.js socket auth contains VULN-LIVE-006 fix', () => {
    const fs   = require('fs');
    const path = require('path');
    const src  = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

    expect(src).toMatch(/VULN-LIVE-006 FIX/);
    expect(src).toMatch(/getUserFromCache/);
    expect(src).toMatch(/USER_SELECT/);
    expect(src).toMatch(/status\s*===\s*'BANNED'/);
    expect(src).toMatch(/status\s*===\s*'SUSPENDED'/);
    expect(src).toMatch(/status\s*===\s*'INACTIVE'/);
    expect(src).toMatch(/user\.deletedAt/);

    // Socket identity is set AFTER status checks (not before the ban check)
    const useIdx   = src.indexOf('io.use(');
    const banIdx   = src.indexOf("'BANNED'", useIdx);
    const idSetIdx = src.indexOf('socket.userId', banIdx);
    expect(useIdx).toBeGreaterThan(-1);
    expect(banIdx).toBeGreaterThan(useIdx);
    expect(idSetIdx).toBeGreaterThan(banIdx);
  });
});
