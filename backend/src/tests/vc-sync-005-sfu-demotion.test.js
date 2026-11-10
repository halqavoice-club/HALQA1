'use strict';
/**
 * VC-SYNC-005 — sfuRevokePublish called on SPEAKER → AUDIENCE demotion
 * ─────────────────────────────────────────────────────────────────────────────
 * Root cause: promoteParticipant() in voice.controller.js did not call
 * sfuRevokePublish() when demoting a SPEAKER to AUDIENCE. A demoted user
 * with a still-valid 1h LiveKit token retained canPublish:true at the SFU
 * level until token expiry.
 *
 * Fix: sfuRevokePublish(roomId, targetUserId, false, '[voice:demote]') is
 * now called AFTER the DB transaction commits, only on the AUDIENCE demotion
 * path, best-effort (.catch logs warning).
 *
 * Tests:
 *   T1. SPEAKER → AUDIENCE: sfuRevokePublish called with correct args
 *   T2. MODERATOR → AUDIENCE via removeModerator: sfuRevokePublish still called
 *   T3. AUDIENCE → SPEAKER promotion: sfuRevokePublish NOT called
 *   T4. sfuRevokePublish throws: DB update + socket events still proceed
 *   T5. sfuRevokePublish called AFTER transaction (not inside it)
 *   T6. removeModerator regression: still calls its own sfuRevokePublish
 *   T7. Target already AUDIENCE: idempotent, no crash
 *
 * All tests are source-level or unit-level. No real DB, Socket.IO, or
 * LiveKit server required.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');

// ─── Source paths ─────────────────────────────────────────────────────────────
const VOICE_CTRL_PATH  = path.join(__dirname, '../controllers/voice.controller.js');
const ROLES_CTRL_PATH  = path.join(__dirname, '../controllers/voice-roles.controller.js');

const voiceSrc = fs.readFileSync(VOICE_CTRL_PATH, 'utf8');
const rolesSrc = fs.readFileSync(ROLES_CTRL_PATH, 'utf8');

// ─── Helper: extract a function body from source ──────────────────────────────
function extractFn(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  if (start === -1) return '';
  const end = endMarker ? src.indexOf(endMarker, start) : src.length;
  return end === -1 ? src.slice(start) : src.slice(start, end);
}

const promoteParticipantSrc = extractFn(
  voiceSrc,
  'async function promoteParticipant',
  'async function kickParticipant'
);

const removeModeratorSrc = extractFn(
  rolesSrc,
  'async function removeModerator',
  'async function transferAdmin'
);

// ═══════════════════════════════════════════════════════════════════════════════
// T1 — SPEAKER → AUDIENCE demotion triggers sfuRevokePublish
// ═══════════════════════════════════════════════════════════════════════════════
describe('T1: SPEAKER → AUDIENCE demotion calls sfuRevokePublish', () => {
  test('promoteParticipant source contains sfuRevokePublish call', () => {
    expect(promoteParticipantSrc).toMatch(/sfuRevokePublish\s*\(/);
  });

  test('sfuRevokePublish called with canPublish=false', () => {
    expect(promoteParticipantSrc).toMatch(
      /sfuRevokePublish\s*\(\s*roomId\s*,\s*targetUserId\s*,\s*false/
    );
  });

  test('sfuRevokePublish uses [voice:demote] log prefix', () => {
    expect(promoteParticipantSrc).toMatch(/\[voice:demote\]/);
  });

  test('sfuRevokePublish is gated on role === AUDIENCE', () => {
    // The call must be inside an if-block checking AUDIENCE
    // Find the sfuRevokePublish call site
    const callIdx = promoteParticipantSrc.indexOf('sfuRevokePublish(roomId, targetUserId, false');
    expect(callIdx).toBeGreaterThan(-1);
    // Scan backward from call for a VOICE_ROLES.AUDIENCE or 'AUDIENCE' reference
    const preceding = promoteParticipantSrc.slice(0, callIdx);
    expect(preceding).toMatch(/VOICE_ROLES\.AUDIENCE|'AUDIENCE'|"AUDIENCE"/);
  });

  test('sfuRevokePublish call is fire-and-forget (.catch)', () => {
    expect(promoteParticipantSrc).toMatch(/sfuRevokePublish\([^)]+\)\.catch/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T2 — MODERATOR → AUDIENCE via removeModerator also calls sfuRevokePublish
// ═══════════════════════════════════════════════════════════════════════════════
describe('T2: MODERATOR → AUDIENCE (removeModerator) calls sfuRevokePublish', () => {
  test('removeModerator source contains sfuRevokePublish', () => {
    expect(removeModeratorSrc).toMatch(/sfuRevokePublish\s*\(/);
  });

  test('removeModerator passes canPublish=false', () => {
    expect(removeModeratorSrc).toMatch(
      /sfuRevokePublish\s*\(\s*roomId\s*,\s*targetUserId\s*,\s*false/
    );
  });

  test('removeModerator uses [voice:remove-mod] log prefix', () => {
    expect(removeModeratorSrc).toMatch(/\[voice:remove-mod\]/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T3 — AUDIENCE → SPEAKER promotion does NOT call sfuRevokePublish
// ═══════════════════════════════════════════════════════════════════════════════
describe('T3: AUDIENCE → SPEAKER promotion skips sfuRevokePublish', () => {
  test('sfuRevokePublish call is guarded exclusively on AUDIENCE demotion path', () => {
    // The guard condition must surround the sfuRevokePublish call with an
    // AUDIENCE check, meaning it won't execute during SPEAKER promotion.
    const callIdx = promoteParticipantSrc.indexOf("sfuRevokePublish(roomId, targetUserId, false, '[voice:demote]')");
    expect(callIdx).toBeGreaterThan(-1);

    // Find the nearest `if (` before the call
    const preceding = promoteParticipantSrc.slice(0, callIdx);
    const lastIfIdx = preceding.lastIndexOf('if (');
    expect(lastIfIdx).toBeGreaterThan(-1);

    // That if-condition must reference AUDIENCE, not SPEAKER
    const ifCondition = promoteParticipantSrc.slice(lastIfIdx, callIdx);
    expect(ifCondition).toMatch(/AUDIENCE/);
    expect(ifCondition).not.toMatch(/SPEAKER/);
  });

  test('SPEAKER promotion path does not have standalone sfuRevokePublish', () => {
    // Extract the SPEAKER branch inside the transaction
    const txStart  = promoteParticipantSrc.indexOf('await prisma.$transaction');
    const txEnd    = promoteParticipantSrc.indexOf('} catch (txErr)');
    const txBlock  = promoteParticipantSrc.slice(txStart, txEnd);
    // Inside the transaction there must be NO sfuRevokePublish call
    // (the fix is post-transaction, not inside it)
    expect(txBlock).not.toMatch(/sfuRevokePublish/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T4 — sfuRevokePublish throws: DB update and socket events still proceed
// (runtime unit test — mocks Prisma, Socket.IO, livekitService)
// ═══════════════════════════════════════════════════════════════════════════════

// Mock all heavy dependencies before requiring the controller
jest.mock('../utils/livekitService', () => ({
  sfuRevokePublish:       jest.fn().mockResolvedValue(undefined),
  sfuEvict:               jest.fn().mockResolvedValue(undefined),
  getLivekitRoomService:  jest.fn().mockReturnValue(null),
}));

jest.mock('../utils/prisma', () => {
  const mockTx = {
    voiceParticipant: {
      findUnique: jest.fn(),
    },
    voiceRoom: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const prisma = {
    voiceParticipant: {
      findUnique: jest.fn(),
    },
    voiceRoom: { findUnique: jest.fn() },
    $transaction: jest.fn(async (fn) => fn(mockTx)),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn().mockResolvedValue(1),
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  prisma._mockTx = mockTx;
  return prisma;
});

jest.mock('../utils/redis', () => ({
  getCache:             jest.fn().mockResolvedValue(null),
  setCache:             jest.fn().mockResolvedValue(undefined),
  deleteCache:          jest.fn().mockResolvedValue(undefined),
  deleteCachePattern:   jest.fn().mockResolvedValue(undefined),
  isRedisReady:         jest.fn().mockReturnValue(false),
}));

jest.mock('../sockets', () => ({
  getIo: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
}));

jest.mock('../utils/feedLive', () => ({
  broadcastLiveStart:  jest.fn(),
  broadcastLiveEnd:    jest.fn(),
  broadcastLiveUpdate: jest.fn(),
}));

jest.mock('../services/queue.service', () => ({
  queueBulkNotifications: jest.fn().mockResolvedValue(undefined),
  scheduleRoomReminder:   jest.fn().mockResolvedValue(undefined),
  cancelRoomReminder:     jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/voiceQueue', () => ({
  clearQueue:    jest.fn().mockResolvedValue(undefined),
  enqueue:       jest.fn().mockResolvedValue(undefined),
  getQueue:      jest.fn().mockResolvedValue([]),
  isInQueue:     jest.fn().mockResolvedValue(false),
  dequeue:       jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/autoPromote', () => ({
  autoPromoteNext: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/storage', () => ({
  saveFile:   jest.fn(),
  deleteFile: jest.fn(),
}));

jest.mock('../utils/search', () => ({
  searchVoiceRooms: jest.fn().mockResolvedValue([]),
}));

jest.mock('../controllers/voice-stats.controller', () => ({
  upsertDailyStats: jest.fn().mockResolvedValue(undefined),
}));

// ─── Pull the mocked modules ──────────────────────────────────────────────────
const prisma          = require('../utils/prisma');
const { sfuRevokePublish } = require('../utils/livekitService');
const { getIo }       = require('../sockets');
const logger          = require('../utils/logger');

// Build a minimal mock io
function makeIo() {
  const emitted = [];
  const mockChain = { emit: jest.fn((...a) => emitted.push(a)) };
  return {
    to:   jest.fn(() => mockChain),
    in:   jest.fn(() => ({ socketsJoin: jest.fn(), socketsLeave: jest.fn() })),
    _emitted: emitted,
    _chain: mockChain,
  };
}

// Build a minimal req/res/next triple
function makeReqRes({ roomId, targetUserId, role, requesterId }) {
  const req = {
    params: { id: roomId },
    body:   { targetUserId, role },
    user:   { id: requesterId },
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json:   jest.fn(),
  };
  const next = jest.fn();
  return { req, res, next };
}

// ─── Shared test constants ─────────────────────────────────────────────────────
const ROOM_ID    = 'room-vc-sync-005';
const REQUESTER  = 'host-user-id';
const TARGET     = 'speaker-user-id';

// Wire prisma $transaction to call the callback with the mock tx
function setupTransactionSuccess(txMockFn) {
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma._mockTx));
  txMockFn();
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Shared DB setup helpers ──────────────────────────────────────────────────
function setupDemoteSuccess() {
  // Requester is HOST and active
  prisma.voiceParticipant.findUnique
    .mockResolvedValueOnce({ isActive: true, role: 'HOST' }) // requester
    .mockResolvedValueOnce({                                   // target
      isActive: true,
      role: 'SPEAKER',
      user: { firstName: 'Alice', lastName: 'Smith' }
    });

  // Inside transaction: re-read requester first (TOCTOU revalidation), then target
  prisma._mockTx.voiceParticipant.findUnique
    .mockResolvedValueOnce({ role: 'HOST', isActive: true })   // currentRequester
    .mockResolvedValueOnce({ role: 'SPEAKER', isActive: true }); // current target
  prisma._mockTx.$executeRaw.mockResolvedValue(1);
}

function setupPromoteSuccess() {
  // Requester is HOST and active
  prisma.voiceParticipant.findUnique
    .mockResolvedValueOnce({ isActive: true, role: 'HOST' }) // requester
    .mockResolvedValueOnce({                                   // target
      isActive: true,
      role: 'AUDIENCE',
      user: { firstName: 'Bob', lastName: 'Jones' }
    });

  // micLocked = false, maxSpeakers = 12
  prisma.voiceRoom.findUnique.mockResolvedValue({ micLocked: false, maxSpeakers: 12 });

  // seatCount = 0 (empty stage)
  prisma.$queryRaw.mockResolvedValue([{ cnt: 0 }]);

  // Inside transaction
  prisma._mockTx.voiceParticipant.findUnique.mockResolvedValueOnce({
    role: 'AUDIENCE', isActive: true,
  });
  prisma._mockTx.voiceRoom = { findUnique: jest.fn().mockResolvedValue({ maxSpeakers: 12 }) };
  prisma._mockTx.$queryRaw
    .mockResolvedValueOnce([{ cnt: 0 }])     // stage count check
    .mockResolvedValueOnce([]);              // occupied seats
  prisma._mockTx.$executeRaw.mockResolvedValue(1);
}

// ─── T4 runtime tests ─────────────────────────────────────────────────────────
describe('T4: sfuRevokePublish throws — demotion still succeeds', () => {
  test('DB update proceeds even when sfuRevokePublish rejects', async () => {
    sfuRevokePublish.mockRejectedValueOnce(new Error('LiveKit timeout'));

    setupDemoteSuccess();
    const io = makeIo();
    getIo.mockReturnValue(io);

    const { promoteParticipant } = require('../controllers/voice.controller');
    const { req, res, next } = makeReqRes({
      roomId: ROOM_ID, targetUserId: TARGET, role: 'AUDIENCE', requesterId: REQUESTER
    });

    await promoteParticipant(req, res, next);

    // Response should be success
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
    // sfuRevokePublish was still called
    expect(sfuRevokePublish).toHaveBeenCalledWith(
      ROOM_ID, TARGET, false, '[voice:demote]'
    );
    // Error was only logged, not thrown
    expect(next).not.toHaveBeenCalled();
  });

  test('socket voice:role_changed is emitted even when sfuRevokePublish rejects', async () => {
    sfuRevokePublish.mockRejectedValueOnce(new Error('LiveKit timeout'));

    setupDemoteSuccess();
    const io = makeIo();
    getIo.mockReturnValue(io);

    const { promoteParticipant } = require('../controllers/voice.controller');
    const { req, res, next } = makeReqRes({
      roomId: ROOM_ID, targetUserId: TARGET, role: 'AUDIENCE', requesterId: REQUESTER
    });

    await promoteParticipant(req, res, next);

    expect(io.to).toHaveBeenCalledWith(`voice:${ROOM_ID}`);
    expect(io._chain.emit).toHaveBeenCalledWith(
      'voice:role_changed',
      expect.objectContaining({ userId: TARGET, role: 'AUDIENCE', seatNumber: null })
    );
  });

  test('warn logger is called when sfuRevokePublish rejects', async () => {
    const fakeErr = new Error('LiveKit 503');
    sfuRevokePublish.mockRejectedValueOnce(fakeErr);

    setupDemoteSuccess();
    const io = makeIo();
    getIo.mockReturnValue(io);

    const { promoteParticipant } = require('../controllers/voice.controller');
    const { req, res, next } = makeReqRes({
      roomId: ROOM_ID, targetUserId: TARGET, role: 'AUDIENCE', requesterId: REQUESTER
    });

    await promoteParticipant(req, res, next);

    // Give the .catch microtask a tick to run
    await Promise.resolve();
    expect(logger.warn).toHaveBeenCalledWith(
      '[voice:demote] sfuRevokePublish failed:',
      fakeErr.message
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T5 — sfuRevokePublish called AFTER transaction, not inside it
// (source-level verification)
// ═══════════════════════════════════════════════════════════════════════════════
describe('T5: sfuRevokePublish is called AFTER the transaction', () => {
  test('sfuRevokePublish call appears after the $transaction block in source', () => {
    const txEnd   = promoteParticipantSrc.indexOf('} catch (txErr)');
    const sfuIdx  = promoteParticipantSrc.indexOf("sfuRevokePublish(roomId, targetUserId, false, '[voice:demote]')");

    expect(txEnd).toBeGreaterThan(-1);
    expect(sfuIdx).toBeGreaterThan(-1);

    // sfuRevokePublish must appear AFTER the catch block that closes the transaction
    const catchEnd = promoteParticipantSrc.indexOf('\n    }', txEnd) + 1;
    expect(sfuIdx).toBeGreaterThan(catchEnd);
  });

  test('sfuRevokePublish NOT inside the prisma.$transaction callback in source', () => {
    const txStart = promoteParticipantSrc.indexOf('await prisma.$transaction');
    const txEnd   = promoteParticipantSrc.indexOf('} catch (txErr)');
    const txBlock = promoteParticipantSrc.slice(txStart, txEnd);
    expect(txBlock).not.toMatch(/sfuRevokePublish/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T6 — removeModerator regression: sfuRevokePublish still present
// ═══════════════════════════════════════════════════════════════════════════════
describe('T6: removeModerator regression — sfuRevokePublish not accidentally removed', () => {
  test('removeModerator source still has sfuRevokePublish call', () => {
    expect(removeModeratorSrc).toMatch(/sfuRevokePublish\s*\(\s*roomId\s*,\s*targetUserId/);
  });

  test('removeModerator sfuRevokePublish is best-effort (.catch)', () => {
    expect(removeModeratorSrc).toMatch(/sfuRevokePublish\([^)]+\)\.catch\(\s*\(\s*\)\s*=>/);
  });

  test('voice-roles.controller imports sfuRevokePublish', () => {
    expect(rolesSrc).toMatch(/const\s*\{[^}]*sfuRevokePublish[^}]*\}\s*=\s*require\(.*livekitService/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T7 — Target already AUDIENCE: idempotent, no crash
// ═══════════════════════════════════════════════════════════════════════════════
describe('T7: target already AUDIENCE — idempotent demotion', () => {
  test('demoting an AUDIENCE user does not crash and still attempts sfuRevokePublish', async () => {
    // Requester is HOST and active
    prisma.voiceParticipant.findUnique
      .mockResolvedValueOnce({ isActive: true, role: 'HOST' })
      .mockResolvedValueOnce({
        isActive: true,
        role: 'AUDIENCE',  // already AUDIENCE
        user: { firstName: 'Charlie', lastName: 'Brown' }
      });

    // Inside transaction: requester re-read first (TOCTOU revalidation), then target
    prisma._mockTx.voiceParticipant.findUnique
      .mockResolvedValueOnce({ role: 'HOST', isActive: true })     // currentRequester
      .mockResolvedValueOnce({ role: 'AUDIENCE', isActive: true }); // current target (still AUDIENCE)
    prisma._mockTx.$executeRaw.mockResolvedValue(1);

    const io = makeIo();
    getIo.mockReturnValue(io);

    const { promoteParticipant } = require('../controllers/voice.controller');
    const { req, res, next } = makeReqRes({
      roomId: ROOM_ID, targetUserId: TARGET, role: 'AUDIENCE', requesterId: REQUESTER
    });

    await promoteParticipant(req, res, next);

    // Should not crash
    expect(next).not.toHaveBeenCalled();
    // sfuRevokePublish is still called (idempotent — best-effort is fine)
    expect(sfuRevokePublish).toHaveBeenCalledWith(
      ROOM_ID, TARGET, false, '[voice:demote]'
    );
    // Response success
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T8 — AUDIENCE → SPEAKER promotion: sfuRevokePublish NOT called
// ═══════════════════════════════════════════════════════════════════════════════
describe('T8: AUDIENCE → SPEAKER promotion does not call sfuRevokePublish', () => {
  test('sfuRevokePublish is NOT called during promotion to SPEAKER', async () => {
    setupPromoteSuccess();
    // After transaction, $queryRaw for stage_state snapshot
    prisma.$queryRaw.mockResolvedValue([]);

    const io = makeIo();
    getIo.mockReturnValue(io);

    const { promoteParticipant } = require('../controllers/voice.controller');
    const { req, res, next } = makeReqRes({
      roomId: ROOM_ID, targetUserId: TARGET, role: 'SPEAKER', requesterId: REQUESTER
    });

    await promoteParticipant(req, res, next);

    expect(sfuRevokePublish).not.toHaveBeenCalled();
  });
});
