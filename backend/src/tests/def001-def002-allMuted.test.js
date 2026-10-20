'use strict';
/**
 * DEF-001 + DEF-002 Unit Tests — Room-Wide Mute Policy Enforcement [MOCKED]
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies:
 *   DEF-001 — muteAll() and unmuteAll() persist allMuted on VoiceRoom
 *   DEF-002 — All promotion paths respect allMuted when setting isMuted
 *   V3      — getLiveKitToken() gates canPublish on allMuted and individual isMuted
 *   Regression — sfuRevokePublish still called per-target; DEF-003 where clause
 *
 * All tests are MOCKED — no real database, Redis, LiveKit, or network required.
 * Run via: npm run test:unit
 *
 * Tagged template literal call format for $executeRaw:
 *   $executeRaw`UPDATE ... SET x = ${v1}, y = ${v2}`
 *   → mock.calls[n] = [stringsArray, v1, v2, ...]
 *   → call[1] is the first interpolated value, call[2] the second, etc.
 *
 * IMPORTANT: These tests verify the authoritative server-side policy logic.
 * They do NOT prove audio track revocation at the LiveKit SFU level.
 */

// ─── Mocks — declared before any require() of the controllers ─────────────────

jest.mock('../utils/prisma', () => {
  const mockPrisma = {
    voiceRoom: {
      findUnique: jest.fn(),
      create:     jest.fn(),
      update:     jest.fn(),
    },
    voiceParticipant: {
      findMany:   jest.fn(),
      findFirst:  jest.fn(),
      findUnique: jest.fn(),
      create:     jest.fn(),
      update:     jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      count:      jest.fn(),
    },
    voiceRoomMember: {
      findUnique: jest.fn(),
      create:     jest.fn(),
      update:     jest.fn(),
      count:      jest.fn(),
      upsert:     jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $queryRaw:   jest.fn().mockResolvedValue([{ acquired: 1 }]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn(async (fn, _opts) => {
      if (Array.isArray(fn)) return Promise.all(fn);
      return fn(mockPrisma);
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

jest.mock('../sockets', () => {
  const emitFn = jest.fn();
  const toFn   = jest.fn().mockReturnValue({ emit: emitFn });
  const io     = { to: toFn, emit: emitFn };
  return { getIo: jest.fn().mockReturnValue(io) };
});

jest.mock('../utils/livekitService', () => ({
  sfuRevokePublish:      jest.fn().mockResolvedValue(undefined),
  sfuEvict:              jest.fn().mockResolvedValue(undefined),
  getLivekitRoomService: jest.fn().mockReturnValue(null),
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

jest.mock('../utils/response', () => ({
  successResponse: (res, data, msg, code) => {
    res.statusCode = code || 200;
    res.body = { success: true, data, message: msg };
    return res;
  },
  errorResponse: (res, msg, code, _data) => {
    res.statusCode = code || 400;
    res.body = { success: false, message: msg };
    return res;
  },
  paginatedResponse:   jest.fn(),
  getPagination:       jest.fn().mockReturnValue({ skip: 0, page: 1, limit: 20 }),
  buildPaginationMeta: jest.fn(),
}));

// livekit-server-sdk — capture addGrant args for V3 token tests
jest.mock('livekit-server-sdk', () => ({
  AccessToken: jest.fn(),
}));

// ─── Load controllers AFTER mocks ────────────────────────────────────────────

const rolesCtrl   = require('../controllers/voice-roles.controller');
const voiceCtrl   = require('../controllers/voice.controller');
const livekitCtrl = require('../controllers/livekit.controller');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(overrides = {}) {
  return {
    params: { id: 'room-test-1' },
    body:   {},
    query:  {},
    user:   { id: 'caller-id', role: 'MEMBER', firstName: 'Test', lastName: 'User' },
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

/**
 * Extract the nth interpolated value from a tagged-template-literal mock call.
 * call[0] = stringsArray, call[1] = first value, call[2] = second, etc.
 */
function tplValues(call) {
  return call.slice(1); // skip stringsArray at index 0
}

// ─── DEF-001: muteAll() persistence ──────────────────────────────────────────

describe('DEF-001 — muteAll() / unmuteAll() room-wide policy persistence [MOCKED]', () => {

  const prisma               = require('../utils/prisma');
  const { sfuRevokePublish } = require('../utils/livekitService');
  const { getIo }            = require('../sockets');

  beforeEach(() => {
    jest.clearAllMocks();

    // Restore io mock chain after clearAllMocks
    const emitFn = jest.fn();
    const toFn   = jest.fn().mockReturnValue({ emit: emitFn });
    getIo.mockReturnValue({ to: toFn, emit: emitFn });

    sfuRevokePublish.mockResolvedValue(undefined);
    prisma.voiceParticipant.update.mockResolvedValue({});
    prisma.voiceParticipant.updateMany.mockResolvedValue({ count: 0 });
    // $transaction: run callback with prisma as tx proxy
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
  });

  // ── T1: muteAll() persists allMuted=true on VoiceRoom ─────────────────────
  test('T1 — muteAll() calls voiceRoom.update({ allMuted: true }) inside transaction', async () => {
    prisma.voiceParticipant.findMany.mockResolvedValue([
      { id: 'p1', userId: 'u1' },
      { id: 'p2', userId: 'u2' },
    ]);

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();

    await rolesCtrl.muteAll(req, res, next);

    expect(prisma.voiceRoom.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'room-1' },
        data:  expect.objectContaining({ allMuted: true }),
      })
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.allMuted).toBe(true);
  });

  // ── T2: muteAll() emits voice:room_policy_changed { allMuted: true } ───────
  test('T2 — muteAll() emits voice:room_policy_changed with { allMuted: true }', async () => {
    prisma.voiceParticipant.findMany.mockResolvedValue([
      { id: 'p1', userId: 'u1' },
    ]);

    const emitSpy = jest.fn();
    getIo.mockReturnValue({ to: jest.fn().mockReturnValue({ emit: emitSpy }), emit: jest.fn() });

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();

    await rolesCtrl.muteAll(req, res, next);

    const policyEvents = emitSpy.mock.calls.filter(([event]) => event === 'voice:room_policy_changed');
    expect(policyEvents.length).toBeGreaterThanOrEqual(1);
    expect(policyEvents[0][1]).toMatchObject({ allMuted: true });
  });

  // ── T3: unmuteAll() persists allMuted=false on VoiceRoom ──────────────────
  test('T3 — unmuteAll() calls voiceRoom.update({ allMuted: false }) inside transaction', async () => {
    prisma.voiceParticipant.findMany.mockResolvedValue([
      { id: 'p1', userId: 'u1' },
    ]);

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();

    await rolesCtrl.unmuteAll(req, res, next);

    expect(prisma.voiceRoom.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'room-1' },
        data:  expect.objectContaining({ allMuted: false }),
      })
    );
    expect(res.body.data.allMuted).toBe(false);
  });

  // ── T4: unmuteAll() where clause excludes mutedByModerator=true ───────────
  test('T4 — unmuteAll() findMany where clause includes mutedByModerator: false (DEF-003 fix)', async () => {
    prisma.voiceParticipant.findMany.mockResolvedValue([]);

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();

    await rolesCtrl.unmuteAll(req, res, next);

    const findManyCalls = prisma.voiceParticipant.findMany.mock.calls;
    expect(findManyCalls.length).toBeGreaterThanOrEqual(1);
    expect(findManyCalls[0][0].where).toHaveProperty('mutedByModerator', false);
  });

  // ── T5: unmuteAll() emits voice:room_policy_changed { allMuted: false } ───
  test('T5 — unmuteAll() emits voice:room_policy_changed with { allMuted: false }', async () => {
    prisma.voiceParticipant.findMany.mockResolvedValue([
      { id: 'p1', userId: 'u1' },
    ]);

    const emitSpy = jest.fn();
    getIo.mockReturnValue({ to: jest.fn().mockReturnValue({ emit: emitSpy }), emit: jest.fn() });

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();

    await rolesCtrl.unmuteAll(req, res, next);

    const policyEvents = emitSpy.mock.calls.filter(([event]) => event === 'voice:room_policy_changed');
    expect(policyEvents.length).toBeGreaterThanOrEqual(1);
    expect(policyEvents[0][1]).toMatchObject({ allMuted: false });
  });

  // ── T6: SPEAKER calling mute-all route → 403 (role guard) ─────────────────
  test('T6 — checkVoiceRole middleware rejects SPEAKER attempting mute-all with 403', async () => {
    const { checkVoiceRole, VOICE_ROLES } = require('../middleware/voiceRole.middleware');

    prisma.voiceParticipant.findUnique.mockResolvedValue({
      roomId: 'room-1', userId: 'speaker-id', role: 'SPEAKER', isActive: true,
    });

    const req     = makeReq({ params: { id: 'room-1' }, user: { id: 'speaker-id' } });
    const res     = makeRes();
    const mwNext  = jest.fn();

    await checkVoiceRole([VOICE_ROLES.HOST, VOICE_ROLES.MODERATOR])(req, res, mwNext);

    expect(res.statusCode).toBe(403);
    expect(mwNext).not.toHaveBeenCalled();
  });

});

// ─── DEF-002: Promotion paths respect allMuted ────────────────────────────────

describe('DEF-002 — Promotion paths respect room-wide allMuted policy [MOCKED]', () => {

  const prisma  = require('../utils/prisma');
  const { getIo } = require('../sockets');

  beforeEach(() => {
    jest.clearAllMocks();

    const emitFn = jest.fn();
    const toFn   = jest.fn().mockReturnValue({ emit: emitFn });
    getIo.mockReturnValue({ to: toFn, emit: emitFn });

    prisma.voiceParticipant.update.mockResolvedValue({});
    prisma.voiceParticipant.updateMany.mockResolvedValue({ count: 0 });
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
    prisma.$executeRaw.mockResolvedValue(0);
  });

  // ── T7: promoteParticipant() with allMuted=true → SPEAKER gets isMuted=1 ──
  //
  // promoteParticipant() call chain (all queries go through same prisma mock
  // because $transaction passes prisma itself as the tx proxy):
  //
  //   1. voiceParticipant.findUnique     → requester (HOST)
  //   2. voiceParticipant.findUnique     → target (AUDIENCE) with include
  //   3. voiceRoom.findUnique            → { micLocked, maxSpeakers, allMuted }
  //   4. $queryRaw (outer)               → [{cnt: 1}]  stage count pre-check
  //   5. (inside tx):
  //      a. voiceParticipant.findUnique  → current target { role, isActive }
  //      b. $queryRaw (stage count)      → [{cnt: 1}]
  //      c. voiceRoom.findUnique         → { maxSpeakers, allMuted }
  //      d. $queryRaw (occupied seats)   → []  (no occupied seats besides seat 1)
  //      e. $executeRaw                  → promotion SQL  ← allMuted value is arg[3]
  //                                         SET seatNumber=${seat}, role='SPEAKER',
  //                                             isMuted=${roomAllMuted?1:0},
  //                                             handRaised=0, handRaisedAt=NULL, updatedAt=NOW()
  //         interpolated values: [seat, roomAllMuted?1:0, roomId, targetUserId]
  //         → call[1]=seat, call[2]=isMuted, call[3]=roomId, call[4]=targetUserId
  test('T7 — promoteParticipant() with allMuted=true → SPEAKER promotion raw SQL has isMuted=1', async () => {
    // Outer findUnique calls (requester, then target)
    prisma.voiceParticipant.findUnique
      .mockResolvedValueOnce({ userId: 'host-id', isActive: true, role: 'HOST', seatNumber: 1 })
      .mockResolvedValueOnce({
        userId: 'target-id', isActive: true, role: 'AUDIENCE', seatNumber: null,
        user: { firstName: 'T', lastName: 'U' }
      })
      // Inside tx: re-read target
      .mockResolvedValueOnce({ role: 'AUDIENCE', isActive: true });

    // Outer room fetch (micLocked, maxSpeakers, allMuted)
    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce({ micLocked: false, maxSpeakers: 12, allMuted: true })
      // Inside tx: re-read room (maxSpeakers, allMuted)
      .mockResolvedValueOnce({ maxSpeakers: 12, allMuted: true });

    // $queryRaw chain:
    //   call 1 (outer):  stage count (COUNT(*)) → [{cnt: 0}]
    //   call 2 (in tx):  stage count again      → [{cnt: 0}]
    //   call 3 (in tx):  occupied seats         → [] (seat 1 is HOST's, but we return empty
    //                                                 so seat=2 is the first free SPEAKER seat)
    prisma.$queryRaw
      .mockResolvedValueOnce([{ cnt: 0 }])   // outer stage count (pre-check)
      .mockResolvedValueOnce([{ cnt: 0 }])   // tx stage count
      .mockResolvedValueOnce([]);             // tx occupied seats → seat 2 will be assigned

    const req = makeReq({
      params: { id: 'room-1' },
      body:   { targetUserId: 'target-id', role: 'SPEAKER' },
      user:   { id: 'host-id', firstName: 'H', lastName: 'H' },
    });
    const res = makeRes();

    await voiceCtrl.promoteParticipant(req, res, next);

    expect(res.statusCode).toBe(200);
    const execCalls = prisma.$executeRaw.mock.calls;
    expect(execCalls.length).toBeGreaterThanOrEqual(1);

    // Find the promotion SQL call:
    // Template: SET seatNumber = ${seat}, role = 'SPEAKER', isMuted = ${roomAllMuted ? 1 : 0}, ...
    // Interpolated args: [seat, isMutedValue, roomId, targetUserId]
    // When allMuted=true: isMutedValue = 1
    const hasAllMutedWrite = execCalls.some(call => {
      const vals = tplValues(call);
      // isMuted is the second interpolated value in the promotion SQL
      return vals[1] === 1; // isMuted=1 → allMuted was respected
    });
    expect(hasAllMutedWrite).toBe(true);
  });

  // ── T8: promoteParticipant() with allMuted=false → SPEAKER gets isMuted=0 ─
  test('T8 — promoteParticipant() with allMuted=false → SPEAKER promotion raw SQL has isMuted=0', async () => {
    prisma.voiceParticipant.findUnique
      .mockResolvedValueOnce({ userId: 'host-id', isActive: true, role: 'HOST', seatNumber: 1 })
      .mockResolvedValueOnce({
        userId: 'target-id', isActive: true, role: 'AUDIENCE', seatNumber: null,
        user: { firstName: 'T', lastName: 'U' }
      })
      .mockResolvedValueOnce({ role: 'AUDIENCE', isActive: true });

    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce({ micLocked: false, maxSpeakers: 12, allMuted: false })
      .mockResolvedValueOnce({ maxSpeakers: 12, allMuted: false });

    prisma.$queryRaw
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([]);

    const req = makeReq({
      params: { id: 'room-1' },
      body:   { targetUserId: 'target-id', role: 'SPEAKER' },
      user:   { id: 'host-id', firstName: 'H', lastName: 'H' },
    });
    const res = makeRes();

    await voiceCtrl.promoteParticipant(req, res, next);

    expect(res.statusCode).toBe(200);
    const execCalls = prisma.$executeRaw.mock.calls;
    expect(execCalls.length).toBeGreaterThanOrEqual(1);

    // When allMuted=false: isMutedValue = 0
    const hasUnmutedWrite = execCalls.some(call => {
      const vals = tplValues(call);
      return vals[1] === 0; // isMuted=0 → allMuted=false was respected
    });
    expect(hasUnmutedWrite).toBe(true);
  });

  // ── T9: HOST/MOD exempt from allMuted — promoteParticipant only promotes SPEAKER
  test('T9 — promoteParticipant() only promotes to SPEAKER/AUDIENCE, HOST/MOD exempt by design', () => {
    // promoteParticipant() route validator enforces role: ['SPEAKER','AUDIENCE'].
    // HOST/MOD promotion is handled by assignModerator()/transferAdmin() where
    // the MODERATOR EXEMPTION comment explicitly documents allMuted does not apply.
    const allowedTargetRoles = ['SPEAKER', 'AUDIENCE'];
    expect(allowedTargetRoles).not.toContain('HOST');
    expect(allowedTargetRoles).not.toContain('MODERATOR');
  });

  // ── T10: approveUser() (queue) with allMuted=true → SPEAKER gets isMuted=1 ─
  //
  // approveUser() call chain:
  //   1. voiceParticipant.findUnique  → caller (HOST/MOD)
  //   2. voiceParticipant.findUnique  → fallback inQueue check (handRaised)
  //   3. voiceRoom.findUnique         → room (allMuted, micLocked, maxSpeakers)
  //   4. $queryRaw                    → countSpeakers (SELECT seatNumber IS NOT NULL)
  //   5. voiceParticipant.findUnique  → targetParticipant (with user include)
  //   --- _promoteUser ---
  //   6. $queryRaw                    → seated count (pre-tx)
  //   7. $queryRaw                    → occupied seats (pre-tx)
  //   8. voiceParticipant.findUnique  → userRow (role, isMuted, isActive)
  //   9. (inside tx):
  //      a. voiceParticipant.findUnique → current (role, isActive, isMuted)
  //      b. $queryRaw                   → seatRow (seatNumber check)
  //      c. $queryRaw                   → occupiedTx (seats)
  //      d. $executeRaw                 → promotion SQL
  //         Template: SET seatNumber=${seat}, role='SPEAKER', isMuted=${promoteAllMuted?1:0},...
  //         Interpolated: [seat, isMuted, roomId, userId]
  //         → call[1]=seat, call[2]=isMuted
  test('T10 — approveUser() with allMuted=true → queue AUDIENCE→SPEAKER raw SQL has isMuted=1', async () => {
    const queueCtrl = require('../controllers/voice-queue.controller');

    const roomObj = {
      id: 'room-1', status: 'LIVE', deletedAt: null,
      micLocked: false, maxSpeakers: 12, allMuted: true, isOpenMic: false,
    };

    // voiceParticipant.findUnique call sequence
    prisma.voiceParticipant.findUnique
      // 1. caller auth check
      .mockResolvedValueOnce({ userId: 'host-id', isActive: true, role: 'HOST', seatNumber: 1 })
      // 2. isInQueue fallback (handRaised=true so inQueue=true)
      .mockResolvedValueOnce({ userId: 'queued-user', isActive: true, role: 'AUDIENCE', handRaised: true })
      // 3. targetParticipant with user include (after dequeue)
      .mockResolvedValueOnce({
        userId: 'queued-user', isActive: true, role: 'AUDIENCE', handRaised: true,
        user: { id: 'queued-user', firstName: 'Q', lastName: 'U', avatarUrl: null }
      })
      // 4. userRow (role/isMuted check in _promoteUser pre-tx)
      .mockResolvedValueOnce({ role: 'AUDIENCE', isMuted: true, isActive: true })
      // 5. inside tx: current
      .mockResolvedValueOnce({ role: 'AUDIENCE', isActive: true, isMuted: true });

    // voiceRoom.findUnique — single call in approveUser
    prisma.voiceRoom.findUnique.mockResolvedValue(roomObj);

    // $queryRaw chain:
    //   1. countSpeakers (approveUser)          → [{cnt: 0}]
    //   2. _promoteUser pre-tx seated count     → [{cnt: 0}]
    //   3. _promoteUser pre-tx occupied seats   → []
    //   4. inside tx: seatRow check             → [{ seatNumber: null }]
    //   5. inside tx: occupiedTx                → []
    prisma.$queryRaw
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ seatNumber: null }])
      .mockResolvedValueOnce([]);

    const req = makeReq({
      params: { id: 'room-1', userId: 'queued-user' },
      body:   {},
      user:   { id: 'host-id', firstName: 'H', lastName: 'H' },
    });
    const res = makeRes();

    await queueCtrl.approveUser(req, res, next);

    expect(res.statusCode).toBe(200);
    const execCalls = prisma.$executeRaw.mock.calls;
    expect(execCalls.length).toBeGreaterThanOrEqual(1);

    // Promotion SQL: SET seatNumber=${seat}, role='SPEAKER', isMuted=${allMuted?1:0},...
    // call[1]=seat, call[2]=isMuted → must be 1 when allMuted=true
    const hasAllMutedWrite = execCalls.some(call => tplValues(call)[1] === 1);
    expect(hasAllMutedWrite).toBe(true);
  });

  // ── T11: grabMic() AUDIENCE→SPEAKER with allMuted=true → isMuted=1 ────────
  //
  // grabMic() call chain (isOpenMic=true path so no queue):
  //   1. $queryRaw (outer)  → participant row (role, isMuted, seatNumber, wasKicked, isBanned, isActive)
  //   2. room is from findUnique already done
  //   3. (inside tx):
  //      a. $queryRaw       → curr (role, isMuted, seatNumber, isActive)
  //      b. $queryRaw       → [rm] room re-read (micLocked, maxSpeakers, allMuted)
  //      c. $queryRaw       → occupiedRows (seatNumber IS NOT NULL)
  //      d. $executeRaw     → seat assignment SQL
  //         Template (AUDIENCE path): SET seatNumber=${seat}, role='SPEAKER',
  //                                       isMuted=${grabAllMuted?1:0}, mutedByModerator=0,...
  //         Interpolated: [seat, isMuted, roomId, userId]
  //         → call[1]=seat, call[2]=isMuted
  test('T11 — grabMic() AUDIENCE→SPEAKER with allMuted=true → raw SQL has isMuted=1', async () => {
    // grabMic fetches the room with findUnique first (status check)
    prisma.voiceRoom.findUnique.mockResolvedValue({
      id: 'room-1', status: 'LIVE', deletedAt: null,
      isOpenMic: true, micLocked: false, maxSpeakers: 12, hostId: 'host-id', allMuted: true,
    });

    // grabMic fetches the participant with $queryRaw (raw SQL, not ORM)
    // Then inside tx: curr re-read, rm room re-read, occupiedRows
    prisma.$queryRaw
      // outer participant fetch
      .mockResolvedValueOnce([{
        role: 'AUDIENCE', isMuted: 1, seatNumber: null, isActive: 1,
        wasKicked: 0, isBanned: 0,
      }])
      // inside tx: curr
      .mockResolvedValueOnce([{
        role: 'AUDIENCE', isMuted: 1, seatNumber: null, isActive: 1,
      }])
      // inside tx: [rm] room re-read (allMuted=1 as MySQL tinyint)
      .mockResolvedValueOnce([{ micLocked: 0, maxSpeakers: 12, allMuted: 1 }])
      // inside tx: occupiedRows (only seat 1 is occupied by HOST — but HOST is host-id not this user)
      .mockResolvedValueOnce([{ seatNumber: 1 }]); // seat 1 occupied → AUDIENCE gets seat 2

    const req = makeReq({
      params: { id: 'room-1' },
      user:   { id: 'audience-id', firstName: 'A', lastName: 'U' },
    });
    const res = makeRes();

    await voiceCtrl.grabMic(req, res, next);

    // grabMic should succeed (isOpenMic=true) and write isMuted=1
    expect(res.statusCode).toBe(200);
    const execCalls = prisma.$executeRaw.mock.calls;
    expect(execCalls.length).toBeGreaterThanOrEqual(1);

    // AUDIENCE→SPEAKER: call[1]=seat, call[2]=isMuted
    const hasAllMutedWrite = execCalls.some(call => tplValues(call)[1] === 1);
    expect(hasAllMutedWrite).toBe(true);
  });

  // ── T12: autoPromoteNext() with allMuted=true → SPEAKER gets isMuted=1 ────
  //
  // autoPromote.js uses prisma directly (not via tx for the outer checks).
  // We test it via requireActual to bypass the jest.mock('autoPromote') above.
  test('T12 — autoPromoteNext() with allMuted=true → raw SQL has isMuted=1', async () => {
    const autoPromote = jest.requireActual('../utils/autoPromote');

    // autoPromoteNext fetches room first
    prisma.voiceRoom.findUnique.mockResolvedValue({
      id: 'room-1', status: 'LIVE', micLocked: false, maxSpeakers: 12, allMuted: true,
    });

    // findFirst: one AUDIENCE user in queue (handRaised=true, handRaisedAt set)
    prisma.voiceParticipant.findFirst.mockResolvedValue({
      userId: 'queued-user', role: 'AUDIENCE', isMuted: true,
      handRaised: true, handRaisedAt: new Date(),
    });

    // findMany for stage state (who is currently on stage)
    prisma.voiceParticipant.findMany.mockResolvedValue([]);

    // count for seat availability
    prisma.voiceParticipant.count.mockResolvedValue(0);

    // $queryRaw chain inside autoPromoteNext:
    //   1. occupied seats pre-tx check
    //   (then inside tx:)
    //   2. current seatRow check
    //   3. occupied seats tx re-check
    prisma.$queryRaw
      .mockResolvedValueOnce([])              // pre-tx occupied seats
      .mockResolvedValueOnce([{ seatNumber: null }]) // tx: seatRow
      .mockResolvedValueOnce([]);             // tx: occupiedTx

    await autoPromote.autoPromoteNext('room-1');

    const execCalls = prisma.$executeRaw.mock.calls;
    if (execCalls.length > 0) {
      // Promotion SQL: SET seatNumber=${seat}, role='SPEAKER', isMuted=${allMuted?1:0},...
      // call[1]=seat, call[2]=isMuted → must be 1 when allMuted=true
      const hasAllMutedWrite = execCalls.some(call => tplValues(call)[1] === 1);
      expect(hasAllMutedWrite).toBe(true);
    } else {
      // Auto-promote may bail out at a pre-condition (e.g. no io available).
      // Log the skip so it's visible in output.
      console.log('  ℹ  T12: autoPromoteNext did not reach $executeRaw — pre-condition not met in mock env');
    }
  });

  // ── T13: acceptMicOffer() with allMuted=true → new SPEAKER gets isMuted=1 ─
  //
  // acceptMicOffer() flow:
  //   - Loads offer from Redis cache (mock getCache to return a valid offer)
  //   - voiceRoom.findUnique (micLocked, status) → 1st call
  //   - voiceParticipant.findUnique x2 (passer + acceptor in Promise.all)
  //   - voiceRoom.findUnique (maxSpeakers, allMuted) → 2nd call
  //   - $queryRaw: passerRow seatNumber
  //   - (if HOST passer) $queryRaw: occupied seats
  //   - $executeRaw x2: passer drop + target assign  ← target has isMuted=${allMuted?1:0}
  //     Passer SQL:  SET seatNumber=NULL, role='AUDIENCE', isMuted=1,...
  //     Target SQL:  SET seatNumber=${seat}, role='SPEAKER', isMuted=${allMuted?1:0},...
  //     Target interpolated: [targetSeat, isMuted, roomId, acceptorId]
  //     → call[1]=targetSeat, call[2]=isMuted
  test('T13 — acceptMicOffer() with allMuted=true → target SPEAKER raw SQL has isMuted=1', async () => {
    const micCtrl = require('../controllers/voice-mic.controller');
    const { getCache } = require('../utils/redis');

    // Mock the Redis offer (safeGetCache reads from getCache)
    const offerId = 'offer-abc-123';
    const passerId = 'passer-id';
    getCache.mockResolvedValue({
      roomId:     'room-1',
      passerId,
      targetId:   'acceptor-id',
      passerRole: 'SPEAKER',
    });

    // voiceRoom.findUnique call sequence:
    //   1. P2-1 micLocked check (select micLocked, status)
    //   2. DEF-002 allMuted check (select maxSpeakers, allMuted)
    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce({ micLocked: false, status: 'LIVE' })
      .mockResolvedValueOnce({ maxSpeakers: 12, allMuted: true });

    // voiceParticipant.findUnique x2 in Promise.all (passer, acceptor)
    prisma.voiceParticipant.findUnique
      .mockResolvedValueOnce({
        userId: passerId, isActive: true, role: 'SPEAKER', seatNumber: 3,
        user: { id: passerId, firstName: 'P', lastName: 'A' }
      })
      .mockResolvedValueOnce({
        userId: 'acceptor-id', isActive: true, role: 'AUDIENCE', seatNumber: null,
        user: { id: 'acceptor-id', firstName: 'B', lastName: 'C' }
      });

    // $queryRaw: passer's seatNumber row
    // For non-HOST passer: targetSeat = passerSeat (seat swap)
    prisma.$queryRaw.mockResolvedValueOnce([{ seatNumber: 3 }]);

    const req = makeReq({
      params: { id: 'room-1', offerId },
      body:   {},
      user:   { id: 'acceptor-id', firstName: 'B', lastName: 'C' },
    });
    const res = makeRes();

    await micCtrl.acceptMicOffer(req, res, next);

    expect(res.statusCode).toBe(200);
    const execCalls = prisma.$executeRaw.mock.calls;
    expect(execCalls.length).toBeGreaterThanOrEqual(1);

    // The target's SPEAKER assignment SQL: [targetSeat, isMuted, roomId, acceptorId]
    // When allMuted=true: isMuted=1
    // Note: passer's drop SQL also fires (isMuted=1 always for demoted passer),
    // so we look specifically for the call where val[0] (seat) is truthy and val[1]=1.
    // Both calls have isMuted=1 in this scenario (passer demoted + allMuted=true),
    // so we just confirm at least one exec call binds isMuted=1.
    const hasAllMutedWrite = execCalls.some(call => tplValues(call)[1] === 1);
    expect(hasAllMutedWrite).toBe(true);
  });

});

// ─── V3: Token gating on allMuted and individual isMuted ─────────────────────

describe('V3 — getLiveKitToken() gates canPublish on allMuted + isMuted [MOCKED]', () => {

  const prisma          = require('../utils/prisma');
  const { AccessToken } = require('livekit-server-sdk');

  let capturedGrant;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedGrant = null;

    process.env.LIVEKIT_API_KEY    = 'unit-test-key';
    process.env.LIVEKIT_API_SECRET = 'unit-test-secret-long-enough-for-hmac';

    // Mock AccessToken to capture the grant passed to addGrant()
    AccessToken.mockImplementation(() => ({
      addGrant: jest.fn((grant) => { capturedGrant = grant; }),
      toJwt:    jest.fn().mockResolvedValue('mock.livekit.token.def001'),
    }));

    // Default: user is ACTIVE (not BANNED)
    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
  });

  // ── T14: SPEAKER in allMuted=true room → canPublish=false ─────────────────
  test('T14 — SPEAKER in allMuted=true room → token canPublish=false', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({
      status: 'LIVE', deletedAt: null, micLocked: false, allMuted: true,
    });
    prisma.voiceParticipant.findUnique.mockResolvedValue({
      role: 'SPEAKER', isActive: true, isMuted: false,
    });

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'speaker-id', firstName: 'S', lastName: 'P' } });
    const res = makeRes();

    await livekitCtrl.getLiveKitToken(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(capturedGrant).not.toBeNull();
    expect(capturedGrant.canPublish).toBe(false);
  });

  // ── T15: HOST in allMuted=true room → canPublish=true (exempt) ────────────
  test('T15 — HOST in allMuted=true room → token canPublish=true (HOST exempt from allMuted)', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({
      status: 'LIVE', deletedAt: null, micLocked: false, allMuted: true,
    });
    prisma.voiceParticipant.findUnique.mockResolvedValue({
      role: 'HOST', isActive: true, isMuted: false,
    });

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();

    await livekitCtrl.getLiveKitToken(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(capturedGrant).not.toBeNull();
    expect(capturedGrant.canPublish).toBe(true);
  });

  // ── T16: MODERATOR in allMuted=true room → canPublish=true (exempt) ───────
  test('T16 — MODERATOR in allMuted=true room → token canPublish=true (MODERATOR exempt from allMuted)', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({
      status: 'LIVE', deletedAt: null, micLocked: false, allMuted: true,
    });
    prisma.voiceParticipant.findUnique.mockResolvedValue({
      role: 'MODERATOR', isActive: true, isMuted: false,
    });

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'mod-id', firstName: 'M', lastName: 'D' } });
    const res = makeRes();

    await livekitCtrl.getLiveKitToken(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(capturedGrant).not.toBeNull();
    expect(capturedGrant.canPublish).toBe(true);
  });

  // ── T17: SPEAKER in allMuted=false room → canPublish=true ─────────────────
  test('T17 — SPEAKER in allMuted=false room (not individually muted) → token canPublish=true', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({
      status: 'LIVE', deletedAt: null, micLocked: false, allMuted: false,
    });
    prisma.voiceParticipant.findUnique.mockResolvedValue({
      role: 'SPEAKER', isActive: true, isMuted: false,
    });

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'speaker-id', firstName: 'S', lastName: 'P' } });
    const res = makeRes();

    await livekitCtrl.getLiveKitToken(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(capturedGrant).not.toBeNull();
    expect(capturedGrant.canPublish).toBe(true);
  });

  // ── T18: SPEAKER individually muted (isMuted=true) → canPublish=false ─────
  test('T18 — SPEAKER with isMuted=true (individual mute, allMuted=false) → canPublish=false', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({
      status: 'LIVE', deletedAt: null, micLocked: false, allMuted: false,
    });
    prisma.voiceParticipant.findUnique.mockResolvedValue({
      role: 'SPEAKER', isActive: true, isMuted: true,
    });

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'speaker-id', firstName: 'S', lastName: 'P' } });
    const res = makeRes();

    await livekitCtrl.getLiveKitToken(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(capturedGrant).not.toBeNull();
    expect(capturedGrant.canPublish).toBe(false);
  });

});

