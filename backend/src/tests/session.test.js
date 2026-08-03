/**
 * Tests for session management middleware
 *
 * Fix log (all pre-existing failures — none caused by our security changes):
 *   - jest.mock() is hoisted by Jest's Babel transform, so factory functions
 *     cannot reference variables declared after them. Use jest.fn() directly
 *     inside the factory and expose via require() after registration.
 *   - Prisma mock shape: session.middleware.js imports `const prisma = require('../utils/prisma')`
 *     and calls `prisma.session.create(...)`. Mock must export `{ session: { ... } }`.
 *   - `findFirst` added to mock (enforceSessionLimit uses it, not findMany).
 *   - `validateSession` requires BOTH `req.user` AND the X-Session-ID header to
 *     reject a session. Without `req.user`, the middleware calls next() (intentional
 *     fail-open). Tests that expect 401 must supply both.
 *   - Redis mock: isRedisReady returns false — tests work without Redis running.
 *   - Prometheus mock added (middleware calls prom metrics on every session op).
 */

const request = require('supertest');
const express = require('express');

// ── Mocks — declared before any require() of the modules under test ───────────
// Jest hoists jest.mock() to the top of the file. Cannot reference block-scoped
// variables in the factory. Call jest.fn() inline; retrieve via require() later.

jest.mock('../utils/prisma', () => ({
  session: {
    create:     jest.fn(),
    findUnique: jest.fn(),
    findFirst:  jest.fn(),  // enforceSessionLimit uses findFirst, not findMany
    findMany:   jest.fn(),
    update:     jest.fn(),
    updateMany: jest.fn(),
    count:      jest.fn()
  }
}));

jest.mock('../utils/redis', () => ({
  isRedisReady: jest.fn(() => false), // no Redis in unit tests
  setCache:     jest.fn(),
  getCache:     jest.fn(),
  deleteCache:  jest.fn()
}));

jest.mock('../utils/prometheus', () => ({
  sessionCreationsTotal:    { inc: jest.fn() },
  activeSessions:           { inc: jest.fn(), dec: jest.fn() },
  sessionTerminationsTotal: { inc: jest.fn() }
}));

// ── Imports after mocks ────────────────────────────────────────────────────────
const { trackSession, validateSession, enforceSessionLimit } =
  require('../middleware/session.middleware');

const db = require('../utils/prisma'); // returns the mock above

// ─────────────────────────────────────────────────────────────────────────────

