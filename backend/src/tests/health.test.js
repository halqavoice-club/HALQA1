/**
 * Tests for health check system
 */

const request = require('supertest');
const express = require('express');
const { liveness, readiness, startup, detailed, checkDatabase, checkRedis, checkMemory } = require('../utils/health');

// Mock dependencies
jest.mock('../utils/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn()
  }
}));

jest.mock('../utils/redis', () => ({
  isRedisReady: jest.fn(() => true),
  getRedis: jest.fn(() => ({
    ping: jest.fn().mockResolvedValue('PONG')
  }))
}));

jest.mock('../utils/circuitBreaker', () => ({
  registry: {
    getAllStates: jest.fn(() => ({
      'database': { state: 'CLOSED' },
      'redis': { state: 'CLOSED' }
    }))
  }
}));

describe('Health Check System', () => {
  let app;
  const prisma = require('../utils/prisma');
  const { getRedis } = require('../utils/redis');

  beforeEach(() => {
    app = express();
    jest.clearAllMocks();
  });

  describe('liveness', () => {
    test('should return 200 for liveness check', async () => {
      app.get('/health/liveness', liveness);

      const response = await request(app).get('/health/liveness');
      
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.uptime).toBeDefined();
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('readiness', () => {
    test('should return 200 when all dependencies are healthy', async () => {
      prisma.$queryRaw.mockResolvedValue([{ 1: 1 }]);

      app.get('/health/readiness', readiness);

      const response = await request(app).get('/health/readiness');
      
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ready');
      expect(response.body.checks.database.status).toBe('ok');
      expect(response.body.checks.redis.status).toBe('ok');
    });

    test('should return 503 when database is unhealthy', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('Database error'));

      app.get('/health/readiness', readiness);

      const response = await request(app).get('/health/readiness');
      
      expect(response.status).toBe(503);
      expect(response.body.status).toBe('not_ready');
      expect(response.body.checks.database.status).toBe('error');
    });

    test('should return 503 when Redis is disconnected', async () => {
      const { isRedisReady } = require('../utils/redis');
      isRedisReady.mockReturnValue(false);

      app.get('/health/readiness', readiness);

      const response = await request(app).get('/health/readiness');
      
      expect(response.status).toBe(503);
      expect(response.body.checks.redis.status).toBe('disconnected');
    });

    test('should return degraded status when circuit breakers are open', async () => {
      const { registry } = require('../utils/circuitBreaker');
      registry.getAllStates.mockReturnValue({
        'database': { state: 'OPEN', service: 'database' },
        'redis': { state: 'CLOSED' }
      });

      prisma.$queryRaw.mockResolvedValue([{ 1: 1 }]);

      app.get('/health/readiness', readiness);

      const response = await request(app).get('/health/readiness');
      
      expect(response.status).toBe(503);
      expect(response.body.status).toBe('not_ready');
      expect(response.body.checks.circuitBreakers.openBreakers).toContain('database');
    });
  });

  describe('startup', () => {
    test('should return 503 when startup not complete', async () => {
      app.get('/health/startup', startup);

      const response = await request(app).get('/health/startup');
      
      expect(response.status).toBe(503);
      expect(response.body.status).toBe('starting');
    });

    test('should return 200 when startup complete', async () => {
      const { markStartupComplete } = require('../utils/health');
      markStartupComplete();

      app.get('/health/startup', startup);

      const response = await request(app).get('/health/startup');
      
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ready');
    });
  });

  describe('detailed', () => {
    test('should return comprehensive health information', async () => {
      prisma.$queryRaw.mockResolvedValue([{ 1: 1 }]);

      app.get('/health/detailed', detailed);

      const response = await request(app).get('/health/detailed');
      
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.checks.database).toBeDefined();
      expect(response.body.checks.redis).toBeDefined();
      expect(response.body.checks.memory).toBeDefined();
      expect(response.body.checks.eventLoop).toBeDefined();
    });

    test('should include memory statistics', async () => {
      prisma.$queryRaw.mockResolvedValue([{ 1: 1 }]);

      app.get('/health/detailed', detailed);

      const response = await request(app).get('/health/detailed');
      
      expect(response.body.checks.memory.heapUsedMb).toBeDefined();
      expect(response.body.checks.memory.heapTotalMb).toBeDefined();
      expect(response.body.checks.memory.heapUsagePercent).toBeDefined();
    });

    test('should include event loop lag', async () => {
      prisma.$queryRaw.mockResolvedValue([{ 1: 1 }]);

      app.get('/health/detailed', detailed);

      const response = await request(app).get('/health/detailed');
      
      expect(response.body.checks.eventLoop.lagMs).toBeDefined();
      expect(response.body.checks.eventLoop.status).toBeDefined();
    });
  });

  describe('checkDatabase', () => {
    test('should return ok for healthy database', async () => {
      prisma.$queryRaw.mockResolvedValue([{ 1: 1 }]);

      const result = await checkDatabase();
      
      expect(result.status).toBe('ok');
      expect(result.latencyMs).toBeDefined();
    });

    test('should return error for unhealthy database', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('Connection error'));

      const result = await checkDatabase();
      
      expect(result.status).toBe('error');
      expect(result.error).toBeDefined();
    });
  });

  describe('checkRedis', () => {
    test('should return ok for healthy Redis', async () => {
      const result = await checkRedis();
      
      expect(result.status).toBe('ok');
      expect(result.latencyMs).toBeDefined();
    });

    test('should return disconnected when Redis not ready', async () => {
      const { isRedisReady } = require('../utils/redis');
      isRedisReady.mockReturnValue(false);

      const result = await checkRedis();
      
      expect(result.status).toBe('disconnected');
    });

    test('should return error on ping failure', async () => {
      getRedis.mockReturnValue({
        ping: jest.fn().mockRejectedValue(new Error('Ping failed'))
      });

      const result = await checkRedis();
      
      expect(result.status).toBe('error');
    });
  });

  describe('checkMemory', () => {
    test('should return memory statistics', () => {
      const result = checkMemory();
      
      expect(result.heapUsedMb).toBeDefined();
      expect(result.heapTotalMb).toBeDefined();
      expect(result.heapUsagePercent).toBeDefined();
      expect(result.rssMb).toBeDefined();
    });

    test('should return warning status for high memory usage', () => {
      // Mock high memory usage
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = jest.fn(() => ({
        heapUsed: 800 * 1024 * 1024,
        heapTotal: 1000 * 1024 * 1024,
        rss: 1000 * 1024 * 1024,
        external: 100 * 1024 * 1024
      }));

      const result = checkMemory();
      
      expect(result.status).toBe('warning');
      expect(result.heapUsagePercent).toBeGreaterThan(75);

      process.memoryUsage = originalMemoryUsage;
    });
  });
});
