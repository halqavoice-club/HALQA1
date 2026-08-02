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

  describe('idempotencyMiddleware', () => {
    test('should cache response on first request', async () => {
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

    test('should return cached response on duplicate request', async () => {
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

    test('should work without Idempotency-Key header', async () => {
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

  describe('clearKey', () => {
    test('should clear idempotency cache', async () => {
      const { deleteCache } = require('../utils/redis');
      deleteCache.mockResolvedValue();

      await clearKey('test-key');

      expect(deleteCache).toHaveBeenCalledTimes(2);
    });

    test('should throw error when Redis unavailable', async () => {
      const { isRedisReady } = require('../utils/redis');
      isRedisReady.mockReturnValue(false);

      await expect(clearKey('test-key')).rejects.toThrow('Redis not available');
    });
  });
});
