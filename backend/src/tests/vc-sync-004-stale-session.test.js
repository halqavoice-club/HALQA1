'use strict';
/**
 * VC-SYNC-004 — Stale-session worker: Socket.IO adapter liveness check
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies that voice-stale-session.worker.js uses io.fetchSockets() to check
 * whether a participant has a live Socket.IO connection before evicting them,
 * replacing the broken Redis presence key that was never written anywhere.
 *
 * All tests are pure unit tests — no real DB, Redis, network, or Socket.IO.
 * Prisma and the sockets module are fully mocked.
 *
 * Test matrix:
 *   T1. 89-min active participant, socket connected → NOT evicted (below threshold)
 *   T2. 91-min active participant, NO socket in room → evicted
 *   T3. 91-min active participant, socket IN room with matching userId → NOT evicted
 *   T4. 7-hour active participant (force-stale) → evicted regardless of socket
 *   T5. getIo() returns null → 91-min participant → NOT evicted (conservative)
 *   T6. fetchSockets() throws → 91-min participant → NOT evicted (conservative)
 *   T7. Multiple participants same room: some connected, some not → only disconnected evicted
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Mock BullMQ ─────────────────────────────────────────────────────────────
// The Worker constructor captures the job processor function passed as its 2nd arg.
// We store it in module-scope so it survives jest.clearAllMocks() between tests.
// jest.clearAllMocks() only clears mock.calls / mock.results — it does NOT reset
// mockImplementation, so the Worker factory keeps working after each test.
jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_name, fn) => {
    // Stash the processor on the mock function itself — a plain property, not a
    // mock.results entry, so it is never touched by clearAllMocks/resetAllMocks.
    require('bullmq').Worker._lastProcessor = fn;
    return { on: jest.fn() };
  }),
}));

// ─── Mock logger ─────────────────────────────────────────────────────────────
jest.mock('../utils/logger', () => ({
  debug: jest.fn(),
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
}));

// ─── Mock Prisma ─────────────────────────────────────────────────────────────
jest.mock('../utils/prisma', () => ({
  voiceParticipant: {
    findMany:   jest.fn(),
    updateMany: jest.fn(),
    update:     jest.fn(),
    count:      jest.fn(),
  },
}));

// ─── Mock sockets ────────────────────────────────────────────────────────────
jest.mock('../sockets', () => ({
  getIo: jest.fn(),
}));

// ─── Resolve mocked modules ──────────────────────────────────────────────────
const { Worker: BullMQWorker } = require('bullmq');
const prisma                   = require('../utils/prisma');
const { getIo }                = require('../sockets');
const logger                   = require('../utils/logger');

// ─── Load and invoke the worker factory ──────────────────────────────────────
// createVoiceStaleSessionWorker(connection) is what actually calls new Worker(...)
// and registers the job processor. We call it once here with a fake connection
// object — the connection is only passed to the BullMQ Worker constructor, which
// is mocked, so the value does not matter.
const { createVoiceStaleSessionWorker } = require('../workers/voice-stale-session.worker');
createVoiceStaleSessionWorker({ host: 'localhost', port: 6379 });

// ─── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Build a fake VoiceParticipant record.
 * @param {object} opts
 * @param {string|number} [opts.userId]
 * @param {string}        [opts.roomId]
 * @param {number}        opts.joinedMsAgo - how long ago the participant joined (ms)
 * @param {string}        [opts.role]
 */
function makeParticipant({
  userId     = 'user-1',
  roomId     = 'room-abc',
  joinedMsAgo,
  role       = 'AUDIENCE',
} = {}) {
  const joinedAt = new Date(Date.now() - joinedMsAgo);
  return {
    userId,
    role,
    joinedAt,
    room: { id: roomId, hostId: 'host-1', status: 'ACTIVE' },
    user: { id: userId, firstName: 'Test', lastName: 'User' },
  };
}

/**
 * Build a mock io whose fetchSockets resolves with the given socket list.
 * Exposes _mockTo / _mockEmit for assertions on voice:user_left emissions.
 */
function makeIo(socketsInRoom = []) {
  const mockEmit = jest.fn();
  const mockTo   = jest.fn().mockReturnValue({ emit: mockEmit });
  return {
    in: jest.fn().mockReturnValue({
      fetchSockets: jest.fn().mockResolvedValue(socketsInRoom),
    }),
    to:        mockTo,
    emit:      mockEmit,
    _mockEmit: mockEmit,
    _mockTo:   mockTo,
  };
}

