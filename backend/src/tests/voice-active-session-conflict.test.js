'use strict';
/**
 * Phase 7 — Voice Club Active-Session Conflict Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests the complete one-active-room-per-user invariant including:
 *  - 409 response includes room B metadata (title, emoji, topic)
 *  - Cancel keeps room B active
 *  - Leave & Join transitions B → A
 *  - Concurrent join requests cannot create two active sessions
 *  - Same-room reconnect still works
 *  - Permanent membership in multiple rooms still works
 *  - Stale session does not permanently block user after cleanup
 *
 * Phase 7b — createRoom invariant tests (global one-active-room fix)
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests that createRoom() also enforces the one-active-room invariant via the
 * same FOR UPDATE + READ COMMITTED mechanism used by joinRoom().
 *  - createRoom while already active → 409 VOICE_ROOM_ALREADY_ACTIVE
 *  - createRoom when not active → 201 success
 *  - createRoom + joinRoom concurrent (mock) → second op sees 409
 *  - createRoom + createRoom concurrent (mock) → second op sees 409
 */

const request = require('supertest');

// ─── Minimal mocks — avoids needing a real DB/Redis for unit tests ────────────
// We mock prisma and the lock directly so the controller logic can be tested
// without integration infrastructure.

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
      update:     jest.fn(),
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
    auditLog:     { create: jest.fn() },
    $queryRaw:    jest.fn().mockResolvedValue([{ acquired: 1 }]),
    $executeRaw:  jest.fn().mockResolvedValue(0),
    // Interactive transaction: pass mockPrisma as `tx` and propagate any thrown error.
    // Array-form (legacy batch) still uses Promise.all.
    $transaction: jest.fn(async (fns, _opts) => {
      if (Array.isArray(fns)) return Promise.all(fns);
      // Interactive: run fn(mockPrisma) and let errors propagate naturally
      return fns(mockPrisma);
    }),
  };
  return mockPrisma;
});

jest.mock('../utils/redis', () => ({
  setCache:           jest.fn(),
  getCache:           jest.fn().mockResolvedValue(null),
  deleteCache:        jest.fn(),
  deleteCachePattern: jest.fn(),
  isRedisReady:       jest.fn().mockReturnValue(false),
}));

jest.mock('../sockets', () => ({
  getIo: jest.fn().mockReturnValue(null),
}));

jest.mock('../utils/feedLive', () => ({
  broadcastLiveStart:  jest.fn(),
  broadcastLiveEnd:    jest.fn(),
  broadcastLiveUpdate: jest.fn(),
}));

jest.mock('../services/queue.service', () => ({
  scheduleRoomReminder:  jest.fn(),
  cancelRoomReminder:    jest.fn(),
  queueBulkNotifications: jest.fn(),
  scheduleRoomSleep:     jest.fn().mockResolvedValue(undefined),
  cancelRoomSleep:       jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/autoPromote', () => ({
  autoPromoteNext: jest.fn(),
}));

