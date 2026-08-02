/**
 * Tests for per-user rate limiting middleware
 */

const request = require('supertest');
const express = require('express');
const { moderateLimiter, strictLimiter } = require('../middleware/rateLimiter.user');

describe('Per-User Rate Limiter', () => {
  let app;
  let userId;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    userId = 'test-user-123';
  });

  test('should allow requests within limit', async () => {
    let requestCount = 0;
    
    app.get('/test', moderateLimiter, (req, res) => {
      requestCount++;
      res.json({ count: requestCount });
    });

    // Make requests within limit
    for (let i = 0; i < 10; i++) {
      const response = await request(app)
        .get('/test')
        .set('X-User-Id', userId);
      
      expect(response.status).toBe(200);
    }
  });

  test('should block requests exceeding limit', async () => {
    let requestCount = 0;
    
    app.get('/test', strictLimiter, (req, res) => {
      requestCount++;
      res.json({ count: requestCount });
    });

    // Exceed the limit (strictLimiter has 5 requests per window)
    const responses = [];
    for (let i = 0; i < 10; i++) {
      const response = await request(app)
        .get('/test')
        .set('X-User-Id', userId);
      responses.push(response);
    }

    // First 5 should succeed
    for (let i = 0; i < 5; i++) {
      expect(responses[i].status).toBe(200);
    }

    // Remaining should be rate limited
    for (let i = 5; i < 10; i++) {
      expect(responses[i].status).toBe(429);
      expect(responses[i].body.error).toBeDefined();
      expect(responses[i].body.error.code).toBe('RATE_001');
    }
  });

  test('should set rate limit headers', async () => {
    app.get('/test', moderateLimiter, (req, res) => {
      res.json({ success: true });
    });

    const response = await request(app)
      .get('/test')
      .set('X-User-Id', userId);

    expect(response.headers['x-ratelimit-limit']).toBeDefined();
    expect(response.headers['x-ratelimit-remaining']).toBeDefined();
    expect(response.headers['x-ratelimit-reset']).toBeDefined();
  });

  test('should handle missing user ID gracefully', async () => {
    app.get('/test', moderateLimiter, (req, res) => {
      res.json({ success: true });
    });

    const response = await request(app)
      .get('/test');

    // Should still work (fallback to IP or allow)
    expect([200, 429]).toContain(response.status);
  });

  test('should reset limit after window expires', async () => {
    jest.useFakeTimers();
    
    let requestCount = 0;
    app.get('/test', strictLimiter, (req, res) => {
      requestCount++;
      res.json({ count: requestCount });
    });

    // Exhaust limit
    for (let i = 0; i < 5; i++) {
      await request(app).get('/test').set('X-User-Id', userId);
    }

    // Should be rate limited
    let response = await request(app).get('/test').set('X-User-Id', userId);
    expect(response.status).toBe(429);

    // Advance time past window
    jest.advanceTimersByTime(60000);

    // Should allow requests again
    response = await request(app).get('/test').set('X-User-Id', userId);
    expect(response.status).toBe(200);

    jest.useRealTimers();
  });
});