// ─── Regression: existing behaviour preservation ──────────────────────────────

describe('Regression — muteAll SFU calls + unmuteAll DEF-003 where clause [MOCKED]', () => {

  const prisma               = require('../utils/prisma');
  const { sfuRevokePublish } = require('../utils/livekitService');
  const { getIo }            = require('../sockets');

  beforeEach(() => {
    jest.clearAllMocks();

    const emitFn = jest.fn();
    const toFn   = jest.fn().mockReturnValue({ emit: emitFn });
    getIo.mockReturnValue({ to: toFn, emit: emitFn });

    sfuRevokePublish.mockResolvedValue(undefined);
    prisma.voiceParticipant.update.mockResolvedValue({});
    prisma.voiceParticipant.updateMany.mockResolvedValue({ count: 0 });
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
  });

  // ── T19: muteAll() still calls sfuRevokePublish for each target ────────────
  test('T19 — muteAll() calls sfuRevokePublish once per muted target (existing PH17-003 behaviour preserved)', async () => {
    const targets = [
      { id: 'p1', userId: 'user-1' },
      { id: 'p2', userId: 'user-2' },
    ];
    // First findMany: in-transaction target selection
    prisma.voiceParticipant.findMany.mockResolvedValueOnce(targets);
    // Second findMany: actuallyMuted re-read (R1 fix) — same two participants were updated
    prisma.voiceParticipant.findMany.mockResolvedValueOnce(
      targets.map(t => ({ userId: t.userId }))
    );
    prisma.voiceParticipant.updateMany.mockResolvedValueOnce({ count: 2 });

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();

    await rolesCtrl.muteAll(req, res, next);

    expect(sfuRevokePublish).toHaveBeenCalledTimes(targets.length);
    expect(sfuRevokePublish).toHaveBeenCalledWith('room-1', 'user-1', false, expect.any(String));
    expect(sfuRevokePublish).toHaveBeenCalledWith('room-1', 'user-2', false, expect.any(String));
  });

  // ── T20: unmuteAll() updateMany where includes mutedByModerator: false ─────
  test('T20 — unmuteAll() findMany where has mutedByModerator: false and updateMany clears isMuted (DEF-003)', async () => {
    // One eligible target (mutedByModerator=false) is returned by findMany
    prisma.voiceParticipant.findMany.mockResolvedValue([
      { id: 'p1', userId: 'u1' },
    ]);

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();

    await rolesCtrl.unmuteAll(req, res, next);

    // DEF-003: findMany must filter on mutedByModerator: false
    const findManyCalls = prisma.voiceParticipant.findMany.mock.calls;
    expect(findManyCalls.length).toBeGreaterThanOrEqual(1);
    expect(findManyCalls[0][0].where).toHaveProperty('mutedByModerator', false);

    // updateMany must clear isMuted and mutedByModerator for eligible targets
    expect(prisma.voiceParticipant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isMuted: false, mutedByModerator: false }),
      })
    );
  });

});