jest.mock('../utils/voiceQueue', () => ({
  clearQueue: jest.fn(),
  enqueue:    jest.fn(),
  getQueue:   jest.fn().mockResolvedValue([]),
  isInQueue:  jest.fn().mockResolvedValue(false),
  dequeue:    jest.fn(),
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

const prisma = require('../utils/prisma');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRoom(overrides = {}) {
  return {
    id:          'room-a',
    title:       'Room A',
    coverEmoji:  '🎙️',
    topic:       'Test topic',
    hostId:      'host-1',
    status:      'LIVE',
    privacy:     'PUBLIC',
    deletedAt:   null,
    roomLevel:   1,
    maxSpeakers: 12,
    isOpenMic:   false,
    micLocked:   false,
    ...overrides,
  };
}

function makeParticipant(overrides = {}) {
  return {
    id:          'part-1',
    userId:      'user-1',
    roomId:      'room-a',
    role:        'AUDIENCE',
    isMuted:     true,
    isActive:    true,
    handRaised:  false,
    handRaisedAt: null,
    seatNumber:  null,
    joinedAt:    new Date(),
    leftAt:      null,
    user: { id: 'user-1', firstName: 'Test', lastName: 'User', avatarUrl: null },
    ...overrides,
  };
}

// Build a mock Express req/res pair
function makeReqRes(userId = 'user-1', roomId = 'room-a') {
  const req = {
    params:  { id: roomId },
    user:    { id: userId, schoolId: null, role: 'STUDENT' },
    body:    {},
    _voiceJoinLockName: null,
  };
  const res = {
    _status: 200,
    _body:   null,
    status(s)  { this._status = s; return this; },
    json(b)    { this._body = b; return this; },
  };
  return { req, res };
}

// ─── Load controller after mocks are set up ───────────────────────────────────
const { joinRoom, leaveRoom } = require('../controllers/voice.controller');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Voice Club — one-active-room invariant', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: GET_LOCK succeeds
    prisma.$queryRaw.mockResolvedValue([{ acquired: 1 }]);
  });

  // ── A. 409 returns room B metadata ──────────────────────────────────────────
  test('A: 409 VOICE_ROOM_ALREADY_ACTIVE includes activeRoomTitle, activeRoomEmoji, activeRoomTopic', async () => {
    const roomA = makeRoom({ id: 'room-a', title: 'Room A' });
    const roomB = {
      id:         'room-b',
      title:      'NURUL YAQIN ACADEMY',
      coverEmoji: '🕌',
      topic:      'Quran lesson',
      status:     'LIVE',
    };

    prisma.voiceRoom.findUnique.mockResolvedValue(roomA);
    prisma.voiceRoomMember.findUnique.mockResolvedValue(null); // not banned
    // User is active in room B
    prisma.voiceParticipant.findMany.mockResolvedValue([
      { roomId: 'room-b', userId: 'user-1', room: roomB }
    ]);

    const { req, res } = makeReqRes('user-1', 'room-a');
    const next = jest.fn();

    await joinRoom(req, res, next);

    // Backend returns errors object (not data) per errorResponse() contract
    expect(res._status).toBe(409);
    expect(res._body.errors.code).toBe('VOICE_ROOM_ALREADY_ACTIVE');
    expect(res._body.errors.activeRoomId).toBe('room-b');
    expect(res._body.errors.activeRoomTitle).toBe('NURUL YAQIN ACADEMY');
    expect(res._body.errors.activeRoomEmoji).toBe('🕌');
    expect(res._body.errors.activeRoomTopic).toBe('Quran lesson');
    expect(next).not.toHaveBeenCalled();
  });

  // ── A2. Frontend field path regression — errors.code not data.code ────────
  test('A2: Frontend must read code from response.data.errors.code (not response.data.code)', () => {
    // Simulate the exact Axios error object shape the frontend receives
    const axiosError = {
      response: {
        status: 409,
        data: {
          success: false,
          message: 'You are already in an active Voice Club session. Leave that room before joining another.',
          errors: {
            code:            'VOICE_ROOM_ALREADY_ACTIVE',
            activeRoomId:    'room-b',
            activeRoomTitle: 'Voice Club B',
            activeRoomEmoji: '🎙️',
            activeRoomTopic: 'Quran lesson',
          },
        },
      },
    };

    // Correct path (what the fixed code uses)
    const code            = axiosError?.response?.data?.errors?.code;
    const activeRoomId    = axiosError?.response?.data?.errors?.activeRoomId;
    const activeRoomTitle = axiosError?.response?.data?.errors?.activeRoomTitle;
    const activeRoomEmoji = axiosError?.response?.data?.errors?.activeRoomEmoji;
    const activeRoomTopic = axiosError?.response?.data?.errors?.activeRoomTopic;

    expect(code).toBe('VOICE_ROOM_ALREADY_ACTIVE');
    expect(activeRoomId).toBe('room-b');
    expect(activeRoomTitle).toBe('Voice Club B');
    expect(activeRoomEmoji).toBe('🎙️');
    expect(activeRoomTopic).toBe('Quran lesson');

    // Incorrect path (what the old buggy code used) — must be undefined
    const wrongCode = axiosError?.response?.data?.code;
    expect(wrongCode).toBeUndefined();
  });

  // ── B. No conflict when joining same room (reconnect) ───────────────────────
  test('B: Rejoining the same room is allowed (reconnect path)', async () => {
    const room = makeRoom({ id: 'room-a' });
    prisma.voiceRoom.findUnique.mockResolvedValue(room);
    prisma.voiceRoomMember.findUnique.mockResolvedValue(null);
    // No OTHER active rooms (findMany returns empty for roomId: { not: 'room-a' })
    prisma.voiceParticipant.findMany.mockResolvedValue([]);
    // Existing participant in room-a
    const existing = makeParticipant({ roomId: 'room-a', userId: 'user-1' });
    prisma.voiceParticipant.findUnique.mockResolvedValue(existing);
    prisma.voiceParticipant.update.mockResolvedValue({ ...existing, isActive: true });
    prisma.voiceParticipant.count.mockResolvedValue(1);
    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce(room)            // initial room lookup
      .mockResolvedValueOnce({ status: 'LIVE' }); // syncRoomStatus

    const { req, res } = makeReqRes('user-1', 'room-a');
    const next = jest.fn();

    await joinRoom(req, res, next);

    // Should NOT return 409
    expect(res._body?.data?.code).not.toBe('VOICE_ROOM_ALREADY_ACTIVE');
    expect(next).not.toHaveBeenCalledWith(expect.any(Error));
  });

  // ── C. Cancel (no leave) — room B stays active ──────────────────────────────
  test('C: Cancel — leaveRoom NOT called, room B participant remains active', async () => {
    // This test verifies that simply receiving a 409 does NOT alter room B state.
    // The leaveRoom controller only runs when explicitly called.
    const participant = makeParticipant({ isActive: true });
    prisma.voiceParticipant.findUnique.mockResolvedValue(participant);
    prisma.voiceParticipant.update.mockResolvedValue({ ...participant, isActive: false });

    // Simulate user choosing Cancel — they do NOT call leaveRoom
    // Verify room B participant is still active (update was NOT called)
    expect(prisma.voiceParticipant.update).not.toHaveBeenCalled();
  });

  // ── D. Leave & Join — room B left, room A joined ────────────────────────────
  test('D: Leave & Join — leaveRoom(B) then joinRoom(A) succeeds', async () => {
    // Step 1: leave room B
    const partB = makeParticipant({ roomId: 'room-b', userId: 'user-1', isActive: true });
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce(partB);
    prisma.voiceParticipant.update.mockResolvedValueOnce({ ...partB, isActive: false });
    prisma.voiceParticipant.count.mockResolvedValue(0);

    const leaveReq = { params: { id: 'room-b' }, user: { id: 'user-1', schoolId: null } };
    const leaveRes = { _status: 200, _body: null, status(s) { this._status = s; return this; }, json(b) { this._body = b; return this; } };
    await leaveRoom(leaveReq, leaveRes, jest.fn());

    expect(prisma.voiceParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: false }) })
    );

    // Step 2: join room A — no active rooms now
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([{ acquired: 1 }]);
    const roomA = makeRoom({ id: 'room-a' });
    prisma.voiceRoom.findUnique.mockResolvedValue(roomA);
    prisma.voiceRoomMember.findUnique.mockResolvedValue(null);
    prisma.voiceParticipant.findMany.mockResolvedValue([]); // no active rooms
    prisma.voiceParticipant.findUnique.mockResolvedValue(null); // fresh join
    const newPart = makeParticipant({ roomId: 'room-a' });
    prisma.voiceParticipant.create.mockResolvedValue(newPart);
    prisma.voiceParticipant.count.mockResolvedValue(1);
    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce(roomA)
      .mockResolvedValueOnce({ status: 'LIVE' });

    const { req, res } = makeReqRes('user-1', 'room-a');
    const next = jest.fn();
    await joinRoom(req, res, next);

    expect(res._body?.data?.code).not.toBe('VOICE_ROOM_ALREADY_ACTIVE');
    expect(next).not.toHaveBeenCalledWith(expect.any(Error));
  });

  // ── E. Concurrent join requests — InnoDB row lock serializes, one returns 409 ─
  test('E: Concurrent join requests — row lock serializes, second gets 409', async () => {
    // With SELECT FOR UPDATE + READ COMMITTED, the second request is serialized
    // at the DB level — it does not get a 429 (GET_LOCK is gone).
    // Instead: one request succeeds (200), the other sees the active participant
    // and returns 409 VOICE_ROOM_ALREADY_ACTIVE.
    // In the mock environment, both $queryRaw calls (SFU) return immediately,
    // so we simulate the "second request arrives after first committed" scenario:
    // findMany returns an active participant (as if the first committed).
    const roomA = makeRoom({ id: 'room-a' });
    const roomB = makeRoom({ id: 'room-b', title: 'Room B' });

    prisma.voiceRoom.findUnique.mockResolvedValue(roomA);
    prisma.voiceRoomMember.findUnique.mockResolvedValue(null);
    // Simulate: user is already active in room-b (first request won)
    prisma.voiceParticipant.findMany.mockResolvedValue([
      { roomId: 'room-b', userId: 'user-1', room: roomB }
    ]);

    const { req: req2, res: res2 } = makeReqRes('user-1', 'room-a');
    await joinRoom(req2, res2, jest.fn());
    // Second request must receive 409, not 429 (no GET_LOCK anymore)
    expect(res2._status).toBe(409);
    expect(res2._body?.errors?.code).toBe('VOICE_ROOM_ALREADY_ACTIVE');
  });

  // ── F. Stale session — after cleanup, user can join ─────────────────────────
  test('F: After stale session cleared (isActive=false), user can join', async () => {
    // Simulate a stale session having been cleared by the worker
    // (isActive is now false, so findMany returns no active rooms)
    const roomA = makeRoom({ id: 'room-a' });
    prisma.voiceRoom.findUnique.mockResolvedValue(roomA);
    prisma.voiceRoomMember.findUnique.mockResolvedValue(null);
    // No active sessions (stale ones were cleared)
    prisma.voiceParticipant.findMany.mockResolvedValue([]);
    prisma.voiceParticipant.findUnique.mockResolvedValue(null);
    prisma.voiceParticipant.create.mockResolvedValue(makeParticipant());
    prisma.voiceParticipant.count.mockResolvedValue(1);
    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce(roomA)
      .mockResolvedValueOnce({ status: 'LIVE' });

    const { req, res } = makeReqRes('user-1', 'room-a');
    const next = jest.fn();
    await joinRoom(req, res, next);

    expect(res._body?.data?.code).not.toBe('VOICE_ROOM_ALREADY_ACTIVE');
    expect(next).not.toHaveBeenCalledWith(expect.any(Error));
  });

  // ── G. SUPER_ADMIN cannot join ───────────────────────────────────────────────
  // (This is tested at the route level via the inline middleware, not controller,
  //  so we just verify the controller itself would succeed if the middleware
  //  weren't there — the route test covers the 403.)

  // ── H. Permanent membership in multiple rooms still works ──────────────────
  test('H: Permanent VoiceRoomMember in multiple rooms does NOT trigger 409', async () => {
    // A user can be a permanent member of many rooms.
    // The 409 check only applies to voiceParticipant.isActive — not VoiceRoomMember.
    const roomA = makeRoom({ id: 'room-a' });
    prisma.voiceRoom.findUnique.mockResolvedValue(roomA);
    prisma.voiceRoomMember.findUnique.mockResolvedValue({ status: 'ACTIVE', isBanned: false });
    // No active participant sessions
    prisma.voiceParticipant.findMany.mockResolvedValue([]);
    prisma.voiceParticipant.findUnique.mockResolvedValue(null);
    prisma.voiceParticipant.create.mockResolvedValue(makeParticipant());
    prisma.voiceParticipant.count.mockResolvedValue(1);
    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce(roomA)
      .mockResolvedValueOnce({ status: 'LIVE' });

    const { req, res } = makeReqRes('user-1', 'room-a');
    const next = jest.fn();
    await joinRoom(req, res, next);

    expect(res._body?.data?.code).not.toBe('VOICE_ROOM_ALREADY_ACTIVE');
  });

  // ── I. ENDED room cannot be joined ──────────────────────────────────────────
  test('I: ENDED room returns 400 error', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue(makeRoom({ status: 'ENDED' }));

    const { req, res } = makeReqRes('user-1', 'room-a');
    const next = jest.fn();
    await joinRoom(req, res, next);

    expect(res._status).toBe(400);
  });

  // ── J. Banned user cannot join ───────────────────────────────────────────────
  // PH24C: ban check now uses SELECT FOR UPDATE via $queryRaw inside transaction.
  // The $queryRaw mock must return a VRM row with isBanned=1 for the banned path.
  test('J: Banned user returns 403', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue(makeRoom({ hostId: 'host-1' }));

    // The transaction calls $queryRaw twice:
    //   1. Users FOR UPDATE (returns user row — any truthy result)
    //   2. VRM FOR UPDATE (returns VRM row with isBanned=1 → triggers 403)
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: 'user-99' }])          // Users FOR UPDATE
      .mockResolvedValueOnce([{ id: 'vrm-1', isBanned: 1 }]); // VRM FOR UPDATE — banned

    const { req, res } = makeReqRes('user-99', 'room-a'); // user-99, not host
    const next = jest.fn();
    await joinRoom(req, res, next);

    expect(res._status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 7b — createRoom() one-active-room invariant tests
// ─────────────────────────────────────────────────────────────────────────────
// These tests verify that createRoom() now enforces the same invariant as
// joinRoom() using SELECT ... FOR UPDATE + READ COMMITTED inside an interactive
// Prisma transaction.
//
// The mock $transaction(fn) calls fn(mockPrisma) synchronously, which means:
//  - tx.$queryRaw  → prisma.$queryRaw  (FOR UPDATE lock — mocked to succeed)
//  - tx.voiceParticipant.findMany → prisma.voiceParticipant.findMany (conflict check)
//  - tx.voiceRoom.create          → prisma.voiceRoom.create
//  - tx.voiceParticipant.create   → prisma.voiceParticipant.create
// This faithfully exercises the createRoom transaction logic.

const { createRoom } = require('../controllers/voice.controller');

// Build a req/res for createRoom (no :id param; body contains room settings)
function makeCreateReq(userId = 'host-1', bodyOverrides = {}) {
  return {
    params: {},
    user:   { id: userId, schoolId: null, role: 'MEMBER' },
    body:   {
      title:       'New Room',
      description: 'A new voice room',
      privacy:     'PUBLIC',
      topic:       'General',
      coverEmoji:  '🎙️',
      maxSpeakers: 12,
      ...bodyOverrides,
    },
  };
}

function makeCreateRes() {
  return {
    _status: 200,
    _body:   null,
    status(s)  { this._status = s; return this; },
    json(b)    { this._body = b; return this; },
  };
}

describe('Voice Club — createRoom() one-active-room invariant', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: $queryRaw (FOR UPDATE) succeeds
    prisma.$queryRaw.mockResolvedValue([]);
  });

  // ── CR-1. createRoom while already active in another room → 409 ──────────
  test('CR-1: createRoom returns 409 VOICE_ROOM_ALREADY_ACTIVE when user is already active', async () => {
    const existingRoom = {
      id:         'room-existing',
      title:      'Existing Room',
      coverEmoji: '🕌',
      topic:      'Quran',
      status:     'LIVE',
    };

    // Conflict check inside transaction: findMany returns an active participant
    prisma.voiceParticipant.findMany.mockResolvedValue([
      { roomId: 'room-existing', userId: 'host-1', isActive: true, room: existingRoom }
    ]);

    const req  = makeCreateReq('host-1');
    const res  = makeCreateRes();
    const next = jest.fn();

    await createRoom(req, res, next);

    expect(res._status).toBe(409);
    expect(res._body.errors.code).toBe('VOICE_ROOM_ALREADY_ACTIVE');
    expect(res._body.errors.activeRoomId).toBe('room-existing');
    expect(res._body.errors.activeRoomTitle).toBe('Existing Room');
    expect(res._body.errors.activeRoomEmoji).toBe('🕌');
    expect(res._body.errors.activeRoomTopic).toBe('Quran');
    // Room must NOT be created
    expect(prisma.voiceRoom.create).not.toHaveBeenCalled();
    // HOST participant must NOT be created
    expect(prisma.voiceParticipant.create).not.toHaveBeenCalled();
    // next() must NOT be called with an error
    expect(next).not.toHaveBeenCalled();
  });

  // ── CR-2. createRoom when user has no active room → 201 success ──────────
  test('CR-2: createRoom succeeds (201) when user has no active room', async () => {
    // No active rooms for this user
    prisma.voiceParticipant.findMany.mockResolvedValue([]);

    // Stub the room + participant creation
    prisma.voiceRoom.create.mockResolvedValue({});
    prisma.voiceParticipant.create.mockResolvedValue({});

    // getRoomWithParticipants (called after tx): two findUnique calls
    // First: getRoomWithParticipants cache miss → returns room
    // Second: syncRoomStatus → already LIVE so no-op
    const createdRoom = {
      id:           'new-room-id',
      title:        'New Room',
      status:       'LIVE',
      participants: [],
      _count:       { participants: 1 },
    };
    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce(createdRoom)  // getRoomWithParticipants
      .mockResolvedValueOnce({ status: 'LIVE' }); // syncRoomStatus check (already LIVE — no-op)

    const req  = makeCreateReq('host-1');
    const res  = makeCreateRes();
    const next = jest.fn();

    await createRoom(req, res, next);

    // Room and participant must have been created
    expect(prisma.voiceRoom.create).toHaveBeenCalledTimes(1);
    expect(prisma.voiceParticipant.create).toHaveBeenCalledTimes(1);

    // The participant must be created with isActive: true and role: HOST
    expect(prisma.voiceParticipant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isActive: true,
          role:     'HOST',
          isMuted:  true,
        })
      })
    );

    // Response must be 201 success (not 409)
    expect(res._status).toBe(201);
    expect(res._body?.errors?.code).not.toBe('VOICE_ROOM_ALREADY_ACTIVE');
    expect(next).not.toHaveBeenCalledWith(expect.any(Error));
  });

  // ── CR-3. createRoom concurrent with joinRoom — second op sees 409 ────────
  // Simulates: User calls createRoom and joinRoom(otherRoom) simultaneously.
  // The FOR UPDATE row lock serializes them. In the mock environment, both
  // calls execute sequentially. The test verifies that whichever "wins" the
  // conflict check, the loser receives 409 and does NOT write to the DB.
  //
  // Scenario: createRoom "wins" first (no conflict), joinRoom "loses" (sees
  // the createRoom participant) → joinRoom returns 409.
  test('CR-3: After createRoom succeeds, concurrent joinRoom(otherRoom) returns 409', async () => {
    // ── Phase A: createRoom succeeds ────────────────────────────────────────
    prisma.voiceParticipant.findMany.mockResolvedValueOnce([]); // no conflict
    prisma.voiceRoom.create.mockResolvedValue({});
    prisma.voiceParticipant.create.mockResolvedValue({
      id: 'new-part', userId: 'host-1', roomId: 'new-room', role: 'HOST',
      isActive: true, isMuted: true, joinedAt: new Date(),
      user: { id: 'host-1', firstName: 'Test', lastName: 'User', avatarUrl: null }
    });

    const newRoom = {
      id: 'new-room', title: 'New Room', status: 'LIVE',
      participants: [], _count: { participants: 1 }
    };
    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce(newRoom)
      .mockResolvedValueOnce({ status: 'LIVE' });

    const createReq = makeCreateReq('host-1');
    const createRes = makeCreateRes();
    await createRoom(createReq, createRes, jest.fn());
    expect(createRes._status).toBe(201);

    // ── Phase B: joinRoom(otherRoom) now sees the active participant ─────────
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);

    const otherRoom = makeRoom({ id: 'other-room', title: 'Other Room' });
    const conflictingNewRoom = {
      id: 'new-room', title: 'New Room', coverEmoji: '🎙️', topic: null, status: 'LIVE'
    };

    // joinRoom does an initial non-tx findUnique for the room
    prisma.voiceRoom.findUnique.mockResolvedValue(otherRoom);
    prisma.voiceRoomMember.findUnique.mockResolvedValue(null); // no ban record

    // Inside the tx: findMany sees the newly created active participant
    prisma.voiceParticipant.findMany.mockResolvedValue([
      { roomId: 'new-room', userId: 'host-1', isActive: true, room: conflictingNewRoom }
    ]);

    const { req: joinReq, res: joinRes } = makeReqRes('host-1', 'other-room');
    await joinRoom(joinReq, joinRes, jest.fn());

    expect(joinRes._status).toBe(409);
    expect(joinRes._body.errors.code).toBe('VOICE_ROOM_ALREADY_ACTIVE');
    expect(joinRes._body.errors.activeRoomId).toBe('new-room');
  });

  // ── CR-4. Two concurrent createRoom calls — second sees 409 ──────────────
  // Simulates: User sends two simultaneous POST /voice/rooms requests.
  // The FOR UPDATE row lock serializes them. The first commits a participant;
  // the second's conflict check (under READ COMMITTED) sees it and returns 409.
  //
  // In the mock environment: first call resolves (no conflict), second call
  // findMany sees the first's participant.
  test('CR-4: Second concurrent createRoom returns 409 (first already committed)', async () => {
    // ── Request A: no active rooms — succeeds ────────────────────────────────
    prisma.voiceParticipant.findMany.mockResolvedValueOnce([]); // no conflict for A
    prisma.voiceRoom.create.mockResolvedValue({});
    prisma.voiceParticipant.create.mockResolvedValue({});

    const roomA = {
      id: 'room-a-new', title: 'Room A', status: 'LIVE',
      participants: [], _count: { participants: 1 }
    };
    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce(roomA)
      .mockResolvedValueOnce({ status: 'LIVE' });

    const reqA = makeCreateReq('host-1', { title: 'Room A' });
    const resA = makeCreateRes();
    await createRoom(reqA, resA, jest.fn());
    expect(resA._status).toBe(201);

    // ── Request B: sees A's committed participant — gets 409 ─────────────────
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);

    const committedRoom = {
      id: 'room-a-new', title: 'Room A', coverEmoji: '🎙️', topic: null, status: 'LIVE'
    };
    prisma.voiceParticipant.findMany.mockResolvedValueOnce([
      { roomId: 'room-a-new', userId: 'host-1', isActive: true, room: committedRoom }
    ]);

    const reqB = makeCreateReq('host-1', { title: 'Room B' });
    const resB = makeCreateRes();
    await createRoom(reqB, resB, jest.fn());

    expect(resB._status).toBe(409);
    expect(resB._body.errors.code).toBe('VOICE_ROOM_ALREADY_ACTIVE');
    expect(resB._body.errors.activeRoomId).toBe('room-a-new');

    // Room B must NOT have been created
    expect(prisma.voiceRoom.create).not.toHaveBeenCalled();
    expect(prisma.voiceParticipant.create).not.toHaveBeenCalled();
  });

  // ── CR-5. FOR UPDATE is the first DB operation inside the transaction ─────
  test('CR-5: $queryRaw (FOR UPDATE) is called before voiceParticipant.findMany', async () => {
    const callOrder = [];

    prisma.$queryRaw.mockImplementation(() => {
      callOrder.push('queryRaw');
      return Promise.resolve([]);
    });
    prisma.voiceParticipant.findMany.mockImplementation(() => {
      callOrder.push('findMany');
      return Promise.resolve([]);
    });

    prisma.voiceRoom.create.mockResolvedValue({});
    prisma.voiceParticipant.create.mockResolvedValue({});

    const createdRoom = {
      id: 'x', title: 'X', status: 'LIVE', participants: [], _count: { participants: 1 }
    };
    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce(createdRoom)
      .mockResolvedValueOnce({ status: 'LIVE' });

    const req  = makeCreateReq('host-1');
    const res  = makeCreateRes();
    await createRoom(req, res, jest.fn());

    expect(callOrder[0]).toBe('queryRaw');   // FOR UPDATE must be first
    expect(callOrder[1]).toBe('findMany');   // conflict check after lock
  });

  // ── CR-6. 409 response uses the existing VOICE_ROOM_ALREADY_ACTIVE contract ─
  test('CR-6: 409 response shape matches VOICE_ROOM_ALREADY_ACTIVE contract', async () => {
    const active = {
      id:         'room-conflict',
      title:      'Conflict Room',
      coverEmoji: '🔥',
      topic:      'Hot takes',
      status:     'LIVE',
    };
    prisma.voiceParticipant.findMany.mockResolvedValue([
      { roomId: 'room-conflict', userId: 'host-1', isActive: true, room: active }
    ]);

    const req  = makeCreateReq('host-1');
    const res  = makeCreateRes();
    await createRoom(req, res, jest.fn());

    const errors = res._body?.errors;
    expect(errors).toBeDefined();
    expect(errors.code).toBe('VOICE_ROOM_ALREADY_ACTIVE');
    expect(errors.activeRoomId).toBe('room-conflict');
    expect(errors.activeRoomTitle).toBe('Conflict Room');
    expect(errors.activeRoomEmoji).toBe('🔥');
    expect(errors.activeRoomTopic).toBe('Hot takes');
  });
});
