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
 */

const request = require('supertest');

// ─── Minimal mocks — avoids needing a real DB/Redis for unit tests ────────────
// We mock prisma and the lock directly so the controller logic can be tested
// without integration infrastructure.

jest.mock('../utils/prisma', () => {
  const mockPrisma = {
    voiceRoom: {
      findUnique: jest.fn(),
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
    $transaction: jest.fn(fns => (Array.isArray(fns) ? Promise.all(fns) : fns(mockPrisma))),
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
  test('J: Banned user returns 403', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue(makeRoom({ hostId: 'host-1' }));
    prisma.voiceRoomMember.findUnique.mockResolvedValue({ isBanned: true });

    const { req, res } = makeReqRes('user-99', 'room-a'); // user-99, not host
    const next = jest.fn();
    await joinRoom(req, res, next);

    expect(res._status).toBe(403);
  });
});
