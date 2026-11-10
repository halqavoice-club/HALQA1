'use strict';
/**
 * FIX-001 — Voice Club Seat-Lock Backend Enforcement [MOCKED]
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies that all seat-assignment paths skip locked seats and handle all-locked cases.
 * All tests are MOCKED — no real database, Redis, LiveKit, or network required.
 */

// ─── Mocks (must be declared before any require()) ────────────────────────────

jest.mock('../utils/prisma', () => {
  const mockPrisma = {
    voiceRoom:        { findUnique: jest.fn(), update: jest.fn() },
    voiceParticipant: {
      findUnique: jest.fn(),
      findFirst:  jest.fn(),
      findMany:   jest.fn().mockResolvedValue([]), // F5E: acceptMicOffer stage snapshot
      update:     jest.fn().mockResolvedValue({}),
    },
    $queryRaw:    jest.fn(),
    $executeRaw:  jest.fn().mockResolvedValue(0),
    $transaction: jest.fn(async (fn) => {
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
  return { getIo: jest.fn().mockReturnValue({ to: toFn, emit: emitFn }) };
});

jest.mock('../utils/livekitService', () => ({
  sfuRevokePublish:      jest.fn().mockResolvedValue(undefined),
  sfuEvict:              jest.fn().mockResolvedValue(undefined),
  getLivekitRoomService: jest.fn().mockReturnValue(null),
}));

jest.mock('../utils/voiceRoomCache', () => ({
  invalidateRoomCache: jest.fn().mockResolvedValue(undefined),
  // F5E: acceptMicOffer calls getNextStageVersion after the tx for stage snapshot
  getNextStageVersion: jest.fn().mockResolvedValue(0),
}));

jest.mock('../utils/voiceQueue', () => ({
  enqueue:   jest.fn().mockResolvedValue(1),
  requeue:   jest.fn().mockResolvedValue(undefined),
  dequeue:   jest.fn().mockResolvedValue(undefined),
  getQueue:  jest.fn().mockResolvedValue([]),
  isInQueue: jest.fn().mockResolvedValue(false),
  peekNext:  jest.fn().mockResolvedValue(null),
  popNext:   jest.fn().mockResolvedValue(null),
  clearQueue: jest.fn(),
}));

jest.mock('../utils/autoPromote', () => ({
  autoPromoteNext: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
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

jest.mock('../utils/search', () => ({
  searchVoiceRooms: jest.fn().mockResolvedValue([]),
}));

jest.mock('../controllers/voice-stats.controller', () => ({
  upsertDailyStats: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/notification.service', () => ({
  notify: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/response', () => ({
  successResponse: (res, data, msg, code) => {
    res.statusCode = code || 200;
    res.body = { success: true, data, message: msg };
    return res;
  },
  errorResponse: (res, msg, code) => {
    res.statusCode = code || 400;
    res.body = { success: false, message: msg };
    return res;
  },
  paginatedResponse:   jest.fn(),
  getPagination:       jest.fn().mockReturnValue({ skip: 0, page: 1, limit: 20 }),
  buildPaginationMeta: jest.fn(),
}));

// ─── Load controllers AFTER mocks ─────────────────────────────────────────────
const voiceCtrl = require('../controllers/voice.controller');
const queueCtrl = require('../controllers/voice-queue.controller');
const micCtrl   = require('../controllers/voice-mic.controller');

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeReq(overrides = {}) {
  return {
    params: {},
    body:   {},
    query:  {},
    user:   { id: 'user-1', firstName: 'A', lastName: 'B', avatarUrl: null },
    ...overrides,
  };
}

function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json   = (d) => { res.body = d; return res; };
  return res;
}

const next = jest.fn();

// ─── Shared fixtures ─────────────────────────────────────────────────────────
const prisma     = require('../utils/prisma');
const { enqueue, requeue, popNext } = require('../utils/voiceQueue');
const { getIo }   = require('../sockets');
const { getCache, deleteCache } = require('../utils/redis');

function freshIo() {
  const emitFn = jest.fn();
  const toFn   = jest.fn().mockReturnValue({ emit: emitFn });
  getIo.mockReturnValue({ to: toFn, emit: emitFn });
}

// ─── grabMic() tests ─────────────────────────────────────────────────────────

describe('FIX-001 — grabMic() seat-lock enforcement [MOCKED]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    freshIo();
    prisma.$transaction.mockImplementation(async (fn) => {
      if (Array.isArray(fn)) return Promise.all(fn);
      return fn(prisma);
    });
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.voiceParticipant.update.mockResolvedValue({});
  });

  // Shared setup for grabMic: participant as AUDIENCE, open-mic room
  function setupGrabMic({ lockedSeatsRaw, occupiedSeats, maxSpeakers = 4 }) {
    prisma.voiceRoom.findUnique.mockResolvedValue({
      id:'room-1', status:'LIVE', deletedAt:null,
      isOpenMic:true, micLocked:false, maxSpeakers, hostId:'host', allMuted:false,
    });
    const occupiedRows = occupiedSeats.map(s => ({ seatNumber: s }));
    prisma.$queryRaw
      // outer participant fetch (raw SQL with isBanned join)
      .mockResolvedValueOnce([{
        id:'p1', roomId:'room-1', userId:'user-1',
        role:'AUDIENCE', isMuted:1, seatNumber:null, isActive:1,
        wasKicked:0, isBanned:0, handRaised:0, handRaisedAt:null,
        isPinned:0, mutedByModerator:0,
      }])
      // tx: curr
      .mockResolvedValueOnce([{ role:'AUDIENCE', isMuted:1, seatNumber:null, isActive:1 }])
      // tx: rm (room re-read) — include isOpenMic so in-tx Free Stage check stays ON
      .mockResolvedValueOnce([{
        micLocked:0, isOpenMic:1, maxSpeakers,
        allMuted:0,
        lockedSeats: typeof lockedSeatsRaw === 'string'
          ? lockedSeatsRaw
          : JSON.stringify(lockedSeatsRaw),
      }])
      // tx: occupiedRows
      .mockResolvedValueOnce(occupiedRows);
    // stage state broadcast at end
    prisma.$queryRaw.mockResolvedValue([]);
  }

  test('T1: locked seat is skipped, next available unlocked seat is used', async () => {
    // seat 2 locked (0-based index 1). Seat 1 occupied by host.
    // AUDIENCE (not HOST) cannot take seat 1. Next free unlocked seat = 3.
    setupGrabMic({ lockedSeatsRaw: [1], occupiedSeats: [1] });

    const res = makeRes();
    await voiceCtrl.grabMic(
      makeReq({ params:{ id:'room-1' }, user:{ id:'user-1', firstName:'A', lastName:'B' }}),
      res, next
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.seatNumber).toBe(3);
  });

  test('T2: ALL seats locked → 200 with queued=true (NO_ELIGIBLE_SEAT)', async () => {
    // maxSpeakers=2. Seat 1 occupied, seat 2 locked. No free unlocked seat.
    setupGrabMic({ lockedSeatsRaw: [1], occupiedSeats: [1], maxSpeakers: 2 });

    const res = makeRes();
    await voiceCtrl.grabMic(
      makeReq({ params:{ id:'room-1' }, user:{ id:'user-1', firstName:'A', lastName:'B' }}),
      res, next
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.queued).toBe(true);
    expect(res.body.data.queueReason).toBe('NO_ELIGIBLE_SEAT');
  });

  test('T2b: open-mic OFF → 200 queued with queueReason OPEN_MIC_OFF', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({
      id:'room-1', status:'LIVE', deletedAt:null,
      isOpenMic:false, micLocked:false, maxSpeakers:4, hostId:'host', allMuted:false,
    });
    prisma.$queryRaw.mockResolvedValueOnce([{
      id:'p1', roomId:'room-1', userId:'user-1',
      role:'AUDIENCE', isMuted:1, seatNumber:null, isActive:1,
      wasKicked:0, isBanned:0, handRaised:0, handRaisedAt:null,
      isPinned:0, mutedByModerator:0,
    }]);

    const res = makeRes();
    await voiceCtrl.grabMic(
      makeReq({ params:{ id:'room-1' }, user:{ id:'user-1', firstName:'A', lastName:'B' }}),
      res, next
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.queued).toBe(true);
    expect(res.body.data.queueReason).toBe('OPEN_MIC_OFF');
  });

  test('T2c: Seat 1 empty (reserved) + Seat 2 locked → NO_ELIGIBLE_SEAT', async () => {
    // Looks like a free stage: Seat 1 empty. Speakers cannot take Seat 1; Seat 2 locked.
    setupGrabMic({ lockedSeatsRaw: [1], occupiedSeats: [], maxSpeakers: 2 });

    const res = makeRes();
    await voiceCtrl.grabMic(
      makeReq({ params:{ id:'room-1' }, user:{ id:'user-1', firstName:'A', lastName:'B' }}),
      res, next
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.queued).toBe(true);
    expect(res.body.data.queueReason).toBe('NO_ELIGIBLE_SEAT');
    expect(res.body.data.queueDetail?.seat1Reserved).toBe(true);
  });

  test('T9: isOpenMic=true + locked seat — locked seat is still skipped', async () => {
    setupGrabMic({ lockedSeatsRaw: [1], occupiedSeats: [1] });

    const res = makeRes();
    await voiceCtrl.grabMic(
      makeReq({ params:{ id:'room-1' }, user:{ id:'user-1', firstName:'A', lastName:'B' }}),
      res, next
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.seatNumber).toBe(3);
  });

  test('T10: lockedSeats=null treated as no locks', async () => {
    setupGrabMic({ lockedSeatsRaw: null, occupiedSeats: [] });

    const res = makeRes();
    await voiceCtrl.grabMic(
      makeReq({ params:{ id:'room-1' }, user:{ id:'user-1', firstName:'A', lastName:'B' }}),
      res, next
    );

    expect(res.statusCode).toBe(200);
    // No occupied seats, no locks. AUDIENCE gets seat 2 (can't take seat 1).
    expect(res.body.data.seatNumber).toBe(2);
  });

  test('T11: lockedSeats=[] treated as no locks', async () => {
    setupGrabMic({ lockedSeatsRaw: [], occupiedSeats: [] });

    const res = makeRes();
    await voiceCtrl.grabMic(
      makeReq({ params:{ id:'room-1' }, user:{ id:'user-1', firstName:'A', lastName:'B' }}),
      res, next
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.seatNumber).toBe(2);
  });

  test('T12: seats 1,3 locked (0-based 0,2), seat 2 is used (AUDIENCE)', async () => {
    // lockedSeats=[0,2] → seats 1 and 3 are locked. Seat 2 is free and unlocked.
    setupGrabMic({ lockedSeatsRaw: [0, 2], occupiedSeats: [] });

    const res = makeRes();
    await voiceCtrl.grabMic(
      makeReq({ params:{ id:'room-1' }, user:{ id:'user-1', firstName:'A', lastName:'B' }}),
      res, next
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.seatNumber).toBe(2);
  });
});

// ─── promoteParticipant() tests ───────────────────────────────────────────────
// promoteParticipant() call chain for SPEAKER promotion:
//   1. voiceParticipant.findUnique → requester (HOST)
//   2. voiceParticipant.findUnique → target (AUDIENCE, with user include)
//   3. voiceRoom.findUnique        → { micLocked, maxSpeakers, allMuted }
//   4. $queryRaw                   → stage count [{cnt:0}] (pre-check)
//   inside tx:
//     5. voiceParticipant.findUnique → current target { role, isActive }
//     6. $queryRaw (tx stage count)  → [{cnt:0}]
//     7. voiceRoom.findUnique        → { maxSpeakers, allMuted, lockedSeats }
//     8. $queryRaw (tx occupied)     → [{seatNumber:1}]
//     9. $executeRaw                 → promotion SQL

describe('FIX-001 — promoteParticipant() seat-lock enforcement [MOCKED]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    freshIo();
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
    // F5E: writeCount guard requires $executeRaw to return 1 (success)
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.voiceParticipant.update.mockResolvedValue({});
  });

  function setupPromoteMocks({ lockedSeats, occupiedSeats, maxSpeakers = 4 }) {
    prisma.voiceParticipant.findUnique
      .mockResolvedValueOnce({ userId:'host', isActive:true, role:'HOST' })  // 1. requester
      .mockResolvedValueOnce({ userId:'user-1', isActive:true, role:'AUDIENCE', user:{ firstName:'A', lastName:'B' }}) // 2. target
      .mockResolvedValueOnce({ role:'HOST', isActive:true })                // 3. tx currentRequester (F5E: in-tx approver re-read)
      .mockResolvedValueOnce({ role:'AUDIENCE', isActive:true }); // 4. tx current (was 3)
    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce({ micLocked:false, maxSpeakers, allMuted:false })        // 3. outer
      .mockResolvedValueOnce({ maxSpeakers, allMuted:false, lockedSeats });            // 7. tx inner
    const occupied = occupiedSeats.map(s => ({ seatNumber: s }));
    prisma.$queryRaw
      .mockResolvedValueOnce([{ cnt:0 }])   // 4. pre-check stage count
      .mockResolvedValueOnce([{ cnt:0 }])   // 6. tx stage count
      .mockResolvedValueOnce(occupied);     // 8. tx occupied seats
    prisma.$queryRaw.mockResolvedValue([]);
  }

  test('T3: locked seat is skipped, next available seat is used', async () => {
    // seat 2 locked (0-based index 1). seat 1 occupied by host.
    // For SPEAKER (not MOD): starts at seat 2. Seat 2 locked → seat 3.
    setupPromoteMocks({ lockedSeats: [1], occupiedSeats: [1] });

    const res = makeRes();
    await voiceCtrl.promoteParticipant(
      makeReq({ params:{ id:'room-1' }, body:{ targetUserId:'user-1', role:'SPEAKER' }, user:{ id:'host' }}),
      res, next
    );

    expect(res.statusCode).toBe(200);
    const execCalls = prisma.$executeRaw.mock.calls;
    const promotionCall = execCalls.find(c => {
      const v = c.slice(1);
      return typeof v[0] === 'number' && v[0] >= 2;
    });
    expect(promotionCall).toBeDefined();
    expect(promotionCall.slice(1)[0]).toBe(3);
  });

  test('T4: ALL seats locked → returns 400', async () => {
    // maxSpeakers=2. seat 1 occupied, seat 2 locked. No SPEAKER seat available.
    setupPromoteMocks({ lockedSeats: [1], occupiedSeats: [1], maxSpeakers: 2 });

    const res = makeRes();
    await voiceCtrl.promoteParticipant(
      makeReq({ params:{ id:'room-1' }, body:{ targetUserId:'user-1', role:'SPEAKER' }, user:{ id:'host' }}),
      res, next
    );

    expect(res.statusCode).toBe(400);
  });
});