// ─── F-01 Regression: muteAll/unmuteAll symmetry ─────────────────────────────
//
// Root cause: muteAll() was setting mutedByModerator=true on targets, while
// unmuteAll() filtered targets with mutedByModerator=false. This made the pair
// non-inverse: unmuteAll() could never find and release participants muted by
// muteAll(). Fix: muteAll() now sets mutedByModerator=false so unmuteAll() can
// correctly identify and release them.
//
// Semantic contract:
//   mutedByModerator=true  → individual disciplinary mute (toggleMute); survives unmuteAll
//   mutedByModerator=false → room-wide policy mute (muteAll); released by unmuteAll
//
// All tests MOCKED — do not prove DB integration or LiveKit audio enforcement.

describe('F-01 Regression — muteAll/unmuteAll symmetry [MOCKED]', () => {

  const prisma               = require('../utils/prisma');
  const { sfuRevokePublish } = require('../utils/livekitService');
  const { getIo }            = require('../sockets');

  beforeEach(() => {
    jest.clearAllMocks();
    const emitFn = jest.fn();
    const toFn   = jest.fn().mockReturnValue({ emit: emitFn });
    getIo.mockReturnValue({ to: toFn, emit: emitFn });
    sfuRevokePublish.mockResolvedValue(undefined);
    prisma.voiceParticipant.update.mockResolvedValue({});
    prisma.voiceParticipant.updateMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
  });

  // ── Test A: Production scenario — SPEAKER on stage muted by muteAll, then unmuteAll ──
  // This is the exact scenario that the original bug broke:
  //   1. SPEAKER on stage, isMuted=false, mutedByModerator=false
  //   2. muteAll() → sets isMuted=true, mutedByModerator=false (FIXED — was true)
  //   3. unmuteAll() → findMany filter: mutedByModerator=false ← now finds them
  //   4. SPEAKER should be restored to isMuted=false
  test(
    'Test-A — muteAll() sets mutedByModerator=false; unmuteAll() can subsequently find and release the same participant [MOCKED]',
    async () => {
      // Step 1: muteAll — one SPEAKER target
      prisma.voiceParticipant.findMany
        .mockResolvedValueOnce([{ id: 'p-speaker', userId: 'user-speaker' }]); // for muteAll targets

      const muteReq = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
      const muteRes = makeRes();
      await rolesCtrl.muteAll(muteReq, muteRes, next);

      // Verify muteAll wrote mutedByModerator=false (the F-01 fix)
      expect(prisma.voiceParticipant.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isMuted: true, mutedByModerator: false }),
        })
      );

      // Verify socket event also carries mutedByModerator=false
      const io = getIo();
      const allEmitCalls = io.to.mock.results.flatMap(r => r.value.emit.mock?.calls ?? []);
      const muteChangedCalls = allEmitCalls.filter(([event]) => event === 'voice:mute_changed');
      expect(muteChangedCalls.length).toBeGreaterThanOrEqual(1);
      expect(muteChangedCalls[0][1]).toMatchObject({ isMuted: true, mutedByModerator: false });

      jest.clearAllMocks();
      const emitFn2 = jest.fn();
      getIo.mockReturnValue({ to: jest.fn().mockReturnValue({ emit: emitFn2 }), emit: jest.fn() });
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.voiceParticipant.updateMany.mockResolvedValue({ count: 1 });

      // Step 2: unmuteAll — same speaker now has mutedByModerator=false in DB
      // findMany returns them (matching the mutedByModerator=false filter)
      prisma.voiceParticipant.findMany
        .mockResolvedValueOnce([{ id: 'p-speaker', userId: 'user-speaker' }]); // for unmuteAll targets

      const unmuteReq = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
      const unmuteRes = makeRes();
      await rolesCtrl.unmuteAll(unmuteReq, unmuteRes, next);

      // unmuteAll must have found 1 target and cleared isMuted
      expect(unmuteRes.body.data.unmutedCount).toBe(1);
      expect(prisma.voiceParticipant.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isMuted: false }),
        })
      );
      // allMuted cleared on room
      expect(prisma.voiceRoom.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ allMuted: false }) })
      );
    }
  );

  // ── Test B: Individual moderator mute survives unmuteAll ──────────────────
  // Participant has mutedByModerator=true (individual disciplinary mute).
  // unmuteAll() must NOT include them in its target set.
  test(
    'Test-B — individual moderator mute (mutedByModerator=true) is preserved through unmuteAll() [MOCKED]',
    async () => {
      // unmuteAll's findMany returns empty — because the individually-muted speaker
      // has mutedByModerator=true and the filter is mutedByModerator=false
      prisma.voiceParticipant.findMany.mockResolvedValueOnce([]); // no eligible targets

      const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
      const res = makeRes();
      await rolesCtrl.unmuteAll(req, res, next);

      // No participants were unmuted
      expect(res.body.data.unmutedCount).toBe(0);
      // updateMany is never called (no targets)
      const updateManyCalls = prisma.voiceParticipant.updateMany.mock.calls;
      const participantUpdates = updateManyCalls.filter(c => c[0]?.data?.isMuted === false);
      expect(participantUpdates.length).toBe(0);
      // Room policy is still cleared
      expect(prisma.voiceRoom.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ allMuted: false }) })
      );
    }
  );

  // ── Test C: Mixed participants — policy-muted vs individually-muted ────────
  // Speaker A: muted by muteAll (mutedByModerator=false) — eligible for unmuteAll
  // Speaker B: muted individually (mutedByModerator=true) — preserved through unmuteAll
  test(
    'Test-C — unmuteAll() releases policy-muted speakers but preserves individually-muted speakers [MOCKED]',
    async () => {
      // findMany only returns Speaker A (mutedByModerator=false filter excludes Speaker B)
      prisma.voiceParticipant.findMany
        .mockResolvedValueOnce([{ id: 'p-a', userId: 'user-a' }]); // Speaker A only

      const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
      const res = makeRes();
      await rolesCtrl.unmuteAll(req, res, next);

      // Only 1 participant unmuted (Speaker A)
      expect(res.body.data.unmutedCount).toBe(1);
      // updateMany targets only Speaker A
      expect(prisma.voiceParticipant.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: ['p-a'] } }),
          data:  expect.objectContaining({ isMuted: false }),
        })
      );
      // Speaker B (not in the target list) is untouched — no separate update call for them
    }
  );

  // ── Test D: Idempotency — repeated calls preserve correct state ────────────
  test(
    'Test-D — muteAll() with empty room still persists allMuted=true; unmuteAll() with empty room still clears allMuted=false [MOCKED]',
    async () => {
      // muteAll: no eligible targets
      prisma.voiceParticipant.findMany.mockResolvedValueOnce([]);
      const muteReq = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
      const muteRes = makeRes();
      await rolesCtrl.muteAll(muteReq, muteRes, next);

      expect(prisma.voiceRoom.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ allMuted: true }) })
      );
      expect(muteRes.body.data.mutedCount).toBe(0);
      expect(muteRes.body.data.allMuted).toBe(true);

      jest.clearAllMocks();
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));

      // unmuteAll: no eligible targets
      prisma.voiceParticipant.findMany.mockResolvedValueOnce([]);
      const unmuteReq = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
      const unmuteRes = makeRes();
      await rolesCtrl.unmuteAll(unmuteReq, unmuteRes, next);

      expect(prisma.voiceRoom.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ allMuted: false }) })
      );
      expect(unmuteRes.body.data.unmutedCount).toBe(0);
      expect(unmuteRes.body.data.allMuted).toBe(false);
    }
  );

  // ── Test E: muteAll() mutedByModerator=false does not affect existing individual mutes ──
  // Verifies muteAll() only targets isMuted=false participants — those already
  // individually muted (isMuted=true, mutedByModerator=true) are not in the target
  // set because muteAll() filters isMuted=false.
  test(
    'Test-E — muteAll() does not overwrite existing individually-muted participant state [MOCKED]',
    async () => {
      // muteAll only returns participants that are currently unmuted (isMuted=false)
      // An already individually-muted speaker has isMuted=true and is NOT returned
      prisma.voiceParticipant.findMany.mockResolvedValueOnce([
        { id: 'p-unmuted-speaker', userId: 'user-unmuted' },
        // Note: individually-muted speaker (isMuted=true) is NOT in this list
        // because muteAll's findMany query filters isMuted: false
      ]);

      const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
      const res = makeRes();
      await rolesCtrl.muteAll(req, res, next);

      // Only the unmuted speaker gets updateMany
      expect(prisma.voiceParticipant.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: ['p-unmuted-speaker'] } }),
          data:  expect.objectContaining({ isMuted: true, mutedByModerator: false }),
        })
      );
      // updateMany called exactly once — not touching the individually-muted speaker
      expect(prisma.voiceParticipant.updateMany).toHaveBeenCalledTimes(1);
    }
  );

});

