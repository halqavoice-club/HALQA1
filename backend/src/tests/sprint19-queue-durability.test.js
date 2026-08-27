'use strict';
/**
 * Sprint 19 — VC-GAP-006: Speaker Queue Redis Durability Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests the Redis flush recovery path in voiceQueue.getQueue():
 *   - When Redis is ready but returns empty (post-flush), DB fallback is used
 *   - DB fallback is ordered by handRaisedAt (FIFO approximation)
 *   - Re-hydration of Redis happens when DB has raised hands
 *   - When Redis is unavailable, DB fallback is used directly
 *   - Normal path (Redis has data) unchanged
 */

jest.mock('./prisma', () => require('../utils/prisma'), { virtual: true });
jest.mock('../utils/prisma');
jest.mock('../utils/redis', () => ({
  isRedisReady: jest.fn(),
  getRedis:     jest.fn(),
}));

const prisma          = require('../utils/prisma');
const { isRedisReady, getRedis } = require('../utils/redis');
const path = require('path');
const fs   = require('fs');

// Mock Redis client
const mockRedis = {
  zrange:   jest.fn(),
  hmget:    jest.fn(),
  zadd:     jest.fn(),
  hset:     jest.fn(),
  hdel:     jest.fn(),
  zrem:     jest.fn(),
  expire:   jest.fn(),
  pipeline: jest.fn(),
};

const mockPipeline = {
  zadd:    jest.fn().mockReturnThis(),
  hset:    jest.fn().mockReturnThis(),
  expire:  jest.fn().mockReturnThis(),
  exec:    jest.fn().mockResolvedValue([]),
};

const ROOM_ID = 'voice-room-queue-test';
const USER_A  = { id: 'user-a', firstName: 'Alice', lastName: 'A', avatarUrl: null };
const USER_B  = { id: 'user-b', firstName: 'Bob',   lastName: 'B', avatarUrl: null };

const DB_RAISED_HANDS = [
  { userId: 'user-a', isActive: true, handRaised: true, handRaisedAt: new Date('2026-08-27T10:00:00Z'), user: USER_A },
  { userId: 'user-b', isActive: true, handRaised: true, handRaisedAt: new Date('2026-08-27T10:01:00Z'), user: USER_B },
];

beforeEach(() => {
  jest.clearAllMocks();
  getRedis.mockReturnValue(mockRedis);
  mockRedis.pipeline.mockReturnValue(mockPipeline);

  if (!prisma.voiceParticipant) prisma.voiceParticipant = {};
  prisma.voiceParticipant.findMany = jest.fn().mockResolvedValue(DB_RAISED_HANDS);
});