// ─── _promoteUser() via approveNext tests ─────────────────────────────────────
// approveNext call chain (Redis off, findFirst fallback):
//   1. voiceParticipant.findUnique  → caller (myParticipant HOST)
//   2. voiceRoom.findUnique         → room (all fields incl. lockedSeats)
//   3. $queryRaw countSpeakers      → [{cnt:0}]
//   4. voiceParticipant.findFirst   → waiting user in DB (handRaised=true)
//   _promoteUser:
//   5. $queryRaw seatedCnt          → [{cnt:0}]
//   6. $queryRaw occupiedPre        → [{seatNumber:1}]
//   7. voiceParticipant.findUnique  → userRow (role,isMuted,isActive)
//   inside tx:
//     8a. voiceParticipant.findUnique → current
//     8b. $queryRaw seatRow          → [{seatNumber:null}]
//     8c. $queryRaw occupiedTx       → [{seatNumber:1}]
//     9.  $executeRaw                → promotion SQL [seat, isMuted, roomId, userId]

describe('FIX-001 — _promoteUser() queue approval seat-lock enforcement [MOCKED]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    freshIo();
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
    // F5E: writeCount guard requires $executeRaw to return 1 (success)
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.voiceParticipant.update.mockResolvedValue({});
    enqueue.mockResolvedValue(1);
  });

  function setupApproveNextMocks({ room, occupiedSeats = [1] }) {
    const occupied = occupiedSeats.map(s => ({ seatNumber: s }));
    prisma.voiceParticipant.findUnique
      .mockResolvedValueOnce({ userId:'host', isActive:true, role:'HOST' })   // 1. caller
      .mockResolvedValueOnce({ role:'AUDIENCE', isMuted:true, isActive:true }) // 7. userRow
      .mockResolvedValueOnce({ role:'AUDIENCE', isActive:true, isMuted:true, wasKicked:false, handRaised:true }) // 8a. tx current (F5E: Fix F fields)
      .mockResolvedValueOnce({ role:'HOST', isActive:true }); // 8a2. tx approver (F5E: Fix G in-tx approver re-read)
    prisma.voiceParticipant.findFirst.mockResolvedValue({
      userId:'user-1', isActive:true, role:'AUDIENCE', handRaised:true, handRaisedAt:new Date(),
      user:{ id:'user-1', firstName:'Q', lastName:'U', avatarUrl:null },
    });
    prisma.voiceRoom.findUnique.mockResolvedValue(room);
    prisma.$queryRaw
      .mockResolvedValueOnce([{ cnt:0 }])   // 3. countSpeakers
      .mockResolvedValueOnce([{ cnt:0 }])   // 5. seatedCnt pre-tx
      .mockResolvedValueOnce(occupied)      // 6. occupiedPre
      .mockResolvedValueOnce([{ seatNumber:null }]) // 8b. seatRow
      .mockResolvedValueOnce(occupied);     // 8c. occupiedTx
    prisma.$queryRaw.mockResolvedValue([]);
  }

  test('T5: locked seat is skipped during queue approval', async () => {
    const room = {
      id:'room-1', status:'LIVE', deletedAt:null,
      micLocked:false, maxSpeakers:4, allMuted:false,
      lockedSeats:[1], // seat 2 locked
    };
    setupApproveNextMocks({ room, occupiedSeats:[1] });

    const res = makeRes();
    await queueCtrl.approveNext(
      makeReq({ params:{ id:'room-1' }, user:{ id:'host', firstName:'H', lastName:'H' }}),
      res, next
    );

    expect(res.statusCode).toBe(200);
    // seat 1 occupied, seat 2 locked → seat 3
    const execCalls = prisma.$executeRaw.mock.calls;
    const promotionCall = execCalls.find(c => {
      const v = c.slice(1);
      return typeof v[0] === 'number' && v[0] >= 2;
    });
    expect(promotionCall).toBeDefined();
    expect(promotionCall.slice(1)[0]).toBe(3);
  });

  test('T6: ALL seats locked → returns 400 and requeue called with original raisedAt (FIFO preserved)', async () => {
    const room = {
      id:'room-1', status:'LIVE', deletedAt:null,
      micLocked:false, maxSpeakers:2, allMuted:false,
      lockedSeats:[1], // seat 2 locked; seat 1 occupied → no free seat
    };
    setupApproveNextMocks({ room, occupiedSeats:[1] });

    const res = makeRes();
    await queueCtrl.approveNext(
      makeReq({ params:{ id:'room-1' }, user:{ id:'host', firstName:'H', lastName:'H' }}),
      res, next
    );

    expect(res.statusCode).toBe(400);
    // FIX-001 (T-FIFO): requeue() — not enqueue() — so the user keeps their original FIFO
    // score instead of being stamped with Date.now() and sent to the back of the queue.
    expect(requeue).toHaveBeenCalledWith('room-1', expect.objectContaining({
      userId: 'user-1',
      raisedAt: expect.any(String),
    }));
    expect(enqueue).not.toHaveBeenCalled();
  });

  // T-P2002: _promoteUser P2002 duplicate-seat race → 409 AND requeue restores the user
  // (covers the original user-reported "Seat was just taken by another user" defect).
  test('T-P2002: _promoteUser P2002 duplicate seat → returns 409 AND requeue called with original raisedAt', async () => {
    const room = {
      id:'room-1', status:'LIVE', deletedAt:null,
      micLocked:false, maxSpeakers:4, allMuted:false,
      lockedSeats:[], // a free seat exists (seat 2) → $executeRaw runs and throws P2002
    };
    setupApproveNextMocks({ room, occupiedSeats:[1] });

    // Seat-assignment $executeRaw throws a P2002-style duplicate-seat error (two concurrent
    // promotions racing for the same seat, caught by the (roomId, seatNumber) unique key).
    const p2002 = Object.assign(
      new Error("Duplicate entry for key 'voice_participants_roomId_seatNumber_key'"),
      { code: 'P2002' }
    );
    prisma.$executeRaw.mockRejectedValueOnce(p2002);

    const res = makeRes();
    await queueCtrl.approveNext(
      makeReq({ params:{ id:'room-1' }, user:{ id:'host', firstName:'H', lastName:'H' }}),
      res, next
    );

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/Seat was just taken/i);
    // FIX-001: the dequeued user is restored to the queue with their original FIFO score
    expect(requeue).toHaveBeenCalledWith('room-1', expect.objectContaining({
      userId: 'user-1',
      raisedAt: expect.any(String),
    }));
  });
});

