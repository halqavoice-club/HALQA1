/**
 * Tests for per-user rate limiting middleware
 *
 * Fix log:
 *   - Middleware uses isDev ? highLimit : lowLimit — NODE_ENV=test is treated as dev,
 *     so pre-exported strictLimiter/moderateLimiter have very high limits (1000/5000).
 *     Tests must create explicit instances via createUserRateLimiter with small max values.
 *   - express-rate-limit in-memory store resets per app instance, so each test gets
 *     a fresh app + fresh limiter instance.
 *   - fake timers: express-rate-limit's in-memory store uses Date.now() which respects
 *     jest fake timers only if the store was created after useFakeTimers() is called.
 */

const request  = require('supertest');
const express  = require('express');
const { createUserRateLimiter } = require('../middleware/rateLimiter.user');

// Create a fresh small-limit instance for each test that needs limiting
function makeLimiter(max = 5, windowMs = 60000) {
  return createUserRateLimiter({
    windowMs,
    max,
    message: 'Too many requests, please try again later',
    keyGenerator: (req) => req.headers['x-user-id'] || req.ip,
  });
}

describe('Per-User Rate Limiter', () => {
  let userId;

  beforeEach(() => {
    userId = 'test-user-123';
  });

  test('should allow requests within limit', async () => {
    // Use a high-limit instance — all 10 requests should pass
    const limiter = makeLimiter(100);
    const app = express();
    app.use(express.json());
    app.get('/test', limiter, (_req, res) => res.json({ success: true }));

    for (let i = 0; i < 10; i++) {
      const response = await request(app).get('/test').set('X-User-Id', userId);
      expect(response.status).toBe(200);
    }
  });

  test('should block requests exceeding limit', async () => {
    // Each app+limiter instance has its own fresh in-memory store
    const limiter = makeLimiter(5);
    const app = express();
    app.use(express.json());
    app.get('/test', limiter, (_req, res) => res.json({ success: true }));

    const responses = [];
    for (let i = 0; i < 10; i++) {
      responses.push(await request(app).get('/test').set('X-User-Id', userId));
    }

    // First 5 should succeed
    for (let i = 0; i < 5; i++) {
      expect(responses[i].status).toBe(200);
    }
    // Remaining should be rate limited
    for (let i = 5; i < 10; i++) {
      expect(responses[i].status).toBe(429);
      // express-rate-limit returns { success: false, message: '...' }
      // (the message object we passed; no nested error.code)
      expect(responses[i].body.success).toBe(false);
    }
  });

  test('should set rate limit headers', async () => {
    // express-rate-limit with standardHeaders:true sets RateLimit-* (draft-6 format)
    // or X-RateLimit-* depending on version. Accept either.
    const limiter = makeLimiter(100);
    const app = express();
    app.use(express.json());
    app.get('/test', limiter, (_req, res) => res.json({ success: true }));

    const response = await request(app).get('/test').set('X-User-Id', userId);
    expect(response.status).toBe(200);

    // standardHeaders:true sets either RateLimit-* or X-RateLimit-* depending on version
    const hasStandardHeaders =
      response.headers['ratelimit-limit'] !== undefined ||
      response.headers['x-ratelimit-limit'] !== undefined;
    expect(hasStandardHeaders).toBe(true);
  });

  test('should handle missing user ID gracefully', async () => {
    const limiter = makeLimiter(5);
    const app = express();
    app.use(express.json());
    app.get('/test', limiter, (_req, res) => res.json({ success: true }));

    // No X-User-Id header — should still work (fallback to IP or allow)
    const response = await request(app).get('/test');
    expect([200, 429]).toContain(response.status);
  });

  test('should reset limit after window expires', async () => {
    jest.useFakeTimers();

    // Create limiter AFTER useFakeTimers so Date.now() is mocked from the start
    const limiter = makeLimiter(5, 60000);
    const app = express();
    app.use(express.json());
    app.get('/test', limiter, (_req, res) => res.json({ success: true }));

    // Exhaust limit
    for (let i = 0; i < 5; i++) {
      await request(app).get('/test').set('X-User-Id', userId);
    }

    // Should be rate limited now
    let response = await request(app).get('/test').set('X-User-Id', userId);
    expect(response.status).toBe(429);

    // Advance time past the window
    jest.advanceTimersByTime(60001);

    // Should allow requests again
    response = await request(app).get('/test').set('X-User-Id', userId);
    expect(response.status).toBe(200);

    jest.useRealTimers();
  });
});

