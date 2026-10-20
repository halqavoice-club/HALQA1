'use strict';
/**
 * Tests for idempotency middleware
 */

const request = require('supertest');
const express = require('express');
const { middleware: idempotencyMiddleware, generateKey, clearKey } = require('../middleware/idempotency');

// Mock Redis
jest.mock('../utils/redis', () => ({
  isRedisReady: jest.fn(() => true),
  getCache: jest.fn(),
  setCache: jest.fn(),
  deleteCache: jest.fn()
}));

describe('Idempotency Middleware', () => {
  let app;
  const { getCache, setCache } = require('../utils/redis');

  beforeEach(() => {
    app = express();
    app.use(express.json());
    jest.clearAllMocks();
  });

  // ── Core middleware behaviour ────────────────────────────────────────────────
  describe('idempotencyMiddleware', () => {
    test('should cache response on first request (explicit key)', async () => {
      app.post('/test', idempotencyMiddleware({ ttl: 3600 }), (req, res) => {
        res.json({ success: true, data: 'test' });
      });

      const idempotencyKey = 'test-key-123';
      getCache.mockResolvedValue(null);
      setCache.mockResolvedValue();

      const response = await request(app)
        .post('/test')
        .set('Idempotency-Key', idempotencyKey)
        .send({ data: 'test' });

      expect(response.status).toBe(200);
      expect(setCache).toHaveBeenCalled();
      expect(response.headers['x-idempotency-key']).toBe(idempotencyKey);
    });

    test('should return cached response on duplicate explicit-key request', async () => {
      app.post('/test', idempotencyMiddleware({ ttl: 3600 }), (req, res) => {
        res.json({ success: true, data: 'test' });
      });

      const idempotencyKey = 'test-key-123';
      const cachedResponse = {
        statusCode: 200,
        body: { success: true, data: 'test' },
        timestamp: Date.now()
      };

      getCache.mockResolvedValue(cachedResponse);

      const response = await request(app)
        .post('/test')
        .set('Idempotency-Key', idempotencyKey)
        .send({ data: 'test' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(cachedResponse.body);
      expect(response.headers['x-idempotency-replayed']).toBe('true');
      expect(setCache).not.toHaveBeenCalled();
    });

    test('should skip caching failed responses when configured', async () => {
      app.post('/test', idempotencyMiddleware({ ttl: 3600, skipFailed: true }), (req, res) => {
        res.status(400).json({ error: 'Bad request' });
      });

      getCache.mockResolvedValue(null);
      setCache.mockResolvedValue();

      const response = await request(app)
        .post('/test')
        .set('Idempotency-Key', 'test-key')
        .send({ data: 'test' });

      expect(response.status).toBe(400);
      expect(setCache).not.toHaveBeenCalled();
    });

    test('should skip caching successful responses when configured', async () => {
      app.post('/test', idempotencyMiddleware({ ttl: 3600, skipSuccessful: true }), (req, res) => {
        res.json({ success: true });
      });

      getCache.mockResolvedValue(null);
      setCache.mockResolvedValue();

      const response = await request(app)
        .post('/test')
        .set('Idempotency-Key', 'test-key')
        .send({ data: 'test' });

      expect(response.status).toBe(200);
      expect(setCache).not.toHaveBeenCalled();
    });

    test('should work without Idempotency-Key header (auto-generated key)', async () => {
      app.post('/test', idempotencyMiddleware({ ttl: 3600 }), (req, res) => {
        res.json({ success: true });
      });

      getCache.mockResolvedValue(null);
      setCache.mockResolvedValue();

      const response = await request(app)
        .post('/test')
        .send({ data: 'test' });

      expect(response.status).toBe(200);
      expect(response.headers['x-idempotency-key']).toBeDefined();
    });

    test('should fail gracefully when Redis is unavailable', async () => {
      const { isRedisReady } = require('../utils/redis');
      isRedisReady.mockReturnValue(false);

      app.post('/test', idempotencyMiddleware({ ttl: 3600 }), (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/test')
        .set('Idempotency-Key', 'test-key')
        .send({ data: 'test' });

      // Should still process request (fail-open)
      expect(response.status).toBe(200);
    });
  });

  // ── Cross-user cache isolation (SECURITY) ───────────────────────────────────
  //
  // Problem: The idempotency middleware is mounted at app-level BEFORE route-level
  // authenticate() runs. At middleware entry, req.user is undefined. An auto-generated
  // key that doesn't include the userId would be identical for all users making the
  // same request, allowing cached authorization results to leak across users.
  //
  // Fix: Two-phase key strategy:
  //   • Explicit keys (Idempotency-Key header or body.idempotencyKey): early cache
  //     lookup at middleware entry (client owns key uniqueness).
  //   • Auto-generated keys: no early cache lookup. Key is generated lazily inside
  //     res.json intercept AFTER authenticate() has run, so req.user.id is available
  //     and the key is user-scoped. This prevents cross-user collisions.
  //
  // Tests verify:
  //   1. User A request → stored; SA D identical request → gets own 403 (not A's 200)
  //   2. SA D request → stored; User A identical request → gets own 200 (not D's 403)
  //   3. Same user + explicit key → replayed (idempotency still works)
  //   4. Anonymous requests get a separate namespace from authenticated users
  describe('Cross-user cache isolation (SECURITY)', () => {
    const { isRedisReady } = require('../utils/redis');

    /**
     * Build a test app that simulates the real middleware order:
     *   idempotencyMiddleware → authenticate() → handler
     *
     * The 'authenticate()' simulation reads x-user-id and x-user-role headers
     * and sets req.user — this happens AFTER idempotency middleware.
     */
    function buildUserAwareApp() {
      const freshApp = express();
      freshApp.use(express.json());
      freshApp.post(
        '/guarded',
        idempotencyMiddleware({ ttl: 3600 }),       // runs BEFORE auth
        (req, res, next) => {                        // simulated authenticate()
          const id   = req.headers['x-user-id']  || null;
          const role = req.headers['x-user-role'] || 'MEMBER';
          if (id) req.user = { id, role };
          next();
        },
        (req, res) => {                              // handler
          if (req.user?.role === 'SUPER_ADMIN') {
            return res.status(403).json({ success: false, message: 'SA blocked' });
          }
          return res.status(200).json({ success: true, message: 'allowed', userId: req.user?.id });
        }
      );
      return freshApp;
    }

    beforeEach(() => {
      isRedisReady.mockReturnValue(true);
    });

    test('normal user A → stored 200; SA D → identical request → must receive own 403', async () => {
      const freshApp = buildUserAwareApp();

      // A's request: no explicit key → auto key deferred to res.json → handler runs → 200
      setCache.mockResolvedValue();
      getCache.mockResolvedValue(null);

      const responseA = await request(freshApp)
        .post('/guarded')
        .set('x-user-id', 'user-a')
        .set('x-user-role', 'MEMBER')
        .send({ action: 'bookmark' });

      expect(responseA.status).toBe(200);
      expect(responseA.body.message).toBe('allowed');

      // D's request: auto key deferred → handler runs independently → 403
      const responseD = await request(freshApp)
        .post('/guarded')
        .set('x-user-id', 'user-d')
        .set('x-user-role', 'SUPER_ADMIN')
        .send({ action: 'bookmark' });

      expect(responseD.status).toBe(403);
      expect(responseD.body.message).toBe('SA blocked');

      // Two responses stored under different user-scoped keys (4 setCache calls total)
      expect(setCache).toHaveBeenCalledTimes(4); // 2 per request (response + tracking)
      const keyA = setCache.mock.calls[0][0];
      const keyD = setCache.mock.calls[2][0];
      expect(keyA).not.toBe(keyD); // keys differ because userId differs
    });

    test('SA D → stored 403; normal user A → identical request → must receive own 200', async () => {
      const freshApp = buildUserAwareApp();

      setCache.mockResolvedValue();
      getCache.mockResolvedValue(null);

      const responseD = await request(freshApp)
        .post('/guarded')
        .set('x-user-id', 'user-d')
        .set('x-user-role', 'SUPER_ADMIN')
        .send({ action: 'bookmark' });

      expect(responseD.status).toBe(403);

      const responseA = await request(freshApp)
        .post('/guarded')
        .set('x-user-id', 'user-a')
        .set('x-user-role', 'MEMBER')
        .send({ action: 'bookmark' });

      // A must not receive D's 403
      expect(responseA.status).toBe(200);
      expect(responseA.body.message).toBe('allowed');

      expect(setCache).toHaveBeenCalledTimes(4);
      const keyD = setCache.mock.calls[0][0];
      const keyA = setCache.mock.calls[2][0];
      expect(keyD).not.toBe(keyA);
    });

    test('explicit Idempotency-Key: same user same key → early cache replay', async () => {
      // Explicit keys use the early cache-read path — idempotency replay still works.
      const freshApp = buildUserAwareApp();

      const explicitKey = 'my-payment-key-abc123';
      const cachedResponse = {
        statusCode: 200,
        body: { success: true, message: 'allowed', userId: 'user-a' },
        timestamp: Date.now()
      };

      // First call: cache miss → handler runs → response stored
      getCache.mockResolvedValueOnce(null);
      setCache.mockResolvedValue();

      await request(freshApp)
        .post('/guarded')
        .set('x-user-id', 'user-a')
        .set('x-user-role', 'MEMBER')
        .set('Idempotency-Key', explicitKey)
        .send({ action: 'bookmark' });

      // Second call: same explicit key → early cache hit → replay
      getCache.mockResolvedValueOnce(cachedResponse);

      const responseA2 = await request(freshApp)
        .post('/guarded')
        .set('x-user-id', 'user-a')
        .set('x-user-role', 'MEMBER')
        .set('Idempotency-Key', explicitKey)
        .send({ action: 'bookmark' });

      expect(responseA2.status).toBe(200);
      expect(responseA2.headers['x-idempotency-replayed']).toBe('true');
    });

    test('anonymous requests get a separate namespace from authenticated users', async () => {
      const freshApp = buildUserAwareApp();

      setCache.mockResolvedValue();
      getCache.mockResolvedValue(null);

      // Authenticated user-a
      await request(freshApp)
        .post('/guarded')
        .set('x-user-id', 'user-a')
        .set('x-user-role', 'MEMBER')
        .send({ data: 'same' });

      // Anonymous (no user headers)
      await request(freshApp)
        .post('/guarded')
        .send({ data: 'same' });

      // Two distinct auto-generated cache keys — user-a-scoped ≠ anon-scoped
      const keys = setCache.mock.calls.map(c => c[0]);
      expect(keys.length).toBe(4); // 2 per request
      expect(keys[0]).not.toBe(keys[2]); // user-a key ≠ anon key
    });
  });

  // ── generateKey ─────────────────────────────────────────────────────────────
  describe('generateKey', () => {
    test('should generate unique keys', () => {
      const key1 = generateKey();
      const key2 = generateKey();

      expect(key1).toBeDefined();
      expect(key2).toBeDefined();
      expect(key1).not.toBe(key2);
    });

    test('should generate 64-character hex string', () => {
      const key = generateKey();
      expect(key).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(key)).toBe(true);
    });
  });

  // ── clearKey ────────────────────────────────────────────────────────────────
  describe('clearKey', () => {
    test('should clear idempotency cache (calls deleteCache twice)', async () => {
      const { deleteCache, isRedisReady } = require('../utils/redis');
      isRedisReady.mockReturnValue(true);
      deleteCache.mockResolvedValue();

      await clearKey('test-key');

      // clearIdempotencyKey calls deleteCache for both the response cache
      // and the key tracking entry — hence exactly 2 calls.
      expect(deleteCache).toHaveBeenCalledTimes(2);
    });

    test('should throw error when Redis is unavailable', async () => {
      const { isRedisReady } = require('../utils/redis');
      isRedisReady.mockReturnValue(false);

      await expect(clearKey('test-key')).rejects.toThrow('Redis not available');
    });
  });
});