// ─── T7: autoPromoteNext() ────────────────────────────────────────────────────
// autoPromoteNext call chain (Redis off, findFirst fallback):
//   1. voiceRoom.findUnique        → room (with lockedSeats)
//   2. $queryRaw speakerCount      → [{cnt:0}]
//   3. popNext → null (Redis off)
//   4. voiceParticipant.findFirst  → waiting user
//   5. voiceParticipant.findUnique → participant record
//   6. $queryRaw occupiedRows      → seat 1 occupied
//   FIX-001: lockedSet built → only seat 2 free but locked → return null

// ─── approveUser() carries raisedAt into _promoteUser ────────────────────────
// approveUser call chain (Redis off):
//   1. voiceParticipant.findUnique → myParticipant (HOST)
//   2. voiceParticipant.findUnique → inQueue DB fallback (handRaised=true)
//   3. voiceRoom.findUnique        → room
//   4. $queryRaw countSpeakers      → [{cnt:0}]
//   5. voiceParticipant.findUnique → targetParticipant (with user + handRaisedAt)
//   _promoteUser:
//   6. $queryRaw seatedCnt          → [{cnt:0}]
//   7. $queryRaw occupiedPre        → [{seatNumber:1}]
//   8. voiceParticipant.findUnique  → userRow
//   inside tx:
//     9a. voiceParticipant.findUnique → current
//     9b. $queryRaw seatRow          → [{seatNumber:null}]
//     9c. $queryRaw occupiedTx       → [{seatNumber:1}]
//     9d. voiceRoom.findUnique       → room (in-tx lockedSeats re-read)
//     10. seat === null → requeue + throw 400
describe('FIX-001 — approveUser() carries raisedAt into _promoteUser [MOCKED]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    freshIo();
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
    // F5E: writeCount guard requires $executeRaw to return 1 (success)
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.voiceParticipant.update.mockResolvedValue({});
    enqueue.mockResolvedValue(1);
  });

  test('T-APPROVE: approveUser meta includes raisedAt from targetParticipant.handRaisedAt', async () => {
    const raisedDate = new Date('2026-06-01T12:00:00.000Z');
    prisma.voiceParticipant.findUnique
      .mockResolvedValueOnce({ userId:'host', isActive:true, role:'HOST' })           // 1. myParticipant
      .mockResolvedValueOnce({ userId:'user-1', isActive:true, handRaised:true })     // 2. inQueue fallback
      .mockResolvedValueOnce({                                                        // 5. targetParticipant
        userId:'user-1', isActive:true, role:'AUDIENCE', handRaised:true,
        handRaisedAt: raisedDate,
        user:{ id:'user-1', firstName:'A', lastName:'B', avatarUrl:null },
      })
      .mockResolvedValueOnce({ role:'AUDIENCE', isMuted:true, isActive:true })         // 8. userRow
      .mockResolvedValueOnce({ role:'AUDIENCE', isActive:true, isMuted:true, wasKicked:false, handRaised:true }) // 9a. tx current (F5E: Fix F fields)
      .mockResolvedValueOnce({ role:'HOST', isActive:true });                          // 9b. tx approver (F5E: Fix G)

    // maxSpeakers=2, seat 2 locked, seat 1 occupied → null seat → requeue + 400
    const room = {
      id:'room-1', status:'LIVE', deletedAt:null,
      micLocked:false, maxSpeakers:2, allMuted:false,
      lockedSeats:[1],
    };
    prisma.voiceRoom.findUnique.mockResolvedValue(room);

    prisma.$queryRaw
      .mockResolvedValueOnce([{ cnt:0 }])              // 4. countSpeakers
      .mockResolvedValueOnce([{ cnt:0 }])              // 6. seatedCnt
      .mockResolvedValueOnce([{ seatNumber:1 }])        // 7. occupiedPre
      .mockResolvedValueOnce([{ seatNumber:null }])     // 9b. seatRow
      .mockResolvedValueOnce([{ seatNumber:1 }]);      // 9c. occupiedTx
    prisma.$queryRaw.mockResolvedValue([]);

    const res = makeRes();
    await queueCtrl.approveUser(
      makeReq({ params:{ id:'room-1', userId:'user-1' }, user:{ id:'host', firstName:'H', lastName:'H' }}),
      res, next
    );

    // null-seat path → 400
    expect(res.statusCode).toBe(400);
    // approveUser carried raisedAt from targetParticipant.handRaisedAt into _promoteUser,
    // and _promoteUser requeued the user with that original FIFO score.
    expect(requeue).toHaveBeenCalledWith('room-1', expect.objectContaining({
      userId: 'user-1',
      raisedAt: raisedDate.toISOString(),
    }));
  });
});