describe('Session Management', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    jest.clearAllMocks();
  });

  // ── trackSession ────────────────────────────────────────────────────────────
  describe('trackSession', () => {
    test('should create session for authenticated user', async () => {
      app.post(
        '/login',
        (req, _res, next) => { req.user = { id: 'user-123' }; next(); },
        trackSession,
        (_req, res) => res.json({ success: true })
      );

      db.session.create.mockResolvedValue({
        id: 'sess-1', userId: 'user-123', deviceName: 'Windows - Chrome', isActive: true
      });

      const response = await request(app)
        .post('/login')
        .set('user-agent', 'Mozilla/5.0 (Windows NT 10.0) Chrome/91.0');

      expect(response.status).toBe(200);
      expect(db.session.create).toHaveBeenCalled();
    });

    test('should handle session creation DB failure gracefully (fail-open)', async () => {
      // Even if the DB throws, login must succeed — session tracking is non-blocking.
      app.post(
        '/login',
        (req, _res, next) => { req.user = { id: 'user-123' }; next(); },
        trackSession,
        (_req, res) => res.json({ success: true })
      );

      db.session.create.mockRejectedValue(new Error('DB unavailable'));

      const response = await request(app)
        .post('/login')
        .set('user-agent', 'Mozilla/5.0 (Windows NT 10.0) Chrome/91.0');

      expect(response.status).toBe(200);
    });

    test('should skip session tracking when req.user is absent', async () => {
      app.post('/login', trackSession, (_req, res) => res.json({ success: true }));

      const response = await request(app).post('/login');

      expect(response.status).toBe(200);
      expect(db.session.create).not.toHaveBeenCalled();
    });
  });

  // ── enforceSessionLimit ─────────────────────────────────────────────────────
  describe('enforceSessionLimit', () => {
    test('should allow requests within session limit', async () => {
      app.get(
        '/protected',
        (req, _res, next) => { req.user = { id: 'user-123' }; next(); },
        enforceSessionLimit,
        (_req, res) => res.json({ success: true })
      );

      db.session.count.mockResolvedValue(3); // under limit

      const response = await request(app).get('/protected');
      expect(response.status).toBe(200);
      expect(db.session.update).not.toHaveBeenCalled();
    });

    test('should terminate oldest session when limit is reached', async () => {
      app.get(
        '/protected',
        (req, _res, next) => { req.user = { id: 'user-123' }; next(); },
        enforceSessionLimit,
        (_req, res) => res.json({ success: true })
      );

      db.session.count.mockResolvedValue(10);     // at limit (MAX_SESSIONS_PER_USER = 10)
      db.session.findFirst.mockResolvedValue({    // oldest session to terminate
        id: 'oldest-sess', userId: 'user-123', lastSeenAt: new Date('2020-01-01')
      });
      db.session.update.mockResolvedValue({});

      const response = await request(app).get('/protected');

      expect(response.status).toBe(200);
      expect(db.session.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'oldest-sess' },
          data:  expect.objectContaining({ terminationReason: 'SESSION_LIMIT' })
        })
      );
    });

    test('should not call update when no session exceeds limit', async () => {
      app.get(
        '/protected',
        (req, _res, next) => { req.user = { id: 'user-123' }; next(); },
        enforceSessionLimit,
        (_req, res) => res.json({ success: true })
      );

      db.session.count.mockResolvedValue(2);

      const response = await request(app).get('/protected');
      expect(response.status).toBe(200);
      expect(db.session.update).not.toHaveBeenCalled();
    });
  });

  // ── validateSession ─────────────────────────────────────────────────────────
  // validateSession requires BOTH req.user AND X-Session-ID header.
  // Without req.user, the middleware calls next() immediately (fail-open by design).
  describe('validateSession', () => {
    test('should pass through when no session header provided', async () => {
      app.get('/protected', validateSession, (_req, res) => res.json({ success: true }));
      const response = await request(app).get('/protected');
      expect(response.status).toBe(200);
    });

    test('should validate active session and allow request', async () => {
      app.get(
        '/protected',
        (req, _res, next) => { req.user = { id: 'user-123' }; next(); },
        validateSession,
        (_req, res) => res.json({ success: true })
      );

      db.session.findUnique.mockResolvedValue({
        id: 'sess-1', userId: 'user-123', isActive: true, lastSeenAt: new Date()
      });
      db.session.update.mockResolvedValue({}); // lastSeenAt update

      const response = await request(app)
        .get('/protected')
        .set('X-Session-ID', 'sess-1');

      expect(response.status).toBe(200);
    });

    test('should reject inactive session with 401', async () => {
      app.get(
        '/protected',
        (req, _res, next) => { req.user = { id: 'user-123' }; next(); },
        validateSession,
        (_req, res) => res.json({ success: true })
      );

      db.session.findUnique.mockResolvedValue({
        id: 'sess-1', userId: 'user-123', isActive: false, terminatedAt: new Date()
      });

      const response = await request(app)
        .get('/protected')
        .set('X-Session-ID', 'sess-1');

      expect(response.status).toBe(401);
    });

    test('should reject session belonging to different user with 401', async () => {
      app.get(
        '/protected',
        (req, _res, next) => { req.user = { id: 'user-999' }; next(); },
        validateSession,
        (_req, res) => res.json({ success: true })
      );

      db.session.findUnique.mockResolvedValue({
        id: 'sess-1', userId: 'user-123', isActive: true, lastSeenAt: new Date()
      });

      const response = await request(app)
        .get('/protected')
        .set('X-Session-ID', 'sess-1');

      expect(response.status).toBe(401);
    });

    test('should reject non-existent session with 401', async () => {
      app.get(
        '/protected',
        (req, _res, next) => { req.user = { id: 'user-123' }; next(); },
        validateSession,
        (_req, res) => res.json({ success: true })
      );

      db.session.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get('/protected')
        .set('X-Session-ID', 'nonexistent');

      expect(response.status).toBe(401);
    });
  });
});
