'use strict';
/**
 * VC-29-SOCKET Regression Tests — Socket.IO Token Type Validation
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Prior to this fix, Socket.IO authentication accepted ANY token signed with
 * JWT_SECRET and not expired, including 2FA challenge tokens. This allowed
 * bypassing two-factor authentication by connecting to Socket.IO with the
 * challenge token instead of completing TOTP verification.
 *
 * Fix: Added token-type validation to Socket.IO io.use() middleware matching
 * the existing HTTP authenticate() middleware pattern (auth.middleware.js:103).
 *
 * Token contract (from jwt.js):
 *   - Access tokens:      NO 'type' field (undefined) — legitimate authentication
 *   - 2FA challenge:      type: '2fa_challenge' — MUST be rejected
 *   - Refresh tokens:     Signed with JWT_REFRESH_SECRET — verifyAccessToken throws
 *
 * Test coverage:
 *   TC1. Access token (no type field)       → ACCEPTED
 *   TC2. 2FA challenge token                → REJECTED (Invalid token type)
 *   TC3. Refresh token                      → REJECTED (Invalid token)
 *   TC4. Token with invalid type field      → REJECTED (Invalid token type)
 *
 * Inline handler pattern: Mirrors app.js io.use() exactly for isolated unit testing
 * without requiring a real Socket.IO server. MUST stay in sync with production.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────
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

jest.mock('../utils/prisma', () => ({
  user: { findUnique: jest.fn() },
  $queryRawUnsafe:   jest.fn(),
  $executeRawUnsafe: jest.fn(),
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
const logger              = require('../utils/logger');

// ─── Inline handler — mirrors app.js io.use() exactly ────────────────────────
// Extracted for unit testing without spinning up Socket.IO server.
// Must stay in sync with app.js whenever the production handler changes.
// If modifying this handler, also update backend/src/app.js lines 165-221.
async function socketAuthHandler(socket, next) {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    const decoded = verifyAccessToken(token);

    // VC-29-SOCKET: Reject 2FA challenge tokens in Socket.IO authentication.
    // Access tokens do not have a 'type' field (undefined) — only 2FA challenge
    // tokens have type: '2fa_challenge'. This matches the HTTP middleware pattern
    // at auth.middleware.js:103-106.
    if (decoded.type && decoded.type !== 'access') {
      logger.warn('[Socket.IO Auth] Rejected non-access token', {
        userId: decoded.userId || decoded.id,
        tokenType: decoded.type,
        socketId: socket.id
      });
      return next(new Error('Invalid token type'));
    }

    // VULN-LIVE-006: Status check (not tested in this file, see socket-auth-vuln-live-006.test.js)
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
    socket.data = socket.data || {};
    socket.data.userId       = user.id;
    socket.data.userRole     = user.role;
    socket.data.userSchoolId = user.schoolId ?? null;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return next(new Error('Token expired'));
    if (err.name === 'JsonWebTokenError') return next(new Error('Invalid token'));
    next(new Error('Authentication failed'));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeSocket(token) {
  return {
    handshake: { auth: { token } },
    id: 'socket-test-id',
    userId: undefined,
    userRole: undefined,
    userSchoolId: undefined,
    data: {}
  };
}

function makeUser(overrides = {}) {
  return {
    id: 'user-1',
    role: 'MEMBER',
    status: 'ACTIVE',
    schoolId: null,
    firstName: 'Test',
    lastName: 'User',
    avatarUrl: null,
    deletedAt: null,
    email: 'test@example.com',
    ...overrides
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────
describe('VC-29-SOCKET: Socket.IO Token Type Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TC1: Access token (no type field) → ACCEPTED
  // ───────────────────────────────────────────────────────────────────────────
  test('TC1: Access token without type field is accepted', async () => {
    // Access tokens generated by generateAccessToken() have NO type field
    verifyAccessToken.mockReturnValue({ userId: 'user-1' });
    getUserFromCache.mockResolvedValue(makeUser());

    const socket = makeSocket('access-token');
    const next   = jest.fn();
    await socketAuthHandler(socket, next);

    expect(next).toHaveBeenCalledWith(); // success = called with no args
    expect(socket.userId).toBe('user-1');
    expect(socket.userRole).toBe('MEMBER');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TC2: 2FA challenge token (type='2fa_challenge') → REJECTED
  // ───────────────────────────────────────────────────────────────────────────
  test('TC2: 2FA challenge token is rejected', async () => {
    // Challenge tokens have type: '2fa_challenge' (from generate2FAChallengeToken)
    verifyAccessToken.mockReturnValue({
      userId: 'user-1',
      type: '2fa_challenge'
    });

    const socket = makeSocket('challenge-token');
    const next   = jest.fn();
    await socketAuthHandler(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Invalid token type'
    }));
    expect(socket.userId).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      '[Socket.IO Auth] Rejected non-access token',
      expect.objectContaining({ tokenType: '2fa_challenge' })
    );
    expect(getUserFromCache).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TC3: Refresh token → REJECTED (verifyAccessToken throws)
  // ───────────────────────────────────────────────────────────────────────────
  test('TC3: Refresh token is rejected by verifyAccessToken', async () => {
    // Refresh tokens use JWT_REFRESH_SECRET, so verifyAccessToken throws
    verifyAccessToken.mockImplementation(() => {
      const err = new Error('invalid signature');
      err.name = 'JsonWebTokenError';
      throw err;
    });

    const socket = makeSocket('refresh-token');
    const next   = jest.fn();
    await socketAuthHandler(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Invalid token'
    }));
    expect(socket.userId).toBeUndefined();
    expect(getUserFromCache).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TC4: Token with invalid type field → REJECTED
  // ───────────────────────────────────────────────────────────────────────────
  test('TC4: Token with type="malicious" is rejected', async () => {
    // Any token with a type field that is not 'access' must be rejected
    verifyAccessToken.mockReturnValue({
      userId: 'user-1',
      type: 'malicious'
    });

    const socket = makeSocket('malicious-token');
    const next   = jest.fn();
    await socketAuthHandler(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Invalid token type'
    }));
    expect(socket.userId).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      '[Socket.IO Auth] Rejected non-access token',
      expect.objectContaining({ tokenType: 'malicious' })
    );
    expect(getUserFromCache).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TC5: Token with type='access' (explicit) → ACCEPTED
  // ───────────────────────────────────────────────────────────────────────────
  test('TC5: Token with explicit type="access" is accepted', async () => {
    // Future-proofing: if access tokens ever gain an explicit type field,
    // they should still be accepted
    verifyAccessToken.mockReturnValue({
      userId: 'user-1',
      type: 'access'
    });
    getUserFromCache.mockResolvedValue(makeUser());

    const socket = makeSocket('access-token-explicit');
    const next   = jest.fn();
    await socketAuthHandler(socket, next);

    expect(next).toHaveBeenCalledWith(); // success
    expect(socket.userId).toBe('user-1');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Source code invariant check
  // ───────────────────────────────────────────────────────────────────────────
  describe('Source code invariant: app.js contains VC-29-SOCKET fix', () => {
    test('app.js Socket.IO auth contains token-type validation', () => {
      const fs   = require('fs');
      const path = require('path');
      const appJsPath = path.join(__dirname, '../app.js');
      const appJs = fs.readFileSync(appJsPath, 'utf8');

      // The fix must be present in the Socket.IO io.use() middleware
      expect(appJs).toMatch(/VC-29-SOCKET:/);
      expect(appJs).toMatch(/if\s*\(\s*decoded\.type\s*&&\s*decoded\.type\s*!==\s*['"]access['"]\s*\)/);
      expect(appJs).toMatch(/Invalid token type/);
    });

    test('HTTP middleware already contains token-type validation (VC-29 HTTP fix)', () => {
      const fs   = require('fs');
      const path = require('path');
      const authMiddlewarePath = path.join(__dirname, '../middleware/auth.middleware.js');
      const authMiddleware = fs.readFileSync(authMiddlewarePath, 'utf8');

      // HTTP middleware should have the same pattern (VC-29 fix)
      expect(authMiddleware).toMatch(/if\s*\(\s*decoded\.type\s*&&\s*decoded\.type\s*!==\s*['"]access['"]\s*\)/);
      expect(authMiddleware).toMatch(/Invalid token type/);
    });
  });
});
