'use strict';
/**
 * DEF-005 Regression Tests — toggleMute() SFU Enforcement
 * ─────────────────────────────────────────────────────────────────────────────
 * These are MOCKED unit tests. They verify that:
 *   1. sfuRevokePublish() is called with the TARGET participant's identity,
 *      not the caller's identity.
 *   2. HOST protection (403) prevents a moderator from muting the host.
 *   3. Unauthorized users (SPEAKER role) cannot mute another participant.
 *   4. Unmute calls sfuRevokePublish with canPublish=true and only touches
 *      the target participant's DB record.
 *   5. An SFU failure returns sfuEnforced=false with HTTP 200; DB and socket
 *      events still fire.
 *   6. Self-mute does NOT call sfuRevokePublish.
 *
 * IMPORTANT: These mocked tests do NOT prove that an active LiveKit audio
 * track stopped transmitting. They only verify that the correct API call
 * was attempted with the correct arguments.
 */

// ─── Mocks — must be declared before any require() of controller ──────────────

jest.mock('../utils/prisma', () => {
  const mockPrisma = {
    voiceRoom: {
      findUnique: jest.fn(),
      create:     jest.fn(),
      update:     jest.fn(),
    },
    voiceParticipant: {
      findMany:   jest.fn(),
      findUnique: jest.fn(),
      create:     jest.fn(),
      update:     jest.fn().mockResolvedValue({}),
      updateMany: jest.fn(),
      count:      jest.fn(),
    },
    voiceRoomMember: {
      findUnique: jest.fn(),
      create:     jest.fn(),
      update:     jest.fn(),
      count:      jest.fn(),
      upsert:     jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $queryRaw:   jest.fn().mockResolvedValue([{ acquired: 1 }]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn(async (fns, _opts) => {
      if (Array.isArray(fns)) return Promise.all(fns);
      return fns(mockPrisma);
    }),
  };
  return mockPrisma;
});

jest.mock('../utils/redis', () => ({
  setCache:           jest.fn().mockResolvedValue(undefined),
  getCache:           jest.fn().mockResolvedValue(null),
  deleteCache:        jest.fn().mockResolvedValue(undefined),
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
  isRedisReady:       jest.fn().mockReturnValue(false),
}));

// io mock — defined inside jest.mock factory using jest.fn() directly.
// Tests that need to spy on emit should call getIo() after clearAllMocks()
// and inspect ioMock.to / ioMock.emit directly.
jest.mock('../sockets', () => {
  const emitFn = jest.fn();
  const toFn   = jest.fn().mockReturnValue({ emit: emitFn });
  const io     = { to: toFn, emit: emitFn };
  return { getIo: jest.fn().mockReturnValue(io) };
});

jest.mock('../utils/livekitService', () => ({
  sfuRevokePublish:       jest.fn().mockResolvedValue(undefined),
  sfuEvict:               jest.fn().mockResolvedValue(undefined),
  getLivekitRoomService:  jest.fn().mockReturnValue(null),
}));

jest.mock('../utils/voiceRoomCache', () => ({
  invalidateRoomCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/feedLive', () => ({
  broadcastLiveStart:  jest.fn(),
  broadcastLiveEnd:    jest.fn(),
  broadcastLiveUpdate: jest.fn(),
}));

jest.mock('../services/queue.service', () => ({
  queueBulkNotifications: jest.fn(),
  scheduleRoomReminder:   jest.fn(),
  cancelRoomReminder:     jest.fn(),
  scheduleRoomSleep:      jest.fn().mockResolvedValue(undefined),
  cancelRoomSleep:        jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/voiceQueue', () => ({
  clearQueue: jest.fn(),
  enqueue:    jest.fn(),
  getQueue:   jest.fn().mockResolvedValue([]),
  isInQueue:  jest.fn().mockResolvedValue(false),
  dequeue:    jest.fn(),
}));

jest.mock('../utils/autoPromote', () => ({
  autoPromoteNext: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../utils/search', () => ({
  searchVoiceRooms: jest.fn().mockResolvedValue([]),
}));

jest.mock('../controllers/voice-stats.controller', () => ({
  upsertDailyStats: jest.fn().mockResolvedValue(undefined),
}));

// Mock response helpers with simple passthrough so res.body and res.statusCode
// reflect what the controller sends.
jest.mock('../utils/response', () => ({
  successResponse: (res, data, msg, code) => {
    res.statusCode = code || 200;
    res.body = { success: true, data, message: msg };
    return res;
  },
  errorResponse: (res, msg, code, data) => {
    res.statusCode = code || 400;
    res.body = { success: false, message: msg, ...(data || {}) };
    return res;
  },
  paginatedResponse:    jest.fn(),
  getPagination:        jest.fn().mockReturnValue({ skip: 0, page: 1, limit: 20 }),
  buildPaginationMeta:  jest.fn(),
}));

// ─── Load controller after mocks ─────────────────────────────────────────────
const voiceCtrl = require('../controllers/voice.controller');

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeReq(overrides = {}) {
  return {
    params: {},
    body:   {},
    query:  {},
    user:   { id: 'caller-id', role: 'USER' },
    ...overrides,
  };
}

function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json   = (data) => { res.body = data; return res; };
  return res;
}

const next = jest.fn();

// ─── DEF-005 focused tests ────────────────────────────────────────────────────

describe('DEF-005 — toggleMute() SFU enforcement (MOCKED)', () => {

  const prisma              = require('../utils/prisma');
  const { sfuRevokePublish } = require('../utils/livekitService');
  const logger              = require('../utils/logger');
  const { getIo }           = require('../sockets');

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-wire io mock after clearAllMocks() resets all jest.fn() implementations.
    // getIo() must return an object with a working .to().emit() chain.
    const emitFn = jest.fn();
    const toFn   = jest.fn().mockReturnValue({ emit: emitFn });
    getIo.mockReturnValue({ to: toFn, emit: emitFn });
    // Restore default sfuRevokePublish to resolve successfully
    sfuRevokePublish.mockResolvedValue(undefined);
    // Restore default update to resolve
    prisma.voiceParticipant.update.mockResolvedValue({});
  });

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  test(
    'authorized moderator mute calls sfuRevokePublish(roomId, targetId, false, "[voice:mod-mute]") NOT callerId',
    async () => {
      // Caller is MODERATOR, subject is a SPEAKER
      prisma.voiceParticipant.findUnique
        .mockResolvedValueOnce({
          userId: 'caller-id', isActive: true, role: 'MODERATOR',
          isMuted: false, mutedByModerator: false,
        })
        .mockResolvedValueOnce({
          userId: 'target-id', isActive: true, role: 'SPEAKER',
          isMuted: false, mutedByModerator: false,
        });

      const req = makeReq({
        params: { id: 'room-1' },
        body:   { isMuted: true, targetUserId: 'target-id' },
        user:   { id: 'caller-id' },
      });
      const res = makeRes();

      await voiceCtrl.toggleMute(req, res, next);

      // Should call with target identity, NOT caller identity
      expect(sfuRevokePublish).toHaveBeenCalledWith(
        'room-1', 'target-id', false, '[voice:mod-mute]'
      );
      // Verify caller identity was not passed as the identity arg (arg[1])
      const calls = sfuRevokePublish.mock.calls;
      expect(calls.length).toBe(1);
      expect(calls[0][1]).toBe('target-id'); // arg[1] is identity
      expect(calls[0][1]).not.toBe('caller-id');

      expect(res.statusCode).toBe(200);
      expect(res.body.data.sfuEnforced).toBe(true);
    }
  );

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  test(
    'HOST cannot be muted by MODERATOR — 403 and sfuRevokePublish NOT called',
    async () => {
      prisma.voiceParticipant.findUnique
        .mockResolvedValueOnce({
          userId: 'mod-id', isActive: true, role: 'MODERATOR',
          isMuted: false, mutedByModerator: false,
        })
        .mockResolvedValueOnce({
          userId: 'host-id', isActive: true, role: 'HOST',
          isMuted: false, mutedByModerator: false,
        });

      const req = makeReq({
        params: { id: 'room-1' },
        body:   { isMuted: true, targetUserId: 'host-id' },
        user:   { id: 'mod-id' },
      });
      const res = makeRes();

      await voiceCtrl.toggleMute(req, res, next);

      expect(res.statusCode).toBe(403);
      expect(sfuRevokePublish).not.toHaveBeenCalled();
    }
  );

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  test(
    'SPEAKER cannot mute another participant — 403',
    async () => {
      // Only one findUnique call: the caller check — returns SPEAKER role, which is
      // not in MODERATOR_ROLES, so the 403 fires before fetching the subject.
      prisma.voiceParticipant.findUnique
        .mockResolvedValueOnce({
          userId: 'speaker-id', isActive: true, role: 'SPEAKER',
          isMuted: false, mutedByModerator: false,
        });

      const req = makeReq({
        params: { id: 'room-1' },
        body:   { isMuted: true, targetUserId: 'other-speaker-id' },
        user:   { id: 'speaker-id' },
      });
      const res = makeRes();

      await voiceCtrl.toggleMute(req, res, next);

      expect(res.statusCode).toBe(403);
      expect(sfuRevokePublish).not.toHaveBeenCalled();
    }
  );

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  test(
    'authorized unmute calls sfuRevokePublish with canPublish=true and does not clear other participants mutedByModerator',
    async () => {
      prisma.voiceParticipant.findUnique
        .mockResolvedValueOnce({
          userId: 'host-id', isActive: true, role: 'HOST',
          isMuted: false, mutedByModerator: false,
        })
        .mockResolvedValueOnce({
          userId: 'target-id', isActive: true, role: 'SPEAKER',
          isMuted: true, mutedByModerator: true,
        });

      const req = makeReq({
        params: { id: 'room-1' },
        body:   { isMuted: false, targetUserId: 'target-id' },
        user:   { id: 'host-id' },
      });
      const res = makeRes();

      await voiceCtrl.toggleMute(req, res, next);

      // SFU called with canPublish=true (unmuting)
      expect(sfuRevokePublish).toHaveBeenCalledWith(
        'room-1', 'target-id', true, '[voice:mod-unmute]'
      );

      // DB update must target only the subject, clearing mutedByModerator
      expect(prisma.voiceParticipant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { roomId_userId: { roomId: 'room-1', userId: 'target-id' } },
          data:  expect.objectContaining({ isMuted: false, mutedByModerator: false }),
        })
      );
      // Confirm only ONE update call — not touching other participants
      expect(prisma.voiceParticipant.update).toHaveBeenCalledTimes(1);

      expect(res.body.data.sfuEnforced).toBe(true);
    }
  );

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  // MOCKED — does not prove audio track stopped at the SFU level.
  test(
    'SFU failure returns sfuEnforced=false but HTTP 200 — DB and socket still fire (MOCKED — does not prove audio track stopped)',
    async () => {
      prisma.voiceParticipant.findUnique
        .mockResolvedValueOnce({
          userId: 'host-id', isActive: true, role: 'HOST',
          isMuted: false, mutedByModerator: false,
        })
        .mockResolvedValueOnce({
          userId: 'target-id', isActive: true, role: 'SPEAKER',
          isMuted: false, mutedByModerator: false,
        });

      // Simulate sfuRevokePublish throwing (unexpected error outside its own try/catch)
      sfuRevokePublish.mockRejectedValue(new Error('SFU timeout'));

      // Override the io mock for this test so we can spy on emit directly.
      const emitSpy = jest.fn();
      const toSpy   = jest.fn().mockReturnValue({ emit: emitSpy });
      getIo.mockReturnValue({ to: toSpy, emit: emitSpy });

      const req = makeReq({
        params: { id: 'room-1' },
        body:   { isMuted: true, targetUserId: 'target-id' },
        user:   { id: 'host-id' },
      });
      const res = makeRes();

      await voiceCtrl.toggleMute(req, res, next);

      // HTTP 200 — mute is recorded even when SFU fails
      expect(res.statusCode).toBe(200);
      // sfuEnforced flag tells the caller that SFU enforcement did NOT succeed
      expect(res.body.data.sfuEnforced).toBe(false);

      // DB update was still persisted
      expect(prisma.voiceParticipant.update).toHaveBeenCalledTimes(1);

      // Socket event was still emitted
      expect(emitSpy).toHaveBeenCalledWith(
        'voice:mute_changed',
        expect.objectContaining({ userId: 'target-id', isMuted: true })
      );

      // Either logger.warn was called with 'SFU' content, OR sfuRevokePublish
      // was invoked (confirming the attempt was made before failure).
      const warnCalled = logger.warn.mock.calls.some(
        args => typeof args[0] === 'string' && args[0].includes('SFU')
      );
      const sfuAttempted = sfuRevokePublish.mock.calls.length > 0;
      expect(warnCalled || sfuAttempted).toBe(true);
    }
  );

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  test(
    'self-mute does NOT call sfuRevokePublish',
    async () => {
      // Self-mute: no targetUserId — subjectId === callerId
      prisma.voiceParticipant.findUnique
        .mockResolvedValueOnce({
          userId: 'speaker-id', isActive: true, role: 'SPEAKER',
          isMuted: false, mutedByModerator: false,
        });

      const req = makeReq({
        params: { id: 'room-1' },
        body:   { isMuted: true }, // no targetUserId → self-mute
        user:   { id: 'speaker-id' },
      });
      const res = makeRes();

      await voiceCtrl.toggleMute(req, res, next);

      expect(sfuRevokePublish).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
      // sfuEnforced should not be present in self-mute response
      expect(res.body.data.sfuEnforced).toBeUndefined();
    }
  );
});

// ─── muteAll / removeModerator regression (static source analysis) ────────────

describe('DEF-005 — muteAll regression (MOCKED static analysis)', () => {
  const fs   = require('fs');
  const path = require('path');
  const src  = fs.readFileSync(
    path.join(__dirname, '../controllers/voice-roles.controller.js'), 'utf8'
  );

  test('muteAll still contains sfuRevokePublish call', () => {
    const muteAllIdx = src.indexOf('async function muteAll');
    const nextIdx    = src.indexOf('async function', muteAllIdx + 10);
    const fn         = src.slice(muteAllIdx, nextIdx);
    expect(fn).toMatch(/sfuRevokePublish/);
  });

  test('removeModerator still contains sfuRevokePublish call', () => {
    const fnIdx   = src.indexOf('async function removeModerator');
    const nextIdx = src.indexOf('async function', fnIdx + 10);
    const fn      = src.slice(fnIdx, nextIdx);
    expect(fn).toMatch(/sfuRevokePublish/);
  });
});