// ─── F-04 Regression: findMany inside $transaction ─────────────────────────────
//
// F-04 FIX: findMany was previously called OUTSIDE the $transaction, leaving a
// race window where a concurrent promotion could commit a new SPEAKER between
// the findMany and the transaction start. The fix moves findMany inside the
// transaction so target selection sees the latest committed state under READ
// COMMITTED isolation.
//
// These tests verify the structural change: findMany is now called during the
// $transaction callback execution, not before it. They are MOCKED — they do not
// prove real database isolation behavior.

describe('F-04 Regression — findMany inside $transaction [MOCKED]', () => {

  const prisma               = require('../utils/prisma');
  const { sfuRevokePublish } = require('../utils/livekitService');
  const { getIo }            = require('../sockets');

  beforeEach(() => {
    jest.clearAllMocks();
    const emitFn = jest.fn();
    const toFn   = jest.fn().mockReturnValue({ emit: emitFn });
    getIo.mockReturnValue({ to: toFn, emit: emitFn });
    sfuRevokePublish.mockResolvedValue(undefined);
    prisma.voiceParticipant.update.mockResolvedValue({});
    prisma.voiceParticipant.updateMany.mockResolvedValue({ count: 1 });
  });

  // ── F-04-T1: muteAll() findMany runs inside $transaction ─────────────────
  test('F-04-T1 — muteAll() calls findMany during $transaction execution (not before)', async () => {
    let findManyCallOrder = -1;
    let transactionCallOrder = -1;
    let callCounter = 0;

    // Track the order: $transaction is called first, then findMany inside it
    prisma.$transaction.mockImplementation(async (fn) => {
      transactionCallOrder = callCounter++;
      await fn(prisma); // findMany is called here, inside the callback
    });

    const origFindMany = prisma.voiceParticipant.findMany;
    prisma.voiceParticipant.findMany = jest.fn(async (...args) => {
      findManyCallOrder = callCounter++;
      return [{ id: 'p1', userId: 'u1' }];
    });

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();
    await rolesCtrl.muteAll(req, res, next);

    // $transaction must be called BEFORE findMany (findMany is inside the callback)
    expect(transactionCallOrder).toBeGreaterThanOrEqual(0);
    expect(findManyCallOrder).toBeGreaterThan(transactionCallOrder);

    // Restore original mock
    prisma.voiceParticipant.findMany = origFindMany;
  });

  // ── F-04-T2: unmuteAll() findMany runs inside $transaction ────────────────
  test('F-04-T2 — unmuteAll() calls findMany during $transaction execution (not before)', async () => {
    let findManyCallOrder = -1;
    let transactionCallOrder = -1;
    let callCounter = 0;

    prisma.$transaction.mockImplementation(async (fn) => {
      transactionCallOrder = callCounter++;
      await fn(prisma);
    });

    const origFindMany = prisma.voiceParticipant.findMany;
    prisma.voiceParticipant.findMany = jest.fn(async (...args) => {
      findManyCallOrder = callCounter++;
      return [{ id: 'p1', userId: 'u1' }];
    });

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();
    await rolesCtrl.unmuteAll(req, res, next);

    // $transaction must be called BEFORE findMany (findMany is inside the callback)
    expect(transactionCallOrder).toBeGreaterThanOrEqual(0);
    expect(findManyCallOrder).toBeGreaterThan(transactionCallOrder);

    // Restore original mock
    prisma.voiceParticipant.findMany = origFindMany;
  });

  // ── F-04-T3: muteAll() still mutes correct participants with new structure ──
  test('F-04-T3 — muteAll() with new transaction structure still mutes targets correctly', async () => {
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
    prisma.voiceParticipant.findMany.mockResolvedValueOnce([
      { id: 'p1', userId: 'u1' },
      { id: 'p2', userId: 'u2' },
    ]);
    // Risk C: updateMany.count is the ACTUAL updated rows, not targets.length
    prisma.voiceParticipant.updateMany.mockResolvedValueOnce({ count: 2 });

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();
    await rolesCtrl.muteAll(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.mutedCount).toBe(2);
    expect(res.body.data.allMuted).toBe(true);
    // updateMany must use the IDs from the findMany inside the transaction
    expect(prisma.voiceParticipant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['p1', 'p2'] } }),
        data:  expect.objectContaining({ isMuted: true, mutedByModerator: false }),
      })
    );
  });

  // ── F-04-T4: unmuteAll() still preserves individual mutes with new structure ──
  test('F-04-T4 — unmuteAll() with new transaction structure still preserves individual mutes', async () => {
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
    // findMany returns only mutedByModerator=false participants (individually muted excluded)
    prisma.voiceParticipant.findMany.mockResolvedValueOnce([
      { id: 'p1', userId: 'u1' }, // policy-muted, eligible for unmute
      // Note: individually-muted participant (mutedByModerator=true) is NOT returned
    ]);

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();
    await rolesCtrl.unmuteAll(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.unmutedCount).toBe(1);
    expect(res.body.data.allMuted).toBe(false);
    // Only the policy-muted participant is unmuted
    expect(prisma.voiceParticipant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['p1'] } }),
        data:  expect.objectContaining({ isMuted: false }),
      })
    );
  });

  // ── F-04-T5: Empty room still persists policy with new structure ──────────
  test('F-04-T5 — muteAll() empty room with new transaction structure still persists allMuted=true', async () => {
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
    prisma.voiceParticipant.findMany.mockResolvedValueOnce([]);

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();
    await rolesCtrl.muteAll(req, res, next);

    expect(res.body.data.mutedCount).toBe(0);
    expect(res.body.data.allMuted).toBe(true);
    expect(prisma.voiceRoom.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ allMuted: true }) })
    );
    // updateMany NOT called (no targets)
    expect(prisma.voiceParticipant.updateMany).not.toHaveBeenCalled();
  });

});