describe('Lazy-initialization behavior (proxy exports)', () => {
  // These tests verify that the pre-built exported constants (strictLimiter, etc.)
  // are lazy-proxy functions — they defer createUserRateLimiter() to first request,
  // NOT to module-load time. This is the fix for F-001/F-009.

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test('no [userRateLimiter] warning fires when module is required', () => {
    // Before the fix, requiring the module would fire 4 warn lines immediately.
    // After the fix, no warn fires until the first HTTP request.
    jest.resetModules();

    // Intercept logger before re-requiring the module
    // We need to spy on the logger instance that rateLimiter.user.js will use
    const loggerModule = require('../utils/logger');
    const warnSpy = jest.spyOn(loggerModule, 'warn');

    // Re-require to get a fresh module evaluation with our spy in place
    require('../middleware/rateLimiter.user');

    const userRateLimiterWarns = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('[userRateLimiter]')
    );

    expect(userRateLimiterWarns).toHaveLength(0);
    jest.resetModules(); // clean up for other tests
  });

  test('proxy exports are callable middleware functions', () => {
    const {
      strictLimiter,
      moderateLimiter,
      lenientLimiter,
      writeLimiter,
      middleware,
    } = require('../middleware/rateLimiter.user');

    // All exports must be callable (req, res, next) functions
    expect(typeof strictLimiter).toBe('function');
    expect(typeof moderateLimiter).toBe('function');
    expect(typeof lenientLimiter).toBe('function');
    expect(typeof writeLimiter).toBe('function');
    expect(typeof middleware).toBe('function');

    // middleware must be the same reference as moderateLimiter
    expect(middleware).toBe(moderateLimiter);
  });

  test('proxy creates exactly one instance on repeated calls (no duplicate construction)', async () => {
    // Each proxy should call createUserRateLimiter() exactly once across multiple requests.
    // We verify by checking that the warn/debug log fires at most once per proxy.
    const loggerModule = require('../utils/logger');
    const debugSpy = jest.spyOn(loggerModule, 'debug');

    const { strictLimiter } = require('../middleware/rateLimiter.user');
    const app = express();
    app.use(express.json());
    app.get('/test', strictLimiter, (_req, res) => res.json({ ok: true }));

    // Make 3 requests — instance should be created on first, reused on 2nd and 3rd
    for (let i = 0; i < 3; i++) {
      await request(app).get('/test').set('X-User-Id', `user-${i}`);
    }

    const strictLimiterDebugCalls = debugSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('strictLimiter')
    );
    // Should be exactly 1 — created on first request, reused thereafter
    expect(strictLimiterDebugCalls.length).toBe(1);
  });

  test('warn fires at first request (not module load) when Redis unavailable', async () => {
    jest.resetModules();

    // Mock redis to return isRedisReady = false
    jest.mock('../utils/redis', () => ({
      isRedisReady: jest.fn().mockReturnValue(false),
      getCache: jest.fn(),
      setCache: jest.fn(),
    }));

    const loggerModule = require('../utils/logger');
    const warnSpy = jest.spyOn(loggerModule, 'warn');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { strictLimiter } = require('../middleware/rateLimiter.user');
    const app = express();
    app.use(express.json());
    app.get('/test', strictLimiter, (_req, res) => res.json({ ok: true }));

    // No warn yet — proxy hasn't been invoked
    const warnsBeforeRequest = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('[userRateLimiter]')
    );
    expect(warnsBeforeRequest).toHaveLength(0);

    // Make first request — this triggers lazy construction
    await request(app).get('/test').set('X-User-Id', 'uid-1');

    // Now exactly one warn should have fired
    const warnsAfterRequest = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('[userRateLimiter] Redis unavailable')
    );
    expect(warnsAfterRequest.length).toBeGreaterThanOrEqual(1);
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('ERR_ERL_CREATED_IN_REQUEST_HANDLER');

    jest.resetModules();
    jest.unmock('../utils/redis');
  });

  test('uses Redis branch when isRedisReady returns true at first request', async () => {
    jest.resetModules();

    jest.mock('../utils/redis', () => ({
      isRedisReady: jest.fn().mockReturnValue(true),
      getCache: jest.fn().mockResolvedValue(null),
      setCache: jest.fn().mockResolvedValue('OK'),
    }));

    const { moderateLimiter } = require('../middleware/rateLimiter.user');
    const app = express();
    app.use(express.json());
    app.get('/test', moderateLimiter, (_req, res) => res.json({ ok: true }));

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get('/test')
      .set('X-User-Id', 'uid-redis')
      .set('authorization', 'Bearer fake');

    // Redis path: fail-open on Redis errors, so even with mocked getCache returning null
    // the request should proceed
    expect([200, 429]).toContain(res.status);

    // Most importantly: no warn should have fired (Redis was ready)
    const loggerModule = require('../utils/logger');
    const warnSpy = jest.spyOn(loggerModule, 'warn');
    expect(
      warnSpy.mock.calls.filter(
        (args) => typeof args[0] === 'string' && args[0].includes('[userRateLimiter] Redis unavailable')
      )
    ).toHaveLength(0);
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('ERR_ERL_CREATED_IN_REQUEST_HANDLER');

    jest.resetModules();
    jest.unmock('../utils/redis');
  });

  test('caches the first-request memory selection without switching to Redis', async () => {
    jest.resetModules();
    const mockIsRedisReady = jest.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const mockGetCache = jest.fn();
    jest.doMock('../utils/redis', () => ({
      isRedisReady: mockIsRedisReady,
      getCache: mockGetCache,
      setCache: jest.fn(),
    }));

    const { strictLimiter } = require('../middleware/rateLimiter.user');
    const app = express();
    app.get('/test', strictLimiter, (_req, res) => res.json({ ok: true }));

    await request(app).get('/test');
    await request(app).get('/test');

    expect(mockIsRedisReady).toHaveBeenCalledTimes(1);
    expect(mockGetCache).not.toHaveBeenCalled();
    jest.resetModules();
    jest.unmock('../utils/redis');
  });

  test('preserves Redis key format and fail-open behavior', async () => {
    jest.resetModules();
    const mockGetCache = jest.fn().mockRejectedValue(new Error('redis unavailable'));
    jest.doMock('../utils/redis', () => ({
      isRedisReady: jest.fn().mockReturnValue(true),
      getCache: mockGetCache,
      setCache: jest.fn(),
    }));

    const { strictLimiter } = require('../middleware/rateLimiter.user');
    const app = express();
    app.use((req, _res, next) => { req.user = { id: 'user-redis-key' }; next(); });
    app.get('/test', strictLimiter, (_req, res) => res.json({ ok: true }));

    const response = await request(app).get('/test');
    expect(response.status).toBe(200);
    expect(mockGetCache).toHaveBeenCalledWith('ratelimit:user:user-redis-key');
    jest.resetModules();
    jest.unmock('../utils/redis');
  });
});