/**
 * Invoke the stale sweep via the captured BullMQ job processor.
 * The processor is stored on BullMQWorker._lastProcessor — a plain property
 * that jest.clearAllMocks() never touches.
 */
async function runStaleSweep() {
  const processor = BullMQWorker._lastProcessor;
  if (typeof processor !== 'function') {
    throw new Error(
      `BullMQ Worker job processor not captured. ` +
      `BullMQWorker._lastProcessor=${processor}. ` +
      `Ensure createVoiceStaleSessionWorker() was called at module level.`
    );
  }
  const fakeJob = { name: 'voice-stale-session', id: 'test-job-1' };
  await processor(fakeJob);
}

// Clear call records between tests without resetting implementations.
// jest.clearAllMocks() is safe here: it does NOT touch mock.mockImplementation
// or plain properties like BullMQWorker._lastProcessor.
beforeEach(() => {
  jest.clearAllMocks();
  // Restore Prisma mock resolved values (clearAllMocks resets mock.results so
  // mockReturnValue / mockResolvedValue need to be re-applied each time).
  prisma.voiceParticipant.update.mockResolvedValue({});
  prisma.voiceParticipant.count.mockResolvedValue(0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// T1 — 89-min participant → NOT evicted (below 90-min threshold)
// ═══════════════════════════════════════════════════════════════════════════════
describe('T1 — 89-min active participant (below 90-min threshold) is NOT evicted', () => {
  test('participant joined 89 minutes ago is not touched', async () => {
    const participant = makeParticipant({ joinedMsAgo: 89 * 60 * 1000 });
    prisma.voiceParticipant.findMany.mockResolvedValue([participant]);

    const io = makeIo([{ data: { userId: participant.userId } }]);
    getIo.mockReturnValue(io);

    await runStaleSweep();

    expect(prisma.voiceParticipant.update).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T2 — 91-min participant, NO socket in room → evicted
// ═══════════════════════════════════════════════════════════════════════════════
describe('T2 — 91-min participant with no socket in room IS evicted', () => {
  test('no matching socket → isActive set to false', async () => {
    const participant = makeParticipant({ joinedMsAgo: 91 * 60 * 1000 });
    prisma.voiceParticipant.findMany.mockResolvedValue([participant]);

    const io = makeIo([]); // empty room — nobody connected
    getIo.mockReturnValue(io);

    await runStaleSweep();

    expect(prisma.voiceParticipant.update).toHaveBeenCalledTimes(1);
    const call = prisma.voiceParticipant.update.mock.calls[0][0];
    expect(call.where.roomId_userId).toEqual({
      roomId: participant.room.id,
      userId: participant.userId,
    });
    expect(call.data.isActive).toBe(false);
    expect(call.data.seatNumber).toBeNull();
    expect(call.data.handRaised).toBe(false);
  });

  test('voice:user_left socket event is emitted after eviction', async () => {
    const participant = makeParticipant({ joinedMsAgo: 91 * 60 * 1000 });
    prisma.voiceParticipant.findMany.mockResolvedValue([participant]);

    const io = makeIo([]);
    getIo.mockReturnValue(io);

    await runStaleSweep();

    expect(io._mockTo).toHaveBeenCalledWith(`voice:${participant.room.id}`);
    expect(io._mockEmit).toHaveBeenCalledWith('voice:user_left', {
      roomId: participant.room.id,
      userId: participant.userId,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T3 — 91-min participant, socket IN room with matching userId → NOT evicted
// ═══════════════════════════════════════════════════════════════════════════════
describe('T3 — 91-min participant whose socket IS in the room is NOT evicted', () => {
  test('socket with matching userId → no update', async () => {
    const participant = makeParticipant({ userId: 'user-alive', joinedMsAgo: 91 * 60 * 1000 });
    prisma.voiceParticipant.findMany.mockResolvedValue([participant]);

    const io = makeIo([
      { data: { userId: 'user-alive' } },
      { data: { userId: 'user-other' } },
    ]);
    getIo.mockReturnValue(io);

    await runStaleSweep();

    expect(prisma.voiceParticipant.update).not.toHaveBeenCalled();
  });

  test('userId comparison is string-safe (numeric DB value vs string socket value)', async () => {
    const participant = makeParticipant({ userId: 42, joinedMsAgo: 91 * 60 * 1000 });
    prisma.voiceParticipant.findMany.mockResolvedValue([participant]);

    const io = makeIo([{ data: { userId: '42' } }]); // socket stores string
    getIo.mockReturnValue(io);

    await runStaleSweep();

    expect(prisma.voiceParticipant.update).not.toHaveBeenCalled();
  });

  test('io.in() is called with the correct voice room channel', async () => {
    const participant = makeParticipant({
      userId: 'user-room-check',
      roomId: 'specific-room',
      joinedMsAgo: 91 * 60 * 1000,
    });
    prisma.voiceParticipant.findMany.mockResolvedValue([participant]);

    const io = makeIo([{ data: { userId: 'user-room-check' } }]);
    getIo.mockReturnValue(io);

    await runStaleSweep();

    expect(io.in).toHaveBeenCalledWith('voice:specific-room');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T4 — 7-hour participant (force-stale) → evicted regardless of socket
// ═══════════════════════════════════════════════════════════════════════════════
describe('T4 — 7-hour participant is force-evicted regardless of socket connection', () => {
  test('socket connected but joinedAt > 6h → evicted anyway', async () => {
    const participant = makeParticipant({ joinedMsAgo: 7 * 60 * 60 * 1000 });
    prisma.voiceParticipant.findMany.mockResolvedValue([participant]);

    // Socket IS present — must NOT prevent force-stale eviction
    const io = makeIo([{ data: { userId: participant.userId } }]);
    getIo.mockReturnValue(io);

    await runStaleSweep();

    expect(prisma.voiceParticipant.update).toHaveBeenCalledTimes(1);
    expect(prisma.voiceParticipant.update.mock.calls[0][0].data.isActive).toBe(false);
  });

  test('force-stale skips fetchSockets entirely (liveness check bypassed)', async () => {
    const participant = makeParticipant({ joinedMsAgo: 7 * 60 * 60 * 1000 });
    prisma.voiceParticipant.findMany.mockResolvedValue([participant]);

    const io = makeIo([]);
    getIo.mockReturnValue(io);

    await runStaleSweep();

    // io.in() is called inside hasActiveSocketConnection which is NOT invoked
    // when isForceStale=true (shouldMark skips the liveness check)
    expect(io.in).not.toHaveBeenCalled();
    expect(prisma.voiceParticipant.update).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T5 — getIo() returns null → NOT evicted (conservative fallback)
// ═══════════════════════════════════════════════════════════════════════════════
describe('T5 — getIo() returns null → conservative: participant NOT evicted', () => {
  test('io=null → no DB update', async () => {
    const participant = makeParticipant({ joinedMsAgo: 91 * 60 * 1000 });
    prisma.voiceParticipant.findMany.mockResolvedValue([participant]);

    getIo.mockReturnValue(null);

    await runStaleSweep();

    expect(prisma.voiceParticipant.update).not.toHaveBeenCalled();
  });

  test('io=null → warning logged', async () => {
    const participant = makeParticipant({ joinedMsAgo: 91 * 60 * 1000 });
    prisma.voiceParticipant.findMany.mockResolvedValue([participant]);

    getIo.mockReturnValue(null);

    await runStaleSweep();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('io not available')
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T6 — fetchSockets() throws → NOT evicted (conservative fallback)
// ═══════════════════════════════════════════════════════════════════════════════
describe('T6 — fetchSockets() throws → conservative: participant NOT evicted', () => {
  test('fetchSockets rejects → no DB update', async () => {
    const participant = makeParticipant({ joinedMsAgo: 91 * 60 * 1000 });
    prisma.voiceParticipant.findMany.mockResolvedValue([participant]);

    const io = {
      in: jest.fn().mockReturnValue({
        fetchSockets: jest.fn().mockRejectedValue(new Error('Redis adapter timeout')),
      }),
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    };
    getIo.mockReturnValue(io);

    await runStaleSweep();

    expect(prisma.voiceParticipant.update).not.toHaveBeenCalled();
  });

  test('fetchSockets rejects → warning logged with error message', async () => {
    const participant = makeParticipant({ joinedMsAgo: 91 * 60 * 1000 });
    prisma.voiceParticipant.findMany.mockResolvedValue([participant]);

    const io = {
      in: jest.fn().mockReturnValue({
        fetchSockets: jest.fn().mockRejectedValue(new Error('Redis adapter timeout')),
      }),
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    };
    getIo.mockReturnValue(io);

    await runStaleSweep();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('fetchSockets error'),
      expect.stringContaining('Redis adapter timeout')
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T7 — Multiple participants same room: some connected, some not
// ═══════════════════════════════════════════════════════════════════════════════
describe('T7 — Mixed room: only disconnected participants are evicted', () => {
  test('connected participant kept, disconnected participant evicted', async () => {
    const ROOM = 'room-mixed';
    const connected    = makeParticipant({ userId: 'user-conn', roomId: ROOM, joinedMsAgo: 91 * 60 * 1000 });
    const disconnected = makeParticipant({ userId: 'user-gone', roomId: ROOM, joinedMsAgo: 92 * 60 * 1000 });

    prisma.voiceParticipant.findMany.mockResolvedValue([connected, disconnected]);

    const io = {
      in: jest.fn().mockReturnValue({
        fetchSockets: jest.fn().mockResolvedValue([{ data: { userId: 'user-conn' } }]),
      }),
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    };
    getIo.mockReturnValue(io);

    await runStaleSweep();

    expect(prisma.voiceParticipant.update).toHaveBeenCalledTimes(1);
    const evictedId = prisma.voiceParticipant.update.mock.calls[0][0].where.roomId_userId.userId;
    expect(evictedId).toBe('user-gone');
  });

  test('three participants: two connected, one not → one eviction', async () => {
    const ROOM = 'room-three';
    const p1 = makeParticipant({ userId: 'u1', roomId: ROOM, joinedMsAgo: 91 * 60 * 1000 });
    const p2 = makeParticipant({ userId: 'u2', roomId: ROOM, joinedMsAgo: 91 * 60 * 1000 });
    const p3 = makeParticipant({ userId: 'u3', roomId: ROOM, joinedMsAgo: 91 * 60 * 1000 });

    prisma.voiceParticipant.findMany.mockResolvedValue([p1, p2, p3]);

    const io = {
      in: jest.fn().mockReturnValue({
        fetchSockets: jest.fn().mockResolvedValue([
          { data: { userId: 'u1' } },
          { data: { userId: 'u3' } },
        ]),
      }),
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    };
    getIo.mockReturnValue(io);

    await runStaleSweep();

    expect(prisma.voiceParticipant.update).toHaveBeenCalledTimes(1);
    const evictedId = prisma.voiceParticipant.update.mock.calls[0][0].where.roomId_userId.userId;
    expect(evictedId).toBe('u2');
  });

  test('all participants connected → zero evictions', async () => {
    const ROOM = 'room-all-conn';
    const participants = ['ua', 'ub', 'uc'].map(uid =>
      makeParticipant({ userId: uid, roomId: ROOM, joinedMsAgo: 95 * 60 * 1000 })
    );
    prisma.voiceParticipant.findMany.mockResolvedValue(participants);

    const io = {
      in: jest.fn().mockReturnValue({
        fetchSockets: jest.fn().mockResolvedValue([
          { data: { userId: 'ua' } },
          { data: { userId: 'ub' } },
          { data: { userId: 'uc' } },
        ]),
      }),
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    };
    getIo.mockReturnValue(io);

    await runStaleSweep();

    expect(prisma.voiceParticipant.update).not.toHaveBeenCalled();
  });

  test('all participants disconnected → all evicted', async () => {
    const ROOM = 'room-all-gone';
    const participants = ['ux', 'uy', 'uz'].map(uid =>
      makeParticipant({ userId: uid, roomId: ROOM, joinedMsAgo: 95 * 60 * 1000 })
    );
    prisma.voiceParticipant.findMany.mockResolvedValue(participants);

    const io = makeIo([]); // nobody connected
    getIo.mockReturnValue(io);

    await runStaleSweep();

    expect(prisma.voiceParticipant.update).toHaveBeenCalledTimes(3);
    const evictedIds = prisma.voiceParticipant.update.mock.calls.map(
      c => c[0].where.roomId_userId.userId
    );
    expect(evictedIds).toEqual(expect.arrayContaining(['ux', 'uy', 'uz']));
  });
});