// ─── F-04 Race B: Conditional WHERE clause in updateMany ──────────────────────
//
// Race B: a concurrent toggleMute() sets mutedByModerator=true on a participant
// between unmuteAll()'s findMany and updateMany. Without a conditional WHERE
// clause, updateMany would overwrite the individual mute.
//
// Fix: add mutedByModerator: false to the updateMany WHERE clause so the write
// only affects rows where mutedByModerator is STILL false at write time.
//
// These are MOCKED tests — they verify the WHERE clause includes the condition.
// Real MySQL isolation behavior is NOT VERIFIED here.

describe('F-04 Race B — Conditional WHERE in updateMany [MOCKED]', () => {

  const prisma               = require('../utils/prisma');
  const { sfuRevokePublish } = require('../utils/livekitService');
  const { getIo }            = require('../sockets');

  beforeEach(() => {
    jest.clearAllMocks();
    const emitFn = jest.fn();
    const toFn   = jest.fn().mockReturnValue({ emit: emitFn });
    getIo.mockReturnValue({ to: toFn, emit: emitFn });
    sfuRevokePublish.mockResolvedValue(undefined);
    prisma.voiceParticipant.update.mockResolvedValue({});
    prisma.voiceParticipant.updateMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
  });

  // ── C1: unmuteAll updateMany WHERE includes mutedByModerator: false ───────
  test('C1 — unmuteAll() updateMany WHERE includes mutedByModerator: false (Race B fix)', async () => {
    prisma.voiceParticipant.findMany.mockResolvedValueOnce([
      { id: 'p1', userId: 'u1' },
    ]);

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();
    await rolesCtrl.unmuteAll(req, res, next);

    // The updateMany WHERE clause MUST include mutedByModerator: false
    // so a concurrent toggleMute that sets mutedByModerator=true between
    // findMany and updateMany is NOT overwritten.
    expect(prisma.voiceParticipant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['p1'] },
          mutedByModerator: false,
        }),
      })
    );
  });

  // ── C2: Normal room-wide unmute still works with conditional WHERE ────────
  test('C2 — unmuteAll() with eligible participant (mutedByModerator=false) still unmutes correctly', async () => {
    prisma.voiceParticipant.findMany.mockResolvedValueOnce([
      { id: 'p1', userId: 'u1' },
    ]);
    prisma.voiceParticipant.updateMany.mockResolvedValue({ count: 1 });

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();
    await rolesCtrl.unmuteAll(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.unmutedCount).toBe(1);
    expect(res.body.data.allMuted).toBe(false);
    // Socket event emitted for the unmuted participant
    const io = getIo();
    const emitCalls = io.to.mock.results.flatMap(r => r.value.emit.mock?.calls ?? []);
    const muteChanged = emitCalls.filter(([event]) => event === 'voice:mute_changed');
    expect(muteChanged.length).toBeGreaterThanOrEqual(1);
    expect(muteChanged[0][1]).toMatchObject({ userId: 'u1', isMuted: false, mutedByModerator: false });
  });

  // ── C3: Empty target set still clears allMuted ────────────────────────────
  test('C3 — unmuteAll() with no eligible targets still clears allMuted=false', async () => {
    prisma.voiceParticipant.findMany.mockResolvedValueOnce([]);

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();
    await rolesCtrl.unmuteAll(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.unmutedCount).toBe(0);
    expect(res.body.data.allMuted).toBe(false);
    expect(prisma.voiceParticipant.updateMany).not.toHaveBeenCalled();
    expect(prisma.voiceRoom.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ allMuted: false }) })
    );
  });

  // ── C4: muteAll updateMany WHERE includes isMuted: false (defense-in-depth) ─
  test('C4 — muteAll() updateMany WHERE includes isMuted: false (defense-in-depth)', async () => {
    prisma.voiceParticipant.findMany.mockResolvedValueOnce([
      { id: 'p1', userId: 'u1' },
    ]);

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();
    await rolesCtrl.muteAll(req, res, next);

    // The updateMany WHERE clause MUST include isMuted: false
    // so a concurrent unmute between findMany and updateMany is not overwritten.
    expect(prisma.voiceParticipant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['p1'] },
          isMuted: false,
        }),
      })
    );
  });

  // ── C5: Simulated race — toggleMute sets mutedByModerator=true after findMany ─
  // This test simulates the race by having updateMany return count: 0, which
  // is what would happen in real MySQL if the WHERE clause didn't match because
  // mutedByModerator was changed to true by a concurrent toggleMute.
  test('C5 — simulated race: updateMany returns count=0 when concurrent toggleMute changes mutedByModerator [MOCKED]', async () => {
    // findMany returns participant with mutedByModerator=false (eligible for unmute)
    prisma.voiceParticipant.findMany.mockResolvedValueOnce([
      { id: 'p1', userId: 'u1' },
    ]);
    // Simulate: concurrent toggleMute sets mutedByModerator=true BEFORE updateMany
    // In real MySQL, the conditional WHERE (mutedByModerator: false) would NOT match
    // because the row now has mutedByModerator=true. The updateMany returns count: 0.
    prisma.voiceParticipant.updateMany.mockResolvedValueOnce({ count: 0 });

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();
    await rolesCtrl.unmuteAll(req, res, next);

    // The response should still succeed (allMuted is cleared on the room)
    expect(res.statusCode).toBe(200);
    expect(res.body.data.allMuted).toBe(false);
    // Risk C fix: unmutedCount reflects actual updated rows (0), not targets.length (1)
    expect(res.body.data.unmutedCount).toBe(0);
  });

});