describe('FIX-001 — autoPromoteNext() seat-lock enforcement [MOCKED]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    freshIo();
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.voiceParticipant.update.mockResolvedValue({});
  });

  test('T7: returns null when only locked seats are available (MOCKED)', async () => {
    const autoPromote = jest.requireActual('../utils/autoPromote');

    // maxSpeakers=2: seat 1 occupied by host, seat 2 locked (index 1)
    prisma.voiceRoom.findUnique.mockResolvedValue({
      id:'room-1', status:'LIVE', micLocked:false, maxSpeakers:2, allMuted:false,
      lockedSeats:[1],  // 0-based index 1 = seat 2
    });

    // 2. speakerCount
    prisma.$queryRaw.mockResolvedValueOnce([{ cnt:0 }]);

    // 4. DB fallback waiting user (Redis off → findFirst)
    prisma.voiceParticipant.findFirst.mockResolvedValue({
      userId:'queued-user', role:'AUDIENCE', isMuted:true,
      handRaised:true, handRaisedAt:new Date(),
    });

    // 5. participant record
    prisma.voiceParticipant.findUnique.mockResolvedValue({
      userId:'queued-user', role:'AUDIENCE', isActive:true, isMuted:true,
      handRaised:true, seatNumber:null, wasKicked:false,
    });

    // 6. occupiedRows: seat 1 occupied
    prisma.$queryRaw.mockResolvedValueOnce([{ seatNumber:1 }]);

    const result = await autoPromote.autoPromoteNext('room-1', null);

    // No free unlocked seat (seat 1 occupied, seat 2 locked) → null
    expect(result).toBeNull();
    // Should NOT have attempted to assign a seat
    expect(prisma.$executeRaw.mock.calls.length).toBe(0);
  });

  // T-AUTO: autoPromoteNext all-locked → requeue the popped user with original raisedAt
  // (product decision 2: do NOT drop the user). Uses the Redis-on path so peekNext returns
  // real queue meta including raisedAt; the requeue mock then observes the FIFO score.
  test('T-AUTO: autoPromoteNext all-locked → requeue called with original raisedAt before returning null', async () => {
    const autoPromote = jest.requireActual('../utils/autoPromote');
    const { isRedisReady } = require('../utils/redis');
    const { peekNext } = require('../utils/voiceQueue');

    // Redis ON for this one call so peekNext returns real queue meta with raisedAt
    isRedisReady.mockReturnValueOnce(true);
    peekNext.mockResolvedValueOnce({
      userId: 'queued-user', firstName: 'Q', lastName: 'U', avatarUrl: null,
      raisedAt: '2026-01-01T00:00:00.000Z',
    });

    // maxSpeakers=2: seat 1 occupied by host, seat 2 locked (index 1)
    prisma.voiceRoom.findUnique.mockResolvedValue({
      id:'room-1', status:'LIVE', micLocked:false, maxSpeakers:2, allMuted:false,
      lockedSeats:[1],
    });

    // speakerCount
    prisma.$queryRaw.mockResolvedValueOnce([{ cnt:0 }]);
    // occupiedRows: seat 1 occupied
    prisma.$queryRaw.mockResolvedValueOnce([{ seatNumber:1 }]);
    prisma.$queryRaw.mockResolvedValue([]);

    // participant record (still active, eligible, not seated, not kicked)
    prisma.voiceParticipant.findUnique.mockResolvedValue({
      userId:'queued-user', role:'AUDIENCE', isActive:true, isMuted:true,
      handRaised:true, seatNumber:null, wasKicked:false,
    });

    const result = await autoPromote.autoPromoteNext('room-1', null);

    // No free unlocked seat → null (no promotion), but the user is NOT dropped
    expect(result).toBeNull();
    expect(prisma.$executeRaw.mock.calls.length).toBe(0);
    // FIX-001: the popped user is requeued with their ORIGINAL FIFO score
    expect(requeue).toHaveBeenCalledWith('room-1', expect.objectContaining({
      userId: 'queued-user',
      raisedAt: '2026-01-01T00:00:00.000Z',
    }));
  });
});