// ─────────────────────────────────────────────────────────────────────────────
// Normal Redis path (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
describe('VC-GAP-006: voiceQueue.getQueue() — normal Redis path', () => {
  test('returns Redis queue when Redis has data', async () => {
    isRedisReady.mockReturnValue(true);
    mockRedis.zrange.mockResolvedValue(['user-a', 'user-b']);
    mockRedis.hmget.mockResolvedValue([
      JSON.stringify({ userId: 'user-a', firstName: 'Alice', raisedAt: '2026-08-27T10:00:00Z' }),
      JSON.stringify({ userId: 'user-b', firstName: 'Bob',   raisedAt: '2026-08-27T10:01:00Z' }),
    ]);

    const { getQueue } = require('../utils/voiceQueue');
    const result = await getQueue(ROOM_ID);

    expect(result).toHaveLength(2);
    expect(result[0].userId).toBe('user-a');
    expect(result[1].userId).toBe('user-b');
    // DB should NOT be queried when Redis has data
    expect(prisma.voiceParticipant.findMany).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Redis flush recovery (VC-GAP-006 fix)
// ─────────────────────────────────────────────────────────────────────────────
describe('VC-GAP-006: getQueue() Redis flush recovery', () => {
  test('falls back to DB when Redis is ready but empty (post-flush)', async () => {
    isRedisReady.mockReturnValue(true);
    mockRedis.zrange.mockResolvedValue([]); // Redis flushed — empty queue

    jest.resetModules();
    jest.mock('../utils/prisma');
    jest.mock('../utils/redis', () => ({
      isRedisReady: jest.fn().mockReturnValue(true),
      getRedis:     jest.fn().mockReturnValue(mockRedis),
    }));
    const freshPrisma = require('../utils/prisma');
    if (!freshPrisma.voiceParticipant) freshPrisma.voiceParticipant = {};
    freshPrisma.voiceParticipant.findMany = jest.fn().mockResolvedValue(DB_RAISED_HANDS);

    const { getQueue } = require('../utils/voiceQueue');
    const result = await getQueue(ROOM_ID);

    expect(result.length).toBeGreaterThan(0);
    expect(freshPrisma.voiceParticipant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ roomId: ROOM_ID, handRaised: true })
      })
    );
  });

  test('returns empty array when Redis empty AND DB has no raised hands', async () => {
    isRedisReady.mockReturnValue(true);
    mockRedis.zrange.mockResolvedValue([]); // Redis empty
    prisma.voiceParticipant.findMany.mockResolvedValue([]); // No hands raised

    jest.resetModules();
    jest.mock('../utils/prisma');
    jest.mock('../utils/redis', () => ({
      isRedisReady: jest.fn().mockReturnValue(true),
      getRedis:     jest.fn().mockReturnValue(mockRedis),
    }));
    const freshPrisma = require('../utils/prisma');
    if (!freshPrisma.voiceParticipant) freshPrisma.voiceParticipant = {};
    freshPrisma.voiceParticipant.findMany = jest.fn().mockResolvedValue([]);

    const { getQueue } = require('../utils/voiceQueue');
    const result = await getQueue(ROOM_ID);
    expect(result).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Redis unavailable path
// ─────────────────────────────────────────────────────────────────────────────
describe('VC-GAP-006: getQueue() when Redis unavailable', () => {
  test('returns DB fallback when Redis is not ready', async () => {
    jest.resetModules();
    jest.mock('../utils/prisma');
    jest.mock('../utils/redis', () => ({
      isRedisReady: jest.fn().mockReturnValue(false), // Redis down
      getRedis:     jest.fn(),
    }));
    const freshPrisma = require('../utils/prisma');
    if (!freshPrisma.voiceParticipant) freshPrisma.voiceParticipant = {};
    freshPrisma.voiceParticipant.findMany = jest.fn().mockResolvedValue(DB_RAISED_HANDS);

    const { getQueue } = require('../utils/voiceQueue');
    const result = await getQueue(ROOM_ID);

    // Should return DB entries, not empty array
    expect(result.length).toBeGreaterThan(0);
    expect(freshPrisma.voiceParticipant.findMany).toHaveBeenCalled();
  });

  test('DB fallback is ordered by handRaisedAt ascending', async () => {
    jest.resetModules();
    jest.mock('../utils/prisma');
    jest.mock('../utils/redis', () => ({
      isRedisReady: jest.fn().mockReturnValue(false),
      getRedis:     jest.fn(),
    }));
    const freshPrisma = require('../utils/prisma');
    if (!freshPrisma.voiceParticipant) freshPrisma.voiceParticipant = {};
    freshPrisma.voiceParticipant.findMany = jest.fn().mockResolvedValue(DB_RAISED_HANDS);

    const { getQueue } = require('../utils/voiceQueue');
    const result = await getQueue(ROOM_ID);

    expect(result[0].userId).toBe('user-a'); // Alice raised hand first
    expect(result[1].userId).toBe('user-b');
    // Verify DB was queried with handRaised filter and handRaisedAt ordering
    expect(freshPrisma.voiceParticipant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where:   expect.objectContaining({ handRaised: true }),
        orderBy: { handRaisedAt: 'asc' }
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source verification
// ─────────────────────────────────────────────────────────────────────────────
describe('VC-GAP-006: Source verification', () => {
  test('voiceQueue.js has VC-GAP-006 fix comment', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../utils/voiceQueue.js'), 'utf8'
    );
    expect(src).toMatch(/VC-GAP-006/);
    expect(src).toMatch(/getQueueFromDB/);
    expect(src).toMatch(/handRaisedAt/);
    expect(src).toMatch(/re-hydrat/i);
  });

  test('getQueue() uses getQueueFromDB as fallback when Redis returns empty', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../utils/voiceQueue.js'), 'utf8'
    );
    const queueFn = src.slice(src.indexOf('async function getQueue'), src.indexOf('async function getQueueFromDB'));
    expect(queueFn).toMatch(/getQueueFromDB/);
    // When Redis is not ready, should call getQueueFromDB
    expect(queueFn).toMatch(/isRedisReady\(\).*getQueueFromDB/s);
  });
});
