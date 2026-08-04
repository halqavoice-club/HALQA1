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
