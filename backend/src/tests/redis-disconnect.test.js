/**
 * Tests for DISC-001 (disconnectRedis captures cacheClient before null)
 * and DISC-005 ('end' event nulls cacheClient and calls process.exit in prod).
 */
'use strict';

// ── ioredis mock ──────────────────────────────────────────────────────────────
// Must be set up BEFORE requiring redis.js so the factory gets the mock.
const EventEmitter = require('events');

function makeMockClient() {
  const client = new EventEmitter();
  client.quit = jest.fn().mockResolvedValue('OK');
  client.disconnect = jest.fn();
  client.connect = jest.fn().mockResolvedValue(undefined);
  client.ping = jest.fn().mockResolvedValue('PONG');
  client.get = jest.fn().mockResolvedValue(null);
  client.set = jest.fn().mockResolvedValue('OK');
  client.status = 'ready';
  return client;
}

let mockPubClient, mockSubClient, mockCacheClient;
let mockClientCallCount = 0;

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => {
    mockClientCallCount++;
    if (mockClientCallCount === 1) return mockPubClient;
    if (mockClientCallCount === 2) return mockSubClient;
    return mockCacheClient;
  });
});

// ── Logger mock ───────────────────────────────────────────────────────────────
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function freshModule() {
  jest.resetModules();
  mockClientCallCount = 0;
  mockPubClient   = makeMockClient();
  mockSubClient   = makeMockClient();
  mockCacheClient = makeMockClient();
  // Re-require AFTER resetting so factory gets fresh mocks
  return require('../utils/redis');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FIX-1: disconnectRedis() captures all 3 client refs before nulling', () => {
  test('disconnectRedis() calls quit() on cacheClient', async () => {
    const redis = freshModule();
    process.env.REDIS_URL = 'redis://localhost:6379';
    await redis.connectRedis();

    await redis.disconnectRedis();

    expect(mockCacheClient.quit).toHaveBeenCalledTimes(1);
  });

  test('disconnectRedis() is safe when called on a never-connected module', async () => {
    const redis = freshModule();
    // Do not call connectRedis() — all clients are null
    await expect(redis.disconnectRedis()).resolves.not.toThrow();
  });

  test('disconnectRedis() calls quit() on pubClient and subClient', async () => {
    const redis = freshModule();
    process.env.REDIS_URL = 'redis://localhost:6379';
    await redis.connectRedis();

    await redis.disconnectRedis();

    expect(mockPubClient.quit).toHaveBeenCalledTimes(1);
    expect(mockSubClient.quit).toHaveBeenCalledTimes(1);
  });
});

describe('FIX-5: cacheClient "end" event handling', () => {
  test('"end" event on cacheClient sets cacheClient to null (getRedis returns null or throws)', async () => {
    const redis = freshModule();
    process.env.REDIS_URL = 'redis://localhost:6379';
    await redis.connectRedis();

    // Simulate ioredis emitting 'end' after exhausting retries
    mockCacheClient.emit('end');

    // getRedis() should now return null or throw — not return the dead client
    let result;
    try {
      result = redis.getRedis();
    } catch {
      result = null;
    }
    expect(result).toBeNull();
  });

  test('"end" event calls process.exit(1) in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalUrl = process.env.REDIS_URL;
    process.env.NODE_ENV = 'production';
    // Use a URL with password — connectRedis() requires auth in production
    process.env.REDIS_URL = 'redis://:testpassword@localhost:6379';
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit called'); });

    const redis = freshModule();
    await redis.connectRedis();

    expect(() => mockCacheClient.emit('end')).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    process.env.NODE_ENV = originalEnv;
    process.env.REDIS_URL = originalUrl;
  });

  test('"end" event does NOT call process.exit(1) in development', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    process.env.REDIS_URL = 'redis://localhost:6379';
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    const redis = freshModule();
    await redis.connectRedis();

    expect(() => mockCacheClient.emit('end')).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
    process.env.NODE_ENV = originalEnv;
  });
});
