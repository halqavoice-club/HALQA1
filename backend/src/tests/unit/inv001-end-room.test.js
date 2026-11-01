/**
 * INV-001: Room Termination LiveKit Cleanup — unit tests
 *
 * Covers endRoom() (voice.controller.js) and the LiveKit token endpoints
 * (livekit.controller.js). All DB, Redis, Socket.IO, SFU and LiveKit SDK
 * boundaries are mocked. No real database or network access is required.
 *
 * Mock patterns mirror backend/src/tests/unit/autoPromote.test.js and the
 * response helper mock used by backend/src/tests/voice-p0-queue-approval-consent.test.js.
 */

// ── Mocks ───────────────────────────────────────────────────────────────────
jest.mock('../../utils/prisma', () => ({
  voiceRoom: { findUnique: jest.fn(), update: jest.fn() },
  voiceParticipant: {
    findUnique: jest.fn(), findMany: jest.fn(),
    update: jest.fn(), updateMany: jest.fn(), count: jest.fn(),
  },
  voiceMessage: { count: jest.fn() },
  auditLog: { create: jest.fn() },
  dailyUserStats: { upsert: jest.fn() },
  user: { findUnique: jest.fn() },
  liveClass: { findFirst: jest.fn() },
  schoolMembership: { findUnique: jest.fn() },
  liveClassParticipant: { findFirst: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
}));
jest.mock('../../utils/redis', () => ({
  getRedis: jest.fn(), isRedisReady: jest.fn(), deleteCache: jest.fn(),
  setCache: jest.fn(), getCache: jest.fn(),
}));
jest.mock('../../utils/voiceRoomCache', () => ({
  invalidateRoomCache: jest.fn(),
  getNextStageVersion: jest.fn(() => Promise.resolve(1)),
  getCurrentStageVersion: jest.fn(() => Promise.resolve(0)),
}));
jest.mock('../../sockets', () => ({ getIo: jest.fn() }));
jest.mock('../../utils/livekitService', () => ({
  sfuRevokePublish: jest.fn(),
  sfuEvict: jest.fn(),
  getLivekitRoomService: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../utils/response', () => ({
  successResponse: (res, data, message, status = 200) => {
    Object.assign(res, { statusCode: status, body: { success: true, data, message } });
    return res;
  },
  errorResponse: (res, message, status = 400) => {
    Object.assign(res, { statusCode: status, body: { success: false, message } });
    return res;
  },
  paginatedResponse: jest.fn(),
  getPagination: jest.fn(),
  buildPaginationMeta: jest.fn(),
}));
jest.mock('../../controllers/voice-stats.controller', () => ({ upsertDailyStats: jest.fn() }));
jest.mock('../../utils/voiceQueue', () => ({
  clearQueue: jest.fn(), enqueue: jest.fn(), getQueue: jest.fn(),
  isInQueue: jest.fn(), dequeue: jest.fn(),
}));
jest.mock('../../utils/autoPromote', () => ({ autoPromoteNext: jest.fn() }));
jest.mock('../../middleware/voiceRole.middleware', () => ({
  VOICE_ROLES: { HOST: 'HOST', MODERATOR: 'MODERATOR', SPEAKER: 'SPEAKER', AUDIENCE: 'AUDIENCE' },
  MODERATOR_ROLES: ['HOST', 'MODERATOR'],
  SPEAKER_ROLES: ['HOST', 'MODERATOR', 'SPEAKER'],
}));
jest.mock('../../utils/feedLive', () => ({
  broadcastLiveStart: jest.fn(), broadcastLiveEnd: jest.fn(), broadcastLiveUpdate: jest.fn(),
}));
jest.mock('../../services/queue.service', () => ({
  queueBulkNotifications: jest.fn(), scheduleRoomReminder: jest.fn(), cancelRoomReminder: jest.fn(),
}));
jest.mock('../../utils/voiceAudioPermission', () => ({ getVoiceAudioPermission: jest.fn() }));
jest.mock('../../utils/storage', () => ({ saveFile: jest.fn(), deleteFile: jest.fn() }));

// livekit-server-sdk mock — captures the AccessToken constructor options
// (ttl is the 3rd argument). mock-prefixed so it may be referenced in the hoisted factory.
const mockAccessTokenOpts = {};
jest.mock('livekit-server-sdk', () => ({
  AccessToken: jest.fn().mockImplementation(function (apiKey, apiSecret, options) {
    Object.assign(mockAccessTokenOpts, options || {});
    return { addGrant: jest.fn(), toJwt: jest.fn().mockResolvedValue('mock-token') };
  }),
  RoomServiceClient: jest.fn().mockImplementation(function () {
    return { removeParticipant: jest.fn(), updateParticipant: jest.fn() };
  }),
}));

// ── Requires (after mocks) ──────────────────────────────────────────────────
const prisma = require('../../utils/prisma');
const { getLivekitRoomService } = require('../../utils/livekitService');
const { getIo } = require('../../sockets');
const { invalidateRoomCache } = require('../../utils/voiceRoomCache');
const { clearQueue } = require('../../utils/voiceQueue');
const { upsertDailyStats } = require('../../controllers/voice-stats.controller');
const { broadcastLiveEnd } = require('../../utils/feedLive');
const { getVoiceAudioPermission } = require('../../utils/voiceAudioPermission');
const voice = require('../../controllers/voice.controller');       // endRoom
const livekit = require('../../controllers/livekit.controller'); // getLiveKitToken, generateToken
const { AccessToken } = require('livekit-server-sdk');

// ── Constants & helpers ─────────────────────────────────────────────────────
const ROOM_ID = 'room-1';
const ADMIN_ID = 'admin-1';

function baseRoom(overrides = {}) {
  return {
    id: ROOM_ID,
    status: 'LIVE',
    startedAt: new Date('2026-10-31T09:00:00Z'),
    hostId: 'host-1',
    deletedAt: null,
    _count: { participants: 2 },
    micLocked: false,
    allMuted: false,
    ...overrides,
  };
}

// A transaction client mock that records call order on a shared _order array.
function makeMockTx(opts = {}) {
  const order = [];
  const snapshot = opts.snapshot !== undefined ? opts.snapshot
    : [{ userId: 'u1', joinedAt: new Date('2026-10-31T09:30:00Z') },
       { userId: 'u2', joinedAt: new Date('2026-10-31T09:45:00Z') }];
  return {
    _order: order,
    $queryRaw: jest.fn(async () => {
      order.push('queryRaw');
      return opts.locked !== undefined ? opts.locked : [{ id: ROOM_ID }];
    }),
    voiceRoom: {
      findUnique: jest.fn(async () => {
        order.push('voiceRoom.findUnique');
        return opts.recheckStatus !== undefined ? { status: opts.recheckStatus } : { status: 'LIVE' };
      }),
      update: jest.fn(async () => {
        order.push('voiceRoom.update');
        return { id: ROOM_ID, status: 'ENDED' };
      }),
    },
    voiceParticipant: {
      findMany: jest.fn(async () => {
        order.push('voiceParticipant.findMany');
        return snapshot;
      }),
      updateMany: jest.fn(async () => {
        order.push('voiceParticipant.updateMany');
        return { count: snapshot.length };
      }),
    },
  };
}

// A mock LiveKit RoomServiceClient that records call order and can be made to
// reject (404) on removeParticipant and/or deleteRoom.
function makeSvc({ remove = 'resolve', deleteRoom = 'resolve' } = {}) {
  const order = [];
  return {
    _order: order,
    removeParticipant: jest.fn(async (room, id) => {
      order.push(`remove:${id}`);
      if (remove === 'reject') throw { status: 404, message: 'not found' };
    }),
    deleteRoom: jest.fn(async (room) => {
      order.push('deleteRoom');
      if (deleteRoom === 'reject') throw { status: 404, message: 'not found' };
    }),
  };
}

function reqRes(overrides = {}) {
  const req = {
    params: { id: overrides.roomId || ROOM_ID },
    query: overrides.query || {},
    body: overrides.body || {},
    user: {
      id: overrides.userId || ADMIN_ID,
      role: overrides.role || 'SUPER_ADMIN',
      schoolId: overrides.schoolId || 'school-1',
      firstName: overrides.firstName || 'Admin',
      lastName: overrides.lastName || 'User',
    },
  };
  const res = {};
  const next = jest.fn();
  return { req, res, next };
}

// ── Shared defaults reset before every test ─────────────────────────────────
beforeEach(() => {
  // Clear captured AccessToken options.
  Object.keys(mockAccessTokenOpts).forEach((k) => delete mockAccessTokenOpts[k]);

  // Side-effect mock defaults.
  prisma.voiceParticipant.count.mockResolvedValue(0);
  prisma.voiceMessage.count.mockResolvedValue(0);
  prisma.dailyUserStats.upsert.mockResolvedValue({});
  prisma.auditLog.create.mockResolvedValue({});
  upsertDailyStats.mockResolvedValue();
  clearQueue.mockResolvedValue();
  invalidateRoomCache.mockResolvedValue();
  getIo.mockReturnValue(null);
  getLivekitRoomService.mockReturnValue(null);
  getVoiceAudioPermission.mockReturnValue({ canPublishAudio: true, reason: 'test' });

  // Default room for the endRoom initial lookup / generateToken voice lookup.
  prisma.voiceRoom.findUnique.mockResolvedValue(baseRoom());
  // Default transaction runs the callback against a fresh mock tx.
  prisma.$transaction.mockImplementation(async (cb) => cb(makeMockTx()));
  // Non-BANNED fresh user for the livekit ban checks.
  prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
  // Default active participant for generateToken voice-room path.
  prisma.voiceParticipant.findUnique.mockResolvedValue({ isActive: true, role: 'SPEAKER' });
  prisma.voiceParticipant.findMany.mockResolvedValue([{ userId: 'u1' }]);
});

// ════════════════════════════════════════════════════════════════════════════
// endRoom() — voice.controller.js
// ════════════════════════════════════════════════════════════════════════════
describe('INV-001: endRoom LiveKit cleanup', () => {

  it('1. wraps DB mutations in $transaction', async () => {
    const tx = makeMockTx();
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    prisma.voiceRoom.findUnique.mockResolvedValue(baseRoom());

    const { req, res, next } = reqRes();
    await voice.endRoom(req, res, next);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.voiceParticipant.updateMany).toHaveBeenCalled();
    expect(tx.voiceRoom.update).toHaveBeenCalled();
    // Mutations happen inside the tx, never as top-level prisma calls.
    expect(prisma.voiceParticipant.updateMany).not.toHaveBeenCalled();
    expect(prisma.voiceRoom.update).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('2. acquires voice_rooms FOR UPDATE as the first tx operation', async () => {
    const tx = makeMockTx();
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    prisma.voiceRoom.findUnique.mockResolvedValue(baseRoom());

    const { req, res, next } = reqRes();
    await voice.endRoom(req, res, next);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = tx.$queryRaw.mock.calls[0][0].join('');
    expect(sql).toContain('voice_rooms');
    expect(sql).toContain('FOR UPDATE');
    // The room lock runs before the participant updateMany.
    expect(tx._order.indexOf('queryRaw')).toBeLessThan(tx._order.indexOf('voiceParticipant.updateMany'));
  });

  it('3. re-checks status inside the lock — already ENDED returns 400', async () => {
    const tx = makeMockTx({ recheckStatus: 'ENDED' });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    // Initial room is LIVE so the pre-lock ENDED check passes; the lock re-check fails.
    prisma.voiceRoom.findUnique.mockResolvedValue(baseRoom({ status: 'LIVE' }));

    const { req, res, next } = reqRes();
    await voice.endRoom(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Room already archived');
    expect(tx.voiceParticipant.updateMany).not.toHaveBeenCalled();
    expect(tx.voiceRoom.update).not.toHaveBeenCalled();
  });

  it('4. captures participant snapshot before updateMany', async () => {
    const snapshot = [
      { userId: 'u1', joinedAt: new Date('2026-10-31T09:30:00Z') },
      { userId: 'u2', joinedAt: new Date('2026-10-31T09:45:00Z') },
    ];
    const tx = makeMockTx({ snapshot });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    prisma.voiceRoom.findUnique.mockResolvedValue(baseRoom());

    const { req, res, next } = reqRes();
    await voice.endRoom(req, res, next);

    expect(tx.voiceParticipant.findMany).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, isActive: true },
      select: { userId: true, joinedAt: true },
    });
    // Pre-snapshot happens before deactivation.
    expect(tx._order.indexOf('voiceParticipant.findMany'))
      .toBeLessThan(tx._order.indexOf('voiceParticipant.updateMany'));
  });

  it('5. calls removeParticipant for each snapshot identity', async () => {
    const snapshot = [
      { userId: 'u1', joinedAt: new Date('2026-10-31T09:30:00Z') },
      { userId: 'u2', joinedAt: new Date('2026-10-31T09:45:00Z') },
      { userId: 'u3', joinedAt: new Date('2026-10-31T09:50:00Z') },
    ];
    const tx = makeMockTx({ snapshot });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    const svc = makeSvc();
    getLivekitRoomService.mockReturnValue(svc);

    const { req, res, next } = reqRes();
    await voice.endRoom(req, res, next);

    expect(svc.removeParticipant).toHaveBeenCalledTimes(snapshot.length);
    snapshot.forEach((p) => {
      expect(svc.removeParticipant).toHaveBeenCalledWith(ROOM_ID, p.userId);
    });
  });

  it('6. removeParticipant 404 counted as disconnected (not failed)', async () => {
    const snapshot = [
      { userId: 'u1', joinedAt: new Date('2026-10-31T09:30:00Z') },
      { userId: 'u2', joinedAt: new Date('2026-10-31T09:45:00Z') },
    ];
    const tx = makeMockTx({ snapshot });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    const svc = makeSvc({ remove: 'reject' }); // every removeParticipant rejects 404
    getLivekitRoomService.mockReturnValue(svc);

    const { req, res, next } = reqRes();
    await voice.endRoom(req, res, next);

    const cleanup = res.body.data.sfuCleanup;
    expect(cleanup.participantsDisconnected).toBe(2);
    expect(cleanup.participantsFailed).toBe(0);
  });

  it('7. calls deleteRoom after the removeParticipant loop', async () => {
    const snapshot = [
      { userId: 'u1', joinedAt: new Date('2026-10-31T09:30:00Z') },
      { userId: 'u2', joinedAt: new Date('2026-10-31T09:45:00Z') },
    ];
    const tx = makeMockTx({ snapshot });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    const svc = makeSvc();
    getLivekitRoomService.mockReturnValue(svc);

    const { req, res, next } = reqRes();
    await voice.endRoom(req, res, next);

    expect(svc.deleteRoom).toHaveBeenCalledTimes(1);
    expect(svc.deleteRoom).toHaveBeenCalledWith(ROOM_ID);
    // deleteRoom is the last operation, after every removeParticipant.
    expect(svc._order[svc._order.length - 1]).toBe('deleteRoom');
    expect(svc._order.filter((e) => e.startsWith('remove:')).length).toBe(2);
    expect(svc._order.indexOf('deleteRoom')).toBeGreaterThan(
      svc._order.lastIndexOf('remove:u2')
    );
  });

  it('8. deleteRoom 404 sets roomDeleted=true', async () => {
    const tx = makeMockTx();
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    const svc = makeSvc({ deleteRoom: 'reject' }); // deleteRoom rejects 404
    getLivekitRoomService.mockReturnValue(svc);

    const { req, res, next } = reqRes();
    await voice.endRoom(req, res, next);

    const cleanup = res.body.data.sfuCleanup;
    expect(cleanup.roomDeleted).toBe(true);
  });

  it('9. null getLivekitRoomService — notConfigured=true, 200', async () => {
    const tx = makeMockTx();
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    getLivekitRoomService.mockReturnValue(null);

    const { req, res, next } = reqRes();
    await voice.endRoom(req, res, next);

    expect(res.statusCode).toBe(200);
    const cleanup = res.body.data.sfuCleanup;
    expect(cleanup.notConfigured).toBe(true);
    expect(cleanup.participantsAttempted).toBe(0);
    expect(cleanup.roomDeleted).toBe(false);
  });

  it('10. sfuCleanup does NOT include a tokenRevoked field', async () => {
    const tx = makeMockTx();
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    getLivekitRoomService.mockReturnValue(null);

    const { req, res, next } = reqRes();
    await voice.endRoom(req, res, next);

    const cleanup = res.body.data.sfuCleanup;
    expect(cleanup.tokenRevoked).toBeUndefined();
    expect(Object.keys(cleanup).sort()).toEqual([
      'notConfigured',
      'participantsAttempted',
      'participantsDisconnected',
      'participantsFailed',
      'participantsTimedOut',
      'roomDeleted',
    ]);
  });

  it('11. sfuRetry=true on ENDED room — no DB mutations', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue(baseRoom({ status: 'ENDED' }));
    prisma.voiceParticipant.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
    getLivekitRoomService.mockReturnValue(null);

    const { req, res, next } = reqRes({ query: { sfuRetry: 'true' } });
    await voice.endRoom(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('SFU cleanup retry complete');
    // Cleanup-only path performs no voice DB mutations.
    expect(prisma.voiceParticipant.updateMany).not.toHaveBeenCalled();
    expect(prisma.voiceRoom.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('12. sfuRetry=true requires SUPER_ADMIN (HOST gets 403)', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue(baseRoom({ status: 'ENDED' }));

    const { req, res, next } = reqRes({ role: 'HOST', query: { sfuRetry: 'true' } });
    await voice.endRoom(req, res, next);

    expect(res.statusCode).toBe(403);
    // The SUPER_ADMIN check fires before the retry path, so no cleanup ran.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['HOST', 'TEACHER', 'MEMBER'])(
    '13. endRoom 403 for non-SUPER_ADMIN role=%s',
    async (role) => {
      prisma.voiceRoom.findUnique.mockResolvedValue(baseRoom());

      const { req, res, next } = reqRes({ role });
      await voice.endRoom(req, res, next);

      expect(res.statusCode).toBe(403);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  );

  it('14. 400 on already-ENDED room without sfuRetry', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue(baseRoom({ status: 'ENDED' }));

    const { req, res, next } = reqRes(); // no sfuRetry query
    await voice.endRoom(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Room already archived');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('15. voiceMinutes uses pre-snapshot data', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-31T11:00:00Z') });
    try {
      const snapshot = [
        { userId: 'u1', joinedAt: new Date('2026-10-31T09:30:00Z') }, // 90 min
        { userId: 'u2', joinedAt: new Date('2026-10-31T09:45:00Z') }, // 75 min
      ];
      const tx = makeMockTx({ snapshot });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));
      getLivekitRoomService.mockReturnValue(null);

      const { req, res, next } = reqRes();
      await voice.endRoom(req, res, next);

      // No extra DB re-query with leftAt: endedAt.
      expect(prisma.voiceParticipant.findMany).not.toHaveBeenCalled();
      // One upsert per snapshotted participant, with computed voiceMinutes.
      expect(prisma.dailyUserStats.upsert).toHaveBeenCalledTimes(snapshot.length);
      const calls = prisma.dailyUserStats.upsert.mock.calls;
      expect(calls[0][0].where.userId_date.userId).toBe('u1');
      expect(calls[0][0].create.voiceMinutes).toBe(90);
      expect(calls[1][0].where.userId_date.userId).toBe('u2');
      expect(calls[1][0].create.voiceMinutes).toBe(75);
    } finally {
      jest.useRealTimers();
    }
  });

  it('16. response includes sfuCleanup field', async () => {
    const tx = makeMockTx();
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    const svc = makeSvc();
    getLivekitRoomService.mockReturnValue(svc);

    const { req, res, next } = reqRes();
    await voice.endRoom(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Room ended');
    expect(res.body.data.sfuCleanup).toEqual(expect.objectContaining({
      participantsAttempted: expect.any(Number),
      participantsDisconnected: expect.any(Number),
      participantsFailed: expect.any(Number),
      participantsTimedOut: expect.any(Number),
      roomDeleted: expect.any(Boolean),
      notConfigured: expect.any(Boolean),
    }));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LiveKit token endpoints — livekit.controller.js
// ════════════════════════════════════════════════════════════════════════════
describe('INV-001: LiveKit token TTL', () => {

  it('17. Voice Club getLiveKitToken TTL is 10m', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue(
      baseRoom({ status: 'LIVE', deletedAt: null, micLocked: false, allMuted: false })
    );
    prisma.voiceParticipant.findUnique.mockResolvedValue({
      role: 'SPEAKER', isActive: true, isMuted: true, mutedByModerator: false, seatNumber: 1,
    });

    const { req, res, next } = reqRes({
      roomId: ROOM_ID, userId: 'u1', role: 'MEMBER', firstName: 'T', lastName: 'U',
    });
    await livekit.getLiveKitToken(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(mockAccessTokenOpts.ttl).toBe('10m');
  });

  it('18. generateToken DB exception returns 503 (fail-closed)', async () => {
    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.voiceRoom.findUnique.mockRejectedValue(new Error('DB connection lost'));

    const { req, res, next } = reqRes({
      body: { roomId: 'room-xyz' }, role: 'MEMBER', schoolId: null, firstName: 'T', lastName: 'U',
    });
    await livekit.generateToken(req, res, next);

    expect(res.statusCode).toBe(503);
    expect(res.body.message).toBe('Unable to verify room status');
  });

  it('19. generateToken for Voice Club room uses 10m TTL', async () => {
    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.voiceRoom.findUnique.mockResolvedValue({ id: ROOM_ID, status: 'LIVE', deletedAt: null });
    prisma.voiceParticipant.findUnique.mockResolvedValue({ isActive: true });

    const { req, res, next } = reqRes({
      body: { roomId: ROOM_ID }, role: 'MEMBER', schoolId: null, firstName: 'T', lastName: 'U',
    });
    await livekit.generateToken(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(mockAccessTokenOpts.ttl).toBe('10m');
  });

  it('20. generateToken for non-voice room uses 1h TTL', async () => {
    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.voiceRoom.findUnique.mockResolvedValue(null); // not a voice room

    const { req, res, next } = reqRes({
      body: { roomId: 'pk-custom-battle-room' }, role: 'MEMBER', schoolId: null, firstName: 'T', lastName: 'U',
    });
    await livekit.generateToken(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(mockAccessTokenOpts.ttl).toBe('1h');
  });

  it('21. Live Class token TTL is 1h (unchanged)', async () => {
    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.liveClass.findFirst.mockResolvedValue({ id: 'abc-123', schoolId: 'school-1', status: 'LIVE' });
    prisma.schoolMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', deletedAt: null });
    prisma.liveClassParticipant.findFirst.mockResolvedValue({ id: 'p1' });

    const { req, res, next } = reqRes({
      body: { roomId: 'liveclass-abc-123' }, role: 'MEMBER', schoolId: 'school-1', firstName: 'T', lastName: 'U',
    });
    await livekit.generateToken(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(mockAccessTokenOpts.ttl).toBe('1h');
    // The voice-room branch is skipped for liveclass-* room names.
    expect(prisma.voiceRoom.findUnique).not.toHaveBeenCalled();
  });
});
