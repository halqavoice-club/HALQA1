/**
 * Tests for session management middleware
 */

const request = require('supertest');
const express = require('express');
const { trackSession, validateSession, enforceSessionLimit } = require('../middleware/session.middleware');

// Mock Prisma
jest.mock('../utils/prisma', () => ({
  prisma: {
    session: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn()
    }
  }
}));

// Mock Redis
jest.mock('../utils/redis', () => ({
  isRedisReady: jest.fn(() => true),
  setCache: jest.fn(),
  getCache: jest.fn(),
  deleteCache: jest.fn()
}));

describe('Session Management', () => {
  let app;
  const prisma = require('../utils/prisma');

  beforeEach(() => {
    app = express();
    app.use(express.json());
    jest.clearAllMocks();
  });

  describe('trackSession', () => {
    test('should create session for authenticated user', async () => {
      app.post('/login', trackSession, (req, res) => {
        req.user = { id: 'user-123' };
        res.json({ success: true });
      });

      prisma.session.create.mockResolvedValue({
        id: 'session-123',
        userId: 'user-123',
        deviceName: 'Windows - Chrome',
        isActive: true
      });

      const response = await request(app)
        .post('/login')
        .set('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0.4472.124')
        .set('x-forwarded-for', '192.168.1.1');

      expect(response.status).toBe(200);
      expect(prisma.session.create).toHaveBeenCalled();
      expect(response.headers['x-session-id']).toBeDefined();
    });

    test('should handle session creation failure gracefully', async () => {
      app.post('/login', trackSession, (req, res) => {
        req.user = { id: 'user-123' };
        res.json({ success: true });
      });

      prisma.session.create.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/login')
        .set('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0.4472.124');

      // Should still succeed (fail-open)
      expect(response.status).toBe(200);
    });
  });

  describe('enforceSessionLimit', () => {
    test('should allow requests within session limit', async () => {
      app.get('/protected', enforceSessionLimit, (req, res) => {
        req.user = { id: 'user-123' };
        res.json({ success: true });
      });

      prisma.session.count.mockResolvedValue(3);

      const response = await request(app)
        .get('/protected')
        .set('X-User-Id', 'user-123');

      expect(response.status).toBe(200);
    });

    test('should terminate oldest session when limit exceeded', async () => {
      app.get('/protected', enforceSessionLimit, (req, res) => {
        req.user = { id: 'user-123' };
        res.json({ success: true });
      });

      prisma.session.count.mockResolvedValue(11);
      prisma.session.findMany.mockResolvedValue([
        { id: 'old-session', lastSeenAt: new Date('2020-01-01') }
      ]);
      prisma.session.update.mockResolvedValue({});

      const response = await request(app)
        .get('/protected')
        .set('X-User-Id', 'user-123');

      expect(response.status).toBe(200);
      expect(prisma.session.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            terminationReason: 'SESSION_LIMIT'
          })
        })
      );
    });
  });

  describe('validateSession', () => {
    test('should validate active session', async () => {
      app.get('/protected', validateSession, (req, res) => {
        res.json({ success: true });
      });

      prisma.session.findUnique.mockResolvedValue({
        id: 'session-123',
        isActive: true,
        lastSeenAt: new Date()
      });

      const response = await request(app)
        .get('/protected')
        .set('X-Session-ID', 'session-123');

      expect(response.status).toBe(200);
    });

    test('should reject inactive session', async () => {
      app.get('/protected', validateSession, (req, res) => {
        res.json({ success: true });
      });

      prisma.session.findUnique.mockResolvedValue({
        id: 'session-123',
        isActive: false,
        terminatedAt: new Date()
      });

      const response = await request(app)
        .get('/protected')
        .set('X-Session-ID', 'session-123');

      expect(response.status).toBe(401);
    });

    test('should reject non-existent session', async () => {
      app.get('/protected', validateSession, (req, res) => {
        res.json({ success: true });
      });

      prisma.session.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get('/protected')
        .set('X-Session-ID', 'session-123');

      expect(response.status).toBe(401);
    });
  });
});