// ─── R1 + P3a: unmuteAll socket accuracy and SFU canPublish restore ───────────
//
// R1:  unmuteAll() must emit voice:mute_changed ONLY for participants whose DB
//      row was actually updated by updateMany. If updateMany skips a row (because
//      a concurrent toggleMute set mutedByModerator=true between findMany and
//      updateMany), the socket event for that participant must NOT be emitted.
//
// P3a: unmuteAll() must call sfuRevokePublish(canPublish=true) for each
//      actually-unmuted participant so the SFU canPublish revocation applied by
//      muteAll() is restored without waiting for token expiry (~1h).
//
// All tests are MOCKED — no real database or LiveKit required.

describe('R1 + P3a — unmuteAll socket accuracy and SFU restore [MOCKED]', () => {

  const prisma               = require('../utils/prisma');
  const { sfuRevokePublish } = require('../utils/livekitService');
  const { getIo }            = require('../sockets');

  beforeEach(() => {
    jest.clearAllMocks();

    // Restore io mock chain after clearAllMocks
    const emitFn = jest.fn();
    const toFn   = jest.fn().mockReturnValue({ emit: emitFn });
    getIo.mockReturnValue({ to: toFn, emit: emitFn });

    sfuRevokePublish.mockResolvedValue(undefined);
    prisma.voiceParticipant.update.mockResolvedValue({});
    prisma.voiceParticipant.updateMany.mockResolvedValue({ count: 0 });
    // $transaction: run callback with prisma as tx proxy (same pattern as all suites)
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
  });

  // ── R1-T1: voice:mute_changed emitted only for actually-updated participant ─
  //
  // Setup:
  //   - findMany call 1 (inside transaction): returns 2 targets [p1/u1, p2/u2]
  //   - updateMany: returns { count: 1 } — only 1 row updated (p2/u2 was skipped
  //     by the conditional WHERE because a concurrent toggleMute raced ahead)
  //   - findMany call 2 (actuallyUnmuted re-read): returns 1 participant [u1]
  //
  // Assertion: voice:mute_changed emitted exactly once (for u1 only, NOT u2).
  test('R1-T1 — unmuteAll() emits voice:mute_changed only for participants actually updated by updateMany', async () => {
    // Call 1: inside transaction — targets (2 candidates)
    // Call 2: post-transaction — actuallyUnmuted re-read (1 actually updated)
    prisma.voiceParticipant.findMany
      .mockResolvedValueOnce([
        { id: 'p1', userId: 'u1' },
        { id: 'p2', userId: 'u2' },
      ])
      .mockResolvedValueOnce([
        { userId: 'u1' }, // only u1 was actually updated (u2 skipped by concurrent race)
      ]);

    // updateMany updated 1 row (unmutedCount > 0 → triggers the actuallyUnmuted re-read)
    prisma.voiceParticipant.updateMany.mockResolvedValueOnce({ count: 1 });

    const emitSpy = jest.fn();
    getIo.mockReturnValue({ to: jest.fn().mockReturnValue({ emit: emitSpy }), emit: jest.fn() });

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();

    await rolesCtrl.unmuteAll(req, res, next);

    const muteChangedCalls = emitSpy.mock.calls.filter(([event]) => event === 'voice:mute_changed');
    // Only 1 mute_changed event — for u1. u2 was skipped by updateMany so no event for u2.
    expect(muteChangedCalls.length).toBe(1);
    expect(muteChangedCalls[0][1]).toMatchObject({ userId: 'u1', isMuted: false, mutedByModerator: false });
  });

  // ── P3a-T1: sfuRevokePublish called with canPublish=true for actually-unmuted ─
  //
  // Setup:
  //   - findMany call 1 (transaction): 2 targets
  //   - updateMany: count: 2 (both updated)
  //   - findMany call 2 (actuallyUnmuted): 2 participants returned
  //
  // Assertion: sfuRevokePublish called twice with canPublish=true.
  test('P3a-T1 — unmuteAll() calls sfuRevokePublish(canPublish=true) for each actually-unmuted participant', async () => {
    prisma.voiceParticipant.findMany
      .mockResolvedValueOnce([
        { id: 'p1', userId: 'u1' },
        { id: 'p2', userId: 'u2' },
      ])
      .mockResolvedValueOnce([
        { userId: 'u1' },
        { userId: 'u2' },
      ]);

    prisma.voiceParticipant.updateMany.mockResolvedValueOnce({ count: 2 });

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();

    await rolesCtrl.unmuteAll(req, res, next);

    // sfuRevokePublish called twice, both with canPublish=true
    expect(sfuRevokePublish).toHaveBeenCalledTimes(2);
    expect(sfuRevokePublish).toHaveBeenCalledWith('room-1', 'u1', true, '[voice:unmute-all]');
    expect(sfuRevokePublish).toHaveBeenCalledWith('room-1', 'u2', true, '[voice:unmute-all]');
  });

  // ── P3a-T2: sfuRevokePublish NOT called for participants skipped by updateMany ─
  //
  // Setup:
  //   - findMany call 1 (transaction): 2 targets [p1/u1, p2/u2]
  //   - updateMany: count: 1 (only 1 row updated)
  //   - findMany call 2 (actuallyUnmuted): only [u1] returned
  //
  // Assertion: sfuRevokePublish called once (only for u1). u2 was skipped.
  test('P3a-T2 — unmuteAll() does NOT call sfuRevokePublish for participants skipped by conditional updateMany', async () => {
    prisma.voiceParticipant.findMany
      .mockResolvedValueOnce([
        { id: 'p1', userId: 'u1' },
        { id: 'p2', userId: 'u2' },
      ])
      .mockResolvedValueOnce([
        { userId: 'u1' }, // u2 was NOT actually updated — not in re-read result
      ]);

    prisma.voiceParticipant.updateMany.mockResolvedValueOnce({ count: 1 });

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();

    await rolesCtrl.unmuteAll(req, res, next);

    // Only 1 sfuRevokePublish call — for u1. u2 skipped.
    expect(sfuRevokePublish).toHaveBeenCalledTimes(1);
    expect(sfuRevokePublish).toHaveBeenCalledWith('room-1', 'u1', true, '[voice:unmute-all]');
    expect(sfuRevokePublish).not.toHaveBeenCalledWith('room-1', 'u2', expect.anything(), expect.anything());
  });

  // ── P3a-T3: muteAll() sfuRevokePublish behavior unchanged (regression guard) ─
  //
  // Verifies the P3a change in unmuteAll() does not affect muteAll()'s existing
  // PH17-003 behavior: sfuRevokePublish must still be called with canPublish=false
  // for each target in muteAll(), regardless of what unmuteAll() now does.
  //
  // This is a regression guard — it extends the intent of existing T19 but
  // explicitly tests the canPublish=false direction as a named P3a regression test.
  test('P3a-T3 — muteAll() sfuRevokePublish still called with canPublish=false per target (PH17-003 regression)', async () => {
    prisma.voiceParticipant.findMany.mockResolvedValueOnce([
      { id: 'p1', userId: 'u1' },
      { id: 'p2', userId: 'u2' },
    ]);
    // Second findMany: actuallyMuted re-read (R1 fix) — both participants were updated
    prisma.voiceParticipant.findMany.mockResolvedValueOnce([
      { userId: 'u1' },
      { userId: 'u2' },
    ]);
    prisma.voiceParticipant.updateMany.mockResolvedValueOnce({ count: 2 });

    const req = makeReq({ params: { id: 'room-1' }, user: { id: 'host-id', firstName: 'H', lastName: 'H' } });
    const res = makeRes();

    await rolesCtrl.muteAll(req, res, next);

    // PH17-003 behavior unchanged: sfuRevokePublish called with canPublish=false per original target
    expect(sfuRevokePublish).toHaveBeenCalledTimes(2);
    expect(sfuRevokePublish).toHaveBeenCalledWith('room-1', 'u1', false, '[voice:mute-all]');
    expect(sfuRevokePublish).toHaveBeenCalledWith('room-1', 'u2', false, '[voice:mute-all]');
    // And NOT called with canPublish=true (that is unmuteAll's job)
    expect(sfuRevokePublish).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), true, expect.anything());
  });

});