// ─── T8: acceptMicOffer() ────────────────────────────────────────────────────
// acceptMicOffer HOST-passes-mic path:
//   1. getCache(offerKey) → offer {passerId:HOST, targetId:user-1, passerRole:HOST}
//   2. deleteCache(offerKey) → consume offer
//   3. voiceRoom.findUnique → {micLocked, status}
//   4. Promise.all: voiceParticipant.findUnique x2 (passer, acceptor)
//   5. deleteCache(offerKey) → consume offer (safeDeleteCache)
//   6. voiceRoom.findUnique → {maxSpeakers, allMuted, lockedSeats}
//   7. $queryRaw → passerRow seatNumber (HOST's seat)
//   8. $queryRaw → occupied seats (for HOST path: find next free seat for target)
//   FIX-001: lockedSet applied → seat 2 locked → target gets seat 3

describe('FIX-001 — acceptMicOffer() seat-lock enforcement [MOCKED]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    freshIo();
    prisma.$transaction.mockImplementation(async (fn) => {
      if (Array.isArray(fn)) return Promise.all(fn);
      return fn(prisma);
    });
    // F5E: writeCount guard requires $executeRaw to return 1 (success)
    prisma.$executeRaw.mockResolvedValue(1);
  });

  test('T8: locked seat not used — HOST passes mic, locked seat skipped (MOCKED)', async () => {
    // HOST (seat 1) passes mic. Seat 2 is locked. Target should get seat 3.
    getCache.mockResolvedValue({
      offerId:'offer-1', roomId:'room-1',
      passerId:'host', targetId:'user-1', passerRole:'HOST',
    });
    deleteCache.mockResolvedValue(undefined);

    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce({ micLocked:false, status:'LIVE' })            // 3. micLocked check
      .mockResolvedValueOnce({ maxSpeakers:4, allMuted:false, lockedSeats:[1] }); // 6. seat check (seat 2=index 1 locked)

    prisma.voiceParticipant.findUnique
      .mockResolvedValueOnce({
        userId:'host', isActive:true, role:'HOST', seatNumber:1,
        user:{ id:'host', firstName:'H', lastName:'H' },
      })
      .mockResolvedValueOnce({
        userId:'user-1', isActive:true, role:'AUDIENCE', seatNumber:null,
        user:{ id:'user-1', firstName:'A', lastName:'B' },
      })
      .mockResolvedValueOnce({ role:'AUDIENCE', isActive:true, seatNumber:null }); // F5E: in-tx txTarget re-read

    // 7. passerRow seatNumber (HOST is on seat 1)
    prisma.$queryRaw.mockResolvedValueOnce([{ seatNumber:1 }]);
    // 8. occupied seats for HOST path (seat 1 is HOST's)
    prisma.$queryRaw.mockResolvedValueOnce([{ seatNumber:1 }]);

    const res = makeRes();
    await micCtrl.acceptMicOffer(
      makeReq({ params:{ id:'room-1', offerId:'offer-1' }, user:{ id:'user-1', firstName:'A', lastName:'B' }}),
      res, next
    );

    expect(res.statusCode).toBe(200);
    // TARGET seat: seat 2 locked → seat 3
    expect(res.body.data.seatNumber).toBe(3);
  });
});