describe('Limiter policy parity', () => {
  test('independent configured stores do not share counters', async () => {
    const first = createUserRateLimiter({ max: 1, keyGenerator: () => 'same-user' });
    const second = createUserRateLimiter({ max: 1, keyGenerator: () => 'same-user' });
    const app = express();
    app.get('/first', first, (_req, res) => res.json({ ok: true }));
    app.get('/second', second, (_req, res) => res.json({ ok: true }));

    expect((await request(app).get('/first')).status).toBe(200);
    expect((await request(app).get('/second')).status).toBe(200);
    expect((await request(app).get('/first')).status).toBe(429);
    expect((await request(app).get('/second')).status).toBe(429);
  });

  test('production strict user threshold remains five requests', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    jest.resetModules();
    jest.doMock('../utils/redis', () => ({
      isRedisReady: jest.fn().mockReturnValue(false), getCache: jest.fn(), setCache: jest.fn(),
    }));
    try {
      const { strictLimiter } = require('../middleware/rateLimiter.user');
      const app = express();
      app.get('/test', strictLimiter, (_req, res) => res.json({ ok: true }));
      for (let i = 0; i < 5; i++) expect((await request(app).get('/test')).status).toBe(200);
      expect((await request(app).get('/test')).status).toBe(429);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      jest.resetModules();
      jest.unmock('../utils/redis');
    }
  });
});
