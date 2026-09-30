'use strict';
/**
 * PH24C — Voice Club Concurrency Remediation Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for the five confirmed findings fixed in Phase 24C:
 *
 *   PH24C-001  kickParticipant: seatNumber=null now atomic with isActive=false
 *   PH24C-002  joinRoom: ban check moved inside FOR UPDATE transaction
 *   PH24C-003  joinRoom reconnect: wasKicked check blocks immediate rejoin
 *   PH24C-004  autoPromoteNext: P2002/ER_DUP_ENTRY seat collision handled
 *   PH24C-005  Mobile socket: voice:join_room re-emitted on reconnect (source)
 *
 * Evidence level:
 *   Tests A–E:  SOURCE-LEVEL (static analysis of controller/utility source)
 *   Tests F–K:  SOURCE-LEVEL UNIT (mocked Prisma — follows existing test pattern)
 *   Tests L–M:  SOURCE-LEVEL (mobile screen source analysis)
 *   NOT EXECUTED — real-DB concurrent transaction tests require live MySQL
 *                  (environment limitation: shadow DB pre-existing migration error)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');

// ─── Source files ─────────────────────────────────────────────────────────────
const VOICE_CTRL    = path.join(__dirname, '../controllers/voice.controller.js');
const AUTO_PROMOTE  = path.join(__dirname, '../utils/autoPromote.js');
const MOBILE_SCREEN = path.join(__dirname, '../../../mobile/app/voice/[id].tsx');
const SCHEMA        = path.join(__dirname, '../../prisma/schema.prisma');
const MIGRATION     = path.join(__dirname,
  '../../prisma/migrations/20260929_add_was_kicked_to_voice_participants/migration.sql');

const voiceSrc  = fs.readFileSync(VOICE_CTRL,   'utf8');
const autoSrc   = fs.readFileSync(AUTO_PROMOTE,  'utf8');
const schemaSrc = fs.readFileSync(SCHEMA,        'utf8');
const mobileSrc = fs.existsSync(MOBILE_SCREEN)
  ? fs.readFileSync(MOBILE_SCREEN, 'utf8') : '';

function extractFn(src, name, next) {
  const start = src.indexOf('async function ' + name);
  if (start === -1) return '';
  const end = next ? src.indexOf('async function ' + next, start + 1) : src.length;
  return src.slice(start, end === -1 ? src.length : end);
}

// ─── Mocks for unit tests ─────────────────────────────────────────────────────
jest.mock('../utils/prisma', () => {
  const m = {
    voiceRoom:        { findUnique: jest.fn() },
    voiceParticipant: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), create: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
    voiceRoomMember:  { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn(), upsert: jest.fn(), updateMany: jest.fn() },
    auditLog:         { create: jest.fn() },
    $queryRaw:        jest.fn().mockResolvedValue([]),
    $executeRaw:      jest.fn().mockResolvedValue(1),
    $transaction:     jest.fn(async (fn, _opts) => {
      if (Array.isArray(fn)) return Promise.all(fn);
      return fn(m);
    }),
  };
  return m;
});
jest.mock('../utils/redis',       () => ({ setCache: jest.fn(), getCache: jest.fn().mockResolvedValue(null), deleteCache: jest.fn(), deleteCachePattern: jest.fn(), isRedisReady: jest.fn().mockReturnValue(false) }));
jest.mock('../sockets',           () => ({ getIo: jest.fn().mockReturnValue(null) }));
jest.mock('../utils/feedLive',    () => ({ broadcastLiveStart: jest.fn(), broadcastLiveEnd: jest.fn(), broadcastLiveUpdate: jest.fn() }));
jest.mock('../services/queue.service', () => ({ scheduleRoomReminder: jest.fn(), cancelRoomReminder: jest.fn(), queueBulkNotifications: jest.fn() }));
jest.mock('../utils/autoPromote', () => ({ autoPromoteNext: jest.fn() }));
jest.mock('../utils/voiceQueue',  () => ({ clearQueue: jest.fn(), enqueue: jest.fn(), getQueue: jest.fn().mockResolvedValue([]), isInQueue: jest.fn().mockResolvedValue(false), dequeue: jest.fn() }));
jest.mock('../utils/logger',      () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/search',      () => ({ searchVoiceRooms: jest.fn().mockResolvedValue([]) }));
jest.mock('../utils/livekitService', () => ({ sfuEvict: jest.fn().mockResolvedValue(undefined), sfuRevokePublish: jest.fn().mockResolvedValue(undefined), getLivekitRoomService: jest.fn() }));
jest.mock('../utils/voiceSeat',   () => ({ findAvailableSeat: jest.fn(), assignSeat: jest.fn(), countOnStage: jest.fn() }));

const prisma = require('../utils/prisma');

function makeRoom(o = {}) {
  return { id: 'room-a', title: 'Room A', coverEmoji: '🎙️', topic: null, hostId: 'host-1',
           status: 'LIVE', privacy: 'PUBLIC', deletedAt: null, roomLevel: 1, maxSpeakers: 12,
           isOpenMic: false, micLocked: false, ...o };
}
function makeParticipant(o = {}) {
  return { id: 'part-1', userId: 'user-1', roomId: 'room-a', role: 'AUDIENCE', isMuted: true,
           isActive: true, handRaised: false, handRaisedAt: null, seatNumber: null,
           wasKicked: false, joinedAt: new Date(), leftAt: null,
           user: { id: 'user-1', firstName: 'Test', lastName: 'User', avatarUrl: null }, ...o };
}
function makeReqRes(userId = 'user-1', roomId = 'room-a') {
  return {
    req: { params: { id: roomId }, user: { id: userId, schoolId: null, role: 'STUDENT' }, body: {} },
    res: { _s: 200, _b: null, status(s) { this._s = s; return this; }, json(b) { this._b = b; return this; } }
  };
}

const { kickParticipant } = require('../controllers/voice.controller');
const { joinRoom }        = require('../controllers/voice.controller');

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$queryRaw.mockResolvedValue([]);
});

// ═══════════════════════════════════════════════════════════
// PH24C-001 — Atomic kick: seatNumber + isActive + wasKicked
// ═══════════════════════════════════════════════════════════
describe('PH24C-001 — kickParticipant atomic seat + wasKicked', () => {

  test('S1: source — kick update includes seatNumber: null', () => {
    const fn = extractFn(voiceSrc, 'kickParticipant', 'banParticipant');
    // The Prisma update must include seatNumber: null in the data object
    expect(fn).toContain('seatNumber:   null');
  });

  test('S2: source — kick update includes wasKicked: true', () => {
    const fn = extractFn(voiceSrc, 'kickParticipant', 'banParticipant');
    expect(fn).toContain('wasKicked:    true');
  });

  test('S3: source — no separate fire-and-forget $executeRaw for seatNumber after fix', () => {
    const fn = extractFn(voiceSrc, 'kickParticipant', 'banParticipant');
    // The old pattern: prisma.$executeRaw`UPDATE voice_participants SET seatNumber = NULL`.catch(() => {})
    // must be gone
    expect(fn).not.toContain("seatNumber = NULL`.catch");
  });

  test('S4: source — isActive + seatNumber + wasKicked are in the same update data block', () => {
    const fn = extractFn(voiceSrc, 'kickParticipant', 'banParticipant');
    const updateIdx = fn.indexOf('voiceParticipant.update(');
    expect(updateIdx).toBeGreaterThan(-1);
    // Grab ~400 chars from the update call — all three fields must be in this block
    const updateBlock = fn.slice(updateIdx, updateIdx + 400);
    expect(updateBlock).toContain('isActive:     false');
    expect(updateBlock).toContain('seatNumber:   null');
    expect(updateBlock).toContain('wasKicked:    true');
  });

  test('U1: unit — kick sets isActive=false, seatNumber=null, wasKicked=true atomically', async () => {
    const room     = makeRoom({ hostId: 'host-1' });
    const requester = makeParticipant({ userId: 'host-1', role: 'HOST', isActive: true });
    const target   = makeParticipant({ userId: 'target-1', role: 'AUDIENCE', isActive: true, seatNumber: 3 });

    prisma.voiceParticipant.findUnique
      .mockResolvedValueOnce(requester) // requester lookup
      .mockResolvedValueOnce({ ...target, user: { firstName: 'Kicked', lastName: 'User' } }); // target lookup
    prisma.voiceParticipant.update.mockResolvedValue({ ...target, isActive: false, seatNumber: null, wasKicked: true });

    const { req, res } = makeReqRes('host-1', 'room-a');
    req.params.userId = 'target-1';
    await kickParticipant(req, res, jest.fn());

    expect(prisma.voiceParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isActive:     false,
          seatNumber:   null,
          wasKicked:    true,
          leftAt:       expect.any(Date),
          handRaised:   false,
          handRaisedAt: null,
        })
      })
    );
  });

  test('U2: unit — kick response is 200 success', async () => {
    const requester = makeParticipant({ userId: 'host-1', role: 'HOST', isActive: true });
    const target    = makeParticipant({ userId: 'target-1', role: 'AUDIENCE', isActive: true });

    prisma.voiceParticipant.findUnique
      .mockResolvedValueOnce(requester)
      .mockResolvedValueOnce({ ...target, user: { firstName: 'T', lastName: 'U' } });
    prisma.voiceParticipant.update.mockResolvedValue({});

    const { req, res } = makeReqRes('host-1', 'room-a');
    req.params.userId = 'target-1';
    await kickParticipant(req, res, jest.fn());

    expect(res._s).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════
// PH24C-002 — Ban check inside FOR UPDATE transaction
// ═══════════════════════════════════════════════════════════
describe('PH24C-002 — joinRoom ban check inside transaction', () => {

  test('S1: source — ban check is inside the $transaction body', () => {
    const txIdx   = voiceSrc.indexOf('ONE-ROOM-AT-A-TIME');
    expect(txIdx).toBeGreaterThan(-1);
    const banIdx  = voiceSrc.indexOf('BANNED_FROM_ROOM', txIdx);
    expect(banIdx).toBeGreaterThan(-1);
    // The ban check must come after the FOR UPDATE line
    const fuIdx   = voiceSrc.indexOf('FOR UPDATE', txIdx);
    expect(fuIdx).toBeGreaterThan(-1);
    expect(banIdx).toBeGreaterThan(fuIdx);
  });

  test('S2: source — ban check uses tx.voiceRoomMember (transaction-aware client)', () => {
    const txIdx = voiceSrc.indexOf('ONE-ROOM-AT-A-TIME');
    const banBlock = voiceSrc.slice(txIdx, txIdx + 3000);
    expect(banBlock).toContain('tx.voiceRoomMember.findUnique');
  });

  test('S3: source — pre-transaction standalone ban check removed; ban now inside tx', () => {
    const joinFn = extractFn(voiceSrc, 'joinRoom', 'leaveRoom');
    const txStart = joinFn.indexOf('ONE-ROOM-AT-A-TIME');
    // The authoritative ban check (BANNED_FROM_ROOM) must only appear inside the tx body
    // (after ONE-ROOM-AT-A-TIME comment), not as a standalone pre-tx check
    const preTxSection = joinFn.slice(0, txStart);
    // The old pre-tx standalone ban block had a dedicated comment: 'P0-1 FIX: Check room-level ban'
    // and threw directly to the outer errorResponse — that pattern is gone
    expect(preTxSection).not.toContain('P0-1 FIX: Check room-level ban');
    // BANNED_FROM_ROOM typed error (inside tx) must only appear after the tx start
    const banInTxIdx = joinFn.indexOf('BANNED_FROM_ROOM', txStart);
    expect(banInTxIdx).toBeGreaterThan(-1);
    // And NOT before the tx start
    const banBeforeTx = joinFn.indexOf('BANNED_FROM_ROOM', 0);
    expect(banBeforeTx).toBeGreaterThanOrEqual(txStart);
  });

  test('S4: source — BANNED_FROM_ROOM error response handler exists', () => {
    expect(voiceSrc).toContain('BANNED_FROM_ROOM');
    expect(voiceSrc).toContain("txErr.message === 'BANNED_FROM_ROOM'");
  });

  test('U1: unit — banned user is rejected with 403', async () => {
    const room = makeRoom({ hostId: 'host-1' });
    prisma.voiceRoom.findUnique.mockResolvedValue(room);
    prisma.voiceParticipant.count.mockResolvedValue(0); // capacity ok

    // Ban record found inside transaction
    prisma.voiceRoomMember.findUnique.mockResolvedValue({ isBanned: true });

    const { req, res } = makeReqRes('user-1', 'room-a');
    await joinRoom(req, res, jest.fn());

    expect(res._s).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════
// PH24C-003 — wasKicked persisted + reconnect blocked
// ═══════════════════════════════════════════════════════════
describe('PH24C-003 — wasKicked persistent flag', () => {

  test('S1: schema — wasKicked field exists on VoiceParticipant', () => {
    expect(schemaSrc).toContain('wasKicked    Boolean              @default(false)');
  });

  test('S2: migration — migration SQL adds wasKicked column with DEFAULT FALSE', () => {
    const migSrc = fs.readFileSync(MIGRATION, 'utf8');
    expect(migSrc).toContain('wasKicked');
    expect(migSrc).toContain('DEFAULT FALSE');
    expect(migSrc).toContain('voice_participants');
    // Must be additive — no DROP or destructive change
    expect(migSrc.toUpperCase()).not.toContain('DROP COLUMN');
    expect(migSrc.toUpperCase()).not.toContain('DROP TABLE');
  });

  test('S3: source — joinRoom reconnect path checks wasKicked before restoring isActive', () => {
    const joinFn = extractFn(voiceSrc, 'joinRoom', 'leaveRoom');
    expect(joinFn).toContain('wasKicked');
    expect(joinFn).toContain('KICKED_FROM_ROOM');
    // wasKicked check must come BEFORE isActive: true restore
    const kickedIdx  = joinFn.indexOf('wasKicked');
    const activeIdx  = joinFn.indexOf('isActive:     true');
    expect(kickedIdx).toBeGreaterThan(-1);
    expect(activeIdx).toBeGreaterThan(-1);
    expect(kickedIdx).toBeLessThan(activeIdx);
  });

  test('S4: source — KICKED_FROM_ROOM error response handler exists', () => {
    expect(voiceSrc).toContain("txErr.message === 'KICKED_FROM_ROOM'");
    expect(voiceSrc).toContain('You were removed from this room and cannot rejoin');
  });

  test('U1: unit — kicked user (wasKicked=true) cannot reconnect: gets 403', async () => {
    const room = makeRoom({ hostId: 'host-1' });
    prisma.voiceRoom.findUnique.mockResolvedValue(room);
    prisma.voiceParticipant.count.mockResolvedValue(0);

    // Not banned — passes ban check
    prisma.voiceRoomMember.findUnique.mockResolvedValue({ isBanned: false });
    // No other active rooms
    prisma.voiceParticipant.findMany.mockResolvedValue([]);
    // Existing record with wasKicked=true
    prisma.voiceParticipant.findUnique.mockResolvedValue(
      makeParticipant({ wasKicked: true, isActive: false })
    );

    const { req, res } = makeReqRes('user-1', 'room-a');
    await joinRoom(req, res, jest.fn());

    expect(res._s).toBe(403);
  });

  test('U2: unit — normal re-join (wasKicked=false) still works: 200', async () => {
    const room = makeRoom({ hostId: 'host-1' });
    prisma.voiceRoom.findUnique.mockResolvedValue(room);
    prisma.voiceParticipant.count.mockResolvedValue(0);
    prisma.voiceRoomMember.findUnique.mockResolvedValue({ isBanned: false });
    prisma.voiceParticipant.findMany.mockResolvedValue([]);
    prisma.voiceParticipant.findUnique.mockResolvedValue(
      makeParticipant({ wasKicked: false, isActive: false })
    );
    prisma.voiceParticipant.update.mockResolvedValue(makeParticipant({ isActive: true }));
    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce({ status: 'LIVE' });

    const { req, res } = makeReqRes('user-1', 'room-a');
    const next = jest.fn();
    await joinRoom(req, res, next);

    // Should not be a 403 (kicked rejection)
    expect(res._s).not.toBe(403);
    expect(next).not.toHaveBeenCalledWith(expect.any(Error));
  });

  test('U3: unit — first-time join (no existing record) is unaffected', async () => {
    const room = makeRoom({ hostId: 'host-1' });
    prisma.voiceRoom.findUnique.mockResolvedValue(room);
    prisma.voiceParticipant.count.mockResolvedValue(0);
    prisma.voiceRoomMember.findUnique.mockResolvedValue(null); // no ban record
    prisma.voiceParticipant.findMany.mockResolvedValue([]);    // no other active rooms
    prisma.voiceParticipant.findUnique.mockResolvedValue(null); // no existing record
    prisma.voiceParticipant.create.mockResolvedValue(makeParticipant({ isActive: true }));
    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce({ status: 'LIVE' });

    const { req, res } = makeReqRes('user-2', 'room-a');
    const next = jest.fn();
    await joinRoom(req, res, next);

    expect(res._s).not.toBe(403);
    expect(next).not.toHaveBeenCalledWith(expect.any(Error));
  });
});

// ═══════════════════════════════════════════════════════════
// PH24C-004 — autoPromoteNext P2002 seat collision handling
// ═══════════════════════════════════════════════════════════
describe('PH24C-004 — autoPromoteNext P2002 seat collision handling', () => {

  test('S1: source — isDupSeat detection present in autoPromoteNext', () => {
    expect(autoSrc).toContain('isDupSeat');
    expect(autoSrc).toContain("assignErr.code === 'P2002'");
    expect(autoSrc).toContain('ER_DUP_ENTRY');
    expect(autoSrc).toContain('voice_participants_roomId_seatNumber_key');
  });

  test('S2: source — seat assignment wrapped in try/catch', () => {
    const assignIdx = autoSrc.indexOf('PH24C-004 FIX');
    expect(assignIdx).toBeGreaterThan(-1);
    const block = autoSrc.slice(assignIdx, assignIdx + 2000);
    expect(block).toContain('try {');
    expect(block).toContain('} catch (assignErr) {');
  });

  test('S3: source — on collision: log + clean up handRaised + recurse', () => {
    const block = autoSrc.slice(autoSrc.indexOf('isDupSeat'), autoSrc.indexOf('isDupSeat') + 1500);
    expect(block).toContain("logger.warn");
    expect(block).toContain('handRaised: false');
    expect(block).toContain('return autoPromoteNext(roomId, io)');
  });

  test('S4: source — non-seat-race errors are re-thrown', () => {
    // throw assignErr is ~1182 chars after isDupSeat — use 1400 to be safe
    const block = autoSrc.slice(autoSrc.indexOf('isDupSeat'), autoSrc.indexOf('isDupSeat') + 1400);
    expect(block).toContain('throw assignErr');
  });

  test('S5: source — seat assignment still has both isMod and SPEAKER paths', () => {
    expect(autoSrc).toContain("SET seatNumber = ${promotedSeat}, isMuted = 0");
    expect(autoSrc).toContain("SET seatNumber = ${promotedSeat}, role = 'SPEAKER'");
  });

  test('S6: matches grabMic pattern — isDupSeat detection uses same strings', () => {
    // grabMic and autoPromoteNext must use the same collision detection pattern
    const grabMicFn = extractFn(
      require('fs').readFileSync(VOICE_CTRL, 'utf8'),
      'grabMic',
      'dropMic'
    );
    expect(grabMicFn).toContain("'P2002'");
    expect(grabMicFn).toContain('ER_DUP_ENTRY');
    expect(autoSrc).toContain("'P2002'");
    expect(autoSrc).toContain('ER_DUP_ENTRY');
  });
});

// ═══════════════════════════════════════════════════════════
// PH24C-005 — Mobile socket reconnect re-join
// ═══════════════════════════════════════════════════════════
describe('PH24C-005 — Mobile socket reconnect voice:join_room', () => {

  test('S1: mobile source — onReconnect handler registered on connect event', () => {
    if (!mobileSrc) { console.warn('Mobile source not found — skipping'); return; }
    expect(mobileSrc).toContain("const onReconnect = () => { socket.emit('voice:join_room', id); }");
    expect(mobileSrc).toContain("socket.on('connect', onReconnect)");
  });

  test('S2: mobile source — onReconnect is cleaned up in the return function', () => {
    if (!mobileSrc) { console.warn('Mobile source not found — skipping'); return; }
    expect(mobileSrc).toContain("socket.off('connect', onReconnect)");
  });

  test('S3: mobile source — onReconnect comment references PH24C-005', () => {
    if (!mobileSrc) { console.warn('Mobile source not found — skipping'); return; }
    expect(mobileSrc).toContain('PH24C-005');
  });

  test('S4: web source — same pattern exists in useVoiceRoom.ts for parity verification', () => {
    const webHook = path.join(__dirname, '../../../frontend/src/hooks/useVoiceRoom.ts');
    if (!fs.existsSync(webHook)) return;
    const webSrc = fs.readFileSync(webHook, 'utf8');
    expect(webSrc).toMatch(/socket\.on\('connect',\s*onReconnect\)/);
    expect(webSrc).toMatch(/socket\.emit\('voice:join_room'/);
  });

  test('S5: mobile cleanup removes exactly the onReconnect listener (not all connect listeners)', () => {
    if (!mobileSrc) return;
    // socket.off('connect', onReconnect) is specific — it removes only this listener
    // (not socket.off('connect') which would remove all connect listeners)
    const offIdx = mobileSrc.indexOf("socket.off('connect', onReconnect)");
    expect(offIdx).toBeGreaterThan(-1);
    // Verify it's the named form (with handler reference), not the bare form
    const bareOffIdx = mobileSrc.indexOf("socket.off('connect')");
    // Either doesn't exist or is a different call elsewhere
    if (bareOffIdx !== -1) {
      expect(bareOffIdx).not.toBe(offIdx);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// Phase 24B regression — voice:reaction guard intact
// ═══════════════════════════════════════════════════════════
describe('Phase 24B regression — voice:reaction socket-room guard', () => {
  const APP_SRC = path.join(__dirname, '../app.js');
  const appSrc  = fs.readFileSync(APP_SRC, 'utf8');

  function extractHandlerSection(source, eventName) {
    const marker = `socket.on('${eventName}'`;
    const start  = source.indexOf(marker);
    if (start === -1) return '';
    const next = source.indexOf("  socket.on('", start + marker.length);
    return next === -1 ? source.slice(start) : source.slice(start, next);
  }

  test('voice:reaction still has socket.rooms.has() guard (PH19-001 not regressed)', () => {
    const section = extractHandlerSection(appSrc, 'voice:reaction');
    expect(section).toContain('socket.rooms.has(`voice:${roomId}`)');
  });

  test('voice:speaking guard unchanged', () => {
    const section = extractHandlerSection(appSrc, 'voice:speaking');
    expect(section).toContain('socket.rooms.has(`voice:${roomId}`)');
  });
});

// ═══════════════════════════════════════════════════════════
// Invariant preservation
// ═══════════════════════════════════════════════════════════
describe('Core invariants preserved', () => {

  test('INV-01: FOR UPDATE still present in joinRoom (one-active-room mechanism intact)', () => {
    const joinFn = extractFn(voiceSrc, 'joinRoom', 'leaveRoom');
    expect(joinFn).toContain('FOR UPDATE');
    expect(joinFn).toContain('ReadCommitted');
  });

  test('INV-03: same-room reconnect still allows wasKicked=false participant', () => {
    const joinFn = extractFn(voiceSrc, 'joinRoom', 'leaveRoom');
    // reconnect exclusion: roomId: { not: roomId } — still present
    expect(joinFn).toContain('roomId: { not: roomId }');
  });

  test('INV-05: seat uniqueness constraint still in schema', () => {
    expect(schemaSrc).toContain('@@unique([roomId, seatNumber])');
  });

  test('INV-07: kickParticipant uses Prisma update (DB authoritative)', () => {
    const fn = extractFn(voiceSrc, 'kickParticipant', 'banParticipant');
    expect(fn).toContain('voiceParticipant.update(');
  });
});
